# Competitor Gems — What to Steal

Patterns from 13 competitor systems that directly enable our 4 user stories. Not theory — concrete implementations we should adopt.

---

## Tier 1: Steal First (enables stories 1, 4)

### Graphiti — Bitemporal Facts
Every fact has `valid_from`/`valid_to` (when it was true) + `recorded_at` (when we learned it). When two entries contradict, don't delete — set `valid_to` on the old one, link it to the new one. Both survive. Contradiction becomes: "Entry A was valid until March. Entry B supersedes it since March."

**Where:** `getzep/graphiti` — edges have temporal windows on every fact. Neo4j/FalkorDB/Kuzu backends.

### AgentMemory — Typed Relations with Confidence
`contradicts`, `derives_from`, `supersedes`, `conflicts_with` — each with a 0.0–1.0 confidence score. Our graph only auto-infers `relates_to`. This makes the graph machine-readable. A contradiction is "this directly contradicts that with 0.92 confidence," not "these are related."

**Where:** `agentmemory/agentmemory` — relation graph with confidence scoring, auto-forget detects contradictions.

### Graphiti — Episode Provenance
Raw data is immutable. Every derived fact traces back to the episode that produced it. Compression never touches episodes. This is what makes any agent trust the memory — every claim is auditable back to source.

**Where:** `getzep/graphiti` — episodes are the raw ingestion stream, entities/facts are derived from episodes.

---

## Tier 2: Steal for Story 3 (autonomous operation)

### Honcho — Background Reasoning Pipeline
Async extraction, not `ctx.waitUntil()`. Queues work, processes in background, retries on failure. Our current approach is fire-and-forget. This is what makes autonomous cores reliable.

**Where:** `plastic-labs/honcho` — background "deriver" worker extracts conclusions from conversations asynchronously. Two services: Storage + Insights.

### AgentMemory — Spaced Repetition Decay
SM-2-inspired forgetting curve. `retention_score` decays with configurable half-life. Memories fade unless reinforced by recall. This makes autonomous maintenance real — the system knows what's stale without manual curation.

**Where:** `agentmemory/agentmemory` — `retention.ts` implements a proper forgetting curve. Half-life configurable per memory type.

### AgeMem — Hybrid Retrieval Scoring
`0.6 × cosine + 0.25 × recency_decay + 0.15 × learning_score`. We have recency and importance but no "learning score" — the system rating its own output novelty. This lets the memory assess how much new information each entry adds.

**Where:** `agemem/agemem` — three-layer control: deterministic rules + LLM memory agent + self-assessed learning scores.

---

## Tier 3: Steal for Story 2 (team visibility)

### Honcho — Peer-Centric Model
Humans and AI agents as equal entities. Each peer has sessions, messages, conclusions. What one peer knows about another is modeled explicitly. Foundation for "see what your team is remembering" — not just shared entries, but structured knowledge about team activity.

**Where:** `plastic-labs/honcho` — peers, sessions, messages, conclusions, representations, peer cards.

### TencentDB — Backup Before Mutation
Before every scene extraction, create a backup. If extraction fails, roll back. Mutations should be safe, especially when autonomous cores are writing.

**Where:** `TencentDB-Agent-Memory` — backup/checkpoint before every scene extraction, rollback on failure.

### MemPalace — Verbatim Storage
No summarization loss. Store original content alongside compressed digests. 96.6% R@5 without LLM proves you don't need to summarize to retrieve well. Agents get the original text, not a lossy compression.

**Where:** `MemPalace/mempalace` — drawers hold original verbatim content, knowledge graph links facts back to drawers.

---

## What NOT to Steal

| Pattern | Source | Why Skip |
|---------|--------|----------|
| Zettelkasten linking | A-MEM | LLM-heavy on every add, cost-prohibitive |
| Palace metaphor | MemPalace | Cognitive overhead, tags are simpler |
| Markdown files | memU | File-based doesn't scale for multi-user |
| GUI agent | Agent-S | Not a memory system, misclassified |
| Cloud-only | Graphiti (Zep), Honcho | Limits adoption, privacy concerns |

---

## Mapping to User Stories

| Story | What We Need | Best Source |
|-------|-------------|-------------|
| 1. Any agent, any interface | Provenance + verbatim storage | Graphiti episodes + MemPalace |
| 2. Team visibility | Peer model + backup safety | Honcho peers + TencentDB checkpoints |
| 3. Autonomous cores | Async pipeline + decay scoring | Honcho deriver + AgentMemory retention |
| 4. Contradiction catching | Bitemporal facts + typed relations | Graphiti temporal + AgentMemory edges |
