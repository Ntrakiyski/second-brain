const BASE = "http://localhost";
const TOKEN = "test-token";

export function req(
  method: string,
  path: string,
  opts: { body?: unknown; token?: string | null; userCredentials?: { username: string; key: string } } = {}
): Request {
  const { body, token = TOKEN, userCredentials } = opts;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token !== null) headers["Authorization"] = `Bearer ${token}`;
  if (userCredentials) {
    headers["X-Second-Brain-User"] = userCredentials.username;
    headers["X-Second-Brain-User-Key"] = userCredentials.key;
  }
  return new Request(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
