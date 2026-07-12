# 09 — Vector Metadata & Filtering

**What to build:** Vectors include `owner_user_id` and `is_private` in metadata. Vectorize `metadataFilter` is used at query time to filter by ownership and visibility. `storeEntry` includes the new metadata fields. Duplicate detection scans current user's + all public memories.

**Blocked by:** Ticket 04

**Status:** ready-for-agent

---

## Files to modify

### `src/index.ts` — Vector metadata + query-time filtering

**Modify `storeEntry()` (line 1174-1218):**
- Already updated in ticket 04 to include `owner_user_id`
- Add `is_private: boolean` parameter
- Include in vector metadata (line 1186-1194):
  ```typescript
  is_private: is_private,
  ```
- Derive `is_private` from entry's tags: `tags.includes('"private"')`

**Modify `captureEntry()` (line 1993-2131):**
- After inserting entry, compute `is_private` from tags
- Pass to `storeEntry()`

**Modify `recallEntries()` (line 1727-1961):**
- Add `userId: string` parameter (may already exist from ticket 05)
- **Default Vectorize path (line 1793):** Use `metadataFilter` to exclude other users' private vectors:
  ```typescript
  metadataFilter: {
    OR: [
      { owner_user_id: { $eq: userId } },
      { is_private: { $eq: false } }
    ]
  }
  ```
- **Tag-scoped path (line 1771):** Apply same filter to `getByIds` results (Vectorize getByIds doesn't support metadataFilter, so post-filter)
- This replaces the post-retrieval filtering from ticket 05 for the Vectorize path (more performant)

**Modify `checkDuplicateAndContradiction()` (line 742-883):**
- Add `userId: string` parameter
- Apply `metadataFilter` to the Vectorize.query call (line 750):
  ```typescript
  metadataFilter: {
    OR: [
      { owner_user_id: { $eq: userId } },
      { is_private: { $eq: false } }
    ]
  }
  ```
- This ensures duplicate detection scans the correct scope

**Modify `neighborsFromVectorQuery()` (line 528-536):**
- Add `userId: string` parameter
- Apply metadataFilter to exclude unauthorized vectors

**Add re-indexing utility: `reindexAllVectors()`:**
- Finds all entries with `vector_ids != '[]'`
- For each entry: reads current vectors, deletes them, re-inserts with `owner_user_id` and `is_private` metadata
- Called from `POST /vectorize-pending` or as a standalone migration step
- Batches in groups of 20 (Vectorize limit)

**Modify `POST /vectorize-pending` handler (line 3283-3320):**
- Add mode: `?reindex=true` triggers full re-index with ownership metadata
- Default behavior (no flag) continues to vectorize un-vectorized entries

### `test/unit/cosine-sim.test.ts` — No changes expected
### `test/unit/vectorize-health.test.ts` — No changes expected

### New file: `test/integration/vector-metadata.test.ts`
- Test: New vectors include `owner_user_id` in metadata
- Test: New vectors include `is_private` in metadata
- Test: Vectorize query with metadataFilter excludes other users' private vectors
- Test: Duplicate detection scans user's entries + public entries only
- Test: Re-index adds ownership metadata to existing vectors

---

## Acceptance criteria

- [ ] New vectors include `owner_user_id` in metadata
- [ ] New vectors include `is_private` in metadata
- [ ] Vectorize `metadataFilter` used at query time for performance
- [ ] Recall excludes other users' private vectors at the database level
- [ ] Duplicate detection scans correct scope (user's + public)
- [ ] Re-index utility available for existing vectors
- [ ] `POST /vectorize-pending?reindex=true` triggers re-index
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
