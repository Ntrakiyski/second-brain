/**
 * mcp.ts — MCP server definition and tools/list sanitization.
 *
 * Purpose: Register all MCP tools (remember, recall, forget, link, etc.) and
 *          sanitize tools/list responses so strict clients (e.g. OpenAI Codex)
 *          don't reject unknown fields like `execution`.
 *
 * Input:   Env bindings, optional ExecutionContext, optional userId for
 *          per-user scoping.
 *
 * Output:  McpServer instance with all tools registered; helper functions to
 *          detect and strip `execution` metadata from tools/list responses.
 *
 * Logic:   buildMcpServer creates an agents/mcp McpServer and registers each
 *          tool with its input schema (zod) and handler. The sanitization
 *          helpers intercept POST requests whose JSON-RPC method is
 *          "tools/list" and strip the `execution` field from every tool in
 *          the response payload.
 */

import type { Env } from "./types";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { captureEntry, appendToEntry, storeEntry, deleteStaleVectors, createSnapshot } from "./ingest";
import { recallEntries, renderRecallText } from "./recall";
import type { RecallMatch } from "./recall";
import { forgetEntry, applyStatus } from "./lifecycle";
import { buildEntryFilterQuery, getStatus, withKind, withStatus, buildVisibilityClause } from "./tags";
import { createEdge, deleteEdge, getConnections, EDGE_TYPES, isValidEdgeType, edgeLabel } from "./graph";
import { EPISTEMIC_STATUS_VALUES, isValidTransition, VALID_EPISTEMIC_TRANSITIONS, type EpistemicStatus } from "./types";
import { isManagedMirror, mirrorEditError } from "./integrations-mirror";
import { MEMORY_KIND_VALUES, KIND_VALUES, type MemoryKind, type MemoryStatus, STATUS_VALUES } from "./types";
import { VECTORIZE_FIX_HINT, TOOL_AUTONOMY } from "./config";
import { startRun, endRun, logToolCall } from "./audit";

// ─── MCP Server ───────────────────────────────────────────────────────────────

