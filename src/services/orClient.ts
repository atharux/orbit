// Resilient OpenRouter free-tier client — the "gold standard", ported from
// job-tracker/src/agents/openRouterClient.ts and generalised. Zero dependencies,
// portable across edge / node / browser (anywhere `fetch` exists). Copy into a
// project (e.g. lib/orClient.ts); strip type annotations for a plain-JS project.
//
// What it does:
//   - Discovers free models live from OpenRouter's /models catalogue and caches
//     them (localStorage 24h in a browser, module memory ~10min on a server).
//   - Retries across models on 429 / unavailable, preferring the requested model
//     but skipping coder/math models and deprioritising the throttled Gemma tier.
//   - Optional JSON path (generateJSON) that parses INSIDE the retry loop, so a
//     truncated / non-JSON response advances to the next model instead of throwing.
//
// See the `resilient-openrouter` skill for the "why" behind each decision.

// ---------------------------------------------------------------------------
// Free-model discovery + cache
// ---------------------------------------------------------------------------

const CACHE_KEY = 'openrouter_free_models';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // browser
const MEM_TTL_MS = 10 * 60 * 1000; // server
// Safety net ONLY for when GET /models can't be reached — the live discovery
// below is the real source of truth. Keep this to a few currently-free ids
// (verified live 2026-07-24); if they go stale, discovery still recovers.
const FALLBACK_FREE_MODELS = [
  'inclusionai/ling-3.0-flash:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
];
const FALLBACK_FREE_MODEL = FALLBACK_FREE_MODELS[0];

// Coder/math models: high context but terrible rate limits and wrong use case.
const SKIP_MODEL_RE = /coder|math|code-/i;
// Deprioritise (don't drop) the throttled free Gemma tier — near-constant 429s.
const DEPRIORITISE_RE = /gemma/i;
// Non-text models that won't follow a "return JSON/text" instruction.
const SPECIALISED_RE = /content-safety|guard|moderation|lyria|whisper|embed|rerank/i;

const RATE_LIMIT_RE = /rate.limit|too many requests|429/i;
// "only available on agentic harnesses" is a real OpenRouter error class seen
// live (thinkingmachines/inkling-small:free and others) -- some free models
// are gated to require a recognized agent/coding-tool client and reject a
// plain chat-completions call from an app like this one. Confirmed this
// wasn't caught before: it doesn't contain "unavailable" (no "un" prefix),
// so it fell through every existing branch and surfaced as a hard error to
// the user instead of silently advancing to the next model in the queue.
const MODEL_UNAVAILABLE_RE = /unavailable|not found|does not exist|quota|no endpoints|agentic harness/i;

let MEM_CACHE: { models: string[]; at: number } = { models: [], at: 0 };
const hasLS = typeof localStorage !== 'undefined';

export function getCachedFreeModels(): string[] | null {
  try {
    if (hasLS) {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const c = JSON.parse(raw) as { models: string[]; at: number };
      if (Date.now() - c.at > CACHE_TTL_MS) return null;
      return c.models.length ? c.models : null;
    }
    if (MEM_CACHE.models.length && Date.now() - MEM_CACHE.at < MEM_TTL_MS) return MEM_CACHE.models;
    return null;
  } catch {
    return null;
  }
}

/** Fetch OpenRouter's live catalogue, keep free + usable text models, cache it. */
export async function fetchAndCacheFreeModels(apiKey: string): Promise<string[]> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return getCachedFreeModels() ?? [FALLBACK_FREE_MODEL];

    const { data } = (await res.json()) as {
      data: Array<{ id: string; context_length?: number; architecture?: { output_modalities?: string[] }; pricing?: { prompt?: string; completion?: string } }>;
    };

    const free = (data || [])
      .filter((m) => {
        const id = String(m.id || '');
        const isFree = id.endsWith(':free') || (m.pricing?.prompt === '0' && m.pricing?.completion === '0');
        const out = m.architecture?.output_modalities;
        const emitsText = !out || out.includes('text');
        return isFree && emitsText && !SPECIALISED_RE.test(id);
      })
      // Bigger context first, then push the throttled Gemma tier to the back.
      .sort((a, b) => (b.context_length ?? 0) - (a.context_length ?? 0))
      .sort((a, b) => (DEPRIORITISE_RE.test(a.id) ? 1 : 0) - (DEPRIORITISE_RE.test(b.id) ? 1 : 0))
      .map((m) => m.id);

    if (free.length) {
      if (hasLS) localStorage.setItem(CACHE_KEY, JSON.stringify({ models: free, at: Date.now() }));
      else MEM_CACHE = { models: free, at: Date.now() };
    }
    return free.length ? free : FALLBACK_FREE_MODELS;
  } catch {
    return getCachedFreeModels() ?? FALLBACK_FREE_MODELS;
  }
}

