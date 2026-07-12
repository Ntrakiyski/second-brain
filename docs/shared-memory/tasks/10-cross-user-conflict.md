# 10 — Cross-User Conflict Detection

**What to build:** Duplicate/contradiction detection scans the current user's memories plus all public memories. When similar content is found in another user's public memories, the system mentions it (not flags). Within a user's own memories, existing behavior continues unchanged.

**Blocked by:** Tickets 05, 09

**Status:** ready-for-agent

---

## Files to modify

### `src/index.ts` — Cross-user mention in recall output

**Modify `recallEntries()` (line 1727-1961):**
- Already scans user's entries + public entries (tickets 05 + 09)
- After deduplication and reranking, check for cross-user similar content:
  - If a recalled entry belongs to a different user AND has high similarity (cosine > 0.85) to the query or to the user's own entries, add a `crossUserMention` field
  - Format: `{ entryId, ownerUsername, similarity, type: 'similar' | 'contradicts' }`

**Modify `synthesizeInsight()` (line ~1900 area):**
- When cross-user mentions exist, include them in the insight synthesis:
  - "Note: [username] has a similar memory: [snippet]"
  - This is informational, not a warning

**Modify `checkDuplicateAndContradiction()` (line 742-883):**
- Already scans correct scope from ticket 09
- When a cross-user match is found (score 0.85-0.95):
  - Return `crossUserSimilar: { username, entryId, score }` in addition to existing return values
  - Do NOT flag or block — just mention

**Modify capture path (line 1993-2131):**
- After duplicate check, if `crossUserSimilar` exists:
  - Include in capture response: `"crossUserNote": "Similar content exists in [username]'s public memories"`
  - Do NOT block capture, do NOT create contradiction edge
  - This is purely informational

### `test/integration/recall.test.ts` — Cross-user mention tests
- Test: Recall includes cross-user mention when similar content exists
- Test: Cross-user mention includes owner username
- Test: Cross-user mention does not appear when content is private
- Test: Within-user contradiction handling unchanged

### `test/integration/capture.test.ts` — Cross-user capture tests
- Test: Capture includes crossUserNote when similar public content exists from another user
- Test: Capture does not block when cross-user similarity found
- Test: No contradiction edge created for cross-user similarity

---

## Acceptance criteria

- [ ] Cross-user similar content is mentioned in recall output
- [ ] Cross-user mention includes owner username and similarity score
- [ ] Cross-user mention does not appear for private entries
- [ ] Capture includes crossUserNote when similar public content exists
- [ ] Cross-user similarity does NOT block capture or create contradiction edges
- [ ] Within-user contradiction handling unchanged
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
