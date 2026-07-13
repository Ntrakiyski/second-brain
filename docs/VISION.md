# VISION.md

## The Living Memory Organism

A self-evolving knowledge partner that operates your memory, catches what you miss, and proposes what you haven't thought of yet.

Memory becomes a team member — not a static database, but a living system that learns, proposes, and operates.

---

## User Stories

### 1. Any agent, any interface
As a user, I want to connect to my memory through any chat interface (Claude, GPT, Hermes, any MCP-compatible agent) and have that agent know my context — my decisions, my history, my knowledge. The memory works regardless of which agent I'm using.

### 2. Team visibility
As a team member, I want to see what my team is remembering, working on, and deciding. I want to know when someone captures a decision, when a contradiction arises across the team's knowledge, when a new paper changes something we believed. The shared memory is a window into the team's collective intelligence.

### 3. Autonomous memory operation
As a team, we want the memory system to actively operate — not just store and retrieve, but search for new information, scrape sources, test assumptions, propose actions, and expand our knowledge base autonomously. The memory has cores (capabilities) that agents can invoke: researching gaps, monitoring contradictions, extracting claims from papers, proposing deprecations, running overnight. The system evolves itself.

### 4. Contradiction catching
As a team, when someone captures knowledge that conflicts with what we already know, the system catches it and asks: "This contradicts [existing entry from 2 months ago, by teammate X]. Which one is current?" The memory doesn't just store — it validates. It prevents the team from unknowingly operating on outdated or conflicting information.

---

## Why

The current memory system works well for personal/team note-taking but lacks the guarantees needed for a knowledge system teams trust for technical decisions:

- No way to trace a recalled fact back to its source paper/section
- No temporal tracking — can't answer "what was true in March?"
- Memories never fade — old entries sit forever or get aggressively compressed
- Relations are generic — "related to" tells you nothing about *how*
- No rollback — updates and compression overwrite originals permanently
- Agents connect but don't share context — each conversation starts from zero

---

## The Shift

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
