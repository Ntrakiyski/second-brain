# Deep Research Plan: hybrid search optimization for memory systems

- **Slug:** `hybrid-memory-search`
- **Date:** 2026-07-13
- **Status:** Awaiting user confirmation

## Key Questions
1. How should reciprocal rank fusion (RRF) be tuned for hybrid memory retrieval, especially the `k` constant and list depth?
2. What fusion strategies work best when combining dense retrieval with keyword/BM25-style retrieval for semantic memory systems?
3. When do paraphrase/query-expansion variants improve recall enough to justify extra latency and deduplication complexity?
4. How do cross-encoder rerankers compare with lightweight rerankers for semantic memory retrieval in quality, latency, and operational cost?
5. What practical evaluation setup best measures these tradeoffs for a production memory system?

## Evidence Needed
- Primary papers on RRF, hybrid retrieval, query expansion, and reranking.
- Official docs or engineering writeups on production hybrid retrieval stacks.
- Benchmarks comparing dense+sparse fusion, query expansion, and rerankers.
- Code or implementation notes from retrieval frameworks where relevant.
- Evidence on latency/cost tradeoffs, not just ranking quality.

## Scale Decision
**Broad survey / multi-faceted topic**. If approved, use a decomposed research pass because the request spans four technical subproblems plus production guidance. Planned approach after approval: 3 researcher subagents + lead synthesis + verifier + reviewer.

## Task Ledger
- [x] Lead: derive slug and create artifact skeletons.
- [x] Lead: write plan artifact.
- [ ] Lead: read existing `CHANGELOG.md` and append concise research start note if proceeding.
- [ ] T1 Researcher: RRF tuning and dense/keyword fusion evidence.
- [ ] T2 Researcher: query expansion via paraphrases and multi-query retrieval evidence.
- [ ] T3 Researcher: reranker comparison evidence (cross-encoder vs lightweight).
- [ ] Lead: synthesize notes into draft.
- [ ] Verifier: add citations and URL checks.
- [ ] Reviewer: verification pass on supported claims and confidence.
- [ ] Lead: finalize deliverable + provenance.

## Verification Log
- 2026-07-13: Created required directories and plan file.
- 2026-07-13: Final research verification not started; awaiting user confirmation.

## Decision Log
- 2026-07-13: Chose slug `hybrid-memory-search`.
- 2026-07-13: Classified scope as broad, not a narrow explainer; decomposition likely helpful after approval.
- 2026-07-13: Will avoid PDF parsing unless explicitly requested; prefer paper metadata, abstracts, HTML/docs, and web snippets.
