# Deep Research: Knowledge-Graph Refinement for AI Memory Systems

## Summary

Production memory systems are converging on **typed relations + temporal validity + provenance**, but **not** on a shared native confidence model.

- **Graphiti/Zep** implements **typed edges**, **temporal validity windows** (`valid_at`, `invalid_at`), **LLM-based contradiction detection**, and **edge invalidation instead of deletion**.
- In the public Graphiti code/docs I inspected, **confidence scoring is not a first-class edge field**. What exists instead is **retrieval/reranker scores** and optional thresholds in adjacent components/examples.
- **Auto-linking quality** in Graphiti is mostly controlled by **entity/edge deduplication prompts**, **same-endpoint edge candidate restriction**, and search/reranker settings—not by a single documented production threshold.
- **Pruning** in Graphiti is primarily **temporal supersession** and selective chunking/retrieval, not aggressive graph deletion. The strongest explicit pruning-like heuristic I found is **retiring contradicted edges** while preserving history.
- Recent research argues that production contradiction handling should be treated as **write-time concurrency control** with **audit rows / provenance retention**, not just “latest wins” heuristics.

## What Graphiti actually implements

### 1) Typed relations

**Observation.** Graphiti supports prescribed ontology with developer-defined entity and edge types.

- README: “Developer-defined entity and edge types via Pydantic models.”
- Graphiti code accepts `edge_type_candidates` and extracts typed edge attributes when the relation type matches an allowed custom type.

**Implication.** Graphiti’s production abstraction for “typed relations” is real and explicit, not just emergent labels.

### 2) Temporal validity instead of overwrite

**Observation.** `EntityEdge` includes:
- `expired_at`
- `valid_at`
- `invalid_at`
- `reference_time`

Contradicted older edges are not deleted; they are invalidated by setting `invalid_at` to the new edge’s `valid_at` when timelines overlap.

**Implication.** Graphiti’s contradiction resolution is fundamentally **temporal supersession**, not destructive overwrite.

### 3) Contradiction detection is LLM-mediated

**Observation.** Graphiti asks an LLM to return:
- `duplicate_facts`
- `contradicted_facts`

The prompt explicitly says a new fact can contradict an existing fact without being a duplicate, e.g. title change or role change.

**Implication.** Graphiti’s contradiction detection is flexible, but correctness depends on prompt/model reliability. There is no formal proof of consistency in the public implementation.

### 4) Auto-linking / edge-resolution quality controls

**Observation.** In the public code, Graphiti reduces false links via several mechanisms:

1. **Entity resolution** against existing nodes.
2. **Edge deduplication restricted to same source/target pair** before broader invalidation search.
3. **Hybrid retrieval + reranking** for search.
4. Optional typed edge schemas and attribute extraction.
5. Search config supports `reranker_min_score`, plus reranker score arrays.

Graphiti examples also show thresholds in adjacent extraction components, e.g. GLiNER2 entity extraction threshold.

**Implication.** Graphiti uses a **multi-stage quality gate**, but I did **not** find one single documented production “auto-link threshold” governing all edge creation.

### 5) Confidence scoring: weak evidence in Graphiti OSS

**Observation.** I did **not** find a native `confidence` field on `EntityEdge` in the Graphiti code I inspected.

What I did find:
- reranker scores in search results
- confidence thresholding in the **GLiNER2 example** for NER extraction
- temporal invalidation logic with no explicit edge-belief score

**Implication.** If you want confidence-aware graph maintenance in a Graphiti-like system, you likely need to add it yourself (or use a different platform layer). Public Graphiti OSS appears more **temporal/provenance-centric** than **confidence-centric**.

## Contradiction resolution strategies across production / research

## 1) Graphiti/Zep: newest valid fact wins, older fact retained

**Observed behavior.**
- New fact is compared to related/overlapping facts.
- Contradictory earlier facts get `invalid_at` set.
- History is retained for as-of queries and provenance.

**Strengths.**
- Good for evolving truth.
- Avoids stale retrieval if queries respect validity.
- Preserves lineage.

**Weaknesses.**
- Depends on LLM contradiction judgments.
- No native confidence weighting in the public edge schema.

## 2) Heuristic production patterns identified by TOKI (2026)

TOKI classifies production contradiction strategies into four families:
- **last-writer-wins**
- **evidence-weighted merge**
- **await-confirmation**
- **per-rule policy**

TOKI’s main claim is not that one heuristic always wins, but that systems should explicitly declare:
- isolation assumptions
- provenance retention
- audit behavior
- replay consistency guarantees

**Implication.** This is a useful lens for evaluating AI memory systems beyond raw QA accuracy.

## 3) RoMem / temporal KG research

RoMem argues that many systems wrongly treat time as metadata, then rely on:
- recency sorting
- overwriting
- per-ingest LLM adjudication

Its alternative is a temporal representation where outdated facts naturally lose retrieval salience without deletion.

**Implication.** Confidence scoring is not the only route to stale-fact control; **temporal representation itself** can do part of the work.

## Confidence scoring: what seems robust in practice

## Strongest evidence

1. **Use confidence where extraction itself is noisy.**
   - Example: NER/triple extraction thresholds.
2. **Use temporal invalidation where the relation is inherently stateful.**
   - Employment, version, endpoint, config value, manager, status.
