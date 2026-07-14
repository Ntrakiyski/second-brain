# Deep Research: Bi-temporal knowledge bases, Graphiti fact invalidation, and temporal query patterns for AI memory

## Summary

Graphiti implements **valid-time tracking on facts** using `valid_at` and `invalid_at`, and a separate **event/reference time** on episodes using `reference_time`. In the project’s own MCP docs, this is described as a **bi-temporal model**: each episode stores both when it was ingested and when the described event occurred. In practice, Graphiti’s fact invalidation works by **preserving prior edges and stamping their `invalid_at` when a newer contradictory fact becomes valid**, rather than deleting the old fact.

The main caveat is terminology: Graphiti does **not** expose the classic bitemporal pair `valid_from` / `valid_to`; it uses `valid_at` / `invalid_at` for fact validity windows, plus episode `created_at` and `reference_time`/`valid_at` semantics for ingestion vs event time. So Graphiti is **bitemporal-adjacent / partially bitemporal in implementation**, but not a full classical temporal-RDBMS bitemporal layer on every object.

## What Graphiti actually stores

### Observations from official Graphiti docs and code

1. **Facts/edges carry temporal validity metadata**
   - `EntityEdge` defines:
     - `valid_at`: when the fact became true
     - `invalid_at`: when the fact stopped being true
     - `expired_at`: when the system invalidated/superseded the stored edge
     - `reference_time`: timestamp from the episode that produced the edge
   - This is explicit in `graphiti_core/edges.py`.

2. **Episodes carry occurrence time separately from ingestion time**
   - Graphiti’s MCP instructions say each episode records both:
     - when it was ingested
     - when the described events actually occurred (`reference_time`)
   - If `reference_time` is omitted, current time is used.

3. **Graphiti itself describes this as bi-temporal**
   - The README says Graphiti has “explicit bi-temporal tracking with automatic fact invalidation.”
   - The MCP docs describe the episode model as bi-temporal.

4. **Indexes exist on temporal fields**
   - The core queries create indexes on `valid_at`, `invalid_at`, and `expired_at` for edges.
   - This suggests temporal filtering is a first-class retrieval path, not just metadata.

## How Graphiti invalidates facts

### Concrete implementation behavior

The strongest direct evidence is in `graphiti_core/utils/maintenance/edge_operations.py`.

#### 1. Contradictory old edges are not deleted
When a new resolved edge contradicts an existing one, Graphiti updates the older edge:
- `edge.invalid_at = resolved_edge.valid_at`
- `edge.expired_at = utc_now()` if not already set

That means the old fact remains in the graph with a closed validity window.

#### 2. New facts can themselves be immediately expired
If Graphiti already has evidence of a more recent contradictory fact, the newly extracted edge can be marked expired on ingest:
- `resolved_edge.invalid_at = candidate.valid_at`
- `resolved_edge.expired_at = now`

So Graphiti is trying to maintain a temporally coherent set of facts rather than blindly privileging the newest write.

#### 3. Timestamp extraction is separated from structural extraction
Release notes for `v0.29.0` state that timestamp resolution for `valid_at` / `invalid_at` was split into its own step, decoupled from node/edge extraction. That matters because validity windows are treated as a distinct inference stage.

### Inference

Graphiti’s invalidation model is best understood as **event-time supersession**:
- a fact becomes true at `valid_at`
- later contradictory evidence can close that window with `invalid_at`
- the system records when it performed the supersession via `expired_at`

This is stronger than ordinary “last write wins” memory and weaker than a fully normalized bitemporal audit system where every assertion and correction is uniformly queryable by both valid time and transaction time.

## Mapping Graphiti to classical bitemporal modeling

## Classical bitemporal model

A classical bitemporal system distinguishes:
- **Valid time**: when a fact is true in the modeled world
- **Transaction time**: when the database knew/recorded that fact

The paper **“Bitemporal Property Graphs to Organize Evolving Systems” (2021, arXiv:2111.13499)** explicitly frames a property-graph design around this split.

## Graphiti mapping

### Strong match
- **Valid time for facts**: `valid_at` / `invalid_at`
- **Event occurrence time for episodes**: `reference_time`
- **System/ingestion time**: episode `created_at`; edge `expired_at` partly reflects a system-time change moment

### Partial / weaker match
- Graphiti’s public docs emphasize bitemporal behavior, but the retrieved evidence does **not** show a full general transaction-time history model for every fact version exposed through a dedicated as-of-transaction query API.
- Instead, transaction-time semantics appear distributed across fields like `created_at` and `expired_at`, with validity-time filters more directly exposed.

### Bottom line
Graphiti is a **practical temporal memory graph with fact validity windows and some bitemporal semantics**, not obviously a textbook full bitemporal database abstraction.

## Temporal query patterns for AI memory systems

These patterns follow both Graphiti’s API surface and the broader temporal-KG literature.

### 1. Current-state query
**Question:** What is true now?

Pattern:
- retrieve facts where `valid_at <= now`
- and (`invalid_at IS NULL` or `invalid_at > now`)

Graphiti support:
- Graphiti exposes fact search with `valid_at_after`, `valid_at_before`, `invalid_at_after`, `invalid_at_before` filters.
- Current-state querying may require the client to set the appropriate bounds explicitly.

### 2. Historical as-of query
**Question:** What did the system believe at time `t` about the world at time `t`?

