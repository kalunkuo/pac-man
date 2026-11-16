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
