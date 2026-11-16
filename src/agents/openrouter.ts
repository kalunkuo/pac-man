import { SYSTEM_PROMPT } from './prompt';
import { parseDirection } from './parse';
import { BudgetExceededError, type Agent, type DecideContext, type Decision } from './types';

const REQUEST_TIMEOUT_MS = 30_000;

export interface OpenRouterAgentOptions {
  id: string;
  label: string;
  /** OpenRouter model id, for example `vendor/model-name` */
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** Asks a model for a move through the local proxy, which holds the API key and the budget. */
export class OpenRouterAgent implements Agent {
  readonly kind = 'llm' as const;
  readonly id: string;
  readonly label: string;

  constructor(private readonly opts: OpenRouterAgentOptions) {
    this.id = opts.id;
    this.label = opts.label;
  }

  async decide({ observation }: DecideContext): Promise<Decision> {
    const doFetch = this.opts.fetchImpl ?? fetch;
    const started = performance.now();
    const fail = (error: string, costUsd = 0): Decision => ({
      dir: null,
      latencyMs: performance.now() - started,
      costUsd,
      error,
    });

    let res: Response;
    try {
      res = await doFetch(`${this.opts.baseUrl ?? ''}/api/decide`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.opts.model, system: SYSTEM_PROMPT, user: observation.text }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return fail('network');
    }
    const latencyMs = performance.now() - started;
    if (res.status === 402) throw new BudgetExceededError();
    if (!res.ok) {
      let reason = `http ${res.status}`;
      try {
        const body = (await res.json()) as { error?: unknown; detail?: unknown } | null;
        if (typeof body?.error === 'string') reason += `: ${body.error}`;
        if (typeof body?.detail === 'string' && body.detail) reason += ` - ${body.detail}`;
      } catch {
        // not JSON: keep the bare status
      }
      return fail(reason);
    }

    let data: { text?: string; costUsd?: number };
    try {
      data = (await res.json()) as { text?: string; costUsd?: number };
    } catch {
      return fail('bad json');
    }
    const costUsd = data.costUsd ?? 0;
    const dir = parseDirection(data.text ?? '');
    if (dir) return { dir, latencyMs, costUsd };
    const snippet = (data.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    return { dir: null, latencyMs, costUsd, error: snippet ? `unparseable: "${snippet}"` : 'unparseable: (empty reply)' };
  }
}
