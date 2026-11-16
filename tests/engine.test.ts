import { describe, expect, it } from 'vitest';
import {
  SCORE,
  createGame,
  eliminate,
  levelConfig,
  setDirection,
  step,
} from '../src/engine/engine';
import { bfsDistances, key, legalMoves, moved } from '../src/engine/grid';
import type { Direction } from '../src/engine/types';
import { config } from './helpers';

function setup(over = {}) {
  const state = createGame(config(over), ['a']);
  const p = state.players[0];
  const dir = legalMoves(state.maze.walls, p.pos)[0];
  const next = moved(p.pos, dir);
  state.pellets = new Set(['99,99']); // keeps the level from clearing
  state.powers = new Set();
  return { state, p, dir, next };
}

describe('levelConfig', () => {
  it('grows the maze and ghost count with the level and caps them', () => {
    const base = config({ width: 11, height: 11, ghostCount: 1, seed: 10 });
    expect(levelConfig(base, 1)).toMatchObject({ width: 11, ghostCount: 1, seed: 10 });
    expect(levelConfig(base, 2)).toMatchObject({ width: 15, height: 15, ghostCount: 1, seed: 11 });
    expect(levelConfig(base, 3)).toMatchObject({ width: 19, ghostCount: 2 });
    expect(levelConfig(base, 20)).toMatchObject({ width: 41, height: 41, ghostCount: 6 });
  });

  it('caps growth at 41 for bases 21 and 31', () => {
    const expected: Record<number, number[]> = { 21: [21, 25, 29, 41], 31: [31, 35, 39, 41] };
    for (const [base, widths] of Object.entries(expected)) {
      [1, 2, 3, 20].forEach((level, i) => {
        const cfg = levelConfig(config({ width: Number(base), height: Number(base) }), level);
        expect(cfg.width).toBe(widths[i]);
        expect(cfg.height).toBe(widths[i]);
      });
    }
    expect(levelConfig(config({ width: 21, height: 21 }), 6).width).toBe(41);
    expect(levelConfig(config({ width: 21, height: 21 }), 5).width).toBe(37);
    expect(levelConfig(config({ width: 31, height: 31 }), 4).width).toBe(41);
    expect(levelConfig(config({ width: 31, height: 31 }), 3).width).toBe(39);
    for (const base of [21, 31]) {
      for (let level = 1; level <= 30; level++) {
        expect(levelConfig(config({ width: base, height: base }), level).width).toBeLessThanOrEqual(41);
      }
    }
  });

  it('never shrinks a huge maze', () => {
    const base = config({ width: 61, height: 61 });
    for (const level of [1, 2, 10]) expect(levelConfig(base, level)).toMatchObject({ width: 61, height: 61 });
  });

  it('keeps a 0-ghost base at 0 ghosts and still grows other bases', () => {
    const none = config({ ghostCount: 0 });
    for (const level of [1, 3, 9]) expect(levelConfig(none, level).ghostCount).toBe(0);
    expect(levelConfig(config({ ghostCount: 1 }), 3).ghostCount).toBe(2);
  });

  it('clears a level with 0 ghosts and keeps the next level ghost-free', () => {
    const state = createGame(config({ ghostCount: 0, seed: 1 }), ['a']);
    const p = state.players[0];
    for (let i = 0; i < 800 && state.level === 1; i++) {
      const dist = bfsDistances(state.maze.walls, p.pos);
      let target = p.pos;
      let bestD = Infinity;
      for (const k of [...state.pellets, ...state.powers]) {
        const [x, y] = k.split(',').map(Number);
        if (dist[y][x] >= 0 && dist[y][x] < bestD) {
          bestD = dist[y][x];
          target = { x, y };
        }
      }
      const toTarget = bfsDistances(state.maze.walls, target);
      const next = legalMoves(state.maze.walls, p.pos).sort((d1, d2) => {
        const a1 = moved(p.pos, d1);
        const a2 = moved(p.pos, d2);
        return toTarget[a1.y][a1.x] - toTarget[a2.y][a2.x];
      })[0];
      setDirection(state, p.id, next);
      step(state);
    }
    expect(state.level).toBe(2);
    expect(state.ghosts).toHaveLength(0);
    expect(p.lives).toBe(3);
  });
});

