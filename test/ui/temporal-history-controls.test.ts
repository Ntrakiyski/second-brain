import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const indexHtml = readFileSync(resolve(process.cwd(), "public/index.html"), "utf8");

describe("temporal recall and history controls", () => {
  it("explains and sends separate valid-time and knowledge-time parameters", () => {
    expect(indexHtml).toContain('id="recall-as-of"');
    expect(indexHtml).toContain('id="recall-known-at"');
    expect(indexHtml).toContain("params.set('as_of', String(asOf))");
    expect(indexHtml).toContain("params.set('known_at', String(knownAt))");
    expect(indexHtml).toContain("World state asks what was true then. Known by asks what the team had learned by then.");
  });

  it("shows owner-only history and restores a selected snapshot as a new draft", () => {
    expect(indexHtml).toContain('id="view-btn-history"');
    expect(indexHtml).toContain("if (entry.id && entry.is_owned === true)");
    expect(indexHtml).toContain("/history`, { headers: authHeaders() }");
    expect(indexHtml).toContain("body: JSON.stringify({ entry_id: entryId, snapshot_id: btn.dataset.snapshotId })");
    expect(indexHtml).toContain("Restore as private draft");
  });
});
