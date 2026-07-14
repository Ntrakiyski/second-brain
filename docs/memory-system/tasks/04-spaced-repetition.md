# 04 — Spaced repetition decay

**What to build:** Retention score decays from time-since-last-recall (not age-since-creation). Recall updates `last_recalled_at`. Entries with 0 recalls in 90+ days score below 0.5 retention. The retention score is used as a multiplier in recall scoring, weakening the current frequency-based multiplier.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

---

## Files to modify

### `db/schema.sql` — Add retention columns to entries
- **In the entries CREATE TABLE** (line ~5): Add `retention_score REAL NOT NULL DEFAULT 1.0` and `last_recalled_at INTEGER` (nullable) to the CREATE TABLE definition

### `src/db.ts` — Add retention columns via ALTER TABLE
- **In the ALTER TABLE loop** (around line ~92): Add two entries:
  - `ALTER TABLE entries ADD COLUMN retention_score REAL NOT NULL DEFAULT 1.0`
  - `ALTER TABLE entries ADD COLUMN last_recalled_at INTEGER`
- Existing entries get retention_score = 1.0, last_recalled_at = NULL (backward compatible)

### `src/config.ts` — Add retention half-life constant
- **After the COMPRESSION constants** (around line ~47): Add `RETENTION_HALF_LIFE_DAYS = 30` — configurable decay half-life in days

### `src/helpers.ts` — Add getRetentionScore() function
- **After the getHalfLifeMs() function** (after line ~84): Add `getRetentionScore(lastRecalledAt: number | null, createdAt: number, now: number): number`
- Formula: `Math.exp(-lambda * daysSinceLastRecall)` where `lambda = Math.log(2) / RETENTION_HALF_LIFE_DAYS`
- If `lastRecalledAt` is NULL, use `createdAt` as fallback (backward compatible)

### `src/recall.ts` — Update scoring to use retention score
- **In the recall scoring logic** (wherever finalScore is computed): Multiply by retention score: `finalScore *= getRetentionScore(entry.last_recalled_at, entry.created_at, Date.now())`
- This weakens the current frequency-based multiplier — retention should dominate

### `src/recall.ts` — Update last_recalled_at on recall
- **After recall returns results**: For each returned entry, update `last_recalled_at = Date.now()` and increment `recall_count`
- This is fire-and-forget (non-fatal) — don't fail the recall if the update fails

---

## Acceptance criteria

- [ ] `entries` table has `retention_score` column (REAL, defaults to 1.0)
- [ ] `entries` table has `last_recalled_at` column (INTEGER, nullable)
- [ ] `getRetentionScore()` implements exponential decay with 30-day half-life
- [ ] Recall updates `last_recalled_at` and increments `recall_count` for returned entries
- [ ] Recall scoring uses retention score as multiplier
- [ ] Entry with 0 recalls for 90+ days has retention < 0.5
- [ ] Existing entries (last_recalled_at = NULL) default to created_at for decay calculation
- [ ] Half-life is a config constant (RETENTION_HALF_LIFE_DAYS)
- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
