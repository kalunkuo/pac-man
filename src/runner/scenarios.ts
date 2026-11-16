import type { Complexity, ScenarioConfig } from '../engine/types';

export type SizeKey = 'small' | 'medium' | 'large' | 'huge';
export const SIZES: Record<SizeKey, number> = { small: 11, medium: 21, large: 31, huge: 61 };
export const SIZE_KEYS: SizeKey[] = ['small', 'medium', 'large', 'huge'];
export const GHOST_COUNTS: (0 | 1 | 2 | 4)[] = [0, 1, 2, 4];
export type VisionKey = 'full' | 'fog';
/** Manhattan radius a player sees in fog scenarios. */
export const FOG_RADIUS = 4;

export interface Scenario {
  id: string;
  name: string;
  size: SizeKey;
  complexity: Complexity;
  ghosts: 0 | 1 | 2 | 4;
  vision: VisionKey;
}

export function makeScenario(
  size: SizeKey,
  complexity: Complexity,
  ghosts: 0 | 1 | 2 | 4,
  vision: VisionKey = 'full',
): Scenario {
  const fog = vision === 'fog';
  return {
    id: `${size}-${complexity}-${ghosts}g${fog ? '-fog' : ''}`,
    name: `${size}, ${complexity}, ${ghosts} ${ghosts === 1 ? 'ghost' : 'ghosts'}${fog ? ', fog' : ''}`,
    size,
    complexity,
    ghosts,
    vision,
  };
}

const COMPLEXITIES: Complexity[] = ['simple', 'medium', 'complex'];
const LAYOUTS: Complexity[] = [...COMPLEXITIES, 'labyrinth'];
const VISIONS: VisionKey[] = ['full', 'fog'];

// Full-vision scenarios come first so the `full` preset is a prefix.
export const ALL_SCENARIOS: Scenario[] = VISIONS.flatMap((v) =>
  SIZE_KEYS.flatMap((s) => LAYOUTS.flatMap((c) => GHOST_COUNTS.map((g) => makeScenario(s, c, g, v)))),
);

export const PRESETS: Record<string, Scenario[]> = {
  // The cheap default: easiest and hardest corner.
  default: [makeScenario('small', 'simple', 1), makeScenario('large', 'complex', 2)],
  sizeSweep: (['small', 'medium', 'large'] as SizeKey[]).map((s) => makeScenario(s, 'medium', 2)),
  complexitySweep: COMPLEXITIES.map((c) => makeScenario('medium', c, 2)),
  noGhosts: (['small', 'medium', 'large'] as SizeKey[]).map((s) => makeScenario(s, 'medium', 0)),
  huge: (['simple', 'complex'] as Complexity[]).map((c) => makeScenario('huge', c, 2)),
  // Full vision only: fog scenarios are opt-in so a default sweep does not double its cost.
  full: ALL_SCENARIOS.filter((s) => s.vision === 'full'),
  fogSweep: (['small', 'medium'] as SizeKey[]).flatMap((s) =>
    (['simple', 'complex', 'labyrinth'] as Complexity[]).map((c) => makeScenario(s, c, 1, 'fog')),
  ),
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
    vision: s.vision === 'fog' ? FOG_RADIUS : null,
  };
}
