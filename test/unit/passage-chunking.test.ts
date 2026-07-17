import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPassagesForEntry } from "../../src/testing";
import { makeTestEnv, makeTestDb, makeVectorizeMock } from "../helpers/make-env";
import type { Env } from "../../src/testing";
import { D1Mock } from "../helpers/d1-mock";

const ctx = { waitUntil: (_: Promise<any>) => {} } as any;

describe("createPassagesForEntry chunking (Ticket 07)", () => {
  let env: Env;
  let db: D1Mock;

  beforeEach(() => {
    db = makeTestDb();
    env = makeTestEnv(db);
  });

  it("splits plain text into overlapping chunks", async () => {
    const content = "A".repeat(3000); // 3000 chars → 2 chunks (1500 + 1500 with overlap)
    await createPassagesForEntry("entry-1", "ep-1", content, env, ctx);

    const passages = db.passages.filter((p: any) => p.entry_id === "entry-1");
    expect(passages.length).toBeGreaterThanOrEqual(2);
    // Each chunk should have section = null (no markdown headers)
    for (const p of passages) {
      expect(p.section).toBeNull();
    }
    // First chunk starts at 0
    expect(passages[0].start_offset).toBe(0);
    // Content should be contiguous (with overlap)
    expect(passages[0].content.length).toBeLessThanOrEqual(1500);
  });

  it("creates section-aware chunks for markdown content", async () => {
    const content = [
      "# Introduction\n\nThis is the introduction with enough text to fill a chunk. " + "X".repeat(1400),
      "\n\n## Methods\n\nThe methods section describes the approach. " + "Y".repeat(1400),
      "\n\n## Results\n\nThe results show significant findings. " + "Z".repeat(1400),
    ].join("\n");

    await createPassagesForEntry("entry-2", "ep-2", content, env, ctx);

    const passages = db.passages.filter((p: any) => p.entry_id === "entry-2");
    expect(passages.length).toBeGreaterThanOrEqual(3);

    // Passages should have section names from headers
    const sections = passages.map((p: any) => p.section);
    expect(sections).toContain("Introduction");
    expect(sections).toContain("Methods");
    expect(sections).toContain("Results");
  });

  it("creates document hierarchy when content has headers", async () => {
    const content = "# Title\n\nContent here.\n\n## Sub\n\nMore content.";
    await createPassagesForEntry("entry-3", "ep-3", content, env, ctx);

    // Documents and document_sections should be created
    expect(db.documents.length).toBe(1);
    expect(db.documents[0].title).toBe("Title");

    expect(db.document_sections.length).toBe(2);
    const titles = db.document_sections.map((s: any) => s.title);
    expect(titles).toContain("Title");
    expect(titles).toContain("Sub");
  });

  it("handles empty content gracefully", async () => {
    await createPassagesForEntry("entry-4", "ep-4", "", env, ctx);
    const passages = db.passages.filter((p: any) => p.entry_id === "entry-4");
    expect(passages).toHaveLength(0);
  });

  it("creates one document envelope for content without headers", async () => {
    await createPassagesForEntry("entry-5", "ep-5", "Just plain text with no headers.", env, ctx);
    expect(db.documents.length).toBe(1);
    expect(db.documents[0]).toMatchObject({
      episode_id: "ep-5",
      content_type: "text",
      title: "Untitled Memory",
    });
    expect(db.document_sections.length).toBe(0);
  });
});
