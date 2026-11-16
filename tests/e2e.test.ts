import { describe, expect, it } from 'vitest';
import { GreedyAgent, PlannerAgent, RandomAgent } from '../src/agents/baselines';
import { runPlan } from '../src/runner/run-plan';
import { makeScenario } from '../src/runner/scenarios';
import type { RunPlan } from '../src/runner/types';

const plan = (mode: RunPlan['mode']): RunPlan => ({
  mode,
  scenarios: [makeScenario('small', 'simple', 1), makeScenario('medium', 'complex', 2)],
  seeds: [1, 2],
  agents: [new RandomAgent('random', 'Random', 1), new GreedyAgent('greedy', 'Greedy'), new PlannerAgent('planner', 'Planner')],
  tickMs: 0,
  maxCallsPerGame: 400,
  maxTicks: 150,
});

describe('runPlan (offline, baselines only)', () => {
  it('benchmark mode runs every agent on every scenario and seed, deterministically', async () => {
    const a = await runPlan(plan('benchmark'));
    const b = await runPlan(plan('benchmark'));
    expect(a).toHaveLength(2 * 2 * 3);
    expect(a.every((r) => Number.isFinite(r.score) && r.costUsd === 0 && r.calls > 0)).toBe(true);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('arena mode runs one shared game per scenario and seed', async () => {
    const results = await runPlan(plan('arena'));
    expect(results).toHaveLength(2 * 2 * 3);
    const group = results.filter((r) => r.scenarioId === 'small-simple-1g' && r.seed === 1);
    expect(group.map((r) => r.agentId).sort()).toEqual(['greedy', 'planner', 'random']);
    expect(new Set(group.map((r) => r.level)).size).toBe(1); // shared maze, shared level
  });

  it('reports each game group through the hooks', async () => {
    const groups: number[] = [];
    const seen: string[] = [];
    await runPlan(plan('benchmark'), {
      onGroupStart: (g) => groups.push(g.sessions.length),
      onResult: (r) => seen.push(r.agentId),
    });
    expect(groups).toEqual([3, 3, 3, 3]);
    expect(seen).toHaveLength(12);
  });

  it('stops early and keeps partial results when aborted', async () => {
    const ctl = new AbortController();
    const out = await runPlan(plan('benchmark'), { onResult: () => ctl.abort() }, ctl.signal);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(12);
  });
});