export function buildMcpServer(env: Env, ctx: ExecutionContext, userId?: string): McpServer {
  const server = new McpServer({ name: "second-brain", version: "1.0.0" });

  // Audit state: one run per MCP session, lazily created on first tool call.
  let runId: string | null = null;
  let toolCount = 0;

  /**
   * Wrap a tool handler with audit logging. Creates a run on first call,
   * logs each tool call with timing and error info, ends run on completion.
   */
  function audited<I extends Record<string, unknown>>(
    toolName: string,
    handler: (input: I, extra: any) => any,
  ): (input: I, extra: any) => any {
    return async (input: I, extra: any) => {
      if (!runId) runId = await startRun(env, userId ?? "anonymous");
      toolCount++;
      const t0 = Date.now();
      let error: string | undefined;
      let result: { content: { type: string; text: string }[] };
      try {
        result = await handler(input, extra);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        result = { content: [{ type: "text", text: `Error: ${error}` }] };
      }
      const durationMs = Date.now() - t0;
      const outputText = result.content?.[0]?.text ?? "";
      ctx.waitUntil(logToolCall(env, runId, toolName, input as Record<string, unknown>, outputText, durationMs, error).catch(() => {}));
      if (runId) ctx.waitUntil(endRun(env, runId, toolCount).catch(() => {}));
      return result;
    };
  }

  // ── remember ────────────────────────────────────────────────────────────
  server.registerTool(
    "remember",
    {
      description: "Store an idea, task, or note in your second brain. Call this automatically whenever the user shares context, goals, decisions, or preferences.",
      inputSchema: {
        content: z.string().describe("The idea, task, or note to store"),
        tags: z.array(z.string()).optional().describe("Optional tags for filtering"),
        source: z.string().optional().describe("Origin: phone, browser, voice, claude"),
      },
    },
    audited("remember", async ({ content, tags, source }) => {
      const result = await captureEntry(content, tags ?? [], source ?? "claude", env, ctx, userId);
      if (result.status === "blocked") {
        return { content: [{ type: "text", text: `Duplicate detected (${(result.score * 100).toFixed(0)}% match) — not stored. Existing entry ID: ${result.matchId}` }] };
      }
      if (result.status === "contradiction") {
        return { content: [{ type: "text", text: `Stored. ID: ${result.id} — resolved contradiction with entry ${result.resolvedConflict}${result.reason ? `: ${result.reason}` : ""}.` }] };
      }
      if (result.status === "contradiction_protected") {
        return { content: [{ type: "text", text: `Stored as draft (ID: ${result.id}) — conflicts with a canonical memory (${result.canonicalId}), which was kept${result.reason ? `: ${result.reason}` : ""}.` }] };
      }
      if (result.status === "replaced") {
        return { content: [{ type: "text", text: `Memory updated — new content replaced outdated entry (ID: ${result.id}).` }] };
      }
      if (result.status === "merged") {
        return { content: [{ type: "text", text: `Memories merged — combined into existing entry (ID: ${result.id}).` }] };
      }
      if (result.status === "flagged") {
        return { content: [{ type: "text", text: `Stored with ID: ${result.id} — note: similar entry exists (${(result.score * 100).toFixed(0)}% match, ID: ${result.matchId}). Tagged as duplicate-candidate.` }] };
      }
      return { content: [{ type: "text", text: `Stored. ID: ${result.id}` }] };
    })
  );

  // ── append ───────────────────────────────────────────────────────────────
  server.registerTool(
    "append",
    {
      description: "Append new information to an existing entry in your second brain. Use when something has changed or been updated — preserves the original and adds the update with a timestamp. Get the entry ID from recall or list_recent first.",
      inputSchema: {
        id: z.string().describe("Entry ID to append to — from recall or list_recent"),
        addition: z.string().describe("The new information to add to the existing entry"),
      },
    },
    audited("append", async ({ id, addition }) => {
      const row = await env.DB.prepare(
        `SELECT id, content, tags, source, owner_user_id FROM entries WHERE id = ?`
      ).bind(id).first() as Record<string, any> | null;

      if (!row) {
        return {
          content: [{ type: "text", text: `No entry found with ID: ${id}` }],
        };
      }

      if (userId && row.owner_user_id && row.owner_user_id !== userId && row.owner_user_id !== "") {
        return { content: [{ type: "text", text: `No entry found with ID: ${id}` }] };
      }

      const existingContent = row.content as string;
      const tags: string[] = JSON.parse(row.tags ?? "[]");
      const source = row.source as string;
      const a = addition.trim();

      if (!a) {
        return {
          content: [{ type: "text", text: "Addition cannot be empty." }],
        };
      }

      if (await isManagedMirror(source, env)) {
        return { content: [{ type: "text", text: mirrorEditError(source) }] };
      }

      try {
        await appendToEntry(env, id, existingContent, a, tags, source, userId, ctx);
      } catch (e) {
        console.error("Append failed:", e);
        return {
          content: [{ type: "text", text: `Append failed: ${(e as Error).message}` }],
        };
      }

      return {
        content: [{
          type: "text",
          text: `Appended to entry ${id}. The original content is preserved and your update has been added with today's date.`,
        }],
      };
    })
  );

  // ── update ───────────────────────────────────────────────────────────────
  server.registerTool(
    "update",
    {
      description: "Replace the full content of an existing memory. Use when information has changed entirely — a preference reversed, a decision overturned, or content is outdated. Use append instead if you're adding new information rather than replacing. Get the entry ID from recall or list_recent first.",
      inputSchema: {
        id: z.string().describe("Entry ID to update — from recall or list_recent"),
        content: z.string().describe("The new content to replace the existing entry with"),
      },
    },
    audited("update", async ({ id, content }) => {
      const newContent = content.trim();
      if (!newContent) {
        return { content: [{ type: "text", text: "Content cannot be empty." }] };
      }

      // Read current row upfront — need tags, source, AND old vector_ids before any mutation
      const row = await env.DB.prepare(
        `SELECT tags, source, vector_ids, owner_user_id FROM entries WHERE id = ?`
      ).bind(id).first() as Record<string, any> | null;

      if (!row) {
        return { content: [{ type: "text", text: `No entry found with ID: ${id}` }] };
      }

      if (userId && row.owner_user_id && row.owner_user_id !== userId && row.owner_user_id !== "") {
        return { content: [{ type: "text", text: `No entry found with ID: ${id}` }] };
      }

      if (await isManagedMirror(row.source as string, env)) {
        return { content: [{ type: "text", text: mirrorEditError(row.source as string) }] };
      }

      const tags: string[] = JSON.parse(row.tags ?? "[]").filter((t: string) => t !== "rolled-up");
      const source = row.source as string;
      const oldVectorIds: string[] = JSON.parse(row.vector_ids ?? "[]");
      const existingOwnerId = row.owner_user_id as string;

      // Snapshot: backup before destructive update — fire-and-forget (non-fatal)
      ctx.waitUntil(createSnapshot(env, id).catch(e => console.error("Snapshot creation failed (non-fatal):", e)));

      // Step 1: Update D1 content and tags (strip rolled-up so updated entry ranks normally)
      await env.DB.prepare(`UPDATE entries SET content = ?, tags = ? WHERE id = ?`)
        .bind(newContent, JSON.stringify(tags), id).run();

      // Step 2: Re-embed new content → inserts new vectors + updates vector_ids in D1
      let newVectorIds: string[] = [];
      try {
      newVectorIds = await storeEntry(env, id, newContent, tags, source, Date.now(), existingOwnerId, tags.includes("private"));
      } catch (e) {
        console.error("Vectorize re-embed failed (non-fatal):", e);
      }
      const newVectorCount = newVectorIds.length;

      // Step 3: Delete only stale vectors — ids reused by the re-embed must survive
      try {
        await deleteStaleVectors(env, oldVectorIds, newVectorIds);
      } catch (e) {
        console.error("Old vector cleanup failed (non-fatal):", e);
      }

      return {
        content: [{ type: "text", text: `Updated entry ${id}. Re-embedded as ${newVectorCount} vector(s).` }],
      };
    })
  );

  // ── set_status ─────────────────────────────────────────────────────────────
  server.registerTool(
    "set_status",
    {
      description: "Set a memory's lifecycle status. 'canonical' = confirmed/authoritative (protected from auto-overwrite), 'draft' = tentative, 'deprecated' = no longer accurate (removed from recall, kept for audit). Get the entry ID from recall or list_recent first.",
      inputSchema: {
        id: z.string().describe("Entry ID — from recall or list_recent"),
        status: z.enum([...STATUS_VALUES] as [string, ...string[]]).describe("canonical | draft | deprecated"),
      },
    },
    audited("set_status", async ({ id, status }) => {
      if (userId) {
        const row = await env.DB.prepare(`SELECT owner_user_id FROM entries WHERE id = ?`).bind(id).first() as { owner_user_id: string } | null;
        if (row && row.owner_user_id && row.owner_user_id !== userId && row.owner_user_id !== "") {
          return { content: [{ type: "text", text: `No entry found with ID: ${id}` }] };
        }
      }
      const ok = await applyStatus(id, status as MemoryStatus, env);
      if (!ok) return { content: [{ type: "text", text: `No entry found with ID: ${id}` }] };
      return { content: [{ type: "text", text: status === "deprecated" ? `Entry ${id} deprecated — removed from recall, kept for audit.` : `Entry ${id} marked ${status}.` }] };
    })
  );

  // ── set_epistemic_status ──────────────────────────────────────────────────
  server.registerTool(
    "set_epistemic_status",
    {
      description: "Transition an entry's epistemic lifecycle state. Validates transitions — returns error with valid next states if transition is invalid. States: candidate → reviewed → canonical → qualified → superseded → retracted.",
      inputSchema: {
        entry_id: z.string().describe("Entry ID from recall or list_recent"),
        new_status: z.enum([...EPISTEMIC_STATUS_VALUES] as [string, ...string[]]).describe("New epistemic status"),
      },
    },
    audited("set_epistemic_status", async ({ entry_id, new_status }) => {
      if (userId) {
        const row = await env.DB.prepare(`SELECT owner_user_id FROM entries WHERE id = ?`).bind(entry_id).first() as { owner_user_id: string } | null;
        if (row && row.owner_user_id && row.owner_user_id !== userId && row.owner_user_id !== "") {
          return { content: [{ type: "text", text: `No entry found with ID: ${entry_id}` }] };
        }
      }
      const entry = await env.DB.prepare(`SELECT epistemic_status FROM entries WHERE id = ?`).bind(entry_id).first() as { epistemic_status: string } | null;
      if (!entry) return { content: [{ type: "text", text: `No entry found with ID: ${entry_id}` }] };
      const currentStatus = (entry.epistemic_status ?? "canonical") as EpistemicStatus;
      if (!isValidTransition(currentStatus, new_status as EpistemicStatus)) {
        const validNext = VALID_EPISTEMIC_TRANSITIONS[currentStatus] ?? [];
        return { content: [{ type: "text", text: `Invalid transition: ${currentStatus} → ${new_status}. Valid next states: ${validNext.length ? validNext.join(", ") : "(none — terminal state)"}` }] };
      }
      await env.DB.prepare(`UPDATE entries SET epistemic_status = ? WHERE id = ?`).bind(new_status, entry_id).run();
      return { content: [{ type: "text", text: `Entry ${entry_id} transitioned: ${currentStatus} → ${new_status}.` }] };
    })
  );

  // ── recall ───────────────────────────────────────────────────────────────
  server.registerTool(
    "recall",
    {
      description: "Recall: semantically search your second brain for relevant notes and context. Call recall automatically at the start of every conversation and every 3-4 messages.",
      inputSchema: {
        query: z.string().describe("Natural language search query"),
        topK: z.number().int().min(1).max(20).default(5).describe("Number of results"),
        tag: z.string().optional().describe("Filter by a specific tag"),
        after: z.number().int().optional().describe("Only return entries after this Unix ms timestamp"),
        before: z.number().int().optional().describe("Only return entries before this Unix ms timestamp"),
        kind: z.enum([...KIND_VALUES] as [string, ...string[]]).optional().describe("Filter to episodic (events) or semantic (facts/knowledge)"),
        hops: z.number().int().min(0).max(3).default(0).describe("Graph expansion depth: 0 = direct matches only (default); 1–2 also surfaces related memories linked in the graph"),
        as_of: z.number().int().optional().describe("Unix timestamp — return only facts valid at this time"),
      },
    },
    audited("recall", async ({ query, topK, tag, after, before, kind, hops, as_of }) => {
      const { matches, insight, semanticUnavailable, proposed_edges } = await recallEntries({ query, topK, tag, after, before, kind: kind as MemoryKind | undefined, hops, userId, asOf: as_of }, env, ctx);

      const notice = semanticUnavailable
        ? `Note: semantic search is unavailable because the Vectorize index is missing, so these are keyword matches only. Fix: ${VECTORIZE_FIX_HINT}.\n\n`
        : "";

      if (!matches.length) {
        return { content: [{ type: "text", text: notice + "Nothing found matching that query." }] };
      }

      let text = notice + renderRecallText(matches, insight);
      if (proposed_edges.length) {
        text += `\n\n⚠️ **Contradictions detected** (${proposed_edges.length}):\n` +
          proposed_edges.map(pe => `  • ${pe.source_id} vs ${pe.target_id} — ${pe.reason}`).join("\n") +
          `\n\nUse \`list-proposals\` to review, or \`approve-proposal\` / \`reject-proposal\` to act.`;
      }
      return { content: [{ type: "text", text }] };
    })
  );

  // ── list_recent ──────────────────────────────────────────────────────────
  server.registerTool(
    "list_recent",
    {
      description: "list_recent: List the most recent entries by date from your second brain. Use when you need to browse recent entries or find an entry ID. Not the same as recall — returns entries by time, not by meaning.",
      inputSchema: {
        n: z.number().int().min(1).max(50).default(10),
        tag: z.string().optional(),
        after: z.number().int().optional().describe("Only return entries after this Unix ms timestamp"),
        before: z.number().int().optional().describe("Only return entries before this Unix ms timestamp"),
      },
    },
    audited("list_recent", async ({ n, tag, after, before }) => {
      const { sql, bindings } = buildEntryFilterQuery({ n, tag, after, before, userId });
      const { results } = await env.DB.prepare(sql).bind(...bindings).all();

      if (!results.length) {
        return { content: [{ type: "text", text: "No entries found." }] };
      }

      const text = (results as Record<string, any>[]).map((row, i) => {
        const date = new Date(row.created_at as number).toLocaleDateString();
        const tags: string[] = JSON.parse(row.tags ?? "[]");
        const tagStr = tags.length ? ` · ${tags.join(", ")}` : "";
        return `${i + 1}. [${date} · ${row.source}${tagStr}]\nID: ${row.id as string}\n${row.content}`;
      }).join("\n\n");

      return { content: [{ type: "text", text }] };
    })
  );

  // ── forget ───────────────────────────────────────────────────────────────
  server.registerTool(
    "forget",
    {
      description: "Permanently delete an entry from your second brain by ID. Only call when the user explicitly asks to delete something. Confirm the entry ID using recall or list_recent first. This action cannot be undone.",
      inputSchema: {
        id: z.string().describe("Entry ID from recall or list_recent"),
      },
    },
    audited("forget", async ({ id }) => {
      if (userId) {
        const row = await env.DB.prepare(`SELECT owner_user_id FROM entries WHERE id = ?`).bind(id).first() as { owner_user_id: string } | null;
        if (row && row.owner_user_id && row.owner_user_id !== userId && row.owner_user_id !== "") {
          return { content: [{ type: "text", text: `No entry found with ID: ${id}` }] };
        }
      }
      const result = await forgetEntry(id, env);
      if (result.status === "not_found") {
        return { content: [{ type: "text", text: `No entry found with ID: ${id}` }] };
      }
      return { content: [{ type: "text", text: `Deleted entry ${id} and ${result.vectorCount} vector(s)` }] };
    })
  );

  // ── link ─────────────────────────────────────────────────────────────────
  server.registerTool(
    "link",
    {
      description: "Create an explicit relationship link between two memories by ID (e.g. connect a decision to its outcome). Get the IDs from recall or list_recent first.",
      inputSchema: {
        source_id: z.string().describe("Source entry ID"),
        target_id: z.string().describe("Target entry ID"),
        type: z.enum(Object.keys(EDGE_TYPES) as [string, ...string[]]).default("relates_to").describe("Relationship type"),
      },
    },
    audited("link", async ({ source_id, target_id, type }) => {
      if (userId) {
        const ids = [source_id, target_id];
        const rows = await env.DB.prepare(`SELECT id, tags, owner_user_id FROM entries WHERE id IN (?, ?)`).bind(...ids).all() as { results: { id: string; tags: string; owner_user_id: string }[] };
        for (const row of rows.results) {
          const isPrivate = JSON.parse(row.tags ?? "[]").includes("private");
          if (isPrivate && row.owner_user_id !== userId && row.owner_user_id !== "") {
            return { content: [{ type: "text", text: "Cannot link to an entry you don't have access to." }] };
          }
        }
      }
      const edge = await createEdge(source_id, target_id, type, { provenance: "explicit", weight: 1.0 }, env);
      if (!edge) return { content: [{ type: "text", text: "Cannot link an entry to itself." }] };
      return { content: [{ type: "text", text: `Linked ${edge.source_id} → ${edge.target_id} (${edgeLabel(edge.type)}).` }] };
    })
  );

  // ── unlink ───────────────────────────────────────────────────────────────
  server.registerTool(
    "unlink",
    {
      description: "Remove a relationship link between two memories by ID. Use when a link is incorrect or no longer relevant. Get the IDs from recall or connections first.",
      inputSchema: {
        source_id: z.string().describe("Source entry ID"),
        target_id: z.string().describe("Target entry ID"),
        type: z.enum(Object.keys(EDGE_TYPES) as [string, ...string[]]).optional().describe("Only remove this relationship type; omit to remove all links between the pair"),
      },
    },
    audited("unlink", async ({ source_id, target_id, type }) => {
      if (userId) {
        const ids = [source_id, target_id];
        const rows = await env.DB.prepare(`SELECT id, tags, owner_user_id FROM entries WHERE id IN (?, ?)`).bind(...ids).all() as { results: { id: string; tags: string; owner_user_id: string }[] };
        for (const row of rows.results) {
          const isPrivate = JSON.parse(row.tags ?? "[]").includes("private");
          if (isPrivate && row.owner_user_id !== userId && row.owner_user_id !== "") {
            return { content: [{ type: "text", text: "Cannot modify links for an entry you don't own." }] };
          }
        }
      }
      const deleted = await deleteEdge(source_id, target_id, type, env);
      if (!deleted) return { content: [{ type: "text", text: "No link found between those entries." }] };
      return { content: [{ type: "text", text: `Removed ${deleted} link(s) between ${source_id} and ${target_id}.` }] };
    })
  );

  // ── connections ──────────────────────────────────────────────────────────
  server.registerTool(
    "connections",
    {
      description: "List the memories directly linked to a given entry (its 1-hop neighbors in the relationship graph). Get the entry ID from recall or list_recent first.",
      inputSchema: {
        id: z.string().describe("Entry ID from recall or list_recent"),
        type: z.enum(Object.keys(EDGE_TYPES) as [string, ...string[]]).optional().describe("Filter to a single relationship type"),
      },
    },
    audited("connections", async ({ id, type }) => {
      const connections = await getConnections(id, type, env, userId);
      if (!connections.length) {
        return { content: [{ type: "text", text: `No connections found for ${id}.` }] };
      }
      const text = connections
        .map(c => `- (${c.label}) ${c.id}: ${c.content.slice(0, 120)} [confidence: ${(c.confidence * 100).toFixed(0)}%]`)
        .join("\n");
      return { content: [{ type: "text", text }] };
    })
  );

  // ── passages ──────────────────────────────────────────────────────────────
  server.registerTool(
    "passages",
    {
      description: "List evidence passages for an entry. Passages are source text chunks linked to entries for citation-level recall. Get the entry ID from recall or list_recent first.",
      inputSchema: {
        entry_id: z.string().describe("Entry ID from recall or list_recent"),
      },
    },
    audited("passages", async ({ entry_id }) => {
      const { results } = await env.DB.prepare(
        `SELECT id, content, section, start_offset, end_offset, created_at FROM passages WHERE entry_id = ? ORDER BY created_at DESC LIMIT 10`
      ).bind(entry_id).all() as { results: { id: string; content: string; section: string | null; start_offset: number | null; end_offset: number | null; created_at: number }[] };
      if (!results.length) return { content: [{ type: "text", text: `No passages found for entry ${entry_id}.` }] };
      const text = results.map((r, i) => {
        const section = r.section ? ` [${r.section}]` : "";
        const offset = r.start_offset != null ? ` @${r.start_offset}-${r.end_offset}` : "";
        return `${i + 1}. ${section}${offset}\n${r.content.slice(0, 300)}${r.content.length > 300 ? "..." : ""}`;
      }).join("\n\n");
      return { content: [{ type: "text", text: `Passages for ${entry_id}:\n\n${text}` }] };
    })
  );

  // ── restore ──────────────────────────────────────────────────────────────
  server.registerTool(
    "restore",
    {
      description: "Restore a previous version of an entry from its most recent snapshot. Creates a NEW entry with the snapshot content (never in-place rollback) to preserve full history.",
      inputSchema: {
        entry_id: z.string().describe("The ID of the entry to restore from"),
        snapshot_id: z.string().optional().describe("Optional specific snapshot ID; if omitted, restores the most recent snapshot"),
      },
    },
    audited("restore", async ({ entry_id, snapshot_id }) => {
      let snapshot;
      if (snapshot_id) {
        snapshot = await env.DB.prepare(
          `SELECT id, entry_id, content, tags, source, created_at FROM entry_snapshots WHERE id = ? AND entry_id = ?`
        ).bind(snapshot_id, entry_id).first();
      } else {
        snapshot = await env.DB.prepare(
          `SELECT id, entry_id, content, tags, source, created_at FROM entry_snapshots WHERE entry_id = ? ORDER BY created_at DESC LIMIT 1`
        ).bind(entry_id).first();
      }

      if (!snapshot) {
        return { content: [{ type: "text", text: `No snapshot found for entry ${entry_id}.` }] };
      }

      const snapContent = (snapshot.content as string) ?? "";
      const snapTagsRaw = snapshot.tags as string | null;
      let snapTags: string[] = [];
      try { snapTags = snapTagsRaw ? JSON.parse(snapTagsRaw) : []; } catch { snapTags = []; }
      const restoredTags = snapTags.filter((t: string) => !t.startsWith("status:"));
      restoredTags.push("restored");

      const result = await captureEntry(snapContent, restoredTags, (snapshot.source as string) ?? "restore", env, ctx, userId);

      if (result.status === "blocked") {
        return { content: [{ type: "text", text: `Restore blocked — duplicate detected (${(result.score * 100).toFixed(0)}% match). Existing entry ID: ${result.matchId}.` }] };
      }

      return { content: [{ type: "text", text: `Restored. New entry ID: ${result.id} — based on snapshot ${snapshot.id} from ${new Date(snapshot.created_at as number).toISOString()}.` }] };
    })
  );

  // ── propose_edge ──────────────────────────────────────────────────────
  server.registerTool(
    "propose_edge",
    {
      description: "Propose a new relationship between two entries. Creates a pending edge proposal that requires human approval. Use for contradictions, clarifications, or other relationships you're not certain about.",
      inputSchema: {
        source_id: z.string().describe("Source entry ID"),
        target_id: z.string().describe("Target entry ID"),
        type: z.enum(Object.keys(EDGE_TYPES) as [string, ...string[]]).default("contradicts").describe("Relationship type"),
        reason: z.string().optional().describe("Why this link should exist"),
      },
    },
    audited("propose_edge", async ({ source_id, target_id, type, reason }) => {
      const trimmedSource = source_id.trim();
      const trimmedTarget = target_id.trim();
      if (!trimmedSource || !trimmedTarget) return { content: [{ type: "text", text: "source_id and target_id are required." }] };

      // Dedup check
      const existing = await env.DB.prepare(
        `SELECT id, source_id, target_id, type, reason, proposed_by, status, created_at FROM edge_proposals WHERE source_id = ? AND target_id = ? AND type = ? AND status = 'pending'`
      ).bind(trimmedSource, trimmedTarget, type).first() as Record<string, any> | null;

      if (existing) return { content: [{ type: "text", text: `Existing pending proposal found: ${existing.id}. No duplicate created.` }] };

      const proposalId = crypto.randomUUID();
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO edge_proposals (id, source_id, target_id, type, reason, proposed_by, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
      ).bind(proposalId, trimmedSource, trimmedTarget, type, reason ?? "", userId ?? "", now).run();

      return { content: [{ type: "text", text: `Proposal ${proposalId} created: ${trimmedSource} —[${type}]→ ${trimmedTarget}. Reason: ${reason ?? "(none)"}. Awaiting human approval.` }] };
    })
  );

  // ── list-proposals ───────────────────────────────────────────────────
  server.registerTool(
    "list-proposals",
    {
      description: "List pending edge proposals awaiting human approval.",
      inputSchema: {},
    },
    audited("list-proposals", async () => {
      const vis = userId ? buildVisibilityClause(userId) : null;
      let sql = `SELECT id, source_id, target_id, type, reason, proposed_by, status, created_at FROM edge_proposals WHERE status = 'pending'`;
      const bindings: any[] = [];

      if (vis) {
        sql += ` AND EXISTS (SELECT 1 FROM entries e1 WHERE e1.id = edge_proposals.source_id AND ${vis.sql})`;
        sql += ` AND EXISTS (SELECT 1 FROM entries e2 WHERE e2.id = edge_proposals.target_id AND ${vis.sql})`;
        bindings.push(...vis.bind, ...vis.bind);
      }
      sql += ` ORDER BY created_at DESC`;

      const { results } = await env.DB.prepare(sql).bind(...bindings).all();
      if (!results.length) return { content: [{ type: "text", text: "No pending proposals." }] };

      const text = (results as Record<string, any>[]).map(r => {
        const date = new Date(r.created_at as number).toISOString().split("T")[0];
        return `- ${r.id}: ${r.source_id} —[${r.type}]→ ${r.target_id} (by ${r.proposed_by})\n  Reason: ${r.reason || "(none)"} [${date}]`;
      }).join("\n");

      return { content: [{ type: "text", text }] };
    })
  );

  // ── approve-proposal ─────────────────────────────────────────────────
  server.registerTool(
    "approve-proposal",
    {
      description: "Approve a pending edge proposal, creating the relationship edge in the graph. Any authenticated user can approve.",
      inputSchema: {
        proposal_id: z.string().describe("The proposal ID from list-proposals"),
      },
    },
    audited("approve-proposal", async ({ proposal_id }) => {
      const proposal = await env.DB.prepare(
        `SELECT id, source_id, target_id, type, reason, proposed_by, status, created_at FROM edge_proposals WHERE id = ?`
      ).bind(proposal_id).first() as Record<string, any> | null;

      if (!proposal) return { content: [{ type: "text", text: `Proposal not found: ${proposal_id}` }] };
      if (proposal.status !== "pending") return { content: [{ type: "text", text: `Proposal is already ${proposal.status}.` }] };

      const now = Date.now();
      await createEdge(proposal.source_id, proposal.target_id, proposal.type, { provenance: "system", confidence: 1.0 }, env);
      await env.DB.prepare(
        `UPDATE edge_proposals SET status = 'approved', resolved_at = ? WHERE id = ?`
      ).bind(now, proposal_id).run();

      return { content: [{ type: "text", text: `Approved proposal ${proposal_id}: ${proposal.source_id} —[${proposal.type}]→ ${proposal.target_id}. Edge created.` }] };
    })
  );

  // ── reject-proposal ──────────────────────────────────────────────────
  server.registerTool(
    "reject-proposal",
    {
      description: "Reject a pending edge proposal, dismissing it without creating an edge. Any authenticated user can reject.",
      inputSchema: {
        proposal_id: z.string().describe("The proposal ID from list-proposals"),
      },
    },
    audited("reject-proposal", async ({ proposal_id }) => {
      const proposal = await env.DB.prepare(
        `SELECT id, source_id, target_id, type, reason, proposed_by, status, created_at FROM edge_proposals WHERE id = ?`
      ).bind(proposal_id).first() as Record<string, any> | null;

      if (!proposal) return { content: [{ type: "text", text: `Proposal not found: ${proposal_id}` }] };
      if (proposal.status !== "pending") return { content: [{ type: "text", text: `Proposal is already ${proposal.status}.` }] };

      const now = Date.now();
      await env.DB.prepare(
        `UPDATE edge_proposals SET status = 'rejected', resolved_at = ? WHERE id = ?`
      ).bind(now, proposal_id).run();

      return { content: [{ type: "text", text: `Rejected proposal ${proposal_id}: ${proposal.source_id} —[${proposal.type}]→ ${proposal.target_id}.` }] };
    })
  );

  return server;
}