describe('createGame', () => {
  it('starts every player at the pac start with full lives', () => {
    const state = createGame(config({ lives: 3 }), ['a', 'b']);
    expect(state.players).toHaveLength(2);
    for (const p of state.players) {
      expect(p.pos).toEqual(state.maze.pacStart);
      expect(p.lives).toBe(3);
      expect(p.alive).toBe(true);
    }
    expect(state.ghosts).toHaveLength(1);
    expect(state.status).toBe('running');
    expect(state.level).toBe(1);
  });

  it('assigns mixed ghost behaviours in rotation', () => {
    const state = createGame(config({ ghostCount: 4, ghostBehavior: 'mixed' }), ['a']);
    expect(state.ghosts.map((g) => g.behavior)).toEqual(['chase', 'ambush', 'random', 'chase']);
  });
});

describe('step', () => {
  it('moves the player and eats a pellet for 10 points', () => {
    const { state, p, dir, next } = setup();
    state.pellets.add(key(next));
    setDirection(state, 'a', dir);
    step(state);
    expect(p.pos).toEqual(next);
    expect(p.score).toBe(SCORE.pellet);
    expect(state.pellets.has(key(next))).toBe(false);
  });

  it('alternates which player wins a contested pellet', () => {
    const state = createGame(config({ ghostCount: 0 }), ['a', 'b']);
    const [a, b] = state.players;
    const start = { ...state.maze.pacStart };
    const dir = legalMoves(state.maze.walls, start)[0];
    const next = moved(start, dir);
    const winners: string[] = [];
    for (let i = 0; i < 2; i++) {
      state.pellets.add(key(next));
      for (const p of state.players) {
        p.pos = { ...start };
        p.dir = dir;
        p.wantDir = dir;
      }
      const before = [a.score, b.score];
      step(state);
      winners.push(a.score > before[0] ? 'a' : 'b');
      expect(a.score - before[0] + (b.score - before[1])).toBe(SCORE.pellet);
    }
    expect(winners).toEqual(['b', 'a']);
  });

  it('eating a power pellet scores 50 and frightens ghosts', () => {
    const { state, p, dir, next } = setup();
    state.powers.add(key(next));
    setDirection(state, 'a', dir);
    step(state);
    expect(p.score).toBe(SCORE.power);
    expect(state.frightenedTicks).toBeGreaterThan(0);
  });

  it('keeps moving in the current direction when the wanted one is blocked', () => {
    const { state, p } = setup();
    const open = legalMoves(state.maze.walls, p.pos);
    const blocked = (['UP', 'DOWN', 'LEFT', 'RIGHT'] as Direction[]).find((d) => !open.includes(d))!;
    p.dir = open[0];
    setDirection(state, 'a', blocked);
    step(state);
    expect(p.pos).toEqual(moved(state.maze.pacStart, open[0]));
  });

  it('a ghost collision costs a life and respawns the player', () => {
    const { state, p, dir, next } = setup({ lives: 3 });
    state.tick = 100; // 101 is odd, so the level-1 ghost does not move this tick
    p.invulnerableUntil = 0;
    state.ghosts = [{ pos: { ...next }, dir: 'UP', behavior: 'random' }];
    setDirection(state, 'a', dir);
    step(state);
    expect(p.lives).toBe(2);
    expect(p.pos).toEqual(state.maze.pacStart);
    expect(p.invulnerableUntil).toBeGreaterThan(state.tick);
  });

  it('invulnerable players survive a ghost collision', () => {
    const { state, p, dir, next } = setup({ lives: 3 });
    state.tick = 100;
    p.invulnerableUntil = 1000;
    state.ghosts = [{ pos: { ...next }, dir: 'UP', behavior: 'random' }];
    setDirection(state, 'a', dir);
    step(state);
    expect(p.lives).toBe(3);
  });

  it('a frightened ghost is eaten for 200 points and sent home', () => {
    const { state, p, dir, next } = setup();
    state.tick = 100; // frightened period is 3, and 101 % 3 !== 0, so the ghost stays put
    p.invulnerableUntil = 0;
    state.frightenedTicks = 10;
    state.ghosts = [{ pos: { ...next }, dir: 'UP', behavior: 'chase' }];
    setDirection(state, 'a', dir);
    step(state);
    expect(p.score).toBe(SCORE.ghost);
    expect(state.ghosts[0].pos).toEqual(state.maze.ghostStart);
  });

  it('detects a swap collision (player and ghost pass through each other)', () => {
    const { state, p, dir, next } = setup({ lives: 3 });
    state.tick = 101; // 102 is even, so the level-1 ghost moves this tick
    p.invulnerableUntil = 0;
    const back: Record<Direction, Direction> = { UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT' };
    // Make the ghost's cell a dead end whose only exit is the player's start cell,
    // so the ghost is forced to step into the cell the player is leaving.
    for (const d of legalMoves(state.maze.walls, next)) {
      if (d === back[dir]) continue;
      const w = moved(next, d);
      state.maze.walls[w.y][w.x] = true;
    }
    state.ghosts = [{ pos: { ...next }, dir: 'UP', behavior: 'chase' }];
    setDirection(state, 'a', dir);
    step(state);
    expect(p.lives).toBe(2);
  });

  it('ends the game when the last life is lost', () => {
    const { state, p, dir, next } = setup({ lives: 1 });
    state.tick = 100;
    p.invulnerableUntil = 0;
    state.ghosts = [{ pos: { ...next }, dir: 'UP', behavior: 'random' }];
    setDirection(state, 'a', dir);
    step(state);
    expect(p.alive).toBe(false);
    expect(p.diedAtTick).toBe(101);
    expect(state.status).toBe('over');
  });

  it('clears the level: bonus, next level, bigger maze', () => {
    const { state, p, dir, next } = setup({ width: 11, height: 11 });
    state.pellets = new Set([key(next)]);
    setDirection(state, 'a', dir);
    step(state);
    expect(p.score).toBe(SCORE.pellet + SCORE.levelClear);
    expect(state.level).toBe(2);
    expect(state.maze.width).toBe(15);
    expect(p.pos).toEqual(state.maze.pacStart);
    expect(state.pellets.size).toBeGreaterThan(0);
  });

  it('stops at maxTicks', () => {
    const state = createGame(config({ maxTicks: 3 }), ['a']);
    for (let i = 0; i < 3; i++) step(state);
    expect(state.status).toBe('over');
    const tick = state.tick;
    step(state);
    expect(state.tick).toBe(tick);
  });

  it('eliminate removes a player and ends the game when none are left', () => {
    const state = createGame(config(), ['a', 'b']);
    eliminate(state, 'a');
    expect(state.status).toBe('running');
    eliminate(state, 'b');
    expect(state.status).toBe('over');
  });

  it('is deterministic for the same config and inputs', () => {
    const run = (): string => {
      const state = createGame(config({ ghostCount: 2, ghostBehavior: 'mixed' }), ['a']);
      const script: Direction[] = ['RIGHT', 'DOWN', 'LEFT', 'UP'];
      const trace: string[] = [];
      for (let i = 0; i < 200 && state.status === 'running'; i++) {
        setDirection(state, 'a', script[Math.floor(i / 3) % 4]);
        step(state);
        const g = state.ghosts.map((x) => `${x.pos.x}:${x.pos.y}`).join('|');
        trace.push(`${state.players[0].pos.x},${state.players[0].pos.y},${state.players[0].score},${g}`);
      }
      return trace.join(';');
    };
    expect(run()).toBe(run());
  });
});
