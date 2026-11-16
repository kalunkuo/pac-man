import type { Rng } from './rng';

export type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
export interface Vec {
  x: number;
  y: number;
}
export type Complexity = 'simple' | 'medium' | 'complex';
export type GhostBehavior = 'chase' | 'ambush' | 'random';

export interface ScenarioConfig {
  width: number;
  height: number;
  complexity: Complexity;
  ghostCount: number;
  ghostBehavior: GhostBehavior | 'mixed';
  seed: number;
  lives: number;
  maxTicks: number;
}

export interface MazeMetrics {
  deadEnds: number;
  loops: number;
  /** open cells divided by (junctions + dead ends) */
  avgCorridorLength: number;
}

export interface Maze {
  width: number;
  height: number;
  /** walls[y][x] is true for a wall */
  walls: boolean[][];
  pacStart: Vec;
  ghostStart: Vec;
  pelletSpots: Vec[];
  powerSpots: Vec[];
  metrics: MazeMetrics;
}

export interface Player {
  id: string;
  pos: Vec;
  dir: Direction;
  wantDir: Direction;
  score: number;
  lives: number;
  alive: boolean;
  invulnerableUntil: number;
  diedAtTick: number | null;
}

export interface Ghost {
  pos: Vec;
  dir: Direction;
  behavior: GhostBehavior;
}

export interface GameState {
  config: ScenarioConfig;
  level: number;
  tick: number;
  maze: Maze;
  pellets: Set<string>;
  powers: Set<string>;
  players: Player[];
  ghosts: Ghost[];
  frightenedTicks: number;
  status: 'running' | 'over';
  rng: Rng;
}
