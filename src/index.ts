/**
 * index.ts — Re-export hub + OAuthProvider wiring + default export.
 *
 * Purpose: Central entry point for the Cloudflare Worker. Re-exports all public
 *          symbols from domain modules so existing test imports continue to resolve.
 *          Wires apiHandler and defaultHandler through OAuthProvider.
 * Input:   Incoming HTTP requests (fetch) and cron triggers (scheduled).
 * Output:  OAuthProvider-wrapped fetch handler, nightly cron handler, and all
 *          public re-exports from config, types, helpers, tags, auth, db, graph,
 *          classification, duplicates, ingest, lifecycle, recall, mcp, routes,
 *          integrations-mirror, and api-handler.
 * Logic:   OAuthProvider gates /mcp behind OAuth. resolveExternalToken accepts
 *          the static AUTH_TOKEN. scheduled runs compression, graph pass, and
 *          integration sync in parallel via waitUntil.
 */

import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import type { Env } from "./types";
import { apiHandler } from "./api-handler";
import { defaultHandler } from "./routes";
import { runNightlyCompression, runGraphPass, detectCrossUserContradictions } from "./lifecycle";
import { runScheduledIntegrationSync } from "./integrations-mirror";

// ─── Re-exports ───────────────────────────────────────────────────────────────
// All public symbols from domain modules. Tests import from "../../src/index".

export type { Env, RecallMatch, CaptureResult } from "./types";
export { MemoryKind, MemoryStatus, KIND_VALUES, MEMORY_KIND_VALUES, STATUS_VALUES, STATUS_PREFIX, KIND_PREFIX, EPISTEMIC_STATUS_VALUES, isValidTransition, VALID_EPISTEMIC_TRANSITIONS } from "./types";
export type { Episode, EntrySnapshot, Passage, Document, DocumentSection, EpistemicStatus } from "./types";

export {
  CORS_HEADERS,
  COMPRESSION_MIN_AGE_MS,
  EDGE_INFER_THRESHOLD,
  EDGE_INFER_MAX,
  DIGEST_MAX_TOKENS,
  EMBEDDING_MODEL,
  VECTORIZE_GET_BY_IDS_BATCH,
  GRAPH_HOP_DECAY,
  GRAPH_MAX_HOPS,
  VECTORIZE_TOP_K_MULTIPLIER,
  KEYWORD_CANDIDATE_LIMIT,
  RRF_K,
  INSIGHT_MAX_TOKENS,
  PATTERN_MAX_TOKENS,
  TAG_BOOST_MAX,
  CONTRADICTION_IMPORTANCE_STEP,
  VECTORIZE_FIX_HINT,
  SMART_MERGE_MAX_TOKENS,
  DUPLICATE_FLAG_THRESHOLD,
  DUPLICATE_BLOCK_THRESHOLD,
  CANDIDATE_SCORE_THRESHOLD,
  CONTRADICTION_MAX_TOKENS,
  CLASSIFY_MAX_TOKENS,
  LLM_MODEL,
  CHUNK_MAX_CHARS,
  D1_MAX_BOUND_PARAMS,
  TAG_BOOST_STEP,
  COMPRESSION_IMPORTANCE_THRESHOLD,
  COMPRESSION_MIN_RECALL,
  compressionEligibilitySql,
  RETENTION_HALF_LIFE_DAYS,
  STALENESS_THRESHOLD_DAYS,
  STALENESS_CONFIDENCE_THRESHOLD,
  STALENESS_RECALL_PENALTY,
} from "./config";

export {
  escapeLikePattern,
  readStreamText,
  embed,
  chunkText,
  getHalfLifeMs,
  cosineSim,
  tokenizeQuery,
  getRetentionScore,
} from "./helpers";

export {
  getStatus,
  withStatus,
  getKind,
  withKind,
  buildVisibilityClause,
  buildEntryFilterQuery,
} from "./tags";

export {
  hmacKey,
  generateApiKey,
  requireAuthAsync,
  resolveUser,
} from "./auth";

