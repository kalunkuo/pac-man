import { makeRng } from '../engine/rng';
import {
  csvEscape,
  groupKey,
  hasFiniteNumbers,
  isConnectionFailure,
  parseScenarioId,
  type RankFilter,
  type StoredRun,
} from './rank';

export interface RatingRow {
  rank: number;
  agentId: string;
  label: string;
  rating: number;
  low: number;
  high: number;
  matches: number;
  winRate: number;
  games: number;
  meanSurvivedTicks: number;
  meanLivesLeft: number;
  meanLatencyMs: number;
  totalCostUsd: number;
  costPer1000Points: number | null;
}

export interface Ratings {
  rows: RatingRow[];
  /** Models with counted games that never shared a scenario and seed with the rated group. */
  notConnected: { agentId: string; label: string }[];
  matches: number;
  truncatedExcluded: number;
  connectionExcluded: number;
  arenaSkipped: number;
}

const BOOTSTRAP_RESAMPLES = 200;
const BOOTSTRAP_SEED = 12345;
const MAX_ITERATIONS = 500;
const TOLERANCE = 1e-10;

/** One head-to-head match between model indexes i and j. `win` is i's share: 1, 0.5 or 0. */
interface Match {
  i: number;
  j: number;
  win: number;
}

interface Stats {
  n: number;
  score: number;
  survived: number;
  lives: number;
  latency: number;
  cost: number;
}

/**
 * Bradley-Terry strengths by the MM update. A draw is half a win to each side. A virtual draw against
 * an average opponent (strength 1) keeps unbeaten and winless models finite. Models that appear in
 * `matches` are normalized to a geometric mean of 1; the others stay at 1.
 */
function fitStrengths(modelCount: number, matches: Match[]): number[] {
  const pairs = Array.from({ length: modelCount }, () => new Array<number>(modelCount).fill(0));
  const wins = new Array<number>(modelCount).fill(0.5);
  const present = new Array<boolean>(modelCount).fill(false);
  for (const m of matches) {
    pairs[m.i][m.j]++;
    pairs[m.j][m.i]++;
    wins[m.i] += m.win;
    wins[m.j] += 1 - m.win;
    present[m.i] = true;
    present[m.j] = true;
  }
  const ids = present.flatMap((p, k) => (p ? [k] : []));
  let p = new Array<number>(modelCount).fill(1);
  if (ids.length === 0) return p;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const next = p.slice();
    for (const i of ids) {
      let denom = 1 / (p[i] + 1);
      for (const j of ids) if (j !== i && pairs[i][j] > 0) denom += pairs[i][j] / (p[i] + p[j]);
      next[i] = wins[i] / denom;
    }
    const scale = Math.exp(ids.reduce((sum, k) => sum + Math.log(next[k]), 0) / ids.length);
    let change = 0;
    for (const k of ids) {
      next[k] /= scale;
      change = Math.max(change, Math.abs(next[k] - p[k]) / p[k]);
    }
    p = next;
    if (change < TOLERANCE) break;
  }
  return p;
}

const toRating = (strength: number): number => 1000 + 400 * Math.log10(strength);

/** Nearest-rank percentile of an ascending list. */
function percentile(sorted: number[], q: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx];
}

