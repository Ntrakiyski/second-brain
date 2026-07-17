# PRD: Shared Knowledge Base Enhancements (Pillar 2)

**Status:** historical implementation plan — superseded by the implemented trust contract

> This document describes the original `edge_proposals` design. Automated
> contradiction findings now enter the actor-neutral `action_proposals` state
> machine as `edge.publish` proposals. Similarity alone never asserts a
> contradiction, service/system actors cannot review their own work, and
> approval is followed by a fresh policy, visibility, revision, and
> precondition check. See [System Architecture](../system-architecture.md).

## Problem Statement

The shared knowledge base has typed relations and a `confidence` column on edges, but confidence is buried — it defaults to 0.5 for everything, isn't exposed in graph view/connections/export, and doesn't flow through the recall scoring properly. Cross-user contradictions (where user A's entry conflicts with user B's public entry) go undetected — the existing contradiction pipeline only checks within one user's own entries. There is no way to see what the team is capturing in real time.

## Solution

Three enhancements: (1) Expose confidence scores throughout the stack with proper defaults by provenance, (2) Detect cross-user contradictions via dual paths (during recall + nightly cron) with a human-gated proposal inbox, (3) Add a team activity REST endpoint for programmatic access to recent public entries.

---

## User Stories

### Confidence Scores

1. As a user, I want explicit (user-created) links to have confidence 1.0, so that the system reflects my certainty
2. As a user, I want inferred (auto-linked) edges to have confidence equal to the cosine similarity score, so that weak links are distinguished from strong ones
3. As a user, I want system-created edges (supersedes) to have confidence 1.0, so that contradiction resolution is treated as certain
4. As a user, I want the graph view to show confidence on edges, so that I can see how certain each relationship is
5. As a user, I want the connections endpoint to include confidence, so that I know the certainty of each neighbor link
6. As a user, I want the export to include confidence, so that my backups preserve relationship certainty
7. As a user, I want the MCP `connections` tool to display confidence, so that agents can reason about relationship certainty
8. As a user, I want the recall scoring to naturally improve from better confidence values, without formula changes

### Cross-User Contradiction Detection

9. As a user, I want the system to detect when my entry contradicts another user's public entry, so that I am aware of team disagreements
10. As a user, I want contradiction detection to run during recall, so that contradictions are surfaced in real time when relevant entries appear
11. As a user, I want contradiction detection to run nightly, so that contradictions are caught even if neither entry is recalled
12. As a user, I want detected contradictions to propose a `contradicts` edge for my approval, so that I decide whether the conflict is real
13. As a user, I want to approve a proposal to create the `contradicts` edge, so that the relationship is recorded in the graph
14. As a user, I want to reject a proposal to dismiss it, so that false positives don't clutter the graph
15. As a user, I want duplicate proposals for the same entry pair to be deduplicated, so that I don't see the same contradiction twice
16. As a user, I want any team member to be able to approve/reject proposals, so that the team can collaboratively assess contradictions
17. As a user, I want proposals to never expire, so that valid contradictions aren't silently lost

### Team Activity

18. As a user, I want a REST endpoint that returns recent public entries from all team members, so that I can see what the team is capturing
19. As a user, I want to filter team activity by a specific user, so that I can see one person's contributions
20. As a user, I want the endpoint to enforce visibility (only public entries), so that private entries are never exposed
21. As a user, I want cursor-based pagination, so that results are consistent under concurrent writes

---

## Implementation Decisions

### Confidence Defaults by Provenance (ADR-0001)

`createEdge()` gains provenance-aware confidence defaults:
- `explicit` (user link): confidence = 1.0
- `inferred` (auto-link): confidence = weight (cosine similarity score)
- `system` (contradiction/supersedes): confidence = 1.0

Callers that already pass `confidence` are unaffected. Callers that don't pass it get the new defaults. The `confidence` parameter remains optional — no caller changes needed for the default behavior.

### Confidence Exposure

Confidence is added to four response surfaces:
- `buildGraph()` edges: `{ source, target, type, weight, confidence }`
- `getConnections()` return type: add `confidence: number` to `Connection` interface
- `GET /export` edges: add `confidence` field
- MCP `connections` tool output: show confidence percentage in text

The frontend graph display reads the new `confidence` field for edge opacity/tooltip.

### Cross-User Contradiction Detection (ADR-0002)

