import { describe, it, expect, beforeEach, vi } from "vitest";
import worker from "../../src/index";
import { makeTestEnv, makeTestDb, makeVectorizeMock } from "../helpers/make-env";
import { req } from "../helpers/make-request";
import type { Env } from "../../src/index";
import { D1Mock } from "../helpers/d1-mock";

const ctx = { waitUntil: (_: Promise<any>) => {} } as any;

describe("Document hierarchy (Ticket 08)", () => {
  let env: Env;
  let db: D1Mock;

  beforeEach(() => {
    db = makeTestDb();
    env = makeTestEnv(db);
  });

  it("GET /entries/:id/hierarchy returns null sections when no hierarchy exists", async () => {
    db.entries.push({
      id: "plain-entry", content: "Plain content", tags: "[]", source: "api",
      created_at: Date.now(), vector_ids: "[]", recall_count: 0, importance_score: 0,
      contradiction_wins: 0, contradiction_losses: 0, owner_user_id: "",
    });
    db.episodes = db.episodes || [];
    db.episodes.push({
      id: "ep-1", entry_id: "plain-entry", content: "Plain content", content_type: "text",
      source: "api", created_at: Date.now(),
    });

    const res = await worker.fetch(
      req("GET", "/entries/plain-entry/hierarchy"),
      env, ctx
    );
    const data = await res.json() as any;
    expect(data.ok).toBe(true);
    expect(data.sections).toEqual([]);
  });

  it("GET /entries/:id/hierarchy returns sections when document sections exist", async () => {
    const now = Date.now();
    db.entries.push({
      id: "research-entry", content: "# Research\n## Methods\n## Results", tags: "[]",
      source: "api", created_at: now, vector_ids: "[]", recall_count: 0, importance_score: 0,
      contradiction_wins: 0, contradiction_losses: 0, owner_user_id: "",
    });
    db.episodes = db.episodes || [];
    db.episodes.push({
      id: "ep-2", entry_id: "research-entry", content: "# Research\n## Methods\n## Results",
      content_type: "text", source: "api", created_at: now,
    });
    db.documents = db.documents || [];
    db.documents.push({
      id: "doc-1", title: "Research", source_url: null, content_type: "research", created_at: now,
    });
    db.document_sections = db.document_sections || [];
    db.document_sections.push(
      { id: "sec-1", document_id: "doc-1", parent_section_id: null, title: "Research", level: 1, order_index: 0, created_at: now },
      { id: "sec-2", document_id: "doc-1", parent_section_id: "sec-1", title: "Methods", level: 2, order_index: 1, created_at: now },
      { id: "sec-3", document_id: "doc-1", parent_section_id: "sec-1", title: "Results", level: 2, order_index: 2, created_at: now },
    );
    // Passages link entries to document sections by section name
    db.passages = db.passages || [];
    db.passages.push(
      { id: "p-1", entry_id: "research-entry", episode_id: "ep-2", content: "# Research", section: "Research", start_offset: 0, end_offset: 11, vector_ids: "[]", created_at: now },
      { id: "p-2", entry_id: "research-entry", episode_id: "ep-2", content: "## Methods", section: "Methods", start_offset: 13, end_offset: 23, vector_ids: "[]", created_at: now },
      { id: "p-3", entry_id: "research-entry", episode_id: "ep-2", content: "## Results", section: "Results", start_offset: 25, end_offset: 35, vector_ids: "[]", created_at: now },
    );

    const res = await worker.fetch(
      req("GET", "/entries/research-entry/hierarchy"),
      env, ctx
    );
    const data = await res.json() as any;
    expect(data.ok).toBe(true);
    expect(data.sections).toHaveLength(3);
  });

  it("GET /entries/:id/hierarchy returns 404 for non-existent entry", async () => {
    const res = await worker.fetch(
      req("GET", "/entries/nonexistent/hierarchy"),
      env, ctx
    );
    expect(res.status).toBe(404);
  });
});
