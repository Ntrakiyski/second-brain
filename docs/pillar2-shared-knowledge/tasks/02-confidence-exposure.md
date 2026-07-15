# S02: Confidence Exposure

## What to Build

Wire the `confidence` field through all edge response surfaces: graph view, connections, export, and MCP connections tool.

## Acceptance Criteria

- [ ] `GET /graph` edges include `confidence` field: `{ source, target, type, weight, confidence }`
- [ ] `GET /connections` entries include `confidence` on each connection
- [ ] `GET /export` edges include `confidence` field
- [ ] MCP `connections` tool displays confidence percentage in output text
- [ ] `Connection` TypeScript interface includes `confidence: number`
- [ ] All existing tests pass, new tests verify confidence in each response

## File Changes

- `src/graph.ts` — Update `buildGraph()` to include confidence in edge response; update `getConnections()` to include confidence
- `src/types.ts` — Add `confidence` to `Connection` interface
- `src/routes.ts` — Update `GET /export` to include confidence
- `src/mcp.ts` — Update `connections` tool output to show confidence
- `test/unit/graph.test.ts` — Tests for confidence in graph and connections responses
- `test/unit/export.test.ts` — Test for confidence in export

## Blockers

Depends on S01 (confidence defaults must be correct before exposing them).