export function buildRatings(runs: StoredRun[], filter: Omit<RankFilter, 'settingsKey'> & { settingsKey?: string }): Ratings {
  const labels = new Map<string, string>();
  const stats = new Map<string, Stats>();
  const groups = new Map<string, Map<string, { sum: number; n: number }>>(); // match key -> agent -> scores
  let truncatedExcluded = 0;
  let connectionExcluded = 0;
  let arenaSkipped = 0;

  const inScenario = (id: string): boolean => {
    const sc = parseScenarioId(id);
    return (
      sc !== null &&
      (!filter.sizes?.length || filter.sizes.includes(sc.size)) &&
      (!filter.complexities?.length || filter.complexities.includes(sc.complexity)) &&
      (!filter.ghosts?.length || filter.ghosts.includes(sc.ghosts))
    );
  };

  for (const run of [...runs].sort((a, b) => a.runId.localeCompare(b.runId))) {
    if (!run.meta) continue;
    const gk = groupKey(run.meta);
    if (filter.settingsKey !== undefined && gk !== filter.settingsKey) continue;
    if (run.meta.mode !== 'benchmark') {
      arenaSkipped += run.results.filter((r) => inScenario(r.scenarioId)).length;
      continue;
    }
    for (const a of run.meta.agents) labels.set(a.id, a.label);
    for (const r of run.results) {
      if (!inScenario(r.scenarioId) || !hasFiniteNumbers(r)) continue;
      if (r.truncated === true) {
        truncatedExcluded++;
        continue;
      }
      if (isConnectionFailure(r)) {
        connectionExcluded++;
        continue;
      }
      const s = stats.get(r.agentId) ?? { n: 0, score: 0, survived: 0, lives: 0, latency: 0, cost: 0 };
      s.n++;
      s.score += r.score;
      s.survived += r.survivedTicks;
      s.lives += r.livesLeft;
      s.latency += r.avgLatencyMs;
      s.cost += r.costUsd;
      stats.set(r.agentId, s);

      const mk = `${gk}|${r.scenarioId}|${r.seed}`;
      const g = groups.get(mk) ?? new Map<string, { sum: number; n: number }>();
      const cell = g.get(r.agentId) ?? { sum: 0, n: 0 };
      cell.sum += r.score;
      cell.n++;
      g.set(r.agentId, cell);
      groups.set(mk, g);
    }
  }

  const labelOf = (id: string) => labels.get(id) ?? id;
  const agentIds = [...stats.keys()].sort();
  const index = new Map(agentIds.map((id, k) => [id, k]));

  const allMatches: Match[] = [];
  for (const g of groups.values()) {
    const entries = [...g.entries()].map(([id, c]) => ({ k: index.get(id)!, score: c.sum / c.n })).sort((a, b) => a.k - b.k);
    for (let x = 0; x < entries.length; x++) {
      for (let y = x + 1; y < entries.length; y++) {
        const a = entries[x];
        const b = entries[y];
        allMatches.push({ i: a.k, j: b.k, win: a.score > b.score ? 1 : a.score < b.score ? 0 : 0.5 });
      }
    }
  }

  // Largest connected component of models linked by matches (ties: the one with the first agent id).
  const parent = agentIds.map((_, k) => k);
  const find = (k: number): number => (parent[k] === k ? k : (parent[k] = find(parent[k])));
  for (const m of allMatches) parent[find(m.i)] = find(m.j);
  const components = new Map<number, Set<number>>();
  for (const m of allMatches) {
    for (const k of [m.i, m.j]) {
      const root = find(k);
      components.set(root, (components.get(root) ?? new Set<number>()).add(k));
    }
  }
  let best: number[] = [];
  for (const set of components.values()) {
    const comp = [...set].sort((a, b) => a - b); // indexes follow sorted agent ids
    if (comp.length > best.length || (comp.length === best.length && comp[0] < best[0])) best = comp;
  }
  const inBest = new Set(best);
  const notConnected = agentIds.flatMap((id, k) => (inBest.has(k) ? [] : [{ agentId: id, label: labelOf(id) }]));
  const matches = allMatches.filter((m) => inBest.has(m.i));

  const base: Ratings = { rows: [], notConnected, matches: 0, truncatedExcluded, connectionExcluded, arenaSkipped };
  if (matches.length === 0) return base;

  const strengths = fitStrengths(agentIds.length, matches);

  const rng = makeRng(BOOTSTRAP_SEED);
  const samples = agentIds.map(() => [] as number[]);
  for (let b = 0; b < BOOTSTRAP_RESAMPLES; b++) {
    const resample = matches.map(() => matches[Math.floor(rng() * matches.length)]);
    const fit = fitStrengths(agentIds.length, resample);
    for (const k of best) samples[k].push(toRating(fit[k]));
  }

  const tally = new Map<number, { wins: number; n: number }>();
  const bump = (k: number, share: number) => {
    const t = tally.get(k) ?? { wins: 0, n: 0 };
    t.wins += share;
    t.n++;
    tally.set(k, t);
  };
  for (const m of matches) {
    bump(m.i, m.win);
    bump(m.j, 1 - m.win);
  }

  const unsorted = best.map((k) => {
    const id = agentIds[k];
    const s = stats.get(id)!;
    const t = tally.get(k)!;
    const rating = toRating(strengths[k]);
    const sorted = samples[k].sort((x, y) => x - y);
    return {
      agentId: id,
      label: labelOf(id),
      rating,
      // Resampled percentiles can miss the point estimate on small data; keep the range around it.
      low: Math.min(rating, percentile(sorted, 0.025)),
      high: Math.max(rating, percentile(sorted, 0.975)),
      matches: t.n,
      winRate: t.wins / t.n,
      games: s.n,
      meanSurvivedTicks: s.survived / s.n,
      meanLivesLeft: s.lives / s.n,
      meanLatencyMs: s.latency / s.n,
      totalCostUsd: s.cost,
      costPer1000Points: s.score > 0 ? s.cost / (s.score / 1000) : null,
    };
  });

  unsorted.sort((a, b) => b.rating - a.rating || a.label.localeCompare(b.label));
  const round = (v: number) => v.toFixed(6);
  const rows: RatingRow[] = unsorted.map((row) => ({
    ...row,
    rank: unsorted.findIndex((x) => round(x.rating) === round(row.rating)) + 1,
  }));

  return { ...base, rows, matches: matches.length };
}

export function ratingsToCsv(rows: RatingRow[]): string {
  const head = [
    'rank', 'model', 'rating', 'low', 'high', 'matches', 'win_rate', 'games',
    'survival_ticks', 'lives_left', 'mean_latency_ms', 'total_cost_usd', 'cost_per_1000_points',
  ];
  const lines = rows.map((r) =>
    [
      r.rank, r.label, r.rating.toFixed(0), r.low.toFixed(0), r.high.toFixed(0), r.matches, r.winRate.toFixed(3), r.games,
      r.meanSurvivedTicks.toFixed(0), r.meanLivesLeft.toFixed(2), r.meanLatencyMs.toFixed(0),
      r.totalCostUsd.toFixed(4), r.costPer1000Points === null ? null : r.costPer1000Points.toFixed(4),
    ]
      .map(csvEscape)
      .join(','),
  );
  return [head.join(','), ...lines].join('\n');
}
