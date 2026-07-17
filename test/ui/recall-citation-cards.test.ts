import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const indexHtml = readFileSync(resolve(process.cwd(), "public/index.html"), "utf8");

describe("recall citation cards", () => {
  it("preserves structured passages from recall and renders precise source metadata", () => {
    expect(indexHtml).toContain("passages: Array.isArray(m.passages) ? m.passages : []");
    expect(indexHtml).toContain('class="card-citations"');
    expect(indexHtml).toContain("passage.documentTitle");
    expect(indexHtml).toContain("passage.section ? `§ ${passage.section}`");
    expect(indexHtml).toContain("passage.page != null");
    expect(indexHtml).toContain("passage.startOffset != null && passage.endOffset != null");
  });

  it("only turns HTTP(S) source URLs into safe new-tab links", () => {
    expect(indexHtml).toContain("parsed.protocol === 'https:' || parsed.protocol === 'http:'");
    expect(indexHtml).toContain('target="_blank" rel="noopener noreferrer"');
  });
});
