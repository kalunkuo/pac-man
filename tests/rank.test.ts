import { describe, expect, it } from 'vitest';
import {
  buildRanking,
  groupKey,
  listGroups,
  parseScenarioId,
  toCsv,
  type RunMeta,
  type StoredRun,
} from '../src/ranking/rank';
import type { GameResult } from '../src/runner/types';

const S1 = 'small-simple-1g';
const S2 = 'large-complex-2g';

const META: RunMeta = {
  mode: 'benchmark',
  tickMs: 150,
  maxTicks: 400,
  agents: [
    { id: 'a', label: 'Model A' },
    { id: 'b', label: 'Model B' },
    { id: 'c', label: 'Model C' },
  ],
};

const game = (agentId: string, scenarioId: string, score: number, over: Partial<GameResult> = {}): GameResult => ({
  mode: 'benchmark',
  scenarioId,
  seed: 1,
  agentId,
  score,
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

const run = (runId: string, results: GameResult[], meta: RunMeta | null = META): StoredRun => ({ runId, meta, results });
const key = groupKey(META);
const rankOf = (r: ReturnType<typeof buildRanking>, id: string) => r.rows.find((x) => x.agentId === id);

describe('parseScenarioId', () => {
  it('parses valid ids and rejects others', () => {
    expect(parseScenarioId('large-complex-2g')).toEqual({ size: 'large', complexity: 'complex', ghosts: 2 });
    expect(parseScenarioId('huge-complex-2g')).toBeNull();
    expect(parseScenarioId('small-simple-3g')).toBeNull();
    expect(parseScenarioId('nonsense')).toBeNull();
  });
});

describe('listGroups', () => {
  it('groups runs by settings, newest first, and counts legacy runs without metadata', () => {
    const other: RunMeta = { ...META, tickMs: 300 };
    const out = listGroups([
      run('run-1', [game('a', S1, 1)]),
      run('run-2', [game('a', S1, 1), game('b', S1, 2)], other),
      run('run-3', [game('a', S1, 1)]),
      run('run-0', [game('a', S1, 1)], null),
    ]);
    expect(out.legacyRuns).toBe(1);
    // run-3 is the newest run of the first group, run-2 the newest of the second
    expect(out.groups.map((g) => g.key)).toEqual([key, groupKey(other)]);
    expect(out.groups[0]).toMatchObject({ key, runs: 2, games: 2 });
    expect(out.groups[0].label).toBe('benchmark · 150 ms ticks · 400 max ticks');
    expect(out.groups[1]).toMatchObject({ runs: 1, games: 2 });
  });
});

describe('buildRanking', () => {
  const base = [
    run('run-1', [
      game('a', S1, 100), game('b', S1, 80), game('c', S1, 50),
      game('a', S2, 90), game('b', S2, 95), game('c', S2, 10),
    ]),
  ];

  it('ranks by average rank across scenarios, ties share a rank and break by mean score', () => {
    const r = buildRanking(base, { settingsKey: key });
    expect(r.scenarios.sort()).toEqual([S2, S1].sort());
    expect(r.rows.map((x) => x.agentId)).toEqual(['a', 'b', 'c']);
    expect(rankOf(r, 'a')).toMatchObject({ rank: 1, avgRank: 1.5, wins: 1, scenarios: 2, games: 2 });
    expect(rankOf(r, 'b')).toMatchObject({ rank: 1, avgRank: 1.5, wins: 1 });
    expect(rankOf(r, 'c')).toMatchObject({ rank: 3, avgRank: 3, wins: 0 });
    expect(rankOf(r, 'a')!.meanScore).toBe(95);
    expect(rankOf(r, 'a')!.label).toBe('Model A');
  });

  it('with a single scenario the average rank equals the rank in that scenario', () => {
    const r = buildRanking(base, { settingsKey: key, sizes: ['small'] });
    expect(r.scenarios).toEqual([S1]);
    expect(r.rows.map((x) => [x.agentId, x.rank])).toEqual([['a', 1], ['b', 2], ['c', 3]]);
  });

  it('filters by complexity and ghost count', () => {
    expect(buildRanking(base, { settingsKey: key, complexities: ['complex'] }).scenarios).toEqual([S2]);
    expect(buildRanking(base, { settingsKey: key, ghosts: [1] }).scenarios).toEqual([S1]);
    expect(buildRanking(base, { settingsKey: key, ghosts: [4] }).rows).toEqual([]);
  });

  it('tied scores share the average of their positions', () => {
    const r = buildRanking([run('run-1', [game('a', S1, 50), game('b', S1, 50), game('c', S1, 10)])], { settingsKey: key });
    expect(rankOf(r, 'a')!.avgRank).toBe(1.5);
    expect(rankOf(r, 'b')!.avgRank).toBe(1.5);
    expect(rankOf(r, 'c')!.avgRank).toBe(3);
    expect(rankOf(r, 'a')!.wins).toBe(1);
    expect(rankOf(r, 'b')!.wins).toBe(1);
  });

  it('excludes truncated games and reports how many', () => {
    const r = buildRanking(
      [run('run-1', [game('a', S1, 100), game('b', S1, 80), game('b', S1, 9999, { truncated: true })])],
      { settingsKey: key },
    );
    expect(rankOf(r, 'b')!.meanScore).toBe(80);
    expect(r.truncatedExcluded).toBe(1);
    expect(r.games).toBe(2);
  });

  it('treats a missing truncated field (older results) as not truncated', () => {
    const old = game('a', S1, 10) as Partial<GameResult>;
    delete old.truncated;
    const r = buildRanking([run('run-1', [old as GameResult, game('b', S1, 5)])], { settingsKey: key });
    expect(r.games).toBe(2);
  });

  it('only combines runs with the same settings', () => {
    const other: RunMeta = { ...META, maxTicks: 800 };
    const r = buildRanking(
      [run('run-1', [game('a', S1, 100), game('b', S1, 80)]), run('run-2', [game('a', S1, 1), game('b', S1, 2)], other)],
      { settingsKey: key },
    );
    expect(rankOf(r, 'a')!.meanScore).toBe(100);
    expect(r.games).toBe(2);
  });

  it('puts models missing a considered scenario in notRanked with the missing count', () => {
    const r = buildRanking(
      [run('run-1', [game('a', S1, 100), game('b', S1, 80), game('a', S2, 90), game('b', S2, 95), game('c', S1, 70)])],
      { settingsKey: key },
    );
    expect(r.rows.map((x) => x.agentId).sort()).toEqual(['a', 'b']);
    expect(r.notRanked).toEqual([{ agentId: 'c', label: 'Model C', missing: 1 }]);
    expect(r.scenarios.sort()).toEqual([S2, S1].sort());
  });

  it('ignores scenarios where only one model has data', () => {
    const r = buildRanking([run('run-1', [game('a', S1, 100), game('b', S1, 80), game('a', S2, 90)])], { settingsKey: key });
    expect(r.scenarios).toEqual([S1]);
    expect(r.rows.map((x) => x.agentId)).toEqual(['a', 'b']);
  });

  it('computes cost per 1,000 points and returns null when the score sum is zero', () => {
    const r = buildRanking(
      [run('run-1', [game('a', S1, 500, { costUsd: 0.5 }), game('b', S1, 0, { costUsd: 0.2 })])],
      { settingsKey: key },
    );
    expect(rankOf(r, 'a')!.costPer1000Points).toBeCloseTo(1);
    expect(rankOf(r, 'a')!.totalCostUsd).toBeCloseTo(0.5);
    expect(rankOf(r, 'b')!.costPer1000Points).toBeNull();
  });

  it('averages level and latency per game', () => {
    const r = buildRanking(
      [run('run-1', [game('a', S1, 10, { level: 1, avgLatencyMs: 100 }), game('a', S1, 30, { level: 3, avgLatencyMs: 300 }), game('b', S1, 1)])],
      { settingsKey: key },
    );
    expect(rankOf(r, 'a')).toMatchObject({ meanScore: 20, meanLevel: 2, meanLatencyMs: 200, games: 2 });
  });

  it('returns nothing ranked when fewer than two models share a scenario', () => {
    const r = buildRanking([run('run-1', [game('a', S1, 10)])], { settingsKey: key });
    expect(r.rows).toEqual([]);
    expect(r.scenarios).toEqual([]);
    expect(r.notRanked).toEqual([{ agentId: 'a', label: 'Model A', missing: 0 }]);
  });
});

describe('toCsv', () => {
  it('writes a header, formatted numbers, empty for null, and quotes labels with commas', () => {
    const r = buildRanking([run('run-1', [game('a', S1, 500, { costUsd: 0.5 }), game('b', S1, 0)], { ...META, agents: [{ id: 'a', label: 'Model, "A"' }, { id: 'b', label: 'Model B' }] })], { settingsKey: key });
    const lines = toCsv(r.rows).split('\n');
    expect(lines[0]).toBe('rank,model,avg_rank,scenarios,wins,games,mean_score,mean_level,mean_latency_ms,total_cost_usd,cost_per_1000_points');
    expect(lines[1]).toBe('1,"Model, ""A""",1.00,1,1,1,500.0,1.0,100,0.5000,1.0000');
    expect(lines[2]).toBe('2,Model B,2.00,1,0,1,0.0,1.0,100,0.0100,');
  });
});
