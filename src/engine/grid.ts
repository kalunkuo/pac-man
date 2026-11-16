import type { Direction, Vec } from './types';

export const DIRS: Direction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
export const DELTA: Record<Direction, Vec> = {
  UP: { x: 0, y: -1 },
  DOWN: { x: 0, y: 1 },
  LEFT: { x: -1, y: 0 },
  RIGHT: { x: 1, y: 0 },
};
export const OPPOSITE: Record<Direction, Direction> = {
  UP: 'DOWN',
  DOWN: 'UP',
  LEFT: 'RIGHT',
  RIGHT: 'LEFT',
};

export const key = (p: Vec): string => `${p.x},${p.y}`;
export const same = (a: Vec, b: Vec): boolean => a.x === b.x && a.y === b.y;

export function isOpen(walls: boolean[][], p: Vec): boolean {
  return p.y >= 0 && p.y < walls.length && p.x >= 0 && p.x < walls[0].length && !walls[p.y][p.x];
}

export function moved(p: Vec, d: Direction): Vec {
  return { x: p.x + DELTA[d].x, y: p.y + DELTA[d].y };
}

export function legalMoves(walls: boolean[][], p: Vec): Direction[] {
  return DIRS.filter((d) => isOpen(walls, moved(p, d)));
}

/** Shortest-path step counts from `from` to every cell. -1 means unreachable or wall. */
export function bfsDistances(walls: boolean[][], from: Vec): number[][] {
  const dist = walls.map((row) => row.map(() => -1));
  if (!isOpen(walls, from)) return dist;
  dist[from.y][from.x] = 0;
  const queue: Vec[] = [from];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    for (const d of DIRS) {
      const n = moved(cur, d);
      if (isOpen(walls, n) && dist[n.y][n.x] === -1) {
        dist[n.y][n.x] = dist[cur.y][cur.x] + 1;
        queue.push(n);
      }
    }
  }
  return dist;
}
