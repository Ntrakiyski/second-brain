import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const indexHtml = readFileSync(resolve(process.cwd(), "public/index.html"), "utf8");

describe("web recall citation context", () => {
  it("serializes passage provenance into the context sent to chat", () => {
    expect(indexHtml).toContain("m.passages.map(formatRecallPassageForContext)");
    for (const field of [
      "documentTitle",
      "sourceUrl",
      "page=",
      "pageEnd=",
      "section=",
      "startOffset=",
      "endOffset=",
    ]) {
      expect(indexHtml).toContain(field);
    }
  });
});
