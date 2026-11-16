export type Settings = {
  seeds: number;
  tickMs: number;
  maxTicks: number;
  maxCalls: number;
  budget: number;
  hasLlm: boolean;
};

const RANGES = [
  { key: 'seeds', min: 1, max: 20 },
  { key: 'tickMs', min: 30, max: 1000 },
  { key: 'maxTicks', min: 50, max: 5000 },
  { key: 'maxCalls', min: 10, max: 5000 },
] as const;

export function validateSettings(s: Settings): string | null {
  for (const r of RANGES) {
    const v = s[r.key];
    if (!Number.isInteger(v) || v < r.min || v > r.max) {
      return `${r.key} must be a whole number from ${r.min} to ${r.max}.`;
    }
  }
  if (s.hasLlm && !(Number.isFinite(s.budget) && s.budget > 0)) {
    return 'budget must be a number greater than 0 when a paid model is selected.';
  }
  return null;
}
