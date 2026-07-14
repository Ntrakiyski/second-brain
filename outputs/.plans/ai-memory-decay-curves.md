# Deep Research Plan: spaced repetition decay curves for AI agent memory systems

- **Slug:** `ai-memory-decay-curves`
- **Date:** 2026-07-13
- **Status:** awaiting user confirmation

## Key questions
1. What decay functions are actually used in computational memory models relevant to AI agents (exponential, power-law, logistic, hazard-based, half-life regression, SM-2-derived scheduling)?
2. How does classic spaced repetition scheduling (especially SM-2 and descendants) differ from continuous decay scoring for memory retention?
3. What evidence exists for choosing different forgetting/retention dynamics for different memory types in AI systems: durable facts, transient context, and task/procedural state?
4. Are there published or production-adjacent estimates of useful half-life ranges, or only adaptive formulations?
5. How have LLM memory systems operationalized retention scoring, salience, or eviction/refresh policies?
6. What recommendations are defensible for an AI agent memory system design today, and where is evidence weak?

## Evidence needed
- Primary papers on forgetting curves and computational memory models.
- Primary papers or official docs on SM-2 / spaced repetition algorithms and successors.
- Papers, code, or official docs on LLM/agent memory systems with retention, salience, consolidation, decay, or eviction mechanisms.
- Any empirical comparisons of exponential decay vs SM-2-like scheduling or half-life regression.
- Source-backed evidence for memory-type distinctions (facts vs context vs tasks), including explicit uncertainty where direct evidence is absent.

## Scale decision
**Decision:** broad but still manageable direct-search research, lead-owned only.

**Why:** The topic is multi-part but still synthesizable in a bounded pass using direct paper/web search plus primary-source reading. It does not require parallel subagents unless coverage proves too fragmented after initial search.

## Task ledger
- [pending] T1. Create plan artifact and request approval. **Owner:** lead
- [pending] T2. Run direct evidence search across at least 3 distinct query angles: forgetting curves, SM-2/spaced repetition, LLM/agent memory retention. **Owner:** lead
- [pending] T3. Collect primary sources and notes into `outputs/.drafts/ai-memory-decay-curves-research-direct.md`. **Owner:** lead
- [pending] T4. Synthesize findings into `outputs/.drafts/ai-memory-decay-curves-draft.md`. **Owner:** lead
- [pending] T5. Add inline citations and sources to `outputs/.drafts/ai-memory-decay-curves-cited.md`. **Owner:** lead
- [pending] T6. Run self-review and write `outputs/.drafts/ai-memory-decay-curves-verification.md`. **Owner:** lead
- [pending] T7. Deliver final brief to `outputs/ai-memory-decay-curves.md` with provenance sidecar. **Owner:** lead

## Verification log
- 2026-07-13: Verified plan file creation pending confirmation stage.
- 2026-07-13: Research not started yet by design.

## Decision log
- 2026-07-13: Chose slug `ai-memory-decay-curves`.
- 2026-07-13: Chose direct-search mode (no researcher/verifier/reviewer subagents initially) because the topic is analytical but still feasible within a bounded primary-source synthesis.
- 2026-07-13: Will avoid PDF parsing unless explicitly required; prefer abstracts, HTML pages, paper metadata, and official docs.

## Planned output
- Canonical deliverable: `outputs/ai-memory-decay-curves.md`
- Provenance sidecar: `outputs/ai-memory-decay-curves.provenance.md`
