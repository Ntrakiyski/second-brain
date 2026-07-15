# S04: Edge Proposals Infrastructure

## What to Build

New `edge_proposals` D1 table and CRUD endpoints (REST + MCP) for the contradiction proposal inbox.

## Acceptance Criteria

- [ ] `edge_proposals` table created on startup (`id`, `source_id`, `target_id`, `type`, `reason`, `proposed_by`, `status`, `created_at`, `resolved_at`)
- [ ] `GET /edge-proposals` returns pending proposals visible to the caller
- [ ] `POST /edge-proposals/:id/approve` creates the edge and marks proposal approved
- [ ] `POST /edge-proposals/:id/reject` marks proposal rejected
- [ ] MCP tool `list-proposals` returns pending proposals
- [ ] MCP tool `approve-proposal` creates edge and marks approved
- [ ] MCP tool `reject-proposal` marks rejected
- [ ] Deduplication: only one pending proposal per `(source_id, target_id, type)`
- [ ] Any authenticated user can approve/reject
- [ ] Tests verify CRUD lifecycle, deduplication, authorization

## File Changes

- `src/db.ts` — Add `edge_proposals` table DDL to `initializeDatabase()`
- `src/routes.ts` — New `/edge-proposals` endpoints
- `src/mcp.ts` — New `list-proposals`, `approve-proposal`, `reject-proposal` tools
- `test/unit/edge-proposals.test.ts` — New test file

## Blockers

None — can start immediately.
