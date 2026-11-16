import type { Agent } from '../agents/types';
import type { Scenario } from './scenarios';

export type Mode = 'benchmark' | 'arena';

export interface RunPlan {
  mode: Mode;
  scenarios: Scenario[];
  seeds: number[];
  agents: Agent[];
  /** Milliseconds per game tick. Real-time play uses about 150. Tests use 0. */
  tickMs: number;
  /** Cap on model calls per agent per game (LLM agents only). */
  maxCallsPerGame: number;
  maxTicks: number;
}

export interface GameResult {
  mode: Mode;
  scenarioId: string;
  seed: number;
  agentId: string;
  score: number;
  level: number;
  survivedTicks: number;
  livesLeft: number;
  calls: number;
  errors: number;
  avgLatencyMs: number;
  costUsd: number;
  disqualified: boolean;
  /** Why the most recent call failed. Absent when no call failed. */
  lastError?: string;
  /** True when the game was stopped (abort or budget) before it ended on its own. */
  truncated: boolean;
}
