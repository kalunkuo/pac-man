import { DELTA, DIRS, bfsDistances, key, legalMoves } from './grid';
import { makeRng, shuffle, type Rng } from './rng';
import type { Complexity, Maze, MazeMetrics, Vec } from './types';

/** Share of dead ends that get a wall removed (creates loops). */
const BRAID: Record<Complexity, number> = { simple: 1, medium: 0.5, complex: 0 };
/** Share of interior cells knocked open at random (creates open areas). */
const EXTRA_OPEN: Record<Complexity, number> = { simple: 0.06, medium: 0, complex: 0 };

const CELL_STEPS: [number, number][] = [
  [2, 0],
  [-2, 0],
  [0, 2],
  [0, -2],
];

const toOdd = (n: number): number => (n % 2 === 0 ? n + 1 : n);

export function generateMaze(width: number, height: number, complexity: Complexity, seed: number): Maze {
  if (width < 7 || height < 7) throw new Error('maze must be at least 7x7');
  const w = toOdd(width);
  const h = toOdd(height);
  const rng = makeRng(seed);
  const walls: boolean[][] = Array.from({ length: h }, () => Array<boolean>(w).fill(true));

  carve(walls, rng);
  braid(walls, BRAID[complexity], rng);
  openRandomCells(walls, EXTRA_OPEN[complexity], rng);

  const pacStart: Vec = { x: 1, y: 1 };
  const dist = bfsDistances(walls, pacStart);
  const open: Vec[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (dist[y][x] >= 0) open.push({ x, y });

  let ghostStart = pacStart;
  let farthest = -1;
  for (const p of open) {
    if (dist[p.y][p.x] > farthest) {
      farthest = dist[p.y][p.x];
      ghostStart = p;
    }
  }

  const taken = new Set([key(pacStart), key(ghostStart)]);
  const powerSpots: Vec[] = [];
  for (const corner of [pacStart, { x: w - 2, y: 1 }, { x: 1, y: h - 2 }, { x: w - 2, y: h - 2 }]) {
    const nearest = [...open]
      .sort((a, b) => manhattan(a, corner) - manhattan(b, corner))
      .find((p) => !taken.has(key(p)));
    if (nearest) {
      powerSpots.push(nearest);
      taken.add(key(nearest));
    }
  }
  const pelletSpots = open.filter((p) => !taken.has(key(p)));

  return {
    width: w,
    height: h,
    walls,
    pacStart,
    ghostStart,
    pelletSpots,
    powerSpots,
    metrics: computeMetrics(walls),
  };
}

const manhattan = (a: Vec, b: Vec): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** Depth-first carve from (1,1) over odd coordinates: a perfect maze. */
function carve(walls: boolean[][], rng: Rng): void {
  const h = walls.length;
  const w = walls[0].length;
  walls[1][1] = false;
  const stack: Vec[] = [{ x: 1, y: 1 }];
  while (stack.length > 0) {
    const c = stack[stack.length - 1];
    const next = shuffle([...CELL_STEPS], rng).find(([dx, dy]) => {
      const nx = c.x + dx;
      const ny = c.y + dy;
      return nx > 0 && ny > 0 && nx < w - 1 && ny < h - 1 && walls[ny][nx];
    });
    if (!next) {
      stack.pop();
      continue;
    }
    const [dx, dy] = next;
    walls[c.y + dy / 2][c.x + dx / 2] = false;
    walls[c.y + dy][c.x + dx] = false;
    stack.push({ x: c.x + dx, y: c.y + dy });
  }
}

/** Remove one wall next to a dead end (with probability) so the dead end joins another corridor. */
function braid(walls: boolean[][], probability: number, rng: Rng): void {
  const h = walls.length;
  const w = walls[0].length;
  const inside = (x: number, y: number) => x > 0 && y > 0 && x < w - 1 && y < h - 1;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (walls[y][x] || legalMoves(walls, { x, y }).length !== 1) continue;
      if (rng() >= probability) continue;
      const candidates = DIRS.filter((d) => {
        const wx = x + DELTA[d].x;
        const wy = y + DELTA[d].y;
        const bx = x + 2 * DELTA[d].x;
        const by = y + 2 * DELTA[d].y;
        return inside(wx, wy) && walls[wy][wx] && inside(bx, by) && !walls[by][bx];
      });
      if (candidates.length === 0) continue;
      const d = candidates[Math.floor(rng() * candidates.length)];
      walls[y + DELTA[d].y][x + DELTA[d].x] = false;
    }
  }
}

/** Open random interior cells, but only ones touching an open cell so nothing becomes isolated. */
function openRandomCells(walls: boolean[][], fraction: number, rng: Rng): void {
  const h = walls.length;
  const w = walls[0].length;
  const count = Math.floor(w * h * fraction);
  for (let i = 0; i < count; i++) {
    const x = 1 + Math.floor(rng() * (w - 2));
    const y = 1 + Math.floor(rng() * (h - 2));
    if (walls[y][x] && legalMoves(walls, { x, y }).length > 0) walls[y][x] = false;
  }
}

function computeMetrics(walls: boolean[][]): MazeMetrics {
  let open = 0;
  let deadEnds = 0;
  let junctions = 0;
  let degreeSum = 0;
  for (let y = 0; y < walls.length; y++) {
    for (let x = 0; x < walls[0].length; x++) {
      if (walls[y][x]) continue;
      const degree = legalMoves(walls, { x, y }).length;
      open++;
      degreeSum += degree;
      if (degree === 1) deadEnds++;
      if (degree >= 3) junctions++;
    }
  }
  const edges = degreeSum / 2;
  return {
    deadEnds,
    loops: edges - open + 1, // cyclomatic number of a connected graph
    avgCorridorLength: open / Math.max(1, junctions + deadEnds),
  };
}
