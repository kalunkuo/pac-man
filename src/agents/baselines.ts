import { DIRS, OPPOSITE, key, legalMoves, moved, isOpen } from '../engine/grid';
import { makeRng, type Rng } from '../engine/rng';
import type { Direction, GameState, Vec } from '../engine/types';
import type { Agent, DecideContext, Decision } from './types';

const free = (dir: Direction | null, error?: string): Decision => ({ dir, latencyMs: 0, costUsd: 0, error });
const manhattan = (a: Vec, b: Vec): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

function me(ctx: DecideContext) {
  const p = ctx.state.players.find((x) => x.id === ctx.playerId);
  if (!p) throw new Error(`unknown player ${ctx.playerId}`);
  return p;
}

/** Breadth-first search for the nearest target. Returns the first step of the shortest path. */
export function firstStepToNearest(
  walls: boolean[][],
  start: Vec,
  targets: Set<string>,
  blocked: Set<string>,
): Direction | null {
  const seen = new Set([key(start)]);
  const queue: { pos: Vec; first: Direction | null }[] = [{ pos: start, first: null }];
  for (let i = 0; i < queue.length; i++) {
    const { pos, first } = queue[i];
    if (first !== null && targets.has(key(pos))) return first;
    for (const d of DIRS) {
      const n = moved(pos, d);
      const k = key(n);
      if (!isOpen(walls, n) || seen.has(k) || blocked.has(k)) continue;
      seen.add(k);
      queue.push({ pos: n, first: first ?? d });
    }
  }
  return null;
}

/** Fog of war: the radius a baseline can see, or null with full vision. */
const visionOf = (ctx: DecideContext): number | null => ctx.state.config.vision;

/** A copy of the wall grid where every cell beyond Manhattan distance r of pos counts as a wall. */
export function visibleWalls(walls: boolean[][], pos: Vec, r: number): boolean[][] {
  return walls.map((row, y) => row.map((wall, x) => wall || manhattan(pos, { x, y }) > r));
}

/** Without a visible pellet, keep going; otherwise turn without reversing unless that is the only way. */
function wander(ctx: DecideContext, moves: Direction[]): Direction {
  const dir = me(ctx).dir;
  if (moves.includes(dir)) return dir;
  return moves.find((d) => d !== OPPOSITE[dir]) ?? moves[0];
}

export class RandomAgent implements Agent {
  readonly kind = 'baseline' as const;
  // One rng per game, so a result never depends on which games ran before it.
  private readonly rngs = new WeakMap<GameState, Rng>();
  constructor(readonly id: string, readonly label: string, private readonly seed: number) {}
  async decide(ctx: DecideContext): Promise<Decision> {
    let rng = this.rngs.get(ctx.state);
    if (!rng) this.rngs.set(ctx.state, (rng = makeRng(this.seed ^ (ctx.state.config.seed >>> 0))));
    const moves = legalMoves(ctx.state.maze.walls, me(ctx).pos);
    return free(moves.length ? moves[Math.floor(rng() * moves.length)] : null);
  }
}

type Memory = { level: number; visits: Map<string, number> };

/** Heads for the nearest pellet by straight-line distance, remembering cells it has stood on. Ignores ghosts. */
export class GreedyAgent implements Agent {
  readonly kind = 'baseline' as const;
  // Keyed by game state so a reused agent starts fresh in every new game.
  private readonly memory = new WeakMap<GameState, Map<string, Memory>>();
  constructor(readonly id: string, readonly label: string) {}

  private visitsFor(state: GameState, playerId: string): Map<string, number> {
    let byPlayer = this.memory.get(state);
    if (!byPlayer) this.memory.set(state, (byPlayer = new Map()));
    let entry = byPlayer.get(playerId);
    if (!entry || entry.level !== state.level) byPlayer.set(playerId, (entry = { level: state.level, visits: new Map() }));
    return entry.visits;
  }

  async decide(ctx: DecideContext): Promise<Decision> {
    const { state } = ctx;
    const player = me(ctx);
    const pos = player.pos;
    const visits = this.visitsFor(state, ctx.playerId);
    const here = key(pos);
    // Before its first move on a level the player's heading is only a default, so reversing is allowed then.
    const hasMoved = [...visits.keys()].some((k) => k !== here);
    visits.set(here, (visits.get(here) ?? 0) + 1);

    const all = legalMoves(state.maze.walls, pos);
    if (all.length === 0) return free(null);
    const forward = hasMoved ? all.filter((d) => d !== OPPOSITE[player.dir]) : all;
    const moves = forward.length > 0 ? forward : all;

    const radius = visionOf(ctx);
    const targets = [...state.pellets, ...state.powers]
      .map((k) => {
        const [x, y] = k.split(',').map(Number);
        return { x, y };
      })
      .filter((t) => radius === null || manhattan(pos, t) <= radius);
    if (targets.length === 0) return free(radius === null ? moves[0] : wander(ctx, moves));
    const cost = (d: Direction) => {
      const next = moved(pos, d);
      return Math.min(...targets.map((t) => manhattan(next, t))) + 2 * (visits.get(key(next)) ?? 0);
    };
    let best = moves[0];
    for (const d of moves) if (cost(d) < cost(best)) best = d;
    return free(best);
  }
}

/** Shortest path to the nearest pellet, avoiding cells within 2 of a live ghost. Flees when boxed in. */
export class PlannerAgent implements Agent {
  readonly kind = 'baseline' as const;
  constructor(readonly id: string, readonly label: string) {}
  async decide(ctx: DecideContext): Promise<Decision> {
    const { state } = ctx;
    const pos = me(ctx).pos;
    const walls = state.maze.walls;
    const radius = visionOf(ctx);
    const visible = (p: Vec) => radius === null || manhattan(pos, p) <= radius;
    const threats = state.frightenedTicks > 0 ? [] : state.ghosts.map((g) => g.pos).filter(visible);

    const blocked = new Set<string>();
    for (const t of threats)
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          if (Math.abs(dx) + Math.abs(dy) <= 2) blocked.add(key({ x: t.x + dx, y: t.y + dy }));
    blocked.delete(key(pos));

    const targets = new Set(
      [...state.pellets, ...state.powers].filter((k) => {
        const [x, y] = k.split(',').map(Number);
        return visible({ x, y });
      }),
    );
    const moves = legalMoves(walls, pos);
    if (moves.length === 0) return free(null);
    // Under fog the planner may only route through cells it can see.
    const known = radius === null ? walls : visibleWalls(walls, pos, radius);
    const planned = targets.size > 0 ? firstStepToNearest(known, pos, targets, blocked) : null;
    if (planned) return free(planned);

    if (threats.length === 0) return free(radius === null ? moves[0] : wander(ctx, moves));
    const safety = (d: Direction) => Math.min(...threats.map((t) => manhattan(moved(pos, d), t)));
    let best = moves[0];
    for (const d of moves) if (safety(d) > safety(best)) best = d;
    return free(best);
  }
}

/** Plays a fixed direction cycle. For tests and offline end-to-end runs. */
export class ScriptedAgent implements Agent {
  readonly kind = 'baseline' as const;
  private i = 0;
  constructor(readonly id: string, readonly label: string, private readonly dirs: Direction[]) {}
  async decide(ctx: DecideContext): Promise<Decision> {
    return free(this.dirs[this.i++ % this.dirs.length]);
  }
}
