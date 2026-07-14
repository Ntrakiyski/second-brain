# 06 — Staleness detection

**What to build:** Entries automatically detect when stored facts become stale. Staleness triggers: contradicting evidence arrived (valid_to set), confidence < 0.5 on incoming edges, or age > 180 days with no recall. Stale entries are penalized in recall scoring but not hidden. The system proposes rechecking for stale entries.

**Blocked by:** 03 — Typed relations (needs confidence scores on edges), 05 — Bitemporal facts (needs valid_to for contradiction detection)

**Status:** ready-for-agent

---

## Files to modify

### `db/schema.sql` — Add epistemic_status column to entries
- **In the entries CREATE TABLE** (line ~5): Add `epistemic_status TEXT NOT NULL DEFAULT 'canonical'` to the CREATE TABLE definition

### `src/db.ts` — Add epistemic_status column via ALTER TABLE
- **In the ALTER TABLE loop** (around line ~92): Add `ALTER TABLE entries ADD COLUMN epistemic_status TEXT NOT NULL DEFAULT 'canonical'`

### `src/config.ts` — Add staleness constants
- **After the RETENTION_HALF_LIFE_DAYS constant**: Add:
  - `STALENESS_THRESHOLD_DAYS = 180` — age without recall before staleness check
  - `STALENESS_CONFIDENCE_THRESHOLD = 0.5` — confidence below this triggers staleness

### `src/types.ts` — Add EpistemicStatus type
- **After the MemoryStatus type** (around line ~28): Add `EPISTEMIC_STATUS_VALUES = ["candidate", "reviewed", "canonical", "qualified", "stale", "superseded", "retracted"] as const` and `EpistemicStatus` type

### `src/lifecycle.ts` — Add staleness detection to nightly cron
- **In `runNightlyCompression()` or as a new exported function**: Add staleness check pass:
  - Query entries where `valid_to IS NOT NULL` AND `epistemic_status != 'stale'` → transition to stale
  - Query entries where confidence < 0.5 on any incoming edge AND `epistemic_status != 'stale'` → transition to stale
  - Query entries where `age > STALENESS_THRESHOLD_DAYS AND recall_count = 0` → transition to stale
  - Log proposed rechecking (no external API call yet)

### `src/recall.ts` — Penalize stale entries in scoring
- **In the recall scoring logic**: Add staleness multiplier: if `epistemic_status === 'stale'`, multiply score by 0.5 (penalize but don't hide)

### `src/mcp.ts` — Add staleness info to recall results
- **In recall tool return**: Include `epistemic_status` in returned entry metadata

---

## Acceptance criteria

- [ ] `entries` table has `epistemic_status` column (TEXT, defaults to `canonical`)
- [ ] Valid states defined: candidate, reviewed, canonical, qualified, stale, superseded, retracted
- [ ] Nightly cron detects staleness: valid_to set, confidence < 0.5, age > 180 days with no recall
- [ ] Stale entries transition to `epistemic_status = 'stale'`
- [ ] Stale entries penalized in recall scoring (multiplier < 1.0, not hidden)
- [ ] Recall results include epistemic_status in metadata
- [ ] Existing entries default to `canonical` (backward compatible)
- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
