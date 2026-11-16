import type { Budget } from './budget';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
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
    });
  } catch {
    return { status: 502, json: { error: 'upstream unreachable' } };
  }
  if (!upstream.ok) return { status: 502, json: { error: `upstream ${upstream.status}` } };

  let data: {
    choices?: { message?: { content?: string } }[];
    usage?: { cost?: number };
  };
  try {
    data = await upstream.json();
  } catch {
    return { status: 502, json: { error: 'upstream bad response' } };
  }
  const costUsd = data.usage?.cost ?? 0;
  deps.budget.record(costUsd);
  return { status: 200, json: { text: data.choices?.[0]?.message?.content ?? '', costUsd } };
}
