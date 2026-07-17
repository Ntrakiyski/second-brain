import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const indexHtml = readFileSync(resolve(process.cwd(), "public/index.html"), "utf8");

describe("owned-memory reinforcement control", () => {
  it("renders only for owned memories and sends exactly one non-retried request per click", () => {
    expect(indexHtml).toContain('id="view-btn-reinforce"');
    expect(indexHtml).toContain("if (entry.id && entry.is_owned === true)");
    expect(indexHtml).toContain("reinforceBtn.style.display = 'none'");
    expect(indexHtml).toContain("if (!entry || !entry.id || entry.is_owned !== true || btn.disabled) return");
    expect(indexHtml).toContain("/reinforce`, {");
    expect(indexHtml).toContain("One click intentionally sends one request. Do not auto-retry");
  });

  it("handles network and non-JSON failures without leaving the button disabled", () => {
    expect(indexHtml).toContain("try { data = await res.json() } catch {}");
    expect(indexHtml).toContain("error instanceof Error ? error.message : 'Reinforcement failed'");
    expect(indexHtml).toContain("finally {\n          btn.disabled = false");
  });
});
