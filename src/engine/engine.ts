import { OPPOSITE, bfsDistances, isOpen, key, legalMoves, moved, same } from './grid';
import { generateMaze } from './maze';
import { makeRng } from './rng';
import type {
  Direction,
  GameState,
  GhostBehavior,
  Maze,
  Player,
  ScenarioConfig,
  Vec,
} from './types';

export const SCORE = { pellet: 10, power: 50, ghost: 200, levelClear: 500 };
export const FRIGHTENED_TICKS = 40;
export const INVULNERABLE_TICKS = 10;

const BEHAVIORS: GhostBehavior[] = ['chase', 'ambush', 'random'];

export function levelConfig(base: ScenarioConfig, level: number): ScenarioConfig {
  const grow = 4 * (level - 1);
  return {
    ...base,
    // Never shrink a base larger than the cap (huge).
    width: Math.min(base.width + grow, Math.max(41, base.width)),
    height: Math.min(base.height + grow, Math.max(41, base.height)),
    ghostCount: base.ghostCount === 0 ? 0 : Math.min(base.ghostCount + Math.floor((level - 1) / 2), 6),
    seed: base.seed + level - 1,
  };
}

export function createGame(config: ScenarioConfig, playerIds: string[]): GameState {
  const state: GameState = {
    config,
    level: 0,
    tick: 0,
    maze: null as unknown as Maze,
    pellets: new Set(),
    powers: new Set(),
    players: playerIds.map((id) => ({
      id,
      pos: { x: 0, y: 0 },
      dir: 'LEFT',
      wantDir: 'LEFT',
      score: 0,
      lives: config.lives,
      alive: true,
      invulnerableUntil: 0,
      diedAtTick: null,
    })),
    ghosts: [],
    frightenedTicks: 0,
    status: 'running',
    rng: makeRng(config.seed ^ 0x9e3779b9),
  };
  loadLevel(state, 1);
  return state;
}

function loadLevel(state: GameState, level: number): void {
  const cfg = levelConfig(state.config, level);
  const maze = generateMaze(cfg.width, cfg.height, cfg.complexity, cfg.seed);
  state.level = level;
  state.maze = maze;
  state.pellets = new Set(maze.pelletSpots.map(key));
  state.powers = new Set(maze.powerSpots.map(key));
  state.ghosts = Array.from({ length: cfg.ghostCount }, (_, i) => ({
    pos: { ...maze.ghostStart },
    dir: 'UP' as Direction,
    behavior: cfg.ghostBehavior === 'mixed' ? BEHAVIORS[i % BEHAVIORS.length] : cfg.ghostBehavior,
  }));
  state.frightenedTicks = 0;
  for (const p of state.players) {
    p.pos = { ...maze.pacStart };
    p.dir = 'LEFT';
    p.wantDir = 'LEFT';
    p.invulnerableUntil = state.tick + INVULNERABLE_TICKS;
  }
}

export function setDirection(state: GameState, playerId: string, dir: Direction): void {
  const p = state.players.find((x) => x.id === playerId);
  if (p && p.alive) p.wantDir = dir;
}

export function eliminate(state: GameState, playerId: string): void {
  const p = state.players.find((x) => x.id === playerId);
  if (p && p.alive) {
    p.alive = false;
    p.diedAtTick = state.tick;
  }
  checkOver(state);
}

function checkOver(state: GameState): void {
  if (state.players.every((p) => !p.alive) || state.tick >= state.config.maxTicks) state.status = 'over';
}

export function step(state: GameState): void {
  if (state.status === 'over') return;
  state.tick++;
  const walls = state.maze.walls;
  const prevPlayers = state.players.map((p) => ({ ...p.pos }));

  const order = processingOrder(state);
  for (const pi of order) {
    const p = state.players[pi];
    if (!p.alive) continue;
    const want = moved(p.pos, p.wantDir);
    if (isOpen(walls, want)) {
      p.dir = p.wantDir;
      p.pos = want;
    } else {
      const ahead = moved(p.pos, p.dir);
      if (isOpen(walls, ahead)) p.pos = ahead;
    }
    eat(state, p);
  }

  const prevGhosts = state.ghosts.map((g) => ({ ...g.pos }));
  moveGhosts(state);
  resolveCollisions(state, prevPlayers, prevGhosts, order);
  if (state.frightenedTicks > 0) state.frightenedTicks--;

  if (state.pellets.size === 0 && state.powers.size === 0) {
    for (const p of state.players) if (p.alive) p.score += SCORE.levelClear;
    loadLevel(state, state.level + 1);
  }
  checkOver(state);
}

