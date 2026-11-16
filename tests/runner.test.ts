import { describe, expect, it } from 'vitest';
import { aggregate, winners } from '../src/runner/aggregate';
import { estimateRun } from '../src/runner/estimate';
import { ALL_SCENARIOS, PRESETS, makeScenario, promptCostFactor, scenarioConfig } from '../src/runner/scenarios';
import type { GameResult } from '../src/runner/types';

const result = (over: Partial<GameResult>): GameResult => ({
  mode: 'benchmark',
  scenarioId: 's1',
  seed: 1,
  agentId: 'a',
  score: 100,
  level: 1,
  survivedTicks: 100,
  livesLeft: 0,
  calls: 10,
  errors: 0,
  avgLatencyMs: 100,
  costUsd: 0.01,
  disqualified: false,
  truncated: false,
  ...over,
});

describe('scenarios', () => {
  it('has 128 unique combinations', () => {
    expect(ALL_SCENARIOS).toHaveLength(128);
    expect(new Set(ALL_SCENARIOS.map((s) => s.id)).size).toBe(128);
    const ids = ALL_SCENARIOS.map((s) => s.id);
    expect(ids).toContain('small-simple-0g');
    expect(ids).toContain('huge-complex-2g');
    expect(ids).toContain('medium-labyrinth-1g-fog');
  });

  it('names and ids fog scenarios', () => {
    const s = makeScenario('small', 'labyrinth', 1, 'fog');
    expect(s).toMatchObject({ id: 'small-labyrinth-1g-fog', name: 'small, labyrinth, 1 ghost, fog', vision: 'fog' });
    expect(makeScenario('small', 'labyrinth', 1).vision).toBe('full');
    expect(makeScenario('small', 'labyrinth', 1).id).toBe('small-labyrinth-1g');
  });

  it('keeps the full preset to full vision and defines fogSweep', () => {
    expect(PRESETS.full).toHaveLength(64);
    expect(PRESETS.full.every((s) => s.vision === 'full')).toBe(true);
    expect(PRESETS.fogSweep).toHaveLength(6);
    expect(PRESETS.fogSweep.every((s) => s.vision === 'fog' && s.ghosts === 1)).toBe(true);
    expect(new Set(PRESETS.fogSweep.map((s) => s.size))).toEqual(new Set(['small', 'medium']));
    expect(new Set(PRESETS.fogSweep.map((s) => s.complexity))).toEqual(new Set(['simple', 'complex', 'labyrinth']));
  });

  it('sets the engine vision from the scenario', () => {
    expect(scenarioConfig(makeScenario('small', 'simple', 1, 'fog'), 1).vision).toBe(4);
    expect(scenarioConfig(makeScenario('small', 'simple', 1), 1).vision).toBeNull();
  });

  it('names 0 ghosts in the plural', () => {
    expect(makeScenario('small', 'simple', 0).name).toBe('small, simple, 0 ghosts');
    expect(makeScenario('small', 'simple', 1).name).toBe('small, simple, 1 ghost');
  });

  it('defines the noGhosts and huge presets', () => {
    expect(PRESETS.noGhosts.map((s) => s.id)).toEqual(['small-medium-0g', 'medium-medium-0g', 'large-medium-0g']);
    expect(PRESETS.huge.map((s) => s.id)).toEqual(['huge-simple-2g', 'huge-complex-2g']);
  });

  it('keeps sizeSweep to small, medium and large', () => {
    expect(PRESETS.sizeSweep.map((s) => s.id)).toEqual(['small-medium-2g', 'medium-medium-2g', 'large-medium-2g']);
  });

  it('scales the prompt cost factor with maze area', () => {
    expect(promptCostFactor(makeScenario('small', 'simple', 1))).toBe(1.7);
    expect(promptCostFactor(makeScenario('medium', 'simple', 1))).toBe(1.7);
    expect(promptCostFactor(makeScenario('large', 'simple', 1))).toBe(1.7);
    expect(promptCostFactor(makeScenario('huge', 'simple', 1))).toBeCloseTo(3.721);
  });

  it('builds a huge 0-ghost config', () => {
    expect(scenarioConfig(makeScenario('huge', 'simple', 0), 1)).toMatchObject({ width: 61, height: 61, ghostCount: 0 });
  });

  it('presets only reference known scenarios', () => {
    const ids = new Set(ALL_SCENARIOS.map((s) => s.id));
    for (const list of Object.values(PRESETS)) for (const s of list) expect(ids.has(s.id)).toBe(true);
    expect(PRESETS.default).toHaveLength(2);
  });

  it('builds an engine config from a scenario', () => {
    const cfg = scenarioConfig(makeScenario('large', 'complex', 4), 7, { maxTicks: 99 });
    expect(cfg).toMatchObject({
      width: 31,
      height: 31,
      complexity: 'complex',
      ghostCount: 4,
      ghostBehavior: 'mixed',
      seed: 7,
      lives: 3,
      maxTicks: 99,
    });
  });
});

