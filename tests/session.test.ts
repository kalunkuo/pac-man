import { describe, expect, it } from 'vitest';
import { ScriptedAgent } from '../src/agents/baselines';
import { BudgetExceededError, type Agent, type Decision } from '../src/agents/types';
import { createGame } from '../src/engine/engine';
import { legalMoves } from '../src/engine/grid';
import type { Direction } from '../src/engine/types';
import { GameSession, MAX_CONSECUTIVE_ERRORS, runSession } from '../src/runner/session';
import { config } from './helpers';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** An agent whose answers are released by the test, to model latency. */
class DeferredAgent implements Agent {
  kind: 'baseline' | 'llm';
  calls = 0;
  private waiting: ((d: Decision) => void)[] = [];
  constructor(readonly id: string, readonly label: string, kind: 'baseline' | 'llm' = 'llm') {
    this.kind = kind;
  }
  decide(): Promise<Decision> {
    this.calls++;
    return new Promise((resolve) => this.waiting.push(resolve));
  }
  answer(d: Decision) {
    this.waiting.shift()?.(d);
  }
}

const mk = (agents: Agent[], maxCalls = 100, over = {}) =>
  new GameSession(createGame(config(over), agents.map((a) => a.id)), agents, maxCalls);

describe('GameSession', () => {
  it('applies an instant decision before the next tick', async () => {
    const state = createGame(config(), ['a']);
    const dir = legalMoves(state.maze.walls, state.players[0].pos)[0];
    const session = new GameSession(state, [new ScriptedAgent('a', 'A', [dir])], 100);
    session.tick();
    await flush();
    expect(state.players[0].wantDir).toBe(dir);
  });

  it('keeps one request in flight and applies the answer when it arrives (latency counts)', async () => {
    const agent = new DeferredAgent('a', 'A');
    const session = mk([agent]);
    const player = session.state.players[0];
    session.tick();
    session.tick();
    session.tick();
    expect(agent.calls).toBe(1); // still waiting, no second request
    const before = player.wantDir;
    const other: Direction = before === 'UP' ? 'DOWN' : 'UP';
    agent.answer({ dir: other, latencyMs: 50, costUsd: 0.001 });
    await flush();
    expect(player.wantDir).toBe(other);
    expect(session.stats.a).toMatchObject({ calls: 1, errors: 0, totalLatencyMs: 50, costUsd: 0.001 });
    session.tick();
    expect(agent.calls).toBe(2); // idle again, asks again
  });

  it('counts errors and disqualifies after too many in a row', async () => {
    const agent = new DeferredAgent('a', 'A');
    const session = mk([agent]);
    for (let i = 0; i < MAX_CONSECUTIVE_ERRORS; i++) {
      session.tick();
      agent.answer({ dir: null, latencyMs: 1, costUsd: 0, error: 'unparseable' });
      await flush();
    }
    expect(session.stats.a.errors).toBe(MAX_CONSECUTIVE_ERRORS);
    expect(session.stats.a.disqualified).toBe(true);
    expect(session.state.players[0].alive).toBe(false);
  });

  it('a good answer resets the consecutive error count', async () => {
    const agent = new DeferredAgent('a', 'A');
    const session = mk([agent]);
    session.tick();
    agent.answer({ dir: null, latencyMs: 1, costUsd: 0, error: 'x' });
    await flush();
    session.tick();
    agent.answer({ dir: 'UP', latencyMs: 1, costUsd: 0 });
    await flush();
    expect(session.stats.a.consecutiveErrors).toBe(0);
    expect(session.stats.a.errors).toBe(1);
  });

  it('halts when an agent reports an exhausted budget', async () => {
    const agent: Agent = {
      id: 'a',
      label: 'A',
      kind: 'llm',
      decide: async () => {
        throw new BudgetExceededError();
      },
    };
    const session = mk([agent]);
    session.tick();
    await flush();
    expect(session.halted).toBe(true);
    expect(session.over).toBe(true);
  });

  it('counts a thrown non-budget error as an error', async () => {
    const agent: Agent = {
      id: 'a',
      label: 'A',
      kind: 'llm',
      decide: async () => {
        throw new Error('boom');
      },
    };
    const session = mk([agent]);
    session.tick();
    await flush();
    expect(session.stats.a.errors).toBe(1);
    expect(session.halted).toBe(false);
  });

  it('caps calls per game for llm agents only', async () => {
    const llm = new DeferredAgent('l', 'L', 'llm');
    const base = new DeferredAgent('b', 'B', 'baseline');
    const session = mk([llm, base], 2);
    for (let i = 0; i < 5; i++) {
      session.tick();
      llm.answer({ dir: 'UP', latencyMs: 0, costUsd: 0 });
      base.answer({ dir: 'UP', latencyMs: 0, costUsd: 0 });
      await flush();
    }
    expect(llm.calls).toBe(2);
    expect(base.calls).toBe(5);
  });

  it('runSession ticks until the game is over', async () => {
    const session = mk([new ScriptedAgent('a', 'A', ['UP', 'LEFT'])], 100, { maxTicks: 20 });
    await runSession(session, 0);
    expect(session.state.status).toBe('over');
    expect(session.state.tick).toBe(20);
  });

  it('runSession stops when aborted', async () => {
    const session = mk([new ScriptedAgent('a', 'A', ['UP'])], 100, { maxTicks: 100000 });
    const ctl = new AbortController();
    const run = runSession(session, 1, ctl.signal);
    setTimeout(() => ctl.abort(), 20);
    await run;
    expect(session.state.status).toBe('running');
  });
});
