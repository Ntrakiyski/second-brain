# Changelog

## Research Notes

- 2026-07-13: Completed deep research brief on KG memory refinement for AI memory systems, focused on Graphiti/Zep typed edges, temporal contradiction handling, confidence-scoring gaps, auto-link quality controls, and pruning heuristics. Saved canonical artifact to `outputs/deepresearch-kg-memory-typed-relations-confidence-contradictions.md` with provenance sidecar.
- 2026-07-13: Added embedding-model comparison brief for short-text semantic search across `BAAI/bge-small-en-v1.5`, `intfloat/e5-small`, `thenlper/gte-small`, and `nomic-ai/nomic-embed-text-v1.5`. Main conclusion: for native 384-d models, BGE-small > GTE-small > E5-small; Nomic v1.5 is strongest overall among the set but is natively 768-d and relies on Matryoshka truncation for 384-d deployment. Saved canonical artifact to `outputs/deepresearch-embedding-small-models-bge-e5-gte-nomic-2026-07-13.md`.

## v2.1.0 — Memory Pillar (July 2026)

### Episodes & Bitemporal Tracking
- **Immutable episode ledger** — every capture/append/merge creates an `episodes` row preserving raw content history
- **Bi-temporal columns** on `entries`: `valid_from` (when fact became true) and `valid_to` (when superseded), plus `recorded_at`
- **Contradiction handling** closes the old entry's validity window (`valid_to`) when a newer fact wins

### Passage-Level Recall
- **Content chunking** — entries are split into overlapping passages (~1500 chars, ~400 overlap) for citation-level retrieval
- **Passage vectorization** — each chunk gets its own Vectorize embedding for fine-grained semantic search
- **Section-aware chunking** — markdown headers create section boundaries; passages carry `section` metadata
- **Document hierarchy** — markdown content auto-generates `documents` + `document_sections` tables for structured recall

### Typed Relations
- **16 edge types** (up from 12): `relates_to`, `supersedes`, `caused_by`, `decided`, `about_person`, `part_of_project`, `follows`, `derives_from`, `supports`, `evaluates_on`, `has_limitation`, `contradicts`, `temporal_after`, `temporal_before`, `prerequisite`, `context_for`
- **Directed edges** — new types enforce source→target semantics

### Spaced Repetition & Staleness
- **Retention scoring** — exponential decay with configurable half-life (`RETENTION_HALF_LIFE_DAYS = 30`)
- **Recall scoring formula** — `semanticSimilarity × retentionScore × (1 + graphBoost × avgConfidence)` with stale penalty
- **Staleness detection** — entries older than 180 days with no recalls marked `status:stale`; low-confidence incoming edges also trigger staleness
- **Recall count tracking** — `last_recalled_at` and `recall_count` updated on every recall

### Epistemic State Machine
- **5 epistemic statuses**: `canonical`, `draft`, `hypothesis`, `deprecated`, `refuted`
- **Validated transitions** — `VALID_EPISTEMIC_TRANSITIONS` enforces allowed state changes (e.g., `draft→canonical` yes, `refuted→canonical` no)
- **REST + MCP endpoints** — `PATCH /entries/:id/epistemic-status` and MCP `set-epistemic-status` tool

### Snapshot Protection
- **Pre-mutation snapshots** — every append, update, merge, and compression creates an `entry_snapshots` backup
- **`createSnapshot()` helper** — single function used by all mutation paths (deduplicated from 5 copy-pasted patterns)

### Code Quality
- **745 tests across 74 files** — all passing, typecheck clean
- **D1Mock expanded** — handlers for `entry_snapshots`, `episodes`, `passages`, `documents`, `document_sections`, table-specific `WHERE id` lookups
- **Deduplicated header parsing** — `chunkIntoPassages()` returns both chunks and headers; `createPassagesForEntry()` reuses them

### New Test Suites
- `create-snapshot.test.ts`, `bitemporal.test.ts`, `epistemic-state-machine.test.ts`, `staleness.test.ts`, `epistemic-status-rest.test.ts`, `recall-relations.test.ts`, `document-hierarchy.test.ts`, `passage-creation.test.ts`, `passage-chunking.test.ts`

---

## v2.0.0 — Shared Memory (July 2026)

### Multi-User Team Memory

Second Brain v2 transforms the single-user memory system into a **multi-user shared memory platform** where a team can store, recall, and cross-reference memories together — with strict privacy boundaries.

### New Features

#### Accounts & Auth
- **Per-user accounts** with individual API keys (`sbu_xxx.yyy` format, HMAC-SHA-256 hashed)
- **Two-step auth flow:** deployment token connects to the server → select or create your account
- **User key generation** from the dashboard with one-time key reveal
- **Deployment owner** can create and deactivate accounts
- **Sidebar username display** shows who you're logged in as

