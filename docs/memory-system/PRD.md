# PRD: Memory Pillar — Phase 1: Foundation

**Version:** 1.0  
**Date:** 2026-07-13  
**Status:** historical implementation plan — superseded by the implemented trust contract

---

> This PRD records the initial ticket plan. The current normative behavior is
> defined by [VISION.md](../VISION.md), [System Architecture](../system-architecture.md),
> and `src/entry-version-service.ts`. In particular, immutable provenance is
> synchronous rather than fire-and-forget, snapshots cover user-visible entry
> state, every episode has one document envelope, recall does not mutate usage
> counters, and retention changes only through explicit owner reinforcement.

## Overview

Phase 1 of the Memory Pillar eliminates destructive updates, enables provenance tracking, adds mutation safety via snapshots, expands the relationship graph with typed relations and confidence scores, and introduces spaced-repetition decay for memory retention scoring.

## User Stories

### As a user who captures memories...
- **I want** my original content preserved forever, even after compression or updates
  - *So that* I can always retrieve what I originally wrote
  - *Acceptance:* Every new capture creates an immutable episode row

### As a user who updates memories...
- **I want** a snapshot created before every change
  - *So that* I can restore to any previous version
  - *Acceptance:* update, append, and compression create snapshots; restore MCP tool works

### As a user who links memories...
- **I want** to express *how* memories relate (contradicts, derives from, supports)
  - *So that* the graph captures real semantic relationships, not just "related to"
  - *Acceptance:* 5 new edge types; confidence scores on all edges

### As a user who recalls memories...
- **I want** old unreferenced memories to fade naturally
  - *So that* recently-used knowledge surfaces above stale facts
  - *Acceptance:* Retention score decays with 30-day half-life from last recall

## Implementation Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Episodes are fire-and-forget (non-fatal) | Capture must not fail if episode creation fails |
| 2 | Snapshots are append-only | No UPDATE or DELETE on snapshots — immutable audit trail |
| 3 | Restore creates NEW entry, never in-place rollback | Preserves full history, eliminates destructive rollback |
| 4 | Confidence is set on first insert, not upserted | Original confidence preserved; weight is what gets stronger on re-link |
| 5 | Default last_recalled_at = created_at for existing entries | Old entries appear "old" but not immediately stale |
| 6 | RETENTION_HALF_LIFE_DAYS = 30 (configurable) | 30-day half-life: 90-day-old unreferenced entry scores ~0.5 |
| 7 | No data migration for new columns | All new columns have backward-compatible defaults |

## Scope

### In Scope (Phase 1)
- Episodes table + entry → episode linking
- Snapshot table + restore MCP tool + REST endpoint
- Typed relations (5 new types) + confidence column on edges
- Spaced repetition decay (retention_score, last_recalled_at)

### Out of Scope (Phase 2-4)
- Bitemporal facts (valid_from/valid_to/recorded_at) — Phase 3
- Staleness detection (epistemic_status) — Phase 3
- Evidence passages (citation-grade granularity) — Phase 4
- Document hierarchy (document → section → passage → claim) — Phase 4
- Recall v2 integration of all systems — Phase 4

## Testing Strategy

- **Unit tests:** Pure functions (getRetentionScore, edge type validation, snapshot creation)
- **Integration tests:** Full capture → episode creation, update → snapshot → restore flow
- **Typecheck:** `npm run typecheck` must pass after each ticket
- **Backward compatibility:** Existing tests must continue passing with no modifications

## Migration Plan

No data migration required. All new tables use `CREATE TABLE IF NOT EXISTS`. All new columns use `ALTER TABLE ADD COLUMN` with backward-compatible defaults. Existing entries are unaffected.

## Success Criteria

- [ ] Every new capture has an immutable episode linked
- [ ] Every mutation creates a snapshot; restore MCP tool works
- [ ] Every recalled fact can be cited to its source episode
- [ ] Memories with 0 recalls in 90+ days score below 0.5 retention
- [ ] 5 new edge types available; confidence scores on all edges
- [ ] All existing tests pass; no regressions
