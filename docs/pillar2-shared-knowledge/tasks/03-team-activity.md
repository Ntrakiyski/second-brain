# S03: Team Activity Endpoint

## What to Build

New REST endpoint `GET /team-activity` that returns recent public entries from all team members with owner attribution.

## Acceptance Criteria

- [ ] `GET /team-activity` returns recent public entries from all users
- [ ] Response includes `owner_user_id` and `username` for each entry
- [ ] Visibility enforced: only public entries returned (no private entries from other users)
- [ ] Optional `?user=<username>` filter returns only that user's public entries
- [ ] Optional `?limit=<n>` parameter (default 20, max 50)
- [ ] Cursor-based pagination via `created_at`
- [ ] Requires authentication (deployment token + user credentials)
- [ ] Tests verify visibility enforcement, user filter, pagination

## File Changes

- `src/routes.ts` — New `GET /team-activity` route handler
- `test/unit/team-activity.test.ts` — New test file

## Blockers

None — can start immediately.
