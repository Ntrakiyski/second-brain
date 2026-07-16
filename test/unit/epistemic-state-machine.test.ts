import { describe, it, expect } from "vitest";
import { isValidTransition, VALID_EPISTEMIC_TRANSITIONS, EPISTEMIC_STATUS_VALUES } from "../../src/testing";

describe("Epistemic state machine (Ticket 10)", () => {
  describe("isValidTransition()", () => {
    it("allows candidate → reviewed", () => {
      expect(isValidTransition("candidate", "reviewed")).toBe(true);
    });

    it("allows reviewed → canonical", () => {
      expect(isValidTransition("reviewed", "canonical")).toBe(true);
    });

    it("allows canonical → qualified", () => {
      expect(isValidTransition("canonical", "qualified")).toBe(true);
    });

    it("allows qualified → superseded", () => {
      expect(isValidTransition("qualified", "superseded")).toBe(true);
    });

    it("allows superseded → retracted", () => {
      expect(isValidTransition("superseded", "retracted")).toBe(true);
    });

    it("rejects candidate → canonical (skip reviewed)", () => {
      expect(isValidTransition("candidate", "canonical")).toBe(false);
    });

    it("rejects retracted → any (terminal state)", () => {
      expect(isValidTransition("retracted", "candidate")).toBe(false);
      expect(isValidTransition("retracted", "reviewed")).toBe(false);
      expect(isValidTransition("retracted", "canonical")).toBe(false);
    });

    it("rejects stale → any (stale is not a valid source state)", () => {
      expect(isValidTransition("stale", "canonical")).toBe(false);
    });

    it("rejects canonical → retracted (not in transition table)", () => {
      expect(isValidTransition("canonical", "retracted")).toBe(false);
    });

    it("allows stale → reviewed (recovery path)", () => {
      expect(isValidTransition("stale", "reviewed")).toBe(true);
    });

    it("allows stale → retracted (give up path)", () => {
      expect(isValidTransition("stale", "retracted")).toBe(true);
    });
  });

  describe("VALID_EPISTEMIC_TRANSITIONS", () => {
    it("defines transitions for all valid statuses", () => {
      for (const status of EPISTEMIC_STATUS_VALUES) {
        if (status === "stale") continue; // stale is a target-only state
        expect(VALID_EPISTEMIC_TRANSITIONS[status]).toBeDefined();
        expect(Array.isArray(VALID_EPISTEMIC_TRANSITIONS[status])).toBe(true);
      }
    });

    it("has retracted as a terminal state (no outgoing transitions)", () => {
      expect(VALID_EPISTEMIC_TRANSITIONS.retracted).toEqual([]);
    });
  });
});
