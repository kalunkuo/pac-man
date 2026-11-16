import { describe, expect, it } from 'vitest';
import {
  GreedyAgent,
  PlannerAgent,
  RandomAgent,
  ScriptedAgent,
  firstStepToNearest,
} from '../src/agents/baselines';
import { encodeObservation } from '../src/agents/observation';
import { parseDirection } from '../src/agents/parse';
import type { DecideContext } from '../src/agents/types';
import { createGame } from '../src/engine/engine';
import { key, legalMoves } from '../src/engine/grid';
import type { GameState } from '../src/engine/types';
import { config, parseWalls } from './helpers';

function ctxFor(state: GameState): DecideContext {
  return { observation: encodeObservation(state, 'a'), state, playerId: 'a' };
}

/** A one-corridor world: '#######' / '#.....#' / '#######', player at (3,1). */
function corridor(): GameState {
  const state = createGame(config(), ['a']);
  state.maze.walls = parseWalls(['#######', '#.....#', '#######']);
  state.players[0].pos = { x: 3, y: 1 };
  state.pellets = new Set();
  state.powers = new Set();
  state.ghosts = [];
  return state;
}

describe('parseDirection', () => {
  it('finds the first whole-word direction, case-insensitive', () => {
    expect(parseDirection('UP')).toBe('UP');
    expect(parseDirection('  left\n')).toBe('LEFT');
    expect(parseDirection('I think RIGHT is best, not up')).toBe('RIGHT');
  });
  it('rejects text without a direction', () => {
    expect(parseDirection('')).toBeNull();
    expect(parseDirection('upward')).toBeNull();
    expect(parseDirection('no idea')).toBeNull();
  });
});

describe('encodeObservation', () => {
  it('renders the maze with the player, ghosts and legal moves', () => {
    const state = createGame(config(), ['a']);
    const obs = encodeObservation(state, 'a');
    const rows = obs.text.split('\n').slice(2);
    expect(rows).toHaveLength(state.maze.height);
    const { pos } = state.players[0];
    expect(rows[pos.y][pos.x]).toBe('P');
    const gp = state.ghosts[0].pos;
    expect(rows[gp.y][gp.x]).toBe('G');
    expect(obs.legalMoves.sort()).toEqual(legalMoves(state.maze.walls, pos).sort());
    expect(obs.text).toContain('Legal moves:');
    expect(obs.level).toBe(1);
  });

  it('shows frightened ghosts as g and other players as p', () => {
    const state = createGame(config(), ['a', 'b']);
    state.frightenedTicks = 5;
    state.players[1].pos = { x: 1, y: 3 };
    const rows = encodeObservation(state, 'a').text.split('\n').slice(2);
    const gp = state.ghosts[0].pos;
    expect(rows[gp.y][gp.x]).toBe('g');
    expect(rows[3][1]).toBe('p');
  });
});

describe('fog of war observation', () => {
  const OLD_TEXT =
    'Level 1, score 0, lives 3, you are moving LEFT.\nLegal moves: DOWN, RIGHT\n###########\n#Po......o#\n#.#####.#.#\n#.....#.#.#\n###.#.#.#.#\n#.....#.#.#\n#..##.#...#\n#.....#...#\n#.#.#####.#\n#o......Go#\n###########';

  it('keeps the full-vision text exactly as before', () => {
    const state = createGame(config({ seed: 1, ghostBehavior: 'chase' }), ['a']);
    expect(encodeObservation(state, 'a').text).toBe(OLD_TEXT);
  });

  it('hides cells beyond the radius and adds the fog and position lines', () => {
    const state = createGame(config({ vision: 3 }), ['a']);
    state.maze.walls = parseWalls(['#############', '#...........#', '#############']);
    state.players[0].pos = { x: 3, y: 1 };
    state.pellets = new Set([key({ x: 6, y: 1 }), key({ x: 7, y: 1 })]);
    state.powers = new Set();
    state.ghosts = [{ pos: { x: 8, y: 1 }, dir: 'LEFT', behavior: 'chase' }];
    const lines = encodeObservation(state, 'a').text.split('\n');
    expect(lines[0]).toContain('you are moving LEFT');
    expect(lines[1]).toBe('Position: (3, 1)');
    expect(lines[2]).toContain('Legal moves:');
    expect(lines[3]).toBe('Fog of war: cells more than 3 steps away are shown as ?.');
    expect(lines.slice(4)).toEqual(['?#####???????', '#--P--.??????', '?#####???????']);
    expect(lines.slice(4).join('')).not.toContain('G');
  });

  it('shows a ghost inside the radius and other players as p', () => {
    const state = createGame(config({ vision: 3 }), ['a', 'b']);
    state.maze.walls = parseWalls(['#############', '#...........#', '#############']);
    state.players[0].pos = { x: 3, y: 1 };
    state.players[1].pos = { x: 5, y: 1 };
    state.pellets = new Set();
    state.powers = new Set();
    state.ghosts = [{ pos: { x: 2, y: 1 }, dir: 'LEFT', behavior: 'chase' }];
    expect(encodeObservation(state, 'a').text.split('\n')[5]).toBe('#-GP-p-??????');
  });
});

