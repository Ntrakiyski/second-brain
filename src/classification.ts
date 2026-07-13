/**
 * AI classification and query tag inference for memory entries.
 *
 * Input:   Raw memory content string + Env (for AI/DB bindings).
 * Output:  Importance score (1-5), canonical flag, kind (episodic/semantic), and inferred tags.
 * Logic:   Uses LLM streaming classification with tolerant JSON parsing, hashtag extraction,
 *          and multi-fallback query tag inference (hashtags → keyword match → LLM).
 */

import type { Env, MemoryKind } from './types';
import { CLASSIFY_MAX_TOKENS, LLM_MODEL } from './config';
import { readStreamText } from './helpers';

// ─── AI classification (importance + canonical) ───────────────────────────────

// Map the model's free-text kind to our enum — tolerant of case, whitespace, and
// common synonyms a small model emits (e.g. "event" → episodic, "fact" → semantic).
function normalizeKind(raw: unknown): MemoryKind | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (/episod|event|decision|milestone|occurrence/.test(v)) return "episodic";
  if (/semantic|fact|preference|knowledge|belief/.test(v)) return "semantic";
  return null;
}

// Parse the classifier's response. Tries strict JSON first, then falls back to
// tolerant per-field extraction so one malformed field (small models intermittently
// emit e.g. {"canonical":,}) doesn't discard the other valid fields.
function parseClassification(text: string): { importance: number; canonical: boolean; kind: MemoryKind | null } {
  const obj = text.match(/\{[^{}]*\}/);
  if (obj) {
    try {
      const p = JSON.parse(obj[0]);
      return {
        importance: p.importance >= 1 && p.importance <= 5 ? p.importance : 3,
        canonical: p.canonical === true,
        kind: normalizeKind(p.kind),
      };
    } catch { /* fall through to tolerant extraction */ }
  }
  const imp = text.match(/"importance"\s*:\s*([1-5])/);
  const can = text.match(/"canonical"\s*:\s*(true|false)/i);
  const knd = text.match(/"kind"\s*:\s*"?([a-zA-Z]+)/);
  return {
    importance: imp ? parseInt(imp[1], 10) : 3,
    canonical: can ? can[1].toLowerCase() === "true" : false,
    kind: knd ? normalizeKind(knd[1]) : null,
  };
}

export async function classifyEntry(content: string, env: Env): Promise<{ importance: number; canonical: boolean; kind: MemoryKind | null }> {
  let text: string;
  try {
    const stream = await env.AI.run(LLM_MODEL as any, {
      messages: [{ role: "user", content:
        `Classify this memory. Respond with ONLY one JSON object and nothing else — no prose, no markdown, no code fences.\n` +
        `{"importance": <1-5>, "canonical": <true|false>, "kind": "episodic"|"semantic"}\n` +
        `importance: 1=trivial, 3=useful context, 5=critical decision or goal.\n` +
        `canonical: true ONLY for a confirmed decision, durable fact, or stated permanent preference that should be authoritative (be conservative; false for anything tentative, one-off, or event-like).\n` +
        `kind: "episodic" for a specific event/decision/milestone that happened at a point in time; "semantic" for a general fact, preference, or piece of knowledge.\n\n` +
        `Memory: ${content.slice(0, 500)}`,
      }],
      max_tokens: CLASSIFY_MAX_TOKENS,
      stream: true,
    });
    text = await readStreamText(stream as ReadableStream);
  } catch {
    return { importance: 0, canonical: false, kind: null };
  }
  return parseClassification(text);
}

// ─── Hashtag extraction ───────────────────────────────────────────────────────

export function extractHashtags(content: string): { cleanContent: string; hashtags: string[] } {
  const hashtags = (content.match(/#\w+/g) ?? []).map(t => t.slice(1).toLowerCase());
  const cleanContent = content.replace(/#\w+/g, '').replace(/\s+/g, ' ').trim();
  return { cleanContent, hashtags };
}

// ─── Query tag inference ──────────────────────────────────────────────────────

export async function inferQueryTags(query: string, env: Env): Promise<string[]> {
  const { hashtags } = extractHashtags(query);
  if (hashtags.length) return hashtags;

  const { results: tagRows } = await env.DB.prepare(
    `SELECT DISTINCT value FROM entries, json_each(entries.tags) ORDER BY value`
  ).all();
  const knownTags = (tagRows as { value: string }[]).map(r => r.value);

  const lowerQuery = query.toLowerCase();
  const keywordMatches = knownTags.filter(t =>
    new RegExp(`(?<![\\w-])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "i").test(lowerQuery)
  );

  if (keywordMatches.length) return keywordMatches;

  if (!knownTags.length) return [];

  try {
    const stream = await env.AI.run(LLM_MODEL as any, {
      messages: [{
        role: "user",
        content: `From this list of tags: ${knownTags.slice(0, 50).join(", ")}\n\nWhich tags best match this query? Reply with only a comma-separated list of matching tag names from the list, or nothing if none apply.\n\nQuery: ${query.slice(0, 300)}`,
      }],
      max_tokens: 100,
      stream: true,
    });
    const text = await readStreamText(stream as ReadableStream);
    const knownSet = new Set(knownTags);
    return text.split(",").map(t => t.trim().toLowerCase()).filter(t => t && knownSet.has(t));
  } catch {
    return [];
  }
}
