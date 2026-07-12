# 08 — Graph & Connection Visibility

**What to build:** The knowledge graph shows only memories the user is authorized to see. Cross-user public connections are visible (e.g., "Nik and Partner both mentioned Arete"). Private memories connect only to the owner's other private memories. `runGraphPass` and `inferEdgesOnWrite` respect visibility rules.

**Blocked by:** Ticket 05

**Status:** ready-for-agent

---

## Files to modify

### `src/index.ts` — Graph visibility enforcement

**Modify `buildGraph()` (line 417-494):**
- Add `userId: string` parameter
- When assembling nodes, filter by visibility: include user's own entries + all public entries
- When assembling edges, only include edges where BOTH source and target are visible to the user
- This is the dashboard graph view

**Modify `expandGraph()` (line 282-343):**
- Add `userId: string` parameter
- During BFS traversal, skip nodes that are not visible to the user
- This affects multi-hop recall graph expansion

**Modify `getConnections()` (line 373-395):**
- Add `userId: string` parameter
- After fetching 1-hop neighbors, filter by visibility

**Modify `createEdge()` (line 195-221):**
- Add visibility validation: before creating an edge, check that both source and target entries are visible to each other given the owner context
- Private entries can only connect to the same owner's entries
- Public entries can connect to any public entry
- This is the core connection rule enforcement

**Modify `inferEdgesOnWrite()` (line 511-523):**
- Add `userId: string` parameter
- When auto-linking new entries, only create edges between entries that are mutually visible
- Cross-user edges only between public memories

**Modify `runGraphPass()` (line 1561-1605):**
- When backfilling unlinked entries, respect visibility:
  - Only create edges between entries visible to the same user context
  - Cross-user edges only between public memories
- When pruning weak edges, no visibility change needed (pruning is universal)

**Modify `GET /graph` handler (line 3167):**
- Pass `user_id` to `buildGraph()`

**Modify `GET /connections` handler (line 3126):**
- Pass `user_id` to `getConnections()`

**Modify MCP `connections` tool (line 2580-2599):**
- Extract user_id from MCP session, pass to `getConnections()`

### `test/integration/graph.test.ts` — Graph visibility tests
- Test: Graph nodes exclude other users' private entries
- Test: Graph edges between public entries across users exist
- Test: No cross-visibility edges (private-to-other-user's-private)
- Test: User sees their own private entries in graph

### `test/integration/connections.test.ts` — Connection visibility tests
- Test: Connections exclude other users' private entries
- Test: Cross-user public connections visible

### `test/unit/graph-pass.test.ts` — Graph pass visibility tests
- Test: `runGraphPass` creates cross-user edges only between public entries
- Test: `runGraphPass` does not create edges involving other users' private entries

### `test/unit/edges.test.ts` — Edge creation visibility tests
- Test: `createEdge` rejects edge between private entries of different owners
- Test: `createEdge` allows edge between public entries of different owners
- Test: `createEdge` allows edge between entries of the same owner

---

## Acceptance criteria

- [ ] Graph nodes exclude other users' private memories
- [ ] Graph edges between public memories across users exist
- [ ] No cross-visibility edges are created (private-to-other-user's-private)
- [ ] `createEdge` validates visibility before creating edges
- [ ] `inferEdgesOnWrite` respects visibility rules
- [ ] `runGraphPass` respects visibility rules during backfill
- [ ] User sees their own private entries in graph
- [ ] Cross-user public connections visible in graph
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
