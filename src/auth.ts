/**
 * auth.ts — Authentication and user identity resolution.
 *
 * Purpose: HMAC key generation, API key creation, credential parsing, user lookup
 *   against the `users` table, Bearer-token gating, and the combined requireAuthAsync
 *   gate used by all route handlers.
 * Input: HTTP requests with credential headers/bearer tokens, the DB, and env secrets.
 * Output: Auth results (user ID + username), API keys, login HTML, or error responses.
 * Logic: HMAC-SHA-256 hashing, constant-time comparison, D1 user lookups,
 *   and legacy bearer-only mode with system user fallback.
 */

import { type Env } from "./types";
import { CORS_HEADERS } from "./config";
import { getSystemUserId } from "./db";

// ─── Constants ────────────────────────────────────────────────────────────────

export const AUTH_PEPPER = "second-brain-v2"; // server-side pepper for HMAC

// ─── HMAC / API key helpers ────────────────────────────────────────────────────

export async function hmacKey(rawKey: string, pepper: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(rawKey);
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(pepper));
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export function generateApiKey(): { publicId: string; secret: string; fullKey: string } {
  const publicId = crypto.randomUUID().replace(/-/g, "");
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map(b => b.toString(36).padStart(2, "0")).join("").slice(0, 32);
  return { publicId, secret, fullKey: `sbu_${publicId}.${secret}` };
}

// ─── Credential parsing / resolution ──────────────────────────────────────────

function parseUserCredentials(request: Request): { username: string | null; key: string | null } {
  return {
    username: request.headers.get("X-Second-Brain-User"),
    key: request.headers.get("X-Second-Brain-User-Key"),
  };
}

export async function resolveUser(
  request: Request, env: Env
): Promise<{ user_id: string; username: string } | null> {
  const { username, key } = parseUserCredentials(request);
  if (!username || !key) return null;

  // Extract the secret part from "sbu_<publicId>.<secret>" format
  const dotIndex = key.lastIndexOf(".");
  const rawSecret = dotIndex > -1 ? key.slice(dotIndex + 1) : key;

  const normalized = username.toLowerCase().trim();
  const row = await (env.DB as any).prepare(
    "SELECT id, auth_key_hash FROM users WHERE normalized_username = ? AND status = 'active'"
  ).bind(normalized).first();
  if (!row) return null;

  const keyHash = await hmacKey(rawSecret, AUTH_PEPPER);

  // Constant-time comparison to prevent timing side-channel attacks
  const storedHash = row.auth_key_hash as string;
  if (keyHash.length !== storedHash.length) return null;
  const encoder = new TextEncoder();
  const a = encoder.encode(keyHash);
  const b = encoder.encode(storedHash);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  if (diff !== 0) return null;

  return { user_id: row.id, username };
}

export function isAuthorized(request: Request, env: Env): boolean {
  if (request.headers.get("Authorization") === `Bearer ${env.AUTH_TOKEN}`) return true;
  return new URL(request.url).searchParams.get("token") === env.AUTH_TOKEN;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ─── Combined auth gate ────────────────────────────────────────────────────────

// Async auth: returns `{ error, user_id, username }`. All route handlers should
// use this. Legacy bearer-only → system user ID. Bearer + user headers → resolved user.
export async function requireAuthAsync(
  request: Request, env: Env
): Promise<{ error: Response | null; user_id?: string; username?: string }> {
  if (!isAuthorized(request, env)) {
    return { error: json({ ok: false, error: "Unauthorized" }, 401) };
  }
  const { username, key } = parseUserCredentials(request);
  if (username && key) {
    const resolved = await resolveUser(request, env);
    if (!resolved) {
      return { error: json({ ok: false, error: "Unauthorized" }, 401) };
    }
    return { error: null, user_id: resolved.user_id, username: resolved.username };
  }
  // Legacy mode: bearer token only → system user
  const systemUserId = await getSystemUserId(env);
  return { error: null, user_id: systemUserId };
}

// Sync version for backward compat (doesn't verify user key — use requireAuthAsync in routes)
function requireAuth(request: Request, env: Env): Response | null {
  if (isAuthorized(request, env)) return null;
  return json({ ok: false, error: "Unauthorized" }, 401);
}

// ─── Hosted OAuth login page ──────────────────────────────────────────────────

export function loginHtml(error?: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <meta name="theme-color" content="#F4F1EA" />
  <title>Second Brain</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.44.0/tabler-icons.min.css" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #f4f1ea; --bg-card: #fcfbf7;
      --accent: #b26641; --accent-press: #9c522f; --accent-soft: rgba(178, 102, 65, 0.1); --on-accent: #fcfbf7;
      --text-primary: #26241f; --text-secondary: #6e6b62; --text-tertiary: #a8a498;
      --border-input: rgba(38, 36, 31, 0.11); --danger: #b3261e;
      --font-serif: 'Lora', Georgia, serif; --font-sans: 'DM Sans', system-ui, sans-serif;
      --ease: cubic-bezier(0.22, 1, 0.36, 1);
    }
    body { background: var(--bg); font-family: var(--font-sans); color: var(--text-primary); min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .auth-card { width: 100%; max-width: 400px; padding: 40px 32px; display: flex; flex-direction: column; align-items: center; animation: fade-in 0.5s var(--ease); }
    @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
    .brain-logo { width: 70px; height: 70px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); display: flex; align-items: center; justify-content: center; margin-bottom: 24px; position: relative; }
    .brain-logo i { font-size: 33px; }
    .brain-logo::after { content: ''; position: absolute; inset: -7px; border-radius: 50%; border: 1px solid var(--accent-soft); }
    h1 { font-family: var(--font-serif); font-size: 29px; font-weight: 500; margin-bottom: 9px; letter-spacing: -0.015em; }
    p { font-size: 14px; color: var(--text-secondary); margin-bottom: 34px; text-align: center; line-height: 1.6; max-width: 300px; }
    form { width: 100%; display: flex; flex-direction: column; gap: 11px; margin-bottom: 14px; }
    input { width: 100%; padding: 14px 16px; background: var(--bg-card); border: 0.5px solid var(--border-input); border-radius: 13px; font-family: var(--font-sans); font-size: 15px; color: var(--text-primary); outline: none; transition: border-color 0.18s, box-shadow 0.18s; }
    input::placeholder { color: var(--text-tertiary); }
    input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    button { width: 100%; padding: 15px; background: var(--accent); color: var(--on-accent); border: none; border-radius: 13px; font-family: var(--font-sans); font-size: 15px; font-weight: 600; cursor: pointer; transition: background 0.18s, transform 0.12s var(--ease); }
    button:hover { background: var(--accent-press); }
    button:active { transform: scale(0.985); }
    .auth-error { font-size: 13px; color: var(--danger); text-align: center; margin-top: 10px; min-height: 18px; }
  </style>
</head>
<body>
  <div class="auth-card">
    <div class="brain-logo"><i class="ti ti-brain"></i></div>
    <h1>Second Brain</h1>
    <p>Enter your Bearer token to connect to your personal memory layer.</p>
    <form method="POST">
      <input type="password" name="password" placeholder="Bearer token" autofocus autocomplete="current-password" />
      <button type="submit">Connect</button>
    </form>
    <div class="auth-error">${error ? error : ""}</div>
  </div>
</body>
</html>`;
}
