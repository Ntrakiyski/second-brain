import { COMPRESSION_IMPORTANCE_THRESHOLD, COMPRESSION_MIN_RECALL } from "../../src/index";

function extractValue(s: string, args: any[], index: number): string | undefined {
  if (args[index] !== undefined) return args[index] as string;
  const match = s.match(/'([^']+)'/);
  return match ? match[1] : undefined;
}

export class D1Mock {
  entries: any[] = [];
  edges: any[] = [];
  users: any[] = [];
  episodes: any[] = [];
  passages: any[] = [];
  documents: any[] = [];
  document_sections: any[] = [];
  entry_snapshots: any[] = [];
  edgeProposals: any[] = [];

  prepare(sql: string) {
    const s = sql.replace(/\s+/g, " ").trim();
    const db = this;

    const makeStmt = (args: any[]) => ({
      async run() {
        if (s.startsWith("INSERT INTO entries")) {
          const [id, content, tags, source, created_at, vector_ids, owner_user_id, valid_from, recorded_at] = args;
          db.entries.push({ id, content, tags, source, created_at, vector_ids, recall_count: 0, importance_score: 0, contradiction_wins: 0, contradiction_losses: 0, owner_user_id: owner_user_id ?? "", last_recalled_at: null, valid_from: valid_from ?? null, recorded_at: recorded_at ?? null, valid_to: null, epistemic_status: "canonical" });
          return { meta: { changes: 1 } };
        }
        if (s.startsWith("INSERT INTO users")) {
          const [id, username, normalized_username, auth_key_hash, auth_key_prefix, created_at] = args;
          const existing = db.users.find((u: any) => u.normalized_username === normalized_username);
          if (existing) throw new Error("UNIQUE constraint failed");
          const statusMatch = s.match(/'(\w+)'/);
          const status = statusMatch ? statusMatch[1] : "active";
          db.users.push({ id, username, normalized_username, auth_key_hash, auth_key_prefix, status, created_at, last_used_at: null });
          return { meta: { changes: 1 } };
        }
        if (s.startsWith("UPDATE entries SET owner_user_id")) {
          const [owner_user_id] = args;
          let count = 0;
          for (const row of db.entries) {
            if (row.owner_user_id === "") { row.owner_user_id = owner_user_id; count++; }
          }
          return { meta: { changes: count } };
        }
        if (s.startsWith("UPDATE entries SET content = ?, vector_ids")) {
          const [content, vector_ids, id] = args;
          const row = db.entries.find((e: any) => e.id === id);
          if (row) { row.content = content; row.vector_ids = vector_ids; }
          return { meta: { changes: row ? 1 : 0 } };
        }
        if (s.startsWith("UPDATE entries SET tags = ?, vector_ids")) {
          const [tags, vector_ids, id] = args;
          const row = db.entries.find((e: any) => e.id === id);
          if (row) { row.tags = tags; row.vector_ids = vector_ids; }
          return { meta: { changes: row ? 1 : 0 } };
        }
        if (s.startsWith("UPDATE entries SET vector_ids")) {
          const [vector_ids, id] = args;
          const row = db.entries.find((e: any) => e.id === id);
          if (row) row.vector_ids = vector_ids;
          return { meta: { changes: row ? 1 : 0 } };
        }
        if (s.startsWith("UPDATE entries SET tags = ? WHERE id")) {
          const [tags, id] = args;
          const row = db.entries.find((e: any) => e.id === id);
          if (row) row.tags = tags;
          return { meta: { changes: row ? 1 : 0 } };
        }
        if (s.startsWith("UPDATE entries SET content = ?, tags")) {
          const [content, tags, id] = args;
          const row = db.entries.find((e: any) => e.id === id);
          if (row) { row.content = content; row.tags = tags; }
          return { meta: { changes: row ? 1 : 0 } };
        }
        if (s.startsWith("UPDATE entries SET content")) {
          const [content, id] = args;
          const row = db.entries.find((e: any) => e.id === id);
          if (row) row.content = content;
          return { meta: { changes: row ? 1 : 0 } };
        }
        if (s.startsWith("UPDATE entries SET tags = json_insert(tags, '$[#]', 'rolled-up'), content = content ||")) {
          const [addition, id] = args;
          const row = db.entries.find((e: any) => e.id === id);
          if (row) {
            const tags: string[] = JSON.parse(row.tags ?? "[]");
            if (!tags.includes("rolled-up")) tags.push("rolled-up");
            row.tags = JSON.stringify(tags);
            row.content = row.content + addition;
          }
          return { meta: { changes: row ? 1 : 0 } };
        }
        if (s.startsWith("UPDATE entries SET tags = json_insert(tags, '$[#]'")) {
          const [tag, id] = args;
          const row = db.entries.find((e: any) => e.id === id);
          if (row) {
            const tags: string[] = JSON.parse(row.tags ?? "[]");
            if (!tags.includes(tag)) tags.push(tag);
            row.tags = JSON.stringify(tags);
          }
          return { meta: { changes: row ? 1 : 0 } };
        }
        if (s.startsWith("UPDATE entries SET contradiction_wins = contradiction_wins + 1")) {
          const [id] = args;
          const row = db.entries.find((e: any) => e.id === id);
          if (row) row.contradiction_wins = (row.contradiction_wins ?? 0) + 1;
          return { meta: { changes: row ? 1 : 0 } };
        }
        if (s.startsWith("UPDATE entries SET contradiction_losses = contradiction_losses + 1")) {
          const [id] = args;
          const row = db.entries.find((e: any) => e.id === id);
          if (row) row.contradiction_losses = (row.contradiction_losses ?? 0) + 1;
          return { meta: { changes: row ? 1 : 0 } };
        }
        if (s.startsWith("UPDATE entries SET recall_count")) {
          const [value, id] = args;
          const row = db.entries.find((e: any) => e.id === id);
          if (row) {
            row.recall_count = (row.recall_count ?? 0) + 1;
            if (s.includes("last_recalled_at")) row.last_recalled_at = value;
          }
          return { meta: { changes: row ? 1 : 0 } };
        }
        if (s.startsWith("UPDATE entries SET importance_score")) {
          const [score, id] = args;
          const row = db.entries.find((e: any) => e.id === id);
          if (row) row.importance_score = score;
          return { meta: { changes: row ? 1 : 0 } };
        }
        if (s.startsWith("UPDATE entries SET epistemic_status")) {
          if (s.includes("WHERE valid_to IS NOT NULL")) {
            // detectStaleness: mark entries with valid_to set
            let changes = 0;
            for (const e of db.entries) {
              if (e.valid_to != null && e.epistemic_status !== "stale") {
                e.epistemic_status = "stale";
                changes++;
              }
            }
            return { meta: { changes } };
          }
          if (s.includes("WHERE id IN")) {
            // detectStaleness: mark entries with low-confidence incoming edges
            // The subquery selects target_id from edges where confidence < threshold
            const threshold = args[0] as number;
            const staleIds = new Set(
              db.edges
                .filter((e: any) => {
                  const meta = e.metadata ? JSON.parse(e.metadata) : {};
                  const conf = meta.confidence ?? e.weight;
                  return conf < threshold && conf > 0;
                })
                .map((e: any) => e.target_id)
            );
            let changes = 0;
            for (const e of db.entries) {
              if (staleIds.has(e.id) && e.epistemic_status !== "stale") {
                e.epistemic_status = "stale";
                changes++;
              }
            }
            return { meta: { changes } };
          }
          if (s.includes("WHERE created_at <")) {
            // detectStaleness: mark old entries with no recalls
            const cutoff = args[0] as number;
            let changes = 0;
            for (const e of db.entries) {
              if (e.created_at < cutoff && (e.recall_count ?? 0) === 0 && e.epistemic_status !== "stale") {
                e.epistemic_status = "stale";
                changes++;
              }
            }
            return { meta: { changes } };
          }
          // Generic epistemic_status update (e.g., POST /epistemic-status)
          const [newStatus, id] = args;
          const row = db.entries.find((e: any) => e.id === id);
          if (row) {
            row.epistemic_status = newStatus;
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
        if (s.startsWith("DELETE FROM entries WHERE id")) {
          const [id] = args;
          const before = db.entries.length;
          db.entries = db.entries.filter((e: any) => e.id !== id);
          return { meta: { changes: before - db.entries.length } };
        }
        if (s.startsWith("INSERT INTO edges")) {
          const [id, source_id, target_id, type, weight, provenance, metadata, created_at, updated_at] = args;
          const existing = db.edges.find((e: any) => e.source_id === source_id && e.target_id === target_id && e.type === type);
          if (existing) {
            existing.weight = Math.max(existing.weight, weight); // ON CONFLICT ... max(weight)
            existing.updated_at = updated_at;
            const meta = typeof metadata === "string" ? JSON.parse(metadata) : metadata;
            if (meta?.confidence != null) existing.confidence = meta.confidence;
          } else {
            const meta = typeof metadata === "string" ? JSON.parse(metadata) : metadata;
            db.edges.push({ id, source_id, target_id, type, weight, provenance, metadata, created_at, updated_at, confidence: meta?.confidence ?? 1.0 });
          }
          return { meta: { changes: 1 } };
        }
        if (s.startsWith("INSERT INTO episodes")) {
          const [id, entry_id, content, content_type, source, created_at] = args;
          db.episodes.push({ id, entry_id, content, content_type, source, created_at });
          return { meta: { changes: 1 } };
        }
        if (s.startsWith("INSERT INTO passages")) {
          const [id, entry_id, episode_id, content, section, start_offset, end_offset, vector_ids, created_at] = args;
          db.passages.push({ id, entry_id, episode_id, content, section, start_offset, end_offset, vector_ids, created_at });
          return { meta: { changes: 1 } };
        }
        if (s.startsWith("INSERT INTO documents")) {
          const [id, title, source_url, content_type, created_at] = args;
          db.documents.push({ id, title, source_url, content_type, created_at });
          return { meta: { changes: 1 } };
        }
        if (s.startsWith("INSERT INTO document_sections")) {
          const [id, document_id, parent_section_id, title, level, order_index, created_at] = args;
          db.document_sections.push({ id, document_id, parent_section_id, title, level, order_index, created_at });
          return { meta: { changes: 1 } };
        }
        if (s.startsWith("INSERT INTO entry_snapshots")) {
          const [id, entry_id, content, tags, source, created_at] = args;
          db.entry_snapshots.push({ id, entry_id, content, tags, source, created_at });
          return { meta: { changes: 1 } };
        }
        if (s.startsWith("DELETE FROM edges WHERE ((source_id")) {
          // deleteEdge: order-agnostic pair delete, optional trailing type filter.
          const [a, b, c, d, type] = args;
          const before = db.edges.length;
          db.edges = db.edges.filter((e: any) => {
            const pairMatch = (e.source_id === a && e.target_id === b) || (e.source_id === c && e.target_id === d);
            if (!pairMatch) return true;
            if (type && e.type !== type) return true;
            return false;
          });
          return { meta: { changes: before - db.edges.length } };
        }
        if (s.startsWith("DELETE FROM edges WHERE source_id")) {
          // Cascade delete on forget: source_id = ? OR target_id = ? (both bound to the same id).
          const [sid, tid] = args;
          const before = db.edges.length;
          db.edges = db.edges.filter((e: any) => e.source_id !== sid && e.target_id !== tid);
          return { meta: { changes: before - db.edges.length } };
        }
        if (s.startsWith("DELETE FROM edges WHERE provenance")) {
          // runGraphPass prune: inferred edges below a weight, older than a cutoff.
          const [weight, age] = args;
          const before = db.edges.length;
          db.edges = db.edges.filter((e: any) => !(e.provenance === "inferred" && e.weight < weight && e.updated_at < age));
          return { meta: { changes: before - db.edges.length } };
        }
        if (s.startsWith("UPDATE users SET status")) {
          const userId = args[0] as string;
          const user = db.users.find((u: any) => u.id === userId);
          if (user) user.status = "inactive";
          return { meta: { changes: user ? 1 : 0 } };
        }
        if (s.startsWith("DELETE FROM entries WHERE owner_user_id") && s.includes("tags LIKE")) {
          const [ownerId] = args;
          const before = db.entries.length;
          db.entries = db.entries.filter((e: any) => !(e.owner_user_id === ownerId && (JSON.parse(e.tags ?? "[]") as string[]).includes("private")));
          return { meta: { changes: before - db.entries.length } };
        }
        // ─── Edge proposals (run) ───────────────────────────────────────
        if (s.startsWith("INSERT INTO edge_proposals")) {
          // Parse columns and values from SQL to handle both:
          //   VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)   — 7 args (MCP)
          //   VALUES (?, ?, ?, 'contradicts', ?, ?, 'pending', ?) — 6 args (lifecycle)
          const colMatch = s.match(/INSERT INTO edge_proposals \(([^)]+)\) VALUES \(([^)]+)\)/);
          if (colMatch) {
            const columns = colMatch[1].split(',').map((c: string) => c.trim());
            const values = colMatch[2].split(',').map((v: string) => v.trim());
            const proposal: any = {};
            let argIdx = 0;
            for (let i = 0; i < columns.length; i++) {
              if (values[i] === '?') {
                proposal[columns[i]] = args[argIdx++];
              } else {
                proposal[columns[i]] = values[i].replace(/^'|'$/g, '');
              }
            }
            proposal.status = proposal.status ?? "pending";
            db.edgeProposals.push(proposal);
            return { meta: { changes: 1 } };
          }
          // Fallback (shouldn't be reached)
          const [id, source_id, target_id, type, reason, proposed_by, _status, created_at] = args;
          db.edgeProposals.push({ id, source_id, target_id, type, reason, proposed_by, status: "pending", created_at });
          return { meta: { changes: 1 } };
        }
        if (s.startsWith("UPDATE edge_proposals SET status")) {
          const status = s.includes("'approved'") ? "approved" : "rejected";
          const resolvedAt = args[0] as number;
          const id = args[1] as string;
          const p = db.edgeProposals.find((pp: any) => pp.id === id);
          if (p) { p.status = status; p.resolved_at = resolvedAt; }
          return { meta: { changes: p ? 1 : 0 } };
        }
        return { meta: {} };
      },
      async first() {
        if (s.includes("SELECT id, auth_key_hash FROM users WHERE normalized_username")) {
          const normalized = extractValue(s, args, 0) ?? "";
          const row = db.users.find((u: any) => u.normalized_username === normalized && u.status === "active");
          return row ? { id: row.id, auth_key_hash: row.auth_key_hash } : null;
        }
        if (s.includes("SELECT id, username, status FROM users WHERE username")) {
          const username = extractValue(s, args, 0) ?? "";
          const row = db.users.find((u: any) => u.username === username);
          return row ? { id: row.id, username: row.username, status: row.status } : null;
        }
        if (s.includes("SELECT status FROM users WHERE username")) {
          const username = extractValue(s, args, 0) ?? "";
          const row = db.users.find((u: any) => u.username === username);
          return row ? { status: row.status } : null;
        }
        if (s.includes("SELECT id, username, status FROM users WHERE id")) {
          const userId = args[0] as string;
          const row = db.users.find((u: any) => u.id === userId);
          return row ? { id: row.id, username: row.username, status: row.status } : null;
        }
        if (s.includes("SELECT username FROM users WHERE id")) {
          const userId = args[0] as string;
          const row = db.users.find((u: any) => u.id === userId);
          return row ? { username: row.username } : null;
        }
        if (s.includes("SELECT id FROM users WHERE username")) {
          const username = extractValue(s, args, 0) ?? "";
          const row = db.users.find((u: any) => u.username === username);
          return row ? { id: row.id } : null;
        }
        if (s.includes("SELECT owner_user_id FROM entries")) {
          if (s.includes("WHERE content =")) {
            const content = extractValue(s, args, 0) ?? "";
            const row = db.entries.find((e: any) => e.content === content);
            return row ? { owner_user_id: row.owner_user_id } : null;
          }
          if (s.includes("WHERE id =")) {
            const id = extractValue(s, args, 0) ?? "";
            const row = db.entries.find((e: any) => e.id === id);
            return row ? { owner_user_id: row.owner_user_id } : null;
          }
          const row = db.entries[0];
          return row ? { owner_user_id: row.owner_user_id } : null;
        }
        if (s.includes("COUNT(*) as count") && s.includes("AVG(importance_score)")) {
          const count = db.entries.length;
          const scored = db.entries.filter((e: any) => typeof e.importance_score === "number");
          const avg_importance = scored.length > 0
            ? scored.reduce((sum: number, e: any) => sum + e.importance_score, 0) / scored.length
            : null;
          const cutoff = args.length > 0 ? Number(args[0]) : undefined;
          const unvectorized = cutoff !== undefined
            ? db.entries.filter((e: any) => e.vector_ids === '[]' && e.created_at < cutoff).length
            : 0;
          const unclassified = db.entries.filter((e: any) => !String(e.tags).includes('"status:') && !String(e.tags).includes('"kind:')).length;
          return { count, avg_importance, unvectorized, unclassified };
        }
        if (s.includes("COUNT(*) as count") && s.includes("vector_ids = '[]'") && s.includes("created_at <")) {
          const cutoff = Number(args[0]);
          const count = db.entries.filter((e: any) => e.vector_ids === '[]' && e.created_at < cutoff).length;
          return { count };
        }
        if (s.includes("COUNT(*) as count") && s.includes(`tags NOT LIKE '%"status:%'`) && s.includes(`tags NOT LIKE '%"kind:%'`)) {
          const count = db.entries.filter((e: any) => !String(e.tags).includes('"status:') && !String(e.tags).includes('"kind:')).length;
          return { count };
        }
        if (s.includes("COUNT(*) as count")) {
          return { count: db.entries.length };
        }
        // Table-specific WHERE id handlers (must precede generic entries handler)
        if (s.includes("FROM entry_snapshots") && s.includes("WHERE id")) {
          return db.entry_snapshots.find((r: any) => r.id === args[0]) ?? null;
        }
        if (s.includes("FROM episodes") && s.includes("WHERE id")) {
          return db.episodes.find((r: any) => r.id === args[0]) ?? null;
        }
        if (s.includes("FROM passages") && s.includes("WHERE id")) {
          return db.passages.find((r: any) => r.id === args[0]) ?? null;
        }
        if (s.includes("FROM documents") && s.includes("WHERE id")) {
          return db.documents.find((r: any) => r.id === args[0]) ?? null;
        }
        if (s.includes("FROM document_sections") && s.includes("WHERE id")) {
          return db.document_sections.find((r: any) => r.id === args[0]) ?? null;
        }
        // ─── Edge proposals (first) — must precede generic WHERE id ──────
        if (s.includes("FROM edge_proposals WHERE id = ?")) {
          const id = args[0];
          return db.edgeProposals.find((p: any) => p.id === id) ?? null;
        }
        if (s.includes("FROM edge_proposals WHERE source_id = ? AND target_id = ? AND type") && s.includes("status = 'pending'")) {
          const typeMatch = s.match(/type = '?(\w+)'?/);
          const typeValue = typeMatch ? typeMatch[1] : args[2];
          const [sourceId, targetId] = args;
          return db.edgeProposals.find((pp: any) => pp.source_id === sourceId && pp.target_id === targetId && pp.type === typeValue && pp.status === "pending") ?? null;
        }
        if (s.includes("WHERE id") && !s.includes("json_each")) {
          return db.entries.find((e: any) => e.id === args[0]) ?? null;
        }
        if (s.includes("WHERE tags LIKE") && s.includes("created_at >")) {
          // Cooldown check: find entries matching arg LIKE patterns + any hardcoded tags in SQL
          const likePatterns: string[] = args.slice(0, -1).map((a: any) => String(a));
          const cutoff = args[args.length - 1] as number;
          // Extract hardcoded tags from SQL (e.g. '%"synthesized"%')
          const hardcoded = [...s.matchAll(/'%"(\w+)"%'/g)].map(m => m[1]);
          const match = db.entries.find((e: any) => {
            if (e.created_at <= cutoff) return false;
            const tags: string[] = JSON.parse(e.tags ?? "[]");
            if (!hardcoded.every(t => tags.includes(t))) return false;
            return likePatterns.every((p: string) => {
              const tag = p.replace(/%"/g, "").replace(/"%/g, "");
              return tags.includes(tag);
            });
          });
          return match ? { id: match.id } : null;
        }
        if (s.includes("FROM episodes WHERE entry_id")) {
          const entryId = args[0] as string;
          const ep = db.episodes.find((e: any) => e.entry_id === entryId);
          return ep ? { id: ep.id } : null;
        }
        if (s.includes("SELECT owner_user_id, epistemic_status FROM entries WHERE id")) {
          const id = args[0] as string;
          const row = db.entries.find((e: any) => e.id === id);
          return row ? { owner_user_id: row.owner_user_id ?? "", epistemic_status: row.epistemic_status ?? "canonical" } : null;
        }
        return null;
      },
      async all() {
        if (s.includes("SELECT id, username, status FROM users WHERE status")) {
          const activeUsers = db.users.filter((u: any) => u.status === "active");
          return { results: activeUsers.map((u: any) => ({ id: u.id, username: u.username, status: u.status })) };
        }
        if (s.includes("SELECT id FROM users WHERE status = 'active' ORDER BY created_at ASC")) {
          const activeUsers = db.users.filter((u: any) => u.status === "active").sort((a: any, b: any) => a.created_at - b.created_at);
          const limitMatch = s.match(/LIMIT (\d+)/);
          const limit = limitMatch ? parseInt(limitMatch[1], 10) : activeUsers.length;
          return { results: activeUsers.slice(0, limit).map((u: any) => ({ id: u.id })) };
        }
        if (s.includes("SELECT id FROM users WHERE username") && !s.includes("FROM entries")) {
          const username = extractValue(s, args, 0) ?? "";
          const matches = db.users.filter((u: any) => u.username === username);
          return { results: matches.map((u: any) => ({ id: u.id })) };
        }
        if (s.includes("SELECT id, username FROM users WHERE id IN")) {
          const results = db.users
            .filter((u: any) => args.includes(u.id))
            .map((u: any) => ({ id: u.id, username: u.username }));
          return { results };
        }
        if (s.includes("SELECT username FROM users WHERE id =")) {
          const userId = args[0] as string;
          const user = db.users.find((u: any) => u.id === userId);
          return { results: user ? [{ username: user.username }] : [] };
        }
        if (s.includes("recall_count, importance_score, contradiction_wins, contradiction_losses, last_recalled_at, created_at, epistemic_status FROM entries WHERE id IN")) {
          const ids = args.map((a: any) => String(a));
          const rows = db.entries.filter((e: any) => ids.includes(e.id));
          return { results: rows.map((r: any) => ({ id: r.id, recall_count: r.recall_count ?? 0, importance_score: r.importance_score ?? 0, contradiction_wins: r.contradiction_wins ?? 0, contradiction_losses: r.contradiction_losses ?? 0, last_recalled_at: r.last_recalled_at ?? null, created_at: r.created_at, epistemic_status: r.epistemic_status ?? "canonical" })) };
        }
        if (s.includes("SELECT tags, owner_user_id FROM entries WHERE id =")) {
          // createEdge visibility check.
          const entryId = args[0] as string;
          const entry = db.entries.find((e: any) => e.id === entryId);
          return { results: entry ? [{ tags: entry.tags ?? "[]", owner_user_id: (entry as any).owner_user_id ?? "" }] : [] };
        }
        if (
          s === "SELECT id FROM entries WHERE tags LIKE ?" ||
          s === "SELECT id, vector_ids FROM entries WHERE tags LIKE ?" ||
          s === "SELECT id, vector_ids, content, tags, source, created_at FROM entries WHERE tags LIKE ?"
        ) {
          const pattern = String(args[0]);
          const tag = pattern.replace(/%"/g, "").replace(/"%/g, "");
          const results = db.entries
            .filter((e: any) => (JSON.parse(e.tags ?? "[]") as string[]).includes(tag))
            .map((e: any) => ({ id: e.id, vector_ids: e.vector_ids ?? "[]", content: e.content, tags: e.tags, source: e.source, created_at: e.created_at }));
          return { results };
        }
        if (s.includes("FROM entries WHERE vector_ids != '[]'")) {
          // reindexAllVectors query — entries with existing vectors.
          const results = db.entries
            .filter((e: any) => e.vector_ids && e.vector_ids !== "[]")
            .map((e: any) => ({
              id: e.id, content: e.content, tags: e.tags, source: e.source,
              created_at: e.created_at, vector_ids: e.vector_ids,
              owner_user_id: (e as any).owner_user_id ?? "",
            }));
          return { results };
        }
        // ─── detectCrossUserContradictions query ────────────────────────
        if (s.includes("SELECT id, content, owner_user_id FROM entries WHERE created_at >= ?") && s.includes("tags NOT LIKE")) {
          const cutoff = args[0] as number;
          const limit = args[1] as number;
          const results = db.entries
            .filter((e: any) => e.created_at >= cutoff)
            .filter((e: any) => {
              const tags: string[] = JSON.parse(e.tags ?? "[]");
              return !tags.includes("private");
            })
            .sort((a: any, b: any) => b.created_at - a.created_at)
            .slice(0, limit)
            .map((e: any) => ({ id: e.id, content: e.content, owner_user_id: e.owner_user_id ?? "" }));
          return { results };
        }
        if (s.includes("SELECT id, content, tags, source, created_at, vector_ids, owner_user_id FROM entries")) {
          // GET /list query — returns all matching entries with owner_user_id.
          const limit = Number(args[args.length - 1]);
          let rows = [...db.entries] as any[];
          const whereIdx = s.indexOf("WHERE");
          const orderIdx = s.indexOf("ORDER BY");
          const whereClause = whereIdx !== -1 && orderIdx !== -1
            ? s.substring(whereIdx + 5, orderIdx)
            : whereIdx !== -1
              ? s.substring(whereIdx + 5)
              : "";

          // Apply user filter if present
          if (whereClause.includes("owner_user_id = (SELECT id FROM users WHERE username = ?)")) {
            const username = args[0] as string;
            const user = db.users.find((u: any) => u.username === username);
            if (user) {
              rows = rows.filter(e => e.owner_user_id === user.id);
            } else {
              rows = [];
            }
          }

          // Apply tag filter if present
          if (whereClause.includes("tags LIKE ?")) {
            const tagIdx = whereClause.indexOf("tags LIKE ?");
            // Count how many bindings come before this one
            const beforeStr = whereClause.substring(0, tagIdx);
            const bindCount = (beforeStr.match(/\?/g) || []).length;
            const pattern = String(args[bindCount]);
            const tag = pattern.replace(/%"/g, "").replace(/"%/g, "");
            rows = rows.filter(e => (JSON.parse(e.tags ?? "[]") as string[]).includes(tag));
          }

          // Apply date filters
          if (whereClause.includes("created_at >= ?")) {
            const idx = whereClause.indexOf("created_at >= ?");
            const beforeStr = whereClause.substring(0, idx);
            const bindCount = (beforeStr.match(/\?/g) || []).length;
            const after = Number(args[bindCount]);
            rows = rows.filter(e => e.created_at >= after);
          }
          if (whereClause.includes("created_at <= ?")) {
            const idx = whereClause.indexOf("created_at <= ?");
            const beforeStr = whereClause.substring(0, idx);
            const bindCount = (beforeStr.match(/\?/g) || []).length;
            const before = Number(args[bindCount]);
            rows = rows.filter(e => e.created_at <= before);
          }

          // Apply visibility filter
          if (whereClause.includes("tags NOT LIKE") && !whereClause.includes("owner_user_id = ? OR")) {
            // Public only
            rows = rows.filter(e => !(JSON.parse(e.tags ?? "[]") as string[]).includes("private"));
          } else if (whereClause.includes("owner_user_id = ? AND tags LIKE")) {
            // Own private only - find the bind index for this clause
            const idx = whereClause.indexOf("owner_user_id = ? AND tags LIKE");
            const beforeStr = whereClause.substring(0, idx);
            const bindCount = (beforeStr.match(/\?/g) || []).length;
            const userId = args[bindCount] as string;
            rows = rows.filter(e => e.owner_user_id === userId && (JSON.parse(e.tags ?? "[]") as string[]).includes("private"));
          } else if (whereClause.includes("owner_user_id = ? OR tags NOT LIKE")) {
            // Default visibility (own + public) - find the bind index
            const idx = whereClause.indexOf("owner_user_id = ? OR tags NOT LIKE");
            const beforeStr = whereClause.substring(0, idx);
            const bindCount = (beforeStr.match(/\?/g) || []).length;
            const userId = args[bindCount] as string;
            rows = rows.filter(e => e.owner_user_id === userId || !(JSON.parse(e.tags ?? "[]") as string[]).includes("private"));
          }

          const results = rows
            .sort((a: any, b: any) => b.created_at - a.created_at)
            .slice(0, limit)
            .map((e: any) => ({
              id: e.id, content: e.content, tags: e.tags, source: e.source,
              created_at: e.created_at, vector_ids: e.vector_ids ?? "[]",
              owner_user_id: e.owner_user_id ?? "",
            }));
          return { results };
        }
        if (s.includes("WHERE content LIKE") && s.includes("ORDER BY created_at DESC LIMIT")) {
          // Keyword (hybrid recall) query: content LIKE ? OR content LIKE ? ... LIMIT ?
          const limit = Number(args[args.length - 1]);
          const patterns = args.slice(0, -1).map((a: any) => String(a).replace(/^%/, "").replace(/%$/, "").toLowerCase());
          const rows = [...db.entries]
            .filter((e: any) => patterns.some((p: string) => String(e.content).toLowerCase().includes(p)))
            .sort((a: any, b: any) => b.created_at - a.created_at)
            .slice(0, limit)
            .map((e: any) => ({ id: e.id, content: e.content, tags: e.tags, source: e.source, created_at: e.created_at }));
          return { results: rows };
        }
        if (s.includes("FROM entries") && s.includes("id NOT IN (SELECT source_id FROM edges)")) {
          // runGraphPass backfill: entries not referenced by any edge, newest first.
          const linked = new Set(db.edges.flatMap((e: any) => [e.source_id, e.target_id]));
          const limitMatch = s.match(/LIMIT (\d+)/);
          const limit = limitMatch ? parseInt(limitMatch[1], 10) : 25;
          const rows = [...db.entries]
            .filter((e: any) => {
              if (linked.has(e.id)) return false;
              if (s.includes('"status:deprecated"') && (JSON.parse(e.tags ?? "[]") as string[]).includes("status:deprecated")) return false;
              return true;
            })
            .sort((a: any, b: any) => b.created_at - a.created_at)
            .slice(0, limit)
            .map((e: any) => ({ id: e.id, content: e.content, owner_user_id: (e as any).owner_user_id ?? "", tags: e.tags ?? "[]" }));
          return { results: rows };
        }
        if (s.includes("FROM edges WHERE source_id IN") && s.includes("OR target_id IN")) {
          // expandGraph BFS / graph edge fetch: every edge touching the frontier, strongest
          // first. Args are the frontier id list bound twice (source_id IN …, target_id IN …).
          const ids = new Set(args.map((a: any) => String(a)));
          const results = db.edges
            .filter((e: any) => ids.has(e.source_id) || ids.has(e.target_id))
            .sort((a: any, b: any) => b.weight - a.weight)
            .map((e: any) => ({ source_id: e.source_id, target_id: e.target_id, type: e.type, weight: e.weight, confidence: e.confidence ?? 1.0 }));
          return { results };
        }
        if (s.includes("SELECT source_id, target_id FROM edges ORDER BY weight DESC")) {
          // buildGraph default mode: strongest edges first (to derive the node set).
          const limitMatch = s.match(/LIMIT (\d+)/);
          const limit = limitMatch ? parseInt(limitMatch[1], 10) : db.edges.length;
          const results = [...db.edges]
            .sort((a: any, b: any) => b.weight - a.weight)
            .slice(0, limit)
            .map((e: any) => ({ source_id: e.source_id, target_id: e.target_id }));
          return { results };
        }
        if (s.includes("SELECT id, content, tags, importance_score, created_at FROM entries WHERE id IN") || s.includes("SELECT id, content, tags, importance_score, created_at, owner_user_id FROM entries WHERE id IN")) {
          // buildGraph node hydration.
          const results = db.entries
            .filter((e: any) => args.includes(e.id))
            .map((e: any) => ({ id: e.id, content: e.content, tags: e.tags, importance_score: e.importance_score ?? 0, created_at: e.created_at, owner_user_id: e.owner_user_id ?? "" }));
          return { results };
        }
        if (s.includes("SELECT id, owner_user_id, tags FROM entries WHERE id IN")) {
          // recallEntries post-fusion visibility filter.
          const results = db.entries
            .filter((e: any) => args.includes(e.id))
            .map((e: any) => ({ id: e.id, owner_user_id: (e as any).owner_user_id ?? "", tags: e.tags ?? "[]" }));
          return { results };
        }
        if (s.includes("SELECT id, tags, owner_user_id FROM entries WHERE id IN")) {
          // filterVisibleIds: visibility check for graph traversal.
          const results = db.entries
            .filter((e: any) => args.includes(e.id))
            .map((e: any) => ({ id: e.id, tags: e.tags ?? "[]", owner_user_id: (e as any).owner_user_id ?? "" }));
          return { results };
        }
        if (s.includes("SELECT id, vector_ids FROM entries WHERE owner_user_id") && s.includes("tags LIKE")) {
          const ownerId = args[0] as string;
          const results = db.entries
            .filter((e: any) => e.owner_user_id === ownerId && (JSON.parse(e.tags ?? "[]") as string[]).includes("private"))
            .map((e: any) => ({ id: e.id, vector_ids: e.vector_ids ?? "[]" }));
          return { results };
        }
        if (s.includes("SELECT id, tags FROM entries WHERE id IN")) {
          // expandGraph deprecation check.
          const results = db.entries
            .filter((e: any) => args.includes(e.id))
            .map((e: any) => ({ id: e.id, tags: e.tags }));
          return { results };
        }
        if (s.includes("FROM entries e LEFT JOIN users u ON e.owner_user_id = u.id")) {
          // GET /team-activity query.
          let rows = [...db.entries] as any[];
          // Filter to public entries only
          rows = rows.filter(e => !(JSON.parse(e.tags ?? "[]") as string[]).includes("private"));
          // Apply user filter
          if (s.includes("WHERE e.tags NOT LIKE") && s.includes("owner_user_id = (SELECT id FROM users WHERE username = ?)")) {
            const username = args[0] as string;
            const user = db.users.find((u: any) => u.username === username);
            if (user) {
              rows = rows.filter(e => e.owner_user_id === user.id);
            } else {
              rows = [];
            }
          }
          // Apply after cursor
          const afterMatch = s.match(/e\.created_at <= \?/);
          if (afterMatch) {
            const idx = s.indexOf("e.created_at <= ?");
            const beforeStr = s.substring(0, idx);
            const bindCount = (beforeStr.match(/\?/g) || []).length;
            const afterVal = Number(args[bindCount]);
            rows = rows.filter(e => e.created_at <= afterVal);
          }
          // Sort and limit
          const limitMatch = s.match(/LIMIT \?/);
          const limit = limitMatch ? Number(args[args.length - 1]) : 20;
          rows.sort((a: any, b: any) => b.created_at - a.created_at);
          rows = rows.slice(0, limit);
          // Hydrate usernames
          const results = rows.map((e: any) => {
            const user = db.users.find((u: any) => u.id === e.owner_user_id);
            return {
              id: e.id,
              content: e.content,
              tags: e.tags,
              source: e.source,
              created_at: e.created_at,
              owner_user_id: e.owner_user_id ?? "",
              owner_username: user?.username ?? "",
            };
          });
          return { results };
        }
        // ─── Edge proposals ──────────────────────────────────────────────
        if (s.includes("FROM edge_proposals WHERE id = ?") && !s.includes("status = 'pending'")) {
          // GET single proposal
          const id = args[0];
          const p = db.edgeProposals.find((p: any) => p.id === id);
          return { results: p ? [p] : [] };
        }
        if (s.includes("FROM edge_proposals WHERE source_id = ? AND target_id = ? AND type") && s.includes("status = 'pending'")) {
          // Dedup check — handles both: type = ? (MCP) and type = 'contradicts' (lifecycle)
          const typeMatch = s.match(/type = '?(\w+)'?/);
          const typeValue = typeMatch ? typeMatch[1] : args[2];
          const [sourceId, targetId] = args;
          const p = db.edgeProposals.find((pp: any) => pp.source_id === sourceId && pp.target_id === targetId && pp.type === typeValue && pp.status === "pending");
          return { results: p ? [p] : [] };
        }
        if (s.includes("FROM edge_proposals") && s.includes("status = 'pending'") && !s.includes("source_id = ?")) {
          // List pending proposals — handles both aliased and non-aliased SQL
          const results = db.edgeProposals
            .filter((p: any) => p.status === "pending")
            .sort((a: any, b: any) => b.created_at - a.created_at);
          return { results };
        }
        if (s.includes("INSERT INTO edge_proposals")) {
          // Parse columns and values to handle hardcoded literals
          const colMatch = s.match(/INSERT INTO edge_proposals \(([^)]+)\) VALUES \(([^)]+)\)/);
          if (colMatch) {
            const columns = colMatch[1].split(',').map((c: string) => c.trim());
            const values = colMatch[2].split(',').map((v: string) => v.trim());
            const proposal: any = {};
            let argIdx = 0;
            for (let i = 0; i < columns.length; i++) {
              if (values[i] === '?') {
                proposal[columns[i]] = args[argIdx++];
              } else {
                proposal[columns[i]] = values[i].replace(/^'|'$/g, '');
              }
            }
            proposal.status = proposal.status ?? "pending";
            db.edgeProposals.push(proposal as any);
            return { results: [] };
          }
          // Fallback
          const id = args[0] as string;
          const proposal = {
            id, source_id: args[1], target_id: args[2], type: args[3],
            reason: args[4], proposed_by: args[5], status: "pending", created_at: args[7] as number,
          };
          db.edgeProposals.push(proposal as any);
          return { results: [] };
        }
        if (s.includes("UPDATE edge_proposals SET status =")) {
          const status = s.includes("'approved'") ? "approved" : "rejected";
          const resolvedAt = args[0] as number;
          const id = args[1] as string;
          const p = db.edgeProposals.find((pp: any) => pp.id === id);
          if (p) { p.status = status; p.resolved_at = resolvedAt; }
          return { results: [] };
        }
        if (s.includes("SELECT id, content, tags, source, created_at") && s.includes("FROM entries WHERE id IN") && !s.includes("tags NOT LIKE")) {
          // Graph node hydration (/connections, /graph). The `tags NOT LIKE` guard
          // keeps this from shadowing recall's hydration query (same columns, but it
          // applies the auto-pattern/deprecated/kind filters itself further down).
          const results = db.entries
            .filter((e: any) => args.includes(e.id))
            .map((e: any) => ({ id: e.id, content: e.content, tags: e.tags, source: e.source, created_at: e.created_at, owner_user_id: e.owner_user_id ?? "" }));
          return { results };
        }
        if (s.includes("SELECT id, recall_count, importance_score") && s.includes("WHERE id IN")) {
          const results = db.entries
            .filter((e: any) => args.includes(e.id))
            .map((e: any) => ({ id: e.id, recall_count: e.recall_count ?? 0, importance_score: e.importance_score ?? 0, contradiction_wins: e.contradiction_wins ?? 0, contradiction_losses: e.contradiction_losses ?? 0, last_recalled_at: e.last_recalled_at ?? null, created_at: e.created_at }));
          return { results };
        }
        if (s.includes("FROM entries WHERE id IN") && s.includes("tags NOT LIKE")) {
          // recallEntries D1 hydration — filter by IDs, exclude auto-pattern entries, apply after/before
          const inMatch = s.match(/WHERE id IN \(([^)]*)\)/);
          const idCount = inMatch ? inMatch[1].split(",").length : 0;
          const ids = args.slice(0, idCount);
          // Skip the visibility clause binding (owner_user_id = ?) if present
          const visOffset = s.includes("owner_user_id = ?") ? 1 : 0;
          const rest = args.slice(idCount + visOffset);
          let argIdx = 0;
          const kindMatch = s.match(/tags LIKE '%"(kind:(?:episodic|semantic))"%'/);
          let rows = db.entries.filter((e: any) => {
            const tags: string[] = JSON.parse(e.tags ?? "[]");
            if (!ids.includes(e.id)) return false;
            if (tags.includes("auto-pattern")) return false;
            if (s.includes('"status:deprecated"') && tags.includes("status:deprecated")) return false;
            if (kindMatch && !tags.includes(kindMatch[1])) return false;
            return true;
          });
          // Apply visibility: owner_user_id = userId OR entries not tagged private
          if (s.includes("owner_user_id = ?") && s.includes("tags NOT LIKE")) {
            const ownerId = args[ids.length] as string;
            rows = rows.filter((e: any) => e.owner_user_id === ownerId || !(JSON.parse(e.tags ?? "[]") as string[]).includes("private"));
          }
          if (s.includes("created_at >= ?")) {
            const after = Number(rest[argIdx++]);
            rows = rows.filter((e: any) => e.created_at >= after);
          }
          if (s.includes("created_at <= ?")) {
            const before = Number(rest[argIdx++]);
            rows = rows.filter((e: any) => e.created_at <= before);
          }
          if (s.includes("valid_from IS NULL OR valid_from <= ?")) {
            const asOf = Number(rest[argIdx++]);
            rows = rows.filter((e: any) => e.valid_from == null || e.valid_from <= asOf);
          }
          if (s.includes("valid_to IS NULL OR valid_to > ?")) {
            const asOf = Number(rest[argIdx++]);
            rows = rows.filter((e: any) => e.valid_to == null || e.valid_to > asOf);
          }
          const results = rows.map((e: any) => ({ id: e.id, content: e.content, tags: e.tags, source: e.source, created_at: e.created_at, owner_user_id: e.owner_user_id ?? "" }));
          return { results };
        }
        if (s.includes("SELECT id, content FROM entries") && s.includes("WHERE tags LIKE") && s.includes("ORDER BY created_at DESC")) {
          // compressTag raw entries query — tag match, system-tag exclusion, and the
          // recall/age/contradiction eligibility predicate (cutoff is the 2nd bind param).
          // When userId is provided (3rd bind param), filter by owner_user_id or public visibility.
          const tagPattern = args[0] as string;
          const tag = tagPattern.replace(/%"/g, "").replace(/"%/g, "");
          const cutoff = Number(args[1]);
          const userId = args.length > 2 ? (args[2] as string) : undefined;
          const results = [...db.entries]
            .filter((e: any) => {
              const tags: string[] = JSON.parse(e.tags ?? "[]");
              if (!tags.includes(tag)) return false;
              if (tags.includes("synthesized") || tags.includes("auto-pattern") || tags.includes("rolled-up")) return false;
              if (!(e.importance_score == null || e.importance_score < COMPRESSION_IMPORTANCE_THRESHOLD)) return false;
              const rc = e.recall_count; // NULL/undefined → recall clause is falsy → protected (matches SQL)
              if (!(rc === 0 || (rc < COMPRESSION_MIN_RECALL && e.created_at < cutoff))) return false;
              if (!(e.contradiction_wins == null || e.contradiction_wins === 0)) return false;
              // Per-user visibility: owner's entries OR public entries
              if (userId) {
                const isOwner = e.owner_user_id === userId;
                const isPublic = !tags.includes("private");
                if (!isOwner && !isPublic) return false;
              }
              return true;
            })
            .sort((a: any, b: any) => b.created_at - a.created_at)
            .slice(0, 50)
            .map((e: any) => ({ id: e.id, content: e.content }));
          return { results };
        }
        if (s.includes("SELECT id, content FROM entries WHERE id IN")) {
          const results = db.entries
            .filter((e: any) => args.includes(e.id))
            .map((e: any) => ({ id: e.id, content: e.content }));
          return { results };
        }
        if (s.includes("FROM passages WHERE entry_id")) {
          const entryIds = args.map((a: any) => String(a));
          const results = db.passages
            .filter((p: any) => entryIds.includes(p.entry_id))
            .sort((a: any, b: any) => (a.start_offset ?? 0) - (b.start_offset ?? 0))
            .map((p: any) => ({ id: p.id, entry_id: p.entry_id, content: p.content, section: p.section ?? null, start_offset: p.start_offset ?? null, end_offset: p.end_offset ?? null }));
          return { results };
        }
        if (s.includes("FROM document_sections ds") && s.includes("JOIN documents d")) {
          // Hierarchy query — return all document sections
          const results = db.document_sections.map((ds: any) => ({
            id: ds.id, title: ds.title, level: ds.level, order_index: ds.order_index, parent_section_id: ds.parent_section_id,
          }));
          return { results };
        }
        if (s.includes("FROM document_sections ds") && s.includes("WHERE ds.title IN")) {
          // Hierarchy query (by passage section names) — match section titles
          const titles = args.map((a: any) => String(a));
          const results = db.document_sections
            .filter((ds: any) => titles.includes(ds.title))
            .sort((a: any, b: any) => a.order_index - b.order_index)
            .map((ds: any) => ({
              id: ds.id, title: ds.title, level: ds.level, order_index: ds.order_index, parent_section_id: ds.parent_section_id,
            }));
          return { results };
        }
        if (s.includes("FROM entry_snapshots") && s.includes("WHERE entry_id")) {
          const entryId = args[0] as string;
          const results = db.entry_snapshots
            .filter((s: any) => s.entry_id === entryId)
            .map((s: any) => ({ id: s.id }));
          return { results };
        }
        if (s.includes("json_each(entries.tags)") && s.includes("HAVING count > 10")) {
          // Digest-candidate query (nightly compression + /stats): per-tag count of
          // entries that pass the compression eligibility predicate. Cutoff is args[0].
          const cutoff = Number(args[0]);
          const SYSTEM = ["synthesized", "auto-pattern", "duplicate-candidate", "contradiction-resolved", "rolled-up"];
          const counts = new Map<string, number>();
          for (const e of db.entries as any[]) {
            const tags: string[] = JSON.parse(e.tags ?? "[]");
            if (tags.includes("rolled-up") || tags.includes("synthesized") || tags.includes("auto-pattern")) continue;
            if (!(e.importance_score == null || e.importance_score < COMPRESSION_IMPORTANCE_THRESHOLD)) continue;
            const rc = e.recall_count; // NULL/undefined → recall clause is falsy → protected (matches SQL)
            if (!(rc === 0 || (rc < COMPRESSION_MIN_RECALL && e.created_at < cutoff))) continue;
            if (!(e.contradiction_wins == null || e.contradiction_wins === 0)) continue;
            for (const t of tags) {
              if (SYSTEM.includes(t)) continue;
              if (t.startsWith("status:") || t.startsWith("kind:")) continue;
              counts.set(t, (counts.get(t) ?? 0) + 1);
            }
          }
          const results = [...counts.entries()]
            .filter(([, c]) => c > 10)
            .sort((a, b) => b[1] - a[1])
            .map(([tag, count]) => ({ tag, count }));
          return { results };
        }
        if (s.includes("json_each(entries.tags)") && s.includes("GROUP BY value")) {
          // Top tags by frequency — for /stats
          const freq = new Map<string, number>();
          db.entries.forEach((e: any) => {
            (JSON.parse(e.tags ?? "[]") as string[]).forEach(t => freq.set(t, (freq.get(t) ?? 0) + 1));
          });
          const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
          return { results: sorted.map(([value, n]) => ({ value, n })) };
        }
        if (s.includes("json_each(entries.tags)")) {
          // Distinct sorted tags — for /tags
          const tags = new Set<string>();
          db.entries.forEach((e: any) => {
            (JSON.parse(e.tags ?? "[]") as string[]).forEach(t => tags.add(t));
          });
          return { results: [...tags].sort().map(t => ({ value: t })) };
        }
        if (s.includes(`tags NOT LIKE '%"status:%'`) && s.includes(`tags NOT LIKE '%"kind:%'`) && s.includes("ORDER BY created_at ASC LIMIT")) {
          const limitMatch = s.match(/LIMIT\s+(\d+)/i);
          const limit = limitMatch ? parseInt(limitMatch[1], 10) : 25;
          const rows = [...db.entries]
            .filter((e: any) => !String(e.tags).includes('"status:') && !String(e.tags).includes('"kind:'))
            .sort((a: any, b: any) => a.created_at - b.created_at)
            .slice(0, limit)
            .map((e: any) => ({ id: e.id, content: e.content, tags: e.tags }));
          return { results: rows };
        }
        if (s.includes("vector_ids = '[]' AND created_at <") && s.includes("ORDER BY created_at DESC LIMIT")) {
          const cutoff = Number(args[0]);
          const limitMatch = s.match(/LIMIT\s+(\d+)/i);
          const limit = limitMatch ? parseInt(limitMatch[1], 10) : 25;
          const rows = [...db.entries]
            .filter((e: any) => e.vector_ids === '[]' && e.created_at < cutoff)
            .sort((a: any, b: any) => b.created_at - a.created_at)
            .slice(0, limit)
            .map((e: any) => ({ id: e.id, content: e.content, tags: e.tags, source: e.source, created_at: e.created_at }));
          return { results: rows };
        }
        if (s.includes("recall_count, importance_score, contradiction_wins, contradiction_losses FROM entries") && s.includes("ORDER BY created_at DESC") && !s.includes("LIMIT")) {
          // GET /export: entries with optional WHERE filters, newest first, no LIMIT.
          let rows = [...db.entries] as any[];
          if (s.includes("owner_user_id = ? AND tags NOT LIKE ?")) {
            const userId = args[0] as string;
            rows = rows.filter(e => e.owner_user_id === userId && !(JSON.parse(e.tags ?? "[]") as string[]).includes("private"));
          } else if (s.includes("owner_user_id = ? AND tags LIKE ?")) {
            const userId = args[0] as string;
            rows = rows.filter(e => e.owner_user_id === userId && (JSON.parse(e.tags ?? "[]") as string[]).includes("private"));
          } else if (s.includes("tags NOT LIKE ?")) {
            rows = rows.filter(e => !(JSON.parse(e.tags ?? "[]") as string[]).includes("private"));
          }
          const results = rows
            .sort((a: any, b: any) => b.created_at - a.created_at)
            .map((e: any) => ({
              id: e.id, content: e.content, tags: e.tags, source: e.source, created_at: e.created_at,
              recall_count: e.recall_count ?? 0, importance_score: e.importance_score ?? 0,
              contradiction_wins: e.contradiction_wins ?? 0, contradiction_losses: e.contradiction_losses ?? 0,
            }));
          return { results };
        }
        if (s.startsWith("SELECT source_id, target_id, type, weight, provenance, created_at") && s.includes("FROM edges") && !s.includes("WHERE")) {
          // GET /export: the whole edges table.
          const results = db.edges.map((e: any) => ({
            source_id: e.source_id, target_id: e.target_id, type: e.type,
            weight: e.weight, provenance: e.provenance, created_at: e.created_at,
            confidence: e.confidence ?? 1.0,
          }));
          return { results };
        }
        if (s.includes("ORDER BY created_at DESC LIMIT") && s.includes("FROM entries")) {
          const limit = Number(args[args.length - 1]);
          const filterArgs = args.slice(0, -1);
          let argIdx = 0;
          let rows = [...db.entries];
          if (s.includes("tags LIKE ?")) {
            const pattern = String(filterArgs[argIdx++]);
            const tag = pattern.replace(/%"/g, "").replace(/"%/g, "");
            rows = rows.filter((e: any) => (JSON.parse(e.tags ?? "[]") as string[]).includes(tag));
          }
          if (s.includes("created_at >= ?")) {
            const after = Number(filterArgs[argIdx++]);
            rows = rows.filter((e: any) => e.created_at >= after);
          }
          if (s.includes("created_at <= ?")) {
            const before = Number(filterArgs[argIdx++]);
            rows = rows.filter((e: any) => e.created_at <= before);
          }
          if (s.includes("owner_user_id = ?")) {
            const userId = String(filterArgs[argIdx++]);
            rows = rows.filter((e: any) => {
              const tags: string[] = JSON.parse(e.tags ?? "[]");
              return e.owner_user_id === userId || !tags.includes("private");
            });
          }
          rows.sort((a: any, b: any) => b.created_at - a.created_at);
          return { results: rows.slice(0, limit) };
        }
        return { results: [] };
      },
    });

    return {
      bind(...args: any[]) { return makeStmt(args); },
      ...makeStmt([]),
    };
  }

  async exec(_sql: string) { }
  async batch(stmts: any[]) { return Promise.all(stmts.map((s: any) => s.run())); }
  reset() { this.entries = []; this.edges = []; this.users = []; this.edgeProposals = []; }
}
