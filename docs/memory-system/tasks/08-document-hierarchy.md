# 08 — Document hierarchy

**What to build:** Research documents are stored as hierarchy: document → section → passage → claim. Each level is a separate table with parent-child relationships. Conversational notes don't need this structure — hierarchy is optional, linked via episode_id.

**Blocked by:** 01 — Episodes (hierarchy links to episodes), 07 — Evidence passages (passages link to sections)

**Status:** ready-for-agent

---

## Files to modify

### `db/schema.sql` — Add document hierarchy tables
- **After the passages table**: Add two tables:
  - `CREATE TABLE IF NOT EXISTS documents` with columns:
    - `id TEXT PRIMARY KEY` (UUID)
    - `title TEXT NOT NULL`
    - `source_url TEXT`
    - `content_type TEXT NOT NULL DEFAULT 'research'` (`'research'` | `'note'` | `'url'`)
    - `created_at INTEGER NOT NULL`
  - `CREATE TABLE IF NOT EXISTS document_sections` with columns:
    - `id TEXT PRIMARY KEY` (UUID)
    - `document_id TEXT NOT NULL` (FK to documents.id)
    - `parent_section_id TEXT` (FK to self — NULL for top-level sections)
    - `title TEXT NOT NULL`
    - `level INTEGER NOT NULL DEFAULT 0` (0=document, 1=section, 2=subsection)
    - `order_index INTEGER NOT NULL DEFAULT 0` (preserves document order)
    - `created_at INTEGER NOT NULL`
- Add index `idx_sections_document_id ON document_sections(document_id)`
- Add index `idx_sections_parent ON document_sections(parent_section_id)`

### `src/db.ts` — Add document hierarchy tables to initializeDatabase()
- **After the passages table creation**: Add `CREATE TABLE IF NOT EXISTS documents` and `CREATE TABLE IF NOT EXISTS document_sections` mirroring schema.sql

### `src/types.ts` — Add Document and DocumentSection types
- **After the Passage type**: Add `Document` interface (id, title, sourceUrl, contentType, createdAt) and `DocumentSection` interface (id, documentId, parentSectionId, title, level, orderIndex, createdAt)

### `src/ingest.ts` — Hierarchy creation for research content
- **New function `createDocumentHierarchy()`**: When ingesting research content (URL or uploaded document):
  1. Create document row
  2. Parse content structure (markdown headers → sections)
  3. Create document_sections with parent-child relationships
  4. Link passages to sections via section_id
- **Called conditionally**: Only for research-type content (URLs, uploaded docs), not for conversational notes

### `src/ingest.ts` — Link entry to document
- **After hierarchy creation**: Set entry's `episode_id` to link to the document's root episode
- This enables navigation: entry → episode → document → sections → passages

### `src/recall.ts` — Navigate hierarchy in recall results
- **In recall pipeline**: When entry has passages with section links, include hierarchy in results
- **Optional navigation endpoint**: `GET /entries/:id/hierarchy` returns full document structure

---

## Acceptance criteria

- [ ] `documents` and `document_sections` tables created with correct schema
- [ ] Ingestion pipeline creates document hierarchy for research content
- [ ] Sections have parent-child relationships (parent_section_id)
- [ ] Sections preserve document order (order_index)
- [ ] Passages link to sections via section_id
- [ ] Entries link to documents via episode_id
- [ ] Conversational notes work without hierarchy (standalone entries)
- [ ] Recall can navigate: entry → passage → section → document
- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