// ─── MCP tools/list sanitization ──────────────────────────────────────────────
// Newer @modelcontextprotocol/sdk releases attach an `execution` (task-support)
// field to each tool definition in tools/list responses. Strict MCP clients —
// OpenAI Codex at the time of writing — reject the entire tool list when they
// see the unknown field, which breaks the connection outright. Strip it so any
// client can connect; the server doesn't use MCP task execution, so nothing is
// lost. Remove this shim if we ever adopt task execution or once strict clients
// tolerate unknown fields.
//
// Bug discovered, and fix originally authored, in the
// guoyingwei6/second-brain-cloudflare fork (commit a3fa15f).

export async function isMcpToolsListRequest(request: Request): Promise<boolean> {
  if (request.method !== "POST") return false;
  try {
    const payload = await request.clone().json();
    return isRecord(payload) && payload.method === "tools/list";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function removeToolExecutionMetadata(payload: unknown): unknown {
  if (!isRecord(payload) || !isRecord(payload.result) || !Array.isArray(payload.result.tools)) {
    return payload;
  }

  const tools = payload.result.tools.map(tool => {
    if (!isRecord(tool) || !("execution" in tool)) return tool;
    const { execution: _execution, ...toolWithoutExecution } = tool;
    return toolWithoutExecution;
  });

  return {
    ...payload,
    result: {
      ...payload.result,
      tools,
    },
  };
}

export async function sanitizeToolsListResponse(response: Response): Promise<Response> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json") && !contentType.includes("text/event-stream")) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");

  if (contentType.includes("text/event-stream")) {
    const body = await response.text();
    const sanitized = body.split("\n").map(line => {
      if (!line.startsWith("data: ")) return line;
      try {
        return `data: ${JSON.stringify(removeToolExecutionMetadata(JSON.parse(line.slice(6))))}`;
      } catch {
        return line;
      }
    }).join("\n");

    return new Response(sanitized, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  try {
    const payload = await response.json();
    return new Response(JSON.stringify(removeToolExecutionMetadata(payload)), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return response;
  }
}
