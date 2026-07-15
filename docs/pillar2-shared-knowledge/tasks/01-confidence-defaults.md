# S01: Confidence Defaults by Provenance

## What to Build

Change `createEdge()` to set confidence based on provenance type instead of using a flat default of 0.5 for everything.

## Acceptance Criteria

- [ ] Explicit edges (user-created via MCP `link` or REST `POST /link`) get confidence = 1.0
- [ ] Inferred edges (auto-linked via `inferEdgesOnWrite`) get confidence = weight (cosine similarity)
- [ ] System edges (supersedes from contradiction resolution) get confidence = 1.0
- [ ] Callers that already pass `confidence` are unaffected (explicit value overrides default)
- [ ] Existing tests pass, new tests verify confidence defaults per provenance

## File Changes

- `src/graph.ts` — Update `createEdge()` to compute default confidence from provenance
- `test/unit/edges.test.ts` — Add tests for confidence defaults per provenance type

## Blockers

None — can start immediately.
