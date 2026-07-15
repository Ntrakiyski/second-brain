/**
 * audit.ts — Agent audit logging for MCP tool invocations.
 *
 * Purpose: Log every MCP session and tool call to D1 for governance,
 *   debugging, and the morning digest. Two tables:
 *   - agent_runs: one row per MCP session (start → tools → end)
 *   - agent_events: one row per tool invocation within a run
 *
 * Input:   D1 database binding, run metadata, tool call details.
 * Output:  D1 rows in agent_runs / agent_events tables.
 * Logic:   Pure D1 inserts — no LLM calls, no Vectorize.
 */

import type { Env } from "./types";

// ─── Run lifecycle ────────────────────────────────────────────────────────────

export interface AgentRun {
  id: string;
  userId: string;
  startedAt: number;
  completedAt: number | null;
  toolCount: number;
}

/**
 * Start a new agent run. Returns the run ID for use in logToolCall/endRun.
 */
export async function startRun(env: Env, userId: string): Promise<string> {
  const runId = crypto.randomUUID();
  const now = Date.now();
  try {
    await (env.DB as any).prepare(
      `INSERT INTO agent_runs (id, user_id, started_at, completed_at, tool_count) VALUES (?, ?, ?, NULL, 0)`
    ).bind(runId, userId, now).run();
  } catch (e) {
    console.error("audit.startRun failed (non-fatal):", e);
  }
  return runId;
}

/**
 * Mark a run as complete. Increments tool_count and sets completed_at.
 */
export async function endRun(env: Env, runId: string, toolCount: number): Promise<void> {
  try {
    await (env.DB as any).prepare(
      `UPDATE agent_runs SET completed_at = ?, tool_count = ? WHERE id = ?`
    ).bind(Date.now(), toolCount, runId).run();
  } catch (e) {
    console.error("audit.endRun failed (non-fatal):", e);
  }
}

// ─── Tool call logging ────────────────────────────────────────────────────────

export interface ToolCallRecord {
  id: string;
  runId: string;
  toolName: string;
  inputSummary: string | null;
  outputSummary: string | null;
  durationMs: number | null;
  error: string | null;
  createdAt: number;
}

/**
 * Log a single tool call within a run. Input/output are truncated to 500 chars.
 */
export async function logToolCall(
  env: Env,
  runId: string,
  toolName: string,
  input: Record<string, unknown> | null,
  output: string | null,
  durationMs: number,
  error?: string,
): Promise<void> {
  const eventId = crypto.randomUUID();
  const now = Date.now();

  const inputSummary = input ? JSON.stringify(input).slice(0, 500) : null;
  const outputSummary = output ? output.slice(0, 500) : null;

  try {
    await (env.DB as any).prepare(
      `INSERT INTO agent_events (id, run_id, tool_name, input_summary, output_summary, duration_ms, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(eventId, runId, toolName, inputSummary, outputSummary, durationMs, error ?? null, now).run();
  } catch (e) {
    console.error("audit.logToolCall failed (non-fatal):", e);
  }
}

// ─── Query helpers (for morning digest) ───────────────────────────────────────

/**
 * Count tool calls in the last N hours, grouped by tool name.
 */
export async function getToolUsageStats(
  env: Env,
  lookbackMs: number,
): Promise<{ toolName: string; count: number; avgDurationMs: number; errorCount: number }[]> {
  const cutoff = Date.now() - lookbackMs;
  const { results } = await (env.DB as any).prepare(
    `SELECT tool_name, COUNT(*) as count,
            AVG(duration_ms) as avg_duration_ms,
            SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) as errorCount
     FROM agent_events WHERE created_at >= ?
     GROUP BY tool_name ORDER BY count DESC`
  ).bind(cutoff).all();
  return (results ?? []).map((r: any) => ({
    toolName: r.tool_name,
    count: r.count,
    avgDurationMs: r.avg_duration_ms,
    errorCount: r.errorCount,
  }));
}

/**
 * Count distinct users who made tool calls in the last N hours.
 */
export async function getActiveUserCount(env: Env, lookbackMs: number): Promise<number> {
  const cutoff = Date.now() - lookbackMs;
  const row = await (env.DB as any).prepare(
    `SELECT COUNT(DISTINCT user_id) as count FROM agent_runs WHERE started_at >= ?`
  ).bind(cutoff).first() as { count: number } | null;
  return row?.count ?? 0;
}

/**
 * Get the most recent N runs for a given user (or all users if userId is null).
 */
export async function getRecentRuns(
  env: Env,
  limit: number,
  userId?: string,
): Promise<AgentRun[]> {
  let sql = `SELECT id, user_id as userId, started_at as startedAt, completed_at as completedAt, tool_count as toolCount FROM agent_runs`;
  const bindings: any[] = [];
  if (userId) {
    sql += ` WHERE user_id = ?`;
    bindings.push(userId);
  }
  sql += ` ORDER BY started_at DESC LIMIT ?`;
  bindings.push(limit);

  const { results } = await (env.DB as any).prepare(sql).bind(...bindings).all();
  return (results ?? []) as AgentRun[];
}

/**
 * Get tool calls for a specific run.
 */
export async function getRunEvents(env: Env, runId: string): Promise<ToolCallRecord[]> {
  const { results } = await (env.DB as any).prepare(
    `SELECT id, run_id as runId, tool_name as toolName, input_summary as inputSummary, output_summary as outputSummary, duration_ms as durationMs, error, created_at as createdAt FROM agent_events WHERE run_id = ? ORDER BY created_at ASC`
  ).bind(runId).all();
  return (results ?? []) as ToolCallRecord[];
}

/**
 * Get total run count (for morning digest summary).
 */
export async function getTotalRunCount(env: Env, lookbackMs: number): Promise<number> {
  const cutoff = Date.now() - lookbackMs;
  const row = await (env.DB as any).prepare(
    `SELECT COUNT(*) as count FROM agent_runs WHERE started_at >= ?`
  ).bind(cutoff).first() as { count: number } | null;
  return row?.count ?? 0;
}
