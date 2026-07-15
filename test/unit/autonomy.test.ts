import { describe, it, expect } from "vitest";
import {
  checkToolAutonomy,
  getToolLevel,
  getAutonomyMap,
  getAutonomyStats,
} from "../../src/autonomy";
import { TOOL_AUTONOMY } from "../../src/config";

describe("autonomy.ts", () => {
  describe("checkToolAutonomy", () => {
    it("returns allowed=true for automatic tools", () => {
      const result = checkToolAutonomy("recall");
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain("recall");
      expect(result.reason).toContain("automatic");
    });

    it("returns allowed=false with level=gated for gated tools", () => {
      const result = checkToolAutonomy("remember");
      expect(result.allowed).toBe(false);
      expect("level" in result && result.level).toBe("gated");
      expect(result.reason).toContain("requires human approval");
    });

    it("returns allowed=false with level=never for destructive tools", () => {
      const result = checkToolAutonomy("forget");
      expect(result.allowed).toBe(false);
      expect("level" in result && result.level).toBe("never");
      expect(result.reason).toContain("not permitted");
    });

    it("defaults to gated for unknown tools", () => {
      const result = checkToolAutonomy("unknown-tool");
      expect(result.allowed).toBe(false);
      expect("level" in result && result.level).toBe("gated");
    });

    it("handles hyphenated tool names", () => {
      const listProposals = checkToolAutonomy("list-proposals");
      expect(listProposals.allowed).toBe(true);

      const approveProposal = checkToolAutonomy("approve-proposal");
      expect(approveProposal.allowed).toBe(false);
    });
  });

  describe("getToolLevel", () => {
    it("returns the correct level for known tools", () => {
      expect(getToolLevel("recall")).toBe("automatic");
      expect(getToolLevel("remember")).toBe("gated");
      expect(getToolLevel("forget")).toBe("never");
    });

    it("returns gated for unknown tools", () => {
      expect(getToolLevel("nonexistent")).toBe("gated");
    });
  });

  describe("getAutonomyMap", () => {
    it("returns a copy of TOOL_AUTONOMY", () => {
      const map = getAutonomyMap();
      expect(map).toEqual(TOOL_AUTONOMY);
      // Verify it's a copy, not a reference
      map["new-tool"] = "automatic";
      expect((TOOL_AUTONOMY as any)["new-tool"]).toBeUndefined();
    });

    it("includes all expected tools", () => {
      const map = getAutonomyMap();
      expect(Object.keys(map).length).toBeGreaterThanOrEqual(17);
      expect(map["recall"]).toBe("automatic");
      expect(map["forget"]).toBe("never");
    });
  });

  describe("getAutonomyStats", () => {
    it("counts tools by level", () => {
      const stats = getAutonomyStats();
      expect(stats.automatic).toBeGreaterThan(0);
      expect(stats.gated).toBeGreaterThan(0);
      expect(stats.never).toBeGreaterThan(0);
      expect(stats.automatic + stats.gated + stats.never).toBe(Object.keys(TOOL_AUTONOMY).length);
    });
  });
});
