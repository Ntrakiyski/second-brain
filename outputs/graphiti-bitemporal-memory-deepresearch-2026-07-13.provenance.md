# Provenance: graphiti-bitemporal-memory-deepresearch-2026-07-13

## Primary inspected sources

- Graphiti README fetched and inspected from GitHub clone at `/tmp/pi-github-repos/getzep/graphiti@main/README.md`
- Graphiti release notes fetched from GitHub releases page
- Local code inspection via ripgrep/read on cloned repo:
  - `graphiti_core/edges.py`
  - `graphiti_core/utils/maintenance/edge_operations.py`
  - `graphiti_core/graph_queries.py`
  - `mcp_server/src/graphiti_mcp_server.py`
  - `mcp_server/src/utils/type_config.py`
  - `graphiti_core/graphiti.py`

## Key command evidence

- Code search for temporal/invalidation fields:
  - `cd /tmp/pi-github-repos/getzep/graphiti@main && rg -n "valid_at|invalid_at|bi-temporal|bitemporal|reference_time|as_of|search.*time|temporal" graphiti_core mcp_server server examples`
- Code search for invalidation logic:
  - `cd /tmp/pi-github-repos/getzep/graphiti@main && rg -n "invalidate|invalidat|invalid_at =|SET e.invalid_at|expired_at|supersed" graphiti_core mcp_server`

## Notable observations tied to files

- `graphiti_core/edges.py`: edge schema includes `valid_at`, `invalid_at`, `expired_at`, `reference_time`
- `graphiti_core/utils/maintenance/edge_operations.py`: contradiction handling stamps old edge `invalid_at = resolved_edge.valid_at`
- `mcp_server/src/graphiti_mcp_server.py`: MCP instructions explicitly describe a bi-temporal model and fact validity windows
- `mcp_server/src/graphiti_mcp_server.py` + `mcp_server/src/utils/type_config.py`: fact search exposes `valid_at_*` and `invalid_at_*` filters
- `graphiti_core/graph_queries.py`: indexes created on temporal fields
- `graphiti/releases`: `v0.29.0` notes mention decoupled timestamp extraction for `valid_at` / `invalid_at`

## Literature retrieval status

- Web retrieval succeeded for:
  - arXiv:2406.14191
  - arXiv:2201.08236
  - arXiv:2308.02457
  - arXiv:2111.13499
- `alpha_search` and `alpha_get_paper` failed during this run (`fetch failed`), so no alphaXiv AI reports were used.

## Blocked / Unverified

- Unverified: a complete first-class Graphiti transaction-time query API equivalent to classical bitemporal DB `AS OF TRANSACTION TIME`
- Blocked: alphaXiv paper-fetch path failed on this run
