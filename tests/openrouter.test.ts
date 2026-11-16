import { describe, expect, it, vi } from 'vitest';
import { OpenRouterAgent } from '../src/agents/openrouter';
import { encodeObservation } from '../src/agents/observation';
import { BudgetExceededError, type DecideContext } from '../src/agents/types';
import { createGame } from '../src/engine/engine';
import { config } from './helpers';

function ctx(): DecideContext {
  const state = createGame(config(), ['a']);
  return { observation: encodeObservation(state, 'a'), state, playerId: 'a' };
}

const json = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

function agent(fetchImpl: typeof fetch) {
  return new OpenRouterAgent({ id: 'm', label: 'M', model: 'vendor/model', fetchImpl });
}

describe('OpenRouterAgent', () => {
  it('sends model, system prompt and observation to the proxy and parses the move', async () => {
    const fetchImpl = json({ text: 'LEFT', costUsd: 0.0002 });
    const c = ctx();
    const d = await agent(fetchImpl).decide(c);
    expect(d).toMatchObject({ dir: 'LEFT', costUsd: 0.0002 });
    expect(d.latencyMs).toBeGreaterThanOrEqual(0);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/decide');
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.model).toBe('vendor/model');
    expect(sent.user).toBe(c.observation.text);
    expect(sent.system).toContain('Pac-Man');
  });

  it('is an llm agent', () => {
    expect(agent(json({})).kind).toBe('llm');
  });

  it('throws BudgetExceededError on HTTP 402', async () => {
    await expect(agent(json({ error: 'budget exceeded' }, 402)).decide(ctx())).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
  });

  it('reports an error for unparseable replies', async () => {
    const d = await agent(json({ text: 'I am not sure', costUsd: 0.001 })).decide(ctx());
    expect(d).toMatchObject({ dir: null, error: 'unparseable: "I am not sure"', costUsd: 0.001 });
  });

  it('reports an error for HTTP failures and network failures', async () => {
    expect((await agent(json({ error: 'x' }, 502)).decide(ctx())).error).toBe('http 502: x');
    const boom = vi.fn(async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    expect((await agent(boom).decide(ctx())).error).toBe('network');
  });

  it('includes the proxy error and detail in http failures', async () => {
    const d = await agent(json({ error: 'upstream 404', detail: 'No endpoints found' }, 502)).decide(ctx());
    expect(d.error).toBe('http 502: upstream 404 - No endpoints found');
  });

  it('falls back to the bare status when the proxy reply is not JSON', async () => {
    const f = vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 })) as unknown as typeof fetch;
    expect((await agent(f).decide(ctx())).error).toBe('http 502');
  });

  it('quotes the first 60 characters of an unparseable reply, whitespace collapsed', async () => {
    const text = 'Let me   think\nabout this ' + 'x'.repeat(100);
    const d = await agent(json({ text, costUsd: 0.001 })).decide(ctx());
    expect(d.error).toBe(`unparseable: "${('Let me think about this ' + 'x'.repeat(100)).slice(0, 60)}"`);
  });

  it('labels an empty unparseable reply', async () => {
    expect((await agent(json({ text: '  ', costUsd: 0 })).decide(ctx())).error).toBe('unparseable: (empty reply)');
    expect((await agent(json({ costUsd: 0 })).decide(ctx())).error).toBe('unparseable: (empty reply)');
  });

  it('sends a timeout signal and maps a timeout to a network error', async () => {
    const fetchImpl = json({ text: 'UP', costUsd: 0 });
    await agent(fetchImpl).decide(ctx());
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const timedOut = vi.fn(async () => {
      throw new DOMException('timed out', 'TimeoutError');
    }) as unknown as typeof fetch;
    expect((await agent(timedOut).decide(ctx())).error).toBe('network');
  });
});
