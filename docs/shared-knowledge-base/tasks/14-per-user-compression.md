# 14 — Per-User Compression

**What to build:** Compression runs per-user. Each user's memories compress independently. Within a user, compression works across their private and public memories. The `compressTag` function is scoped to the user's entry set.

**Blocked by:** Tickets 04, 05

**Status:** ready-for-agent

---

## Files to modify

### `src/index.ts` — Per-user compression scoping

**Modify `compressTag()` (line 1458-1521):**
- Add `userId: string` parameter
- When fetching entries for compression, add visibility filter:
  - Include the user's own entries (private + public)
  - Include all other users' public entries (for context)
  - Exclude other users' private entries
- This ensures compression only consolidates the user's own knowledge

**Modify compression eligibility SQL (`compressionEligibilitySql`, line 63-68):**
- Add `owner_user_id` condition to the eligibility query
- Eligible entries = user's entries OR public entries, with sufficient recall count

**Modify `POST /compress` or scheduled compression trigger:**
- If compression is triggered per-tag, iterate over users:
  - For each active user, compress their tag sets
  - This may require changes to how the cron job invokes compression

**Modify scheduled handler (cron):**
- The nightly cron runs compression
- Change to: for each active user, run compression for that user's entries
- This means the cron iterates over users, not just tags

**Modify `synthesizeDigest()` (line 1425-1456):**
- Add `userId: string` parameter
- Scope digest generation to the user's entries + public entries

### `test/integration/misc.test.ts` or new file — Per-user compression tests
- Test: Compression only processes the target user's entries
- Test: Cross-user entries not mixed in compression
- Test: Compression output is user-scoped
- Test: Public entries from other users included as context
- Test: Private entries from other users excluded

### `test/unit/compress-tag.test.ts` — Update function signature
- Update all `compressTag()` calls to include `userId` parameter

---

## Acceptance criteria

- [ ] Compression only processes the target user's entries
- [ ] Cross-user entries not mixed in compression
- [ ] Public entries from other users included as context
- [ ] Private entries from other users excluded
- [ ] Compression output is user-scoped
- [ ] Nightly cron compresses each user independently
- [ ] Digest generation scoped to user's entries
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
