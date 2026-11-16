import type { Budget } from './budget';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
/** Charged per call when OpenRouter omits usage.cost, so the money cap cannot be silently bypassed. */
export const FALLBACK_COST_USD = 0.01;
const UPSTREAM_TIMEOUT_MS = 30_000;
const MODEL_RE = /^[\w.-]+\/[\w.:-]+$/;

export interface DecideBody {
  model: string;
  system: string;
  user: string;
}
export interface DecideDeps {
  apiKey: string;
  budget: Budget;
  fetchImpl: typeof fetch;
}
export interface HandlerResult {
  status: number;
  json: unknown;
}

export function buildPayload(body: DecideBody): object {
  return {
    model: body.model,
    messages: [
      { role: 'system', content: body.system },
      { role: 'user', content: body.user },
    ],
    max_tokens: 16,
    temperature: 0,
    usage: { include: true }, // makes OpenRouter return the real cost in usage.cost
    reasoning: { enabled: false }, // ignored by models without reasoning support
  };
}

/** Best-effort `error.message` from an upstream failure body. Never throws, never echoes headers. */
async function readUpstreamDetail(res: Response): Promise<string | undefined> {
  try {
    const data = (await res.json()) as { error?: { message?: unknown } } | null;
    const message = data?.error?.message;
    if (typeof message !== 'string') return undefined;
    return message.replace(/\s+/g, ' ').trim().slice(0, 200) || undefined;
  } catch {
    return undefined;
  }
}

export async function handleDecide(body: unknown, deps: DecideDeps): Promise<HandlerResult> {
  const b = body as Partial<DecideBody> | null;
  if (
    !b ||
    typeof b.model !== 'string' ||
    typeof b.system !== 'string' ||
    typeof b.user !== 'string' ||
    !MODEL_RE.test(b.model) ||
    b.user.length > 20000 ||
    b.system.length > 4000
  ) {
    return { status: 400, json: { error: 'invalid request' } };
  }
  if (!deps.apiKey) return { status: 500, json: { error: 'OPENROUTER_API_KEY is not set' } };
  if (deps.budget.exhausted()) return { status: 402, json: { error: 'budget exceeded' } };

  let upstream: Response;
  try {
    upstream = await deps.fetchImpl(OPENROUTER_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${deps.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(buildPayload(b as DecideBody)),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return { status: 502, json: { error: 'upstream unreachable' } };
  }
  if (upstream.status === 402) return { status: 402, json: { error: 'upstream credit exhausted' } };
  if (!upstream.ok) {
    const detail = await readUpstreamDetail(upstream);
    const error = `upstream ${upstream.status}`;
    return { status: 502, json: detail ? { error, detail } : { error } };
  }

  let data: {
    choices?: { message?: { content?: string } }[];
    usage?: { cost?: unknown };
  } | null;
  try {
    data = await upstream.json();
  } catch {
    return { status: 502, json: { error: 'upstream bad response' } };
  }
  if (typeof data !== 'object' || data === null) return { status: 502, json: { error: 'upstream bad response' } };
  const cost = data.usage?.cost;
  const known = typeof cost === 'number' && Number.isFinite(cost) && cost >= 0;
  const costUsd = known ? cost : FALLBACK_COST_USD;
  deps.budget.record(costUsd);
  const text = data.choices?.[0]?.message?.content ?? '';
  return { status: 200, json: known ? { text, costUsd } : { text, costUsd, costEstimated: true } };
}
