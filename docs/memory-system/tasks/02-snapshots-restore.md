# 02 — Snapshots + restore MCP tool

**What to build:** Every mutation (update, append, compression) creates a snapshot of the entry before changes. A new `restore` MCP tool rolls back to any previous snapshot by creating a NEW entry with the snapshot content — never in-place rollback. The user can see snapshot history for any entry.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

---

## Files to modify

### `db/schema.sql` — Add entry_snapshots table
- **After the episodes table** (after the new episodes CREATE TABLE): Add `CREATE TABLE IF NOT EXISTS entry_snapshots` with columns:
  - `id TEXT PRIMARY KEY` (UUID)
  - `entry_id TEXT NOT NULL` (FK to entries.id)
  - `content TEXT NOT NULL` (snapshot of pre-mutation content)
  - `tags TEXT NOT NULL DEFAULT '[]'` (snapshot of tags at time of mutation)
  - `source TEXT NOT NULL DEFAULT 'api'`
  - `created_at INTEGER NOT NULL`
- Add index `idx_snapshots_entry_id ON entry_snapshots(entry_id)`

### `src/db.ts` — Add entry_snapshots table to initializeDatabase()
- **After the episodes table creation**: Add `CREATE TABLE IF NOT EXISTS entry_snapshots` mirroring schema.sql

### `src/types.ts` — Add EntrySnapshot type
- **After the Episode type**: Add `EntrySnapshot` interface with fields: id, entryId, content, tags, source, createdAt

### `src/ingest.ts` — Create snapshot in updateEntry merge flow
- **Inside the merge branch** (around line ~304 where `UPDATE entries SET content = ?` happens): Before the destructive UPDATE, create a snapshot of the current entry content
- Query current content first: `SELECT content, tags, source FROM entries WHERE id = ?`
- Insert snapshot: `INSERT INTO entry_snapshots (id, entry_id, content, tags, source, created_at)`

### `src/lifecycle.ts` — Create snapshot before compression
- **Inside `compressTag()`** (around line ~220 where original entries are tagged `rolled-up`): Before tagging, create a snapshot for each source entry being compressed
- This preserves the pre-compression state even though originals are kept with `rolled-up` tag

### `src/mcp.ts` — Add `restore` tool
- **After the existing `forget` tool** (around line ~285): Add new tool `restore` with description: "Restore an entry to a previous version by snapshot ID. Creates a new entry with the snapshot content."
- Input schema: `{ snapshot_id: string }` (required)
- Logic: Query snapshot by ID → verify it exists → create new entry via `captureEntry()` with snapshot content → return new entry ID
- Never modify the original entry

### `src/routes.ts` — Add `POST /restore` endpoint
- **After the existing `/forget` route**: Add `POST /restore` endpoint
- Request body: `{ snapshot_id: string }`
- Same logic as MCP tool: query snapshot → create new entry → return new entry ID
- Requires auth (same as other mutation endpoints)

---

## Acceptance criteria

- [ ] `entry_snapshots` table created with correct schema on startup
- [ ] `updateEntry()` merge flow creates a snapshot before overwriting content
- [ ] `compressTag()` creates snapshots for source entries before tagging them rolled-up
- [ ] MCP tool `restore` accepts snapshot_id, creates new entry, returns new entry ID
- [ ] REST endpoint `POST /restore` works with same logic
- [ ] Restore never modifies the original entry — always creates a new one
- [ ] Snapshots are append-only (no UPDATE or DELETE)
- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
