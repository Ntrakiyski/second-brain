# ADR-0001: Confidence Defaults by Provenance

The `confidence` column exists on `edges` but `createEdge()` defaults everything to 0.5 regardless of provenance. This produces misleading recall scoring — explicit (user-created) links have the same confidence as weak inferred links.

Set confidence defaults by provenance: `explicit → 1.0` (user is certain), `inferred → same as weight` (cosine similarity is the confidence measure), `system → 1.0` (system-detected contradictions are certain). The recall scoring formula already uses `confidence` — better values flowing in naturally improve scores without formula changes.
