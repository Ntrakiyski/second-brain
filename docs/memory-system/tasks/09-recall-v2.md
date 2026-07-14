# 09 — Recall pipeline v2: passages + relations + retention

**What to build:** Recall returns enriched results: entries with confidence-weighted relations, retention-scored ranking, and evidence passages. This is the integration slice that wires together tickets 03, 04, and 07 in the recall pipeline. All existing recall behavior is preserved.

**Blocked by:** 03 — Typed relations, 04 — Spaced repetition, 07 — Evidence passages

**Status:** ready-for-agent

---

## Files to modify

### `src/recall.ts` — Main recall pipeline changes
- **Update scoring formula** (wherever finalScore is computed): New formula:
  `finalScore = semanticSimilarity * retentionScore * (1 + graphBoost * avgConfidence)`
  - `retentionScore` from ticket 04 (getRetentionScore())
  - `avgConfidence` from ticket 03 (average confidence of incoming edges)
  - `graphBoost` remains the existing graph expansion multiplier
- **Add relations to results**: For each recalled entry, query linked edges and include in results with type and confidence
- **Add passages to results**: For each recalled entry, query linked passages (from ticket 07) and include top 3 in results
- **Add as_of filtering**: From ticket 05, apply temporal filtering before scoring

### `src/graph.ts` — Graph expansion respects typed relations
- **In BFS traversal**: Include type and confidence in edge data returned to recall
- **Optional**: Weight graph traversal by confidence (higher confidence edges explored first)

### `src/types.ts` — Extend RecallMatch type
- **In RecallMatch interface** (line ~32): Add optional fields:
  - `relations?: Array<{ type: string; confidence: number; targetId: string }>`
  - `passages?: Array<{ id: string; content: string; section?: string; page?: number }>`
  - `epistemicStatus?: string`

### `src/mcp.ts` — Update recall tool return
- **In recall tool**: Include relations, passages, and epistemic_status in returned entry metadata

### `src/routes.ts` — Update REST recall response
- **On `/recall` endpoint**: Include new fields in JSON response

---

## Acceptance criteria

- [ ] Recall returns `relations` array with type and confidence on each edge
- [ ] Recall returns `passages` array with top evidence passages for each entry
- [ ] Scoring formula incorporates retention score and edge confidence
- [ ] Graph expansion includes typed relations and confidence
- [ ] `as_of` filtering applied before scoring
- [ ] All existing recall behavior preserved (backward compatible)
- [ ] New fields are optional in response (omitted when empty)
- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
