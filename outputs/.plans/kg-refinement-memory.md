# Deep Research Plan: knowledge graph refinement typed relations confidence scoring contradiction detection in AI memory systems

- **Slug:** `kg-refinement-memory`
- **Date:** 2026-07-13
- **Status:** Awaiting user confirmation

## Key Questions
1. How do production AI memory systems represent typed relations/edges in knowledge graphs?
2. How does Graphiti implement typed edges, edge metadata, and any confidence or salience scoring?
3. What contradiction detection and resolution strategies are used in Graphiti and comparable AI memory systems?
4. What quality thresholds are used for auto-linking, entity linking, or relation creation?
5. What pruning, decay, compression, or graph-maintenance heuristics are used to control graph growth?
6. Where evidence is missing in production systems, what do papers and public docs suggest as plausible best practices?

## Evidence Needed
- Official Graphiti documentation, repository code, issues, blog posts, and architecture descriptions
- Public docs/code from comparable AI memory / knowledge graph systems
- Research papers on temporal knowledge graphs, memory graphs, contradiction detection, confidence calibration, and graph pruning
- Source code or official docs showing concrete thresholds/heuristics where available
- Negative evidence where systems do **not** document thresholds or contradiction handling

## Scale Decision
**Decision:** Broad multi-source research, direct-search mode by lead researcher.

**Why:** The topic is specialized but still bounded enough to handle with direct evidence gathering in roughly 3-10+ tool calls without spawning subagents. It requires code/docs/paper synthesis, but not a large comparative market scan.

## Task Ledger
- [ ] T1 — Gather Graphiti official docs, repo structure, and implementation evidence
- [ ] T2 — Gather comparable production memory-system evidence from official docs/code
- [ ] T3 — Gather relevant papers/metadata on typed relations, confidence scoring, contradiction detection, pruning
- [ ] T4 — Synthesize findings by question/theme
- [ ] T5 — Write uncited draft to `outputs/.drafts/kg-refinement-memory-draft.md`
- [ ] T6 — Write cited draft to `outputs/.drafts/kg-refinement-memory-cited.md`
- [ ] T7 — Self-review and write verification note
- [ ] T8 — Deliver final report to `outputs/kg-refinement-memory.md`
- [ ] T9 — Write provenance sidecar to `outputs/kg-refinement-memory.provenance.md`

## Verification Log
- 2026-07-13: Created plan artifact at `outputs/.plans/kg-refinement-memory.md`.
- 2026-07-13: No evidence gathered yet. Awaiting user confirmation before research.

## Decision Log
- 2026-07-13: Chose slug `kg-refinement-memory`.
- 2026-07-13: Chose direct-search mode with no researcher subagents unless scope changes after user feedback.
- 2026-07-13: Will avoid PDF parsing unless the user explicitly asks for it; prefer HTML/docs/repo/paper metadata.
