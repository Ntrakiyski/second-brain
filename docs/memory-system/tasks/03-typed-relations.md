# 03 — Typed relations + confidence scores

**What to build:** Edges gain a `type` column with validated values and a `confidence` score (0.0–1.0). New relation types: `contradicts`, `derives_from`, `supports`, `evaluates_on`, `has_limitation`. Adding a new type is a one-line change in EDGE_TYPES. Existing `relates_to` edges are unaffected (confidence defaults to 1.0).

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

---

## Files to modify

### `db/schema.sql` — Add confidence column to edges
- **In the edges CREATE TABLE** (line ~13): The `type` column already exists with `DEFAULT 'relates_to'`. Add `confidence REAL NOT NULL DEFAULT 1.0` to the CREATE TABLE definition

### `src/db.ts` — Add confidence column via ALTER TABLE
- **In the ALTER TABLE loop** (around line ~92): Add `ALTER TABLE edges ADD COLUMN confidence REAL NOT NULL DEFAULT 1.0`
- Existing edges get confidence = 1.0 (backward compatible)

### `src/graph.ts` — Expand EDGE_TYPES with new relation types
- **In the EDGE_TYPES object** (line ~37): Add 5 new entries:
  - `contradicts: { directed: true, label: "Contradicts", allowedKinds: null }`
  - `derives_from: { directed: true, label: "Derives from", allowedKinds: null }`
  - `supports: { directed: true, label: "Supports", allowedKinds: null }`
  - `evaluates_on: { directed: true, label: "Evaluates on", allowedKinds: null }`
  - `has_limitation: { directed: true, label: "Has limitation", allowedKinds: null }`

### `src/graph.ts` — Update createEdge() to accept and store confidence
- **In `createEdge()` function** (line ~75): Add `confidence` to the opts parameter: `{ weight?: number; provenance?: EdgeProvenance; metadata?: Record<string, unknown>; confidence?: number }`
- **In the INSERT statement** (line ~106): Add `confidence` column to INSERT and bind `Math.max(0, Math.min(1, opts.confidence ?? 1.0))`
- **In the ON CONFLICT clause** (line ~108): Keep existing weight logic — confidence is set on first insert, not upserted

### `src/graph.ts` — Return confidence in edge queries
- **In edge query functions** (getEdges, getNeighbors, etc.): Add `confidence` to SELECT columns
- **In BFS traversal** (around line ~435): Include confidence in returned edge data

### `src/types.ts` — No changes needed
- Edge type is already defined inline in graph.ts via `typeof EDGE_TYPES`

---

## Acceptance criteria

- [ ] `edges` table has `confidence` column (REAL, defaults to 1.0)
- [ ] `EDGE_TYPES` includes 5 new types: contradicts, derives_from, supports, evaluates_on, has_limitation
- [ ] `createEdge()` validates type against EDGE_TYPES (returns null for unknown types)
- [ ] `createEdge()` accepts confidence parameter (default 1.0)
- [ ] Graph traversal returns type and confidence on edges
- [ ] Adding a new edge type requires only one line change in EDGE_TYPES object
- [ ] Existing edges (relates_to) have confidence = 1.0
- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
