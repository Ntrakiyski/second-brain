# 07 — Evidence passages

**What to build:** When research is ingested, the system creates passage-level entries linked to source episodes. Each passage has section, page, and position metadata. Recall returns passages alongside entries for citation. Passages get their own vector embeddings for semantic search.

**Blocked by:** 01 — Episodes (passages link to episodes for provenance)

**Status:** ready-for-agent

---

## Files to modify

### `db/schema.sql` — Add passages table
- **After the entry_snapshots table**: Add `CREATE TABLE IF NOT EXISTS passages` with columns:
  - `id TEXT PRIMARY KEY` (UUID)
  - `entry_id TEXT NOT NULL` (FK to entries.id — the claim this passage supports)
  - `episode_id TEXT` (FK to episodes.id — the source document)
  - `content TEXT NOT NULL` (the passage text)
  - `section TEXT` (section header, e.g., "3.2 Methodology")
  - `page INTEGER` (page number, nullable for web content)
  - `start_offset INTEGER` (character offset in source)
  - `end_offset INTEGER` (character offset in source)
  - `vector_ids TEXT NOT NULL DEFAULT '[]'` (Vectorize IDs for this passage)
  - `created_at INTEGER NOT NULL`
- Add index `idx_passages_entry_id ON passages(entry_id)`
- Add index `idx_passages_episode_id ON passages(episode_id)`

### `src/db.ts` — Add passages table to initializeDatabase()
- **After the entry_snapshots table creation**: Add `CREATE TABLE IF NOT EXISTS passages` mirroring schema.sql

### `src/types.ts` — Add Passage type
- **After the EntrySnapshot type**: Add `Passage` interface with fields: id, entryId, episodeId, content, section, page, startOffset, endOffset, vectorIds, createdAt

### `src/ingest.ts` — Chunking logic for passage creation
- **New function `createPassages()`**: Takes entry content + episode content → chunks into passages using sentence-level splitting (512 token chunks, 128 token overlap)
- **Section detection**: Parse markdown headers (##, ###) to extract section names
- **Page detection**: For PDF content, extract page numbers from source metadata
- **Called after episode creation**: When entry has an episode, create passages from episode content and link them to the entry

### `src/ingest.ts` — Vectorize passages
- **After passage creation**: For each passage, create vector embedding via `env.AI.run()` and store in Vectorize
- Store vector_ids in passage row (same pattern as entry vectorization)

### `src/recall.ts` — Return passages with entry results
- **In the recall pipeline**: After scoring entries, for top results, query linked passages
- **Passage retrieval**: `SELECT * FROM passages WHERE entry_id IN (?) ORDER BY created_at DESC LIMIT 5` per entry
- **In RecallMatch type**: Add optional `passages` field (array of passage objects)

### `src/recall.ts` — Passage-aware semantic search
- **Optional enhancement**: When recall query is highly specific, also search passage vectors directly (not just entry vectors) for better citation accuracy

---

## Acceptance criteria

- [ ] `passages` table created with correct schema on startup
- [ ] Ingestion pipeline chunks research content into passages with metadata
- [ ] Passages linked to both entry (claim) and episode (source)
- [ ] Passages get their own vector embeddings
- [ ] Recall returns top passages alongside entry results
- [ ] Passage chunking uses sentence-level with overlap
- [ ] Section headers extracted from markdown content
- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