/** Sync — first cached model or hardcoded fallback. Never blocks. */
export function getPreferredFreeModel(): string {
  return getCachedFreeModels()?.[0] ?? FALLBACK_FREE_MODEL;
}

// ---------------------------------------------------------------------------
// OpenRouter chat call with model-fallback retry
// ---------------------------------------------------------------------------

export interface AIMessage { role: 'system' | 'user' | 'assistant'; content: string; }

export interface CallOptions {
  apiKey: string;
  messages: AIMessage[];
  /** Preferred model; skipped as the head pick if it's a coder/math or Gemma model. */
  model?: string;
  maxTokens?: number;
  temperature?: number;
  queueCap?: number;
  siteUrl?: string;
  appTitle?: string;
}

/** Raw text call. Tries preferred model then live free fallbacks; advances on 429/unavailable. */
export async function callOpenRouter(opts: CallOptions): Promise<{ text: string; model: string }> {
  if (!opts.apiKey) throw new Error('No API key found. Add an OpenRouter key in Settings.');

  // Discover live free models when the cache is cold — otherwise this path would
  // fall back to the tiny hardcoded list and die the moment one id goes stale.
  let free = getCachedFreeModels();
  if (!free || !free.length) free = await fetchAndCacheFreeModels(opts.apiKey);
  const cached = (free ?? []).filter((m) => !SKIP_MODEL_RE.test(m));
  const wanted = opts.model && !SKIP_MODEL_RE.test(opts.model) && !DEPRIORITISE_RE.test(opts.model)
    ? opts.model
    : undefined;
  const candidates = [...new Set([wanted, ...cached, ...FALLBACK_FREE_MODELS].filter(Boolean) as string[])]
    .slice(0, opts.queueCap ?? 6);

  let lastError = '';
  for (const model of candidates) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opts.apiKey}`,
          'HTTP-Referer': opts.siteUrl || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'),
          'X-Title': opts.appTitle || 'App',
        },
        body: JSON.stringify({
          model,
          messages: opts.messages,
          max_tokens: opts.maxTokens ?? 3000,
          temperature: opts.temperature,
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        return { text: data.choices?.[0]?.message?.content ?? '', model };
      }
      const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      const msg = err?.error?.message ?? String(res.status);
      if (res.status === 429 || RATE_LIMIT_RE.test(msg) || MODEL_UNAVAILABLE_RE.test(msg)) {
        lastError = msg;
        continue; // skip to next model
      }
      throw new Error(`OpenRouter error: ${msg}`);
    } catch (err) {
      const msg = String(err);
      if (RATE_LIMIT_RE.test(msg) || MODEL_UNAVAILABLE_RE.test(msg)) { lastError = msg; continue; }
      throw err;
    }
  }
  throw new Error(`OpenRouter: all models rate limited or unavailable. Try again shortly. (${lastError})`);
}

// ---------------------------------------------------------------------------
// JSON path — parse INSIDE the retry loop
// ---------------------------------------------------------------------------

/** Salvage + parse + validate a JSON array from a model response. Throws on failure. */
export function parseJsonArray(raw: string): any[] {
  let cleaned = String(raw).replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start !== -1 && end > start) cleaned = cleaned.slice(start, end + 1);
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('model returned no usable results');
  return parsed;
}

/**
 * Generate a validated non-empty JSON array from a prompt. A model that returns
 * truncated / non-JSON output is treated as a failure and the next model is tried.
 */
export async function generateJSON(opts: Omit<CallOptions, 'messages'> & { prompt: string }): Promise<any[]> {
  if (!opts.apiKey) throw new Error('No API key configured. Add your OpenRouter key in Settings.');

  const cached = getCachedFreeModels() ?? (await fetchAndCacheFreeModels(opts.apiKey));
  const usable = cached.filter((m) => !SKIP_MODEL_RE.test(m));
  const wanted = opts.model && !SKIP_MODEL_RE.test(opts.model) && !DEPRIORITISE_RE.test(opts.model)
    ? opts.model
    : undefined;
  const queue = [...new Set([wanted, ...usable, ...FALLBACK_FREE_MODELS].filter(Boolean) as string[])]
    .slice(0, opts.queueCap ?? 6);

  let lastErr: unknown;
  for (const model of queue) {
    try {
      const { text } = await callOpenRouter({ ...opts, model, messages: [{ role: 'user', content: opts.prompt }], queueCap: 1 });
      return parseJsonArray(text);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('All models failed');
}
