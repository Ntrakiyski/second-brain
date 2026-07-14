# Competitor Gems — Memory Pillar

Patterns from 13 competitors and 40+ papers that enable Pillar 1: Memory. Every pattern below is sourced, concrete, and maps to a specific deliverable.

---

## Phase 1: Foundation (Days 1-2)

### 1. Episodes — Immutable Source Ledger
Raw data is immutable. Every derived fact traces back to the episode that produced it. Compression never touches episodes.

**Source:** Graphiti — episodes are the raw ingestion stream, entities/facts are derived from episodes. `source_episode_id` links every fact to its origin.
**Source:** MemPalace — verbatim "drawers" where every memory IS the original text. 96.6% R@5 without LLM.
**Source:** memU — raw source files copied verbatim into `resource/` directory.

**Current gap:** `compressTag()` at `lifecycle.ts:223` overwrites `entries.content` with LLM digest. Original text permanently lost. No `episode_id`, no `content_hash`, no `raw_content` column.

**Schema:**
```sql
CREATE TABLE episodes (
  id TEXT PRIMARY KEY,
  source_url TEXT,
  content_hash TEXT NOT NULL,        -- SHA-256
  raw_content TEXT NOT NULL,         -- immutable
  content_type TEXT NOT NULL,        -- paper, conversation, webpage, code
  ingested_at TEXT NOT NULL,
  ingested_by TEXT,
  owner_user_id TEXT NOT NULL
);
```

### 2. Verbatim Storage (compression safety)
Subsumed by episodes. Original text always available alongside compressed digests. No summarization loss.

**Source:** MemPalace — 96.6% R@5 without LLM. Proves you don't need to summarize to retrieve well.
**Source:** Living organism architecture: "Do not use nightly compression as the canonical research representation — it is a convenience summary, not an auditable source."

**Current gap:** Compression overwrites originals. `rolledUpPenalty = 0.4` penalizes compressed entries but can't recover original text.

**Implementation:** Once episodes exist, `entries.content` = digest, `episodes.raw_content` = verbatim. Recall adds `detail: "summary" | "original"` parameter.

### 3. Backup Snapshots (rollback)
Before every mutation, create a backup. If it fails, roll back.

**Source:** TencentDB — checkpoint before every scene extraction, rollback on failure.
**Source:** beads — Dolt provides git-like snapshots, every change atomic and revertable.
**Source:** SSGM (Lam et al., 2026) — dual-track storage (mutable graph + immutable log).

**Current gap:** `update`, `append`, `compressTag` mutate directly. No rollback. No `entry_snapshots` table.

**Schema:**
```sql
CREATE TABLE entry_snapshots (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entries(id),
  content TEXT NOT NULL,
  tags TEXT,
  snapshot_type TEXT NOT NULL,  -- pre_update, pre_merge, pre_compress
  created_at TEXT NOT NULL
);
```

### 4. Typed Relations + Confidence
`contradicts`, `derives_from`, `supports`, `evaluates_on`, `has_limitation` — each with 0.0-1.0 confidence.

**Source:** AgentMemory — `contradicts`, `supersedes`, `derives_from`, `conflicts_with` with confidence scores. Auto-forget detects contradictions.
**Source:** Graphiti — relationships typed with `valid_from`/`valid_to`. Extensible entity types.
**Source:** TROVE (2025) — four provenance types: quotation, compression, inference, others. Track provenance type per edge.

**Current gap:** Only `relates_to` auto-inferred. No confidence column. No `contradicts` or `derives_from` types.

**Schema change:**
```sql
ALTER TABLE edges ADD COLUMN confidence REAL DEFAULT 1.0;
ALTER TABLE edges ADD COLUMN valid_from TEXT;
ALTER TABLE edges ADD COLUMN valid_to TEXT;
```

**New edge types:** `contradicts` (directed), `derives_from` (directed), `supports` (undirected), `evaluates_on` (directed), `has_limitation` (directed).

---

