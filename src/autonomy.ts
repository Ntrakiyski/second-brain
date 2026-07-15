/**
 * autonomy.ts — Per-tool governance for MCP agent actions.
 *
 * Purpose: Enforce autonomy levels on every MCP tool call. Three levels:
 *   - "automatic": tool executes without human approval (read-only tools)
 *   - "gated": tool requires pending human approval before execution (write tools)
 *   - "never": tool is always blocked for autonomous agents (destructive tools)
 *
 * Input:   Tool name, autonomy configuration (default or per-user override).
 * Output:  Gate decision: "allow" | "deny" | "pending" with reason.
 * Logic:   Lookup tool in TOOL_AUTONOMY map, return the gate decision.
 */

import type { Env } from "./types";
import { TOOL_AUTONOMY, type AutonomyLevel } from "./config";

// ─── Gate result types ────────────────────────────────────────────────────────

export type GateResult =
  | { allowed: true; reason: string }
  | { allowed: false; reason: string; level: AutonomyLevel };

// ─── Core gate function ──────────────────────────────────────────────────────

/**
 * Check whether a tool call is allowed under the current autonomy policy.
 * Returns a GateResult indicating whether the call should proceed.
 */
export function checkToolAutonomy(toolName: string): GateResult {
  const level = TOOL_AUTONOMY[toolName] ?? "gated";

  switch (level) {
    case "automatic":
      return { allowed: true, reason: `Tool "${toolName}" is automatic — no approval needed.` };
    case "gated":
      return { allowed: false, reason: `Tool "${toolName}" requires human approval. Create a proposal and wait for approval.`, level };
    case "never":
      return { allowed: false, reason: `Tool "${toolName}" is not permitted for autonomous agents. This action requires direct human execution.`, level };
  }
}

/**
 * Get the autonomy level for a specific tool.
 */
export function getToolLevel(toolName: string): AutonomyLevel {
  return TOOL_AUTONOMY[toolName] ?? "gated";
}

/**
 * Get the full autonomy map (for display in morning digest or governance UI).
 */
export function getAutonomyMap(): Record<string, AutonomyLevel> {
  return { ...TOOL_AUTONOMY };
}

/**
 * Count tools by autonomy level (for summary stats).
 */
export function getAutonomyStats(): { automatic: number; gated: number; never: number } {
  const levels = Object.values(TOOL_AUTONOMY);
  return {
    automatic: levels.filter(l => l === "automatic").length,
    gated: levels.filter(l => l === "gated").length,
    never: levels.filter(l => l === "never").length,
  };
}
