# Deep Research Plan: bi-temporal knowledge bases valid_from valid_to temporal validity tracking in AI memory

- **Topic:** bi-temporal knowledge bases, temporal validity tracking in AI memory, Graphiti fact invalidation with temporal windows, bitemporal modeling for knowledge graphs, temporal query patterns for memory systems
- **Slug:** `bitemporal-ai-memory`
- **Date:** 2026-07-13
- **Status:** Awaiting user approval

## Key Questions
1. How does Graphiti represent fact validity and invalidate facts over time?
2. What role do `valid_from` / `valid_to` style temporal windows play in AI memory systems?
3. What is standard bitemporal modeling for knowledge graphs, and how does it differ from single-time validity tracking?
4. What temporal query patterns are most relevant for memory systems that need historical and current truth views?
5. Where do the literature and implementation practice agree, and where are there gaps or ambiguities?

## Evidence Needed
- Official Graphiti documentation, code, design notes, or maintainer explanations covering fact invalidation and temporal windows
- Research papers or technical references on bitemporal databases / temporal knowledge graphs
- Credible sources on temporal query idioms for current-state, as-of, interval-overlap, and history-preserving memory retrieval
- If available, source code or schema examples showing temporal fields and invalidation mechanics

## Scale Decision
**Decision:** direct-search, lead-owned research only.

**Why:** This is a focused technical explainer and synthesis task. It should be answerable with bounded primary-source search and comparison without researcher subagents.

## Task Ledger
- [x] T0 Lead — create directories and durable plan artifact
- [ ] T1 Lead — gather Graphiti implementation/documentation evidence
- [ ] T2 Lead — gather bitemporal modeling references for knowledge graphs/databases
- [ ] T3 Lead — gather temporal query pattern references relevant to AI memory systems
- [ ] T4 Lead — synthesize findings into draft
- [ ] T5 Lead — add citations and verify URLs
- [ ] T6 Lead — run self-review and write verification note
- [ ] T7 Lead — publish final artifact and provenance sidecar

## Verification Log
- 2026-07-13: Verified plan artifact creation pending on-disk check during delivery phase.
- 2026-07-13: Research not started yet. No claims verified beyond plan creation.

## Decision Log
- 2026-07-13: Chose slug `bitemporal-ai-memory`.
- 2026-07-13: Chose direct-search mode because topic is narrow and explainable within a modest number of evidence-gathering steps.
- 2026-07-13: Will avoid PDF parsing unless the user explicitly requests it; prefer docs, abstracts, HTML pages, metadata, and code.
