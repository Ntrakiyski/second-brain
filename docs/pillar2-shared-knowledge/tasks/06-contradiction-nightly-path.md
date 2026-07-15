# S06: Cross-User Contradiction Detection (Nightly Path)

## What to Build

Nightly cron job that scans recent public entries for cross-user contradictions and creates proposals in `edge_proposals`.

## Acceptance Criteria

- [ ] New `detectCrossUserContradictions()` function in lifecycle/cron
- [ ] Scans public entries from the last 7 days
- [ ] For each entry, checks against other users' public entries for contradiction (cosine ≥ 0.85)
- [ ] Bounded: max 25 entries per run to stay within Workers CPU limits
- [ ] Writes proposals to `edge_proposals` table (deduplicated by `(source_id, target_id)`)
- [ ] Called from existing `scheduled` handler alongside compression and graph pass
- [ ] Non-fatal: errors logged but don't fail the cron run
- [ ] Tests verify detection, bounding, deduplication, error handling

## File Changes

- `src/lifecycle.ts` — New `detectCrossUserContradictions()` function
- `src/index.ts` — Wire into `scheduled` handler
- `test/unit/cross-user-contradiction-nightly.test.ts` — New test file

## Blockers

Depends on S04 (edge_proposals table must exist to write proposals).
