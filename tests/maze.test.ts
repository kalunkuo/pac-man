import { describe, expect, it } from 'vitest';
import { bfsDistances, key } from '../src/engine/grid';
import { generateMaze } from '../src/engine/maze';
import type { Complexity } from '../src/engine/types';

const SEEDS = [1, 2, 3, 4, 5];

/** 32-bit FNV-1a over the walls as rows of '#' and '.'. */
function wallDigest(walls: boolean[][]): number {
  const text = walls.map((r) => r.map((w) => (w ? '#' : '.')).join('')).join('\n');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Digests from the generator as of commit 59b3ea4, before the labyrinth work (layout:size:seed). */
const PRE_LABYRINTH_DIGESTS: Record<string, number> = {
  'simple:21:1': 2609648919,
  'simple:21:2': 1201678483,
  'simple:21:3': 4134800173,
  'simple:31:1': 4209505938,
  'simple:31:2': 4192597015,
  'simple:31:3': 3911989711,
  'medium:21:1': 1438643983,
  'medium:21:2': 3131983077,
  'medium:21:3': 2133671334,
  'medium:31:1': 3487752805,
  'medium:31:2': 2056009994,
  'medium:31:3': 2819383616,
  'complex:21:1': 3569205827,
  'complex:21:2': 1555777355,
  'complex:21:3': 3380308203,
  'complex:31:1': 1995929191,
  'complex:31:2': 1798461639,
  'complex:31:3': 3956732165,
};

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

  it.each(['simple', 'medium', 'complex'] as Complexity[])(
    'every open cell is reachable in a 61x61 maze (%s)',
    (c) => {
      for (const s of [1, 2]) {
        const m = generateMaze(61, 61, c, s);
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

  it('labyrinth has no loops and every open cell is reachable', () => {
    for (const s of SEEDS) {
      const m = generateMaze(21, 21, 'labyrinth', s);
      expect(m.metrics.loops).toBe(0);
      const dist = bfsDistances(m.walls, m.pacStart);
      for (let y = 0; y < m.height; y++)
        for (let x = 0; x < m.width; x++) if (!m.walls[y][x]) expect(dist[y][x]).toBeGreaterThanOrEqual(0);
    }
  });

  it.each(Object.entries(PRE_LABYRINTH_DIGESTS))('keeps the pre-labyrinth layout %s byte-identical', (id, digest) => {
    const [c, size, seed] = id.split(':');
    const n = Number(size);
    expect(wallDigest(generateMaze(n, n, c as Complexity, Number(seed)).walls)).toBe(digest);
  });

  it('a 61x61 labyrinth has no loops and every open cell is reachable', () => {
    for (const s of [1, 2]) {
      const m = generateMaze(61, 61, 'labyrinth', s);
      expect(m.metrics.loops).toBe(0);
      const dist = bfsDistances(m.walls, m.pacStart);
      for (let y = 0; y < m.height; y++)
        for (let x = 0; x < m.width; x++) if (!m.walls[y][x]) expect(dist[y][x]).toBeGreaterThanOrEqual(0);
    }
  });

  it('labyrinth has longer corridors than complex and is deterministic per seed', () => {
    const total = (c: Complexity) =>
      SEEDS.reduce((acc, s) => acc + generateMaze(31, 31, c, s).metrics.avgCorridorLength, 0);
    expect(total('labyrinth')).toBeGreaterThan(total('complex'));
    expect(generateMaze(31, 31, 'labyrinth', 2).walls).toEqual(generateMaze(31, 31, 'labyrinth', 2).walls);
    expect(generateMaze(31, 31, 'labyrinth', 2).walls).not.toEqual(generateMaze(31, 31, 'labyrinth', 3).walls);
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
