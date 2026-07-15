# Pillar 2: Shared Knowledge Base Enhancements — Task Tickets

## Dependency Graph

```
S01 (Confidence Defaults) ──→ S02 (Confidence Exposure) ──→ S07 (Frontend Confidence)
S03 (Team Activity)          [independent]
S04 (Edge Proposals) ──→ S05 (Contradiction Recall Path)
                     ──→ S06 (Contradiction Nightly Path)
```

## Parallel Start

S01, S03, S04 can start in parallel (no dependencies).

## Tickets

| # | Title | Risk | Depends | Status |
|---|-------|------|---------|--------|
| 01 | Confidence Defaults by Provenance | low | — | pending |
| 02 | Confidence Exposure | low | S01 | pending |
| 03 | Team Activity Endpoint | low | — | pending |
| 04 | Edge Proposals Infrastructure | medium | — | pending |
| 05 | Cross-User Contradiction (Recall) | high | S04 | pending |
| 06 | Cross-User Contradiction (Nightly) | medium | S04 | pending |
| 07 | Frontend Confidence Display | low | S02 | pending |
