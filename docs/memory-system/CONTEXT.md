# Context — Memory System Glossary

Domain terms used across the Memory Pillar feature. Each term has a tight definition and rejected synonyms to keep the ubiquitous language sharp.

---

## Core Concepts

### Entry
An immutable-by-default row in the `entries` table. The primary unit of memory — a chunk of text with tags, source, timestamps, and ownership. Entries are the only thing users see directly.

_Avoid:_ "memory", "note", "record" — these are ambiguous. "Entry" is the schema-level term.

### Episode
An immutable raw-content row linked 1:1 to an entry at capture time. Preserves the original text verbatim before any compression, merge, or append mutates `entries.content`. Episodes are the provenance ledger.

_Avoid:_ "raw entry", "original entry", "source record" — the term is "episode".

### Snapshot
A pre-mutation backup of an entry's content and tags, stored in `entry_snapshots` before every `update`, `append`, or compression. Snapshots are append-only — never updated or deleted.

_Avoid:_ "backup", "checkpoint", "version" — "snapshot" is the table and concept name.

### Retention Score
A 0.0–1.0 score representing how likely a memory is to be recalled, computed via exponential decay from `last_recalled_at` (not `created_at`). Configurable half-life (default 30 days).

_Avoid:_ "decay score", "relevance score", "freshness" — "retention score" is the field name.

### Epistemic Status
The system-detected validity state of a memory: `candidate → reviewed → canonical → qualified → stale → superseded → retracted`. Distinct from user-facing `status` tags (canonical/draft/deprecated).

_Avoid:_ "lifecycle status", "validity state" — "epistemic status" is the column and concept.

### Confidence Score
A 0.0–1.0 value on edges representing how certain the system (or user) is about the relationship. LLM-derived edges get LLM confidence; user-created default to 1.0.

_Avoid:_ "weight" (that's a separate column for edge strength), "certainty", "probability".

---

## Relationship Graph

### Edge
A directed or undirected relationship between two entries, stored in the `edges` table. Has `type`, `weight`, `provenance`, and now `confidence`. Types are code-validated, not SQL-constrained.

_Avoid:_ "link", "connection" — those are MCP tool names, not the schema term.

### Edge Type
A string constant from the `EDGE_TYPES` registry. Seven built-in types: `relates_to`, `supersedes`, `caused_by`, `decided`, `about_person`, `part_of_project`, `follows`. Phase 1 adds five more: `contradicts`, `derives_from`, `supports`, `evaluates_on`, `has_limitation`.

_Avoid:_ "relationship kind", "relation type" — "edge type" is the canonical term.

### Provenance
How an edge was created: `explicit` (user-created), `inferred` (auto-linked by cosine similarity), or `system` (contradiction resolution).

_Avoid:_ "source", "origin" — ambiguous with entry `source` field.

---

## Memory Lifecycle

### Compression
Nightly cron that digests multiple low-importance entries into a single `rolled-up` entry. Original entries are tagged `rolled-up` (not deleted). Compression is non-destructive — originals coexist with the digest.

_Avoid:_ "summarization", "aggregation", "merge" — "compression" is the system name.

### Rolled-Up
Tag applied to entries that have been compressed into a digest. Rolled-up entries are penalized in recall scoring (0.4 multiplier) but still accessible.

_Avoid:_ "compressed", "archived", "consolidated" — the tag value is `rolled-up`.

### Contradiction
A detected conflict between a new entry and an existing one. The new entry "wins" and the old one is deprecated (or the old one is protected if canonical). Creates a `contradicts` edge and `supersedes` edge.

_AVOID:_ "conflict", "override", "replacement" — "contradiction" is the detection system name.

### Smart Merge
When a new entry is flagged as similar (0.85–0.95 cosine), the LLM decides: `merge` (combine content), `replace` (overwrite), or `keep_both` (flag as duplicate-candidate).

_Avoid:_ "auto-merge", "intelligent merge" — "smart merge" is the feature name.

---

## Temporal Concepts (Phase 3)

### Bitemporal
Two independent time dimensions on every fact: **valid time** (when the fact was true in the world, via `valid_from`/`valid_to`) and **transaction time** (when we learned it, via `recorded_at`).

_Avoid:_ "dual-time", "temporal tracking" — "bitemporal" is the standard term.

### as_of
A recall parameter that filters to entries whose valid time window includes the given timestamp. "What did we believe on March 1st?"

_Avoid:_ "at-time", "historical query" — `as_of` is the parameter name.

---

## Multi-User

### Visibility Clause
A SQL fragment `(owner_user_id = ? OR tags NOT LIKE '%"private"%')` applied to every read query. Ensures users only see their own entries plus all public entries.

_Avoid:_ "access control", "permission filter" — "visibility clause" is the code term.

### Owner
The user who created an entry, stored in `owner_user_id`. `_system` owns all pre-migration entries (public, visible to all).

_Avoid:_ "creator", "author", "user" — "owner" is the column name.

---

## Schema Conventions

### Tag Convention
Metadata stored as a JSON array in `entries.tags`. Reserved prefixes: `status:` (lifecycle), `kind:` (episodic/semantic). No schema column backs tags — they're convention-only.

_Avoid:_ "metadata", "attributes" — "tags" is the column and concept.

### Fire-and-Forget
An async operation wrapped in `ctx.waitUntil()` that must not fail the request. If it throws, the error is logged but the response succeeds. Used for vectorization, classification, and edge inference.

_Avoid:_ "background job", "async task" — "fire-and-forget" is the pattern name.
