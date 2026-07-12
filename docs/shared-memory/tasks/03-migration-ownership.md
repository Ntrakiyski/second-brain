# 03 — Migration & Ownership Assignment

**What to build:** Existing memories are migrated without loss. A `_system` user is created. `owner_user_id` column is added to `entries`. All existing rows are assigned to `_system`. Vectors are re-indexed with `owner_user_id` and `is_private` metadata. Legacy auth continues to work with `_system` as the effective user.

**Blocked by:** Ticket 01

**Status:** done

---

## Files to modify

### `db/schema.sql` — Add owner_user_id to entries

**Modify entries table definition (lines 3-14):**
- Add `owner_user_id TEXT NOT NULL DEFAULT ''` column

**Add new index (after line 17):**
- `CREATE INDEX IF NOT EXISTS idx_entries_owner ON entries(owner_user_id)`

### `src/index.ts` — Migration logic + column addition

**Modify `initializeDatabase()` (line 678-701):**
- Add `ALTER TABLE entries ADD COLUMN owner_user_id TEXT NOT NULL DEFAULT ''` to the ALTER TABLE loop (lines 693-700)
- After table init, run migration logic:
  1. Check if `_system` user exists in users table
  2. If not, create it with `status = 'inactive'`, generate a random key (key never given to anyone)
  3. If `_system` user exists, get its `id`
  4. `UPDATE entries SET owner_user_id = ? WHERE owner_user_id = ''` — assigns all unowned entries to system user
  5. Log migration progress (count of affected rows)

**Modify `requireAuth()` (from ticket 01):**
- Legacy mode (Bearer token only, no user headers): return `user_id = "_system"` (the system user's ID, not the string `"_legacy"`)
- This means legacy clients continue to see all data as if they own it — the system user owns everything pre-migration

**Modify `resolveExternalToken` (line 3476-3481):**
- Legacy mode: return `{ props: { userId: systemUserId } }` where `systemUserId` is looked up from the users table
- Cache the system user ID to avoid repeated lookups

### `src/index.ts` — Vector re-indexing

**Add `reindexVectorsWithOwnership()` function:**
- Called after migration completes (inside `initializeDatabase()` or as a one-shot)
- Finds entries where vectors exist but metadata lacks `owner_user_id`
- For each entry: read current vectors from Vectorize by `vector_ids`, delete old vectors, re-insert with updated metadata including `owner_user_id` and `is_private` (derived from tags containing `'private'`)
- Batch in groups of 20 (Vectorize getByIds limit)
- Use `ctx.waitUntil()` pattern — but since this is initialization, it should complete before the Worker starts serving

**Alternative approach (simpler):**
- Skip vector re-indexing in this ticket — vectors without `owner_user_id` metadata are treated as "owned by system user" by default
- Ticket 09 (Vector Metadata) handles the full re-index
- This avoids blocking the Worker startup on a potentially long re-index operation

### `test/helpers/make-env.ts` — Update test environment
- Ensure `makeTestDb()` (line 33) creates the users table with the `_system` user
- Add helper: `createSystemUser(db)` that inserts the system user and returns its ID

### `test/helpers/make-request.ts` — Legacy auth helper
- Add `legacyReq()` helper that sends only Bearer token (no user headers) for testing legacy mode

### New file: `test/integration/migration.test.ts`
- Test: After initialization, all existing entries have `owner_user_id` set to system user's ID
- Test: System user has `status = 'inactive'`
- Test: System user exists in users table
- Test: Legacy auth (Bearer only) resolves to system user's ID
- Test: New entries created after migration have correct owner_user_id (not system user)

---

## Acceptance criteria

- [ ] `owner_user_id` column exists on entries table with default `''`
- [ ] `_system` user created with `status = 'inactive'`
- [ ] All existing entries assigned to `_system` user on startup
- [ ] Legacy auth (Bearer only) resolves to `_system` user ID
- [ ] No data loss — entry count matches before/after migration
- [ ] Export still works after migration
- [ ] Vector re-indexing deferred to ticket 09 (or completed if feasible)
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