describe('baselines', () => {
  it('all baselines return a legal move in a real maze', async () => {
    const state = createGame(config(), ['a']);
    const legal = legalMoves(state.maze.walls, state.players[0].pos);
    for (const agent of [new RandomAgent('r', 'R', 1), new GreedyAgent('g', 'G'), new PlannerAgent('p', 'P')]) {
      const d = await agent.decide(ctxFor(state));
      expect(d.dir && legal.includes(d.dir)).toBe(true);
      expect(d.latencyMs).toBe(0);
      expect(d.costUsd).toBe(0);
      expect(agent.kind).toBe('baseline');
    }
  });

  it('greedy and planner walk toward a pellet', async () => {
    const state = corridor();
    state.pellets = new Set([key({ x: 5, y: 1 })]);
    expect((await new GreedyAgent('g', 'G').decide(ctxFor(state))).dir).toBe('RIGHT');
    expect((await new PlannerAgent('p', 'P').decide(ctxFor(state))).dir).toBe('RIGHT');
  });

  it('planner refuses a path through ghost danger and flees instead', async () => {
    const state = corridor();
    state.pellets = new Set([key({ x: 1, y: 1 })]);
    state.ghosts = [{ pos: { x: 4, y: 1 }, dir: 'LEFT', behavior: 'chase' }];
    expect((await new PlannerAgent('p', 'P').decide(ctxFor(state))).dir).toBe('LEFT');
  });

  it('planner does not walk toward a pellet through a ghost danger zone', async () => {
    const state = corridor();
    state.pellets = new Set([key({ x: 5, y: 1 })]);
    state.ghosts = [{ pos: { x: 4, y: 1 }, dir: 'LEFT', behavior: 'chase' }];
    expect((await new PlannerAgent('p', 'P').decide(ctxFor(state))).dir).toBe('LEFT');
  });

  it('planner ignores ghost danger while ghosts are frightened', async () => {
    const state = corridor();
    state.pellets = new Set([key({ x: 5, y: 1 })]);
    state.ghosts = [{ pos: { x: 4, y: 1 }, dir: 'LEFT', behavior: 'chase' }];
    state.frightenedTicks = 10;
    expect((await new PlannerAgent('p', 'P').decide(ctxFor(state))).dir).toBe('RIGHT');
  });

  it('firstStepToNearest returns null when nothing is reachable', () => {
    const walls = parseWalls(['#####', '#.#.#', '#####']);
    expect(firstStepToNearest(walls, { x: 1, y: 1 }, new Set(['3,1']), new Set())).toBeNull();
  });

  describe('under fog of war', () => {
    const fogCorridor = (vision: number): GameState => {
      const state = corridor();
      state.config = { ...state.config, vision };
      state.maze.walls = parseWalls(['#############', '#...........#', '#############']);
      state.players[0].pos = { x: 3, y: 1 };
      return state;
    };
    const agents = () => [new GreedyAgent('g', 'G'), new PlannerAgent('p', 'P')];

    it('keeps the current direction when no pellet is inside the radius', async () => {
      for (const agent of agents()) {
        const state = fogCorridor(2);
        state.pellets = new Set([key({ x: 10, y: 1 })]);
        state.players[0].dir = 'LEFT';
        expect((await agent.decide(ctxFor(state))).dir).toBe('LEFT');
        state.players[0].dir = 'RIGHT';
        expect((await agent.decide(ctxFor(state))).dir).toBe('RIGHT');
      }
    });

    it('avoids reversing when the current direction is blocked, but falls back to it in a dead end', async () => {
      for (const agent of agents()) {
        const state = fogCorridor(2);
        state.maze.walls = parseWalls(['#####', '#...#', '###.#', '#...#', '#####']);
        state.players[0].pos = { x: 3, y: 1 };
        state.players[0].dir = 'RIGHT';
        state.pellets = new Set([key({ x: 1, y: 3 })]);
        expect((await agent.decide(ctxFor(state))).dir).toBe('DOWN');
        state.maze.walls = parseWalls(['#####', '#...#', '#####']);
        expect((await agent.decide(ctxFor(state))).dir).toBe('LEFT');
      }
    });

    it('goes for a pellet inside the radius', async () => {
      for (const agent of agents()) {
        const state = fogCorridor(3);
        state.pellets = new Set([key({ x: 6, y: 1 })]);
        state.players[0].dir = 'LEFT';
        expect((await agent.decide(ctxFor(state))).dir).toBe('RIGHT');
      }
    });

    it('planner ignores a ghost outside the radius', async () => {
      const state = fogCorridor(3);
      state.pellets = new Set([key({ x: 5, y: 1 })]);
      state.ghosts = [{ pos: { x: 7, y: 1 }, dir: 'LEFT', behavior: 'chase' }];
      expect((await new PlannerAgent('p', 'P').decide(ctxFor(state))).dir).toBe('RIGHT');
    });
  });

  it('scripted agent cycles through its directions', async () => {
    const state = createGame(config(), ['a']);
    const agent = new ScriptedAgent('s', 'S', ['UP', 'LEFT']);
    const out = [];
    for (let i = 0; i < 3; i++) out.push((await agent.decide(ctxFor(state))).dir);
    expect(out).toEqual(['UP', 'LEFT', 'UP']);
  });

  it('random agent is deterministic per seed', async () => {
    const state = createGame(config(), ['a']);
    const a = new RandomAgent('r', 'R', 5);
    const b = new RandomAgent('r', 'R', 5);
    for (let i = 0; i < 10; i++)
      expect((await a.decide(ctxFor(state))).dir).toBe((await b.decide(ctxFor(state))).dir);
  });
});