#### Ownership & Visibility
- Every entry has an `owner_user_id` tracking who created it
- **Private entries** (tagged `private`) are only visible to their owner
- **Public entries** are visible to everyone — shared team knowledge
- **Visibility enforcement** on all endpoints: list, recall, graph, connections, export, chat, digest, count, tags, stats
- **Ownership checks** prevent unauthorized forget/link/unlink operations
- **User filter dropdown** + **visibility filter** in the dashboard sidebar

#### Per-User Operations
- **Compression** runs independently per user (nightly cron iterates active users)
- **Stats** (`/count`, `/tags`, `/stats`) scoped to each user's visible entries
- **Export modes:** my public, all public, my private
- **Vector metadata** includes `owner_user_id` and `is_private` for filtered recall

#### Cross-User Features
- **Conflict detection** surfaces when you store something similar to another user's public memory
- **Graph edges** connect public entries across users; private entries stay isolated
- **Account deactivation** cleans up private entries while preserving public ones

#### Security
- **Constant-time HMAC comparison** prevents timing side-channel attacks
- **LIKE wildcard escaping** prevents SQL injection via tag patterns
- **Owner self-deactivation guard** — last active user cannot deactivate
- **Keyword search** enforces visibility (only scoped entries returned)

### Dashboard UI
- **Two-step login:** URL + deployment token → user dropdown + API key or create account
- **Owner badges** and **privacy lock icons** on memory cards
- **User filter** and **visibility filter** dropdowns
- **Forget button** uses REST API (no more MCP SSE parsing issues)

### Backend Changes
- **`users` table** with `id`, `username`, `normalized_username`, `auth_key_hash`, `auth_key_prefix`, `status`
- **`owner_user_id` column** on entries, backfilled with `_system` for legacy entries
- **`buildVisibilityClause(userId)`** helper enforcing `(owner_user_id = ? OR tags NOT LIKE '%"private"%')`
- **`resolveUser(request, env)`** validates `X-Second-Brain-User` + `X-Second-Brain-User-Key` headers
- **`escapeLikePattern(s)`** helper escapes `%` and `_` in tag patterns
- **Per-user MCP** — `apiHandler.fetch` resolves userId from headers, all 10 MCP tools scoped

### Test Coverage
- **702 tests across 65 test files** — all passing, typecheck clean
- New test suites: `auth.test.ts`, `users-api.test.ts`, `visibility.test.ts`, `migration.test.ts`, `entry-ownership.test.ts`, `vector-metadata.test.ts`, `cross-user-conflict.test.ts`, `mcp-user-context.test.ts`, `per-user-compression.test.ts`

### Breaking Changes
- Single-user auth flow replaced with two-step deployment-token + user-account flow
- `AUTH_TOKEN` is now the deployment token only — user API keys are separate
- Legacy entries assigned to `_system` user (public, visible to all)

### Migration
- Existing entries automatically assigned to `_system` user on startup
- `_system` user created with `status = 'inactive'` (cannot authenticate)
- No data loss — all legacy entries remain accessible as public

---

## Research Notes (July 2026)

- Added deep research brief: `outputs/graphiti-bitemporal-memory-deepresearch-2026-07-13.md`
- Topic: Graphiti temporal fact invalidation, bi-temporal modeling for AI memory, and temporal query patterns
- Verification: inspected official Graphiti README/releases plus local code paths for `valid_at`, `invalid_at`, `reference_time`, and edge invalidation logic
- Blocker: alphaXiv paper fetch failed during this run; literature summary used web/arXiv retrieval instead

## Research notes (July 2026)

- Added deep-research brief: `outputs/spaced-repetition-decay-curves-for-ai-agent-memory-systems.md`
- Investigated spaced repetition / forgetting-curve models for AI agent memory systems.
- Main findings: exponential half-life is a good baseline prior; SM-2 is mostly a heuristic scheduler; recent LLM-agent evidence favors multi-factor retention scoring with utility, age, access frequency, redundancy, and trust/risk signals.
- Blocker: alphaXiv paper search failed (`fetch failed`), so the brief relies on web-accessed primary sources and extracted PDFs.
- Open gap: no strong primary-source evidence found for exact optimal half-life constants by AI memory type (`tasks` vs `context` vs `facts`).

## v1.x (pre-fork)

- Single-user memory system
- Memory graph with automatic edge inference
- Notion sync integration
- Graceful Vectorize degradation
- OAuth-based MCP auth
- Dashboard with recall, recent, remember, and graph tabs
