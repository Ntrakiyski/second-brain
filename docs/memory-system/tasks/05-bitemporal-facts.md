# 05 — Bitemporal facts

**What to build:** Every entry gets two temporal dimensions: `valid_from`/`valid_to` (when the fact was true in the world) and `recorded_at` (when we learned it). Contradicting evidence sets `valid_to` on the old entry and creates a new one. Recall supports an `as_of` parameter to query facts valid at a given timestamp.

**Blocked by:** 01 — Episodes (needs episode linking for provenance chain)

**Status:** ready-for-agent

---

## Files to modify

### `db/schema.sql` — Add temporal columns to entries
- **In the entries CREATE TABLE** (line ~5): Add `valid_from INTEGER`, `valid_to INTEGER` (nullable), `recorded_at INTEGER` to the CREATE TABLE definition

### `src/db.ts` — Add temporal columns via ALTER TABLE
- **In the ALTER TABLE loop** (around line ~92): Add three entries:
  - `ALTER TABLE entries ADD COLUMN valid_from INTEGER`
  - `ALTER TABLE entries ADD COLUMN valid_to INTEGER`
  - `ALTER TABLE entries ADD COLUMN recorded_at INTEGER`
- Add index: `CREATE INDEX IF NOT EXISTS idx_entries_temporal ON entries(valid_from, valid_to)`

### `src/ingest.ts` — Set temporal defaults on capture
- **Inside `captureEntry()` after entry is stored**: Set `valid_from = created_at`, `recorded_at = created_at`, `valid_to = NULL` (currently valid)
- For entries created via merge: keep original `valid_from`, update `recorded_at` to now

### `src/duplicates.ts` — Update contradiction detection to set valid_to
- **In contradiction handling** (where `contradicts` edge is created): Before creating the new entry, set `valid_to = Date.now()` on the old entry being superseded
- The new entry gets `valid_from = Date.now()`, `valid_to = NULL`

### `src/recall.ts` — Add as_of filtering
- **In the main recall query**: Add optional WHERE clause: `AND (valid_from IS NULL OR valid_from <= ?) AND (valid_to IS NULL OR valid_to > ?)` when `as_of` parameter is provided
- **In recall function signature**: Add optional `asOf?: number` parameter

### `src/routes.ts` — Add as_of query parameter
- **On the `/recall` and `/list` endpoints**: Accept `as_of` query parameter (Unix timestamp)
- Pass to recall function when provided

### `src/mcp.ts` — Add as_of parameter to recall tool
- **In the recall tool schema**: Add optional `as_of` parameter (number, description: "Unix timestamp — return only facts valid at this time")

---

## Acceptance criteria

- [ ] `entries` table has `valid_from`, `valid_to`, `recorded_at` columns
- [ ] New entries get: valid_from = created_at, recorded_at = created_at, valid_to = NULL
- [ ] Contradiction detection sets valid_to on old entry, creates new entry with new valid_from
- [ ] Recall `as_of` parameter filters: `valid_from <= as_of AND (valid_to IS NULL OR valid_to > as_of)`
- [ ] Existing entries (temporal columns NULL) are treated as currently valid (no filtering)
- [ ] Index on (valid_from, valid_to) for efficient as_of queries
- [ ] REST endpoints accept as_of query parameter
- [ ] MCP recall tool accepts as_of parameter
- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
