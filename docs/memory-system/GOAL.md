# Goal: Memory Pillar — The Foundation

Build the next-level memory system that everything else stands on. Provenance, temporality, lifecycle, citations, decay — the foundation that makes every claim citable, every fact time-aware, and every memory naturally decaying.

## Why

- No way to trace a recalled fact back to its source paper/section
- No temporal tracking — can't answer "what was true in March?"
- Memories never fade — old entries sit forever or get aggressively compressed
- Relations are generic — "related to" tells you nothing about *how*
- `updateEntry()` destructively overwrites content with no recovery path
- Epistemic errors correlate r=-0.65 with task failure (HELM, 2025) — we can't detect staleness

> Note: Compression is already non-destructive — originals are tagged `rolled-up` with `[Digest: id]` appended. The real destruction happens in `updateEntry()` and merge flows.

## What We're Building

### Phase 1: Foundation (Days 1-2)
*Eliminate destructive updates, enable provenance, mutation safety*

1. **Episodes** — immutable raw content preserved alongside entries. Every new capture creates an episode row. Compression still works as-is (rolled-up entries coexist with episodes). Episode linking gives us clean joins and passage linking for Phase 4.
2. **Verbatim storage** — subsumed by episodes. Original text always available alongside compressed digests.
3. **Backup snapshots** — pre-change backups before every `update`, `append`, and compression. Add `restore` MCP tool. Restore creates a NEW entry (never in-place rollback) to preserve full history.
4. **Typed relations + confidence** — `contradicts`, `derives_from`, `supports`, `evaluates_on`, `has_limitation`. Confidence scores (0.0-1.0) on all edges. Adding a new type = one line in EDGE_TYPES.

### Phase 2: Lifecycle (Days 2-3)
*Graceful forgetting, fresh entries surface, corpus stays healthy*

5. **Spaced repetition decay** — `retention_score` with configurable half-life (30 days default). Decays from time-since-last-recall, not age-since-creation. Memories fade unless reinforced. Existing entries default `last_recalled_at = created_at` — old unreferenced knowledge correctly decays.

### Phase 3: Temporal Truth (Days 4-6)
*"What did we believe in March?" becomes answerable*

6. **Bitemporal facts** — `valid_from`/`valid_to` (when fact was true) + `recorded_at` (when we learned it) on ALL entries. Old facts invalidated structurally, never deleted. Both versions survive. Contradiction detection sets `valid_to` on superseded entries.
7. **Staleness detection** — epistemic validity tracking. Staleness triggers: contradicting evidence arrived, confidence < 0.5, age > 180 days with no recall. Source rechecking deferred to Phase 4+.

### Phase 4: Citations (Days 7-14+)
*Transforms from note-taking app to citable research tool*

8. **Evidence passages** — sub-entry granularity for research content only. Every research claim links to exact text spans (section, page, offset). Recall returns passages alongside entries. Passages get their own vectors (10x vector cost — acceptable at current scale).
9. **Document hierarchy** — `document → section → passage → claim` for ingested research only. Conversational notes don't need hierarchy. Separate tables, optional linking via `episode_id`.

## Resolved Design Decisions

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | Compression already preserves originals (rolled-up). Do we need episodes? | Yes, still needed | rolled-up is a compression side effect, not general provenance. updateEntry() is destructive. Episodes give clean joins, immutability, passage linking. |
| 2 | How do we backfill episodes for existing entries? | We don't | New entries get episodes. Existing entries have episode_id = NULL. Queries use LEFT JOIN. No migration. |
| 3 | Does snapshots make updateEntry() slower? | Negligible | One INSERT before UPDATE. D1 batch writes are fast. Append-only, no read-before-write. |
| 4 | Why restore creates new entry instead of in-place rollback? | Immutability | In-place rollback destroys current state — the exact problem we're solving. New entry preserves full history. |
| 5 | Does restore work for pre-migration entries? | No, and that's fine | Pre-migration entries have no snapshots. Known limitation, not a blocker. |
| 6 | Do we retroactively type existing relates_to edges? | No | Existing edges stay as-is. Nightly graph pass can promote via LLM in future. Not in scope. |
| 7 | Default last_recalled_at for existing entries? | created_at | Old entries appear "old" but not immediately stale. 30-day half-life means 90-day-old entry scores ~0.5 — correct behavior. |
| 8 | Bitemporal on ALL entries or just research? | All entries | Every entry is a fact with temporal dimension. Universal columns, richer metadata for research. |
| 9 | Default epistemic_status for existing entries? | canonical | Existing entries are assumed confirmed. New entries start as candidate. |
| 10 | Document hierarchy for all entries or just research? | Research only | Conversational notes don't need hierarchy. Separate tables, optional linking. |
| 11 | Evidence passages vector cost? | 10x, acceptable | Passages only for research content. At current scale (~200 entries), negligible. |
| 12 | How do we detect retracted papers? | We don't (yet) | Staleness based on contradiction, confidence, age. Source rechecking is Phase 4+ enhancement. |
| 13 | status tag vs epistemic_status column — conflict? | Coexist | status = user-facing lifecycle. epistemic_status = system-detected validity. Complement, don't conflict. |
| 14 | Who sets confidence scores on edges? | Two sources | LLM-derived edges get LLM confidence. User-created default to 1.0. Contradiction detection uses embedding distance. |
| 15 | Is 3-week scope realistic? | Tight but feasible | Phase 1-3: ~6 days. Phase 4: 5-7 days. Cut document hierarchy if needed to ship in 2 weeks. |

## Constraints
- Must not break existing MCP tools or REST API
- Must preserve backward compatibility with existing D1 data
- All mutations go through existing capture/recall/update paths
- Each phase must be independently shippable
- Episodes are the prerequisite for everything else
- No data migration — new columns default to backward-compatible values

## Success Criteria
- Every new capture has an immutable episode linked
- Every mutation creates a snapshot; restore MCP tool works
- Every recalled fact can be cited to paper/section/post (Phase 4)
- Memories with 0 recalls in 90+ days score below 0.5 retention
- A snapshot exists before every `update` and `append` operation
- Contradictions create `contradicts` edges with confidence scores
- Bitemporal queries return facts valid at a given timestamp
- Stale entries are detected and proposed for rechecking

## Deliverables
- Episodes table + entry → episode linking
- Snapshot table + `restore` MCP tool
- Bitemporal columns on entries (valid_from, valid_to, recorded_at)
- Retention score + decay half-life on entries
- Typed relations (5 new types) + confidence column on edges
- Staleness detection (contradiction-based, age-based)
- Epistemic state machine (candidate → reviewed → canonical → superseded → retracted)
- Evidence passages table + citation in recall results (Phase 4)
- Document hierarchy tables for research content (Phase 4)
