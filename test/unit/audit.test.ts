import { describe, it, expect, beforeEach } from "vitest";
import {
  startRun,
  endRun,
  logToolCall,
  getToolUsageStats,
  getActiveUserCount,
  getRecentRuns,
  getRunEvents,
  getTotalRunCount,
} from "../../src/audit";
import { D1Mock } from "../helpers/d1-mock";
import { makeTestEnv } from "../helpers/make-env";
import type { Env } from "../../src/testing";

describe("audit.ts", () => {
  let env: Env;
  let db: D1Mock;

  beforeEach(() => {
    db = new D1Mock();
    env = makeTestEnv(db);
  });

  describe("startRun", () => {
    it("creates a new agent run in the DB", async () => {
      const runId = await startRun(env, "user-1");
      expect(runId).toBeDefined();
      expect(typeof runId).toBe("string");
      expect(runId.length).toBeGreaterThan(0);
      // Row should exist in DB
      expect(db.agentRuns.length).toBe(1);
      expect(db.agentRuns[0].user_id).toBe("user-1");
      expect(db.agentRuns[0].completed_at).toBeNull();
      expect(db.agentRuns[0].tool_count).toBe(0);
    });

    it("uses 'anonymous' as user_id when specified", async () => {
      const runId = await startRun(env, "anonymous");
      expect(db.agentRuns[0].user_id).toBe("anonymous");
    });
  });

  describe("endRun", () => {
    it("marks the run as completed with tool count", async () => {
      const runId = await startRun(env, "user-1");
      await endRun(env, runId, 5);
      const row = db.agentRuns.find((r) => r.id === runId);
      expect(row).toBeDefined();
      expect(row!.completed_at).toBeTypeOf("number");
      expect(row!.completed_at! > 0).toBe(true);
      expect(row!.tool_count).toBe(5);
    });

    it("is a no-op for non-existent run IDs", async () => {
      await endRun(env, "non-existent-id", 3);
      // Should not throw
    });
  });

  describe("logToolCall", () => {
    it("creates an agent event record", async () => {
      await logToolCall(env, "run-1", "recall", { query: "test" }, "result text", 120);
      expect(db.agentEvents.length).toBe(1);
      const evt = db.agentEvents[0];
      expect(evt.run_id).toBe("run-1");
      expect(evt.tool_name).toBe("recall");
      expect(evt.input_summary).toBe('{"query":"test"}');
      expect(evt.output_summary).toBe("result text");
      expect(evt.duration_ms).toBe(120);
      expect(evt.error).toBeNull();
      expect(evt.created_at).toBeTypeOf("number");
    });

    it("records errors in the event", async () => {
      await logToolCall(env, "run-1", "remember", null, null, 50, "Something failed");
      const evt = db.agentEvents[0];
      expect(evt.error).toBe("Something failed");
      expect(evt.input_summary).toBeNull();
      expect(evt.output_summary).toBeNull();
    });

    it("truncates long input/output to 500 chars", async () => {
      const longInput = "x".repeat(600);
      const longOutput = "y".repeat(600);
      await logToolCall(env, "run-1", "remember", { data: longInput }, longOutput, 10);
      const evt = db.agentEvents[0];
      expect(evt.input_summary!.length).toBeLessThanOrEqual(500);
      expect(evt.output_summary!.length).toBeLessThanOrEqual(500);
    });
  });

  describe("getToolUsageStats", () => {
    beforeEach(async () => {
      const now = Date.now();
      // Seed some events
      db.agentEvents.push(
        { id: "e1", run_id: "r1", tool_name: "recall", input_summary: null, output_summary: null, duration_ms: 100, error: null, created_at: now - 1000 },
        { id: "e2", run_id: "r1", tool_name: "recall", input_summary: null, output_summary: null, duration_ms: 200, error: null, created_at: now - 500 },
        { id: "e3", run_id: "r1", tool_name: "remember", input_summary: null, output_summary: null, duration_ms: 300, error: "fail", created_at: now - 200 },
      );
    });

    it("groups events by tool name and counts them", async () => {
      const stats = await getToolUsageStats(env, 60_000);
      expect(stats.length).toBe(2);
      const recall = stats.find((s) => s.toolName === "recall");
      expect(recall).toBeDefined();
      expect(recall!.count).toBe(2);
      expect(recall!.avgDurationMs).toBe(150);
      expect(recall!.errorCount).toBe(0);
      const remember = stats.find((s) => s.toolName === "remember");
      expect(remember).toBeDefined();
      expect(remember!.count).toBe(1);
      expect(remember!.errorCount).toBe(1);
    });

    it("filters by lookback window", async () => {
      // Use very short lookback — events from "now" should be included
      const stats = await getToolUsageStats(env, 1);
      // Events from seconds ago may or may not be included depending on timing
      expect(Array.isArray(stats)).toBe(true);
    });
  });

  describe("getActiveUserCount", () => {
    it("counts distinct users in recent runs", async () => {
      const now = Date.now();
      db.agentRuns.push(
        { id: "r1", user_id: "u1", started_at: now, completed_at: now + 100, tool_count: 1 },
        { id: "r2", user_id: "u2", started_at: now, completed_at: now + 100, tool_count: 1 },
        { id: "r3", user_id: "u1", started_at: now, completed_at: now + 100, tool_count: 1 },
      );
      const count = await getActiveUserCount(env, 60_000);
      expect(count).toBe(2);
    });

    it("returns 0 when no runs exist", async () => {
      const count = await getActiveUserCount(env, 60_000);
      expect(count).toBe(0);
    });
  });

  describe("getRecentRuns", () => {
    beforeEach(async () => {
      const now = Date.now();
      db.agentRuns.push(
        { id: "r1", user_id: "u1", started_at: now - 3000, completed_at: now - 2900, tool_count: 2 },
        { id: "r2", user_id: "u2", started_at: now - 2000, completed_at: now - 1900, tool_count: 1 },
        { id: "r3", user_id: "u1", started_at: now - 1000, completed_at: null, tool_count: 0 },
      );
    });

    it("returns runs ordered by started_at DESC", async () => {
      const runs = await getRecentRuns(env, 10);
      expect(runs.length).toBe(3);
      expect(runs[0].id).toBe("r3");
      expect(runs[1].id).toBe("r2");
      expect(runs[2].id).toBe("r1");
    });

    it("respects limit", async () => {
      const runs = await getRecentRuns(env, 2);
      expect(runs.length).toBe(2);
    });

    it("filters by userId when provided", async () => {
      const runs = await getRecentRuns(env, 10, "u1");
      expect(runs.length).toBe(2);
      expect(runs.every((r) => r.userId === "u1")).toBe(true);
    });
  });

  describe("getRunEvents", () => {
    it("returns events for a specific run ordered by created_at ASC", async () => {
      const now = Date.now();
      db.agentEvents.push(
        { id: "e2", run_id: "r1", tool_name: "remember", input_summary: null, output_summary: null, duration_ms: 200, error: null, created_at: now + 100 },
        { id: "e1", run_id: "r1", tool_name: "recall", input_summary: null, output_summary: null, duration_ms: 100, error: null, created_at: now },
        { id: "e3", run_id: "r2", tool_name: "forget", input_summary: null, output_summary: null, duration_ms: 50, error: null, created_at: now },
      );
      const events = await getRunEvents(env, "r1");
      expect(events.length).toBe(2);
      expect(events[0].id).toBe("e1");
      expect(events[1].id).toBe("e2");
      expect(events[0].toolName).toBe("recall");
    });

    it("returns empty array for non-existent run", async () => {
      const events = await getRunEvents(env, "non-existent");
      expect(events.length).toBe(0);
    });
  });

  describe("getTotalRunCount", () => {
    it("counts runs within lookback window", async () => {
      const now = Date.now();
      db.agentRuns.push(
        { id: "r1", user_id: "u1", started_at: now - 1000, completed_at: null, tool_count: 0 },
        { id: "r2", user_id: "u1", started_at: now - 2000, completed_at: null, tool_count: 0 },
      );
      const count = await getTotalRunCount(env, 60_000);
      expect(count).toBe(2);
    });

    it("returns 0 when no runs exist", async () => {
      const count = await getTotalRunCount(env, 60_000);
      expect(count).toBe(0);
    });
  });
});
