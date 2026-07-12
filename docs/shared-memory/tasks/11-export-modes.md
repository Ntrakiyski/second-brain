# 11 — Export Modes

**What to build:** `GET /export` accepts a `mode` parameter: `my_public`, `all_public`, `my_private`. Default (no mode) returns all public memories. Each mode filters correctly by ownership and visibility.

**Blocked by:** Ticket 05

**Status:** ready-for-agent

---

## Files to modify

### `src/index.ts` — Export endpoint extension

**Modify `GET /export` handler (line 2984-3017):**
- Read `mode` query parameter: `url.searchParams.get("mode")`
- Valid modes: `'my_public'` | `'all_public'` | `'my_private'` | `null` (default)
- **Default / `all_public`:** Current behavior — all entries where tags do NOT contain `'private'`
  - Add visibility filter: `WHERE tags NOT LIKE '%\"private\"%'`
- **`my_public`:** User's entries where tags do NOT contain `'private'`
  - `WHERE owner_user_id = ? AND tags NOT LIKE '%\"private\"%'`
  - Bind `user_id`
- **`my_private`:** User's entries where tags DO contain `'private'`
  - `WHERE owner_user_id = ? AND tags LIKE '%\"private\"%'`
  - Bind `user_id`

**Modify entries query (line ~2990):**
- Current: `SELECT ... FROM entries ORDER BY created_at DESC` (unbounded)
- Change to conditional based on mode:
  - Default: `SELECT ... FROM entries WHERE tags NOT LIKE '%\"private\"%' ORDER BY created_at DESC`
  - `my_public`: `SELECT ... FROM entries WHERE owner_user_id = ? AND tags NOT LIKE '%\"private\"%' ORDER BY created_at DESC`
  - `my_private`: `SELECT ... FROM entries WHERE owner_user_id = ? AND tags LIKE '%\"private\"%' ORDER BY created_at DESC`

**Modify edges query (line ~2998):**
- Filter edges to only include edges where BOTH source and target entries are in the exported set
- This requires a subquery or post-filtering in application code
- Simpler approach: fetch filtered entries first, then filter edges to only those with both endpoints in the entry ID set

**Modify response:**
- Add `mode` field to response: `{ ok: true, mode: "my_public", ... }`
- Add `total_count` field: number of exported entries

### `public/index.html` — Export UI update

**Modify export function (`exportMemories`, line 3835-3894):**
- Before export, show a mode selection dialog:
  - "My public memories" → `?mode=my_public`
  - "All public memories" → `?mode=all_public` (default)
  - "My private memories" → `?mode=my_private`
- Pass selected mode to the `/export` API call

**CSS:**
- Style the export mode selection (modal or dropdown)

### `test/integration/export.test.ts` — Mode tests
- Test: Default export returns all public entries
- Test: `?mode=my_public` returns user's public entries only
- Test: `?mode=all_public` returns all users' public entries
- Test: `?mode=my_private` returns user's private entries only
- Test: Edges filtered to match exported entries
- Test: Export requires auth for all modes
- Test: Invalid mode returns 400

---

## Acceptance criteria

- [ ] `GET /export` with no mode returns all public entries (backward compatible)
- [ ] `?mode=my_public` returns user's non-private entries
- [ ] `?mode=all_public` returns all users' non-private entries
- [ ] `?mode=my_private` returns user's private entries
- [ ] Edges filtered to match exported entry set
- [ ] Response includes `mode` and `total_count`
- [ ] Export UI shows mode selection
- [ ] Auth required for all modes
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
