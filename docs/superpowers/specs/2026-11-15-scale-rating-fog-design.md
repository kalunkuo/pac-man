# Bigger mazes, all-runs rating and harder obstacles

Date: 2026-11-15. Extends `2026-11-15-pacman-arena-design.md` and `2026-11-15-ranking-design.md`.

## 1. Huge maze and 0 ghosts

- New size `huge`: 61x61. Mazes of a scenario never shrink: the level growth cap becomes `max(41, base size)`, so a huge scenario stays 61x61 on later levels.
- Ghost counts become 0, 1, 2 or 4. With 0 ghosts the game has none on any level (a clean navigation control); with 1, 2 or 4 the existing growth rule applies.
- Cost estimate scales with maze size: each scenario's worst-case cost is multiplied by `max(1, cells / 1000)` where `cells = size * size`, because the maze is sent to the model as text on every call.
- Presets: `noGhosts` (small, medium, large, medium layout, 0 ghosts), `huge` (huge, simple and complex layouts, 2 ghosts). `full` covers all full-vision scenarios.

## 2. One rating across all runs

- A new default **Rating** view fits a Bradley-Terry rating from head-to-head matches. In benchmark mode, two models with completed games on the same settings, scenario and seed played the identical maze, so each such pair is one match: higher score wins, equal scores are a draw (half a win).
- Ratings use an Elo-like scale: `1000 + 400 * log10(strength / geometric mean of strengths)`. A weak prior (one virtual draw against an average opponent per model) keeps ratings finite for unbeaten models. A deterministic bootstrap (seeded) over matches gives a 95% range.
- Only models connected through shared opponents are rated together. Models in a separate connected group are listed as not connected.
- Games with `disqualified` set whose last error is not `unparseable` or `no move` (or whose last error is unknown) are connection failures, not gameplay. They are excluded from every ranking view and counted in a note. Games disqualified for `unparseable` or `no move` count normally.
- Arena runs are not used for ratings (shared-maze scores are not independent); a note says how many were skipped.
- The existing average-rank table stays as a secondary view (toggle). The settings filter gains "All settings" (default for the Rating view) because matches are only formed within identical settings, but all settings contribute to one rating.
- CSV export follows the view shown.

## 3. Harder obstacles

- New layout `labyrinth` (a fourth complexity value): a perfect maze carved with a bias toward continuing straight, giving long corridors and few junctions.
- New vision knob `fog`: only cells within 4 steps (Manhattan distance) of a player are visible to that player; everything else, including walls, ghosts and other players, is shown as `?` in the text observation. Fog scenarios have ids ending in `-fog`. Baselines that read game state see only the same visible cells (full-information baselines would be unfair).
- Fog applies to the prompt text only; the spectator board still shows the whole maze.
- `ALL_SCENARIOS` lists every combination of size (4), layout (4), ghosts (4) and vision (2); the `full` preset covers only full-vision scenarios to protect cost. A `fogSweep` preset covers small and medium sizes with simple, complex and labyrinth layouts and 1 ghost.

## Out of scope

Elo-style confidence beyond the bootstrap range, portals, one-way tunnels, partial results sharing.
