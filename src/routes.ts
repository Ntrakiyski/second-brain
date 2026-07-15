/**
 * routes.ts — REST route handlers for all non-MCP endpoints.
 *
 * Purpose: Handle every HTTP route the Worker serves outside of the MCP
 *   protocol — user management, memory CRUD (capture/append/update/forget),
 *   semantic recall, graph traversal, integration sync, compression, and
 *   classification backfill.
 * Input:   Incoming Request, Cloudflare Env bindings (D1, Vectorize, AI, KV),
 *   and the execution context for background work (ctx.waitUntil).
 * Output:  JSON Response objects (or SSE stream for /chat) following a
 *   consistent { ok, ... } envelope.
 * Logic:   URL pathname matching with an if/else chain — each block guards on
 *   method + path, authenticates via requireAuthAsync, validates input, calls
 *   domain functions from the respective modules, and returns a JSON response.
 */

import { type Env } from "./types";
import { loginHtml, hmacKey, generateApiKey, AUTH_PEPPER, requireAuthAsync, isAuthorized, json } from "./auth";
import { CORS_HEADERS, graceMs, LLM_MODEL, COMPRESSION_MIN_AGE_MS, compressionEligibilitySql, VECTORIZE_FIX_HINT } from "./config";
import { initializeDatabase, checkVectorizeHealth, getDbReady, setDbReady } from "./db";
import { buildVisibilityClause, buildEntryFilterQuery, getStatus, withStatus, withKind } from "./tags";
import { EDGE_TYPES, isValidEdgeType, createEdge, deleteEdge, getConnections, buildGraph } from "./graph";
import { captureEntry, storeEntry, appendToEntry, deleteStaleVectors, reindexAllVectors, createSnapshot } from "./ingest";
import { recallEntries } from "./recall";
import { forgetEntry, deprecateEntry, applyStatus, compressTag } from "./lifecycle";
import { classifyEntry, extractHashtags } from "./classification";
import { escapeLikePattern } from "./helpers";
import { INTEGRATION_PROVIDERS, getProvider, loadIntegration, saveIntegration, deleteIntegration, integrationStatus } from "./integrations";
import type { IntegrationRecord } from "./integrations";
import { makeMirrorStore, isManagedMirror, mirrorEditError } from "./integrations-mirror";
import { KIND_VALUES, STATUS_VALUES, EPISTEMIC_STATUS_VALUES, type MemoryKind, type MemoryStatus, type EpistemicStatus, isValidTransition, VALID_EPISTEMIC_TRANSITIONS } from "./types";

// ─── Default handler — all non-MCP routes ────────────────────────────────────

