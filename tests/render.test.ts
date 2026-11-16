import { describe, expect, it } from 'vitest';
import { eyeOffset, mouthAngles } from '../src/ui/render';
import type { Direction } from '../src/engine/types';

const DIRS: Direction[] = ['RIGHT', 'DOWN', 'LEFT', 'UP'];
const FACING: Record<Direction, number> = { RIGHT: 0, DOWN: Math.PI / 2, LEFT: Math.PI, UP: -Math.PI / 2 };

// Mouth bisector is the middle of the gap between end and start (mod 2π).
function mouthCenter(a: { start: number; end: number }): number {
  const gap = (a.start + Math.PI * 2 - a.end) / 2;
  return a.end + gap;
}

function sameAngle(a: number, b: number): boolean {
  const d = Math.abs(((a - b) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.min(d, Math.PI * 2 - d) < 1e-9;
}

describe('mouthAngles', () => {
  it.each(DIRS)('centers the mouth on %s', (dir) => {
    expect(sameAngle(mouthCenter(mouthAngles(dir, 0)), FACING[dir])).toBe(true);
  });

  it('opens wider on even half-ticks than odd ones', () => {
    const open = mouthAngles('RIGHT', 0);
    const closed = mouthAngles('RIGHT', 2);
    const openGap = open.start + Math.PI * 2 - open.end;
    const closedGap = closed.start + Math.PI * 2 - closed.end;
    expect(openGap).toBeGreaterThan(closedGap);
    expect(open).not.toEqual(closed);
  });

  it('uses the same phase for ticks 0 and 1, and ticks 2 and 3', () => {
    expect(mouthAngles('UP', 0)).toEqual(mouthAngles('UP', 1));
    expect(mouthAngles('UP', 2)).toEqual(mouthAngles('UP', 3));
    expect(mouthAngles('UP', 1)).not.toEqual(mouthAngles('UP', 2));
  });

  it('returns finite numbers with the body arc spanning less than a full circle', () => {
    for (const dir of DIRS)
      for (const tick of [0, 1, 2, 3, 1000]) {
        const a = mouthAngles(dir, tick);
        expect(Number.isFinite(a.start)).toBe(true);
        expect(Number.isFinite(a.end)).toBe(true);
        expect(a.end - a.start).toBeGreaterThan(0);
        expect(a.end - a.start).toBeLessThan(Math.PI * 2);
      }
  });
});

describe('eyeOffset', () => {
  it('points in the movement direction', () => {
    expect(eyeOffset('RIGHT')).toEqual({ dx: 1, dy: 0 });
    expect(eyeOffset('LEFT')).toEqual({ dx: -1, dy: 0 });
    expect(eyeOffset('DOWN')).toEqual({ dx: 0, dy: 1 });
    expect(eyeOffset('UP')).toEqual({ dx: 0, dy: -1 });
  });
});