/** Rotates who goes first each tick, so a contested pellet does not always go to the same player. */
function processingOrder(state: GameState): number[] {
  const n = state.players.length;
  return Array.from({ length: n }, (_, i) => (state.tick + i) % n);
}

function eat(state: GameState, p: Player): void {
  const k = key(p.pos);
  if (state.pellets.delete(k)) p.score += SCORE.pellet;
  if (state.powers.delete(k)) {
    p.score += SCORE.power;
    state.frightenedTicks = FRIGHTENED_TICKS;
  }
}

function nearestPlayer(players: Player[], pos: Vec): Player {
  let best = players[0];
  let bestDist = Infinity;
  for (const p of players) {
    const d = Math.abs(p.pos.x - pos.x) + Math.abs(p.pos.y - pos.y);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

function argmin(choices: Direction[], cost: (d: Direction) => number): Direction {
  let best = choices[0];
  let bestCost = cost(best);
  for (const c of choices.slice(1)) {
    const v = cost(c);
    if (v < bestCost) {
      best = c;
      bestCost = v;
    }
  }
  return best;
}

function aheadOf(player: Player, walls: boolean[][], steps: number): Vec {
  let p = { ...player.pos };
  for (let i = 0; i < steps; i++) {
    const n = moved(p, player.dir);
    if (!isOpen(walls, n)) break;
    p = n;
  }
  return p;
}

function moveGhosts(state: GameState): void {
  const frightened = state.frightenedTicks > 0;
  const base = state.level <= 2 ? 2 : 1;
  const period = frightened ? base + 1 : base;
  // Always one roll per ghost per tick so the sequence never depends on game state.
  const rolls = state.ghosts.map(() => state.rng());
  const alive = state.players.filter((p) => p.alive);
  if (alive.length === 0 || state.tick % period !== 0) return;

  const walls = state.maze.walls;
  const cache = new Map<string, number[][]>();
  const distFrom = (t: Vec): number[][] => {
    const k = key(t);
    let d = cache.get(k);
    if (!d) {
      d = bfsDistances(walls, t);
      cache.set(k, d);
    }
    return d;
  };

  state.ghosts.forEach((g, i) => {
    const options = legalMoves(walls, g.pos);
    if (options.length === 0) return;
    const forward = options.filter((d) => d !== OPPOSITE[g.dir]);
    const choices = forward.length > 0 ? forward : options;
    const target = nearestPlayer(alive, g.pos);
    let dir: Direction;
    if (frightened) {
      const dist = distFrom(target.pos);
      dir = argmin(choices, (d) => {
        const n = moved(g.pos, d);
        return -dist[n.y][n.x];
      });
    } else if (g.behavior === 'random') {
      dir = choices[Math.floor(rolls[i] * choices.length)];
    } else {
      const goal = g.behavior === 'ambush' ? aheadOf(target, walls, 4) : target.pos;
      const dist = distFrom(goal);
      dir = argmin(choices, (d) => {
        const n = moved(g.pos, d);
        return dist[n.y][n.x];
      });
    }
    g.dir = dir;
    g.pos = moved(g.pos, dir);
  });
}

function resolveCollisions(state: GameState, prevPlayers: Vec[], prevGhosts: Vec[], order: number[]): void {
  for (const pi of order) {
    const p = state.players[pi];
    if (!p.alive) continue;
    for (let gi = 0; gi < state.ghosts.length; gi++) {
      const g = state.ghosts[gi];
      const swapped = same(p.pos, prevGhosts[gi]) && same(g.pos, prevPlayers[pi]);
      if (!same(p.pos, g.pos) && !swapped) continue;
      if (state.frightenedTicks > 0) {
        p.score += SCORE.ghost;
        g.pos = { ...state.maze.ghostStart };
        continue;
      }
      if (state.tick < p.invulnerableUntil) continue;
      p.lives--;
      if (p.lives <= 0) {
        p.alive = false;
        p.diedAtTick = state.tick;
      } else {
        p.pos = { ...state.maze.pacStart };
        p.dir = 'LEFT';
        p.wantDir = 'LEFT';
        p.invulnerableUntil = state.tick + INVULNERABLE_TICKS;
      }
      break;
    }
  }
}
