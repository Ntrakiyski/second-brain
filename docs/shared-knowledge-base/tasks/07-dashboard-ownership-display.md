# 07 — Dashboard Ownership & Visibility Display

**What to build:** The main page shows who created each memory (owner username) and whether it's private or public. Filters for user, visibility, workspace tag, and project tag work. The user sees their own memories plus all public memories.

**Blocked by:** Tickets 05, 06

**Status:** ready-for-agent

---

## Files to modify

### `public/index.html` — Memory list UI updates

**Memory card rendering (in the `loadRecent()` function area, line 3124-3138):**
- Each memory card now shows:
  - Owner username (e.g., "Nik" or "Partner") as a small badge/label
  - Privacy indicator: lock icon for private, globe icon for public
  - These come from the API response (which now includes `owner_username` and visibility info)

**Add filter controls (near the existing tag filter area):**
- User filter dropdown: populated from `/api/users`, defaults to "All users"
- Visibility filter: "All" | "Public only" | "My private only"
- These filters are sent as query params to `GET /list`

**Modify `loadRecent()` function (line 3124-3138):**
- Read filter values from the new dropdown controls
- Append filter params to the `/list` API call: `?n=50&user=<username>&visibility=<mode>`

**CSS:**
- Style the owner badge (small, muted text, positioned near the timestamp)
- Style the privacy icon (lock/globe, small, next to owner badge)
- Style the filter controls row (horizontal, below existing tags)

### `src/index.ts` — List endpoint filter support

**Modify `GET /list` handler (line 2967):**
- Accept new query params: `user` (username filter), `visibility` (`'all'` | `'public'` | `'private'`)
- When `user` param is provided: add `WHERE owner_user_id = (SELECT id FROM users WHERE username = ?)` clause
- When `visibility = 'public'`: add `WHERE tags NOT LIKE '%private%'`
- When `visibility = 'private'`: add `WHERE owner_user_id = ? AND tags LIKE '%private%'` (only own private)
- Combine with existing visibility enforcement from ticket 05

**Modify `GET /list` response:**
- Include `owner_username` in each entry response (JOIN with users table or hydrate separately)
- Include `is_private` boolean derived from tags

**Modify `GET /entry` handler (line 3141):**
- Include `owner_username` in single entry response

### `test/integration/list.test.ts` — Filter tests
- Test: `GET /list?user=nik` returns only nik's entries
- Test: `GET /list?visibility=public` returns only public entries
- Test: `GET /list?visibility=private` returns only own private entries
- Test: `GET /list?user=nik&visibility=public` combines filters
- Test: Response includes `owner_username` field

---

## Acceptance criteria

- [ ] Each memory card shows owner username and privacy indicator
- [ ] User filter dropdown works (filters by username)
- [ ] Visibility filter works (All / Public / My Private)
- [ ] Filters combine correctly
- [ ] `owner_username` included in list and entry API responses
- [ ] `is_private` included in responses
- [ ] Only authorized memories appear (visibility enforcement from ticket 05)
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
