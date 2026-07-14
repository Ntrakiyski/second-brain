# 01 — Episodes: immutable raw content

**What to build:** Every new memory capture creates an immutable episode row preserving the original raw content. The link from entry → episode provides provenance. Compression still works as-is (rolled-up entries coexist with episodes). A user can retrieve the original content for any entry via its episode.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

---

## Files to modify

### `db/schema.sql` — Add episodes table
- **After the edges indexes** (after line ~15): Add `CREATE TABLE IF NOT EXISTS episodes` with columns:
  - `id TEXT PRIMARY KEY` (UUID)
  - `entry_id TEXT NOT NULL` (FK to entries.id)
  - `content TEXT NOT NULL` (immutable raw content)
  - `content_type TEXT NOT NULL DEFAULT 'text'` (`'text'` | `'markdown'` | `'url'`)
  - `source TEXT NOT NULL DEFAULT 'api'`
  - `created_at INTEGER NOT NULL`
- Add index `idx_episodes_entry_id ON episodes(entry_id)`

### `src/db.ts` — Add episodes table to initializeDatabase()
- **After the edges table creation** (after line ~85): Add `CREATE TABLE IF NOT EXISTS episodes` mirroring schema.sql
- **After the ALTER TABLE loop** (after line ~100): Add no ALTER statements — episodes is new, all columns present from creation

### `src/types.ts` — Add Episode type
- **After the CaptureResult type** (after line ~52): Add `Episode` interface with fields: id, entryId, content, contentType, source, createdAt

### `src/ingest.ts` — Create episode in captureEntry()
- **Inside `captureEntry()` after the entry is stored** (after the `storeEntry` call around line ~310): Add episode creation — `INSERT INTO episodes (id, entry_id, content, content_type, source, created_at)` using the same content and metadata from the capture
- Episode creation is fire-and-forget (non-fatal) — if it fails, the entry still stores

### `src/ingest.ts` — Create episode in merge flow
- **Inside the merge branch** (around line ~304 where `UPDATE entries SET content = ?` happens): Before the destructive UPDATE, create an episode for the OLD content being replaced

### `src/recall.ts` — Join episodes in recall results
- **In the recall query** (around the main SELECT): Add LEFT JOIN to episodes table to include `episode_content` in results when available
- **In the RecallMatch type return**: Add optional `episodeContent` field

---

## Acceptance criteria

- [ ] `episodes` table created with correct schema on startup
- [ ] `captureEntry()` creates an episode row for every new entry
- [ ] `captureEntry()` merge flow creates episode for old content before overwrite
- [ ] Episode content is never modified after creation (no UPDATE/DELETE on episodes)
- [ ] Existing compressed entries (rolled-up) are unaffected — they have no episodes
- [ ] Recall can return episode content alongside entry results
- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
