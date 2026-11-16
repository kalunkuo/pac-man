import { legalMoves } from '../engine/grid';
import type { GameState } from '../engine/types';
import type { Observation } from './types';

export function encodeObservation(state: GameState, playerId: string): Observation {
  const me = state.players.find((p) => p.id === playerId);
  if (!me) throw new Error(`unknown player ${playerId}`);
  const frightened = state.frightenedTicks > 0;

  const rows = state.maze.walls.map((row, y) =>
    row
      .map((wall, x) => {
        if (wall) return '#';
        if (me.pos.x === x && me.pos.y === y) return 'P';
        if (state.ghosts.some((g) => g.pos.x === x && g.pos.y === y)) return frightened ? 'g' : 'G';
        if (state.players.some((p) => p.id !== playerId && p.alive && p.pos.x === x && p.pos.y === y)) return 'p';
        const k = `${x},${y}`;
        if (state.powers.has(k)) return 'o';
        if (state.pellets.has(k)) return '.';
        return '-';
      })
      .join(''),
  );

  const moves = legalMoves(state.maze.walls, me.pos);
  const text =
    `Level ${state.level}, score ${me.score}, lives ${me.lives}, you are moving ${me.dir}.\n` +
    `Legal moves: ${moves.join(', ')}\n` +
    rows.join('\n');

  return { text, legalMoves: moves, score: me.score, lives: me.lives, level: state.level, tick: state.tick };
}
