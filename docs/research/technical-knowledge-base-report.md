# Second Brain — Technical Knowledge Base: Current State Analysis & Research-Backed Improvement Plan

**Author:** Research Analyst (Deep Research)
**Date:** 2026-07-13
**Scope:** Architecture assessment of Second Brain v2 as a shared team memory and technical knowledge base, grounded in primary research literature
**Status:** Living document — will be updated as research progresses

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current Architecture Assessment](#current-architecture-assessment)
3. [Research Findings by Domain](#research-findings-by-domain)
4. [Gap Analysis: System vs. Research](#gap-analysis)
5. [Prioritized Improvement Plan](#improvement-plan)
6. [Evidence Register](#evidence-register)

---

## 1. Executive Summary

Second Brain v2 is a competent, low-latency shared memory platform. Its hybrid retrieval (dense + keyword via RRF), graph traversal, and nightly compression form a solid foundation. However, the system was designed for **personal/team conversation memory**, not for a **citable technical knowledge base**. The gap is not in the storage engine—it is in **provenance, evaluation, and governance**.

### What the system does well today
- Semantic recall via BGE-small-en-v1.5 embeddings with 384-dim cosine similarity
- Hybrid retrieval fusing dense vectors and keyword matching via RRF (k=60)
- Multi-user visibility enforcement (private/public separation)
- Graph traversal with configurable hop depth and fanout
- Nightly compression with per-user scoping
- Append-heavy model (UPDATE creates new versions, not in-place mutation)

### What it lacks for a research knowledge base
1. **No document/section/provenance model** — entries are free text, not anchored to source papers
2. **No bitemporal truth** — `created_at` only; no validity interval or transaction time
3. **No evaluation infrastructure** — thresholds are hypotheses, not calibrated values
4. **No evidence gate** — no NLI verification between claimed facts and source material
5. **No research agenda or proposal workflow** — no governed path from discovery to canonical knowledge

---

## 2. Current Architecture Assessment

### 2.1 Embedding & Chunking

| Component | Current Implementation | Research Assessment |
|---|---|---|
| **Model** | `@cf/baai/bge-small-en-v1.5` (384-dim) | Appropriate for <10k doc corpus. Rao et al. (2025) show small embeddings + reranking can outperform large models alone. No need to upgrade yet. |
| **Chunking** | Fixed 1,600 chars, 200-char overlap, sentence-boundary heuristic | **Weak.** Fixed character cuts can sever methods from results. No section awareness. Research shows adaptive/topic-aligned chunking outperforms fixed baselines (Gomez-Cabello et al., 2025). |
| **Vector metadata** | content, parentId, chunkIndex, tags, source, owner | Adequate for current use. Missing: document_id, section_path, page offsets, evidence spans. |

**Research grounding:** The BGE family was benchmarked as a general embedding family; its published results establish family-level capability, not that `bge-small-en-v1.5` calibrates cosine similarity for this team's specific corpus of AI research papers. [Xiao et al., 2023, SIGIR, 637 citations]

**Implication:** Retain the model initially, but log raw dense scores, ranks, source types, and post-rerank position. Fit thresholds from labelled queries rather than importing one global score scale.

### 2.2 Duplicate & Contradiction Detection

| Threshold | Action | Research Assessment |
|---|---|---|
| ≥ 0.95 | Blocked (near-exact duplicate) | Reasonable default |
| 0.85–0.95 | LLM merge/contradiction decision | **Underspecified.** LLM sees only first 500 chars of a 1,500-char sample. Complex technical claims may have nuance beyond 500 chars. |
| 0.45–0.85 | Contradiction check only | **Cosine similarity ≠ evidential contradiction.** Two entries can be semantically similar while supporting each other, or semantically distant while contradicting. |

**Research grounding:** Similarity-based duplicate detection is appropriate for personal memory. For research knowledge, contradiction requires **scope-aware comparison** (same model? same dataset? same conditions?), not just embedding distance. [Edge et al., 2024, arXiv, 1,608 citations on GraphRAG]

### 2.3 Graph & Edge System

| Component | Current Implementation | Research Assessment |
|---|---|---|
| **Auto-linking** | Top 3 neighbors at cosine ≥ 0.78, type: `relates_to` | **No evidence spans.** An inferred high-similarity edge has no supporting passage. Cannot be trusted as a research assertion. |
| **Graph expansion** | BFS, 3 hops, fanout 8, decay 0.6 | Reasonable traversal parameters. No evidence that these are optimal for this corpus. |
| **Edge types** | 7 types (relates_to, supersedes, caused_by, decided, about_person, part_of_project, follows) | Good coverage. Missing research-specific types: `supports`, `contradicts`, `uses_method`, `evaluates_on`, `has_limitation`. |

**Research grounding:** GraphRAG's reported advantage is for global sensemaking questions over large corpora: it extracts an entity graph, builds community summaries, generates partial answers, then aggregates them. Its results support community-level graph summaries for broad questions, not automatic semantic-neighbor links as proof of a relation. [Edge et al., 2024, arXiv, 1,608 citations]

**Implication:** Do not feed current `.78` similarity edges into research answers as relational facts. Introduce relation records with an explicit predicate and supporting passage IDs.

### 2.4 Retrieval Pipeline

| Component | Current Implementation | Research Assessment |
|---|---|---|
| **RRF fusion** | k=60, keyword weight = token match count | **RRF is justified but under-calibrated.** Cormack et al. (2009) established RRF's general superiority, but Bruch et al. (2023) showed RRF is sensitive to k and loses score magnitude information. k=60 is not universally optimal. |
| **Keyword search** | `LIKE '%token%'` chains, limit 100 | **Not a mature lexical retriever.** Raw LIKE has no IDF/field semantics. Should be replaced with BM25-equivalent fielded search over title, authors, section headings, claims. |
| **Reranking** | Heuristic multipliers (recency, frequency, importance, tag boost) | **Not query-passage interaction.** The scoring engine applies global metadata multipliers, not relevance reranking. Cross-encoder reranking would improve citation precision. |

**Research grounding:** RRF has experimental support as a rank-combination method: Cormack, Clarke, and Büttcher found it outperformed constituent systems and Condorcet fusion across TREC experiments. That supports retaining rank fusion. It does **not** establish `k=60`, the current raw token-count weight, or `LIKE` matching as correct for this corpus. [Cormack, Clarke & Büttcher, 2009, SIGIR, 985 citations]

**Implication:** Replace the `LIKE OR` candidate path with a real lexical ranking stage (BM25/FTS equivalent) over title, abstract, section headings, claims, authors, identifiers, and content. Fuse only independently ranked lists. Compare RRF constants and weights on a benchmark.

### 2.5 Compression & Pattern Derivation

| Component | Current Implementation | Research Assessment |
|---|---|---|
| **Compression** | LLM-generated tag-level digest, source entries marked `rolled-up` | Useful for navigation, but cannot replace citable evidence. A digest may be useful, but must carry `derived_from` links and never be presented as underlying evidence. |
| **Pattern derivation** | LLM finds cross-memory patterns, stored as `auto-pattern` entries | Creative feature. No evaluation of pattern quality or utility. |

**Research grounding:** RAPTOR's hierarchical abstractive processing showed that recursive clustering + summarization improves complex QA by +20% absolute on QuALITY when paired with GPT-4. The key is retrieval at multiple abstraction levels, not just one digest per tag. [Sarthi et al., 2024, ICLR, 527 citations]

---

## 3. Research Findings by Domain

### 3.1 Dense Retrieval: What Matters

**Key papers:**

| Paper | Finding | Relevance |
|---|---|---|
| **DPR** (Karpukhin et al., 2020, arXiv, 6,015 cites) | Dense retrieval exceeded BM25 by 9–19 points in top-20 accuracy on QA benchmarks | Validates dense retrieval as a component, not a universal threshold |
| **BGE-M3** (Chen et al., 2024, arXiv, 203 cites) | Single model supporting dense, sparse, and multi-vector retrieval for 100+ languages | Best general-purpose choice if multilingual needed |
| **Rethinking Hybrid** (Rao et al., 2025, arXiv, ~20 cites) | MiniLM-v6 (33M params) outperforms BGE-Large (335M) when combined with LLM reranking | **For small corpora, small embedding + reranking > large embedding alone** |
| **GTE** (Li et al., 2023, arXiv, ~400 cites) | GTE-base achieves competitive performance with much larger models via multi-stage training | Strong baseline for English-only corpora |

**Consensus for Second Brain:** For <10k documents, `bge-base-en-v1.5` or `gte-base` (~110M params, 768-dim) is sufficient. The marginal quality gain of large models does NOT justify 3–6x compute/storage cost at this scale. The bottleneck is NOT the embedding model—it is the fusion and reranking pipeline.

### 3.2 Chunking: What the Research Says

| Paper | Finding | Implication |
|---|---|---|
| **RAPTOR** (Sarthi et al., 2024, ICLR, 527 cites) | Recursive clustering + summarization: +20% absolute on complex QA. Full-tree retrieval (all abstraction levels) critical. | Produce hierarchy: paper → section → evidence passage → claim |
| **Semantic Chunking Worth It?** (Qu et al., 2024, arXiv) | Semantic chunking does NOT consistently outperform fixed-size chunking across tasks | **Challenges the popular assumption.** Fixed-size may be sufficient. |
| **Late Chunking** (Günther et al., 2024, arXiv, ~30 cites) | Process full document through long-context encoder FIRST, then chunk. Chunk embeddings retain full-document context. | Elegant solution to context-loss. Requires 8192+ token encoder. |
| **Contextual Retrieval** (Anthropic, 2024) | Prepend LLM-generated context to each chunk before embedding. Reduces failures by 35–67%. | **Highest ROI technique for existing pipelines.** Can combine with any chunking strategy. |
| **Adaptive Chunking** (2026, arXiv) | No single chunking strategy works for all documents. Per-document adaptive selection outperforms fixed strategy. | Start with simple recursive splitting, measure failures before optimizing. |

**Practical recommendation:**
- **Start:** 512-token recursive character splitting, 10% overlap
- **Overlap myth:** Jan 2026 systematic analysis found overlap adds no measurable benefit for factual QA
- **Upgrade path:** Contextual retrieval (Anthropic technique) → Late chunking → RAPTOR for hierarchical queries
- **Context cliff:** Performance degrades sharply around ~2.5k tokens per chunk

### 3.3 RRF & Hybrid Fusion

| Paper | Finding | Implication |
|---|---|---|
| **RRF** (Cormack et al., 2009, SIGIR, 985 cites) | `score(d) = Σ 1/(k + rank_i(d))` with k=60. Outperforms Condorcet fusion. | Validates RRF as baseline. k=60 is default, not universal. |
| **Fusion Analysis** (Bruch et al., 2023, ACM TOIS, 32 cites) | **RRF is sensitive to k.** Convex combination (CC) of lexical + semantic scores outperforms RRF when labeled data available. | If any training labels exist, CC with tuned alpha beats RRF. |
| **MMMORRF** (Samuel et al., 2025, SIGIR) | Weighted RRF with per-modality trust priors yields +4.2% nDCG@10 | Consider weighted RRF if different retrievers have known reliability differences |

**Failure modes of RRF:**
1. Score magnitude blindness — rank 5 with high score = rank 5 with low score
2. Parameter sensitivity — k=60 NOT universally optimal; tune via grid search (k ∈ {10, 20, 40, 60, 80, 100})
3. Complementary retrievers required — similar retrievers produce minimal fusion benefit

### 3.4 Cross-Encoder Reranking

| Paper | Finding | Implication |
|---|---|---|
| **ColBERT** (Khattab & Zaharia, 2020, SIGIR, 1,900+ cites) | Late interaction: encodes independently, MaxSim scoring. ~50ms on 100M passages. | Best for out-of-domain robustness |
| **Cross-Encoder Study** (2026) | Cross-encoder reranking improves RAG accuracy by **+33–40%** for only +120ms average latency | **Highest-ROI addition to RAG pipeline** |
| **FLOPs Reranking** (Peng et al., 2025) | Pointwise reranking offers optimal efficiency-effectiveness tradeoff | For production, pointwise over pairwise |

**Practical recommendation:** Retrieve 50–100 candidates in stage 1, rerank to top 5–10 with small cross-encoder. Best open-source: `ms-marco-MiniLM-L6-v2` (~50ms for 100 doc pairs).

### 3.5 Agentic Memory Management

| Paper | Finding | Implication |
|---|---|---|
| **A-MEM** (Xu et al., 2025, NeurIPS, 878 cites) | Zettelkasten-inspired: atomic notes with dynamic cross-links. New memories trigger evolution of existing memories. | Maps to our graph-edge model. Dynamic linking = our `relates_to` edges. |
| **AgeMem** (Yu et al., 2026, ACL, 61 cites) | Unified LTM/STM via 6 tool actions trained jointly via RL. Outperforms A-MEM by 8.57 points. | Our 6-tool taxonomy (recall, remember, update, forget, append, link) maps directly. Learned policies > heuristics. |
| **Mem0** (Chhikara et al., 2025, FAIA, 672 cites) | ADD-only extraction (no UPDATE/DELETE) achieved SOTA on LoCoMo. Entity linking across memories. | **Validates our append-heavy model.** Entity linking is a capability we should consider. |
| **Graphiti** (Zep team, 2025, arXiv, ~50 cites) | Temporally-aware KG with valid_at/invalid_at + created_at/expired_at. Hybrid search: semantic + BM25 + graph distance. | **Highest direct relevance** — implements bitemporal model for agent memory. |

**Key design patterns from the literature:**
1. Zettelkasten linking — memories are atomic notes with dynamic cross-links
2. Unified LTM/STM via tool actions — expose memory ops as callable tools, train jointly
3. Graph-based relational memory — entities as nodes, relationships as edges with temporal metadata
4. Multi-signal retrieval — semantic + keyword + entity matching fused via RRF
5. ADD-only accumulation — avoid UPDATE/DELETE complexity, let new memories supersede old ones

### 3.6 Bitemporal Knowledge

| Paper | Finding | Implication |
|---|---|---|
| **BiTRDF** (Tansel et al., 2025, Mathematics) | Time as reference, not attribute. Each resource carries valid-time and transaction-time intervals. | `created_at` is not enough. A claim needs two clocks. |
| **AeonG** (Hou et al., 2024, PVLDB, ~30 cites) | Anchor+delta strategy: periodic snapshots + incremental changes. 5.73× lower storage, 2.57× lower query latency. | Directly applicable to edge versioning. |
| **Graphiti** (Zep, 2025) | Facts have `valid_at`/`invalid_at` (valid time) + `created_at`/`expired_at` (transaction time). | Proves bitemporal model works for agent memory at production scale. |

**Implementation rule:** Never mutate an evidence-backed claim in place. Close its valid interval or mark it qualified/superseded, then create a new claim version linked by `supersedes` or `corrects`.

### 3.7 Provenance & Citation

| Paper | Finding | Implication |
|---|---|---|
| **Attribution Survey** (2025, arXiv, 134 papers surveyed) | Most systems produce document-level citations, not sentence-level. In-generation attribution (Self-RAG) is emerging. | Design recall to support mid-generation evidence gathering. |
| **ContextCite** (MadryLab, NeurIPS 2024, ~50 cites) | Learns surrogate model for contributive attribution — which context parts CAUSED a statement, not just supported it. | **Contributive attribution** is what we need — trace which entry CAUSED an insight. |
| **VeriCite** (Qian et al., 2025, SIGIR-AP) | NLI-verify each claim against sources before generation. Decouples attribution from generation. | NLI verification gate = quality filter we should implement. |
| **TROVE** (2025, arXiv) | Four provenance types: quotation, compression, inference, others. No model achieves highly reliable performance. | Open problem. Track provenance type per edge. |

### 3.8 GraphRAG & Community Detection

| Paper | Finding | Implication |
|---|---|---|
| **GraphRAG** (Edge et al., 2024, arXiv, 1,608 cites) | Entity KG + community summaries. Outperforms naive RAG on comprehensiveness (~70–80% win rate) for global questions. | Global queries fail with standard vector RAG. Graph traversal needed. |
| **GraphRAG-V** (2025, ASONAM) | **Skips LLM entity extraction.** Treats chunks as nodes, builds similarity graph, applies community detection. 11pp recall improvement, orders of magnitude faster. | **Community detection on embeddings is sufficient.** No expensive LLM extraction needed. |
| **LightRAG** (Guo et al., 2025, EMNLP, ~200 cites) | Dual-level retrieval with **incremental update** — new data merges into existing graph without re-indexing. | Exactly what we need for evolving knowledge bases. |
| **HippoRAG** (Bernal et al., 2024, NeurIPS, ~200 cites) | Personalized PageRank (PPR) for retrieval. 10–20x cheaper and 6–13x faster than iterative retrieval. +20% on multi-hop QA. | **PPR over edges graph** could dramatically improve multi-hop recall. |

### 3.9 Memory Governance & Corruption Prevention

| Paper | Finding | Implication |
|---|---|---|
| **SSGM** (Lam et al., 2026, arXiv, ~10 cites) | Three failure points: Memory Poisoning, Semantic Drift, Conflict/Hallucination. Proposes dual-track storage (mutable graph + immutable log). | **Adopt dual-track model.** Our append-only entries + versioned edges approximate this. |
| **MemArchitect** (Suresh Kumar et al., 2026, arXiv, ~5 cites) | FSRS spaced-repetition decay for memory relevance. Cross-Encoder veto gate. +7.45% accuracy, +39.2% on temporal reasoning. | Apply decay functions to memory relevance scoring. |
| **HELM** (2025, OpenReview) | Epistemic governance: track not just WHAT is stored but WHETHER it's still valid. EpiErr correlates r ≈ -0.65 with task failure. | **Staleness detection is critical.** Our system lacks this. |
| **Memory Poisoning** (Multiple, 2024–2026) | Adversarial text stored as memory; stressed agents 8x more susceptible. More capable models NOT more secure. | **Append-only log with rollback capability** is a defense. Provenance tracking prevents silent poisoning. |

### 3.10 RAG Evaluation

| Paper | Finding | Implication |
|---|---|---|
| **RAGAS** (Es et al., 2024, EACL, 760 cites) | Reference-free evaluation: Faithfulness, Answer relevance, Context relevance, Context recall. LLM-as-judge. | Use for rapid iteration without human annotations. |
| **ARES** (Falcon et al., 2024, NAACL) | Fine-tuned lightweight judges with PPI correction using few hundred human annotations. | Small human-annotated set for calibration. |
| **Lost in the Middle** (Liu et al., 2023, TACL, 3,993 cites) | U-shaped performance: best at beginning/end of context, worst in middle. | Return small, ordered evidence pack. Most critical sources first, then corroboration. |
| **MIRAGE** (Park et al., 2025) | RAG systems degrade significantly with noisy context. Most metrics miss these failure modes. | Noise/robustness testing is essential. |

---

## 4. Gap Analysis: System vs. Research {#gap-analysis}

| Dimension | Current State | Research Target | Gap Severity |
|---|---|---|---|
| **Document model** | Free text entries | Document → section → passage → claim hierarchy | **Critical** — cannot cite sources |
| **Provenance** | `source` field (phone/browser/claude/api) | Paper identity, authors, DOI, section path, page offsets, evidence quotes | **Critical** — cannot attribute findings |
| **Bitemporal truth** | `created_at` only | Valid time (when claim holds) + transaction time (when system learned it) | **High** — cannot answer "what did we believe in March?" |
| **Chunking** | Fixed 1,600 chars, 200 overlap | Section-aware, semantically complete passages with parent context | **High** — splits methods from results |
| **Lexical retrieval** | `LIKE '%token%'` chains | BM25/FTS with IDF weighting, fielded search (title, authors, sections) | **High** — poor keyword precision |
| **Reranking** | Heuristic metadata multipliers | Cross-encoder query–passage interaction scoring | **High** — misses relevance nuance |
| **Contradiction detection** | Cosine similarity thresholds | Scope-aware NLI (same model? same dataset? same conditions?) | **Medium** — similarity ≠ contradiction |
| **Graph edges** | Untyped similarity links | Evidence-bearing typed relations (supports, contradicts, uses_method) | **Medium** — cannot trust relation assertions |
| **Evaluation** | No gold set, no metrics | Recall@k, MRR, nDCG, citation precision, latency percentiles | **Critical** — thresholds are unvalidated hypotheses |
| **Governance** | Automatic compression + contradiction | Proposal workflow, reviewer gate, audit trail, epistemic states | **High** — no path from discovery to canonical truth |
| **Staleness detection** | Half-life decay by tag | Epistemic validity tracking, corrigenda detection, retraction handling | **Medium** — stale claims persist as valid |
| **Evidence pack ordering** | Score-based ranking | Positional calibration (start/end of context), deduplication, source diversity | **Medium** — lost-in-the-middle risk |

---

## 5. Prioritized Improvement Plan {#improvement-plan}

### Phase 1: Make Research Artifacts Citable (P0 — First)

**Goal:** Every recalled research passage resolves to a canonical URL, document version, section heading, and page/offset.

| Action | Implementation | Acceptance Criteria | Research Basis |
|---|---|---|---|
| **1.1 Add document/section/evidence schemas** | New D1 tables: `documents`, `document_sections`, `evidence_passages`, `claims`, `claim_evidence` | Every retrieved research passage resolves to a source document, version, section, and page | Provenance survey (2025): document-level citations insufficient; sentence-level needed |
| **1.2 Build section-aware ingestion** | Parse PDF/HTML into hierarchy; preserve raw file hash and extraction version | 20 seed papers ingest with no orphan passage; manual spot-check confirms span anchors | Gomez-Cabello et al. (2025): section-aware chunking outperforms fixed character cuts |
| **1.3 Add claim + evidence links** | Claims separate from prose summaries; each claim links to supporting/qualifying passages | A research answer can list supporting passages; unsupported claim cannot be marked `verified` | ContextCite (NeurIPS 2024): contributive attribution traces which entry CAUSED an insight |
| **1.4 Disable automatic destructive conflict for sources** | Paper records and evidence are immutable/versioned; corrections linked via `supersedes` | No source passage is replaced/merged by semantic threshold; retraction = new linked record | SSGM (2026): dual-track storage (mutable graph + immutable log) |

**Schema additions:**

```sql
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  canonical_url TEXT,
  doi_or_arxiv_id TEXT,
  title TEXT NOT NULL,
  authors_json TEXT DEFAULT '[]',
  publication_date INTEGER,
  venue TEXT,
  version TEXT,
  source_type TEXT NOT NULL DEFAULT 'paper',
  language TEXT DEFAULT 'en',
  content_hash TEXT NOT NULL,
  ingested_at INTEGER NOT NULL,
  owner_user_id TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS document_sections (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  parent_section_id TEXT,
  heading TEXT,
  ordinal INTEGER NOT NULL,
  page_start INTEGER,
  page_end INTEGER,
  char_start INTEGER,
  char_end INTEGER,
  FOREIGN KEY (document_id) REFERENCES documents(id)
);

CREATE TABLE IF NOT EXISTS evidence_passages (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  section_id TEXT,
  page_start INTEGER,
  page_end INTEGER,
  char_start INTEGER,
  char_end INTEGER,
  text TEXT NOT NULL,
  vector_id TEXT,
  parent_passage_id TEXT,
  extraction_method TEXT NOT NULL DEFAULT 'automatic',
  FOREIGN KEY (document_id) REFERENCES documents(id),
  FOREIGN KEY (section_id) REFERENCES document_sections(id)
);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  normalized_claim TEXT NOT NULL,
  claim_type TEXT NOT NULL,
  subject TEXT,
  predicate TEXT,
  object TEXT,
  polarity TEXT DEFAULT 'supports',
  confidence REAL DEFAULT 0.5,
  scope TEXT,
  status TEXT NOT NULL DEFAULT 'candidate',
  valid_from INTEGER,
  valid_to INTEGER,
  recorded_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  superseded_at INTEGER,
  created_by TEXT NOT NULL DEFAULT 'system',
  FOREIGN KEY (document_id) REFERENCES documents(id)
);

CREATE TABLE IF NOT EXISTS claim_evidence (
  claim_id TEXT NOT NULL,
  evidence_passage_id TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT 'supports',
  quote_start INTEGER,
  quote_end INTEGER,
  extractor_confidence REAL DEFAULT 0.5,
  reviewer_status TEXT DEFAULT 'pending',
  PRIMARY KEY (claim_id, evidence_passage_id)
);

CREATE TABLE IF NOT EXISTS relations (
  id TEXT PRIMARY KEY,
  source_node_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  provenance TEXT NOT NULL DEFAULT 'extracted',
  confidence REAL DEFAULT 0.5,
  valid_from INTEGER,
  valid_to INTEGER,
  recorded_at INTEGER NOT NULL,
  superseded_at INTEGER,
  evidence_passage_ids_json TEXT DEFAULT '[]',
  schema_version INTEGER DEFAULT 1
);
```

### Phase 2: Establish Quality Before Tuning (P1 — Second)

**Goal:** Version the corpus, build a gold set, and measure before changing any threshold.

| Action | Implementation | Acceptance Criteria | Research Basis |
|---|---|---|---|
| **2.1 Create `research-retrieval-v1` gold set** | 100–150 real team questions, labelled relevant passages, frozen corpus snapshot | Inter-annotator agreement recorded; each query has ≥1 source passage or is marked unanswerable | RAGAS (2024): gold standard test set with diverse query types essential |
| **2.2 Instrument every stage** | Log candidate IDs/ranks/scores, chunk/source type, rerank decision, latency, selected evidence | Can calculate Recall@5/10, MRR@10, nDCG@10, citation precision, p50/p95 latency | RAG Evaluation Survey (2025): retrieval and answer grounding must be evaluated separately |
| **2.3 Calibrate retrieval** | Compare dense-only, lexical-only, existing RRF, tuned RRF, and reranker variants | Promote only a variant that improves primary metrics with no unacceptable p95/cost regression | Bruch et al. (2023): convex combination outperforms RRF when labels available |
| **2.4 Audit legacy memory path** | Label duplicate, contradiction, auto-edge, and compression samples | Report precision by class before changing `.45/.78/.85/.95` or graph rules | MIRAGE (2025): RAG systems degrade with noisy context; measure noise tolerance |

### Phase 3: Improve Evidence Retrieval (P2 — Third)

**Goal:** Replace weak retrieval components with research-backed alternatives.

| Action | Implementation | Acceptance Criteria | Research Basis |
|---|---|---|---|
| **3.1 Replace fixed character chunks for research corpus** | Semantic/section-aware child chunks and parent retrieval | Improved passage Recall@10 and citation accuracy vs. 1,600-char baseline | Gomez-Cabello et al. (2025): adaptive chunking outperforms fixed |
| **3.2 Introduce fielded lexical ranking** | Author/title/DOI/section/claim terms become exact-match friendly | Identifier and named-model query Recall@10 improves; no degradation on paraphrase set | RRF Analysis (2023): BM25 and dense have complementary strengths |
| **3.3 Add bounded reranking** | Cross-encoder scoring over bounded candidate set; score query–passage relevance | Citation precision rises at fixed Recall@10; p95 latency stays within budget | Cross-Encoder Study (2026): +33–40% accuracy for +120ms latency |
| **3.4 Store version and validity metadata** | Current/obsolete/retracted/source-version state at query time | Older claim qualified when newer linked source supersedes it | BiTRDF (2025): time as reference, not attribute |

**Embedding upgrade path (conditional on Phase 2 measurements):**

| If... | Then... | Research basis |
|---|---|---|
| Dense Recall@10 < 0.6 on gold set | Upgrade to `bge-base-en-v1.5` (768-dim) or `gte-base` | Rao et al. (2025): small model + reranking beats large model alone |
| Lexical Recall@10 < 0.5 on gold set | Add BM25 via D1 FTS5 or external index | Bruch et al. (2023): BM25 + dense互补 |
| Both < 0.7 after fusion | Add cross-encoder reranking stage | Cross-Encoder Study (2026): highest-ROI addition |
| Citation precision < 0.8 | Add contextual retrieval (Anthropic technique) | 35–67% retrieval failure reduction |

### Phase 4: Selective Hierarchy & Graph (P3 — Last)

**Goal:** Build evidence-bearing relationships and hierarchical knowledge organization.

| Action | Implementation | Acceptance Criteria | Research Basis |
|---|---|---|---|
| **4.1 Evidence-bearing relation extraction** | `supports`, `contradicts`, `uses_method`, `evaluates_on`, `has_limitation`, `compares_to` | Manual P@50 for extracted relations meets threshold; every relation exposes evidence | TROVE (2025): four provenance types need tracking |
| **4.2 Build paper/project summaries** | Derivation links, scope, version, source coverage | Summary faithfulness audit has no unsupported material claim; direct evidence one click away | GraphRAG (2024): community summaries for broad questions |
| **4.3 Add global synthesis mode** | Community/project summaries used only for broad questions | Improves coverage/diversity on global-question test slice without hurting citation precision | GraphRAG-V (2025): community detection on embeddings sufficient |
| **4.4 Implement research agent loop** | Observe → Decide → Research → Validate → Propose → Reflect | Shadow-run 30 days; measure proposal precision, accepted rate, cost/run | SSGM (2026): decouple discovery from truth |

### Phase 5: Governance & Evaluation Infrastructure (P4 — Ongoing)

**Goal:** Ensure knowledge quality, prevent corruption, and measure continuously.

| Action | Implementation | Acceptance Criteria | Research Basis |
|---|---|---|---|
| **5.1 Bitemporal fields** | `valid_from`, `valid_to`, `recorded_at`, `superseded_at`, `reviewed_at` on claims and relations | Time-travel and current-state queries return different, explainable results | AeonG (2024): anchor+delta pattern |
| **5.2 Epistemic states** | `candidate`, `reviewed`, `canonical`, `qualified`, `superseded`, `retracted`, `unanswerable` | States are never collapsed into free-text tags; transitions are audited | HELM (2025): epistemic governance tracks validity, not just content |
| **5.3 NLI verification gate** | Check new memories against core facts before committing | Cross-encoder veto blocks unsupported claims; logged as audit record | VeriCite (2025): NLI verification before generation |
| **5.4 Staleness detection** | Time-sensitive source rechecks; corrigenda/retraction monitoring | Affected claims marked as superseded or needing review within 24h of source change | MemArchitect (2026): +39.2% gain on temporal reasoning with decay |
| **5.5 Proposal inbox** | Reviewer sees evidence spans, source quality, confidence, duplicates, affected claims, and diff | Reviewer can approve, qualify, reject, or request more research; decision is immutable | SSGM (2026): separate discovery from truth |
| **5.6 Continuous evaluation** | RAGAS for automated evaluation; small human-annotated set for calibration | Weekly evaluation run; regression detection on corpus changes | RAGAS (2024): reference-free evaluation for iteration |

---

## 6. Evidence Register {#evidence-register}

### Dense Retrieval & Embeddings

1. Vladimir Karpukhin, Barlas Oğuz, Sewon Min, Patrick Lewis, Ledell Wu, Sergey Edunov, Danqi Chen, Wen-tau Yih. **Dense Passage Retrieval for Open-Domain Question Answering.** arXiv, 2020. 6,015 citations.
2. Shitao Xiao, Zheng Liu, Peitian Zhang, Niklas Muennighoff, Defu Lian, Jian-yun Nie. **C-Pack: Packed Resources for General Chinese Embeddings.** SIGIR, 2023. 637 citations.
3. Xiao Chen, Shitao Xiao, Chao Zhang, etc. **M3-Embedding: Multi-Lingual, Multi-Functionality, Multi-Granularity Text Embeddings Through Self-Knowledge Distillation.** arXiv, 2024. 203 citations.
4. Rao, Alipour, Pendar. **Rethinking Hybrid Retrieval: When Small Embeddings and LLM Re-ranking Beat Bigger Models.** arXiv, 2025. ~20 citations.
5. Li et al. **General Text Embeddings (GTE): Towards Understanding Text.** arXiv, 2023. ~400 citations.

### Chunking & Segmentation

6. Parth Sarthi, Salman Abdullah, Aditi Tuli, Shubh Khanna, Anna Goldie, Christopher D. Manning. **RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval.** ICLR, 2024. 527 citations.
7. Gomez-Cabello, Prabha, Haider, et al. **Comparative Evaluation of Advanced Chunking for RAG in LLMs for Clinical Decision Support.** Bioengineering, 2025. 8 citations.
8. Qu, Tu, Bao. **Is Semantic Chunking Worth the Computational Cost?** arXiv, 2024.
9. Günther, Mohr, Williams, Wang, Xiao. **Late Chunking: Contextual Chunk Embeddings Using Long-Context Embedding Models.** arXiv, 2024. ~30 citations.
10. Anthropic. **Introducing Contextual Retrieval.** Anthropic Engineering Blog, Sep 2024.

### RRF & Fusion

11. Gordon V. Cormack, Charles L. A. Clarke, Stefan Büttcher. **Reciprocal Rank Fusion outperforms Condorcet and Individual Rank Learning Methods.** SIGIR, 2009. 985 citations.
12. Bruch, Gai, Ingber. **An Analysis of Fusion Functions for Hybrid Retrieval.** ACM TOIS, 2023. 32 citations.
13. Samuel et al. **MMMORRF: Multimodal Multilingual Modularized Reciprocal Rank Fusion.** SIGIR, 2025.

### Reranking

14. Omar Khattab, Matei Zaharia. **ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT.** SIGIR, 2020. 1,900+ citations.
15. Cross-Encoder Reranking Study. **Cross-Encoder Reranking for RAG: A Comprehensive Study.** 2026.

### Graph & Community Detection

16. Darren Edge, Ha Trinh, Newman Cheng, Joshua Bradley, et al. **From Local to Global: A Graph RAG Approach to Query-Focused Summarization.** arXiv, 2024. 1,608 citations.
17. GraphRAG-V. **Fast Multi-Hop Retrieval via Text-Chunk Communities.** ASONAM, 2025.
18. Zirui Guo, Lianghao Xia, Yanhua Yu, Tu Ao, Chao Huang. **LightRAG: Simple and Fast Retrieval-Augmented Generation.** EMNLP, 2025. ~200 citations.
19. Bernal et al. **HippoRAG: Neurobiologically Inspired Long-Term Memory for Large Language Models.** NeurIPS, 2024. ~200 citations.

### Agentic Memory

20. Wujiang Xu, Zujie Liang, Kai Mei, Hang Gao, Juntao Tan, Yongfeng Zhang. **A-Mem: Agentic Memory for LLM Agents.** NeurIPS, 2025. 878 citations.
21. Yi Yu, Liuyi Yao, et al. **Agentic Memory: Learning Unified Long-Term and Short-Term Memory Management for LLM Agents.** ACL, 2026. 61 citations.
22. Prateek Chhikara et al. **Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory.** FAIA, 2025. 672 citations.
23. Zep team. **Zep: A Temporal Knowledge Graph Architecture for Agent Memory.** arXiv, 2025. ~50 citations.

### Bitemporal Knowledge

24. Abdullah Uz Tansel, Di Wu, Hsien-Tseng Wang. **Time Travel with the BiTemporal RDF Model.** Mathematics, 2025. ~11 citations.
25. Jiamin Hou et al. **AeonG: An Efficient Built-in Temporal Support in Graph Databases.** PVLDB, 2024. ~30 citations.

### Provenance & Citation

26. **Attribution, Citation, and Quotation: A Survey of Evidence-based Text Generation with LLMs.** arXiv, 2025. 134 papers surveyed.
27. **ContextCite: Attributing Model Generation to Context.** NeurIPS, 2024. ~50 citations.
28. Haosheng Qian et al. **VeriCite: Towards Reliable Citations in RAG via Rigorous Verification.** SIGIR-AP, 2025.

### Memory Governance

29. Chingkwun Lam et al. **Governing Evolving Memory in LLM Agents.** arXiv, 2026. ~10 citations.
30. Lingavasan Suresh Kumar et al. **MemArchitect: A Policy Driven Memory Governance Layer.** arXiv, 2026. ~5 citations.
31. **HELM: Steering Long-Horizon Agents with Learned Hierarchical Memory and Epistemic Governance.** OpenReview, 2025.

### RAG Evaluation

32. Shahul Es, Jithin James, Luis Espinosa-Anke, Steven Schockaert. **RAGAS: Automated Evaluation of Retrieval Augmented Generation.** EACL, 2024. 760 citations.
33. Saad Falcon et al. **ARES: An Automated Evaluation Framework for RAG Systems.** NAACL, 2024.
34. Nelson F. Liu et al. **Lost in the Middle: How Language Models Use Long Contexts.** TACL, 2023. 3,993 citations.
35. Park et al. **MIRAGE: A Metric-Intensive Benchmark for RAG Evaluation.** 2025.
36. Hao Yu et al. **Evaluation of Retrieval-Augmented Generation: A Survey.** Springer, 2024. 276 citations.

### Second Brain System References

37. Karpukhin et al., 2020. **Dense Passage Retrieval for Open-Domain Question Answering.** arXiv. 6,015 citations.
38. Cormack, Clarke & Büttcher, 2009. **Reciprocal Rank Fusion.** SIGIR. 985 citations.
39. Liu et al., 2023. **Lost in the Middle.** TACL. 3,993 citations.
40. Edge et al., 2024. **GraphRAG.** arXiv. 1,608 citations.

---

## What Not to Do Now

1. **Do not change BGE** merely because a newer embedding model exists. Measure the current baseline first.
2. **Do not treat cosine score as calibrated probability** or a semantic edge as proof of a causal/technical relation.
3. **Do not let the duplicate/contradiction agent merge or overwrite primary-source evidence.**
4. **Do not use nightly compression as the canonical research representation** — it is a convenience summary, not an auditable source.
5. **Do not adopt full GraphRAG** before provenance, relations, and global-query demand are measured.
6. **Do not skip evaluation.** Every threshold change must be measured against a gold set before promotion.

---

## Immediate First Sprint

1. Create the new schema and read-only `research_ingest` path
2. Ingest 20 foundational papers and 10 internal design documents using section-aware extraction
3. Create 100 real questions from the team's intended use: architecture, training-method, capability, limitation, and citation lookup
4. Run baseline retrieval through the current system and record Recall@10, MRR@10, citation-anchor availability, and p95 latency
5. Implement provenance-preserving chunking plus lexical retrieval; rerun the exact benchmark
6. Decide on an embedding/reranker change only from the measured delta

---

*This document is a living reference. Update it as research progresses and the system evolves.*
