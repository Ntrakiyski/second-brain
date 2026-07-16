/**
 * index.ts — Production Cloudflare Worker entrypoint.
 *
 * Purpose: Wire apiHandler and defaultHandler through OAuthProvider without
 * exposing ordinary module values as named Worker entrypoints. Cloudflare
 * interprets named exports from this module as additional entrypoints.
 * Input: Incoming HTTP requests and scheduled events.
 * Output: OAuthProvider-wrapped fetch handler and nightly cron handler.
 */

import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import type { Env } from "./types";
import { apiHandler } from "./api-handler";
import { defaultHandler } from "./routes";
import { resolveUserByApiKey } from "./auth";
import { initializeDatabase } from "./db";
import {
  runNightlyCompression,
  runGraphPass,
  detectCrossUserContradictions,
} from "./lifecycle";
import { runScheduledIntegrationSync } from "./integrations-mirror";

const oauthProvider = new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: apiHandler as any,
  defaultHandler: defaultHandler as any,
  authorizeEndpoint: "/oauth/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  // Personal API keys may be used directly by non-browser MCP clients. The
  // deployment token is deliberately not a principal: it can gate legacy
  // transport, but it must never collapse every client into one user namespace.
  resolveExternalToken: async ({ token, env }) => {
    const typedEnv = env as Env;
    if (token === typedEnv.AUTH_TOKEN) return null;
    await initializeDatabase(typedEnv);
    const principal = await resolveUserByApiKey(token, typedEnv);
    return principal ? { props: { userId: principal.user_id } } : null;
  },
});

export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) =>
    oauthProvider.fetch(req, env as any, ctx),
  scheduled: async (_event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(runNightlyCompression(env, ctx));
    ctx.waitUntil(runGraphPass(env, ctx));
    ctx.waitUntil(
      detectCrossUserContradictions(env).catch((error) =>
        console.error(
          "detectCrossUserContradictions failed (non-fatal):",
          error,
        ),
      ),
    );
    ctx.waitUntil(runScheduledIntegrationSync(env));
  },
};
