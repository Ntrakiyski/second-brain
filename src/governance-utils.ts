/** Internal, capability-free helpers shared by operator governance services. */

export function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function stableJson(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (candidate: unknown): unknown => {
    if (candidate === null || typeof candidate !== "object") {
      if (typeof candidate === "bigint" || typeof candidate === "function" || typeof candidate === "symbol") {
        throw new TypeError("Value is not JSON serializable");
      }
      return candidate;
    }
    if (seen.has(candidate)) throw new TypeError("Value contains a cycle");
    seen.add(candidate);
    if (Array.isArray(candidate)) return candidate.map(normalize);
    const record = candidate as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] !== undefined) normalized[key] = normalize(record[key]);
    }
    return normalized;
  };
  const serialized = JSON.stringify(normalize(value));
  if (serialized === undefined) throw new TypeError("Value is not JSON serializable");
  return serialized;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function sqlChanges(result: D1Result<unknown> | undefined): number {
  return Number(result?.meta?.changes ?? 0);
}
