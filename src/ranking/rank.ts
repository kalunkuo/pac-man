import type { Complexity } from '../engine/types';
import type { SizeKey, VisionKey } from '../runner/scenarios';
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
  visions?: VisionKey[];
}

export interface RankRow {
  rank: number;
  agentId: string;
  label: string;
  avgRank: number;
  scenarios: number;
  wins: number;
  games: number;
  meanSurvivedTicks: number;
  meanLivesLeft: number;
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
  /** Scenario ids that were ranked on (largest block of overlapping data, see the ranking spec). */
  scenarios: string[];
  games: number;
  truncatedExcluded: number;
  connectionExcluded: number;
}

const SCENARIO_RE = /^(small|medium|large|huge)-(simple|medium|complex|labyrinth)-(0|1|2|4)g(-fog)?$/;

export interface ParsedScenario {
  size: SizeKey;
  complexity: Complexity;
  ghosts: number;
  vision: VisionKey;
}

export function parseScenarioId(id: string): ParsedScenario | null {
  const m = SCENARIO_RE.exec(id);
  return m
    ? { size: m[1] as SizeKey, complexity: m[2] as Complexity, ghosts: Number(m[3]), vision: m[4] ? 'fog' : 'full' }
    : null;
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
  survived: number;
  lives: number;
  level: number;
  latency: number;
  cost: number;
}

const emptyAcc = (): Acc => ({ n: 0, score: 0, survived: 0, lives: 0, level: 0, latency: 0, cost: 0 });

/**
 * A game that ended because the model could not be reached or set up, not because it played badly.
 * Models that answered but gave no usable move (`unparseable`, `no move`) still count. Older results
 * have no `lastError`, so a disqualified game without one is treated as a connection failure.
 */
export function isConnectionFailure(r: GameResult): boolean {
  return r.disqualified && !/^(unparseable|no move)/.test(r.lastError ?? '');
}

/** Games with a non-finite number are skipped entirely, so they cannot distort any mean. */
export function hasFiniteNumbers(r: GameResult): boolean {
  return [r.score, r.level, r.survivedTicks, r.livesLeft, r.avgLatencyMs, r.costUsd].every(Number.isFinite);
}

export function scenarioMatches(sc: ParsedScenario, f: Omit<RankFilter, 'settingsKey'>): boolean {
  return (
    (!f.sizes?.length || f.sizes.includes(sc.size)) &&
    (!f.complexities?.length || f.complexities.includes(sc.complexity)) &&
    (!f.ghosts?.length || f.ghosts.includes(sc.ghosts)) &&
    (!f.visions?.length || f.visions.includes(sc.vision))
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

/**
 * Largest block of overlapping data: scenarios S and the models covering all of S, maximizing
 * |models| x |S| (at least 2 models and 1 scenario). Candidates are each model's covered set and
 * every pairwise intersection. Ties go to more models, then the lexicographically first list.
 */
function chooseBlock(cells: Map<string, Map<string, Acc>>): { scenarios: string[]; modelIds: string[] } {
  const covered = [...cells.entries()].map(([id, per]) => ({ id, set: new Set(per.keys()) }));
  const candidates = new Map<string, string[]>(); // joined sorted list -> list
  const add = (set: Iterable<string>) => {
    const list = [...set].sort();
    if (list.length > 0) candidates.set(list.join(','), list);
  };
  for (const [i, m] of covered.entries()) {
    add(m.set);
    for (const n of covered.slice(i + 1)) add([...m.set].filter((s) => n.set.has(s)));
  }

  let best: { key: string; scenarios: string[]; modelIds: string[] } | null = null;
  for (const [candKey, scenarios] of candidates) {
    const modelIds = covered.filter((m) => scenarios.every((s) => m.set.has(s))).map((m) => m.id);
    if (modelIds.length < 2) continue;
    const better =
      !best ||
      modelIds.length * scenarios.length > best.modelIds.length * best.scenarios.length ||
      (modelIds.length * scenarios.length === best.modelIds.length * best.scenarios.length &&
        (modelIds.length > best.modelIds.length || (modelIds.length === best.modelIds.length && candKey < best.key)));
    if (better) best = { key: candKey, scenarios, modelIds };
  }
  return best ? { scenarios: best.scenarios, modelIds: best.modelIds } : { scenarios: [], modelIds: [] };
}

export function buildRanking(runs: StoredRun[], filter: RankFilter): Ranking {
  const labels = new Map<string, string>();
  const cells = new Map<string, Map<string, Acc>>(); // agent -> scenario -> totals
  let games = 0;
  let truncatedExcluded = 0;
  let connectionExcluded = 0;

  for (const run of [...runs].sort((a, b) => a.runId.localeCompare(b.runId))) {
    if (!run.meta || groupKey(run.meta) !== filter.settingsKey) continue;
    for (const a of run.meta.agents) labels.set(a.id, a.label);
    for (const r of run.results) {
      const sc = parseScenarioId(r.scenarioId);
      if (!sc || !scenarioMatches(sc, filter)) continue;
      if (!hasFiniteNumbers(r)) continue;
      if (r.truncated === true) {
        truncatedExcluded++;
        continue;
      }
      if (isConnectionFailure(r)) {
        connectionExcluded++;
        continue;
      }
      games++;
      const perScenario = cells.get(r.agentId) ?? new Map<string, Acc>();
      const acc = perScenario.get(r.scenarioId) ?? emptyAcc();
      acc.n++;
      acc.score += r.score;
      acc.survived += r.survivedTicks;
      acc.lives += r.livesLeft;
      acc.level += r.level;
      acc.latency += r.avgLatencyMs;
      acc.cost += r.costUsd;
      perScenario.set(r.scenarioId, acc);
      cells.set(r.agentId, perScenario);
    }
  }

  const labelOf = (id: string) => labels.get(id) ?? id;

  const { scenarios: considered, modelIds } = chooseBlock(cells);
  const inBlock = new Set(modelIds);

  const rankedIds: string[] = [];
  const notRanked: NotRanked[] = [];
  for (const [agentId, perScenario] of [...cells.entries()].sort(([x], [y]) => x.localeCompare(y))) {
    if (inBlock.has(agentId)) rankedIds.push(agentId);
    else notRanked.push({ agentId, label: labelOf(agentId), missing: considered.filter((s) => !perScenario.has(s)).length });
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
      total.survived += a.survived;
      total.lives += a.lives;
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
      meanSurvivedTicks: total.survived / total.n,
      meanLivesLeft: total.lives / total.n,
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

  return { rows, notRanked, scenarios: considered, games, truncatedExcluded, connectionExcluded };
}

export function csvEscape(v: string | number | null): string {
  const s = v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: RankRow[]): string {
  const head = [
    'rank', 'model', 'avg_rank', 'scenarios', 'wins', 'games',
    'survival_ticks', 'lives_left',
    'mean_score', 'mean_level', 'mean_latency_ms', 'total_cost_usd', 'cost_per_1000_points',
  ];
  const lines = rows.map((r) =>
    [
      r.rank, r.label, r.avgRank.toFixed(2), r.scenarios, r.wins, r.games,
      r.meanSurvivedTicks.toFixed(0), r.meanLivesLeft.toFixed(2),
      r.meanScore.toFixed(1), r.meanLevel.toFixed(1), r.meanLatencyMs.toFixed(0),
      r.totalCostUsd.toFixed(4), r.costPer1000Points === null ? null : r.costPer1000Points.toFixed(4),
    ]
      .map(csvEscape)
      .join(','),
  );
  return [head.join(','), ...lines].join('\n');
}
