// ─── OAuth API handler — /mcp only ──────────────────────────────────────────
// Purpose: Handles MCP protocol requests under the OAuthProvider, resolving
//          per-user identity and delegating to the MCP server.
// Input:   Request, Env, ExecutionContext from Cloudflare Workers runtime.
// Output:  Response — either the raw MCP response or a sanitized tools-list.
// Logic:   1. Lazy-initialize the database on first request.
//          2. Resolve user identity from X-Second-Brain-User/User-Key headers.
//          3. Build an MCP server scoped to that user.
//          4. Forward the request through createMcpHandler; if the client only
//             asked for the tool list, strip execution metadata from the response.

import { type Env } from "./types";
import { initializeDatabase, getDbReady, setDbReady } from "./db";
import { resolveUser } from "./auth";
import { buildMcpServer, isMcpToolsListRequest, sanitizeToolsListResponse } from "./mcp";
import { createMcpHandler } from "agents/mcp";

const apiHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (!getDbReady()) {
      ctx.waitUntil(initializeDatabase(env).then(() => { setDbReady(true); }));
    }
    // Resolve user identity from MCP client headers for per-user scoping.
    let mcpUserId: string | undefined;
    const resolved = await resolveUser(request, env);
    if (resolved) mcpUserId = resolved.user_id;
    const server = buildMcpServer(env, ctx, mcpUserId);
    const isToolsList = await isMcpToolsListRequest(request);
    const response = await createMcpHandler(server)(request, env, ctx);
    return isToolsList ? sanitizeToolsListResponse(response) : response;
  },
};

export { apiHandler };
