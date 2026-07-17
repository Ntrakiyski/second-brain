# ADR-0003: Edge Proposal Lifecycle

**Status:** Superseded 2026-07-16 by the generic governed action-proposal state machine

Automated findings now use `action_proposals`, with expiry, immutable event
history, evidence and payload hashes, mandatory audit, human-only review,
compare-and-set execution, and execution-time policy/revision/precondition
checks. The legacy `edge_proposals` endpoints remain only for compatibility and
are not an automation target.

Cross-user contradiction detection proposes `contradicts` edges for human approval. Proposals need a lifecycle but shouldn't over-automate.

No expiry — proposals are lightweight rows; irrelevant ones get manually rejected. Any authenticated user can approve/reject (small team, anyone can assess validity). Approval creates the `contradicts` edge and marks the proposal `approved`; rejection just marks `rejected`. No automatic `epistemic_status` changes on approval — the existing staleness detection already handles `contradicts` edges. Deduplication by `(source_id, target_id)` prevents duplicate proposals from the dual detection paths.
