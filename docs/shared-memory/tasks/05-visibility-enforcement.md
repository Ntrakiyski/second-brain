# 05 — Visibility Enforcement (Backend)

**What to build:** The `private` tag is system-enforced. Every query that reads memories filters by visibility: users see their own private memories + all public memories, never others' private memories. Applies to all read endpoints. The `private` tag on creation is respected.

**Blocked by:** Ticket 04

**Status:** ready-for-agent

---

## Files to modify

### `src/index.ts` — Visibility filter helper + query modifications

**New helper function (near `buildEntryFilterQuery` at line 1151):**
```typescript
function buildVisibilityClause(userId: string): { sql: string; bind: string[] } {
  // Returns a WHERE clause fragment:
  // (owner_user_id = ? OR tags NOT LIKE '%private%')
  // First bind param is userId
  return {
    sql: `(owner_user_id = ? OR tags NOT LIKE '%\"private\"%')`,
    bind: [userId],
  };
}
```

**Modify `buildEntryFilterQuery()` (line 1151-1169):**
- Add `userId?: string` parameter
- When `userId` is provided, append visibility clause to the WHERE conditions
- Used by: `GET /list`, MCP `list_recent` tool

**Modify `GET /list` handler (line 2967):**
- Pass `user_id` to `buildEntryFilterQuery()`

**Modify `GET /entry` handler (line 3141):**
- After fetching entry by ID, check visibility: if entry is private AND owner is not the requesting user, return 404 or 403

**Modify `recallEntries()` (line 1727-1961):**
- Add `userId: string` parameter
- **Tag-scoped path (line 1771):** After fetching entries by tag, filter out other users' private entries before scoring
- **Default Vectorize path (line 1793):** Post-filter results to exclude other users' private entries
- **Keyword search path:** Add visibility clause to the LIKE query
- Apply visibility BEFORE feeding results to RRF fusion (line ~1830)

**Modify `GET /recall` handler (line 3020):**
- Pass `user_id` to `recallEntries()`

**Modify `checkDuplicateAndContradiction()` (line 742-883):**
- Add `userId: string` parameter
- When querying Vectorize for similar entries (line 750), post-filter to include only: the user's own entries + all public entries
- This means duplicate detection scans the correct scope

**Modify `GET /connections` handler (line 3126):**
- After fetching connections, filter out entries that are private and not owned by the requesting user

**Modify `GET /graph` handler (line 3167):**
- Pass `user_id` to `buildGraph()` (line 417)
- In `buildGraph()`, filter nodes by visibility before assembling the subgraph

**Modify `POST /patterns/resolve` handler (line 3206):**
- Filter pattern entries by visibility

**Modify `POST /chat` handler (line 3240):**
- Pass `user_id` to the recall step within chat

**Modify `GET /digest` handler (line 3267):**
- Filter digest entries by visibility

**Modify `POST /forget` handler (line 3066):**
- Only allow forgetting entries owned by the requesting user (or system user for legacy)

**Modify `POST /link` and `POST /unlink` handlers (lines 3085, 3107):**
- Only allow linking/unlinking entries visible to the requesting user

### `test/helpers/make-env.ts` — Multi-user test database
- Update `makeTestDb()` to create the users table
- Add helper: `seedMultiUserDb(db, userA, userB)` — creates two users and a mix of their private/public entries for testing

### New file: `test/integration/visibility.test.ts`
- Test: User A cannot see User B's private entries via `GET /list`
- Test: User A can see User B's public entries via `GET /list`
- Test: User A cannot see User B's private entries via `GET /entry`
- Test: User A cannot recall User B's private entries via `GET /recall`
- Test: User A can recall User B's public entries via `GET /recall`
- Test: User A cannot see User B's private entries in `GET /graph`
- Test: User A cannot see User B's private entries in `GET /connections`
- Test: User A cannot forget User B's entries
- Test: User A cannot link User B's private entries
- Test: System user's entries (legacy) are visible to all as public

### Update `test/integration/auth.test.ts`
- Verify that authenticated users can access endpoints (not just 401/401 tests)

---

## Acceptance criteria

- [ ] User A cannot see User B's private memories via any endpoint (list, recall, graph, connections, entry, export, chat, digest)
- [ ] User A can see User B's public memories via all endpoints
- [ ] User A sees all their own memories (private and public)
- [ ] The `private` tag is enforced at the application layer, not by client convention
- [ ] Users cannot forget or link/unlink entries they don't own
- [ ] Legacy/system user entries are visible to all as public
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
