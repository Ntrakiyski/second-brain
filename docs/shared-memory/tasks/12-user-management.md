# 12 — User Management & Deactivation

**What to build:** Deployment owner can deactivate other users. When deactivated: public memories stay, private memories are deleted, status becomes `inactive`. Deactivated users cannot log in. User list excludes inactive users.

**Blocked by:** Tickets 01, 05

**Status:** ready-for-agent

---

## Files to modify

### `src/index.ts` — Deactivation endpoint + auth enforcement

**New endpoint: `POST /api/users/:id/deactivate`:**
- Extract user ID from URL path
- Validate: requesting user is the deployment owner (or is deactivating themselves)
  - "Deployment owner" = the user who was created first, or the user matching a specific flag
  - Simpler: any user can deactivate themselves; only the first-created user (owner) can deactivate others
- Update user status: `UPDATE users SET status = 'inactive' WHERE id = ?`
- Delete private memories: `DELETE FROM entries WHERE owner_user_id = ? AND tags LIKE '%\"private\"%'`
  - Cascade delete edges for deleted entries
  - Delete vectors for deleted entries
- Public memories remain untouched

**Modify `resolveUser()` (from ticket 01):**
- After looking up user by username, check `status = 'active'`
- If `status = 'inactive'`, reject with 401 (or 403)
- This prevents deactivated users from authenticating

**Modify `GET /api/users` endpoint (from ticket 01):**
- Filter: `WHERE status = 'active'`
- Deactivated users not shown in dropdown

**Modify `POST /api/users` endpoint (from ticket 01):**
- No changes — new users are always active

**New endpoint: `GET /api/users/:id`:**
- Returns user details (id, username, status, created_at)
- Requires auth
- Used for admin/management purposes

### `test/integration/users-api.test.ts` — Deactivation tests
- Test: User can deactivate themselves
- Test: Owner can deactivate other users
- Test: Non-owner cannot deactivate other users
- Test: Deactivated user's private memories deleted
- Test: Deactivated user's public memories retained
- Test: Deactivated user cannot authenticate
- Test: `GET /api/users` excludes inactive users
- Test: Cascade delete removes edges for deleted private entries

---

## Acceptance criteria

- [ ] `POST /api/users/:id/deactivate` works for owner and self
- [ ] Deactivated user's private memories deleted
- [ ] Deactivated user's public memories retained
- [ ] Deactivated user rejected at auth (cannot log in)
- [ ] `GET /api/users` excludes inactive users
- [ ] Edges cascade-deleted for removed private entries
- [ ] Vectors deleted for removed private entries
- [ ] Non-owner cannot deactivate other users
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
