# Provenance: PaperRank agentic knowledge memory systems with semantic search knowledge graphs and contradiction detection

- Date: 2026-07-13T18:31:22.485Z
- Slug: `agentic-knowledge-memory-systems-semantic`
- Source mode: openalex
- Source URL/path: https://api.openalex.org/works?search=agentic+knowledge+memory+systems+with+semantic+search+knowledge+graphs+and+contradiction+detection&amp;per-page=25&amp;select=id%2Cdoi%2Ctitle%2Cdisplay_name%2Cpublication_year%2Cpublication_date%2Ctype%2Ccited_by_count%2Ccitation_normalized_percentile%2Creferenced_works%2Crelated_works%2Cauthorships%2Cprimary_location%2Clocations%2Cbest_oa_location%2Copen_access%2Cconcepts%2Ctopics%2Cabstract_inverted_index%2Cids%2Cis_retracted
- Papers fetched: 25
- Graph papers: 25
- Citation expansion requested per seed: 0
- Citation expansion outgoing candidates/fetched: 0/0
- Citation expansion incoming fetched: 0
- Citation expansion expanded papers: 0
- Local citation edges: 6
- Graph prestige included: yes
- Full-text enrichment requested: top 0
- Full-text enrichment attempted/available/missing/errors: 0/0/0/0
- Research critiques generated: 0
- Field map clusters: 12
- Field map paper roles: 25
- Rank sensitivity generated: yes
- Rank sensitivity stable/sensitive/volatile papers: 1/3/21
- Rank sensitivity top paper stable: yes
- Score calibration generated: yes
- Score calibration status: not_provided
- Score calibration evaluated/ignored preferences: 0/0
- Reproduction evidence status: not_provided
- Reproduction evidence evaluated/ignored notes: 0/0
- Reproduction outcome counts reproduced/partial/failed/not-runnable: 0/0/0/0
- Next research actions generated: yes
- Next research actions status/actions/high-priority: needs_calibration_and_reproduction/4/4
- Next research actions recommended score profile: Balanced PaperRank (default_unverified)
- Next research actions top action: Read #1: Knowledge graph refinement: A survey of approaches and evaluation methods
- Graph explorer nodes/edges: 25/6
- Model synthesis packet top papers: 5
- Model synthesis requested/status: no/not_requested
- Field map generated: yes
- Score audit generated: yes
- Rank sensitivity artifact generated: yes
- Graph explorer generated: yes
- Score calibration artifact generated: no
- Calibration template generated: no
- Calibration guide generated: no
- Reproduction ledger generated: no
- Reproduction notes template generated: no
- Replication plan generated: no
- Model synthesis packet generated: no
- Model synthesis generated: no
- Source meta:

```json
{
  "count": 2159,
  "db_response_time_ms": 87,
  "page": 1,
  "per_page": 25,
  "groups_count": null,
  "x_query": {
    "oql": "works where full text has (agentic knowledge memory systems with semantic search knowledge graphs \"and\" contradiction detection)",
    "oqo": {
      "get_rows": "works",
      "filter_rows": [
        {
          "column_id": "fulltext.search",
          "value": "agentic knowledge memory systems with semantic search knowledge graphs and contradiction detection",
          "operator": "has"
        }
      ],
      "select": [
        "id",
        "doi",
        "title",
        "display_name",
        "publication_year",
        "publication_date",
        "type",
        "cited_by_count",
        "citation_normalized_percentile",
        "referenced_works",
        "related_works",
        "authorships",
        "primary_location",
        "locations",
        "best_oa_location",
        "open_access",
        "concepts",
        "topics",
        "abstract_inverted_index",
        "ids",
        "is_retracted"
      ],
      "per_page": 25
    },
    "url": "/works?filter=fulltext.search:agentic knowledge memory systems with semantic search knowledge graphs and contradiction detection&select=id,doi,title,display_name,publication_year,publication_date,type,cited_by_count,citation_normalized_percentile,referenced_works,related_works,authorships,primary_location,locations,best_oa_location,open_access,concepts,topics,abstract_inverted_index,ids,is_retracted&per_page=25"
  },
  "cost_usd": 0.001
}
```

## Score Formula

- `0.30 * topical_relevance`
- `0.20 * citation_impact`
- `0.20 * graph_prestige` when local citation edges exist
- `0.10 * citation_velocity`
- `0.10 * methodology_quality`
- `0.10 * reproducibility`
- Missing components are excluded from the denominator and recorded per paper in the scores JSONL.

## Scientific And Data Sources

- OpenAlex Works API: https://developers.openalex.org/api-reference/works (Defines Works as scholarly documents and documents the search/list surface used by feynman rank.)
- OpenAlex work object: https://github.com/ourresearch/openalex-docs/blob/main/api-entities/works/work-object/README.md (Documents cited_by_count, citation_normalized_percentile, and referenced_works.)
- OpenAlex work citation filters: https://github.com/ourresearch/openalex-docs/blob/main/api-entities/works/filter-works.md (Documents cited_by/cites filters used to expand the local citation neighborhood.)
- The Eigenfactor Metrics: A Network Approach to Assessing Scholarly Journals: https://crl.acrl.org/index.php/crl/article/view/16080 (Supports PageRank-like citation-network prestige as a bibliometric signal.)
- A Bias-Free Time-Aware PageRank Algorithm for Paper Ranking in Dynamic Citation Networks: https://www.scirp.org/journal/paperinformation?paperid=115348 (Motivates keeping citation velocity separate from lifetime citation count.)
- NeurIPS Paper Checklist Guidelines: https://neurips.cc/public/guides/PaperChecklist (Grounds methodology and reproducibility screening in explicit ML-paper quality dimensions.)

## Verification State

- Metadata fields came from OpenAlex-shaped work records.
- Citation graph is local to the fetched candidate set and should not be read as a global citation graph.
- Field-map clusters use OpenAlex topic/concept labels from fetched seed and citation-neighborhood papers; they are a local map of this run, not a full field taxonomy.
- Rank sensitivity reruns the same component signals under alternate weighting profiles and reports rank movement; it is a stress test of the weighting choice, not empirical validation of those weights.
- Score calibration compares rank order against supplied researcher preference files when provided; without a preference file, default weights remain uncalibrated and are labeled that way.
- Calibration template and guide artifacts are not generated unless a preference file is supplied.
- Reproduction ledger compares supplied completed reproduction notes against this ranked seed set; without reproduction notes, ranked papers remain planned checks rather than completed reproductions.
- Reproduction ledger, reproduction notes template, and replication plan artifacts are not generated unless reproduction notes are supplied.
- Graph explorer embeds bounded citation graph metadata, score summaries, roles, and links for inspection; it does not embed raw full-text bodies.
- Methodology and reproducibility are screening heuristics over visible metadata, abstracts, URLs, and enriched full text when requested; matching evidence spans are preserved in the scores JSONL.
- Section-aware rubric findings are deterministic checklist screens over extracted full-text sections, not claim validation.
- Research critiques are deterministic, span-grounded prompts over PaperRank evidence; they are not an external review decision.
- The ranked brief is the canonical human-readable triage output; the score audit, graph explorer, field map, and provenance hold the inspection details.
- Model synthesis uses the bounded packet/prompt contract only when requested; a failed or unavailable model call does not alter the deterministic score artifacts.