## Phase 2: Lifecycle (Days 2-3)

### 5. Spaced Repetition Decay
SM-2-inspired retention scoring. `retention_score` decays with configurable half-life from time-since-last-recall.

**Source:** AgentMemory — `retention.ts` implements forgetting curve: `retention_score = e^(-λ * days_since_recall)` where `λ = ln(2) / halflife_days`. Configurable per memory type.
**Source:** AgeMem — 7-day half-life recency decay. Hybrid: `0.6 * cosine + 0.25 * recency_decay + 0.15 * learning_score`.
**Source:** MemArchitect (Suresh Kumar et al., 2026) — FSRS spaced-repetition decay + Cross-Encoder veto gate. **+7.45% accuracy, +39.2% on temporal reasoning.**

**Current gap:** `getHalfLifeMs()` at `helpers.ts:79` applies decay to age-since-creation, NOT time-since-last-recall. A memory recalled 100 days ago still scores well because `frequencyMultiplier` compensates. No `last_recalled_at` column. No independent `retention_score`.

**Schema:**
```sql
ALTER TABLE entries ADD COLUMN last_recalled_at INTEGER;
ALTER TABLE entries ADD COLUMN retention_score REAL DEFAULT 1.0;
ALTER TABLE entries ADD COLUMN decay_halflife_days INTEGER DEFAULT 30;
```

**Scoring change:** `final_score = cosineScore × retentionScore × recencyMultiplier × importanceMultiplier × tagBoost`

---

## Phase 3: Temporal Truth (Days 4-6)

### 6. Bitemporal Facts
Every fact has two clocks: when it was true in the world, and when we learned it.

**Source:** Graphiti — `valid_from`/`valid_to` (valid time) + `created_at`/`expired_at` (transaction time). Old facts structurally invalidated, never deleted. Query `as_of` any timestamp.
**Source:** MemPalace — knowledge graph entries have `valid_from`/`valid_to`. Temporal proximity boosting.
**Source:** Chekol & Stuckenschmidt (2018) — probabilistic bitemporal knowledge graphs combining confidence with dual clocks.
**Source:** Han et al. (2025) — RAG meets temporal graphs. Models identical facts from different times as distinct relations.
**Source:** AeonG (Hou et al., 2024) — anchor+delta strategy: periodic snapshots + incremental changes. 5.73x lower storage.

**Current gap:** Entries have only `created_at`. No `valid_from`, `valid_to`, `recorded_at`. No `as_of` parameter on recall.

**Schema:**
```sql
CREATE TABLE facts (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entries(id),
  claim TEXT NOT NULL,
  confidence REAL DEFAULT 1.0,
  valid_from TEXT,
  valid_to TEXT,
  recorded_at TEXT NOT NULL,
  superseded_by TEXT REFERENCES facts(id),
  source_passage_id TEXT,
  owner_user_id TEXT NOT NULL
);

ALTER TABLE entries ADD COLUMN valid_from TEXT;
ALTER TABLE entries ADD COLUMN valid_to TEXT;
ALTER TABLE entries ADD COLUMN recorded_at TEXT;
```

### 7. Staleness Detection
Track not just WHAT is stored but WHETHER it is still valid.

**Source:** HELM (2025, OpenReview) — epistemic governance. EpiErr correlates r~-0.65 with task failure. **Staleness detection is critical.**
**Source:** SSGM (Lam et al., 2026) — three failure points: Memory Poisoning, Semantic Drift, Conflict/Hallucination.
**Source:** Living organism architecture — epistemic states: `candidate`, `reviewed`, `canonical`, `qualified`, `superseded`, `retracted`, `unanswerable`. Never collapse into one free-text tag.
**Source:** Memory Poisoning research (2024-2026) — adversarial text stored as memory; append-only log with rollback is a defense.

**Current gap:** Tags encode status as metadata conventions. No `reviewed_at`, `superseded_at`, or epistemic state machine. No retraction/corrigenda detection. No source rechecking.

