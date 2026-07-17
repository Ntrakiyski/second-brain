# Goal: Shared Knowledge Base Enhancements

**Status:** implemented; this file preserves the original planning scope.

> The canonical current contract is [VISION.md](../VISION.md) and
> [System Architecture](../system-architecture.md). The generic governed
> `action_proposals` inbox supersedes the legacy contradiction-only inbox for
> automated work. Nightly similarity is candidate generation only; a strict
> contradiction classifier, mandatory audit, human review, and execution-time
> precondition checks are required. Team overlap awareness is durable and is
> delivered to both owners, while every read rechecks public visibility.

Complete the remaining deliverables of VISION.md Pillar 2 — making the shared knowledge base smarter, transparent, and team-aware.

## What We're Building

### 1. Confidence Scores — Fully Exposed
The `confidence` column already exists on `edges` but is buried. Expose it everywhere edges appear: graph view, connections, export, MCP tools, and the dashboard. Confidence is system-calculated (not user-settable) — explicit links default to 1.0, inferred links use cosine similarity.

### 2. Cross-User Contradiction Detection
When a user recalls memories and a result contradicts *another user's* public entry, surface it. Propose a `contradicts` edge for human approval via a proposal inbox. No automatic edge creation — humans decide.

### 3. Team Activity Visibility
A REST endpoint (`GET /team-activity`) that returns recent public entries from all team members. Optional user filter. No dashboard changes — programmatic access only.

## Constraints
- Single-file Worker architecture (all changes in `src/index.ts` area)
- Follow existing TDD pattern (D1Mock, `req()` helper, vitest)
- No new Cloudflare resources (D1 table only for `edge_proposals`)
- Backward-compatible — existing MCP tools and REST endpoints must not break
- Confidence is system-calculated only — no user override

## Out of Scope
- Dashboard UI changes for team activity
- User-settable confidence
- Automatic contradiction edge creation (always gated)
- New Cloudflare bindings
