# S05: Cross-User Contradiction Detection (Recall Path)

## What to Build

During recall, detect when results from other users' public entries contradict the caller's entries. Surface detected contradictions as `proposed_edges` in the recall response.

## Acceptance Criteria

- [ ] After recall results are ranked, for each result owned by a different user, run contradiction check
- [ ] Contradiction check: embed the result entry, query Vectorize for similar entries owned by the caller, check cosine ≥ 0.85
- [ ] If contradiction found, add to `proposed_edges` in recall response
- [ ] `proposed_edges` shape: `[{ source_id, target_id, type: "contradicts", reason }]`
- [ ] Write proposal to `edge_proposals` table (deduplicated by `(source_id, target_id)`)
- [ ] Recall latency impact: limit to top 5 cross-user results checked
- [ ] `proposed_edges` is empty array when no contradictions found (not omitted)
- [ ] Tests verify detection, deduplication, response shape, latency bound

## File Changes

- `src/recall.ts` — Add cross-user contradiction detection after result ranking
- `test/unit/cross-user-contradiction.test.ts` — New test file

## Blockers

Depends on S04 (edge_proposals table must exist to write proposals).
