import { describe, expect, it } from 'vitest';
import { groupKey, type RunMeta, type StoredRun } from '../src/ranking/rank';
import { buildRatings, ratingsToCsv, type RatingRow } from '../src/ranking/rating';
import type { GameResult } from '../src/runner/types';

const S1 = 'small-simple-1g';
const S2 = 'large-complex-2g';

const META: RunMeta = {
  mode: 'benchmark',
  tickMs: 150,
  maxTicks: 400,
  agents: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, label: `Model ${id.toUpperCase()}` })),
};
const key = groupKey(META);

const game = (agentId: string, scenarioId: string, seed: number, score: number, over: Partial<GameResult> = {}): GameResult => ({
  mode: 'benchmark',
  scenarioId,
  seed,
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
const rowOf = (rows: RatingRow[], id: string) => rows.find((r) => r.agentId === id)!;

/** `scores[id]` is the score of each model; every listed model plays seeds 1..n in S1. */
function many(scores: Record<string, number>, n = 5, scenario = S1): GameResult[] {
  return Array.from({ length: n }, (_, i) => Object.entries(scores).map(([id, s]) => game(id, scenario, i + 1, s))).flat();
}

describe('buildRatings', () => {
  it('rates a model that always wins above its opponent with low <= rating <= high', () => {
    const r = buildRatings([run('run-1', many({ a: 100, b: 10 }))], { settingsKey: key });
    expect(r.rows.map((x) => x.agentId)).toEqual(['a', 'b']);
    const [a, b] = r.rows;
    expect(a.rating).toBeGreaterThan(b.rating);
    expect(a.low).toBeLessThanOrEqual(a.rating);
    expect(a.rating).toBeLessThanOrEqual(a.high);
    expect(b.low).toBeLessThanOrEqual(b.rating);
    expect(b.rating).toBeLessThanOrEqual(b.high);
    expect(a).toMatchObject({ rank: 1, matches: 5, winRate: 1, games: 5, label: 'Model A' });
    expect(b).toMatchObject({ rank: 2, matches: 5, winRate: 0 });
    expect(r.matches).toBe(5);
  });

  it('rates identical models equal and near 1000', () => {
    const r = buildRatings([run('run-1', many({ a: 50, b: 50 }))], { settingsKey: key });
    expect(r.rows[0].rating).toBeCloseTo(r.rows[1].rating, 6);
    expect(r.rows[0].rating).toBeCloseTo(1000, 0);
    expect(r.rows.map((x) => x.rank)).toEqual([1, 1]);
    expect(r.rows[0].winRate).toBe(0.5);
  });

  it('orders a chain A beats B, B beats C and connects all three', () => {
    const r = buildRatings([run('run-1', many({ a: 90, b: 50, c: 10 }))], { settingsKey: key });
    expect(r.rows.map((x) => x.agentId)).toEqual(['a', 'b', 'c']);
    expect(r.notConnected).toEqual([]);
    expect(r.matches).toBe(15);
  });

  it('puts a disconnected pair in notConnected and rates the larger component', () => {
    const r = buildRatings(
      [run('run-1', [...many({ a: 90, b: 50, c: 10 }), ...many({ d: 5, e: 1 }, 5, S2)])],
      { settingsKey: key },
    );
    expect(r.rows.map((x) => x.agentId)).toEqual(['a', 'b', 'c']);
    expect(r.notConnected).toEqual([
      { agentId: 'd', label: 'Model D' },
      { agentId: 'e', label: 'Model E' },
    ]);
  });

  it('forms matches only within the same settings, scenario and seed', () => {
    const other: RunMeta = { ...META, maxTicks: 800 };
    const r = buildRatings(
      [
        run('run-1', [game('a', S1, 1, 10), game('b', S1, 2, 5), game('c', S2, 1, 5)]),
        run('run-2', [game('d', S1, 1, 3)], other),
      ],
      {},
    );
    expect(r.rows).toEqual([]);
    expect(r.matches).toBe(0);
    expect(r.notConnected.map((x) => x.agentId).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('averages a model\'s several games on the same scenario and seed into one match', () => {
    const r = buildRatings(
      [run('run-1', [game('a', S1, 1, 10), game('a', S1, 1, 30), game('b', S1, 1, 20)]), run('run-2', [game('a', S1, 1, 20)])],
      { settingsKey: key },
    );
    expect(r.matches).toBe(1);
    expect(rowOf(r.rows, 'a')).toMatchObject({ matches: 1, winRate: 0.5, games: 3 });
  });

  it('skips arena runs and counts their games', () => {
    const arena: RunMeta = { ...META, mode: 'arena' };
    const r = buildRatings(
      [
        run('run-1', many({ a: 9, b: 1 }, 2)),
        run('run-2', [game('a', S1, 1, 1, { mode: 'arena' }), game('b', S1, 1, 2, { mode: 'arena' }), game('b', 'bogus', 1, 2)], arena),
      ],
      {},
    );
    expect(r.arenaSkipped).toBe(2);
    expect(r.matches).toBe(2);
    expect(r.rows.map((x) => x.agentId)).toEqual(['a', 'b']);
  });

  it('ignores runs without metadata', () => {
    const r = buildRatings([run('run-0', many({ a: 9, b: 1 }), null)], {});
    expect(r.rows).toEqual([]);
    expect(r.arenaSkipped).toBe(0);
  });

  it('excludes truncated and connection-failure games but counts unparseable disqualifications', () => {
    const r = buildRatings(
      [
        run('run-1', [
          game('a', S1, 1, 10),
          game('b', S1, 1, 20),
          game('a', S1, 2, 10, { truncated: true }),
          game('b', S1, 2, 20),
          game('a', S1, 3, 10, { disqualified: true, lastError: 'network' }),
          game('b', S1, 3, 20),
          game('a', S1, 4, 10, { disqualified: true }),
          game('b', S1, 4, 20),
          game('a', S1, 5, 10, { disqualified: true, lastError: 'unparseable: "x"' }),
          game('b', S1, 5, 20),
          game('a', S1, 6, NaN),
          game('b', S1, 6, 20),
        ]),
      ],
      { settingsKey: key },
    );
    expect(r.truncatedExcluded).toBe(1);
    expect(r.connectionExcluded).toBe(2);
    expect(r.matches).toBe(2);
    expect(rowOf(r.rows, 'a').games).toBe(2);
  });

  it('gives unbeaten models a finite rating', () => {
    const r = buildRatings([run('run-1', many({ a: 100, b: 1, c: 0 }, 20))], { settingsKey: key });
    for (const row of r.rows) {
      expect(Number.isFinite(row.rating)).toBe(true);
      expect(Number.isFinite(row.low)).toBe(true);
      expect(Number.isFinite(row.high)).toBe(true);
    }
    expect(r.rows[0].agentId).toBe('a');
  });

  it('is deterministic', () => {
    const runs = [run('run-1', [...many({ a: 90, b: 50, c: 10 }), ...many({ a: 1, b: 2, c: 3 }, 3, S2)])];
    expect(buildRatings(runs, { settingsKey: key })).toEqual(buildRatings(runs, { settingsKey: key }));
  });

  it('filters by size and settings key', () => {
    const other: RunMeta = { ...META, maxTicks: 800 };
    const runs = [
      run('run-1', [...many({ a: 90, b: 10 }, 2, S1), ...many({ a: 1, b: 9 }, 3, S2)]),
      run('run-2', many({ c: 9, d: 1 }, 4), other),
    ];
    const small = buildRatings(runs, { settingsKey: key, sizes: ['small'] });
    expect(small.matches).toBe(2);
    expect(rowOf(small.rows, 'a').winRate).toBe(1);
    const large = buildRatings(runs, { settingsKey: key, sizes: ['large'] });
    expect(large.matches).toBe(3);
    expect(rowOf(large.rows, 'b').winRate).toBe(1);
    const second = buildRatings(runs, { settingsKey: groupKey(other) });
    expect(second.rows.map((x) => x.agentId)).toEqual(['c', 'd']);
    const all = buildRatings(runs, {});
    expect(all.matches).toBe(5);
    expect(all.notConnected.map((x) => x.agentId).sort()).toEqual(['c', 'd']);
  });

  it('reports survival, lives left, latency and cost per model', () => {
    const r = buildRatings(
      [run('run-1', [
        game('a', S1, 1, 500, { survivedTicks: 100, livesLeft: 1, avgLatencyMs: 100, costUsd: 0.5 }),
        game('a', S1, 2, 500, { survivedTicks: 300, livesLeft: 2, avgLatencyMs: 300, costUsd: 0.5 }),
        game('b', S1, 1, 0), game('b', S1, 2, 0),
      ])],
      { settingsKey: key },
    );
    expect(rowOf(r.rows, 'a')).toMatchObject({ meanSurvivedTicks: 200, meanLivesLeft: 1.5, meanLatencyMs: 200, totalCostUsd: 1 });
    expect(rowOf(r.rows, 'a').costPer1000Points).toBeCloseTo(1);
    expect(rowOf(r.rows, 'b').costPer1000Points).toBeNull();
  });
});

describe('ratingsToCsv', () => {
  it('writes the header and one formatted row', () => {
    const row: RatingRow = {
      rank: 1, agentId: 'a', label: 'Model, "A"', rating: 1234.56, low: 1100.4, high: 1300.5, matches: 12, winRate: 0.66667,
      games: 6, meanSurvivedTicks: 321.7, meanLivesLeft: 1.234, meanLatencyMs: 99.6, totalCostUsd: 0.12345, costPer1000Points: null,
    };
    const lines = ratingsToCsv([row]).split('\n');
    expect(lines[0]).toBe('rank,model,rating,low,high,matches,win_rate,games,survival_ticks,lives_left,mean_latency_ms,total_cost_usd,cost_per_1000_points');
    expect(lines[1]).toBe('1,"Model, ""A""",1235,1100,1301,12,0.667,6,322,1.23,100,0.1235,');
  });
});
