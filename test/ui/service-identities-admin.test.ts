import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const indexHtml = readFileSync(resolve(process.cwd(), "public/index.html"), "utf8");

describe("service identity administrator UI", () => {
  it("keeps the entry hidden until the server confirms administrator access", () => {
    expect(indexHtml).toContain('id="service-identities-menu-item"');
    expect(indexHtml).toContain('id="service-identities-menu-item" onclick="openServiceIdentities()" style="display: none"');
    expect(indexHtml).toContain("async function probeServiceIdentityAccess()")
    expect(indexHtml).toContain("if (!res.ok || !Array.isArray(data.services))")
    expect(indexHtml).toContain("if (res.status === 403)")
    expect(indexHtml).toContain("menuItem.style.display = 'none'")
  });

  it("provides safe create defaults and excludes execution scopes by default", () => {
    expect(indexHtml).toContain('<option value="propose" selected>Propose changes</option>');
    expect(indexHtml).toContain('value="memory:read" checked');
    expect(indexHtml).toContain('value="memory:propose" checked');
    expect(indexHtml).toContain('value="proposal:create" checked');
    expect(indexHtml).toContain('value="memory:execute-approved" />');
    expect(indexHtml).toContain('value="proposal:execute-approved" />');
    expect(indexHtml).toContain('id="service-expiry" name="expires_at" type="datetime-local"');
  });

  it("uses authenticated APIs and safely renders server-provided metadata", () => {
    expect(indexHtml).toContain("fetch(`${WORKER_URL}/api/service-identities`, { headers: authHeaders() })")
    expect(indexHtml).toContain("fetch(`${WORKER_URL}/api/service-identities/${encodeURIComponent(id)}/${action}`, options)")
    expect(indexHtml).toContain("${escHtml(service.name || 'Unnamed service')}")
    expect(indexHtml).toContain("${escHtml(service.id)}")
    expect(indexHtml).toContain("scopes.map((scope) => escHtml(scope)).join(', ')")
    expect(indexHtml).toContain("service.credential_prefix ? String(service.credential_prefix) : 'No active key'")
  });

  it("reveals new and rotated keys once and clears them when the sheet closes", () => {
    expect(indexHtml).toContain("This is the only time the full key will be visible")
    expect(indexHtml).toContain("revealServiceSecret(data.credential.key)")
    expect(indexHtml).toContain("if (action === 'rotate') revealServiceSecret(data.credential?.key)")
    expect(indexHtml).toContain("function clearIssuedServiceSecret()")
    expect(indexHtml).toContain("issuedServiceSecret = ''")
    expect(indexHtml).toContain("navigator.clipboard?.writeText")
    expect(indexHtml).toContain("Permanently revoke this identity and all of its keys? This cannot be undone.")
  });

  it("tolerates non-JSON and network errors without exposing raw responses", () => {
    expect(indexHtml).toContain("async function readServiceResponse(res)")
    expect(indexHtml).toContain("return data && typeof data === 'object' ? data : {}")
    expect(indexHtml).toContain("error instanceof Error ? error.message : 'Could not load service identities'")
    expect(indexHtml).not.toContain("data.credential.key}</div>")
  });

  it("keeps the inline application script syntactically valid", () => {
    const scripts = [...indexHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
      .map((match) => match[1])
      .filter((source) => source.trim());
    expect(scripts.length).toBeGreaterThan(0);
    for (const source of scripts) expect(() => new Function(source)).not.toThrow();
  });
});
