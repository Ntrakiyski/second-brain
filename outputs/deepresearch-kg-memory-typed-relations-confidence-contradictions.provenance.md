# Provenance Notes

- Graphiti source code was inspected from local clone fetched via `fetch_content` into `/tmp/pi-github-repos/getzep/graphiti`.
- Key files read:
  - `/tmp/pi-github-repos/getzep/graphiti/graphiti_core/edges.py`
  - `/tmp/pi-github-repos/getzep/graphiti/graphiti_core/prompts/dedupe_edges.py`
  - `/tmp/pi-github-repos/getzep/graphiti/graphiti_core/utils/maintenance/edge_operations.py`
  - `/tmp/pi-github-repos/getzep/graphiti/graphiti_core/search/search_config.py`
  - `/tmp/pi-github-repos/getzep/graphiti/graphiti_core/helpers.py`
  - `/tmp/pi-github-repos/getzep/graphiti/examples/gliner2/README.md`
- Fetched paper/content response IDs:
  - `mrjla57publh8o` (Zep, RoMem, TOKI, MemStrata content)
  - `mrjl8ginleeujn` / `mrjl9d8e137dm7` (Graphiti/help/docs/web results)
- Blocked/unverified:
  - `alpha_search` and `alpha_get_paper` failed on this topic during this run.
  - Graphiti docs subpages attempted under `help.getzep.com/graphiti/...` partly returned 404s; conclusions rely more on repo code + README + available paper text.
  - Mem0 graph-memory docs path was unstable / partially 404 during this run.
