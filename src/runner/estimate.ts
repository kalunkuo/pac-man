import type { Mode } from './types';

export interface EstimateInput {
  scenarios: number;
  seeds: number;
  mode: Mode;
  agentCount: number;
  llmAgents: { estUsdPerCall: number }[];
  maxCallsPerGame: number;
  /** One factor per scenario (default all 1); scales the cost, not the call count. */
  scenarioCostFactors?: number[];
}

/** Worst case: every LLM agent uses its full per-game call cap in every game. */
export function estimateRun(i: EstimateInput): { games: number; maxCalls: number; maxUsd: number } {
  if (i.scenarioCostFactors && i.scenarioCostFactors.length !== i.scenarios) {
    throw new Error('scenarioCostFactors must have one entry per scenario');
  }
  const factors = i.scenarioCostFactors ?? Array.from({ length: i.scenarios }, () => 1);
  const groups = factors.length * i.seeds;
  const games = i.mode === 'arena' ? groups : groups * i.agentCount;
  const perGroupUsd = i.maxCallsPerGame * i.llmAgents.reduce((sum, a) => sum + a.estUsdPerCall, 0);
  const maxCalls = groups * i.llmAgents.length * i.maxCallsPerGame;
  const maxUsd = factors.reduce((sum, f) => sum + f * i.seeds * perGroupUsd, 0);
  return { games, maxCalls, maxUsd };
}
