# Pacman arena implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser Pac-Man game where Jev, other System 1 models and a regular LLM (all via OpenRouter) plus free baselines compete across a matrix of maze size, obstacle complexity and ghost pressure, with a hard cost cap.

**Architecture:** A pure, seeded TypeScript engine (`src/engine`) is driven in real time by a `GameSession` that asks `Agent`s for moves asynchronously, so slow models keep their last direction until their answer arrives. LLM agents call a local Node proxy (`src/server`) that holds the OpenRouter key and enforces a budget. A vanilla TS and canvas UI (`src/ui`) runs benchmark mode (one board per model, same seed) or arena mode (all models in one maze) and shows a results heatmap.

**Tech stack:** TypeScript, Vite, Vitest, tsx, Node 22 (no runtime dependencies, no framework).

## Global constraints

- Work only inside `.` (already a git repo with the spec committed).
- Node 22 and npm. No runtime dependencies. Dev dependencies only: `typescript vite vitest tsx @types/node`.
- The OpenRouter key lives only in `config/.env` (git-ignored). Never commit it, never send it to the browser, never log it.
- Never save markdown to the repo root. Docs go in `docs/`. Config goes in `config/`. (Tooling files `package.json`, `tsconfig.json`, `vite.config.ts` and `index.html` must stay at the root.)
- The engine (`src/engine`) is pure: no I/O, no `Date`, no `Math.random`. All randomness comes from `makeRng(seed)`.
- Reply format from models is one word: `UP`, `DOWN`, `LEFT` or `RIGHT`. LLM requests use `max_tokens` 16 and `temperature` 0.
- All tests must pass with no network and cost $0. Never call OpenRouter in tests.
- Code style: 2-space indent, single quotes, semicolons, named exports, no default exports. Comments only where the reason is non-obvious.
- UI copy uses sentence case.
- Commit after every task using the message shown. Each commit message ends with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` after a blank line.

## File structure

```
package.json  tsconfig.json  vite.config.ts  index.html
config/.env.example
docs/usage.md
src/engine/   types.ts rng.ts grid.ts maze.ts engine.ts
src/agents/   types.ts prompt.ts parse.ts observation.ts baselines.ts openrouter.ts
src/server/   budget.ts decide.ts results-store.ts index.ts
src/runner/   scenarios.ts types.ts session.ts run-plan.ts estimate.ts aggregate.ts
src/ui/       main.ts render.ts panels.ts
src/models.config.ts
tests/        helpers.ts grid.test.ts maze.test.ts engine.test.ts agents.test.ts
              openrouter.test.ts server.test.ts session.test.ts runner.test.ts e2e.test.ts
```

---

### Task 1: Scaffold, core types, RNG and grid helpers

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`
- Create: `src/engine/types.ts`, `src/engine/rng.ts`, `src/engine/grid.ts`
- Create: `tests/helpers.ts`, `tests/grid.test.ts`

**Interfaces:**
- Produces (used by every later task):
  - `src/engine/types.ts`: `Direction`, `Vec`, `Complexity`, `GhostBehavior`, `ScenarioConfig`, `MazeMetrics`, `Maze`, `Player`, `Ghost`, `GameState`
  - `src/engine/rng.ts`: `type Rng = () => number`, `makeRng(seed: number): Rng`, `shuffle<T>(items: T[], rng: Rng): T[]`
  - `src/engine/grid.ts`: `DIRS`, `DELTA`, `OPPOSITE`, `key(p)`, `same(a, b)`, `isOpen(walls, p)`, `moved(p, d)`, `legalMoves(walls, p)`, `bfsDistances(walls, from)`
  - `tests/helpers.ts`: `parseWalls(rows: string[]): boolean[][]`, `config(over?: Partial<ScenarioConfig>): ScenarioConfig`

- [ ] **Step 1: Create the project files**

`package.json`:

```json
{
  "name": "pacman-arena",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "server": "tsx --env-file=config/.env src/server/index.ts",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "types": ["node"]
  },
  "include": ["src", "tests", "vite.config.ts"]
}
```

`vite.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  test: { include: ['tests/**/*.test.ts'] },
});
```

- [ ] **Step 2: Install dev dependencies**

Run: `cd <repo root> && npm install -D typescript vite vitest tsx @types/node`
Expected: installs without errors, creates `node_modules/` and `package-lock.json`.

- [ ] **Step 3: Write `src/engine/types.ts`**

```ts
import type { Rng } from './rng';

export type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
export interface Vec {
  x: number;
  y: number;
}
export type Complexity = 'simple' | 'medium' | 'complex';
export type GhostBehavior = 'chase' | 'ambush' | 'random';

export interface ScenarioConfig {
  width: number;
  height: number;
  complexity: Complexity;
  ghostCount: number;
  ghostBehavior: GhostBehavior | 'mixed';
  seed: number;
  lives: number;
  maxTicks: number;
}

export interface MazeMetrics {
  deadEnds: number;
  loops: number;
  /** open cells divided by (junctions + dead ends) */
  avgCorridorLength: number;
}

export interface Maze {
  width: number;
  height: number;
  /** walls[y][x] is true for a wall */
  walls: boolean[][];
  pacStart: Vec;
  ghostStart: Vec;
  pelletSpots: Vec[];
  powerSpots: Vec[];
  metrics: MazeMetrics;
}

export interface Player {
  id: string;
  pos: Vec;
  dir: Direction;
  wantDir: Direction;
  score: number;
  lives: number;
  alive: boolean;
  invulnerableUntil: number;
  diedAtTick: number | null;
}

export interface Ghost {
  pos: Vec;
  dir: Direction;
  behavior: GhostBehavior;
}

export interface GameState {
  config: ScenarioConfig;
  level: number;
  tick: number;
  maze: Maze;
  pellets: Set<string>;
  powers: Set<string>;
  players: Player[];
  ghosts: Ghost[];
  frightenedTicks: number;
  status: 'running' | 'over';
  rng: Rng;
}
```

- [ ] **Step 4: Write `src/engine/rng.ts`**

```ts
export type Rng = () => number;

/** mulberry32: small, fast, deterministic. Returns floats in [0, 1). */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** In-place Fisher-Yates shuffle. */
export function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
```

- [ ] **Step 5: Write `src/engine/grid.ts`**

```ts
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
```

- [ ] **Step 6: Write `tests/helpers.ts`**

```ts
import type { ScenarioConfig } from '../src/engine/types';

/** '#' is a wall, anything else is open. */
export function parseWalls(rows: string[]): boolean[][] {
  return rows.map((r) => [...r].map((c) => c === '#'));
}

export function config(over: Partial<ScenarioConfig> = {}): ScenarioConfig {
  return {
    width: 11,
    height: 11,
    complexity: 'simple',
    ghostCount: 1,
    ghostBehavior: 'chase',
    seed: 1,
    lives: 3,
    maxTicks: 500,
    ...over,
  };
}
```

- [ ] **Step 7: Write the tests `tests/grid.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { bfsDistances, isOpen, legalMoves, moved } from '../src/engine/grid';
import { makeRng, shuffle } from '../src/engine/rng';
import { parseWalls } from './helpers';

describe('rng', () => {
  it('is deterministic per seed and stays in [0, 1)', () => {
    const a = makeRng(7);
    const b = makeRng(7);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('differs between seeds', () => {
    expect(makeRng(1)()).not.toBe(makeRng(2)());
  });

  it('shuffle keeps all items', () => {
    const out = shuffle([1, 2, 3, 4, 5], makeRng(3));
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('grid', () => {
  const walls = parseWalls(['#####', '#...#', '#.#.#', '#...#', '#####']);

  it('isOpen handles walls and out of bounds', () => {
    expect(isOpen(walls, { x: 1, y: 1 })).toBe(true);
    expect(isOpen(walls, { x: 2, y: 2 })).toBe(false);
    expect(isOpen(walls, { x: -1, y: 0 })).toBe(false);
    expect(isOpen(walls, { x: 9, y: 9 })).toBe(false);
  });

  it('legalMoves lists open neighbours', () => {
    expect(legalMoves(walls, { x: 1, y: 1 }).sort()).toEqual(['DOWN', 'RIGHT']);
  });

  it('moved applies the direction delta', () => {
    expect(moved({ x: 2, y: 2 }, 'UP')).toEqual({ x: 2, y: 1 });
  });

  it('bfsDistances computes shortest paths', () => {
    const d = bfsDistances(walls, { x: 1, y: 1 });
    expect(d[1][1]).toBe(0);
    expect(d[3][3]).toBe(4);
    expect(d[2][2]).toBe(-1);
  });
});
```

- [ ] **Step 8: Run tests and typecheck**

Run: `cd <repo root> && npm test && npm run typecheck`
Expected: all tests in `tests/grid.test.ts` PASS, typecheck exits 0.

- [ ] **Step 9: Commit**

```bash
cd <repo root>
git add package.json package-lock.json tsconfig.json vite.config.ts src tests
git commit -m "feat: scaffold project with engine types, rng and grid helpers

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Seeded maze generation with complexity levels

**Files:**
- Create: `src/engine/maze.ts`
- Test: `tests/maze.test.ts`

**Interfaces:**
- Consumes: `makeRng`, `shuffle`, `DIRS`, `DELTA`, `legalMoves`, `bfsDistances`, `key` from Task 1; types `Maze`, `MazeMetrics`, `Complexity`, `Vec`.
- Produces: `generateMaze(width: number, height: number, complexity: Complexity, seed: number): Maze`. Even sizes are rounded up to odd. Throws if width or height is below 7.

How complexity works: a depth-first carve makes a perfect maze (no loops, many dead ends). `complex` keeps that. `medium` removes walls at half the dead ends (loops appear). `simple` removes walls at every dead end and also knocks out about 6% of interior cells at random (open areas, many loops).

- [ ] **Step 1: Write the failing tests `tests/maze.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { bfsDistances, key } from '../src/engine/grid';
import { generateMaze } from '../src/engine/maze';
import type { Complexity } from '../src/engine/types';

const SEEDS = [1, 2, 3, 4, 5];

function sumMetric(c: Complexity, field: 'deadEnds' | 'loops'): number {
  return SEEDS.reduce((acc, s) => acc + generateMaze(21, 21, c, s).metrics[field], 0);
}