Dual-path detection:
1. **During recall:** After `recallEntries()` returns results, for each result owned by a different user, run the existing contradiction check (embed + Vectorize query, cosine ≥ 0.85 threshold). If contradiction found, add to `proposed_edges` in the recall response.
2. **Nightly cron:** New `detectCrossUserContradictions()` function scans recent public entries (last 7 days), checks each against other users' public entries for contradictions. Writes to `edge_proposals` table.

Both paths deduplicate by `(source_id, target_id)` — if a pending proposal exists, skip.

### Edge Proposals Table (ADR-0003)

New D1 table:
```sql
CREATE TABLE IF NOT EXISTS edge_proposals (
  id          TEXT PRIMARY KEY,
  source_id   TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'contradicts',
  reason      TEXT NOT NULL DEFAULT '',
  proposed_by TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER,
  UNIQUE(source_id, target_id, type, status)
);
```

New REST endpoints:
- `GET /edge-proposals` — list pending proposals (visibility-scoped)
- `POST /edge-proposals/:id/approve` — create the edge, mark approved
- `POST /edge-proposals/:id/reject` — mark rejected

New MCP tools:
- `list-proposals` — list pending proposals
- `approve-proposal` — approve and create edge
- `reject-proposal` — reject proposal

### Team Activity Endpoint

`GET /team-activity?limit=20&user=<optional>` returns recent public entries from all users.

Response shape: `{ entries: [{ id, content, tags, source, owner_user_id, username, created_at }] }`

Visibility enforced: only public entries (excludes caller's private entries). Cursor-based pagination via `created_at`. Default limit 20, max 50.

### Recall Response Extension

The recall response gains an optional `proposed_edges` field:
```json
{
  "results": [...],
  "proposed_edges": [{
    "source_id": "...",
    "target_id": "...",
    "type": "contradicts",
    "reason": "Entry contradicts user B's entry from March 2026"
  }]
}
```

This field is populated during recall when cross-user contradictions are detected. It does not block or delay recall — detection runs after results are ranked.

---

## Testing Decisions

### Testing Philosophy

Only test external behavior: API responses, MCP tool outputs, edge creation side effects. Don't test internal implementation details (SQL queries, function call order).

### Test Seams

Existing seams leveraged:
- `createEdge()` — test confidence defaults by provoking edges with different provenance values
- `GET /graph`, `GET /connections`, `GET /export` — test confidence appears in responses
- `GET /recall` — test `proposed_edges` in response when cross-user contradictions exist
- `GET /team-activity` — test visibility enforcement, pagination, user filter
- `GET /edge-proposals`, `POST /edge-proposals/:id/approve|reject` — test proposal lifecycle
- MCP tools via `buildMcpServer()` — test `list-proposals`, `approve-proposal`, `reject-proposal`

### Test Categories

1. **Confidence defaults:** Verify explicit/inferred/system edges get correct confidence values
2. **Confidence exposure:** Verify graph, connections, export, MCP connections include confidence
3. **Cross-user contradiction (recall path):** Verify `proposed_edges` appears when recall results contradict another user's public entry
4. **Cross-user contradiction (nightly path):** Verify `detectCrossUserContradictions()` creates proposals
5. **Edge proposal lifecycle:** Verify approve creates edge, reject dismisses, deduplication works
6. **Team activity:** Verify visibility enforcement, user filter, pagination
7. **Integration:** Verify end-to-end flow: capture entry → recall detects contradiction → proposal created → approved → edge exists

### Prior Art

Existing test patterns: `edges.test.ts` for edge creation, `visibility.test.ts` for cross-user isolation, `auth.test.ts` for user scoping. D1Mock with handler guards. `req()` helper for HTTP requests. `userCredentials` for user-scoped requests.

---

## Out of Scope

- Dashboard UI changes for team activity or confidence display
- User-settable confidence (system-calculated only)
- Automatic contradiction edge creation (always gated)
- New Cloudflare bindings or resources
- Confidence-based edge filtering in graph view (show all edges, display confidence visually)
- Multi-user filter on team activity (single user only for now)
- Proposal expiry or auto-rejection
- Epistemic status changes on proposal approval

---

## Further Notes

- The `confidence` column already exists via ALTER TABLE migration. No new column needed.
- The recall scoring formula already uses `confidence` — better defaults naturally improve scores.
- The `edge_proposals` table is the only new D1 table in this feature.
- The nightly contradiction detection should be bounded (max 25 entries per run) to stay within Workers CPU limits.
- The recall-path detection adds latency (~50-100ms per cross-user result checked). This is acceptable for a team tool. If it becomes a concern, results can be limited to checking the top 5 cross-user results.
