/**
 * Integration mirror store.
 *
 * Purpose: Provides the narrow write surface integration syncs use to mirror
 * external items into the memory store. Mirrors bypass captureEntry's
 * duplicate/contradiction pipeline — the external tool is the source of truth.
 *
 * Input: An Env binding and integration framework utilities (MirrorStore,
 * provider registry, KV persistence).
 *
 * Output: A MirrorStore implementation (create/update/delete entry), helper
 * predicates for the edit guard, and a bounded nightly sync runner.
 *
 * Logic: makeMirrorStore builds a MirrorStore whose createEntry inserts an
 * entry + vectorises, updateEntry replaces content + re-embeds + cleans stale
 * vectors, and deleteEntry delegates to forgetEntry. isManagedMirror checks
 * whether an entry's source is a connected integration. runScheduledIntegrationSync
 * loops bounded batches per active provider so a backlog converges across cron
 * runs without exhausting the subrequest budget.
 */

import type { Env } from "./types";
import { storeEntry, stageEntryVectors, deleteStaleVectors } from "./ingest";
import { forgetEntry } from "./lifecycle";
import { initializeDatabase } from "./db";
import { CRON_SYNC_MAX_BATCHES } from "./config";
import {
  type MirrorStore,
  getProvider,
  loadIntegration,
  saveIntegration,
  deleteIntegration,
  integrationStatus,
  type IntegrationRecord,
  INTEGRATION_PROVIDERS,
} from "./integrations/index";

// ─── Integration mirror store ─────────────────────────────────────────────────
// The narrow write surface integration syncs use to mirror external items into
// the memory store (see src/integrations/framework.ts). Mirrors bypass
// captureEntry's duplicate/contradiction pipeline on purpose: the external tool
// is the source of truth for its own items, dedupe is by item id (the KV
// itemMap), and every sync replaces content wholesale.

function makeMirrorStore(env: Env): MirrorStore {
  return {
    async createEntry(content, tags, source) {
      const id = crypto.randomUUID();
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO entries (id, content, tags, source, created_at, vector_ids) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(id, content, JSON.stringify(tags), source, now, "[]").run();
      // Embed failure is non-fatal — the entry keeps vector_ids=[] and the
      // vectorize-pending backstop re-embeds it later.
      try {
        await storeEntry(env, id, content, tags, source, now, undefined, tags.includes("private"));
      } catch (e) {
        console.error("Vectorize insert failed (non-fatal):", e);
      }
      return id;
    },
    async updateEntry(id, content) {
      const row = await env.DB.prepare(
        `SELECT tags, source, vector_ids, owner_user_id FROM entries WHERE id = ?`
      ).bind(id).first() as Record<string, any> | null;
      if (!row) return false;

      const tags: string[] = JSON.parse(row.tags ?? "[]");
      const oldVectorIds: string[] = JSON.parse(row.vector_ids ?? "[]");

      // Stage vectors first; a failed external write leaves D1 and the prior
      // search representation untouched and causes the sync item to retry.
      const newVectorIds = await stageEntryVectors(
        env, id, content, tags, row.source as string, Date.now(),
        (row.owner_user_id as string) || undefined, tags.includes("private"),
      );
      await env.DB.prepare(`UPDATE entries SET content = ?, vector_ids = ? WHERE id = ?`)
        .bind(content, JSON.stringify(newVectorIds), id).run();
      try {
        await deleteStaleVectors(env, oldVectorIds, newVectorIds);
      } catch (e) {
        console.error("Old vector cleanup failed (non-fatal):", e);
      }
      return true;
    },
    async deleteEntry(id) {
      await forgetEntry(id, env);
    },
  };
}

// Mirrored entries are replaced wholesale on every sync, so a manual
// append/update would be silently clobbered by the item's next upstream edit.
// While the integration is connected, redirect edits to the source tool. After
// disconnect, mirrors become ordinary editable memories. Provider ids double
// as entry `source` values, so the registry is the lookup.
async function isManagedMirror(source: string, env: Env): Promise<boolean> {
  return getProvider(source) !== null && (await loadIntegration(env, source)) !== null;
}

function mirrorEditError(source: string): string {
  const name = getProvider(source)?.name ?? source;
  return `This memory is synced from ${name}. Edit it in ${name} (the change syncs automatically), or disconnect the ${name} integration to make it editable.`;
}

// Nightly sync: loop bounded batches per provider so a backlog converges
// across runs without betting the invocation's subrequest budget on one pass.

async function runScheduledIntegrationSync(env: Env): Promise<void> {
  let initialized = false;
  for (const provider of Object.values(INTEGRATION_PROVIDERS)) {
    if (!(await loadIntegration(env, provider.id))) continue;
    if (!initialized) {
      await initializeDatabase(env);
      initialized = true;
    }
    const store = makeMirrorStore(env);
    for (let i = 0; i < CRON_SYNC_MAX_BATCHES; i++) {
      const result = await provider.sync(env, store);
      if (!result.ok || result.remaining === 0) break;
    }
  }
}

export { makeMirrorStore, isManagedMirror, mirrorEditError, runScheduledIntegrationSync };
