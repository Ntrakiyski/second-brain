# Goal: Memory System Improvements

Expand Second Brain's memory system so that memory itself becomes an active team member — not a database you query, but a living system that learns, proposes, and operates.

## User Stories

### 1. Any agent, any interface
As a user, I want to connect to my memory through any chat interface (Claude, GPT, Hermes, any MCP-compatible agent) and have that agent know my context — my decisions, my history, my knowledge. The memory works regardless of which agent I'm using.

### 2. Team visibility
As a team member, I want to see what my team is remembering, working on, and deciding. I want to know when someone captures a decision, when a contradiction arises across the team's knowledge, when a new paper changes something we believed. The shared memory is a window into the team's collective intelligence.

### 3. Autonomous memory operation
As a team, we want the memory system to actively operate — not just store and retrieve, but search for new information, scrape sources, test assumptions, propose actions, and expand our knowledge base autonomously. The memory has cores (capabilities) that agents can invoke: researching gaps, monitoring contradictions, extracting claims from papers, proposing deprecations, running overnight. The system evolves itself.

### 4. Contradiction catching
As a team, when someone captures knowledge that conflicts with what we already know, the system catches it and asks: "This contradicts [existing entry from 2 months ago, by teammate X]. Which one is current?" The memory doesn't just store — it validates. It prevents the team from unknowingly operating on outdated or conflicting information.

## Why

The current memory system works well for personal/team note-taking but lacks the guarantees needed for a knowledge system teams trust for technical decisions:
- No way to trace a recalled fact back to its source paper/section
- No temporal tracking — can't answer "what was true in March?"
- Memories never fade — old entries sit forever or get aggressively compressed
- Relations are generic — "related to" tells you nothing about *how*
- No rollback — updates and compression overwrite originals permanently
- Agents connect but don't share context — each conversation starts from zero

## What We're Building

### Critical (blocks citable, trustworthy knowledge)
1. **Episodes** — immutable raw content preserved alongside entries. Compression never touches originals.
2. **Snapshots** — pre-change backups before every mutation. Add `restore` MCP tool.
3. **Evidence passages** — sub-entry granularity. Every research claim links to exact text spans (section, page, offset).

### High (makes graph and lifecycle useful)
4. **Typed relations** — `contradicts`, `derives_from`, `supports`, `evaluates_on`, `has_limitation`. Confidence scores on edges.
5. **Spaced repetition decay** — `retention_score` with configurable half-life. Memories naturally fade unless reinforced.
6. **Importance re-scoring** — importance updated on recall, not frozen at creation time.
7. **Background extraction queue** — async processing with retry and dead-letter. Replace fire-and-forget `ctx.waitUntil()`.

### Medium (improves retrieval quality)
8. **Query expansion** — generate paraphrase variants before search, merge via RRF.
9. **FTS / better keyword search** — move beyond `LIKE '%token%'`.
10. **LLM re-ranking** — bounded re-ranker pass over top candidates.
11. **Stale detection** — Hermes proposes deprecation for entries with 0 recalls in 90+ days.

## Constraints
- Must not break existing MCP tools or REST API
- Must preserve backward compatibility with existing D1 data
- Phase 1 (critical items) must be independently shippable
- All mutations go through existing capture/recall/update paths — no parallel write systems
- Hermes (agent) handles governance proposals; memory system handles storage and retrieval

## Out of Scope (for now)
- Pluggable storage backends (no second backend exists)
- Full GraphRAG community detection (corpus too small)
- Role-based access control (owner/user is fine)
- Bi-temporal fact tracking (valid_from/valid_to on entries — defer to Phase 3)

## Success Criteria
- Any MCP-compatible agent can connect and retrieve team context
- Team members can see each other's public entries and team activity
- Every compressed entry links back to its source episodes (no information loss)
- Every MCP `recall` result includes the entry's confidence-weighted relations
- Memories with 0 recalls in 90+ days score below 0.5 retention
- A snapshot exists before every `update` and `append` operation
- Autonomous cores (research, contradiction monitoring, extraction) run via cron and queue
