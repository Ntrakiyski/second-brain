# Hermes — Living Knowledge Agent Charter

**Date:** 2026-07-13
**Status:** Draft
**Author:** Architecture review

---

## 1. What Hermes Is

Hermes is a **persistent knowledge agent** that operates on top of the Second Brain memory system. It is the living organism that observes, acquires, extracts, links, evaluates, proposes, and monitors the team's technical knowledge corpus.

Hermes is **not** the memory system. Second Brain is the memory system. Hermes is the agent that lives on top of it.

| Component | Runs on | Role |
|-----------|---------|------|
| **Second Brain** | Cloudflare Workers (D1 + Vectorize + AI) | Memory store, retrieval, CRUD, MCP server |
| **Hermes** | VPS (persistent process) | Knowledge agent — planning, research, extraction, governance |

The two are connected via a **restricted MCP server interface** exposed by Second Brain. Hermes calls Second Brain's MCP tools to read and propose changes to memory. It never writes directly to D1 or Vectorize.

---

## 2. The Interface Contract

### What Hermes can do (via MCP tools)

| MCP Tool | Hermes access | Notes |
|----------|---------------|-------|
| `recall` | Read | Semantic + graph search |
| `list_recent` | Read | Browse recent entries |
| `connections` | Read | Graph traversal |
| `remember` | Write (draft) | New entries created as `draft` status |
| `append` | Write (draft) | Additions to existing entries |
| `update` | Write (draft) | Full replacement (requires justification) |
| `link` | Write | Explicit relationship creation |
| `set_status` | Write | Lifecycle transitions (draft → canonical, etc.) |
| `forget` | **Never** | Hermes cannot delete entries |

### What Hermes cannot do

- Write directly to D1 or Vectorize — all mutations go through MCP tools
- Delete entries (`forget` is blocked)
- Modify system tables (`users`, `edges` metadata, `knowledge_agent_state`)
- Bypass visibility enforcement — Hermes sees only what its user scope allows
- Auto-publish to `canonical` — all status changes go through human review

### Authentication

Hermes authenticates to Second Brain as a specific user via `X-Second-Brain-User` + `X-Second-Brain-User-Key` headers on MCP requests. It operates within that user's visibility scope.

---

## 3. Hermes Responsibilities

### 3.1 Source Monitoring (Nightly Scout)

- Poll registered RSS feeds, arXiv categories, and GitHub repos for new papers/code
- Ingest new sources via `remember` (draft status with `source:*` tags)
- Deduplicate against existing corpus using `recall` before ingestion
- Log new discoveries to `agent_events`

### 3.2 Research Execution (Gap Researcher)

- Maintain a `research_agenda` table of open questions
- When a gap is identified, spawn a research subagent to find evidence
- Store findings as draft entries with full provenance (paper, section, page)
- Link findings to existing entries via `link`

### 3.3 Knowledge Extraction (Evidence Extractor)

- After ingestion, extract claims, methods, and findings from source text
- Store extracted claims as separate draft entries linked to their source
- Tag extracted content with `kind:semantic` and `source:*`
- Never overwrite source material — only link to it

### 3.4 Contradiction Monitoring (Contradiction Analyst)

- Periodically scan for entries that contradict each other
- Use `recall` with contradiction-focused queries
- When contradiction found: create a draft entry documenting the conflict
- Never auto-resolve — surface to human for decision

### 3.5 Knowledge Maintenance (Corpus Maintainer)

- Detect stale entries (entries with `status:canonical` that haven't been recalled in N days)
- Suggest deprecation via draft entries
- Identify orphaned entries (no incoming/outgoing edges)
- Propose link creation between related but unlinked entries

### 3.6 Architecture Advisory

- When asked about system design, retrieve relevant research via `recall`
- Synthesize findings with citation to source papers
- Distinguish between author results, system observations, and analyst inferences
- Always include evidence pack (3-8 supporting passages)

---

## 4. Autonomy Levels

| Level | What Hermes can decide | What requires human gate |
|-------|----------------------|------------------------|
| **Automatic** | Watch sources, search corpus, draft entries, link related | — |
| **Gated** | — | Set `canonical`, merge entries, modify research agenda priority |
| **Never** | — | Delete entries, modify user permissions, change system config |

All gated actions produce a `knowledge_proposals` row that appears in the morning digest. A human approves or rejects via the dashboard or MCP.

---

## 5. Operating Rhythm

```
Hourly:   Source sentinel — poll feeds, detect new papers
Daily 01:00  Executive planning — score research agenda, select next run
Daily 01:10  Research runs — spawn subagents for selected topics
Daily 04:00  Validation — cross-check extracted claims against sources
Daily 04:30  Reflection — summarize run outputs, update agenda
Daily 08:00  Morning digest — surface proposals to human reviewers
On-demand:   Architecture advisor — respond to team queries
```

---

## 6. Data Model Additions (for Hermes)

These tables support Hermes's state and are **not** part of the Second Brain core schema. They live in the same D1 database but are managed exclusively by Hermes.

### `knowledge_agent_state`
```
id, agent_name, last_run_at, last_heartbeat_at, 
current_mode, config_json, created_at, updated_at
```

### `research_agenda`
```
id, question, priority_score, status (open/in_progress/completed/deferred),
source_evidence_json, created_by, created_at, updated_at
```

### `agent_runs`
```
id, agent_name, mode, started_at, completed_at, status,
entries_created, links_created, proposals_generated, summary
```

### `agent_events`
```
id, event_type (source_detected/contradiction_found/gap_identified/proposal_generated),
payload_json, processed, created_at
```

### `knowledge_proposals`
```
id, proposal_type (create/merge/link/deprecate/status_change),
entry_id (target), payload_json, status (pending/approved/rejected),
reviewed_by, reviewed_at, created_at
```

---

## 7. Implementation Phases

### Phase 1: Foundation (Week 1-2)
- Create Hermes agent state tables in D1
- Implement source sentinel (RSS/arXiv polling via cron)
- Implement basic `remember`/`recall` workflow via MCP
- Verify MCP interface works from VPS → CF Workers

### Phase 2: Research Loop (Week 3-4)
- Implement research agenda with priority scoring
- Spawn research subagents for gap filling
- Extract claims from ingested papers
- Build morning digest generation

### Phase 3: Governance (Week 5-6)
- Implement proposal inbox with approval workflow
- Add contradiction monitoring
- Add staleness detection
- Build dashboard views for proposal review

### Phase 4: Advanced (Week 7+)
- Bitemporal fact tracking (valid_from/valid_to)
- Spaced repetition decay for memory lifecycle
- Cross-encoder reranking integration
- Global synthesis mode for broad queries

---

## 8. Constraints

1. **Hermes never deletes.** It can deprecate (set status to `deprecated`) but never `forget`.
2. **Hermes never auto-publishes.** All `canonical` status changes require human approval.
3. **Hermes operates within user scope.** It authenticates as a specific user and sees only their visible entries.
4. **Hermes is cost-aware.** It tracks LLM token usage per run and respects budget limits.
5. **Hermes is auditable.** Every action is logged to `agent_runs` and `agent_events`.
6. **Hermes degrades gracefully.** If MCP is unavailable, it queues work and retries. It never crashes the memory system.
