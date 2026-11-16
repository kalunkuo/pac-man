import type { Direction, GameState } from '../engine/types';

export interface Observation {
  /** Full text prompt body: status line, legal moves and the ASCII maze. */
  text: string;
  legalMoves: Direction[];
  score: number;
  lives: number;
  level: number;
  tick: number;
}

export interface DecideContext {
  observation: Observation;
  /** Live engine state. Baselines read it; LLM agents must only use `observation`. */
  state: GameState;
  playerId: string;
}

export interface Decision {
  /** Null when the agent produced no usable move (see `error`). */
  dir: Direction | null;
  latencyMs: number;
  costUsd: number;
  error?: string;
}

export interface Agent {
  id: string;
  label: string;
  kind: 'baseline' | 'llm';
  decide(ctx: DecideContext): Promise<Decision>;
}

/** Thrown by an agent when the run's money or call budget is used up. */
export class BudgetExceededError extends Error {
  constructor() {
    super('budget exceeded');
    this.name = 'BudgetExceededError';
  }
}
