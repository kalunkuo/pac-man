import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Budget } from '../src/server/budget';
import { buildPayload, handleDecide } from '../src/server/decide';
import { listResults, saveResults } from '../src/server/results-store';

const okFetch = () =>
  vi.fn(
    async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'UP' } }], usage: { cost: 0.0004 } }), {
        status: 200,
      }),
  ) as unknown as typeof fetch;

const body = { model: 'vendor/model-1', system: 'sys', user: 'maze' };

describe('Budget', () => {
  it('is exhausted by money or by call count', () => {
    const b = new Budget(0.01, 3);
    expect(b.exhausted()).toBe(false);
    b.record(0.004);
    b.record(0.004);
    expect(b.exhausted()).toBe(false);
    b.record(0.004);
    expect(b.exhausted()).toBe(true);
    b.reset(10, 2);
    expect(b.exhausted()).toBe(false);
    b.record(0);
    b.record(0);
    expect(b.exhausted()).toBe(true);
    expect(b.snapshot()).toEqual({ budgetUsd: 10, maxCalls: 2, spentUsd: 0, calls: 2 });
  });
});

describe('buildPayload', () => {
  it('caps tokens, uses temperature 0 and asks for usage cost', () => {
    const p = buildPayload(body) as Record<string, unknown>;
    expect(p.model).toBe('vendor/model-1');
    expect(p.max_tokens).toBe(16);
    expect(p.temperature).toBe(0);
    expect(p.usage).toEqual({ include: true });
    expect(p.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'maze' },
    ]);
  });
});

describe('handleDecide', () => {
  it('forwards to OpenRouter with the key and records the cost', async () => {
    const fetchImpl = okFetch();
    const budget = new Budget(1, 100);
    const r = await handleDecide(body, { apiKey: 'sk-test', budget, fetchImpl });
    expect(r).toEqual({ status: 200, json: { text: 'UP', costUsd: 0.0004 } });
    expect(budget.spentUsd).toBeCloseTo(0.0004);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((init as RequestInit & { headers: Record<string, string> }).headers.authorization).toBe('Bearer sk-test');
  });

  it('rejects invalid bodies without calling upstream', async () => {
    const fetchImpl = okFetch();
    const deps = { apiKey: 'k', budget: new Budget(), fetchImpl };
    for (const bad of [null, {}, { ...body, model: 'no-slash' }, { ...body, user: 'x'.repeat(20001) }])
      expect((await handleDecide(bad, deps)).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns 500 when the key is missing and 402 when the budget is spent', async () => {
    const fetchImpl = okFetch();
    expect((await handleDecide(body, { apiKey: '', budget: new Budget(), fetchImpl })).status).toBe(500);
    const spent = new Budget(0.001, 10);
    spent.record(0.001);
    expect((await handleDecide(body, { apiKey: 'k', budget: spent, fetchImpl })).status).toBe(402);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps upstream failures to 502', async () => {
    const bad = vi.fn(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    expect((await handleDecide(body, { apiKey: 'k', budget: new Budget(), fetchImpl: bad })).status).toBe(502);
    const down = vi.fn(async () => {
      throw new Error('x');
    }) as unknown as typeof fetch;
    expect((await handleDecide(body, { apiKey: 'k', budget: new Budget(), fetchImpl: down })).status).toBe(502);
  });

  it('treats a missing usage cost as zero and a missing reply as empty text', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })) as unknown as typeof fetch;
    const r = await handleDecide(body, { apiKey: 'k', budget: new Budget(), fetchImpl: f });
    expect(r).toEqual({ status: 200, json: { text: '', costUsd: 0 } });
  });
});

describe('results store', () => {
  it('saves and lists runs, and rejects unsafe run ids', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pacman-results-'));
    try {
      expect(await listResults(join(dir, 'missing'))).toEqual([]);
      await saveResults(dir, 'run-1', [{ score: 5 }]);
      await saveResults(dir, 'run-2', []);
      expect(await listResults(dir)).toEqual([
        { runId: 'run-1', results: [{ score: 5 }] },
        { runId: 'run-2', results: [] },
      ]);
      await expect(saveResults(dir, '../evil', [])).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
