# 04 — Entry Ownership on Write

**What to build:** Every new memory created via `/capture`, `/append`, `/update`, and MCP tools is stamped with the authenticated user's `owner_user_id`. Existing entries (system user's) are unaffected. The capture path, append path, and MCP write tools all pass user context through.

**Blocked by:** Tickets 01, 03

**Status:** done

---

## Files to modify

### `src/index.ts` — Thread user_id through write paths

**Modify `captureEntry()` signature (line 1993-1999):**
- Add parameter: `ownerUserId: string`
- This propagates from the route handler through to the function

**Modify `captureEntry()` INSERT (line 2061-2063):**
- Change INSERT to include `owner_user_id`:
  ```
  INSERT INTO entries (id, content, tags, source, created_at, vector_ids, owner_user_id)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ```
- Bind `ownerUserId` as the 7th parameter

**Modify `storeEntry()` (line 1174-1218):**
- Add `ownerUserId: string` parameter
- Include in vector metadata (line 1186-1194):
  ```typescript
  owner_user_id: ownerUserId,
  ```

**Modify `/capture` route handler (line 2753):**
- Pass `user_id` (from `requireAuth`) to `captureEntry()`

**Modify `/append` handler (line 2798-2837):**
- The append path calls `captureEntry()` internally when smart-merging — ensure `ownerUserId` is threaded through
- For non-merge appends, the entry already exists — ownership is preserved

**Modify `/update` handler (line 2840-2887):**
- When updating entry content, preserve existing `owner_user_id` (don't change ownership on update)
- If the update triggers a re-capture, pass the existing entry's `owner_user_id`

**Modify MCP tools:**
- `remember` tool (line 2300-2332): Extract `user_id` from MCP session context, pass to `captureEntry()`
- `append` tool (line 2335-2386): Same — extract user_id, pass through
- `update` tool (line 2389-2445): Same — extract user_id, pass through

**Modify `checkDuplicateAndContradiction()` (line 742-883):**
- Add parameter: `ownerUserId: string`
- When checking duplicates, include the owner's entries plus all public entries (visibility filter deferred to ticket 05, but ownership is needed for correct scoping)

**Modify `inferEdgesOnWrite()` (line 511-523):**
- Add parameter: `ownerUserId: string`
- Auto-linked edges should respect ownership (full visibility in ticket 08)

### `test/helpers/make-request.ts` — Already updated from ticket 01
- The `userCredentials` parameter should now be used in all write-path tests

### `test/integration/capture.test.ts` — Add ownership tests
- Test: Captured entry has correct `owner_user_id`
- Test: Different users create entries with different `owner_user_id`
- Test: Legacy auth creates entries owned by system user

### `test/integration/append.test.ts` — Add ownership tests
- Test: Appended entry preserves original owner

### `test/integration/update.test.ts` — Add ownership tests
- Test: Updated entry preserves original owner

### `test/unit/capture-entry.test.ts` — Update function signature
- Update all `captureEntry()` calls to include `ownerUserId` parameter

---

## Acceptance criteria

- [ ] New entries via `/capture` have correct `owner_user_id`
- [ ] New entries via MCP `remember` tool have correct `owner_user_id`
- [ ] Appended entries preserve original owner
- [ ] Updated entries preserve original owner
- [ ] System user's entries retain `_system` owner
- [ ] Different users get different `owner_user_id` values
- [ ] Legacy auth creates entries owned by system user
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