3. **Keep provenance/audit rows for every overwritten or invalidated fact.**
4. **Do not rely on cosine similarity alone to separate duplicates vs contradictions.**
   - Recent evidence says it is near chance for that task.

## Likely good design for a production system

A practical hybrid looks like:

- **typed edge**
- **belief/confidence score** on extraction
- **support count / evidence list**
- **valid_at / invalid_at**
- **superseded_by** or audit-row link
- **relation-specific contradiction policy**

Example policy sketch:

| Relation class | Recommended rule |
|---|---|
| Immutable facts (`born_in`) | never supersede, just dedupe |
| Stateful single-value facts (`works_for`, `api_path`, `config_value`) | invalidate previous active fact on contradiction |
| Multi-valued facts (`likes`, `uses`, `skills`) | additive unless explicit negation |
| Safety-critical facts | await confirmation or evidence-weighted merge |

## Graph pruning heuristics

## What I found in Graphiti / neighbors

### Graphiti
- **Prunes by invalidation, not deletion** for contradicted facts.
- Restricts some expensive resolution to local candidate sets.
- Uses chunking only for high-density content via `CHUNK_DENSITY_THRESHOLD`.
- Maintains indexes on validity timestamps.

### Research / broader practice
- Retire stale facts from active retrieval but preserve them in audit/history.
- Prune low-value raw candidates earlier than curated asserted facts.
- Prefer pruning by:
  - low confidence
  - low support
  - age without re-mention
  - redundancy within same `(subject, relation)` bucket

## Recommended pruning heuristic stack

1. **Never hard-delete contradicted facts immediately.** Mark inactive first.
2. **Separate active graph from audit graph.**
3. **Apply TTL only to weakly supported, low-confidence, never-reused facts.**
4. **Use relation-aware pruning.** Pruning `favorite_color` is not the same as pruning `manager_of`.
5. **Audit every destructive compaction step.**

## Gaps / disagreements / uncertainty

1. **Graphiti confidence scores**: unverified as a native production edge field in public OSS.
2. **Single auto-link threshold in Graphiti**: I did not find a canonical one.
3. **Mem0 graph-memory docs** were partially unstable / moved during retrieval, so I am not relying heavily on them here.
4. **TOKI** is research, not evidence that existing deployed systems already meet its contract.
5. **RoMem** is promising, but not a direct production-system audit.

## Recommended next steps

If your goal is to refine an AI memory graph for production:

1. **Adopt Graphiti-style temporal invalidation first.**
2. **Add explicit edge confidence + evidence count yourself.**
3. **Make contradiction policy relation-specific.**
4. **Keep an audit row / supersession chain.**
5. **Benchmark stale-fact error directly**, not just answer accuracy.

A minimal schema extension worth testing:

```text
Edge {
  subject_id
  relation_type
  object_value
  confidence
  support_count
  evidence_ids[]
  valid_at
  invalid_at
  superseded_by
  source_policy
}
```

## Bottom line

Graphiti’s strongest production idea is **temporal truth maintenance with typed edges and provenance**.

Its weakest public area, relative to your question, is **explicit confidence scoring**: I found strong evidence for temporal invalidation and contradiction handling, but weak evidence for a first-class confidence-bearing edge model or a single documented auto-link threshold.

So if you want a production KG memory system with:
- typed relations
- confidence scores
- contradiction resolution
- pruning

…the best-supported recipe from current evidence is **Graphiti-style temporal supersession + your own explicit confidence/evidence layer + relation-specific policies**.

## Sources

- Graphiti repository: https://github.com/getzep/graphiti
- Graphiti README: https://github.com/getzep/graphiti/blob/main/README.md
- Graphiti `EntityEdge` schema (local clone from repo): https://github.com/getzep/graphiti/blob/main/graphiti_core/edges.py
- Graphiti edge dedupe/contradiction prompt (local clone from repo): https://github.com/getzep/graphiti/blob/main/graphiti_core/prompts/dedupe_edges.py
- Graphiti edge resolution/invalidation logic (local clone from repo): https://github.com/getzep/graphiti/blob/main/graphiti_core/utils/maintenance/edge_operations.py
- Graphiti search config (local clone from repo): https://github.com/getzep/graphiti/blob/main/graphiti_core/search/search_config.py
- Graphiti helper chunking heuristic (local clone from repo): https://github.com/getzep/graphiti/blob/main/graphiti_core/helpers.py
- Graphiti GLiNER2 example threshold: https://github.com/getzep/graphiti/blob/main/examples/gliner2/README.md
- Zep paper: "Zep: A Temporal Knowledge Graph Architecture for Agent Memory" (2025), arXiv:2501.13956 https://arxiv.org/abs/2501.13956
- RoMem paper: "Time is Not a Label: Continuous Phase Rotation for Temporal Knowledge Graphs and Agentic Memory" (2026), arXiv:2604.11544 https://arxiv.org/abs/2604.11544
- TOKI paper: "TOKI: A Bitemporal Operator Algebra for Contradiction Resolution in LLM-Agent Persistent Memory" (2026), arXiv HTML mirror via fetched content https://arxiv.org/html/2606.06240
- MemStrata draft: "Eliminating Stale-Fact Errors for AI Agents over Evolving Knowledge" (fetched draft) https://arxiv.org/html/2606.26511v1
