# Deep Research Plan: embedding models for semantic memory systems

- **Topic:** Embedding models for semantic memory systems: BGE-small-en-v1.5 vs alternatives like E5, GTE, Jina, nomic for short-text retrieval with cosine similarity on 384-dimensional vectors; chunking strategies for long documents with overlap; optimal chunk sizes for semantic search quality
- **Slug:** `embedding-models-semantic-memory`
- **Date:** 2026-07-13
- **Status:** Awaiting user approval

## Key Questions
1. How does BGE-small-en-v1.5 compare with E5, GTE, Jina, and nomic-family alternatives for short-text retrieval quality in semantic memory systems?
2. Which of those models are realistically usable in 384-dimensional cosine-similarity pipelines without extra projection/compression?
3. What benchmark evidence exists specifically for short-query / short-passage retrieval, semantic search, and memory-like recall workloads?
4. What trade-offs matter beyond headline retrieval scores: dimensionality, latency, multilinguality, instruction format, license, and deployment simplicity?
5. What chunking strategies for long documents are best supported by evidence for downstream semantic search quality?
6. What chunk sizes and overlap ranges are most defensible for semantic search when documents are longer than the target recall unit?
7. What practical recommendations follow for a production semantic memory system storing short entries plus some longer notes?

## Evidence Needed
- Official model cards / docs for BGE, E5, GTE, Jina, nomic embeddings
- Benchmark leaderboards or papers covering MTEB / MIRACL / BEIR / retrieval tasks relevant to short-text search
- Sources stating embedding dimensionality and any 384-dim variants
- Sources discussing cosine similarity compatibility or normalization guidance
- Research papers / technical reports on chunking strategies, sliding windows, semantic chunking, and chunk-size effects on retrieval quality
- Practical implementation guidance from vendor docs or reputable engineering writeups where primary benchmark evidence is absent
- Source URLs for every model claim, benchmark number, and chunking recommendation

## Scale Decision
**Chosen scale:** Broad survey with decomposition.

Reason: this is a comparative research request spanning multiple model families plus chunking literature and practical retrieval design. It is not a narrow explainer and likely needs more than 10 tool calls plus multiple evidence types (official docs, benchmark sources, academic literature, and engineering guidance).

## Task Ledger
- [ ] Lead: finalize research scope and approval gate
- [ ] T1 Researcher: collect official model-card evidence for BGE / E5 / GTE / Jina / nomic, focusing on dimensions, usage guidance, and model-family positioning
- [ ] T2 Researcher: collect benchmark and comparison evidence for short-text retrieval quality, especially MTEB/BEIR-style results and any direct head-to-head comparisons
- [ ] T3 Researcher: collect chunking and overlap evidence for long-document semantic search quality, including academic and engineering sources
- [ ] Lead: synthesize evidence into draft
- [ ] Lead or verifier: add citations and verify URLs
- [ ] Lead or reviewer: perform verification pass and fix fatal issues
- [ ] Lead: deliver final report and provenance sidecar

## Verification Log
- 2026-07-13: Created plan artifact at `outputs/.plans/embedding-models-semantic-memory.md`.
- 2026-07-13: Research not started; verification pending user approval.

## Decision Log
- 2026-07-13: Derived slug `embedding-models-semantic-memory`.
- 2026-07-13: Selected broad-survey scale because request spans model comparison plus chunking evidence and practical deployment trade-offs.
- 2026-07-13: Plan to avoid PDF parsing unless explicitly required; prefer official docs, paper metadata/abstracts, HTML pages, and search results.
- 2026-07-13: Final deliverable target will be `outputs/embedding-models-semantic-memory.md` with sidecar provenance.