describe('generateMaze', () => {
  it('rounds even sizes up to odd and rejects tiny mazes', () => {
    const m = generateMaze(10, 12, 'medium', 1);
    expect(m.width).toBe(11);
    expect(m.height).toBe(13);
    expect(() => generateMaze(5, 5, 'simple', 1)).toThrow();
  });

  it('is deterministic per seed and differs between seeds', () => {
    const a = generateMaze(21, 21, 'medium', 3);
    const b = generateMaze(21, 21, 'medium', 3);
    const c = generateMaze(21, 21, 'medium', 4);
    expect(a.walls).toEqual(b.walls);
    expect(a.walls).not.toEqual(c.walls);
  });

  it('keeps the outer border solid', () => {
    const m = generateMaze(21, 21, 'simple', 2);
    for (let i = 0; i < 21; i++) {
      expect(m.walls[0][i]).toBe(true);
      expect(m.walls[20][i]).toBe(true);
      expect(m.walls[i][0]).toBe(true);
      expect(m.walls[i][20]).toBe(true);
    }
  });

  it.each(['simple', 'medium', 'complex'] as Complexity[])(
    'every open cell is reachable from the start (%s)',
    (c) => {
      for (const s of SEEDS) {
        const m = generateMaze(21, 21, c, s);
        const dist = bfsDistances(m.walls, m.pacStart);
        for (let y = 0; y < m.height; y++)
          for (let x = 0; x < m.width; x++) if (!m.walls[y][x]) expect(dist[y][x]).toBeGreaterThanOrEqual(0);
      }
    },
  );

  it('orders complexity: complex has no loops and the most dead ends', () => {
    expect(sumMetric('complex', 'loops')).toBe(0);
    expect(sumMetric('simple', 'loops')).toBeGreaterThan(sumMetric('medium', 'loops'));
    expect(sumMetric('medium', 'loops')).toBeGreaterThan(0);
    expect(sumMetric('complex', 'deadEnds')).toBeGreaterThan(sumMetric('medium', 'deadEnds'));
    expect(sumMetric('medium', 'deadEnds')).toBeGreaterThan(sumMetric('simple', 'deadEnds'));
  });

  it('places pellets only on reachable cells, away from the starts', () => {
    const m = generateMaze(21, 21, 'medium', 1);
    const dist = bfsDistances(m.walls, m.pacStart);
    const forbidden = new Set([key(m.pacStart), key(m.ghostStart)]);
    for (const p of [...m.pelletSpots, ...m.powerSpots]) {
      expect(dist[p.y][p.x]).toBeGreaterThanOrEqual(0);
      expect(forbidden.has(key(p))).toBe(false);
    }
    expect(m.powerSpots.length).toBeGreaterThan(0);
    expect(m.powerSpots.length).toBeLessThanOrEqual(4);
    expect(m.pelletSpots.length).toBeGreaterThan(20);
  });

  it('puts the ghost start at the cell farthest from the pac start', () => {
    const m = generateMaze(21, 21, 'complex', 1);
    const dist = bfsDistances(m.walls, m.pacStart);
    const max = Math.max(...dist.flat());
    expect(dist[m.ghostStart.y][m.ghostStart.x]).toBe(max);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd <repo root> && npx vitest run tests/maze.test.ts`
Expected: FAIL (cannot resolve `../src/engine/maze`).

- [ ] **Step 3: Write `src/engine/maze.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd <repo root> && npx vitest run tests/maze.test.ts`
Expected: all tests PASS. If the complexity-ordering test fails because two sums tie or invert, do not weaken the test: adjust `BRAID` and `EXTRA_OPEN` values (keep simple > medium > complex in loops) and rerun.

- [ ] **Step 5: Commit**

```bash
cd <repo root>
git add src/engine/maze.ts tests/maze.test.ts
git commit -m "feat: seeded maze generation with three complexity levels

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Game engine (players, ghosts, scoring, levels)

**Files:**
- Create: `src/engine/engine.ts`
- Test: `tests/engine.test.ts`

**Interfaces:**
- Consumes: Task 1 and Task 2 exports.
- Produces (from `src/engine/engine.ts`):
  - `SCORE = { pellet: 10, power: 50, ghost: 200, levelClear: 500 }`, `FRIGHTENED_TICKS = 40`, `INVULNERABLE_TICKS = 10`
  - `levelConfig(base: ScenarioConfig, level: number): ScenarioConfig`
  - `createGame(config: ScenarioConfig, playerIds: string[]): GameState`
  - `setDirection(state: GameState, playerId: string, dir: Direction): void`
  - `eliminate(state: GameState, playerId: string): void`
  - `step(state: GameState): void` (mutates `state`, one tick)

Rules to implement exactly:
- Players move one cell per tick. If `wantDir` is open they turn and move; otherwise they continue in `dir` if open; otherwise stay.
- Ghosts move every `base` ticks, where `base` is 2 for levels 1 and 2 and 1 from level 3 on. While frightened the period is `base + 1`. Ghosts never reverse unless at a dead end. Behaviors: `chase` (shortest path to the nearest alive player), `ambush` (shortest path to the cell up to 4 steps ahead of the nearest player along its direction), `random`. Frightened ghosts flee the nearest player whatever their behavior.
- The ghost RNG is called exactly once per ghost per tick, always, so the random sequence never depends on game state.
- Collision when positions are equal or when a player and a ghost swapped cells this tick. Frightened ghost: player gets `SCORE.ghost` and the ghost returns to `ghostStart`. Otherwise, unless invulnerable, the player loses a life and respawns at `pacStart` with `INVULNERABLE_TICKS` of protection; at zero lives the player is out.
- When all pellets and power pellets are gone, every alive player gets `SCORE.levelClear` and the next level loads (bigger maze, more ghosts, same players, scores and lives kept).
- The game is over when no player is alive or `tick >= config.maxTicks`.
- `levelConfig`: grow = 4 × (level − 1); width and height = min(base + grow, 41); ghostCount = min(base + floor((level − 1) / 2), 6); seed = base.seed + level − 1.

- [ ] **Step 1: Write the failing tests `tests/engine.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  SCORE,
  createGame,
  eliminate,
  levelConfig,
  setDirection,
  step,
} from '../src/engine/engine';
import { key, legalMoves, moved } from '../src/engine/grid';
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
    // ghost sits where the player is going, and is forced to step into the player's cell
    state.ghosts = [{ pos: { ...next }, dir: back[dir] === 'UP' ? 'DOWN' : 'UP', behavior: 'chase' }];
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd <repo root> && npx vitest run tests/engine.test.ts`
Expected: FAIL (cannot resolve `../src/engine/engine`).

- [ ] **Step 3: Write `src/engine/engine.ts`**

```ts
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
    width: Math.min(base.width + grow, 41),
    height: Math.min(base.height + grow, 41),
    ghostCount: Math.min(base.ghostCount + Math.floor((level - 1) / 2), 6),
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

  for (const p of state.players) {
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
  resolveCollisions(state, prevPlayers, prevGhosts);
  if (state.frightenedTicks > 0) state.frightenedTicks--;

  if (state.pellets.size === 0 && state.powers.size === 0) {
    for (const p of state.players) if (p.alive) p.score += SCORE.levelClear;
    loadLevel(state, state.level + 1);
  }
  checkOver(state);
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

function resolveCollisions(state: GameState, prevPlayers: Vec[], prevGhosts: Vec[]): void {
  state.players.forEach((p, pi) => {
    if (!p.alive) return;
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
      return;
    }
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd <repo root> && npx vitest run tests/engine.test.ts && npm run typecheck`
Expected: all PASS, typecheck exits 0.

If the "swap collision" test fails because the chase ghost does not step into the player's cell (it picks a different direction), fix the test setup, not the engine: choose the ghost direction so that its only forward choice is toward the player's start cell, for example by placing the ghost in a dead-end corridor next to `pacStart`. The engine rule under test is: positions swapped during one tick count as a hit.

- [ ] **Step 5: Commit**

```bash
cd <repo root>
git add src/engine/engine.ts tests/engine.test.ts
git commit -m "feat: seeded multi-player game engine with ghosts, scoring and levels

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Agent interface, observation encoding, reply parsing, baselines

**Files:**
- Create: `src/agents/types.ts`, `src/agents/prompt.ts`, `src/agents/parse.ts`, `src/agents/observation.ts`, `src/agents/baselines.ts`
- Test: `tests/agents.test.ts`

**Interfaces:**
- Consumes: Task 1 to 3 exports.
- Produces:
  - `src/agents/types.ts`:
    ```ts
    export interface Observation { text: string; legalMoves: Direction[]; score: number; lives: number; level: number; tick: number }
    export interface DecideContext { observation: Observation; state: GameState; playerId: string }
    export interface Decision { dir: Direction | null; latencyMs: number; costUsd: number; error?: string }
    export interface Agent { id: string; label: string; kind: 'baseline' | 'llm'; decide(ctx: DecideContext): Promise<Decision> }
    export class BudgetExceededError extends Error {}
    ```
  - `src/agents/prompt.ts`: `SYSTEM_PROMPT: string`
  - `src/agents/parse.ts`: `parseDirection(text: string): Direction | null`
  - `src/agents/observation.ts`: `encodeObservation(state: GameState, playerId: string): Observation`
  - `src/agents/baselines.ts`: `RandomAgent(id, label, seed)`, `GreedyAgent(id, label)`, `PlannerAgent(id, label)`, `ScriptedAgent(id, label, dirs: Direction[])`, `firstStepToNearest(walls, start, targets, blocked): Direction | null`. All have `kind: 'baseline'`, return `latencyMs: 0` and `costUsd: 0` so runs are deterministic.

- [ ] **Step 1: Write the failing tests `tests/agents.test.ts`**

```ts
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

  it('firstStepToNearest returns null when nothing is reachable', () => {
    const walls = parseWalls(['#####', '#.#.#', '#####']);
    expect(firstStepToNearest(walls, { x: 1, y: 1 }, new Set(['3,1']), new Set())).toBeNull();
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd <repo root> && npx vitest run tests/agents.test.ts`
Expected: FAIL (cannot resolve `../src/agents/...`).

- [ ] **Step 3: Write `src/agents/types.ts`**

```ts
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
```

- [ ] **Step 4: Write `src/agents/prompt.ts` and `src/agents/parse.ts`**

`src/agents/prompt.ts`:

```ts
export const SYSTEM_PROMPT = `You are playing Pac-Man. Each turn you see the maze as text and must choose a direction.
Legend: # wall, . pellet, o power pellet, - empty, P you, p another player, G ghost (deadly), g frightened ghost (edible).
Rows go top to bottom. UP moves to the row above, DOWN moves to the row below.
Eat every pellet and avoid ghosts. Power pellets make ghosts edible for a short time.
Reply with exactly one word: UP, DOWN, LEFT or RIGHT.`;
```

`src/agents/parse.ts`:

```ts
import type { Direction } from '../engine/types';

export function parseDirection(text: string): Direction | null {
  const m = text.toUpperCase().match(/\b(UP|DOWN|LEFT|RIGHT)\b/);
  return m ? (m[1] as Direction) : null;
}
```

- [ ] **Step 5: Write `src/agents/observation.ts`**

```ts
import { legalMoves } from '../engine/grid';
import type { GameState } from '../engine/types';
import type { Observation } from './types';

export function encodeObservation(state: GameState, playerId: string): Observation {
  const me = state.players.find((p) => p.id === playerId);
  if (!me) throw new Error(`unknown player ${playerId}`);
  const frightened = state.frightenedTicks > 0;

  const rows = state.maze.walls.map((row, y) =>
    row
      .map((wall, x) => {
        if (wall) return '#';
        if (me.pos.x === x && me.pos.y === y) return 'P';
        if (state.ghosts.some((g) => g.pos.x === x && g.pos.y === y)) return frightened ? 'g' : 'G';
        if (state.players.some((p) => p.id !== playerId && p.alive && p.pos.x === x && p.pos.y === y)) return 'p';
        const k = `${x},${y}`;
        if (state.powers.has(k)) return 'o';
        if (state.pellets.has(k)) return '.';
        return '-';
      })
      .join(''),
  );

  const moves = legalMoves(state.maze.walls, me.pos);
  const text =
    `Level ${state.level}, score ${me.score}, lives ${me.lives}, you are moving ${me.dir}.\n` +
    `Legal moves: ${moves.join(', ')}\n` +
    rows.join('\n');

  return { text, legalMoves: moves, score: me.score, lives: me.lives, level: state.level, tick: state.tick };
}
```

- [ ] **Step 6: Write `src/agents/baselines.ts`**

```ts
import { DIRS, key, legalMoves, moved, isOpen } from '../engine/grid';
import { makeRng, type Rng } from '../engine/rng';
import type { Direction, Vec } from '../engine/types';
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

export class RandomAgent implements Agent {
  readonly kind = 'baseline' as const;
  private readonly rng: Rng;
  constructor(readonly id: string, readonly label: string, seed: number) {
    this.rng = makeRng(seed);
  }
  async decide(ctx: DecideContext): Promise<Decision> {
    const moves = legalMoves(ctx.state.maze.walls, me(ctx).pos);
    return free(moves.length ? moves[Math.floor(this.rng() * moves.length)] : null);
  }
}

/** Heads for the nearest pellet by straight-line distance and ignores ghosts. */
export class GreedyAgent implements Agent {
  readonly kind = 'baseline' as const;
  constructor(readonly id: string, readonly label: string) {}
  async decide(ctx: DecideContext): Promise<Decision> {
    const { state } = ctx;
    const pos = me(ctx).pos;
    const moves = legalMoves(state.maze.walls, pos);
    const targets = [...state.pellets, ...state.powers].map((k) => {
      const [x, y] = k.split(',').map(Number);
      return { x, y };
    });
    if (moves.length === 0) return free(null);
    if (targets.length === 0) return free(moves[0]);
    const cost = (d: Direction) => Math.min(...targets.map((t) => manhattan(moved(pos, d), t)));
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
    const threats = state.frightenedTicks > 0 ? [] : state.ghosts.map((g) => g.pos);

    const blocked = new Set<string>();
    for (const t of threats)
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          if (Math.abs(dx) + Math.abs(dy) <= 2) blocked.add(key({ x: t.x + dx, y: t.y + dy }));
    blocked.delete(key(pos));

    const targets = new Set([...state.pellets, ...state.powers]);
    const planned = firstStepToNearest(walls, pos, targets, blocked);
    if (planned) return free(planned);

    const moves = legalMoves(walls, pos);
    if (moves.length === 0) return free(null);
    if (threats.length === 0) return free(moves[0]);
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
  async decide(): Promise<Decision> {
    return free(this.dirs[this.i++ % this.dirs.length]);
  }
}
```

- [ ] **Step 7: Run tests and typecheck**

Run: `cd <repo root> && npx vitest run tests/agents.test.ts && npm run typecheck`
Expected: all PASS, typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
cd <repo root>
git add src/agents tests/agents.test.ts
git commit -m "feat: agent interface, observation encoding, reply parsing and baseline agents

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: OpenRouter agent and budget-capped proxy server

**Files:**
- Create: `src/agents/openrouter.ts`
- Create: `src/server/budget.ts`, `src/server/decide.ts`, `src/server/results-store.ts`, `src/server/index.ts`
- Create: `config/.env.example`
- Test: `tests/openrouter.test.ts`, `tests/server.test.ts`

**Interfaces:**
- Consumes: `Agent`, `DecideContext`, `Decision`, `BudgetExceededError` (Task 4), `SYSTEM_PROMPT`, `parseDirection`.
- Produces:
  - `src/agents/openrouter.ts`: `OpenRouterAgent` with constructor options `{ id: string; label: string; model: string; baseUrl?: string; fetchImpl?: typeof fetch }`. `kind` is `'llm'`. It POSTs `{ model, system, user }` to `${baseUrl ?? ''}/api/decide`, throws `BudgetExceededError` on HTTP 402, and returns `{ dir: null, error }` on network, HTTP, JSON or parse failures.
  - `src/server/budget.ts`: `class Budget { constructor(budgetUsd = 1, maxCalls = 5000); spentUsd; calls; exhausted(): boolean; record(costUsd: number): void; reset(budgetUsd: number, maxCalls: number): void; snapshot(): { budgetUsd; maxCalls; spentUsd; calls } }`
  - `src/server/decide.ts`: `buildPayload(body)`, `handleDecide(body: unknown, deps: { apiKey: string; budget: Budget; fetchImpl: typeof fetch }): Promise<{ status: number; json: unknown }>`. Success JSON is `{ text: string, costUsd: number }`.
  - `src/server/results-store.ts`: `saveResults(dir, runId, results)`, `listResults(dir)`.
  - HTTP routes on `127.0.0.1:8787`: `POST /api/decide`, `GET /api/budget`, `POST /api/budget {budgetUsd, maxCalls}`, `GET /api/results`, `POST /api/results {runId, results}`.

- [ ] **Step 1: Write the failing tests `tests/openrouter.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { OpenRouterAgent } from '../src/agents/openrouter';
import { encodeObservation } from '../src/agents/observation';
import { BudgetExceededError, type DecideContext } from '../src/agents/types';
import { createGame } from '../src/engine/engine';
import { config } from './helpers';

function ctx(): DecideContext {
  const state = createGame(config(), ['a']);
  return { observation: encodeObservation(state, 'a'), state, playerId: 'a' };
}

const json = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

function agent(fetchImpl: typeof fetch) {
  return new OpenRouterAgent({ id: 'm', label: 'M', model: 'vendor/model', fetchImpl });
}

describe('OpenRouterAgent', () => {
  it('sends model, system prompt and observation to the proxy and parses the move', async () => {
    const fetchImpl = json({ text: 'LEFT', costUsd: 0.0002 });
    const c = ctx();
    const d = await agent(fetchImpl).decide(c);
    expect(d).toMatchObject({ dir: 'LEFT', costUsd: 0.0002 });
    expect(d.latencyMs).toBeGreaterThanOrEqual(0);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/decide');
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.model).toBe('vendor/model');
    expect(sent.user).toBe(c.observation.text);
    expect(sent.system).toContain('Pac-Man');
  });

  it('is an llm agent', () => {
    expect(agent(json({})).kind).toBe('llm');
  });

  it('throws BudgetExceededError on HTTP 402', async () => {
    await expect(agent(json({ error: 'budget exceeded' }, 402)).decide(ctx())).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
  });

  it('reports an error for unparseable replies', async () => {
    const d = await agent(json({ text: 'I am not sure', costUsd: 0.001 })).decide(ctx());
    expect(d).toMatchObject({ dir: null, error: 'unparseable', costUsd: 0.001 });
  });

  it('reports an error for HTTP failures and network failures', async () => {
    expect((await agent(json({ error: 'x' }, 502)).decide(ctx())).error).toBe('http 502');
    const boom = vi.fn(async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    expect((await agent(boom).decide(ctx())).error).toBe('network');
  });
});
```

- [ ] **Step 2: Write the failing tests `tests/server.test.ts`**

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Budget } from '../src/server/budget';
import { buildPayload, handleDecide } from '../src/server/decide';
import { listResults, saveResults } from '../src/server/results-store';

const okFetch = () =>
  vi.fn(
    async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'UP' } }], usage: { cost: 0.0004 } }), {
        status: 200,
      }),
  ) as unknown as typeof fetch;

const body = { model: 'vendor/model-1', system: 'sys', user: 'maze' };

describe('Budget', () => {
  it('is exhausted by money or by call count', () => {
    const b = new Budget(0.01, 3);
    expect(b.exhausted()).toBe(false);
    b.record(0.004);
    b.record(0.004);
    expect(b.exhausted()).toBe(false);
    b.record(0.004);
    expect(b.exhausted()).toBe(true);
    b.reset(10, 2);
    expect(b.exhausted()).toBe(false);
    b.record(0);
    b.record(0);
    expect(b.exhausted()).toBe(true);
    expect(b.snapshot()).toEqual({ budgetUsd: 10, maxCalls: 2, spentUsd: 0, calls: 2 });
  });
});

describe('buildPayload', () => {
  it('caps tokens, uses temperature 0 and asks for usage cost', () => {
    const p = buildPayload(body) as Record<string, unknown>;
    expect(p.model).toBe('vendor/model-1');
    expect(p.max_tokens).toBe(16);
    expect(p.temperature).toBe(0);
    expect(p.usage).toEqual({ include: true });
    expect(p.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'maze' },
    ]);
  });
});

describe('handleDecide', () => {
  it('forwards to OpenRouter with the key and records the cost', async () => {
    const fetchImpl = okFetch();
    const budget = new Budget(1, 100);
    const r = await handleDecide(body, { apiKey: 'sk-test', budget, fetchImpl });
    expect(r).toEqual({ status: 200, json: { text: 'UP', costUsd: 0.0004 } });
    expect(budget.spentUsd).toBeCloseTo(0.0004);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((init as RequestInit & { headers: Record<string, string> }).headers.authorization).toBe('Bearer sk-test');
  });

  it('rejects invalid bodies without calling upstream', async () => {
    const fetchImpl = okFetch();
    const deps = { apiKey: 'k', budget: new Budget(), fetchImpl };
    for (const bad of [null, {}, { ...body, model: 'no-slash' }, { ...body, user: 'x'.repeat(20001) }])
      expect((await handleDecide(bad, deps)).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns 500 when the key is missing and 402 when the budget is spent', async () => {
    const fetchImpl = okFetch();
    expect((await handleDecide(body, { apiKey: '', budget: new Budget(), fetchImpl })).status).toBe(500);
    const spent = new Budget(0.001, 10);
    spent.record(0.001);
    expect((await handleDecide(body, { apiKey: 'k', budget: spent, fetchImpl })).status).toBe(402);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps upstream failures to 502', async () => {
    const bad = vi.fn(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    expect((await handleDecide(body, { apiKey: 'k', budget: new Budget(), fetchImpl: bad })).status).toBe(502);
    const down = vi.fn(async () => {
      throw new Error('x');
    }) as unknown as typeof fetch;
    expect((await handleDecide(body, { apiKey: 'k', budget: new Budget(), fetchImpl: down })).status).toBe(502);
  });

  it('treats a missing usage cost as zero and a missing reply as empty text', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })) as unknown as typeof fetch;
    const r = await handleDecide(body, { apiKey: 'k', budget: new Budget(), fetchImpl: f });
    expect(r).toEqual({ status: 200, json: { text: '', costUsd: 0 } });
  });
});

describe('results store', () => {
  it('saves and lists runs, and rejects unsafe run ids', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pacman-results-'));
    try {
      expect(await listResults(join(dir, 'missing'))).toEqual([]);
      await saveResults(dir, 'run-1', [{ score: 5 }]);
      await saveResults(dir, 'run-2', []);
      expect(await listResults(dir)).toEqual([
        { runId: 'run-1', results: [{ score: 5 }] },
        { runId: 'run-2', results: [] },
      ]);
      await expect(saveResults(dir, '../evil', [])).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `cd <repo root> && npx vitest run tests/openrouter.test.ts tests/server.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 4: Write `src/agents/openrouter.ts`**

```ts
import { SYSTEM_PROMPT } from './prompt';
import { parseDirection } from './parse';
import { BudgetExceededError, type Agent, type DecideContext, type Decision } from './types';

export interface OpenRouterAgentOptions {
  id: string;
  label: string;
  /** OpenRouter model id, for example `vendor/model-name` */
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** Asks a model for a move through the local proxy, which holds the API key and the budget. */
export class OpenRouterAgent implements Agent {
  readonly kind = 'llm' as const;
  readonly id: string;
  readonly label: string;

  constructor(private readonly opts: OpenRouterAgentOptions) {
    this.id = opts.id;
    this.label = opts.label;
  }

  async decide({ observation }: DecideContext): Promise<Decision> {
    const doFetch = this.opts.fetchImpl ?? fetch;
    const started = performance.now();
    const fail = (error: string, costUsd = 0): Decision => ({
      dir: null,
      latencyMs: performance.now() - started,
      costUsd,
      error,
    });

    let res: Response;
    try {
      res = await doFetch(`${this.opts.baseUrl ?? ''}/api/decide`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.opts.model, system: SYSTEM_PROMPT, user: observation.text }),
      });
    } catch {
      return fail('network');
    }
    const latencyMs = performance.now() - started;
    if (res.status === 402) throw new BudgetExceededError();
    if (!res.ok) return fail(`http ${res.status}`);

    let data: { text?: string; costUsd?: number };
    try {
      data = (await res.json()) as { text?: string; costUsd?: number };
    } catch {
      return fail('bad json');
    }
    const costUsd = data.costUsd ?? 0;
    const dir = parseDirection(data.text ?? '');
    return dir ? { dir, latencyMs, costUsd } : { dir: null, latencyMs, costUsd, error: 'unparseable' };
  }
}
```

- [ ] **Step 5: Write `src/server/budget.ts`**

```ts
/** Tracks spend and call count for one run. Checked before every upstream call. */
export class Budget {
  spentUsd = 0;
  calls = 0;

  constructor(
    public budgetUsd = 1,
    public maxCalls = 5000,
  ) {}

  exhausted(): boolean {
    return this.spentUsd >= this.budgetUsd || this.calls >= this.maxCalls;
  }

  record(costUsd: number): void {
    this.calls++;
    this.spentUsd += costUsd;
  }

  reset(budgetUsd: number, maxCalls: number): void {
    this.budgetUsd = budgetUsd;
    this.maxCalls = maxCalls;
    this.spentUsd = 0;
    this.calls = 0;
  }

  snapshot() {
    return { budgetUsd: this.budgetUsd, maxCalls: this.maxCalls, spentUsd: this.spentUsd, calls: this.calls };
  }
}
```

- [ ] **Step 6: Write `src/server/decide.ts`**

```ts
import type { Budget } from './budget';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL_RE = /^[\w.-]+\/[\w.:-]+$/;

export interface DecideBody {
  model: string;
  system: string;
  user: string;
}
export interface DecideDeps {
  apiKey: string;
  budget: Budget;
  fetchImpl: typeof fetch;
}
export interface HandlerResult {
  status: number;
  json: unknown;
}

export function buildPayload(body: DecideBody): object {
  return {
    model: body.model,
    messages: [
      { role: 'system', content: body.system },
      { role: 'user', content: body.user },
    ],
    max_tokens: 16,
    temperature: 0,
    usage: { include: true }, // makes OpenRouter return the real cost in usage.cost
    reasoning: { enabled: false }, // ignored by models without reasoning support
  };
}

export async function handleDecide(body: unknown, deps: DecideDeps): Promise<HandlerResult> {
  const b = body as Partial<DecideBody> | null;
  if (
    !b ||
    typeof b.model !== 'string' ||
    typeof b.system !== 'string' ||
    typeof b.user !== 'string' ||
    !MODEL_RE.test(b.model) ||
    b.user.length > 20000 ||
    b.system.length > 4000
  ) {
    return { status: 400, json: { error: 'invalid request' } };
  }
  if (!deps.apiKey) return { status: 500, json: { error: 'OPENROUTER_API_KEY is not set' } };
  if (deps.budget.exhausted()) return { status: 402, json: { error: 'budget exceeded' } };

  let upstream: Response;
  try {
    upstream = await deps.fetchImpl(OPENROUTER_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${deps.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(buildPayload(b as DecideBody)),
    });
  } catch {
    return { status: 502, json: { error: 'upstream unreachable' } };
  }
  if (!upstream.ok) return { status: 502, json: { error: `upstream ${upstream.status}` } };

  const data = (await upstream.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { cost?: number };
  };
  const costUsd = data.usage?.cost ?? 0;
  deps.budget.record(costUsd);
  return { status: 200, json: { text: data.choices?.[0]?.message?.content ?? '', costUsd } };
}
```

- [ ] **Step 7: Write `src/server/results-store.ts`**

```ts
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ID_RE = /^[\w-]{1,64}$/;

export async function saveResults(dir: string, runId: string, results: unknown): Promise<void> {
  if (!ID_RE.test(runId)) throw new Error('invalid run id');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${runId}.json`), JSON.stringify(results, null, 2));
}

export async function listResults(dir: string): Promise<{ runId: string; results: unknown }[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: { runId: string; results: unknown }[] = [];
  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    out.push({ runId: name.slice(0, -5), results: JSON.parse(await readFile(join(dir, name), 'utf8')) });
  }
  return out;
}
```

- [ ] **Step 8: Write `src/server/index.ts` and `config/.env.example`**

`src/server/index.ts`:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Budget } from './budget';
import { handleDecide } from './decide';
import { listResults, saveResults } from './results-store';

const PORT = Number(process.env.PORT ?? 8787);
const RESULTS_DIR = 'results';
const budget = new Budget();

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
}

function send(res: ServerResponse, status: number, json: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(json));
}

if (!process.env.OPENROUTER_API_KEY) {
  console.warn('OPENROUTER_API_KEY is not set (copy config/.env.example to config/.env). Baselines still work.');
}

createServer(async (req, res) => {
  try {
    const url = req.url ?? '';
    if (req.method === 'POST' && url === '/api/decide') {
      const r = await handleDecide(await readJson(req), {
        apiKey: process.env.OPENROUTER_API_KEY ?? '',
        budget,
        fetchImpl: fetch,
      });
      return send(res, r.status, r.json);
    }
    if (url === '/api/budget' && req.method === 'GET') return send(res, 200, budget.snapshot());
    if (url === '/api/budget' && req.method === 'POST') {
      const b = (await readJson(req)) as { budgetUsd?: unknown; maxCalls?: unknown } | null;
      if (!b || typeof b.budgetUsd !== 'number' || typeof b.maxCalls !== 'number' || b.budgetUsd < 0 || b.maxCalls < 0) {
        return send(res, 400, { error: 'invalid request' });
      }
      budget.reset(b.budgetUsd, b.maxCalls);
      return send(res, 200, budget.snapshot());
    }
    if (url === '/api/results' && req.method === 'GET') return send(res, 200, await listResults(RESULTS_DIR));
    if (url === '/api/results' && req.method === 'POST') {
      const b = (await readJson(req)) as { runId?: unknown; results?: unknown } | null;
      if (!b || typeof b.runId !== 'string') return send(res, 400, { error: 'invalid request' });
      await saveResults(RESULTS_DIR, b.runId, b.results);
      return send(res, 200, { ok: true });
    }
    send(res, 404, { error: 'not found' });
  } catch {
    send(res, 500, { error: 'server error' });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`pacman-arena proxy on http://127.0.0.1:${PORT}`));
```

`config/.env.example`:

```
# Copy to config/.env and fill in. config/.env is git-ignored. Never commit it.
OPENROUTER_API_KEY=
```

- [ ] **Step 9: Run tests and typecheck**

Run: `cd <repo root> && npx vitest run tests/openrouter.test.ts tests/server.test.ts && npm run typecheck`
Expected: all PASS, typecheck exits 0.

- [ ] **Step 10: Smoke-test the server without a key**

Run: `cd <repo root> && (npx tsx src/server/index.ts & SERVER=$!; sleep 2; curl -s localhost:8787/api/budget; echo; curl -s -X POST localhost:8787/api/decide -H 'content-type: application/json' -d '{"model":"a/b","system":"s","user":"u"}'; echo; kill $SERVER)`
Expected: first line is `{"budgetUsd":1,"maxCalls":5000,"spentUsd":0,"calls":0}`, second is `{"error":"OPENROUTER_API_KEY is not set"}`. No network call is made.

- [ ] **Step 11: Commit**

```bash
cd <repo root>
git add src/agents/openrouter.ts src/server config tests/openrouter.test.ts tests/server.test.ts
git commit -m "feat: OpenRouter agent and budget-capped local proxy server

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Real-time session, scenarios, run plans, estimates, aggregation

**Files:**
- Create: `src/runner/scenarios.ts`, `src/runner/types.ts`, `src/runner/session.ts`, `src/runner/run-plan.ts`, `src/runner/estimate.ts`, `src/runner/aggregate.ts`
- Test: `tests/session.test.ts`, `tests/runner.test.ts`, `tests/e2e.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 5.
- Produces:
  - `src/runner/scenarios.ts`:
    ```ts
    export type SizeKey = 'small' | 'medium' | 'large';
    export const SIZES: Record<SizeKey, number>;            // 11, 21, 31
    export interface Scenario { id: string; name: string; size: SizeKey; complexity: Complexity; ghosts: 1 | 2 | 4 }
    export function makeScenario(size: SizeKey, complexity: Complexity, ghosts: 1 | 2 | 4): Scenario;
    export const ALL_SCENARIOS: Scenario[];                 // 27
    export const PRESETS: Record<string, Scenario[]>;       // keys: default, sizeSweep, complexitySweep, full
    export function scenarioConfig(s: Scenario, seed: number, opts?: { lives?: number; maxTicks?: number }): ScenarioConfig;
    ```
  - `src/runner/types.ts`: `Mode`, `RunPlan`, `GameResult`
    ```ts
    export type Mode = 'benchmark' | 'arena';
    export interface RunPlan { mode: Mode; scenarios: Scenario[]; seeds: number[]; agents: Agent[]; tickMs: number; maxCallsPerGame: number; maxTicks: number }
    export interface GameResult { mode: Mode; scenarioId: string; seed: number; agentId: string; score: number; level: number; survivedTicks: number; livesLeft: number; calls: number; errors: number; avgLatencyMs: number; costUsd: number; disqualified: boolean }
    ```
  - `src/runner/session.ts`: `MAX_CONSECUTIVE_ERRORS = 5`, `PlayerStats`, `class GameSession { constructor(state: GameState, agents: Agent[], maxCallsPerGame: number); readonly state; readonly stats: Record<string, PlayerStats>; halted: boolean; get over(): boolean; tick(): void }`, `runSession(session, tickMs, signal?): Promise<void>`
  - `src/runner/run-plan.ts`: `RunHooks = { onGroupStart?(info: { scenario: Scenario; seed: number; sessions: GameSession[] }): void; onResult?(r: GameResult): void }`, `runPlan(plan, hooks?, signal?): Promise<GameResult[]>`
  - `src/runner/estimate.ts`: `estimateRun(i: { scenarios: number; seeds: number; mode: Mode; agentCount: number; llmAgents: { estUsdPerCall: number }[]; maxCallsPerGame: number }): { games: number; maxCalls: number; maxUsd: number }`. This is a worst-case upper bound.
  - `src/runner/aggregate.ts`: `Cell`, `aggregate(results): Cell[]`, `winners(cells): Record<string, string>`

Session rules:
- Each `tick()`: for every alive, non-disqualified agent with no request in flight (and, for `llm` agents only, fewer than `maxCallsPerGame` calls so far), start one `decide` call with a fresh observation. Then step the engine once. A decision applies the moment it arrives, so a slow agent keeps its last direction in the meantime.
- A decision with an error or null `dir` counts as an error and changes nothing. After `MAX_CONSECUTIVE_ERRORS` in a row the player is disqualified (`eliminate`).
- `BudgetExceededError` sets `session.halted = true`, which ends the session.
- A thrown non-budget error counts as an error.

- [ ] **Step 1: Write the failing tests `tests/session.test.ts`**

```ts
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
```

- [ ] **Step 2: Write the failing tests `tests/runner.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { aggregate, winners } from '../src/runner/aggregate';
import { estimateRun } from '../src/runner/estimate';
import { ALL_SCENARIOS, PRESETS, makeScenario, scenarioConfig } from '../src/runner/scenarios';
import type { GameResult } from '../src/runner/types';

const result = (over: Partial<GameResult>): GameResult => ({
  mode: 'benchmark',
  scenarioId: 's1',
  seed: 1,
  agentId: 'a',
  score: 100,
  level: 1,
  survivedTicks: 100,
  livesLeft: 0,
  calls: 10,
  errors: 0,
  avgLatencyMs: 100,
  costUsd: 0.01,
  disqualified: false,
  ...over,
});

describe('scenarios', () => {
  it('has 27 unique combinations', () => {
    expect(ALL_SCENARIOS).toHaveLength(27);
    expect(new Set(ALL_SCENARIOS.map((s) => s.id)).size).toBe(27);
  });

  it('presets only reference known scenarios', () => {
    const ids = new Set(ALL_SCENARIOS.map((s) => s.id));
    for (const list of Object.values(PRESETS)) for (const s of list) expect(ids.has(s.id)).toBe(true);
    expect(PRESETS.default).toHaveLength(2);
    expect(PRESETS.full).toHaveLength(27);
  });

  it('builds an engine config from a scenario', () => {
    const cfg = scenarioConfig(makeScenario('large', 'complex', 4), 7, { maxTicks: 99 });
    expect(cfg).toMatchObject({
      width: 31,
      height: 31,
      complexity: 'complex',
      ghostCount: 4,
      ghostBehavior: 'mixed',
      seed: 7,
      lives: 3,
      maxTicks: 99,
    });
  });
});

describe('estimateRun', () => {
  it('returns a worst-case upper bound', () => {
    const e = estimateRun({
      scenarios: 2,
      seeds: 3,
      mode: 'benchmark',
      agentCount: 4,
      llmAgents: [{ estUsdPerCall: 0.001 }, { estUsdPerCall: 0.01 }],
      maxCallsPerGame: 100,
    });
    expect(e.games).toBe(24);
    expect(e.maxCalls).toBe(1200);
    expect(e.maxUsd).toBeCloseTo(6.6);
  });

  it('counts one game per scenario and seed in arena mode', () => {
    const e = estimateRun({
      scenarios: 2,
      seeds: 3,
      mode: 'arena',
      agentCount: 4,
      llmAgents: [{ estUsdPerCall: 0.01 }],
      maxCallsPerGame: 100,
    });
    expect(e.games).toBe(6);
    expect(e.maxCalls).toBe(600);
  });

  it('is free with no llm agents', () => {
    const e = estimateRun({ scenarios: 5, seeds: 5, mode: 'benchmark', agentCount: 3, llmAgents: [], maxCallsPerGame: 400 });
    expect(e).toEqual({ games: 75, maxCalls: 0, maxUsd: 0 });
  });
});

describe('aggregate and winners', () => {
  const results = [
    result({ agentId: 'a', seed: 1, score: 100, level: 1 }),
    result({ agentId: 'a', seed: 2, score: 300, level: 3, costUsd: 0.03 }),
    result({ agentId: 'b', seed: 1, score: 150, level: 2 }),
    result({ agentId: 'b', seed: 2, score: 150, level: 2 }),
    result({ agentId: 'a', scenarioId: 's2', score: 10 }),
    result({ agentId: 'b', scenarioId: 's2', score: 20 }),
  ];

  it('computes mean, population std, level, latency and total cost per agent and scenario', () => {
    const cells = aggregate(results);
    const a = cells.find((c) => c.agentId === 'a' && c.scenarioId === 's1')!;
    expect(a).toMatchObject({ games: 2, meanScore: 200, stdScore: 100, meanLevel: 2 });
    expect(a.totalCostUsd).toBeCloseTo(0.04);
    expect(cells.find((c) => c.agentId === 'b' && c.scenarioId === 's1')!.stdScore).toBe(0);
  });

  it('picks the highest mean score as the winner of each scenario', () => {
    expect(winners(aggregate(results))).toEqual({ s1: 'a', s2: 'b' });
  });
});
```

- [ ] **Step 3: Write the failing end-to-end test `tests/e2e.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { GreedyAgent, PlannerAgent, RandomAgent } from '../src/agents/baselines';
import { runPlan } from '../src/runner/run-plan';
import { makeScenario } from '../src/runner/scenarios';
import type { RunPlan } from '../src/runner/types';

const plan = (mode: RunPlan['mode']): RunPlan => ({
  mode,
  scenarios: [makeScenario('small', 'simple', 1), makeScenario('medium', 'complex', 2)],
  seeds: [1, 2],
  agents: [new RandomAgent('random', 'Random', 1), new GreedyAgent('greedy', 'Greedy'), new PlannerAgent('planner', 'Planner')],
  tickMs: 0,
  maxCallsPerGame: 400,
  maxTicks: 150,
});

describe('runPlan (offline, baselines only)', () => {
  it('benchmark mode runs every agent on every scenario and seed, deterministically', async () => {
    const a = await runPlan(plan('benchmark'));
    const b = await runPlan(plan('benchmark'));
    expect(a).toHaveLength(2 * 2 * 3);
    expect(a.every((r) => Number.isFinite(r.score) && r.costUsd === 0 && r.calls > 0)).toBe(true);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('arena mode runs one shared game per scenario and seed', async () => {
    const results = await runPlan(plan('arena'));
    expect(results).toHaveLength(2 * 2 * 3);
    const group = results.filter((r) => r.scenarioId === 'small-simple-1g' && r.seed === 1);
    expect(group.map((r) => r.agentId).sort()).toEqual(['greedy', 'planner', 'random']);
    expect(new Set(group.map((r) => r.level)).size).toBe(1); // shared maze, shared level
  });

  it('reports each game group through the hooks', async () => {
    const groups: number[] = [];
    const seen: string[] = [];
    await runPlan(plan('benchmark'), {
      onGroupStart: (g) => groups.push(g.sessions.length),
      onResult: (r) => seen.push(r.agentId),
    });
    expect(groups).toEqual([3, 3, 3, 3]);
    expect(seen).toHaveLength(12);
  });

  it('stops early and keeps partial results when aborted', async () => {
    const ctl = new AbortController();
    const out = await runPlan(plan('benchmark'), { onResult: () => ctl.abort() }, ctl.signal);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(12);
  });
});
```

- [ ] **Step 4: Run to verify they fail**

Run: `cd <repo root> && npx vitest run tests/session.test.ts tests/runner.test.ts tests/e2e.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 5: Write `src/runner/scenarios.ts`**

```ts
import type { Complexity, ScenarioConfig } from '../engine/types';

export type SizeKey = 'small' | 'medium' | 'large';
export const SIZES: Record<SizeKey, number> = { small: 11, medium: 21, large: 31 };

export interface Scenario {
  id: string;
  name: string;
  size: SizeKey;
  complexity: Complexity;
  ghosts: 1 | 2 | 4;
}

export function makeScenario(size: SizeKey, complexity: Complexity, ghosts: 1 | 2 | 4): Scenario {
  return {
    id: `${size}-${complexity}-${ghosts}g`,
    name: `${size}, ${complexity}, ${ghosts} ${ghosts === 1 ? 'ghost' : 'ghosts'}`,
    size,
    complexity,
    ghosts,
  };
}

const SIZE_KEYS: SizeKey[] = ['small', 'medium', 'large'];
const COMPLEXITIES: Complexity[] = ['simple', 'medium', 'complex'];
const GHOSTS: (1 | 2 | 4)[] = [1, 2, 4];

export const ALL_SCENARIOS: Scenario[] = SIZE_KEYS.flatMap((s) =>
  COMPLEXITIES.flatMap((c) => GHOSTS.map((g) => makeScenario(s, c, g))),
);

export const PRESETS: Record<string, Scenario[]> = {
  // The cheap default: easiest and hardest corner.
  default: [makeScenario('small', 'simple', 1), makeScenario('large', 'complex', 2)],
  sizeSweep: SIZE_KEYS.map((s) => makeScenario(s, 'medium', 2)),
  complexitySweep: COMPLEXITIES.map((c) => makeScenario('medium', c, 2)),
  full: ALL_SCENARIOS,
};

export function scenarioConfig(
  s: Scenario,
  seed: number,
  opts: { lives?: number; maxTicks?: number } = {},
): ScenarioConfig {
  return {
    width: SIZES[s.size],
    height: SIZES[s.size],
    complexity: s.complexity,
    ghostCount: s.ghosts,
    ghostBehavior: 'mixed',
    seed,
    lives: opts.lives ?? 3,
    maxTicks: opts.maxTicks ?? 800,
  };
}
```

- [ ] **Step 6: Write `src/runner/types.ts`**

```ts
import type { Agent } from '../agents/types';
import type { Scenario } from './scenarios';

export type Mode = 'benchmark' | 'arena';

export interface RunPlan {
  mode: Mode;
  scenarios: Scenario[];
  seeds: number[];
  agents: Agent[];
  /** Milliseconds per game tick. Real-time play uses about 150. Tests use 0. */
  tickMs: number;
  /** Cap on model calls per agent per game (LLM agents only). */
  maxCallsPerGame: number;
  maxTicks: number;
}

export interface GameResult {
  mode: Mode;
  scenarioId: string;
  seed: number;
  agentId: string;
  score: number;
  level: number;
  survivedTicks: number;
  livesLeft: number;
  calls: number;
  errors: number;
  avgLatencyMs: number;
  costUsd: number;
  disqualified: boolean;
}
```

- [ ] **Step 7: Write `src/runner/session.ts`**

```ts
import { BudgetExceededError, type Agent } from '../agents/types';
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
    Promise.resolve()
      .then(() => agent.decide(ctx))
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
```

- [ ] **Step 8: Write `src/runner/run-plan.ts`**

```ts
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
```

- [ ] **Step 9: Write `src/runner/estimate.ts` and `src/runner/aggregate.ts`**

`src/runner/estimate.ts`:

```ts
import type { Mode } from './types';

export interface EstimateInput {
  scenarios: number;
  seeds: number;
  mode: Mode;
  agentCount: number;
  llmAgents: { estUsdPerCall: number }[];
  maxCallsPerGame: number;
}

/** Worst case: every LLM agent uses its full per-game call cap in every game. */
export function estimateRun(i: EstimateInput): { games: number; maxCalls: number; maxUsd: number } {
  const groups = i.scenarios * i.seeds;
  const games = i.mode === 'arena' ? groups : groups * i.agentCount;
  const maxCalls = groups * i.llmAgents.length * i.maxCallsPerGame;
  const maxUsd = groups * i.maxCallsPerGame * i.llmAgents.reduce((sum, a) => sum + a.estUsdPerCall, 0);
  return { games, maxCalls, maxUsd };
}
```

`src/runner/aggregate.ts`:

```ts
import type { GameResult } from './types';

export interface Cell {
  agentId: string;
  scenarioId: string;
  games: number;
  meanScore: number;
  stdScore: number;
  meanLevel: number;
  meanSurvivedTicks: number;
  meanLatencyMs: number;
  totalCostUsd: number;
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

export function aggregate(results: GameResult[]): Cell[] {
  const groups = new Map<string, GameResult[]>();
  for (const r of results) {
    const k = `${r.agentId}\u0000${r.scenarioId}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.values()].map((rs) => {
    const scores = rs.map((r) => r.score);
    const m = mean(scores);
    return {
      agentId: rs[0].agentId,
      scenarioId: rs[0].scenarioId,
      games: rs.length,
      meanScore: m,
      stdScore: Math.sqrt(mean(scores.map((s) => (s - m) ** 2))),
      meanLevel: mean(rs.map((r) => r.level)),
      meanSurvivedTicks: mean(rs.map((r) => r.survivedTicks)),
      meanLatencyMs: mean(rs.map((r) => r.avgLatencyMs)),
      totalCostUsd: rs.reduce((a, r) => a + r.costUsd, 0),
    };
  });
}

/** scenarioId to the agentId with the highest mean score (first one wins ties). */
export function winners(cells: Cell[]): Record<string, string> {
  const best: Record<string, Cell> = {};
  for (const c of cells) if (!best[c.scenarioId] || c.meanScore > best[c.scenarioId].meanScore) best[c.scenarioId] = c;
  return Object.fromEntries(Object.entries(best).map(([s, c]) => [s, c.agentId]));
}
```

- [ ] **Step 10: Run all tests and typecheck**

Run: `cd <repo root> && npm test && npm run typecheck`
Expected: all test files PASS (grid, maze, engine, agents, openrouter, server, session, runner, e2e), typecheck exits 0.

If the e2e determinism test fails, the cause is almost always timing: something other than the engine is non-deterministic (for example a baseline reading `performance.now()`). Baselines must return `latencyMs: 0`. Do not loosen the assertion.

- [ ] **Step 11: Commit**

```bash
cd <repo root>
git add src/runner tests/session.test.ts tests/runner.test.ts tests/e2e.test.ts
git commit -m "feat: real-time game session, scenario matrix, run plans, cost estimate and aggregation

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Browser UI, model config and docs

**Files:**
- Create: `index.html`, `src/models.config.ts`, `src/ui/render.ts`, `src/ui/panels.ts`, `src/ui/main.ts`
- Create: `docs/usage.md`
- Test: `tests/panels.test.ts` (pure functions only; canvas and DOM are verified by running the app)

**Interfaces:**
- Consumes: `OpenRouterAgent`, baselines, `runPlan`, `estimateRun`, `aggregate`, `winners`, `ALL_SCENARIOS`, `PRESETS`, `GameSession`, `GameState`, `GameResult`, `Cell`.
- Produces:
  - `src/models.config.ts`: `ModelEntry { id; label; model; estUsdPerCall; enabled }`, `MODELS: ModelEntry[]`
  - `src/ui/render.ts`: `PLAYER_COLORS: string[]`, `drawBoard(canvas, state, colors: Record<string, string>): void`
  - `src/ui/panels.ts`: `shade(value, min, max, higherIsBetter): number` (0 to 1), `describePlayer(label, player, stats, level): string`, `renderHeatmap(container: HTMLElement, cells: Cell[], agents: {id; label}[], scenarios: Scenario[], metric: Metric): void`, `type Metric = 'meanScore' | 'meanLevel' | 'meanSurvivedTicks' | 'meanLatencyMs'`

- [ ] **Step 1: Write the failing test `tests/panels.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { describePlayer, shade } from '../src/ui/panels';
import type { Player } from '../src/engine/types';

describe('shade', () => {
  it('maps a value to 0..1 within the column range', () => {
    expect(shade(5, 0, 10, true)).toBe(0.5);
    expect(shade(0, 0, 10, true)).toBe(0);
    expect(shade(10, 0, 10, true)).toBe(1);
  });
  it('inverts when lower is better', () => {
    expect(shade(0, 0, 10, false)).toBe(1);
    expect(shade(10, 0, 10, false)).toBe(0);
  });
  it('returns 0.5 when all values are equal', () => {
    expect(shade(3, 3, 3, true)).toBe(0.5);
  });
});

describe('describePlayer', () => {
  const player = (over: Partial<Player> = {}): Player => ({
    id: 'a',
    pos: { x: 1, y: 1 },
    dir: 'LEFT',
    wantDir: 'LEFT',
    score: 120,
    lives: 2,
    alive: true,
    invulnerableUntil: 0,
    diedAtTick: null,
    ...over,
  });
  const stats = { calls: 10, errors: 1, consecutiveErrors: 0, totalLatencyMs: 500, costUsd: 0.0123, disqualified: false };

  it('summarises score, lives, level, calls, errors, latency and cost', () => {
    expect(describePlayer('Model A', player(), stats, 3)).toBe(
      'Model A · score 120 · lives 2 · level 3 · calls 10 · errors 1 · 50 ms · $0.0123',
    );
  });
  it('marks eliminated and disqualified players', () => {
    expect(describePlayer('M', player({ alive: false }), stats, 1)).toContain('out');
    expect(describePlayer('M', player({ alive: false }), { ...stats, disqualified: true }, 1)).toContain('disqualified');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd <repo root> && npx vitest run tests/panels.test.ts`
Expected: FAIL (cannot resolve `../src/ui/panels`).

- [ ] **Step 3: Write `src/models.config.ts`**

```ts
export interface ModelEntry {
  id: string;
  label: string;
  /** OpenRouter model id. Leave empty to hide the model from runs. */
  model: string;
  /** Rough worst-case dollars per call, used only for the pre-run estimate. Check current OpenRouter prices. */
  estUsdPerCall: number;
  enabled: boolean;
}

/**
 * Edit this list. Set Jev's OpenRouter model id and flip `enabled` to true.
 * The estimate assumes about 1,000 input tokens per call; large mazes cost more.
 */
export const MODELS: ModelEntry[] = [
  { id: 'jev', label: 'Jev (System 1)', model: '', estUsdPerCall: 0.0005, enabled: false },
  { id: 'fast-a', label: 'Fast model A', model: 'openai/gpt-4o-mini', estUsdPerCall: 0.0003, enabled: true },
  { id: 'fast-b', label: 'Fast model B', model: 'anthropic/claude-haiku-4.5', estUsdPerCall: 0.001, enabled: true },
  { id: 'llm', label: 'Regular LLM', model: 'anthropic/claude-sonnet-4.5', estUsdPerCall: 0.004, enabled: true },
];
```

- [ ] **Step 4: Write `src/ui/render.ts`**

```ts
import type { GameState } from '../engine/types';

export const PLAYER_COLORS = ['#ffd400', '#ff7ad9', '#4de2ff', '#8cff6b', '#ffa23d', '#c79bff'];

const GHOST_COLORS = { chase: '#ff3b3b', ambush: '#ff9fd0', random: '#ffb347' };

export function drawBoard(canvas: HTMLCanvasElement, state: GameState, colors: Record<string, string>): void {
  const { maze } = state;
  const cell = Math.max(4, Math.floor(320 / maze.width));
  const w = maze.width * cell;
  const h = maze.height * cell;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#1f3fff';
  for (let y = 0; y < maze.height; y++)
    for (let x = 0; x < maze.width; x++) if (maze.walls[y][x]) ctx.fillRect(x * cell, y * cell, cell, cell);

  const dot = (k: string, radius: number, color: string) => {
    const [x, y] = k.split(',').map(Number);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x * cell + cell / 2, y * cell + cell / 2, radius, 0, Math.PI * 2);
    ctx.fill();
  };
  for (const k of state.pellets) dot(k, cell * 0.12, '#ffd9a0');
  for (const k of state.powers) dot(k, cell * 0.3, '#ffffff');

  const frightened = state.frightenedTicks > 0;
  for (const g of state.ghosts) {
    dot(`${g.pos.x},${g.pos.y}`, cell * 0.4, frightened ? '#4466ff' : GHOST_COLORS[g.behavior]);
  }
  for (const p of state.players) {
    if (p.alive) dot(`${p.pos.x},${p.pos.y}`, cell * 0.42, colors[p.id] ?? '#ffd400');
  }
}
```

- [ ] **Step 5: Write `src/ui/panels.ts`**

```ts
import type { Player } from '../engine/types';
import type { Cell } from '../runner/aggregate';
import type { Scenario } from '../runner/scenarios';
import type { PlayerStats } from '../runner/session';

export type Metric = 'meanScore' | 'meanLevel' | 'meanSurvivedTicks' | 'meanLatencyMs';

/** 0..1 position of `value` in [min, max]. 1 is best. */
export function shade(value: number, min: number, max: number, higherIsBetter: boolean): number {
  if (max === min) return 0.5;
  const t = (value - min) / (max - min);
  return higherIsBetter ? t : 1 - t;
}

export function describePlayer(label: string, p: Player, s: PlayerStats, level: number): string {
  const avg = s.totalLatencyMs / Math.max(1, s.calls);
  const status = s.disqualified ? ' · disqualified' : !p.alive ? ' · out' : '';
  return (
    `${label} · score ${p.score} · lives ${p.lives} · level ${level} · calls ${s.calls} · ` +
    `errors ${s.errors} · ${Math.round(avg)} ms · $${s.costUsd.toFixed(4)}${status}`
  );
}

export function renderHeatmap(
  container: HTMLElement,
  cells: Cell[],
  agents: { id: string; label: string }[],
  scenarios: Scenario[],
  metric: Metric,
): void {
  const higherIsBetter = metric !== 'meanLatencyMs';
  const find = (a: string, s: string) => cells.find((c) => c.agentId === a && c.scenarioId === s);
  const table = document.createElement('table');
  table.className = 'heatmap';

  const head = table.insertRow();
  head.insertCell().textContent = 'Model';
  for (const s of scenarios) head.insertCell().textContent = s.name;

  const columns = scenarios.map((s) => {
    const values = agents.map((a) => find(a.id, s.id)?.[metric]).filter((v): v is number => v !== undefined);
    return { min: Math.min(...values), max: Math.max(...values) };
  });

  for (const a of agents) {
    const row = table.insertRow();
    row.insertCell().textContent = a.label;
    scenarios.forEach((s, i) => {
      const td = row.insertCell();
      const c = find(a.id, s.id);
      if (!c) {
        td.textContent = '-';
        return;
      }
      const v = c[metric];
      td.textContent = metric === 'meanLatencyMs' ? `${Math.round(v)} ms` : v.toFixed(metric === 'meanLevel' ? 1 : 0);
      const t = shade(v, columns[i].min, columns[i].max, higherIsBetter);
      td.style.background = `rgba(60, 200, 120, ${0.1 + 0.6 * t})`;
      if (t === 1 && columns[i].max !== columns[i].min) td.style.fontWeight = '700';
    });
  }
  container.replaceChildren(table);
}
```

- [ ] **Step 6: Write `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pacman arena</title>
    <style>
      body { font: 14px system-ui, sans-serif; margin: 0; background: #111; color: #eee; }
      main { display: grid; grid-template-columns: 340px 1fr; gap: 16px; padding: 16px; }
      fieldset { border: 1px solid #333; margin: 0 0 12px; padding: 8px 10px; }
      legend { color: #aaa; }
      label { display: block; margin: 2px 0; }
      input[type='number'] { width: 80px; }
      button { padding: 6px 12px; margin-right: 6px; cursor: pointer; }
      #boards { display: flex; flex-wrap: wrap; gap: 12px; }
      .board { background: #000; padding: 6px; border: 1px solid #333; }
      .board pre { margin: 4px 0 0; font-size: 12px; white-space: pre-wrap; max-width: 320px; }
      .heatmap { border-collapse: collapse; margin-top: 8px; }
      .heatmap td { border: 1px solid #333; padding: 4px 8px; text-align: right; }
      .heatmap tr:first-child td { text-align: center; color: #aaa; }
      .heatmap td:first-child { text-align: left; }
      #scenarios { max-height: 180px; overflow: auto; }
      #status { color: #9cf; min-height: 1.4em; }
      .muted { color: #888; }
    </style>
  </head>
  <body>
    <main>
      <section>
        <h2>Pacman arena</h2>
        <fieldset>
          <legend>Mode</legend>
          <select id="mode">
            <option value="benchmark">Benchmark: own board, same seed</option>
            <option value="arena">Arena: shared maze</option>
          </select>
        </fieldset>
        <fieldset>
          <legend>Models</legend>
          <div id="models"></div>
        </fieldset>
        <fieldset>
          <legend>Scenarios</legend>
          <select id="preset"></select>
          <details><summary>Custom selection</summary><div id="scenarios"></div></details>
        </fieldset>
        <fieldset>
          <legend>Run settings</legend>
          <label>Seeds per scenario <input id="seeds" type="number" min="1" max="20" value="1" /></label>
          <label>Tick (ms) <input id="tickMs" type="number" min="30" max="1000" value="150" /></label>
          <label>Max ticks per game <input id="maxTicks" type="number" min="50" max="5000" value="800" /></label>
          <label>Max calls per model per game <input id="maxCalls" type="number" min="10" max="5000" value="400" /></label>
          <label>Budget cap (USD) <input id="budget" type="number" min="0" step="0.1" value="0.5" /></label>
        </fieldset>
        <button id="btnEstimate">Estimate</button>
        <button id="btnRun">Run</button>
        <button id="btnStop">Stop</button>
        <p id="status"></p>
        <p class="muted">Spent: <span id="spent">$0.0000</span></p>
      </section>
      <section>
        <div id="boards"></div>
        <h3>Results</h3>
        <label>Metric
          <select id="metric">
            <option value="meanScore">Mean score</option>
            <option value="meanLevel">Mean level reached</option>
            <option value="meanSurvivedTicks">Mean survival (ticks)</option>
            <option value="meanLatencyMs">Mean latency</option>
          </select>
        </label>
        <div id="heatmap"></div>
        <p id="winners" class="muted"></p>
      </section>
    </main>
    <script type="module" src="/src/ui/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 7: Write `src/ui/main.ts`**

```ts
import { GreedyAgent, PlannerAgent, RandomAgent } from '../agents/baselines';
import { OpenRouterAgent } from '../agents/openrouter';
import type { Agent } from '../agents/types';
import { MODELS } from '../models.config';
import { aggregate, winners } from '../runner/aggregate';
import { estimateRun } from '../runner/estimate';
import { runPlan } from '../runner/run-plan';
import { ALL_SCENARIOS, PRESETS } from '../runner/scenarios';
import type { GameSession } from '../runner/session';
import type { GameResult, Mode, RunPlan } from '../runner/types';
import { describePlayer, renderHeatmap, type Metric } from './panels';
import { PLAYER_COLORS, drawBoard } from './render';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const BASELINES = [
  { id: 'random', label: 'Random' },
  { id: 'greedy', label: 'Greedy pellets' },
  { id: 'planner', label: 'Shortest-path planner' },
];

function makeAgent(id: string): Agent {
  if (id === 'random') return new RandomAgent('random', 'Random', 1);
  if (id === 'greedy') return new GreedyAgent('greedy', 'Greedy pellets');
  if (id === 'planner') return new PlannerAgent('planner', 'Shortest-path planner');
  const m = MODELS.find((x) => x.id === id);
  if (!m) throw new Error(`unknown model ${id}`);
  return new OpenRouterAgent({ id: m.id, label: m.label, model: m.model });
}

// --- build controls ---
function checkbox(parent: HTMLElement, name: string, value: string, text: string, checked: boolean, disabled = false) {
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.name = name;
  input.value = value;
  input.checked = checked;
  input.disabled = disabled;
  label.append(input, ` ${text}`);
  parent.append(label);
  return input;
}

for (const m of MODELS) {
  const usable = m.enabled && m.model !== '';
  checkbox($('models'), 'agent', m.id, usable ? `${m.label} (${m.model})` : `${m.label} (set model id in src/models.config.ts)`, usable, !usable);
}
for (const b of BASELINES) checkbox($('models'), 'agent', b.id, `${b.label} (free)`, true);

const presetSelect = $<HTMLSelectElement>('preset');
for (const name of Object.keys(PRESETS)) presetSelect.add(new Option(name, name));
for (const s of ALL_SCENARIOS) checkbox($('scenarios'), 'scenario', s.id, s.name, false);
function applyPreset() {
  const ids = new Set(PRESETS[presetSelect.value].map((s) => s.id));
  document.querySelectorAll<HTMLInputElement>('input[name=scenario]').forEach((i) => (i.checked = ids.has(i.value)));
}
presetSelect.onchange = applyPreset;
applyPreset();

// --- read the form ---
const checked = (name: string) =>
  [...document.querySelectorAll<HTMLInputElement>(`input[name=${name}]:checked`)].map((i) => i.value);
const num = (id: string) => Number($<HTMLInputElement>(id).value);

function readPlan(): { plan: RunPlan; llmCosts: { estUsdPerCall: number }[] } | null {
  const agentIds = checked('agent');
  const scenarioIds = new Set(checked('scenario'));
  if (agentIds.length === 0 || scenarioIds.size === 0) {
    $('status').textContent = 'Pick at least one model and one scenario.';
    return null;
  }
  const agents = agentIds.map(makeAgent);
  const seeds = Array.from({ length: num('seeds') }, (_, i) => i + 1);
  const llmCosts = agentIds.flatMap((id) => {
    const m = MODELS.find((x) => x.id === id);
    return m ? [{ estUsdPerCall: m.estUsdPerCall }] : [];
  });
  return {
    llmCosts,
    plan: {
      mode: $<HTMLSelectElement>('mode').value as Mode,
      scenarios: ALL_SCENARIOS.filter((s) => scenarioIds.has(s.id)),
      seeds,
      agents,
      tickMs: num('tickMs'),
      maxCallsPerGame: num('maxCalls'),
      maxTicks: num('maxTicks'),
    },
  };
}

function estimate(p: { plan: RunPlan; llmCosts: { estUsdPerCall: number }[] }) {
  return estimateRun({
    scenarios: p.plan.scenarios.length,
    seeds: p.plan.seeds.length,
    mode: p.plan.mode,
    agentCount: p.plan.agents.length,
    llmAgents: p.llmCosts,
    maxCallsPerGame: p.plan.maxCallsPerGame,
  });
}

$('btnEstimate').onclick = () => {
  const p = readPlan();
  if (!p) return;
  const e = estimate(p);
  $('status').textContent = `${e.games} games, up to ${e.maxCalls} model calls, worst case $${e.maxUsd.toFixed(2)} (budget cap $${num('budget')}).`;
};

// --- live boards ---
type Board = { session: GameSession; canvas: HTMLCanvasElement; info: HTMLElement; labels: Record<string, string> };
let boards: Board[] = [];
let colors: Record<string, string> = {};

function frame() {
  for (const b of boards) {
    drawBoard(b.canvas, b.session.state, colors);
    b.info.textContent = b.session.state.players
      .map((p) => describePlayer(b.labels[p.id], p, b.session.stats[p.id], b.session.state.level))
      .join('\n');
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function showGroup(sessions: GameSession[], agents: Agent[]) {
  const labels = Object.fromEntries(agents.map((a) => [a.id, a.label]));
  boards = sessions.map((session) => {
    const wrap = document.createElement('div');
    wrap.className = 'board';
    const canvas = document.createElement('canvas');
    const info = document.createElement('pre');
    wrap.append(canvas, info);
    return { session, canvas, info, labels, wrap };
  });
  $('boards').replaceChildren(...boards.map((b) => (b as Board & { wrap: HTMLElement }).wrap));
}

// --- run ---
let controller: AbortController | null = null;
let results: GameResult[] = [];
let shownAgents: Agent[] = [];
let shownScenarios = ALL_SCENARIOS.slice(0, 0);

function refreshResults() {
  const cells = aggregate(results);
  renderHeatmap($('heatmap'), cells, shownAgents, shownScenarios, $<HTMLSelectElement>('metric').value as Metric);
  const win = winners(cells);
  $('winners').textContent = shownScenarios
    .filter((s) => win[s.id])
    .map((s) => `${s.name}: ${shownAgents.find((a) => a.id === win[s.id])?.label}`)
    .join('  |  ');
}
$<HTMLSelectElement>('metric').onchange = refreshResults;

async function postJson(url: string, body: unknown) {
  await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

$('btnRun').onclick = async () => {
  if (controller) return;
  const p = readPlan();
  if (!p) return;
  const e = estimate(p);
  if (e.maxUsd > 0) {
    const ok = confirm(`Worst case ${e.maxCalls} model calls, up to $${e.maxUsd.toFixed(2)}. Budget cap $${num('budget')}. Run?`);
    if (!ok) return;
    await postJson('/api/budget', { budgetUsd: num('budget'), maxCalls: e.maxCalls });
  }
  controller = new AbortController();
  results = [];
  shownAgents = p.plan.agents;
  shownScenarios = p.plan.scenarios;
  colors = Object.fromEntries(p.plan.agents.map((a, i) => [a.id, PLAYER_COLORS[i % PLAYER_COLORS.length]]));
  $('status').textContent = 'Running...';
  const poll = setInterval(async () => {
    try {
      const b = (await (await fetch('/api/budget')).json()) as { spentUsd: number };
      $('spent').textContent = `$${b.spentUsd.toFixed(4)}`;
    } catch {
      /* server not running: fine for baseline-only runs */
    }
  }, 1000);

  const out = await runPlan(
    p.plan,
    {
      onGroupStart: (g) => {
        $('status').textContent = `Running ${g.scenario.name}, seed ${g.seed}`;
        showGroup(g.sessions, p.plan.agents);
      },
      onResult: (r) => {
        results.push(r);
        refreshResults();
      },
    },
    controller.signal,
  );
  clearInterval(poll);
  const halted = boards.some((b) => b.session.halted);
  $('status').textContent = halted ? 'Stopped: budget cap reached. Partial results kept.' : controller.signal.aborted ? 'Stopped.' : 'Done.';
  controller = null;
  try {
    await postJson('/api/results', { runId: `run-${Date.now()}`, results: out });
  } catch {
    /* saving is optional */
  }
};

$('btnStop').onclick = () => controller?.abort();
```

- [ ] **Step 8: Tidy the `Board` type**

In `src/ui/main.ts`, the `showGroup` function builds boards with a `wrap` field that is not in `Board`. Fix this properly instead of casting: add `wrap: HTMLElement` to the `Board` type, delete the `(b as Board & { wrap: HTMLElement })` cast, and use `boards.map((b) => b.wrap)`.

Resulting code:

```ts
type Board = { session: GameSession; canvas: HTMLCanvasElement; info: HTMLElement; wrap: HTMLElement; labels: Record<string, string> };
```

and in `showGroup`:

```ts
$('boards').replaceChildren(...boards.map((b) => b.wrap));
```

- [ ] **Step 9: Run tests, typecheck and production build**

Run: `cd <repo root> && npm test && npm run build`
Expected: all tests PASS (including `tests/panels.test.ts`), `tsc --noEmit` exits 0, `vite build` writes `dist/` with no errors.

- [ ] **Step 10: Write `docs/usage.md`**

```markdown
# Pacman arena usage

Models compete at Pac-Man across a grid of maze sizes, obstacle complexity and ghost counts. All model calls go through OpenRouter via a local proxy that enforces a budget cap.

## Setup

Requires Node 22 and npm.

    npm install
    cp config/.env.example config/.env   # then put your OpenRouter key in config/.env

`config/.env` is git-ignored. Never commit it.

## Run

Two terminals:

    npm run server   # proxy on http://127.0.0.1:8787
    npm run dev      # UI, open the printed URL

Baselines (random, greedy, shortest-path planner) need no key and cost nothing. The server is only needed for LLM models and for saving results to `results/`.

## Add Jev and other models

Edit `src/models.config.ts`. Set `model` to the OpenRouter model id, set `enabled: true`, and set `estUsdPerCall` to a rough worst-case price per call (check current OpenRouter prices). The estimate is only used for the pre-run warning. The real cost comes from OpenRouter and counts against the budget cap.

## Modes

- Benchmark: each model gets its own board on an identical seeded maze. Scores are directly comparable.
- Arena: all models race through one shared maze.

Both run in real time. A model keeps its last direction until its next answer arrives, so slow models lose ground.

## Scenarios

Size: small 11x11, medium 21x21, large 31x31. Complexity: simple (open, many loops), medium (classic corridors), complex (perfect maze, many dead ends, no loops). Ghosts: 1, 2 or 4 with mixed chase, ambush and random behavior. Each level grows the maze by 4 cells per side (cap 41) and adds a ghost every second level (cap 6).

Presets: `default` (2 scenarios, cheapest), `sizeSweep`, `complexitySweep`, `full` (27). Use "Custom selection" to pick any combination.

## Controlling cost

- Click Estimate before a run. It shows a worst-case upper bound.
- Run asks for confirmation when the estimate is above $0, then sets the server budget. The server refuses calls once the money cap or the call cap is reached, and the run stops with partial results.
- Lower "Max calls per model per game" or "Max ticks" to shrink a run. Fewer seeds means fewer games.
- Start with the default preset and 1 seed.
- Concurrent in-flight requests can overshoot the cap by a few calls.

## Results

The heatmap shows models by scenario for the chosen metric (mean score, level, survival, latency). The winner line lists the highest mean score per scenario. Runs are saved to `results/run-<timestamp>.json` (git-ignored).

## Tests

    npm test          # no network, no cost
    npm run typecheck
    npm run build

## Layout

- `src/engine`: pure seeded game engine (maze, ghosts, scoring, levels)
- `src/agents`: agent interface, observation encoding, baselines, OpenRouter agent
- `src/runner`: real-time session, scenario matrix, run plans, estimate, aggregation
- `src/server`: local proxy with budget cap and result storage
- `src/ui`: canvas boards, panels, heatmap
```

- [ ] **Step 11: Manual verification in the real app**

Run: `cd <repo root> && npm run dev` (leave the server off for this check).
In the browser: uncheck nothing, leave only the three free baselines selected (LLM models enabled by default must be unchecked for this check), preset `default`, mode Benchmark, click Run.
Expected: three boards appear side by side and animate; each shows a score line; after both scenarios finish the status says `Done.` and the heatmap fills with 3 rows by 2 columns. Switch mode to Arena and run again: a single board with three colored Pac-Men appears. Switch the metric dropdown and confirm the heatmap redraws.
Then select one LLM model, click Estimate, and confirm the status line shows a nonzero worst-case dollar figure. Do not click Run on an LLM model unless a real key is configured and the budget is acceptable.

- [ ] **Step 12: Commit**

```bash
cd <repo root>
git add index.html src/ui src/models.config.ts docs/usage.md tests/panels.test.ts
git commit -m "feat: browser UI with live boards, scenario picker, cost estimate and results heatmap

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage**
- Engine (maze, pellets, ghosts, collisions, scoring, lives, seeded, deterministic): Tasks 1 to 3.
- Agent interface, baselines, scripted mock, OpenRouter adapter: Tasks 4 and 5.
- Proxy with key isolation, cost recording, budget cap: Task 5 (latency is client-side, as the spec now says).
- Observation as ASCII grid, one-word reply, error handling and disqualification: Tasks 4 and 6.
- Benchmark and arena modes, real-time latency effect: Task 6 (`GameSession`, `runPlan`).
- Levels that grow, ghost scaling: Task 3 (`levelConfig`).
- Scenario knobs and presets, complexity metrics, multiple seeds, heatmap, winner per condition, cost and latency per scenario: Tasks 2, 6 and 7.
- Cost controls (hard cap, estimate before run, cheap default, token cap, per-game call cap, live cost counter, mock and free baselines, saved results): Tasks 5, 6 and 7. A live cost counter is shown per board (`describePlayer`) and as a total (`#spent`).
- Testing (engine determinism, collisions, connectivity, scoring, parser, budget cap, offline end-to-end): Tasks 1 to 7.
- Docs updated: `docs/usage.md` (Task 7), spec edited to match.

**Known limits, stated honestly**
- Reasoning-capable models may ignore `reasoning: { enabled: false }`, return empty text under the 16-token cap, and be counted as errors. If that happens for a model, raise `max_tokens` in `buildPayload` for that model only, and re-estimate.
- The per-call prices in `src/models.config.ts` are rough placeholders to be checked against current OpenRouter prices; the estimate is a worst case, not a quote.
- Concurrent requests can overshoot the budget cap by a few calls.
- Jev has no model id yet. It stays disabled until you set one.

**Type consistency check:** `Agent`, `Decision.dir: Direction | null`, `GameSession.stats`, `PlayerStats`, `GameResult`, `RunPlan`, `Cell`, `Metric` and `Scenario` are defined once and used with the same names across tasks.
