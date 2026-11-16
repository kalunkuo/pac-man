import { BudgetExceededError, type Agent, type Decision } from '../agents/types';
import { encodeObservation } from '../agents/observation';
import { eliminate, setDirection, step } from '../engine/engine';
import type { GameState } from '../engine/types';

export const MAX_CONSECUTIVE_ERRORS = 5;

export interface PlayerStats {
  calls: number;
  errors: number;
  consecutiveErrors: number;
  totalLatencyMs: number;
  costUsd: number;
  disqualified: boolean;
}

/**
 * Drives one engine state in real time. Agents answer asynchronously: a request is started
 * when an agent is idle, and its answer is applied the moment it arrives, so slow agents
 * keep their last direction in the meantime.
 */
export class GameSession {
  readonly stats: Record<string, PlayerStats> = {};
  halted = false;
  private readonly inflight = new Set<string>();

  constructor(
    readonly state: GameState,
    private readonly agents: Agent[],
    private readonly maxCallsPerGame: number,
  ) {
    for (const a of agents) {
      this.stats[a.id] = { calls: 0, errors: 0, consecutiveErrors: 0, totalLatencyMs: 0, costUsd: 0, disqualified: false };
    }
  }

  get over(): boolean {
    return this.halted || this.state.status === 'over';
  }

  tick(): void {
    if (this.over) return;
    for (const agent of this.agents) {
      const player = this.state.players.find((p) => p.id === agent.id);
      if (!player || !player.alive || this.inflight.has(agent.id)) continue;
      const stats = this.stats[agent.id];
      if (agent.kind === 'llm' && stats.calls >= this.maxCallsPerGame) continue;
      this.request(agent);
    }
    step(this.state);
  }

  private request(agent: Agent): void {
    const stats = this.stats[agent.id];
    this.inflight.add(agent.id);
    stats.calls++;
    const ctx = {
      observation: encodeObservation(this.state, agent.id),
      state: this.state,
      playerId: agent.id,
    };
    // The executor runs decide() synchronously (so the request starts this tick) and turns a sync throw into a rejection.
    new Promise<Decision>((resolve) => resolve(agent.decide(ctx)))
      .then((d) => {
        stats.totalLatencyMs += d.latencyMs;
        stats.costUsd += d.costUsd;
        if (d.error || !d.dir) this.fail(agent.id);
        else {
          stats.consecutiveErrors = 0;
          setDirection(this.state, agent.id, d.dir);
        }
      })
      .catch((e: unknown) => {
        if (e instanceof BudgetExceededError) this.halted = true;
        else this.fail(agent.id);
      })
      .finally(() => this.inflight.delete(agent.id));
  }

  private fail(agentId: string): void {
    const stats = this.stats[agentId];
    stats.errors++;
    stats.consecutiveErrors++;
    if (stats.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS && !stats.disqualified) {
      stats.disqualified = true;
      eliminate(this.state, agentId);
    }
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runSession(session: GameSession, tickMs: number, signal?: AbortSignal): Promise<void> {
  while (!session.over && !signal?.aborted) {
    session.tick();
    await sleep(tickMs);
  }
}
