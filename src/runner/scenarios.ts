import type { Complexity, ScenarioConfig } from '../engine/types';

export type SizeKey = 'small' | 'medium' | 'large' | 'huge';
export const SIZES: Record<SizeKey, number> = { small: 11, medium: 21, large: 31, huge: 61 };
export const SIZE_KEYS: SizeKey[] = ['small', 'medium', 'large', 'huge'];
export const GHOST_COUNTS: (0 | 1 | 2 | 4)[] = [0, 1, 2, 4];

export interface Scenario {
  id: string;
  name: string;
  size: SizeKey;
  complexity: Complexity;
  ghosts: 0 | 1 | 2 | 4;
}

export function makeScenario(size: SizeKey, complexity: Complexity, ghosts: 0 | 1 | 2 | 4): Scenario {
  return {
    id: `${size}-${complexity}-${ghosts}g`,
    name: `${size}, ${complexity}, ${ghosts} ${ghosts === 1 ? 'ghost' : 'ghosts'}`,
    size,
    complexity,
    ghosts,
  };
}

const COMPLEXITIES: Complexity[] = ['simple', 'medium', 'complex'];

export const ALL_SCENARIOS: Scenario[] = SIZE_KEYS.flatMap((s) =>
  COMPLEXITIES.flatMap((c) => GHOST_COUNTS.map((g) => makeScenario(s, c, g))),
);

export const PRESETS: Record<string, Scenario[]> = {
  // The cheap default: easiest and hardest corner.
  default: [makeScenario('small', 'simple', 1), makeScenario('large', 'complex', 2)],
  sizeSweep: (['small', 'medium', 'large'] as SizeKey[]).map((s) => makeScenario(s, 'medium', 2)),
  complexitySweep: COMPLEXITIES.map((c) => makeScenario('medium', c, 2)),
  noGhosts: (['small', 'medium', 'large'] as SizeKey[]).map((s) => makeScenario(s, 'medium', 0)),
  huge: (['simple', 'complex'] as Complexity[]).map((c) => makeScenario('huge', c, 2)),
  full: ALL_SCENARIOS,
};

/**
 * Prompt text grows with maze area. Small, medium and large mazes grow to 41x41 (1681 cells)
 * on later levels, so 1.7 is the worst case for them; huge stays 61x61.
 */
export function promptCostFactor(s: Scenario): number {
  return Math.max(1.7, SIZES[s.size] ** 2 / 1000);
}

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
