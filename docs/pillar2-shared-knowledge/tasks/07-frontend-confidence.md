# S07: Frontend Confidence Display

## What to Build

Display confidence on edges in the dashboard force-directed graph.

## Acceptance Criteria

- [ ] Graph edges render with opacity based on confidence (higher = more opaque)
- [ ] Hovering an edge shows confidence percentage in tooltip
- [ ] Edge data includes confidence field from `GET /graph` response
- [ ] No filtering — all edges shown regardless of confidence value
- [ ] Visual change is subtle, not disruptive to existing graph layout

## File Changes

- `public/utils.js` — Read confidence from edge data, apply to rendering

## Blockers

Depends on S02 (graph endpoint must return confidence).
