import { createGame } from '../engine/engine';
import type { Player } from '../engine/types';
import { scenarioConfig, type Scenario } from './scenarios';
import { GameSession, runSession } from './session';
import type { GameResult, Mode, RunPlan } from './types';

export interface RunHooks {
  onGroupStart?(info: { scenario: Scenario; seed: number; sessions: GameSession[] }): void;
  onResult?(result: GameResult): void;
}

function toResult(mode: Mode, scenario: Scenario, seed: number, session: GameSession, p: Player): GameResult {
  const stats = session.stats[p.id];
  return {
    mode,
    scenarioId: scenario.id,
    seed,
    agentId: p.id,
    score: p.score,
    level: session.state.level,
    survivedTicks: p.diedAtTick ?? session.state.tick,
    livesLeft: p.lives,
    calls: stats.calls,
    errors: stats.errors,
    avgLatencyMs: stats.totalLatencyMs / Math.max(1, stats.calls),
    costUsd: stats.costUsd,
    disqualified: stats.disqualified,
    truncated: session.halted || session.state.status !== 'over',
  };
}

/**
 * Runs every scenario and seed in order. Benchmark mode: one game per agent, played side by side
 * on identical mazes. Arena mode: one shared game with all agents. Stops after the current group
 * if aborted or if any session halts on budget, and returns the results collected so far.
 */
export async function runPlan(plan: RunPlan, hooks: RunHooks = {}, signal?: AbortSignal): Promise<GameResult[]> {
  const results: GameResult[] = [];
  outer: for (const scenario of plan.scenarios) {
    for (const seed of plan.seeds) {
      if (signal?.aborted) break outer;
      const config = scenarioConfig(scenario, seed, { maxTicks: plan.maxTicks });
      const sessions =
        plan.mode === 'arena'
          ? [new GameSession(createGame(config, plan.agents.map((a) => a.id)), plan.agents, plan.maxCallsPerGame)]
          : plan.agents.map((a) => new GameSession(createGame(config, [a.id]), [a], plan.maxCallsPerGame));
      hooks.onGroupStart?.({ scenario, seed, sessions });
      await Promise.all(sessions.map((s) => runSession(s, plan.tickMs, signal)));
      for (const s of sessions) {
        for (const p of s.state.players) {
          const r = toResult(plan.mode, scenario, seed, s, p);
          results.push(r);
          hooks.onResult?.(r);
        }
      }
      if (sessions.some((s) => s.halted)) break outer;
    }
  }
  return results;
}