export {
  initializeDatabase,
  _resetDbReady,
  checkVectorizeHealth,
  VECTORIZE_INDEX_NAME,
  VectorizeHealth,
  getSystemUserId,
  getDbReady,
  setDbReady,
} from "./db";

export {
  EDGE_TYPES,
  PROVENANCE_VALUES,
  isValidEdgeType,
  isSymmetric,
  edgeLabel,
  allowedKindsFor,
  createEdge,
  deleteEdge,
  expandGraph,
  inferEdgesOnWrite,
  GraphNeighbor,
  Connection,
  getConnections,
  GraphNode,
  GraphView,
  buildGraph,
  neighborsFromVectorQuery,
  filterVisibleIds,
} from "./graph";

export {
  classifyEntry,
  extractHashtags,
  inferQueryTags,
} from "./classification";

export {
  MergeAction,
  getDuplicateCheckSample,
  checkDuplicateAndContradiction,
} from "./duplicates";

export {
  reindexAllVectors,
  captureEntry,
  createPassagesForEntry,
  createSnapshot,
} from "./ingest";

export {
  ForgetResult,
  forgetEntry,
  deprecateEntry,
  applyStatus,
  synthesizeDigest,
  compressTag,
  synthesizeInsight,
  derivePattern,
} from "./lifecycle";

export {
  VectorizeMatch,
  RecallSearchResult,
  rerankWithTimeDecay,
  parseTimePhrase,
  renderRecallText,
  rrfFuse,
  recallEntries,
} from "./recall";

export {
  buildMcpServer,
  isMcpToolsListRequest,
  removeToolExecutionMetadata,
  sanitizeToolsListResponse,
} from "./mcp";

export { apiHandler } from "./api-handler";
export { defaultHandler } from "./routes";
  export { runNightlyCompression, runGraphPass, detectStaleness, detectCrossUserContradictions } from "./lifecycle";
export { runScheduledIntegrationSync } from "./integrations-mirror";

export {
  startRun, endRun, logToolCall,
  getToolUsageStats, getActiveUserCount, getRecentRuns, getRunEvents, getTotalRunCount,
} from "./audit";
export type { AgentRun, ToolCallRecord } from "./audit";

export {
  checkToolAutonomy, getToolLevel, getAutonomyMap, getAutonomyStats,
} from "./autonomy";
export type { GateResult } from "./autonomy";

export { TOOL_AUTONOMY } from "./config";
export type { AutonomyLevel } from "./config";

// Also export the integration framework symbols that tests may import
export {
  INTEGRATION_PROVIDERS,
  getProvider,
  loadIntegration,
  saveIntegration,
  deleteIntegration,
  integrationStatus,
} from "./integrations";
export type { IntegrationRecord, MirrorStore } from "./integrations";

// ─── OAuthProvider wiring ─────────────────────────────────────────────────────
// Wrap both handlers in OAuthProvider. It auto-serves the OAuth metadata,
// /oauth/token, and /oauth/register (RFC 7591) endpoints, and gates /mcp.
// The scheduled handler runs the nightly compression cron alongside the fetch handler.

const oauthProvider = new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: apiHandler as any,
  defaultHandler: defaultHandler as any,
  authorizeEndpoint: "/oauth/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  // Accept the static AUTH_TOKEN for Claude Desktop + mcp-remote (no browser flow).
  resolveExternalToken: async ({ token, env }) => {
    if (token === (env as Env).AUTH_TOKEN) {
      return { props: { userId: "owner" } };
    }
    return null;
  },
});

export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) =>
    oauthProvider.fetch(req, env as any, ctx),
  scheduled: async (_event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(runNightlyCompression(env, ctx));
    ctx.waitUntil(runGraphPass(env, ctx));
    ctx.waitUntil(detectCrossUserContradictions(env).catch(e => console.error("detectCrossUserContradictions failed (non-fatal):", e)));
    ctx.waitUntil(runScheduledIntegrationSync(env));
  },
};