describe('estimateRun', () => {
  it('returns a worst-case upper bound', () => {
    const e = estimateRun({
      scenarios: 2,
      seeds: 3,
      mode: 'benchmark',
      agentCount: 4,
      llmAgents: [{ estUsdPerCall: 0.001 }, { estUsdPerCall: 0.01 }],
      maxCallsPerGame: 100,
    });
    expect(e.games).toBe(24);
    expect(e.maxCalls).toBe(1200);
    expect(e.maxUsd).toBeCloseTo(6.6);
  });

  it('counts one game per scenario and seed in arena mode', () => {
    const e = estimateRun({
      scenarios: 2,
      seeds: 3,
      mode: 'arena',
      agentCount: 4,
      llmAgents: [{ estUsdPerCall: 0.01 }],
      maxCallsPerGame: 100,
    });
    expect(e.games).toBe(6);
    expect(e.maxCalls).toBe(600);
  });

  it('scales each scenario by its cost factor', () => {
    const e = estimateRun({
      scenarios: 2,
      seeds: 2,
      mode: 'benchmark',
      agentCount: 2,
      llmAgents: [{ estUsdPerCall: 0.01 }],
      maxCallsPerGame: 100,
      scenarioCostFactors: [1.7, 3.721],
    });
    expect(e.maxUsd).toBeCloseTo(2 * 100 * 0.01 * 5.421);
    expect(e.games).toBe(8);
    expect(e.maxCalls).toBe(400);
  });

  it('rejects a factor list of the wrong length', () => {
    expect(() =>
      estimateRun({
        scenarios: 2,
        seeds: 1,
        mode: 'arena',
        agentCount: 1,
        llmAgents: [],
        maxCallsPerGame: 1,
        scenarioCostFactors: [1],
      }),
    ).toThrow();
  });

  it('is free with no llm agents', () => {
    const e = estimateRun({ scenarios: 5, seeds: 5, mode: 'benchmark', agentCount: 3, llmAgents: [], maxCallsPerGame: 400 });
    expect(e).toEqual({ games: 75, maxCalls: 0, maxUsd: 0 });
  });
});

describe('aggregate and winners', () => {
  const results = [
    result({ agentId: 'a', seed: 1, score: 100, level: 1 }),
    result({ agentId: 'a', seed: 2, score: 300, level: 3, costUsd: 0.03 }),
    result({ agentId: 'b', seed: 1, score: 150, level: 2 }),
    result({ agentId: 'b', seed: 2, score: 150, level: 2 }),
    result({ agentId: 'a', scenarioId: 's2', score: 10 }),
    result({ agentId: 'b', scenarioId: 's2', score: 20 }),
  ];

  it('computes mean, population std, level, latency and total cost per agent and scenario', () => {
    const cells = aggregate(results);
    const a = cells.find((c) => c.agentId === 'a' && c.scenarioId === 's1')!;
    expect(a).toMatchObject({ games: 2, meanScore: 200, stdScore: 100, meanLevel: 2 });
    expect(a.totalCostUsd).toBeCloseTo(0.04);
    expect(cells.find((c) => c.agentId === 'b' && c.scenarioId === 's1')!.stdScore).toBe(0);
  });

  it('picks the highest mean score as the winner of each scenario', () => {
    expect(winners(aggregate(results))).toEqual({ s1: 'a', s2: 'b' });
  });

  describe('truncated games', () => {
    const mixed = [
      result({ agentId: 'a', seed: 1, score: 100, level: 1, costUsd: 0.01 }),
      result({ agentId: 'a', seed: 2, score: 900, level: 9, costUsd: 0.05, truncated: true }),
    ];

    it('leaves truncated games out of the means but keeps the total count', () => {
      const [c] = aggregate(mixed);
      expect(c).toMatchObject({ games: 2, completeGames: 1, truncatedGames: 1, meanScore: 100, stdScore: 0, meanLevel: 1 });
    });

    it('still counts the cost of truncated games', () => {
      expect(aggregate(mixed)[0].totalCostUsd).toBeCloseTo(0.06);
    });

    it('gives NaN means for a cell with no complete games, and it cannot win', () => {
      const cells = aggregate([
        result({ agentId: 'a', score: 900, truncated: true }),
        result({ agentId: 'b', score: 5 }),
      ]);
      const a = cells.find((c) => c.agentId === 'a')!;
      expect(a).toMatchObject({ games: 1, completeGames: 0, truncatedGames: 1 });
      expect(a.meanScore).toBeNaN();
      expect(a.stdScore).toBeNaN();
      expect(a.meanLatencyMs).toBeNaN();
      expect(winners(cells)).toEqual({ s1: 'b' });
    });
  });
});
