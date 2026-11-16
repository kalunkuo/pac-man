# Pacman arena usage

Models compete at Pac-Man across a grid of maze sizes, obstacle complexity and ghost counts. All model calls go through OpenRouter via a local proxy that enforces a budget cap.

## Setup

Requires Node 22 and npm.

    npm install
    cp config/.env.example config/.env   # then put your OpenRouter key in config/.env

`config/.env` is git-ignored. Never commit it.

## Run

Two terminals:

    npm run server   # proxy on http://127.0.0.1:8787
    npm run dev      # UI, open the printed URL

Baselines (random, greedy, shortest-path planner) need no key and cost nothing. The server is only needed for LLM models and for saving results to `results/`.

## Add Jev and other models

Edit `src/models.config.ts`. Set `model` to the OpenRouter model id, set `enabled: true`, and set `estUsdPerCall` to a rough worst-case price per call (check current OpenRouter prices). The estimate is only used for the pre-run warning. The real cost comes from OpenRouter and counts against the budget cap.

## Modes

- Benchmark: each model gets its own board on an identical seeded maze. Scores are directly comparable.
- Arena: all models race through one shared maze.

Both run in real time. A model keeps its last direction until its next answer arrives, so slow models lose ground.

## Scenarios

Size: small 11x11, medium 21x21, large 31x31. Complexity: simple (open, many loops), medium (classic corridors), complex (perfect maze, many dead ends, no loops). Ghosts: 1, 2 or 4 with mixed chase, ambush and random behavior. Each level grows the maze by 4 cells per side (cap 41) and adds a ghost every second level (cap 6).

Presets: `default` (2 scenarios, cheapest), `sizeSweep`, `complexitySweep`, `full` (27). Use "Custom selection" to pick any combination.

## Controlling cost

- Click Estimate before a run. It shows a worst-case upper bound.
- The default selection is the three free baselines only. Paid models are listed but unchecked; tick them on purpose.
- Run always shows a confirm dialog when a paid model is selected (it says so if no cost estimate is available), then sets the server budget. If the proxy is not running or rejects the budget, the run is cancelled and nothing is sent to a model. Baseline-only runs never contact the server before running.
- The server refuses calls once the money cap or the call cap is reached, and the run stops with partial results.
- Settings are validated before Estimate or Run: seeds 1 to 20, tick ms 30 to 1000, max ticks 50 to 5000 (all whole numbers), and a budget above 0 when a paid model is selected.
- "Max ticks per game" is the main cost knob (default 400, about 1 minute per game at 150 ms ticks). A fast model can make about one call per tick, so the worst case is max ticks calls per model per game. Lower it or use fewer seeds to shrink a run. There is no separate per-game call cap in the UI, so fast models are not throttled before the game ends.
- Start with the default preset and 1 seed.
- Concurrent in-flight requests can overshoot the cap by a few calls.

## Results

The heatmap shows models by scenario for the chosen metric (mean score, level, survival, latency). The winner line lists the highest mean score per scenario. Runs are saved to `results/run-<timestamp>.json` (git-ignored).

## Tests

    npm test          # no network, no cost
    npm run typecheck
    npm run build

## Layout

- `src/engine`: pure seeded game engine (maze, ghosts, scoring, levels)
- `src/agents`: agent interface, observation encoding, baselines, OpenRouter agent
- `src/runner`: real-time session, scenario matrix, run plans, estimate, aggregation
- `src/server`: local proxy with budget cap and result storage
- `src/ui`: canvas boards, panels, heatmap
