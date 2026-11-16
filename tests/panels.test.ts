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
  const stats = { calls: 10, errors: 1, consecutiveErrors: 0, totalLatencyMs: 500, costUsd: 0.0123, disqualified: false, lastError: null };

  it('summarises score, lives, level, calls, errors, latency and cost', () => {
    expect(describePlayer('Model A', player(), stats, 3)).toBe(
      'Model A · score 120 · lives 2 · level 3 · calls 10 · errors 1 · 50 ms · $0.0123',
    );
  });
  it('appends the last error when there are errors, cut to 90 characters', () => {
    const base = 'Model A · score 120 · lives 2 · level 3 · calls 10 · errors 1 · 50 ms · $0.0123';
    expect(describePlayer('Model A', player(), { ...stats, lastError: 'network' }, 3)).toBe(`${base} · last error: network`);
    const long = 'e'.repeat(120);
    expect(describePlayer('Model A', player(), { ...stats, lastError: long }, 3)).toBe(
      `${base} · last error: ${'e'.repeat(90)}…`,
    );
    expect(describePlayer('Model A', player(), { ...stats, lastError: 'e'.repeat(90) }, 3)).toBe(
      `${base} · last error: ${'e'.repeat(90)}`,
    );
    expect(describePlayer('Model A', player(), { ...stats, errors: 0, lastError: 'old' }, 3)).toBe(
      base.replace('errors 1', 'errors 0'),
    );
  });
  it('marks eliminated and disqualified players', () => {
    expect(describePlayer('M', player({ alive: false }), stats, 1)).toContain('out');
    expect(describePlayer('M', player({ alive: false }), { ...stats, disqualified: true }, 1)).toContain('disqualified');
  });
});
