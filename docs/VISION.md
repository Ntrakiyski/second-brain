# VISION.md

## The Living Memory Organism

A self-evolving knowledge partner that operates your memory, catches what you miss, and proposes what you haven't thought of yet. Memory becomes a team member — not a static database, but a living system that learns, proposes, and operates.

---

## Four Pillars

### 1. Memory
The foundation. A persistent, semantically-searchable knowledge layer that any agent can read and write via MCP. Every memory is citable — traceable back to its source. Every fact is time-aware — you can query what was true when. Memories naturally decay unless reinforced, keeping the knowledge base relevant.

**What this means:**
- Connect through any chat interface (Claude, GPT, Hermes, any MCP-compatible agent)
- Every recalled fact links back to its source paper, section, page
- Temporal tracking — "what did we believe in March?" has an answer
- Spaced repetition — old knowledge fades, useful knowledge persists
- Snapshots before every mutation — rollback is always possible

**Deliverables:**
- Episodes table — immutable raw content preserved alongside entries
- Evidence passages — sub-entry citation granularity (paper, section, page)
- Bitemporal facts — `valid_from`/`valid_to` + `recorded_at` on knowledge
- Retention decay — spaced repetition scoring with configurable half-life
- Snapshot table — pre-change backups before every mutation
- `restore` MCP tool — rollback to any previous snapshot

### 2. Shared Knowledge Base
The team layer. Multiple users and agents share a collective memory with visibility enforcement. You see your own private entries plus the team's public knowledge. When someone captures a decision, makes a discovery, or ingests a paper — the whole team benefits. The shared memory is a window into the team's collective intelligence.

**What this means:**
- See what your team is remembering, working on, and deciding
- Contradictions across the team are caught and surfaced — "this conflicts with what teammate X decided 2 months ago"
- Typed relations — not just "related to" but `contradicts`, `derives_from`, `supports`
- Confidence scores on every relationship — know how certain the system is
- Cross-user awareness — when your work overlaps with a teammate's, you both know

**Deliverables:**
- Typed relations — `contradicts`, `derives_from`, `supports`, `evaluates_on`, `has_limitation`
- Confidence scores on all edges — 0.0–1.0 per relationship
- Cross-user contradiction detection — "this conflicts with teammate X's entry from March"
- Team activity visibility — see what the team is capturing and deciding
- Visibility enforcement — private entries stay private, public entries shared

### 3. Operator
The agent that operates the memory. Hermes connects to Second Brain via MCP and acts as the memory's brain — reading, writing, linking, retrieving, classifying, compressing. The operator is the bridge between raw storage and intelligent knowledge management. It follows rules, respects governance, and never acts without bounds.

**What this means:**
- Any MCP-compatible agent can operate the memory — not just one vendor
- Operator follows autonomy levels: automatic (search, draft, link), gated (canonical, merge), never (delete)
- All mutations go through MCP tools — no direct database access
- Every action is auditable — logged to agent_runs and agent_events
- Governance: Hermes proposes, humans approve

**Deliverables:**
- Hermes charter — defined agent ↔ memory boundary via MCP
- Autonomy levels — automatic / gated / never, enforced per action
- MCP tool interface — 10+ tools for agents to operate memory
- Audit logging — every agent action tracked to `agent_runs` and `agent_events`
- Proposal inbox — gated actions surface to humans before execution

### 4. Autonomous Operations
The operator as a team partner — not just memory, but a colleague. The system actively searches for new information, scrapes sources, tests assumptions, proposes actions, and expands the knowledge base overnight. It monitors for contradictions, extracts claims from papers, identifies gaps, and surfaces what you haven't asked for. The memory evolves itself while you sleep.

**What this means:**
- Nightly scouting — watches your arXiv feeds, GitHub repos, RSS sources
- Research execution — spawns subagents to fill knowledge gaps
- Contradiction monitoring — continuous scanning for conflicts across the corpus
- Evidence extraction — pulls claims from papers and links them to existing knowledge
- Stale detection — proposes deprecation for entries with no recalls in 90+ days
- Morning digest — surfaces proposals to human reviewers before acting
- Background processing queue — async extraction with retry, not fire-and-forget

**Deliverables:**
- Extraction queue table — D1-backed async processing with retry + dead-letter
- Nightly cron orchestration — sentinel, planning, research, validation, digest
- Source monitoring — RSS/arXiv/GitHub polling with deduplication
- Research agenda — prioritized open questions with scoring formula
- Stale detection — Hermes proposes deprecation for unreinforced entries
- Morning digest — daily summary of proposals, contradictions, new discoveries
- Knowledge proposals — structured inbox for human review of agent actions

---

## Why Now

| Today | What We're Building |
|-------|-------------------|
| You write notes, system stores them | System watches sources and writes notes for you |
| You search when you need something | System surfaces what's relevant before you ask |
| Compressed digests overwrite originals | Every claim links back to its source — auditable |
| "When did we decide this?" — no answer | "What was true in March?" — temporal query |
| Old entries sit forever or get compressed | Spaced repetition — useful knowledge stays, stale fades |
| Contradictions caught on write only | Continuous monitoring across entire corpus |
| Passive storage | Active agent with priorities, budgets, governance |

The competitors built better shovels. We're building the gardener.
