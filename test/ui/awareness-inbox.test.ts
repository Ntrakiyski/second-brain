import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const indexHtml = readFileSync(resolve(process.cwd(), "public/index.html"), "utf8");

describe("team overlap awareness inbox", () => {
  it("loads only unread recipient-scoped events and renders both endpoints safely", () => {
    expect(indexHtml).toContain('id="awareness-section"');
    expect(indexHtml).toContain("/awareness-events?unread=true&limit=20");
    expect(indexHtml).toContain("Both owners receive this notice");
    expect(indexHtml).toContain("endpoints.map((endpoint)");
    expect(indexHtml).toContain("escHtml(endpoint.ownerUsername || 'team member')");
    expect(indexHtml).toContain("escHtml(String(endpoint.content || '').slice(0, 120))");
  });

  it("uses the recipient-only mark-read endpoint and opens a reauthorized memory", () => {
    expect(indexHtml).toContain("async function markAwarenessEventReadRequest(eventId)");
    expect(indexHtml).toContain("/awareness-events/${encodeURIComponent(eventId)}/read");
    expect(indexHtml).toContain("method: 'POST'");
    expect(indexHtml).toContain("await openNodeView({ id: endpoint.entryId, label: endpoint.content, tags: [] })");
  });

  it("keeps the inline application script syntactically valid", () => {
    const scripts = [...indexHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
      .map((match) => match[1])
      .filter((source) => source.trim());
    for (const source of scripts) expect(() => new Function(source)).not.toThrow();
  });
});
