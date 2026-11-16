import type { Mode } from './types';

export interface EstimateInput {
  scenarios: number;
  seeds: number;
  mode: Mode;
  agentCount: number;
  llmAgents: { estUsdPerCall: number }[];
  maxCallsPerGame: number;
}

/** Worst case: every LLM agent uses its full per-game call cap in every game. */
export function estimateRun(i: EstimateInput): { games: number; maxCalls: number; maxUsd: number } {
  const groups = i.scenarios * i.seeds;
  const games = i.mode === 'arena' ? groups : groups * i.agentCount;
  const maxCalls = groups * i.llmAgents.length * i.maxCallsPerGame;
  const maxUsd = groups * i.maxCallsPerGame * i.llmAgents.reduce((sum, a) => sum + a.estUsdPerCall, 0);
  return { games, maxCalls, maxUsd };
}
