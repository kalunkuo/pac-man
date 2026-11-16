import type { Direction, GameState } from '../engine/types';

export const PLAYER_COLORS = ['#ffd400', '#ff7ad9', '#4de2ff', '#8cff6b', '#ffa23d', '#c79bff'];

const GHOST_COLORS = { chase: '#ff3b3b', ambush: '#ff9fd0', random: '#ffb347' };

const FACING: Record<Direction, number> = { RIGHT: 0, DOWN: Math.PI / 2, LEFT: Math.PI, UP: -Math.PI / 2 };
const MOUTH_OPEN = 0.6;
const MOUTH_CLOSED = 0.05;

/** Arc (radians, canvas y-down) covering the body; the gap from end to start+2π is the mouth. */
export function mouthAngles(dir: Direction, tick: number): { start: number; end: number } {
  const half = Math.floor(tick / 2) % 2 === 0 ? MOUTH_OPEN : MOUTH_CLOSED;
  const facing = FACING[dir];
  return { start: facing + half, end: facing + Math.PI * 2 - half };
}

export function eyeOffset(dir: Direction): { dx: number; dy: number } {
  switch (dir) {
    case 'RIGHT':
      return { dx: 1, dy: 0 };
    case 'LEFT':
      return { dx: -1, dy: 0 };
    case 'DOWN':
      return { dx: 0, dy: 1 };
    case 'UP':
      return { dx: 0, dy: -1 };
  }
}

function drawPacman(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, dir: Direction, tick: number, color: string): void {
  const { start, end } = mouthAngles(dir, tick);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, r, start, end);
  ctx.closePath();
  ctx.fill();
}

function drawGhost(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  dir: Direction,
  body: string,
  frightened: boolean,
): void {
  const scallop = (r * 2) / 3;
  const bottom = cy + r;
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, Math.PI * 2);
  ctx.lineTo(cx + r, bottom);
  for (let i = 0; i < 3; i++) {
    const x1 = cx + r - scallop * i;
    ctx.quadraticCurveTo(x1 - scallop / 2, bottom - r * 0.45, x1 - scallop, bottom);
  }
  ctx.closePath();
  ctx.fill();

  const eyeY = cy - r * 0.2;
  const eyeX = r * 0.4;
  const { dx, dy } = eyeOffset(dir);
  ctx.fillStyle = '#fff';
  if (frightened) {
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(cx + sx * eyeX, eyeY, r * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  for (const sx of [-1, 1]) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx + sx * eyeX, eyeY, r * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#112';
    ctx.beginPath();
    ctx.arc(cx + sx * eyeX + dx * r * 0.12, eyeY + dy * r * 0.12, r * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }
}

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
  const flashWhite = frightened && state.frightenedTicks <= 10 && state.tick % 2 === 0;
  for (const g of state.ghosts) {
    const body = frightened ? (flashWhite ? '#ffffff' : '#4466ff') : GHOST_COLORS[g.behavior];
    drawGhost(ctx, g.pos.x * cell + cell / 2, g.pos.y * cell + cell / 2, cell * 0.42, g.dir, body, frightened);
  }
  for (const p of state.players) {
    if (p.alive)
      drawPacman(ctx, p.pos.x * cell + cell / 2, p.pos.y * cell + cell / 2, cell * 0.42, p.dir, state.tick, colors[p.id] ?? '#ffd400');
  }
}
