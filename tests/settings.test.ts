import { describe, expect, it } from 'vitest';
import { validateSettings } from '../src/ui/settings';

const ok = { seeds: 1, tickMs: 200, maxTicks: 500, budget: 1, hasLlm: true };

describe('validateSettings', () => {
  it('accepts a valid configuration', () => {
    expect(validateSettings(ok)).toBeNull();
  });

  const fields = [
    { key: 'seeds', name: 'seeds', bad: [0, 21, 1.5, NaN] },
    { key: 'tickMs', name: 'tickMs', bad: [0, 29, 1001, 100.5, NaN] },
    { key: 'maxTicks', name: 'maxTicks', bad: [0, 49, 5001, 60.5, NaN] },
  ] as const;

  for (const f of fields) {
    it(`rejects bad ${f.key} and names the field`, () => {
      for (const v of f.bad) {
        const msg = validateSettings({ ...ok, [f.key]: v });
        expect(msg, `${f.key}=${v}`).not.toBeNull();
        expect(msg).toContain(f.name);
      }
    });
  }

  it('accepts range edges', () => {
    expect(validateSettings({ ...ok, seeds: 20, tickMs: 30, maxTicks: 5000 })).toBeNull();
    expect(validateSettings({ ...ok, seeds: 1, tickMs: 1000, maxTicks: 50 })).toBeNull();
  });

  it('rejects bad budget only when an LLM is selected', () => {
    for (const v of [0, -1, NaN, Infinity]) {
      const msg = validateSettings({ ...ok, budget: v });
      expect(msg, `budget=${v}`).toContain('budget');
      expect(validateSettings({ ...ok, budget: v, hasLlm: false }), `free budget=${v}`).toBeNull();
    }
  });
});
