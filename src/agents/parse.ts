import type { Direction } from '../engine/types';

export function parseDirection(text: string): Direction | null {
  const m = text.toUpperCase().match(/\b(UP|DOWN|LEFT|RIGHT)\b/);
  return m ? (m[1] as Direction) : null;
}
