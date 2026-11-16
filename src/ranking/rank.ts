import type { Complexity } from '../engine/types';
import type { SizeKey } from '../runner/scenarios';
import type { GameResult } from '../runner/types';

export interface RunMeta {
  mode: string;
  tickMs: number;
  maxTicks: number;
  agents: { id: string; label: string }[];
}

export interface StoredRun {
  runId: string;
  /** Null for runs saved before metadata existed; they cannot be grouped. */
  meta: RunMeta | null;
  results: GameResult[];
}

export interface SettingsGroup {
  key: string;
  label: string;
  runs: number;
  games: number;
}

export interface RankFilter {
  settingsKey: string;
  /** Empty or undefined means no filter. */
  sizes?: SizeKey[];
  complexities?: Complexity[];
  ghosts?: number[];
}

export interface RankRow {
  rank: number;
  agentId: string;
  label: string;
  avgRank: number;
  scenarios: number;
  wins: number;
  games: number;
  meanScore: number;
  meanLevel: number;
  meanLatencyMs: number;
  totalCostUsd: number;
  costPer1000Points: number | null;
}

export interface NotRanked {
  agentId: string;
  label: string;
  /** Considered scenarios this model has no completed games in. */
  missing: number;
}

export interface Ranking {
  rows: RankRow[];
  notRanked: NotRanked[];
  /** Scenario ids that were ranked on (at least 2 models have completed games). */
  scenarios: string[];
  games: number;
  truncatedExcluded: number;
}

const SCENARIO_RE = /^(small|medium|large)-(simple|medium|complex)-(1|2|4)g$/;

export function parseScenarioId(id: string): { size: SizeKey; complexity: Complexity; ghosts: number } | null {
  const m = SCENARIO_RE.exec(id);
  return m ? { size: m[1] as SizeKey, complexity: m[2] as Complexity, ghosts: Number(m[3]) } : null;
}

export function groupKey(m: RunMeta): string {
  return `${m.mode}|${m.tickMs}|${m.maxTicks}`;
}

function groupLabel(m: RunMeta): string {
  return `${m.mode} · ${m.tickMs} ms ticks · ${m.maxTicks} max ticks`;
}

/** Settings groups present in the stored runs, newest first (run ids are `run-<timestamp>`). */
export function listGroups(runs: StoredRun[]): { groups: SettingsGroup[]; legacyRuns: number } {
  const groups = new Map<string, SettingsGroup & { latest: string }>();
  let legacyRuns = 0;
  for (const run of runs) {
    if (!run.meta) {
      legacyRuns++;
      continue;
    }
    const k = groupKey(run.meta);
    const g = groups.get(k) ?? { key: k, label: groupLabel(run.meta), runs: 0, games: 0, latest: '' };
    g.runs++;
    g.games += run.results.length;
    if (run.runId > g.latest) g.latest = run.runId;
    groups.set(k, g);
  }
  const sorted = [...groups.values()].sort((a, b) => b.latest.localeCompare(a.latest));
  return { groups: sorted.map(({ latest: _latest, ...g }) => g), legacyRuns };
}

interface Acc {
  n: number;
  score: number;
  level: number;
  latency: number;
  cost: number;
}

const emptyAcc = (): Acc => ({ n: 0, score: 0, level: 0, latency: 0, cost: 0 });

function matches(sc: { size: SizeKey; complexity: Complexity; ghosts: number }, f: RankFilter): boolean {
  return (
    (!f.sizes?.length || f.sizes.includes(sc.size)) &&
    (!f.complexities?.length || f.complexities.includes(sc.complexity)) &&
    (!f.ghosts?.length || f.ghosts.includes(sc.ghosts))
  );
}

/** Rank positions (1 = best) for descending scores. Ties share the average of their positions. */
function rankScores(scores: { id: string; score: number }[]): Map<string, number> {
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const out = new Map<string, number>();
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].score === sorted[i].score) j++;
    const avg = (i + 1 + (j + 1)) / 2;
    for (let k = i; k <= j; k++) out.set(sorted[k].id, avg);
    i = j + 1;
  }
  return out;
}

