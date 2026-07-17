import { describe, expect, it, vi } from "vitest";
import { classifyStrictContradiction } from "../../src/duplicates";
import {
  decideOperatorAction,
  NIGHTLY_CONTRADICTION_SYSTEM_ID,
} from "../../src/operator-policy";
import type { ServiceScope, SystemActorContext } from "../../src/types";

const left = {
  id: "entry-a",
  content: "Project Atlas launches on Friday.",
  ownerUserId: "user-a",
};
const right = {
  id: "entry-b",
  content: "Project Atlas launch was cancelled.",
  ownerUserId: "user-b",
};

function aiResponse(value: Record<string, unknown>) {
  return {
    AI: {
      run: vi.fn().mockResolvedValue({ response: JSON.stringify(value) }),
    } as unknown as Ai,
  };
}

describe("strict cross-user contradiction classifier", () => {
  it("short-circuits identical claims without consulting AI", async () => {
    const env = aiResponse({ relationship: "direct_contradiction" });
    const result = await classifyStrictContradiction(
      left,
      { ...right, content: "  PROJECT Atlas launches on Friday.  " },
      env,
    );

    expect(result).toEqual({ confirmed: false, outcome: "same_claim" });
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it.each(["compatible", "uncertain"] as const)(
    "treats a %s verdict as a no-op",
    async (relationship) => {
      const env = aiResponse({
        relationship,
        confidence: 0.99,
        reason: "Claims can coexist",
        left_quote: "",
        right_quote: "",
      });
      await expect(classifyStrictContradiction(left, right, env)).resolves.toEqual({
        confirmed: false,
        outcome: relationship,
      });
    },
  );

  it("confirms only a high-confidence verdict with exact evidence from both claims", async () => {
    const env = aiResponse({
      relationship: "direct_contradiction",
      confidence: 0.97,
      reason: "The scheduled launch was cancelled",
      left_quote: "launches on Friday",
      right_quote: "launch was cancelled",
    });

    await expect(classifyStrictContradiction(left, right, env)).resolves.toEqual({
      confirmed: true,
      confidence: 0.97,
      reason: "The scheduled launch was cancelled",
      leftQuote: "launches on Friday",
      rightQuote: "launch was cancelled",
    });
  });

  it.each([
    {
      relationship: "direct_contradiction",
      confidence: 0.89,
      reason: "Too uncertain",
      left_quote: "launches on Friday",
      right_quote: "launch was cancelled",
    },
    {
      relationship: "direct_contradiction",
      confidence: 0.99,
      reason: "Invented evidence",
      left_quote: "launches tomorrow",
      right_quote: "launch was cancelled",
    },
  ])("fails closed on weak or non-grounded model output", async (response) => {
    const env = aiResponse(response);
    await expect(classifyStrictContradiction(left, right, env)).resolves.toEqual({
      confirmed: false,
      outcome: "invalid_response",
    });
  });

  it("turns provider and JSON failures into a no-op", async () => {
    const providerFailure = {
      AI: { run: vi.fn().mockRejectedValue(new Error("provider unavailable")) } as unknown as Ai,
    };
    await expect(classifyStrictContradiction(left, right, providerFailure)).resolves.toEqual({
      confirmed: false,
      outcome: "provider_failure",
    });

    const malformed = {
      AI: { run: vi.fn().mockResolvedValue({ response: "not-json" }) } as unknown as Ai,
    };
    await expect(classifyStrictContradiction(left, right, malformed)).resolves.toEqual({
      confirmed: false,
      outcome: "invalid_response",
    });
  });
});

describe("nightly contradiction system policy", () => {
  const scopes: ServiceScope[] = [
    "proposal:create",
    "audit:write",
    "run:write",
    "memory:execute-approved",
    "proposal:execute-approved",
  ];
  const actor: SystemActorContext = {
    kind: "system",
    actorId: NIGHTLY_CONTRADICTION_SYSTEM_ID,
    systemId: NIGHTLY_CONTRADICTION_SYSTEM_ID,
    authMethod: "scheduled-worker",
    scopes: new Set(scopes),
  };

  it("may create only an edge proposal and can never review or execute it", () => {
    expect(decideOperatorAction({
      actor,
      operation: "proposal.create",
      proposedAction: "edge.publish",
    }).effect).toBe("allow");
    expect(decideOperatorAction({
      actor,
      operation: "proposal.create",
      proposedAction: "entry.update",
    }).effect).toBe("deny");
    expect(decideOperatorAction({ actor, operation: "proposal.approve" }).effect).toBe("deny");
    expect(decideOperatorAction({ actor, operation: "proposal.execute" }).effect).toBe("deny");
  });
});
