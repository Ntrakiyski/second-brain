# ADR-0002: Snapshots Before Every Mutation

**Status:** Accepted  
**Date:** 2026-07-13  
**Deciders:** Nikolay Trakiyski  

## Context

`update`, `append`, and compression mutate entries directly with no rollback path. If a user accidentally updates or compresses an entry, the previous state is lost forever (unless the entry was tagged `rolled-up`, in which case the original text survives but the relationship is implicit).

## Decision

Create an `entry_snapshots` table. Before every mutation (`update`, `append`, compression), INSERT a snapshot of the current content and tags. Snapshots are append-only. A new `restore` MCP tool and REST endpoint creates a NEW entry from a snapshot — never in-place rollback.

## Consequences

- **Positive:** Every mutation has a pre-change backup. Restore is always possible.
- **Positive:** Restore creates new entry → preserves full history, no destructive rollback.
- **Positive:** One INSERT before UPDATE — negligible performance cost on D1.
- **Negative:** One extra INSERT per mutation (non-fatal). Storage grows with mutation frequency.
- **Neutral:** Pre-migration entries have no snapshots. Known limitation.

## Alternatives Considered

1. **Git-like versioning (Dolt-style)** — complex, requires a new database backend.
2. **In-place rollback** — destroys current state, the exact problem we're solving.
3. **Soft-delete with recovery** — doesn't help with content-level rollback.