export function buildRanking(runs: StoredRun[], filter: RankFilter): Ranking {
  const labels = new Map<string, string>();
  const cells = new Map<string, Map<string, Acc>>(); // agent -> scenario -> totals
  let games = 0;
  let truncatedExcluded = 0;

  for (const run of [...runs].sort((a, b) => a.runId.localeCompare(b.runId))) {
    if (!run.meta || groupKey(run.meta) !== filter.settingsKey) continue;
    for (const a of run.meta.agents) labels.set(a.id, a.label);
    for (const r of run.results) {
      const sc = parseScenarioId(r.scenarioId);
      if (!sc || !matches(sc, filter)) continue;
      if (r.truncated === true) {
        truncatedExcluded++;
        continue;
      }
      games++;
      const perScenario = cells.get(r.agentId) ?? new Map<string, Acc>();
      const acc = perScenario.get(r.scenarioId) ?? emptyAcc();
      acc.n++;
      acc.score += r.score;
      acc.level += r.level;
      acc.latency += r.avgLatencyMs;
      acc.cost += r.costUsd;
      perScenario.set(r.scenarioId, acc);
      cells.set(r.agentId, perScenario);
    }
  }

  const labelOf = (id: string) => labels.get(id) ?? id;

  const coverage = new Map<string, number>();
  for (const perScenario of cells.values()) for (const s of perScenario.keys()) coverage.set(s, (coverage.get(s) ?? 0) + 1);
  const considered = [...coverage.entries()].filter(([, n]) => n >= 2).map(([s]) => s).sort();

  const rankedIds: string[] = [];
  const notRanked: NotRanked[] = [];
  for (const [agentId, perScenario] of [...cells.entries()].sort(([x], [y]) => x.localeCompare(y))) {
    const missing = considered.filter((s) => !perScenario.has(s)).length;
    if (considered.length > 0 && missing === 0) rankedIds.push(agentId);
    else notRanked.push({ agentId, label: labelOf(agentId), missing });
  }

  const rankSums = new Map<string, number>(rankedIds.map((id) => [id, 0]));
  const wins = new Map<string, number>(rankedIds.map((id) => [id, 0]));
  for (const s of considered) {
    const scores = rankedIds.map((id) => {
      const a = cells.get(id)!.get(s)!;
      return { id, score: a.score / a.n };
    });
    const ranks = rankScores(scores);
    const best = Math.max(...scores.map((x) => x.score));
    for (const { id, score } of scores) {
      rankSums.set(id, rankSums.get(id)! + ranks.get(id)!);
      if (score === best) wins.set(id, wins.get(id)! + 1);
    }
  }

  const unsorted = rankedIds.map((agentId) => {
    const total = emptyAcc();
    for (const s of considered) {
      const a = cells.get(agentId)!.get(s)!;
      total.n += a.n;
      total.score += a.score;
      total.level += a.level;
      total.latency += a.latency;
      total.cost += a.cost;
    }
    return {
      agentId,
      label: labelOf(agentId),
      avgRank: rankSums.get(agentId)! / considered.length,
      scenarios: considered.length,
      wins: wins.get(agentId)!,
      games: total.n,
      meanScore: total.score / total.n,
      meanLevel: total.level / total.n,
      meanLatencyMs: total.latency / total.n,
      totalCostUsd: total.cost,
      costPer1000Points: total.score > 0 ? total.cost / (total.score / 1000) : null,
    };
  });

  unsorted.sort((a, b) => a.avgRank - b.avgRank || b.meanScore - a.meanScore || a.label.localeCompare(b.label));
  const rows: RankRow[] = unsorted.map((row, i) => {
    const firstEqual = unsorted.findIndex((x) => x.avgRank === row.avgRank);
    return { ...row, rank: firstEqual + 1 };
  });

  return { rows, notRanked, scenarios: considered, games, truncatedExcluded };
}

export function toCsv(rows: RankRow[]): string {
  const esc = (v: string | number | null): string => {
    const s = v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = [
    'rank', 'model', 'avg_rank', 'scenarios', 'wins', 'games',
    'mean_score', 'mean_level', 'mean_latency_ms', 'total_cost_usd', 'cost_per_1000_points',
  ];
  const lines = rows.map((r) =>
    [
      r.rank, r.label, r.avgRank.toFixed(2), r.scenarios, r.wins, r.games,
      r.meanScore.toFixed(1), r.meanLevel.toFixed(1), r.meanLatencyMs.toFixed(0),
      r.totalCostUsd.toFixed(4), r.costPer1000Points === null ? null : r.costPer1000Points.toFixed(4),
    ]
      .map(esc)
      .join(','),
  );
  return [head.join(','), ...lines].join('\n');
}