Pattern:
- valid-time slice at `t`
- optionally constrain ingestion/transaction-time if available

Graphiti support:
- strong support for valid-time slicing
- weaker evidence for first-class transaction-time slicing in the public query surface retrieved here

### 3. History-of-fact query
**Question:** How did a relationship change over time?

Pattern:
- fetch all edges between entities or all facts matching a predicate
- sort by `valid_at`, inspect `invalid_at`

Graphiti support:
- natural fit, because invalidated facts are preserved instead of deleted

### 4. Retroactive correction query
**Question:** What was entered later about an earlier event?

Pattern:
- compare episode `created_at` with episode `reference_time` / fact `valid_at`
- detect backfilled or corrected history

Graphiti support:
- supported conceptually by the episode bi-temporal model
- not enough retrieved evidence to claim a polished built-in query recipe

### 5. Windowed memory retrieval
**Question:** What facts were valid during a period like “during Q1 2026”?

Pattern:
- overlap query between fact validity interval and target interval
- i.e. `fact.valid_at <= window_end` and (`fact.invalid_at IS NULL` or `fact.invalid_at >= window_start`)

Graphiti support:
- feasible from its date-range filters
- likely needs client-side composition for exact interval-overlap semantics

### 6. Provenance-aware temporal recall
**Question:** Why does the system believe this fact, and from which episodes?

Pattern:
- retrieve fact plus supporting episode UUIDs / source episodes
- inspect episode content and timestamps

Graphiti support:
- strong, because provenance via episodes is a core design goal

## Recommended modeling pattern for AI memory

If you want a robust memory system inspired by Graphiti, the minimal durable schema is:

### Episode / observation layer
- `episode_id`
- `content`
- `reference_time` = when the observed event occurred
- `created_at` = when the memory system learned it
- `source`
- `group_id` / tenant / user scope

### Fact layer
- `fact_id`
- `subject`, `predicate`, `object`
- `valid_at`
- `invalid_at`
- `expired_at` = system-time supersession/deactivation timestamp
- `derived_from_episode_ids`
- optional confidence / extraction metadata

### Why this works
This separates:
- observation time
- world-validity time
- system update time

That separation is what enables:
- historical QA
- contradiction handling
- backfill ingestion
- “what changed?” explanations
- auditability for agent memory

## Design cautions

1. **Do not conflate `invalid_at` with deletion**
   In Graphiti, invalidation preserves history.

2. **Do not assume `valid_at` / `invalid_at` are the same as transaction time**
   They represent world-validity, not necessarily database record time.

3. **Window queries need interval logic**
   Simple before/after filters are not always enough for overlap semantics.

4. **Backfills matter**
   AI memory often learns old facts late. Without both event time and ingestion time, you cannot answer “what did we know then?” vs “what is now known about then?”

5. **LLM-driven contradiction detection can be fallible**
   Graphiti uses extraction/dedup/invalidation logic that depends partly on model judgments. That improves flexibility, but it is not equivalent to strict symbolic consistency.

## Evidence gaps / uncertainty

- I found strong evidence for Graphiti’s `valid_at` / `invalid_at` fact windows and episode `reference_time`.
- I found direct code for invalidating contradicted edges.
- I did **not** verify a full public Graphiti API for classical transaction-time as-of queries over fact versions.
- The alpha paper tools failed on this run, so the literature portion here relies on arXiv/web retrieval rather than alpha-generated paper reports.

## Recommended next steps

1. If you are building an AI memory system, model **valid time and ingestion time separately** from day one.
2. Add **interval-overlap query helpers** instead of only before/after filters.
3. Preserve invalidated facts rather than deleting them.
4. Expose two explicit APIs:
   - `state_at(t)`
   - `history(subject, predicate, object)`
5. If you need strict auditability, add explicit **transaction-time versioning** for every fact mutation, beyond Graphiti’s current practical fields.

## Sources

- Graphiti README: https://github.com/getzep/graphiti/blob/main/README.md
- Graphiti releases: https://github.com/getzep/graphiti/releases
- Graphiti repository: https://github.com/getzep/graphiti
- Graphiti MCP README: https://github.com/getzep/graphiti/blob/main/mcp_server/README.md
- Graphiti MCP server source: https://github.com/getzep/graphiti/blob/main/mcp_server/src/graphiti_mcp_server.py
- Graphiti edge model source: https://github.com/getzep/graphiti/blob/main/graphiti_core/edges.py
- Graphiti edge invalidation logic: https://github.com/getzep/graphiti/blob/main/graphiti_core/utils/maintenance/edge_operations.py
- Graphiti graph query/index definitions: https://github.com/getzep/graphiti/blob/main/graphiti_core/graph_queries.py
- Zep: A Temporal Knowledge Graph Architecture for Agent Memory (2025), arXiv:2501.13956: https://arxiv.org/abs/2501.13956
- Temporal Knowledge Graph Question Answering: A Survey (2024), arXiv:2406.14191: https://arxiv.org/abs/2406.14191
- Temporal Knowledge Graph Completion: A Survey (2022/2023), arXiv:2201.08236: https://arxiv.org/abs/2201.08236
- A Survey on Temporal Knowledge Graph Completion: Taxonomy, Progress, and Prospects (2023), arXiv:2308.02457: https://arxiv.org/abs/2308.02457
- Bitemporal Property Graphs to Organize Evolving Systems (2021), arXiv:2111.13499: https://arxiv.org/abs/2111.13499
