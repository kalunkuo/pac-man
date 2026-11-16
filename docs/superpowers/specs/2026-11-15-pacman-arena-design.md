# Pacman arena design

Date: 2026-11-15

## Goal

A browser Pac-Man game where different decision models compete: Jev (a System 1 model), similar models from other vendors, and a regular LLM. All models are called through OpenRouter. The game shows which model wins under different conditions (maze size, obstacle complexity, ghost pressure).

## Architecture

- `src/engine`: pure TypeScript, no I/O. Maze generation, pellets, ghost AI, collisions, scoring, lives. Fully seeded and deterministic. Advances one tick per step.
- `src/agents`: one typed interface, `decide(observation) -> Direction`. Each agent is `{ label, openrouterModelId, promptStyle }`. Jev, other vendors' models and the regular LLM are instances of the OpenRouter adapter. Baselines (random, greedy, A*) and a mock agent implement the same interface.
- `src/server`: thin Node proxy to OpenRouter. Holds the API key from `.env` (git-ignored). Records latency and token cost per call. Enforces the budget cap.
- `src/ui`: canvas boards, live scoreboard, scenario picker, results heatmap.

### Observation and reply

- Observation: compact ASCII grid (Pac-Man, ghosts, pellets, legal moves), score, lives, level.
- Reply: one of `UP`, `DOWN`, `LEFT`, `RIGHT`, validated against a schema.
- Invalid reply, timeout or API error: repeat the previous move and count an error. Too many consecutive errors disqualify the model for that game.

## Modes

- Benchmark: each model plays its own board on an identical seeded maze with identical ghost behavior. Scores are directly comparable.
- Arena: all models' Pac-Men share one maze and race for the same pellets.

Both modes run in real time. A model keeps its last move until its next answer arrives, so latency affects results.

## Levels and scenarios

Level N uses a seeded maze that grows with N (about 15x15 at level 1, up to 31x31 or more). Ghost count and speed scale with level.

Scenario knobs:

| Knob | Values |
|---|---|
| Size | small (11x11), medium (21x21), large (31x31+) |
| Obstacle complexity | simple (open, many loops), medium (classic corridors), complex (dense, dead ends, few loops, one-way tunnels) |
| Ghost pressure | 1, 2 or 4 ghosts; chase, ambush or random behavior |

- Named presets plus a custom mode.
- Each maze reports complexity metrics: dead-end count, loop count, average corridor length.
- Each scenario cell runs several seeds. Results are mean and spread.
- Results view: heatmap of models by scenarios (score, levels cleared, survival time), winner per condition, cost and latency per scenario.

## Ghosts and scoring

- Seeded, deterministic ghosts with chase, ambush and random personalities. Frightened state after a power pellet.
- Points for pellets, power pellets, ghost captures and a level-clear bonus. A collision costs a life. A run ends when lives reach zero.

## Cost controls

- Hard budget cap per run. The runner stops cleanly and keeps partial results.
- Estimate (call count and projected cost) shown before a run, with confirmation.
- Default run: 2 scenarios (small and simple, large and complex), 1 seed, short games.
- `max_tokens` capped near 10, reasoning disabled where supported, compact grid encoding.
- Per-game call cap and live cost counter per board.
- Mock agent and `:free` models for development. All tests cost $0.
- Results saved to disk, so re-viewing never re-calls an API.

## Testing

- Unit tests: engine determinism, collisions, maze connectivity, scoring, reply schema parser, budget cap.
- End-to-end: a full game with mock agents, offline.

## Layout

```
pacman-arena/
  src/engine  src/agents  src/server  src/ui
  tests/
  docs/
  .env.example   (real .env is git-ignored)
```

## Out of scope

Models controlling ghosts, headless batch runner and multiplayer over a network. The pure engine leaves room to add a headless runner later.
