// ─── OAuth API handler — /mcp only ──────────────────────────────────────────
// Purpose: Handles MCP protocol requests under the OAuthProvider, resolving
//          per-user identity and delegating to the MCP server.
// Input:   Request, Env, ExecutionContext from Cloudflare Workers runtime.
// Output:  Response — either the raw MCP response or a sanitized tools-list.
// Logic:   1. Await schema initialization before authentication or tool setup.
//          2. Resolve a verified actor from per-user credentials or OAuth props.
//          3. Fail closed before server construction when no actor is available.
//          4. Build an MCP server scoped to that actor.
//          5. Forward the request through createMcpHandler; if the client only
//             asked for the tool list, strip execution metadata from the response.

import { type Env } from "./types";
import { initializeDatabase } from "./db";
import { resolveMcpActor } from "./auth";
import { buildMcpServer, isMcpToolsListRequest, sanitizeToolsListResponse } from "./mcp";
import { createMcpHandler } from "agents/mcp";

function mcpIdentityError(status: 401 | 503, message: string): Response {
  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
  };
  if (status === 401) headers["WWW-Authenticate"] = "Bearer";

  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    error: { code: status === 401 ? -32001 : -32002, message },
    id: null,
  }), { status, headers });
}

const apiHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      await initializeDatabase(env);
    } catch (error) {
      console.error("Database initialization failed:", error);
      return mcpIdentityError(503, "Second Brain storage is unavailable");
    }
    // OAuthProvider injects the authenticated token principal into ctx.props.
    // Complete, verified legacy user headers may select a narrower per-user
    // actor. Any missing/invalid actor fails before an MCP server exists.
    let resolution: Awaited<ReturnType<typeof resolveMcpActor>>;
    try {
      resolution = await resolveMcpActor(request, env, ctx.props);
    } catch (error) {
      console.error("MCP actor resolution failed:", error);
      return mcpIdentityError(503, "MCP identity verification is unavailable");
    }

    if (!resolution.ok) {
      return mcpIdentityError(401, "Authenticated MCP actor required");
    }

    const { actor } = resolution;
    const server = buildMcpServer(env, ctx, actor.user_id);
    const isToolsList = await isMcpToolsListRequest(request);
    const response = await createMcpHandler(server, {
      authContext: {
        props: {
          userId: actor.user_id,
          actorSource: actor.source,
        },
      },
    })(request, env, ctx);
    return isToolsList ? sanitizeToolsListResponse(response) : response;
  },
};

export { apiHandler };
