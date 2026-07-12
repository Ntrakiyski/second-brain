import { describe, it, expect, beforeEach } from "vitest";
import worker from "../../src/index";
import { makeTestEnv } from "../helpers/make-env";
import { req } from "../helpers/make-request";
import type { Env } from "../../src/index";

const ctx = { waitUntil: (_: Promise<any>) => { } } as any;

const PROTECTED_ROUTES: Array<[string, string, unknown?]> = [
  ["POST", "/capture", { content: "hello" }],
  ["POST", "/append", { id: "abc", addition: "update" }],
  ["GET", "/list", undefined],
  ["GET", "/tags", undefined],
  ["GET", "/recall?query=test", undefined],
  ["POST", "/forget", { id: "abc" }],
  ["POST", "/chat", { query: "what?" }],
  ["POST", "/mcp", undefined],
];

describe("Auth", () => {
  let env: Env;
  beforeEach(() => { env = makeTestEnv(); });

  for (const [method, path, body] of PROTECTED_ROUTES) {
    it(`${method} ${path} — no token → 401`, async () => {
      const res = await worker.fetch(req(method, path, { body, token: null }), env, ctx);
      expect(res.status).toBe(401);
      const data = await res.json() as any;
      expect(data.error).toBe("Unauthorized");
    });

    it(`${method} ${path} — wrong token → 401`, async () => {
      const res = await worker.fetch(req(method, path, { body, token: "wrong-token" }), env, ctx);
      expect(res.status).toBe(401);
    });
  }

  for (const [method, path, body] of PROTECTED_ROUTES) {
    it(`${method} ${path} — bearer token alone → not 401 (legacy mode)`, async () => {
      const res = await worker.fetch(req(method, path, { body }), env, ctx);
      expect(res.status).not.toBe(401);
    });
  }

  it("POST /capture — bearer + valid user headers → 200", async () => {
    // First create a user
    const createRes = await worker.fetch(req("POST", "/api/users", { body: { username: "alice" } }), env, ctx);
    const { key } = await createRes.json() as any;

    const res = await worker.fetch(
      req("POST", "/capture", { body: { content: "test entry" }, userCredentials: { username: "alice", key } }),
      env, ctx
    );
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.ok).toBe(true);
  });

  it("POST /capture — bearer + invalid key → 401", async () => {
    await worker.fetch(req("POST", "/api/users", { body: { username: "alice" } }), env, ctx);
    const res = await worker.fetch(
      req("POST", "/capture", { body: { content: "test" }, userCredentials: { username: "alice", key: "wrong-key" } }),
      env, ctx
    );
    expect(res.status).toBe(401);
  });

  it("POST /capture — bearer + unknown username → 401", async () => {
    const res = await worker.fetch(
      req("POST", "/capture", { body: { content: "test" }, userCredentials: { username: "unknown", key: "anything" } }),
      env, ctx
    );
    expect(res.status).toBe(401);
  });

  it("POST /capture — user headers without bearer → 401", async () => {
    await worker.fetch(req("POST", "/api/users", { body: { username: "alice" } }), env, ctx);
    const createRes = await worker.fetch(req("POST", "/api/users", { body: { username: "alice" } }), env, ctx);
    // Even with valid user headers, no bearer token means 401
    const res = await worker.fetch(
      req("POST", "/capture", { body: { content: "test" }, token: null, userCredentials: { username: "alice", key: "whatever" } }),
      env, ctx
    );
    expect(res.status).toBe(401);
  });
});
