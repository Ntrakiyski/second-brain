# 10 — Epistemic state machine

**What to build:** Entries have a proper epistemic lifecycle with enforced transitions: candidate → reviewed → canonical → qualified → superseded → retracted. No state skips allowed. A new MCP tool `set_epistemic_status` and REST endpoint validate transitions and return valid next states on error.

**Blocked by:** 06 — Staleness detection (provides the epistemic_status column and initial states)

**Status:** ready-for-agent

---

## Files to modify

### `src/types.ts` — Add state machine definition
- **After the EpistemicStatus type** (from ticket 06): Add `VALID_EPISTEMIC_TRANSITIONS` map:
  ```
  candidate → [reviewed]
  reviewed → [canonical]
  canonical → [qualified, superseded]
  qualified → [canonical, superseded]
  stale → [reviewed, rechecked]
  superseded → [retracted]
  retracted → [] (terminal)
  ```
- Add helper function `isValidTransition(from: EpistemicStatus, to: EpistemicStatus): boolean`

### `src/mcp.ts` — Add `set_epistemic_status` tool
- **After the existing `set_status` tool** (around line ~201): Add new tool `set_epistemic_status` with description: "Transition an entry's epistemic lifecycle state. Validates transitions — returns error with valid next states if transition is invalid."
- Input schema: `{ entry_id: string, new_status: string }` (both required)
- Logic:
  1. Query entry's current `epistemic_status`
  2. Validate transition against VALID_EPISTEMIC_TRANSITIONS
  3. If invalid: return error with `valid_next_states` array
  4. If valid: UPDATE entries SET epistemic_status = ? WHERE id = ?
  5. Return success with old and new status

### `src/routes.ts` — Add `POST /entries/:id/epistemic-status` endpoint
- **After the existing `/entries/:id/status` route**: Add `POST /entries/:id/epistemic-status`
- Request body: `{ status: string }`
- Same logic as MCP tool: validate transition → update → return result
- Returns 400 with `valid_next_states` on invalid transition

### `src/mcp.ts` — Update recall tool to expose epistemic_status
- **In recall tool return**: Include `epistemic_status` in entry metadata (already done in ticket 06, verify it's present)

---

## Acceptance criteria

- [ ] VALID_EPISTEMIC_TRANSITIONS map defined with all valid state transitions
- [ ] `isValidTransition()` helper function works correctly
- [ ] MCP tool `set_epistemic_status` validates transitions before updating
- [ ] REST endpoint `POST /entries/:id/epistemic-status` validates transitions
- [ ] Invalid transitions return error with list of valid next states
- [ ] `retracted` is terminal (no transitions out)
- [ ] `set_status` (existing tool) and `set_epistemic_status` (new tool) coexist — they control different fields
- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
