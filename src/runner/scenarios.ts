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