export const defaultHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // OAuth authorize endpoint — hosted login page for browser-based MCP clients.
    if (url.pathname === "/oauth/authorize") {
      let oauthReq: any;
      try {
        // workers-oauth-provider mis-parses POST bodies; pass a URL-only GET clone
        // so parseAuthRequest reads the query params cleanly.
        const parseReq = request.method === "POST" ? new Request(request.url, { method: "GET" }) : request;
        oauthReq = await (env as any).OAUTH_PROVIDER.parseAuthRequest(parseReq);
      } catch {
        return new Response("Invalid authorization request — this page must be opened by an MCP client.", {
          status: 400, headers: { "Content-Type": "text/plain" },
        });
      }
      if (request.method === "POST") {
        const form = await request.formData();
        if (form.get("password") !== env.AUTH_TOKEN) {
          return new Response(loginHtml("Invalid token"), {
            status: 401, headers: { "Content-Type": "text/html" },
          });
        }
        const { redirectTo } = await (env as any).OAUTH_PROVIDER.completeAuthorization({
          request: oauthReq,
          userId: "owner",
          scope: oauthReq.scope,
          props: { userId: "owner" },
        });
        return Response.redirect(redirectTo, 302);
      }
      return new Response(loginHtml(), { headers: { "Content-Type": "text/html" } });
    }

    if (!getDbReady()) {
      ctx.waitUntil(
        initializeDatabase(env).then(() => { setDbReady(true); })
      );
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // POST /api/users — create a new user (requires deployment token)
    if (url.pathname === "/api/users" && request.method === "POST") {
      if (!isAuthorized(request, env)) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }

      let body: { username?: string };
      try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
      if (!body.username?.trim()) return json({ ok: false, error: "username is required" }, 400);

      const username = body.username.trim();
      if (username.length > 32) return json({ ok: false, error: "username must be 32 characters or less" }, 400);
      if (!/^[a-zA-Z0-9_]+$/.test(username)) return json({ ok: false, error: "username must be alphanumeric (underscores allowed)" }, 400);
      const normalized = username.toLowerCase();
      const { publicId, secret, fullKey } = generateApiKey();
      const keyHash = await hmacKey(secret, AUTH_PEPPER);

      try {
        await (env.DB as any).prepare(
          "INSERT INTO users (id, username, normalized_username, auth_key_hash, auth_key_prefix, status, created_at) VALUES (?, ?, ?, ?, ?, 'active', ?)"
        ).bind(
          publicId, username, normalized, keyHash, fullKey.slice(0, 15), Date.now()
        ).run();
      } catch (e: any) {
        if (String(e?.message ?? e).includes("UNIQUE constraint")) {
          return json({ ok: false, error: `Username '${username}' already exists` }, 409);
        }
        throw e;
      }

      return json({ ok: true, username, key: fullKey }, 201);
    }

    // GET /api/users — list active users (requires deployment token)
    if (url.pathname === "/api/users" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }

      const { results } = await (env.DB as any).prepare(
        "SELECT id, username, status FROM users WHERE status = 'active' ORDER BY username"
      ).all();
      return json({ users: results ?? [] });
    }

    // POST /api/users/:id/deactivate — deactivate a user
    {
      const deactivateMatch = url.pathname.match(/^\/api\/users\/([^/]+)\/deactivate$/);
      if (deactivateMatch && request.method === "POST") {
        const { error: authErr, user_id } = await requireAuthAsync(request, env);
        if (authErr) return authErr;

        const targetId = deactivateMatch[1];

        // Check if target user exists
        const targetRow = await (env.DB as any).prepare(
          "SELECT id, username, status FROM users WHERE id = ?"
        ).bind(targetId).first() as { id: string; username: string; status: string } | null;
        if (!targetRow) return json({ ok: false, error: "User not found" }, 404);
        if (targetRow.status === "inactive") return json({ ok: false, error: "User is already inactive" }, 400);

        // Authorization: self-deactivation OR first-created active user (owner)
        if (targetId !== user_id) {
          const { results: allUsers } = await (env.DB as any).prepare(
            "SELECT id FROM users WHERE status = 'active' ORDER BY created_at ASC LIMIT 1"
          ).all() as { results: { id: string }[] };
          if (!allUsers.length || allUsers[0].id !== user_id) {
            return json({ ok: false, error: "Only the deployment owner can deactivate other users" }, 403);
          }
        } else {
          // Self-deactivation by owner: prevent if they're the only active user
          const { results: allUsers } = await (env.DB as any).prepare(
            "SELECT id FROM users WHERE status = 'active' ORDER BY created_at ASC"
          ).all() as { results: { id: string }[] };
          if (allUsers.length <= 1 && allUsers[0]?.id === user_id) {
            return json({ ok: false, error: "Cannot deactivate — you are the only active user" }, 400);
          }
        }

        // Set status to inactive
        await (env.DB as any).prepare(
          "UPDATE users SET status = 'inactive' WHERE id = ?"
        ).bind(targetId).run();

        // Delete private memories
        const { results: privateEntries } = await (env.DB as any).prepare(
          `SELECT id, vector_ids FROM entries WHERE owner_user_id = ? AND tags LIKE ?`
        ).bind(targetId, '%"private"%').all() as { results: { id: string; vector_ids: string }[] };

        if (privateEntries.length) {
          const ids = privateEntries.map(e => e.id);
          const placeholders = ids.map(() => "?").join(", ");

          // Delete edges referencing these entries
          try {
            for (const id of ids) {
              await (env.DB as any).prepare(
                `DELETE FROM edges WHERE source_id = ? OR target_id = ?`
              ).bind(id, id).run();
            }
          } catch (e) { console.error("Edge cascade-delete failed (non-fatal):", e); }

          // Delete entries
          await (env.DB as any).prepare(
            `DELETE FROM entries WHERE owner_user_id = ? AND tags LIKE ?`
          ).bind(targetId, '%"private"%').run();

          // Delete vectors
          try {
            const allVectorIds = privateEntries.flatMap(e => JSON.parse(e.vector_ids ?? "[]") as string[]);
            if (allVectorIds.length) await env.VECTORIZE.deleteByIds(allVectorIds);
          } catch (e) { console.error("Vectorize delete failed (non-fatal):", e); }
        }

        return json({ ok: true, message: `User ${targetRow.username} deactivated` });
      }
    }

    // POST /capture
    if (url.pathname === "/capture" && request.method === "POST") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;

      let body: { content?: string; tags?: string[]; source?: string };
      try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
      if (!body.content?.trim()) return json({ ok: false, error: "content is required" }, 400);

      const result = await captureEntry(body.content, body.tags ?? [], body.source ?? "api", env, ctx, user_id);

      if (result.status === "blocked") {
        return json({
          ok: false,
          duplicate: true,
          matchId: result.matchId,
          score: parseFloat((result.score * 100).toFixed(1)),
          message: "Near-exact duplicate detected — not stored",
        });
      }
      if (result.status === "contradiction") {
        return json({ ok: true, id: result.id, resolved_conflict: result.resolvedConflict, reason: result.reason });
      }
      if (result.status === "contradiction_protected") {
        return json({ ok: true, id: result.id, status: "draft", kept_canonical: result.canonicalId, reason: result.reason });
      }
      if (result.status === "replaced") {
        return json({ ok: true, id: result.id, action: "replaced", message: "New memory replaced an outdated existing entry" });
      }
      if (result.status === "merged") {
        return json({ ok: true, id: result.id, action: "merged", message: "Memories merged into a single combined entry" });
      }
      if (result.status === "flagged") {
        return json({
          ok: true,
          id: result.id,
          warning: "similar",
          matchId: result.matchId,
          score: parseFloat((result.score * 100).toFixed(1)),
          message: "Stored but similar entry exists — tagged as duplicate-candidate",
          ...(result.crossUserNote ? { crossUserNote: result.crossUserNote } : {}),
        });
      }
      return json({ ok: true, id: result.id, ...(result.crossUserNote ? { crossUserNote: result.crossUserNote } : {}) });
    }

    // POST /append
    if (url.pathname === "/append" && request.method === "POST") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;

      let body: { id?: string; addition?: string };
      try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
      if (!body.id?.trim()) return json({ ok: false, error: "id is required" }, 400);
      if (!body.addition?.trim()) return json({ ok: false, error: "addition is required" }, 400);

      const id = body.id.trim();
      const addition = body.addition.trim();

      const row = await env.DB.prepare(
        `SELECT id, content, tags, source, owner_user_id FROM entries WHERE id = ?`
      ).bind(id).first() as Record<string, any> | null;

      if (!row) {
        return json({ ok: false, error: `No entry found with ID: ${id}` }, 404);
      }

      const existingContent = row.content as string;
      const tags: string[] = JSON.parse(row.tags ?? "[]");
      const source = row.source as string;
      const existingOwnerId = row.owner_user_id as string;

      if (existingOwnerId && existingOwnerId !== user_id && existingOwnerId !== "") {
        return json({ ok: false, error: `No entry found with ID: ${id}` }, 404);
      }

      if (await isManagedMirror(source, env)) {
        return json({ ok: false, error: mirrorEditError(source) }, 409);
      }

      try {
        await appendToEntry(env, id, existingContent, addition, tags, source, existingOwnerId || user_id, ctx);
      } catch (e) {
        return json({ ok: false, error: `Append failed: ${(e as Error).message}` }, 500);
      }

      return json({
        ok: true,
        id,
        message: "Update appended successfully with timestamp",
      });
    }

    // POST /update
    if (url.pathname === "/update" && request.method === "POST") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;

      let body: { id?: string; content?: string };
      try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
      if (!body.id?.trim()) return json({ ok: false, error: "id is required" }, 400);
      if (!body.content?.trim()) return json({ ok: false, error: "content is required" }, 400);

      const id = body.id.trim();
      const newContent = body.content.trim();

      const row = await env.DB.prepare(
        `SELECT tags, source, vector_ids, owner_user_id FROM entries WHERE id = ?`
      ).bind(id).first() as Record<string, any> | null;

      if (!row) return json({ ok: false, error: `No entry found with ID: ${id}` }, 404);

      if (row.owner_user_id && row.owner_user_id !== user_id && row.owner_user_id !== "") {
        return json({ ok: false, error: `No entry found with ID: ${id}` }, 404);
      }

      if (await isManagedMirror(row.source as string, env)) {
        return json({ ok: false, error: mirrorEditError(row.source as string) }, 409);
      }

      const tags: string[] = JSON.parse(row.tags ?? "[]");
      const { cleanContent, hashtags: newHashtags } = extractHashtags(newContent);
      const mergedTags = [...new Set([...tags, ...newHashtags])];
      const source = row.source as string;
      const oldVectorIds: string[] = JSON.parse(row.vector_ids ?? "[]");
      const existingOwnerId = row.owner_user_id as string;
      const finalContent = cleanContent || newContent;

      // Snapshot: backup before destructive update — fire-and-forget (non-fatal)
      ctx.waitUntil(createSnapshot(env, id).catch(e => console.error("Snapshot creation failed (non-fatal):", e)));

      await env.DB.prepare(`UPDATE entries SET content = ?, tags = ? WHERE id = ?`)
        .bind(finalContent, JSON.stringify(mergedTags), id).run();

      let newVectorIds: string[] = [];
      try {
        newVectorIds = await storeEntry(env, id, finalContent, mergedTags, source, Date.now(), existingOwnerId || user_id, mergedTags.includes("private"));
      } catch (e) {
        console.error("Vectorize re-embed failed (non-fatal):", e);
      }
      const newVectorCount = newVectorIds.length;

      try {
        await deleteStaleVectors(env, oldVectorIds, newVectorIds);
      } catch (e) {
        console.error("Old vector cleanup failed (non-fatal):", e);
      }

      return json({ ok: true, id, vectors: newVectorCount });
    }

    // GET /count
    if (url.pathname === "/count" && request.method === "GET") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;
      const visClause = buildVisibilityClause(user_id ?? "");
      const row = await env.DB.prepare(
        `SELECT COUNT(*) as count FROM entries WHERE ${visClause.sql}`
      ).bind(...visClause.bind).first() as Record<string, any> | null;
      return json({ count: (row?.count as number) ?? 0 });
    }

    // GET /tags
    if (url.pathname === "/tags" && request.method === "GET") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;
      const visClause = buildVisibilityClause(user_id ?? "");
      const { results } = await env.DB.prepare(
        `SELECT DISTINCT value FROM entries, json_each(entries.tags) WHERE ${visClause.sql} ORDER BY value`
      ).bind(...visClause.bind).all();
      return json((results as any[]).map(r => r.value as string));
    }

    // GET /stats
    if (url.pathname === "/stats" && request.method === "GET") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;
      const graceCutoff = Date.now() - graceMs(env);
      const visClause = buildVisibilityClause(user_id ?? "");
      const [summary, tagRows, candidateRows] = await Promise.all([
        env.DB.prepare(
          `SELECT COUNT(*) as count, AVG(importance_score) as avg_importance,
           SUM(CASE WHEN vector_ids = '[]' AND created_at < ? THEN 1 ELSE 0 END) as unvectorized,
           SUM(CASE WHEN tags NOT LIKE '%"status:%' AND tags NOT LIKE '%"kind:%' THEN 1 ELSE 0 END) as unclassified
           FROM entries WHERE ${visClause.sql}`
        ).bind(graceCutoff, ...visClause.bind).first() as Promise<Record<string, any> | null>,
        env.DB.prepare(`SELECT value, COUNT(*) as n FROM entries, json_each(entries.tags) WHERE ${visClause.sql} GROUP BY value ORDER BY n DESC LIMIT 5`).bind(...visClause.bind).all(),
        env.DB.prepare(`
          SELECT value as tag, COUNT(*) as count
          FROM entries, json_each(entries.tags)
          WHERE value NOT IN ('synthesized', 'auto-pattern', 'duplicate-candidate', 'contradiction-resolved', 'rolled-up')
            AND value NOT LIKE 'status:%'
            AND value NOT LIKE 'kind:%'
            AND entries.tags NOT LIKE '%"rolled-up"%'
            AND entries.tags NOT LIKE '%"synthesized"%'
            AND entries.tags NOT LIKE '%"auto-pattern"%'
            AND ${compressionEligibilitySql("entries.")}
            AND ${visClause.sql}
          GROUP BY value
          HAVING count > 10
          ORDER BY count DESC
          LIMIT 10
        `).bind(Date.now() - COMPRESSION_MIN_AGE_MS, ...visClause.bind).all(),
      ]);

      const cutoff = Date.now() - 86400000;
      const digestCandidates: { tag: string; count: number }[] = [];
      for (const row of candidateRows.results as any[]) {
        const existing = await env.DB.prepare(
          `SELECT id FROM entries WHERE tags LIKE '%"synthesized"%' AND tags LIKE ? AND created_at > ? LIMIT 1`
        ).bind(`%"${escapeLikePattern(row.tag as string)}"%`, cutoff).first();
        if (!existing) digestCandidates.push({ tag: row.tag as string, count: row.count as number });
      }

      return json({
        count: (summary?.count as number) ?? 0,
        avg_importance: summary?.avg_importance != null ? Math.round((summary.avg_importance as number) * 10) / 10 : null,
        top_tags: (tagRows.results as any[]).map(r => r.value as string),
        digest_candidates: digestCandidates,
        unvectorized: (summary?.unvectorized as number) ?? 0,
        vectorize_grace_ms: graceMs(env),
        unclassified: (summary?.unclassified as number) ?? 0,
      });
    }

    // GET /health — index/runtime health, used by the dashboard banner, the
    // README verify step, and external uptime checks.
    if (url.pathname === "/health" && request.method === "GET") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;
      const vectorize = await checkVectorizeHealth(env);
      return json({ ok: vectorize.ok, vectorize });
    }

    // GET /list
    if (url.pathname === "/list" && request.method === "GET") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;
      const n = Math.min(parseInt(url.searchParams.get("n") ?? "20", 10), 100);
      const tag = url.searchParams.get("tag")?.trim() || undefined;
      const after = url.searchParams.has("after") ? parseInt(url.searchParams.get("after")!, 10) : undefined;
      const before = url.searchParams.has("before") ? parseInt(url.searchParams.get("before")!, 10) : undefined;
      const user = url.searchParams.get("user")?.trim() || undefined;
      const visibility = url.searchParams.get("visibility")?.trim() || undefined;

      const { sql, bindings } = buildEntryFilterQuery({ n, tag, after, before, userId: user_id, user, visibility });
      const { results } = await env.DB.prepare(sql).bind(...bindings).all();

      // Hydrate owner usernames
      const ownerIds = [...new Set((results as any[]).map(r => r.owner_user_id).filter(Boolean))];
      let ownerMap: Record<string, string> = {};
      if (ownerIds.length) {
        const placeholders = ownerIds.map(() => '?').join(',');
        const { results: owners } = await env.DB.prepare(
          `SELECT id, username FROM users WHERE id IN (${placeholders})`
        ).bind(...ownerIds).all() as { results: { id: string; username: string }[] };
        ownerMap = Object.fromEntries(owners.map(o => [o.id, o.username]));
      }

      const enriched = (results as any[]).map(r => ({
        ...r,
        owner_username: ownerMap[r.owner_user_id] || '',
        is_private: (JSON.parse(r.tags ?? "[]") as string[]).includes("private"),
      }));
      return json(enriched);
    }

    // GET /team-activity — recent public entries from all team members
    if (url.pathname === "/team-activity" && request.method === "GET") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;

      const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "20", 10), 1), 50);
      const userFilter = url.searchParams.get("user")?.trim();
      const after = url.searchParams.has("after") ? parseInt(url.searchParams.get("after")!, 10) : undefined;

      let sql = `SELECT e.id, e.content, e.tags, e.source, e.created_at, e.owner_user_id, u.username as owner_username
        FROM entries e LEFT JOIN users u ON e.owner_user_id = u.id
        WHERE e.tags NOT LIKE '%"private"%'`;
      const bindings: any[] = [];

      if (userFilter) {
        sql += ` AND e.owner_user_id = (SELECT id FROM users WHERE username = ?)`;
        bindings.push(userFilter);
      }
      if (after !== undefined) {
        sql += ` AND e.created_at <= ?`;
        bindings.push(after);
      }
      sql += ` ORDER BY e.created_at DESC LIMIT ?`;
      bindings.push(limit);

      const { results } = await env.DB.prepare(sql).bind(...bindings).all();
      return json({ ok: true, entries: results ?? [] });
    }

    // ─── Edge Proposals (Pillar 2) ──────────────────────────────────────────

    // POST /edge-proposals — create a new proposal
    if (url.pathname === "/edge-proposals" && request.method === "POST") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;

      let body: { source_id?: string; target_id?: string; type?: string; reason?: string };
      try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
      if (!body.source_id?.trim() || !body.target_id?.trim()) return json({ ok: false, error: "source_id and target_id are required" }, 400);
      const type = body.type?.trim() || "contradicts";
      if (!isValidEdgeType(type)) return json({ ok: false, error: `type must be one of: ${Object.keys(EDGE_TYPES).join(", ")}` }, 400);

      const sourceId = body.source_id.trim();
      const targetId = body.target_id.trim();
      const reason = body.reason?.trim() || "";

      // Dedup: check for existing pending proposal for same (source_id, target_id, type)
      const existing = await env.DB.prepare(
        `SELECT id, source_id, target_id, type, reason, proposed_by, status, created_at FROM edge_proposals WHERE source_id = ? AND target_id = ? AND type = ? AND status = 'pending'`
      ).bind(sourceId, targetId, type).first() as Record<string, any> | null;

      if (existing) {
        return json({ ok: true, proposal: existing });
      }

      const proposalId = crypto.randomUUID();
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO edge_proposals (id, source_id, target_id, type, reason, proposed_by, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
      ).bind(proposalId, sourceId, targetId, type, reason, user_id ?? "", now).run();

      return json({
        ok: true,
        proposal: { id: proposalId, source_id: sourceId, target_id: targetId, type, reason, proposed_by: user_id ?? "", status: "pending", created_at: now },
      });
    }

    // GET /edge-proposals — list pending proposals (visibility-scoped)
    if (url.pathname === "/edge-proposals" && request.method === "GET") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;

      const vis = user_id ? buildVisibilityClause(user_id) : null;
      let sql = `SELECT ep.id, ep.source_id, ep.target_id, ep.type, ep.reason, ep.proposed_by, ep.status, ep.created_at
        FROM edge_proposals ep WHERE ep.status = 'pending'`;
      const bindings: any[] = [];

      if (vis) {
        sql += ` AND EXISTS (SELECT 1 FROM entries e1 WHERE e1.id = ep.source_id AND ${vis.sql})`;
        sql += ` AND EXISTS (SELECT 1 FROM entries e2 WHERE e2.id = ep.target_id AND ${vis.sql})`;
        bindings.push(...vis.bind, ...vis.bind);
      }
      sql += ` ORDER BY ep.created_at DESC`;

      const { results } = await env.DB.prepare(sql).bind(...bindings).all();
      return json({ ok: true, proposals: results ?? [] });
    }

    // POST /edge-proposals/:id/approve or /reject
    {
      const proposalActionMatch = url.pathname.match(/^\/edge-proposals\/([^/]+)\/(approve|reject)$/);
      if (proposalActionMatch && request.method === "POST") {
        const { error: authErr, user_id } = await requireAuthAsync(request, env);
        if (authErr) return authErr;

        const proposalId = proposalActionMatch[1];
        const action = proposalActionMatch[2];

        const proposal = await env.DB.prepare(
          `SELECT id, source_id, target_id, type, reason, proposed_by, status, created_at FROM edge_proposals WHERE id = ?`
        ).bind(proposalId).first() as Record<string, any> | null;

        if (!proposal) return json({ ok: false, error: "Proposal not found" }, 404);
        if (proposal.status !== "pending") return json({ ok: false, error: `Proposal is already ${proposal.status}` }, 400);

        const now = Date.now();
        if (action === "approve") {
          // Create the actual edge
          await createEdge(proposal.source_id, proposal.target_id, proposal.type, { provenance: "system", confidence: 1.0 }, env);
          await env.DB.prepare(
            `UPDATE edge_proposals SET status = 'approved', resolved_at = ? WHERE id = ?`
          ).bind(now, proposalId).run();
        } else {
          await env.DB.prepare(
            `UPDATE edge_proposals SET status = 'rejected', resolved_at = ? WHERE id = ?`
          ).bind(now, proposalId).run();
        }

        return json({
          ok: true,
          proposal: { ...proposal, status: action === "approve" ? "approved" : "rejected", resolved_at: now },
        });
      }
    }

    // GET /export — complete backup: every entry plus the edges table. Single
    // unbounded SELECTs are acceptable here: D1 handles tens of thousands of rows in
    // one read and this route runs on explicit user action only. If response size
    // ever becomes a problem, add ?after= cursor support then, not now.
    if (url.pathname === "/export" && request.method === "GET") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;

      const VALID_MODES = ["my_public", "all_public", "my_private"] as const;
      type ExportMode = typeof VALID_MODES[number];
      const mode = url.searchParams.get("mode") as ExportMode | null;
      if (mode && !VALID_MODES.includes(mode)) {
        return json({ ok: false, error: `Invalid mode. Valid modes: ${VALID_MODES.join(", ")}` }, 400);
      }

      let entrySql = `SELECT id, content, tags, source, created_at, recall_count, importance_score, contradiction_wins, contradiction_losses FROM entries`;
      const bindings: any[] = [];

      if (mode === "my_public") {
        entrySql += ` WHERE owner_user_id = ? AND tags NOT LIKE ?`;
        bindings.push(user_id, '%"private"%');
      } else if (mode === "my_private") {
        entrySql += ` WHERE owner_user_id = ? AND tags LIKE ?`;
        bindings.push(user_id, '%"private"%');
      } else {
        // Default / all_public: exclude private entries
        entrySql += ` WHERE tags NOT LIKE ?`;
        bindings.push('%"private"%');
      }
      entrySql += ` ORDER BY created_at DESC`;

      const { results: entryRows } = await env.DB.prepare(entrySql).bind(...bindings).all() as { results: Record<string, any>[] };

      // Filter edges to only include those where both endpoints are in the exported set
      const entryIds = new Set(entryRows.map(r => r.id as string));
      const { results: edgeRows } = await env.DB.prepare(
        `SELECT source_id, target_id, type, weight, provenance, created_at, confidence FROM edges`
      ).all() as { results: Record<string, any>[] };

      const edges = edgeRows
        .filter(r => entryIds.has(r.source_id) && entryIds.has(r.target_id))
        .map(r => ({
          source_id: r.source_id,
          target_id: r.target_id,
          type: r.type,
          weight: r.weight,
          confidence: r.confidence ?? 1.0,
          provenance: r.provenance,
          created_at: r.created_at,
        }));

      // vector_ids are deliberately excluded — they're deployment-specific and an
      // import tool re-embeds anyway. Tags are parsed so the file holds real arrays.
      const entries = entryRows.map(r => ({
        id: r.id,
        content: r.content,
        tags: JSON.parse(r.tags ?? "[]"),
        source: r.source,
        created_at: r.created_at,
        recall_count: r.recall_count ?? 0,
        importance_score: r.importance_score ?? 0,
        contradiction_wins: r.contradiction_wins ?? 0,
        contradiction_losses: r.contradiction_losses ?? 0,
      }));
      return json({ ok: true, exported_at: Date.now(), version: 2, mode: mode ?? "all_public", total_count: entries.length, entries, edges });
    }

    // GET /recall — semantic search, mirrors the MCP `recall` tool
    if (url.pathname === "/recall" && request.method === "GET") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;

      const query = url.searchParams.get("query")?.trim();
      if (!query) return json({ ok: false, error: "query is required" }, 400);

      const topK = Math.min(Math.max(parseInt(url.searchParams.get("topK") ?? "5", 10), 1), 20);
      const tag = url.searchParams.get("tag")?.trim() || undefined;
      const after = url.searchParams.has("after") ? parseInt(url.searchParams.get("after")!, 10) : undefined;
      const before = url.searchParams.has("before") ? parseInt(url.searchParams.get("before")!, 10) : undefined;
      const kindParam = url.searchParams.get("kind")?.trim();
      const kind = kindParam && (KIND_VALUES as readonly string[]).includes(kindParam) ? kindParam as MemoryKind : undefined;
      const hops = Math.min(Math.max(parseInt(url.searchParams.get("hops") ?? "0", 10), 0), 3);
      const asOf = url.searchParams.has("as_of") ? parseInt(url.searchParams.get("as_of")!, 10) : undefined;

      const { matches, insight, semanticUnavailable, proposed_edges } = await recallEntries({ query, topK, tag, after, before, kind, hops, userId: user_id, asOf }, env, ctx);

      if (!matches.length) {
        return json({
          ok: true,
          results: [],
          semantic_unavailable: semanticUnavailable,
          proposed_edges,
          message: semanticUnavailable
            ? `Semantic search unavailable (Vectorize index missing). Fix: ${VECTORIZE_FIX_HINT}.`
            : "Nothing found matching that query.",
        });
      }

      return json({
        ok: true,
        results: matches.map(m => ({
          id: m.id,
          content: m.content,
          score: parseFloat((m.score * 100).toFixed(1)),
          tags: m.tags,
          source: m.source,
          created_at: m.createdAt,
          updated: m.isUpdate,
          hop: m.hop,
          epistemic_status: m.epistemicStatus,
          ...(m.passages?.length ? { passages: m.passages } : {}),
          ...(m.relations?.length ? { relations: m.relations } : {}),
          ...(m.crossUserMention ? { crossUserMention: { owner_username: m.crossUserMention.ownerUsername, similarity: parseFloat((m.crossUserMention.similarity * 100).toFixed(1)) } } : {}),
        })),
        insight: insight || null,
        semantic_unavailable: semanticUnavailable,
        proposed_edges,
      });
    }

    // GET /entries/:id/hierarchy — document hierarchy for an entry (Ticket 08)
    if (url.pathname.startsWith("/entries/") && url.pathname.endsWith("/hierarchy") && request.method === "GET") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;
      const entryId = url.pathname.split("/")[2];

      const entry = await env.DB.prepare(`SELECT id FROM entries WHERE id = ?`).bind(entryId).first() as { id: string } | null;
      if (!entry) return json({ ok: false, error: "Entry not found" }, 404);

      // Find the episode linked to this entry
      const episode = await env.DB.prepare(`SELECT id FROM episodes WHERE entry_id = ? LIMIT 1`).bind(entryId).first() as { id: string } | null;
      if (!episode) return json({ ok: true, hierarchy: null });

      // Find passages linked to this entry
      const { results: passages } = await env.DB.prepare(
        `SELECT id, section, start_offset, end_offset FROM passages WHERE entry_id = ? ORDER BY start_offset`
      ).bind(entryId).all() as { results: { id: string; section: string | null; start_offset: number | null; end_offset: number | null }[] };

      // Find document sections if any — link via passage section names matching document section titles
      const sectionNames = [...new Set(passages.map((p: any) => p.section).filter(Boolean))];
      let sections: { id: string; title: string; level: number; order_index: number; parent_section_id: string | null }[] = [];
      if (sectionNames.length) {
        const namePlaceholders = sectionNames.map(() => "?").join(", ");
        const { results: secRows } = await env.DB.prepare(
          `SELECT ds.id, ds.title, ds.level, ds.order_index, ds.parent_section_id
           FROM document_sections ds
           WHERE ds.title IN (${namePlaceholders})
           ORDER BY ds.order_index`
        ).bind(...sectionNames).all().catch(() => ({ results: [] as any[] }));
        sections = secRows as any[];
      }

      return json({ ok: true, entry_id: entryId, episode_id: episode.id, passages, sections });
    }

    // POST /forget — delete-by-id, mirrors the MCP `forget` tool
    if (url.pathname === "/forget" && request.method === "POST") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;

      let body: { id?: string };
      try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
      if (!body.id?.trim()) return json({ ok: false, error: "id is required" }, 400);

      const id = body.id.trim();

      // Ownership check: only allow forgetting entries owned by the requesting user
      // Pre-migration entries (empty owner_user_id) are treated as system-owned
      const entry = await env.DB.prepare(
        `SELECT owner_user_id FROM entries WHERE id = ?`
      ).bind(id).first() as Record<string, any> | null;
      if (!entry) return json({ ok: false, error: `No entry found with ID: ${id}` }, 404);
      const entryOwnerId = entry.owner_user_id as string;
      if (entryOwnerId && entryOwnerId !== user_id) {
        return json({ ok: false, error: "Forbidden" }, 403);
      }

      const result = await forgetEntry(id, env);

      if (result.status === "not_found") {
        return json({ ok: false, error: `No entry found with ID: ${id}` }, 404);
      }

      return json({ ok: true, id, deletedVectors: result.vectorCount });
    }

    // POST /restore — restore an entry from a snapshot, creates a NEW entry
    if (url.pathname === "/restore" && request.method === "POST") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;

      let body: { entry_id?: string; snapshot_id?: string };
      try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
      if (!body.entry_id?.trim()) return json({ ok: false, error: "entry_id is required" }, 400);

      const entryId = body.entry_id.trim();
      const snapshotId = body.snapshot_id?.trim();

      // Fetch snapshot
      let snapshot;
      if (snapshotId) {
        snapshot = await env.DB.prepare(
          `SELECT id, entry_id, content, tags, source, created_at FROM entry_snapshots WHERE id = ? AND entry_id = ?`
        ).bind(snapshotId, entryId).first();
      } else {
        snapshot = await env.DB.prepare(
          `SELECT id, entry_id, content, tags, source, created_at FROM entry_snapshots WHERE entry_id = ? ORDER BY created_at DESC LIMIT 1`
        ).bind(entryId).first();
      }

      if (!snapshot) return json({ ok: false, error: `No snapshot found for entry ${entryId}` }, 404);

      const snapContent = (snapshot.content as string) ?? "";
      const snapTagsRaw = snapshot.tags as string | null;
      let snapTags: string[] = [];
      try { snapTags = snapTagsRaw ? JSON.parse(snapTagsRaw) : []; } catch { snapTags = []; }
      const restoredTags = snapTags.filter((t: string) => !t.startsWith("status:"));
      restoredTags.push("restored");

      const result = await captureEntry(snapContent, restoredTags, (snapshot.source as string) ?? "restore", env, ctx, user_id);

      if (result.status === "blocked") {
        return json({ ok: false, error: `Duplicate detected (${(result.score * 100).toFixed(0)}% match). Existing entry ID: ${result.matchId}.` }, 409);
      }

      return json({ ok: true, id: result.id, snapshotId: snapshot.id, snapshotCreatedAt: snapshot.created_at });
    }

    // POST /link — create an explicit edge between two memories, mirrors the MCP `link` tool
    if (url.pathname === "/link" && request.method === "POST") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;

      let body: { source_id?: string; target_id?: string; type?: string };
      try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
      const sourceId = body.source_id?.trim();
      const targetId = body.target_id?.trim();
      if (!sourceId || !targetId) return json({ ok: false, error: "source_id and target_id are required" }, 400);
      const type = body.type?.trim() || "relates_to";
      if (!isValidEdgeType(type)) {
        return json({ ok: false, error: `type must be one of: ${Object.keys(EDGE_TYPES).join(", ")}` }, 400);
      }

      // Visibility check: both endpoints must be visible to the requesting user
      if (user_id) {
        for (const eid of [sourceId, targetId]) {
          const row = await env.DB.prepare(
            `SELECT id, owner_user_id, tags FROM entries WHERE id = ?`
          ).bind(eid).first() as Record<string, any> | null;
          if (!row) continue; // entry doesn't exist — let createEdge handle it
          const tags: string[] = JSON.parse(row.tags ?? "[]");
          if (tags.includes("private") && row.owner_user_id !== user_id) {
            return json({ ok: false, error: `Entry not found: ${eid}` }, 404);
          }
        }
      }

      const edge = await createEdge(sourceId, targetId, type, { provenance: "explicit", weight: 1.0 }, env);
      if (!edge) return json({ ok: false, error: "Cannot link an entry to itself" }, 400);
      return json({ ok: true, source_id: edge.source_id, target_id: edge.target_id, type: edge.type });
    }

    // POST /unlink — remove a relationship link, mirrors the MCP `unlink` tool.
    // POST rather than DELETE /link: CORS_HEADERS allow only GET/POST/OPTIONS and
    // every sibling mutation route is POST.
    if (url.pathname === "/unlink" && request.method === "POST") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;

      let body: { source_id?: string; target_id?: string; type?: string };
      try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
      const sourceId = body.source_id?.trim();
      const targetId = body.target_id?.trim();
      if (!sourceId || !targetId) return json({ ok: false, error: "source_id and target_id are required" }, 400);
      const type = body.type?.trim() || undefined;
      if (type && !isValidEdgeType(type)) {
        return json({ ok: false, error: `type must be one of: ${Object.keys(EDGE_TYPES).join(", ")}` }, 400);
      }

      // Visibility check: both endpoints must be visible to the requesting user
      if (user_id) {
        for (const eid of [sourceId, targetId]) {
          const row = await env.DB.prepare(
            `SELECT id, owner_user_id, tags FROM entries WHERE id = ?`
          ).bind(eid).first() as Record<string, any> | null;
          if (!row) continue; // entry doesn't exist — let deleteEdge handle it
          const tags: string[] = JSON.parse(row.tags ?? "[]");
          if (tags.includes("private") && row.owner_user_id !== user_id) {
            return json({ ok: false, error: `Entry not found: ${eid}` }, 404);
          }
        }
      }

      const deleted = await deleteEdge(sourceId, targetId, type, env);
      return json({ ok: true, deleted });
    }

    // GET /connections — 1-hop neighbors of an entry, mirrors the MCP `connections` tool
    if (url.pathname === "/connections" && request.method === "GET") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;

      const id = url.searchParams.get("id")?.trim();
      if (!id) return json({ ok: false, error: "id is required" }, 400);
      const type = url.searchParams.get("type")?.trim() || undefined;

      const connections = await getConnections(id, type, env, user_id);
      return json({ ok: true, id, connections });
    }

    // GET /entry — one full row by id, for the dashboard graph view's tap-to-open
    // (/graph ships 80-char labels only; fattening it with full content would bloat
    // every graph load to serve a per-tap need). Dashboard-only, no MCP twin.
    if (url.pathname === "/entry" && request.method === "GET") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;

      const id = url.searchParams.get("id")?.trim();
      if (!id) return json({ ok: false, error: "id is required" }, 400);

      const row = await env.DB.prepare(
        `SELECT id, content, tags, source, created_at, owner_user_id FROM entries WHERE id = ?`
      ).bind(id).first() as Record<string, any> | null;
      if (!row) return json({ ok: false, error: `No entry found with ID: ${id}` }, 404);

      // Visibility check: private entries are only visible to their owner
      const tags: string[] = JSON.parse(row.tags ?? "[]");
      if (tags.includes("private") && row.owner_user_id !== user_id) {
        return json({ ok: false, error: `No entry found with ID: ${id}` }, 404);
      }

      // Hydrate owner username
      let owner_username = '';
      if (row.owner_user_id) {
        const owner = await env.DB.prepare(`SELECT username FROM users WHERE id = ?`).bind(row.owner_user_id).first() as { username: string } | null;
        owner_username = owner?.username || '';
      }

      return json({
        ok: true,
        entry: {
          id: row.id,
          content: row.content,
          tags: JSON.parse(row.tags ?? "[]"),
          source: row.source,
          created_at: row.created_at,
          owner_username,
          is_private: tags.includes("private"),
        },
      });
    }

    // GET /graph — node+edge subgraph for the dashboard graph view (dashboard-only;
    // no MCP twin — this is visualization data, not an agent capability)
    if (url.pathname === "/graph" && request.method === "GET") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;

      const seed = url.searchParams.get("seed")?.trim() || undefined;
      const limitParam = url.searchParams.get("limit");
      const limit = limitParam ? parseInt(limitParam, 10) : undefined;

      const { nodes, edges } = await buildGraph({ seed, limit, userId: user_id }, env);
      return json({ ok: true, nodes, edges });
    }

    // POST /status — set lifecycle status, mirrors the MCP `set_status` tool
    if (url.pathname === "/status" && request.method === "POST") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;

      let body: { id?: string; status?: string };
      try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
      if (!body.id?.trim()) return json({ ok: false, error: "id is required" }, 400);
      if (!(STATUS_VALUES as readonly string[]).includes(body.status ?? "")) {
        return json({ ok: false, error: `status must be one of: ${STATUS_VALUES.join(", ")}` }, 400);
      }

      const id = body.id.trim();
      const status = body.status as MemoryStatus;

      // Ownership check
      const entryRow = await env.DB.prepare(`SELECT owner_user_id FROM entries WHERE id = ?`).bind(id).first() as { owner_user_id: string } | null;
      if (entryRow && entryRow.owner_user_id && entryRow.owner_user_id !== user_id && entryRow.owner_user_id !== "") {
        return json({ ok: false, error: `No entry found with ID: ${id}` }, 404);
      }

      const ok = await applyStatus(id, status, env);

      if (!ok) {
        return json({ ok: false, error: `No entry found with ID: ${id}` }, 404);
      }

      return json({ ok: true, id, status });
    }

    // POST /epistemic-status — transition epistemic lifecycle (Ticket 10)
    if (url.pathname === "/epistemic-status" && request.method === "POST") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;

      let body: { id?: string; status?: string };
      try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
      if (!body.id?.trim()) return json({ ok: false, error: "id is required" }, 400);
      if (!(EPISTEMIC_STATUS_VALUES as readonly string[]).includes(body.status ?? "")) {
        return json({ ok: false, error: `status must be one of: ${EPISTEMIC_STATUS_VALUES.join(", ")}` }, 400);
      }

      const id = body.id.trim();
      const newStatus = body.status as EpistemicStatus;

      const entryRow = await env.DB.prepare(`SELECT owner_user_id, epistemic_status FROM entries WHERE id = ?`).bind(id).first() as { owner_user_id: string; epistemic_status: string } | null;
      if (!entryRow) return json({ ok: false, error: `No entry found with ID: ${id}` }, 404);
      if (entryRow.owner_user_id && entryRow.owner_user_id !== user_id && entryRow.owner_user_id !== "") {
        return json({ ok: false, error: `No entry found with ID: ${id}` }, 404);
      }

      const currentStatus = (entryRow.epistemic_status ?? "canonical") as EpistemicStatus;
      if (!isValidTransition(currentStatus, newStatus)) {
        const validNext = VALID_EPISTEMIC_TRANSITIONS[currentStatus] ?? [];
        return json({ ok: false, error: `Invalid transition: ${currentStatus} → ${newStatus}`, valid_next_states: validNext }, 400);
      }

      await env.DB.prepare(`UPDATE entries SET epistemic_status = ? WHERE id = ?`).bind(newStatus, id).run();
      return json({ ok: true, id, from: currentStatus, to: newStatus });
    }

    // POST /patterns/resolve — confirm or dismiss an auto-derived pattern.
    // Dashboard-only, no MCP twin: pattern review is a human curation act, not an
    // agent capability. Confirm promotes the pattern into a real recallable memory;
    // dismiss deprecates it (audit row kept, vectors removed).
    if (url.pathname === "/patterns/resolve" && request.method === "POST") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;

      let body: { id?: string; action?: string };
      try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
      const id = body.id?.trim();
      if (!id) return json({ ok: false, error: "id is required" }, 400);
      const action = body.action;
      if (action !== "confirm" && action !== "dismiss") {
        return json({ ok: false, error: `action must be "confirm" or "dismiss"` }, 400);
      }

      const row = await env.DB.prepare(`SELECT id, tags, owner_user_id FROM entries WHERE id = ?`).bind(id).first() as Record<string, any> | null;
      if (!row) return json({ ok: false, error: `No entry found with ID: ${id}` }, 404);
      const tags: string[] = JSON.parse(row.tags ?? "[]");
      if (!tags.includes("auto-pattern")) {
        return json({ ok: false, error: "Entry is not an auto-derived pattern" }, 400);
      }
      // Visibility check: private entries can only be resolved by their owner
      if (tags.includes("private") && row.owner_user_id !== user_id) {
        return json({ ok: false, error: `No entry found with ID: ${id}` }, 404);
      }

      if (action === "confirm") {
        // Losing the auto-pattern tag is what exits the recall exclusion — it's
        // enforced at D1 hydration, not vector metadata, so this tag update alone
        // makes the entry recallable. No re-embed: content is unchanged and vectors
        // already exist (the stale auto-pattern flag in vector metadata is harmless).
        const promoted = withStatus(withKind(tags.filter(t => t !== "auto-pattern"), "semantic"), "canonical");
        await env.DB.prepare(`UPDATE entries SET tags = ? WHERE id = ?`).bind(JSON.stringify(promoted), id).run();
      } else {
        await deprecateEntry(id, env);
      }
      return json({ ok: true, id, action });
    }

    // POST /chat
    if (url.pathname === "/chat" && request.method === "POST") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;

      let body: { query?: string; memories?: string };
      try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
      if (!body.query?.trim()) return json({ ok: false, error: "query is required" }, 400);

      const systemPrompt = `You are a personal memory assistant. Answer the user's question using ONLY the memories provided. Even if the match scores are low, extract any relevant facts and answer directly. Never say you don't have enough information if the answer exists anywhere in the memories. Be concise.`;

      const userMessage = `Question: ${body.query}\n\nRelevant memories:\n${body.memories}`;

      // Workers AI requires `as any` here — the SDK types don't cover all models
      const stream = await env.AI.run(LLM_MODEL as any, {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ],
        stream: true,
      });

      return new Response(stream as ReadableStream, {
        headers: { "Content-Type": "text/event-stream", ...CORS_HEADERS },
      });
    }

    // GET /digest
    if (url.pathname === "/digest" && request.method === "GET") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;
      const tag = url.searchParams.get("tag")?.trim();
      if (!tag) return json({ ok: false, error: "tag parameter is required" }, 400);

      const result = await compressTag(tag, env, ctx, user_id);

      if (!result.synthesizedId) {
        return json({ tag, error: "Could not create digest — tag may have fewer than 20 entries or was recently compressed", source_count: result.entriesUsed });
      }

      return json({ tag, synthesis: result.text, entry_id: result.synthesizedId, source_count: result.entriesUsed });
    }

    // POST /vectorize-pending
    if (url.pathname === "/vectorize-pending" && request.method === "POST") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;

      // Reindex mode: ?reindex=true triggers full re-index with ownership metadata
      const reindex = url.searchParams.get("reindex") === "true";
      if (reindex) {
        const result = await reindexAllVectors(env);
        return json({ ok: true, reindex: true, processed: result.processed, failed: result.failed });
      }

      const graceCutoff = Date.now() - graceMs(env);

      const { results: toProcess } = await env.DB.prepare(
        `SELECT id, content, tags, source, created_at FROM entries
         WHERE vector_ids = '[]' AND created_at < ?
         ORDER BY created_at DESC LIMIT 25`
      ).bind(graceCutoff).all();

      let processed = 0;
      let failed = 0;

      for (const row of toProcess as Record<string, any>[]) {
        try {
          await storeEntry(
            env,
            row.id as string,
            row.content as string,
            JSON.parse(row.tags as string),
            row.source as string,
            row.created_at as number,
            undefined,
            (JSON.parse(row.tags as string) as string[]).includes("private")
          );
          processed++;
        } catch (e) {
          console.error("Re-embed failed for entry", row.id, e);
          failed++;
        }
      }

      const remaining = await env.DB.prepare(
        `SELECT COUNT(*) as count FROM entries WHERE vector_ids = '[]' AND created_at < ?`
      ).bind(graceCutoff).first() as Record<string, any> | null;

      return json({ processed, failed, remaining: (remaining?.count as number) ?? 0 });
    }

    // ─── Integrations (settings UI) ─────────────────────────────────────────
    // External sources mirrored into memory, driven entirely by the provider
    // registry — adding a provider requires no route changes. State (token,
    // account, item map) lives in OAUTH_KV under integrations:* — no schema
    // change, and the namespace already exists in every deployment. See
    // src/integrations/.

    // GET /integrations — provider list + connection status (never the token)
    if (url.pathname === "/integrations" && request.method === "GET") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;
      const integrations = [];
      for (const provider of Object.values(INTEGRATION_PROVIDERS)) {
        integrations.push(integrationStatus(provider, await loadIntegration(env, provider.id)));
      }
      return json({ ok: true, integrations });
    }

    // POST /integrations/:provider/(connect|sync|disconnect)
    const integrationRoute = url.pathname.match(/^\/integrations\/([a-z0-9-]+)\/(connect|sync|disconnect)$/);
    if (integrationRoute && request.method === "POST") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;
      const provider = getProvider(integrationRoute[1]);
      if (!provider) return json({ ok: false, error: `Unknown integration: ${integrationRoute[1]}` }, 404);
      const action = integrationRoute[2];

      // connect — validate the pasted token against the provider's API
      // (server-side; the browser can't for CORS reasons) and store it only if
      // it works.
      if (action === "connect") {
        let body: { token?: string };
        try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
        const token = body.token?.trim();
        if (!token) return json({ ok: false, error: "token is required" }, 400);

        let workspaceName: string;
        try {
          workspaceName = await provider.validateToken(token);
        } catch (e) {
          return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
        }

        // Preserve the item map across reconnects so already-mirrored items
        // update in place instead of duplicating.
        const existing = await loadIntegration(env, provider.id);
        const now = Date.now();
        const record: IntegrationRecord = {
          provider: provider.id,
          authKind: "token",
          credentials: { token },
          config: existing?.config ?? {},
          status: "connected",
          workspaceName,
          lastSyncedAt: existing?.lastSyncedAt ?? null,
          lastSyncError: null,
          itemMap: existing?.itemMap ?? {},
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        await saveIntegration(env, record);
        return json({ ok: true, provider: provider.id, workspaceName });
      }

      // sync — one bounded batch; callers loop while `remaining` > 0 (same
      // pattern as POST /vectorize-pending).
      if (action === "sync") {
        if (!(await loadIntegration(env, provider.id))) {
          return json({ ok: false, error: `${provider.name} is not connected` }, 404);
        }
        const result = await provider.sync(env, makeMirrorStore(env));
        return json(result, result.ok ? 200 : 502);
      }

      // disconnect — remove the connection. Mirrored memories are kept
      // (they're the user's data) unless purge=true.
      let body: { purge?: boolean } = {};
      try { body = await request.json(); } catch { /* empty body — keep memories */ }
      const record = await loadIntegration(env, provider.id);
      if (!record) return json({ ok: false, error: `${provider.name} is not connected` }, 404);

      let purged = 0;
      if (body.purge) {
        for (const mapped of Object.values(record.itemMap)) {
          try {
            const r = await forgetEntry(mapped.entryId, env);
            if (r.status === "deleted") purged++;
          } catch (e) {
            console.error("Mirror purge failed (non-fatal):", e);
          }
        }
      }
      await deleteIntegration(env, provider.id);
      return json({ ok: true, purged, kept: body.purge ? 0 : Object.keys(record.itemMap).length });
    }

    // POST /classify-pending
    // One-time, opt-in backfill: runs classifyEntry over entries that predate the
    // status (#119) and kind (#12) features and writes status:/kind: tags. Bounded
    // batch per call, idempotent (skips entries that already carry either tag), and
    // resumable (safe to stop/restart). No schema migration — only writes tags.
    if (url.pathname === "/classify-pending" && request.method === "POST") {
      const { error: authErr, user_id } = await requireAuthAsync(request, env);
      if (authErr) return authErr;

      const UNCLASSIFIED_WHERE = `tags NOT LIKE '%"status:%' AND tags NOT LIKE '%"kind:%'`;

      const { results: toProcess } = await env.DB.prepare(
        `SELECT id, content, tags FROM entries
         WHERE ${UNCLASSIFIED_WHERE}
         ORDER BY created_at ASC LIMIT 25`
      ).all();

      let processed = 0;
      let failed = 0;

      for (const row of toProcess as Record<string, any>[]) {
        try {
          const { canonical, kind } = await classifyEntry(row.content as string, env);
          let tags: string[] = JSON.parse(row.tags as string);
          if (kind) tags = withKind(tags, kind);
          if (canonical && getStatus(tags) === null) tags = withStatus(tags, "canonical");
          await env.DB.prepare(`UPDATE entries SET tags = ? WHERE id = ?`).bind(JSON.stringify(tags), row.id).run();
          processed++;
        } catch (e) {
          console.error("Classification backfill failed for entry", row.id, e);
          failed++;
        }
      }

      const remaining = await env.DB.prepare(
        `SELECT COUNT(*) as count FROM entries WHERE ${UNCLASSIFIED_WHERE}`
      ).first() as Record<string, any> | null;

      return json({ processed, failed, remaining: (remaining?.count as number) ?? 0 });
    }

    return new Response("Not found", { status: 404 });
  },
};