**Schema:**
```sql
ALTER TABLE entries ADD COLUMN reviewed_at INTEGER;
ALTER TABLE entries ADD COLUMN superseded_at INTEGER;
ALTER TABLE entries ADD COLUMN source_recheck_at INTEGER;
ALTER TABLE entries ADD COLUMN epistemic_status TEXT DEFAULT 'candidate';
```

**Epistemic state machine:** `candidate → reviewed → canonical → qualified → superseded → retracted`

---

## Phase 4: Citations (Days 7-14+)

### 8. Evidence Passages (citation-grade granularity)
Sub-entry text spans linked to both an entry and an episode. Every claim citable to paper/section/page.

**Source:** Graphiti — raw episodes are the evidence. Every derived fact links to source episode.
**Source:** ContextCite (MadryLab, NeurIPS 2024) — learns contributive attribution: which context parts CAUSED a statement.
**Source:** VeriCite (Qian et al., 2025) — NLI-verify each claim against sources before generation.
**Source:** Attribution Survey (2025, 134 papers) — most systems produce document-level citations, not sentence-level.

**Current gap:** Entries are flat 1600-char blobs. No sub-entry granularity. No `evidence_passages` table.

**Schema:**
```sql
CREATE TABLE evidence_passages (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entries(id),
  episode_id TEXT REFERENCES episodes(id),
  passage_text TEXT NOT NULL,
  section_heading TEXT,
  page_number INTEGER,
  char_offset_start INTEGER,
  char_offset_end INTEGER,
  embedding_id TEXT,
  created_at TEXT NOT NULL
);
```

### 9. Document Hierarchy
`document → section → passage → claim` — structured provenance for research.

**Source:** RAPTOR (Sarthi et al., 2024, ICLR, 527 cites) — recursive clustering produces hierarchy. **+20% on complex QA.** Full-tree retrieval critical.
**Source:** Gomez-Cabello et al. (2025) — adaptive/topic-aligned chunking outperforms fixed character cuts. "Fixed cuts can sever methods from results."
**Source:** Technical KB report — document model gap rated **Critical**. "Cannot cite sources."

**Current gap:** Fixed 1600-char chunks. No document_id, section_path, page offsets.

**Schema:**
```sql
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  canonical_url TEXT,
  doi_or_arxiv_id TEXT,
  title TEXT,
  authors_json TEXT,
  publication_date TEXT,
  venue TEXT,
  version TEXT,
  source_type TEXT,
  content_hash TEXT,
  ingested_at TEXT NOT NULL
);

CREATE TABLE document_sections (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  parent_section_id TEXT,
  heading TEXT,
  ordinal INTEGER,
  page_start INTEGER,
  page_end INTEGER,
  char_start INTEGER,
  char_end INTEGER
);
```

---

## What NOT to Steal

| Pattern | Source | Why Skip |
|---------|--------|----------|
| Zettelkasten linking | A-MEM | LLM-heavy on every add, cost-prohibitive |
| Palace metaphor | MemPalace | Cognitive overhead, tags are simpler |
| Markdown files | memU | File-based doesn't scale for multi-user |
| Pluggable backends | MemPalace | No second backend exists yet |
| Full GraphRAG | Microsoft | Corpus too small, premature |

---

## Summary

| Phase | Patterns | Effort | Impact |
|-------|----------|--------|--------|
| **Phase 1: Foundation** | Episodes, Verbatim, Snapshots, Typed Relations | ~2 days | Critical |
| **Phase 2: Lifecycle** | Spaced Repetition Decay | ~1 day | High (+39.2% temporal reasoning) |
| **Phase 3: Temporal Truth** | Bitemporal Facts, Staleness Detection | ~4 days | Critical |
| **Phase 4: Citations** | Evidence Passages, Document Hierarchy | ~2 weeks | Critical |

**Total: ~3 weeks for full Memory Pillar.** Each phase independently shippable. Phase 1 alone eliminates destructive compression and enables provenance.
