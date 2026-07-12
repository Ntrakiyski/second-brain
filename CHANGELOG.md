# Changelog

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

## v1.x (pre-fork)

- Single-user memory system
- Memory graph with automatic edge inference
- Notion sync integration
- Graceful Vectorize degradation
- OAuth-based MCP auth
- Dashboard with recall, recent, remember, and graph tabs
