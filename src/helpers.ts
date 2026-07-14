/**
 * helpers.ts — Pure utility functions used across modules.
 *
 * Purpose: Stream reading (SSE parsing), text processing, embedding, chunking,
 *   cosine similarity, hashtag extraction, and query tokenization.
 * Input: Raw text, vectors, or configuration values.
 * Output: Processed strings, arrays of chunks, embedding vectors.
 * Logic: Stateless helpers — no DB access, no side effects.
 */

import { KEYWORD_MIN_TOKEN_LEN, KEYWORD_STOPWORDS, CHUNK_MAX_CHARS, CHUNK_OVERLAP_CHARS, RETENTION_HALF_LIFE_DAYS } from "./config";

// ─── Stream / binary utilities ─────────────────────────────────────────────────

// Parse Workers AI streaming responses (SSE data lines).
export async function readStreamText(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    decoder.decode(value).split("\n").forEach(line => {
      if (line.startsWith("data: ") && !line.includes("[DONE]")) {
        try { const d = JSON.parse(line.slice(6)); if (d.response) text += d.response; } catch { }
      }
    });
  }
  reader.releaseLock();
  return text;
}

// ─── LIKE pattern escape ───────────────────────────────────────────────────────

export function escapeLikePattern(s: string): string {
  return s.replace(/%/g, "\\%").replace(/_/g, "\\_");
}

// ─── Embedding ─────────────────────────────────────────────────────────────────

export async function embed(text: string, env: { AI: { run: (model: string, opts: { text: string[] }) => Promise<{ data: number[][] }> } }): Promise<number[]> {
  const result = (await env.AI.run("@cf/baai/bge-small-en-v1.5" as any, { text: [text] })) as any;
  return result.data[0] as number[];
}

// ─── Chunking ──────────────────────────────────────────────────────────────────

export function chunkText(text: string, maxChars = CHUNK_MAX_CHARS, overlapChars = CHUNK_OVERLAP_CHARS): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxChars;
    if (end < text.length) {
      const lastPeriod = text.lastIndexOf(".", end);
      const lastNewline = text.lastIndexOf("\n", end);
      const breakPoint = Math.max(lastPeriod, lastNewline);
      if (breakPoint > start + maxChars / 2) end = breakPoint + 1;
    }
    chunks.push(text.slice(start, Math.min(end, text.length)).trim());
    start = end - overlapChars;
  }

  return chunks.filter((c) => c.length > 0);
}

// ─── Hashtag extraction ────────────────────────────────────────────────────────

export function extractHashtags(content: string): { cleanContent: string; hashtags: string[] } {
  const hashtags = (content.match(/#\w+/g) ?? []).map(t => t.slice(1).toLowerCase());
  const cleanContent = content.replace(/#\w+/g, '').replace(/\s+/g, ' ').trim();
  return { cleanContent, hashtags };
}

// ─── Time-decay half-life ─────────────────────────────────────────────────────

export function getHalfLifeMs(tags: string[]): number {
  if (tags.includes("task")) return 7 * 24 * 60 * 60 * 1000;  // 7 days
  if (tags.includes("context")) return 180 * 24 * 60 * 60 * 1000; // 6 months
  if (tags.includes("work")) return 90 * 24 * 60 * 60 * 1000; // 3 months
  return 30 * 24 * 60 * 60 * 1000; // 30 days default
}

// ─── Cosine similarity ─────────────────────────────────────────────────────────

// Cosine similarity between two vectors. BGE embeddings are not normalized,
// so the denominator matters — this keeps tag-path scores on the same scale
// as Vectorize's cosine query scores.
export function cosineSim(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  // Guard on the raw norms, not the sqrt product — the product can underflow to 0
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}

// ─── Query tokenization (keyword recall) ──────────────────────────────────────

// Split a query into lexical search tokens: lowercase, strip surrounding punctuation,
// drop stopwords / 1-char tokens, and remove SQL LIKE wildcards so each token is a literal
// substring. Identifier-shaped tokens (e.g. "v1.9", "#149") are preserved intact.
export function tokenizeQuery(query: string): string[] {
  return [...new Set(
    query.toLowerCase().split(/\s+/)
      .map(t => t.replace(/^[^\w#.]+|[^\w#.]+$/g, "").replace(/[%_]/g, ""))
      .filter(t => t.length >= KEYWORD_MIN_TOKEN_LEN && !KEYWORD_STOPWORDS.has(t))
  )];
}

// ─── Spaced repetition retention score ──────────────────────────────────────

// Exponential decay from time-since-last-recall. If lastRecalledAt is null,
// falls back to createdAt (backward compatible for existing entries).
// Returns a value in (0, 1] — 1.0 means "just recalled", approaches 0 over time.
export function getRetentionScore(lastRecalledAt: number | null, createdAt: number, now: number): number {
  const effectiveLastRecall = lastRecalledAt ?? createdAt;
  const msSinceRecall = Math.max(0, now - effectiveLastRecall);
  const daysSinceRecall = msSinceRecall / (24 * 60 * 60 * 1000);
  const lambda = Math.log(2) / RETENTION_HALF_LIFE_DAYS;
  return Math.exp(-lambda * daysSinceRecall);
}
