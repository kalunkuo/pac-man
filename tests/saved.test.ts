import { describe, expect, it } from 'vitest';
import { ALL_SCENARIOS } from '../src/runner/scenarios';
import { restoreRun } from '../src/ui/saved';

const game = (over: Record<string, unknown> = {}) => ({
  mode: 'benchmark',
  scenarioId: ALL_SCENARIOS[0].id,
  seed: 1,
  agentId: 'a',
  score: 10,
  level: 1,
  survivedTicks: 5,
  livesLeft: 0,
  calls: 1,
  errors: 0,
  avgLatencyMs: 1,
  costUsd: 0,
  disqualified: false,
  truncated: false,
  ...over,
});

describe('restoreRun', () => {
  it('restores a run saved with meta', () => {
    const scenario = ALL_SCENARIOS[3];
    const stored = {
      meta: {
        savedAt: '2026-11-15T00:00:00.000Z',
        mode: 'arena',
        maxTicks: 400,
        tickMs: 150,
        agents: [{ id: 'a', label: 'Model A' }],
        scenarios: [scenario],
      },
      results: [game({ scenarioId: scenario.id, truncated: true })],
    };
    const r = restoreRun(stored)!;
    expect(r.agents).toEqual([{ id: 'a', label: 'Model A' }]);
    expect(r.scenarios).toEqual([scenario]);
    expect(r.results).toHaveLength(1);
    expect(r.results[0].truncated).toBe(true);
  });

  it('restores a bare legacy array, deriving agents and scenarios and defaulting truncated to false', () => {
    const s0 = ALL_SCENARIOS[0];
    const s1 = ALL_SCENARIOS[1];
    const legacy = [
      game({ agentId: 'x', scenarioId: s1.id, truncated: undefined }),
      game({ agentId: 'y', scenarioId: s0.id, truncated: undefined }),
      game({ agentId: 'x', scenarioId: s0.id, truncated: undefined }),
    ];
    const r = restoreRun(legacy)!;
    expect(r.agents).toEqual([
      { id: 'x', label: 'x' },
      { id: 'y', label: 'y' },
    ]);
    expect(r.scenarios).toEqual([s1, s0]);
    expect(r.results.every((g) => g.truncated === false)).toBe(true);
  });

  it('defaults truncated to false for meta runs that lack it', () => {
    const stored = { meta: { agents: [{ id: 'a', label: 'A' }], scenarios: [ALL_SCENARIOS[0]] }, results: [game({ truncated: undefined })] };
    expect(restoreRun(stored)!.results[0].truncated).toBe(false);
  });

  it('returns null for garbage', () => {
    for (const bad of [null, undefined, 42, 'x', {}, { meta: {} }, { results: 'no' }, [1, 2], [{ foo: 1 }], { meta: {}, results: [null] }]) {
      expect(restoreRun(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
