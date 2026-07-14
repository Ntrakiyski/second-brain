# ADR-0003: Typed Relations with Confidence Scores

**Status:** Accepted  
**Date:** 2026-07-13  
**Deciders:** Nikolay Trakiyski  

## Context

The relationship graph only supports `relates_to` (auto-inferred) and a few system types (`supersedes`, `caused_by`, etc.). There is no way to express "this contradicts that" or "this derives from that". Edges have `weight` (strength) but no `confidence` (certainty). LLM-derived edges and user-created edges have no distinction in confidence.

## Decision

Add a `confidence` column (REAL, 0.0–1.0, default 1.0) to `edges`. Add five new edge types: `contradicts`, `derives_from`, `supports`, `evaluates_on`, `has_limitation`. All types are code-validated against `EDGE_TYPES` — adding a new type is a one-line change. Confidence is set on first insert, not upserted (preserving the original confidence).

## Consequences

- **Positive:** Richer relationship semantics. Contradiction detection can create `contradicts` edges with LLM confidence.
- **Positive:** Backward compatible — existing edges get confidence = 1.0.
- **Positive:** Code-validated types — no SQL migration needed for new types.
- **Negative:** `createEdge()` gains one more parameter. All callers are updated.
- **Neutral:** Confidence is not used in graph traversal yet (Phase 1). Reserved for Phase 4 recall integration.

## Alternatives Considered

1. **Reuse `weight` for confidence** — semantically different (strength vs certainty). A weak-but-certain link needs both signals.
2. **JSON metadata for confidence** — no SQL indexing, no type safety, harder to query.
3. **SQL CHECK constraint on types** — requires migration for every new type, slower iteration.
