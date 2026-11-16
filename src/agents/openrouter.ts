import { SYSTEM_PROMPT } from './prompt';
import { parseDirection } from './parse';
import { BudgetExceededError, type Agent, type DecideContext, type Decision } from './types';

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
      });
    } catch {
      return fail('network');
    }
    const latencyMs = performance.now() - started;
    if (res.status === 402) throw new BudgetExceededError();
    if (!res.ok) return fail(`http ${res.status}`);

    let data: { text?: string; costUsd?: number };
    try {
      data = (await res.json()) as { text?: string; costUsd?: number };
    } catch {
      return fail('bad json');
    }
    const costUsd = data.costUsd ?? 0;
    const dir = parseDirection(data.text ?? '');
    return dir ? { dir, latencyMs, costUsd } : { dir: null, latencyMs, costUsd, error: 'unparseable' };
  }
}
