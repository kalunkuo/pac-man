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
