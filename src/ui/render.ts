import type { GameState } from '../engine/types';

export const PLAYER_COLORS = ['#ffd400', '#ff7ad9', '#4de2ff', '#8cff6b', '#ffa23d', '#c79bff'];

const GHOST_COLORS = { chase: '#ff3b3b', ambush: '#ff9fd0', random: '#ffb347' };

export function drawBoard(canvas: HTMLCanvasElement, state: GameState, colors: Record<string, string>): void {
  const { maze } = state;
  const cell = Math.max(4, Math.floor(320 / maze.width));
  const w = maze.width * cell;
  const h = maze.height * cell;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#1f3fff';
  for (let y = 0; y < maze.height; y++)
    for (let x = 0; x < maze.width; x++) if (maze.walls[y][x]) ctx.fillRect(x * cell, y * cell, cell, cell);

  const dot = (k: string, radius: number, color: string) => {
    const [x, y] = k.split(',').map(Number);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x * cell + cell / 2, y * cell + cell / 2, radius, 0, Math.PI * 2);
    ctx.fill();
  };
  for (const k of state.pellets) dot(k, cell * 0.12, '#ffd9a0');
  for (const k of state.powers) dot(k, cell * 0.3, '#ffffff');

  const frightened = state.frightenedTicks > 0;
  for (const g of state.ghosts) {
    dot(`${g.pos.x},${g.pos.y}`, cell * 0.4, frightened ? '#4466ff' : GHOST_COLORS[g.behavior]);
  }
  for (const p of state.players) {
    if (p.alive) dot(`${p.pos.x},${p.pos.y}`, cell * 0.42, colors[p.id] ?? '#ffd400');
  }
}
