import type { GameResult } from './types';

export interface Cell {
  agentId: string;
  scenarioId: string;
  games: number;
  meanScore: number;
  stdScore: number;
  meanLevel: number;
  meanSurvivedTicks: number;
  meanLatencyMs: number;
  totalCostUsd: number;
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

export function aggregate(results: GameResult[]): Cell[] {
  const groups = new Map<string, GameResult[]>();
  for (const r of results) {
    const k = `${r.agentId}\u0000${r.scenarioId}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.values()].map((rs) => {
    const scores = rs.map((r) => r.score);
    const m = mean(scores);
    return {
      agentId: rs[0].agentId,
      scenarioId: rs[0].scenarioId,
      games: rs.length,
      meanScore: m,
      stdScore: Math.sqrt(mean(scores.map((s) => (s - m) ** 2))),
      meanLevel: mean(rs.map((r) => r.level)),
      meanSurvivedTicks: mean(rs.map((r) => r.survivedTicks)),
      meanLatencyMs: mean(rs.map((r) => r.avgLatencyMs)),
      totalCostUsd: rs.reduce((a, r) => a + r.costUsd, 0),
    };
  });
}

/** scenarioId to the agentId with the highest mean score (first one wins ties). */
export function winners(cells: Cell[]): Record<string, string> {
  const best: Record<string, Cell> = {};
  for (const c of cells) if (!best[c.scenarioId] || c.meanScore > best[c.scenarioId].meanScore) best[c.scenarioId] = c;
  return Object.fromEntries(Object.entries(best).map(([s, c]) => [s, c.agentId]));
}
