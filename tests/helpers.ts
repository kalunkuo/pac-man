import type { ScenarioConfig } from '../src/engine/types';

/** '#' is a wall, anything else is open. */
export function parseWalls(rows: string[]): boolean[][] {
  return rows.map((r) => [...r].map((c) => c === '#'));
}

export function config(over: Partial<ScenarioConfig> = {}): ScenarioConfig {
  return {
    width: 11,
    height: 11,
    complexity: 'simple',
    ghostCount: 1,
    ghostBehavior: 'chase',
    seed: 1,
    lives: 3,
    maxTicks: 500,
    vision: null,
    ...over,
  };
}
