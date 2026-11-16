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

The proxy starts even when `config/.env` does not exist. Without a key, paid calls return a clear `OPENROUTER_API_KEY is not set` error and nothing is sent to OpenRouter.

Baselines (random, greedy, shortest-path planner) need no key and cost nothing. The server is only needed for LLM models and for saving results to `results/`.

## Add Jev and other models

Edit `src/models.config.ts`. Set `model` to the OpenRouter model id, set `enabled: true`, and set `estUsdPerCall` to a rough worst-case price per call (check current OpenRouter prices). The estimate is only used for the pre-run warning. It scales with maze size: a huge call sends about 3.7 times the text of a large one, so the pre-run estimate multiplies huge scenarios by 3.7. The real cost comes from OpenRouter and counts against the budget cap.

## Modes

- Benchmark: each model gets its own board on an identical seeded maze. Scores are directly comparable.
- Arena: all models race through one shared maze.

Both run in real time. A model keeps its last direction until its next answer arrives, so slow models lose ground.

## Scenarios

Size: small 11x11, medium 21x21, large 31x31, huge 61x61. Complexity: simple (open, many loops), medium (classic corridors), complex (perfect maze, many dead ends, no loops). Ghosts: 0, 1, 2 or 4 (0 is a pure navigation control with nothing chasing the player) with mixed chase, ambush and random behavior. Each level grows the maze by 4 cells per side (cap 41) and adds a ghost every second level (cap 6). Growth never shrinks a huge maze, and a 0-ghost scenario stays at 0 ghosts.

Presets: `default` (2 scenarios, cheapest), `sizeSweep`, `complexitySweep`, `noGhosts` (small, medium and large, medium layout, 0 ghosts), `huge` (huge, simple and complex layouts, 2 ghosts), `full` (48). Use "Custom selection" to pick any combination.

## Controlling cost

- Click Estimate before a run. It shows a worst-case upper bound.
- The default selection is the three free baselines only. Paid models are listed but unchecked; tick them on purpose.
- Run always shows a confirm dialog when a paid model is selected (it says so if no cost estimate is available), then sets the server budget. If the proxy is not running or rejects the budget, the run is cancelled and nothing is sent to a model. Baseline-only runs never contact the server before running.
- The server refuses calls once the money cap or the call cap is reached, and the run stops with partial results.
- Settings are validated before Estimate or Run: seeds 1 to 20, tick ms 30 to 1000, max ticks 50 to 5000 (all whole numbers), and a budget above 0 when a paid model is selected.
- "Max ticks per game" is the main cost knob (default 400, about 1 minute per game at 150 ms ticks). A fast model can make about one call per tick, so the worst case is max ticks calls per model per game. Lower it or use fewer seeds to shrink a run. There is no separate per-game call cap in the UI, so fast models are not throttled before the game ends.
- Start with the default preset and 1 seed.
- If OpenRouter omits the cost in a reply, the proxy charges a fallback of 0.01 USD for that call so the cap still works. The response is flagged `costEstimated`. If OpenRouter reports out of credit (HTTP 402), the run stops with partial results.
- Each model request times out after 30 seconds and counts as an error.
- Concurrent in-flight requests can overshoot the cap by a few calls.

## Results

Before the first run the page shows a static preview board. Nothing plays on it, and the live boards replace it when a run starts.

The heatmap shows models by scenario for the chosen metric (mean score, level, survival, latency). The winner line lists the highest mean score per scenario.

Truncated games: a game stopped early (Stop button or budget cap) is marked truncated. It is left out of every mean and cannot win a scenario, but its cost still counts. A heatmap cell with stopped games shows `*` (hover for the count), and a note appears under the heatmap. A cell with no finished games shows `-`.

## Ranking

The Ranking panel above the results heatmap ranks models across every finished run. When a run ends it is saved to `results/run-<timestamp>.json` (git-ignored) with the models, scenarios and settings used. The panel reads all of those files on page load and after each run, so the ranking builds up over time and survives reloads. This needs `npm run server`. Without it the panel shows only this session's runs and says so. Reading saved runs never starts a run or calls a model.

How the ranking works:

- Only runs with the same settings (mode, tick speed, max ticks) are combined, so arena and benchmark runs are ranked separately. Pick the settings in the first select (newest first).
- Games stopped early are left out and counted in a note. Runs saved without settings info (older format) are left out, with a count.
- Ranking uses the largest block of overlapping data: a set of scenarios and the models that have finished games in every one of them. Other models are listed under "Not enough data yet" with the number of scenarios they are missing.
- In each scenario, models are ordered by mean score. Ties share the average of their positions. The overall order is the average rank across scenarios (lower is better), and ties in average rank share a rank number.
- Wins is the number of scenarios where a model has the best mean score.
- Cost per 1,000 pts is the model's total cost divided by its total score in thousands, or `-` when its score is 0.

Filters: tick maze sizes, layout complexities or ghost counts to rank on those scenarios only. With nothing ticked in a group, all are included. If the filters leave too little overlapping data, the panel says so.

Download CSV saves the table that is currently shown as `ranking.csv`.

## When a model fails

A model that fails 5 calls in a row is disqualified. Its board then shows `errors N · ... · last error: <reason>`, and the reason is saved with the run result as `lastError`. Common reasons:

- `http 502: upstream 404 - ...`: the OpenRouter model id is wrong or the model is unavailable. The text after the dash comes from OpenRouter.
- `http 502: upstream 401 - ...`: OpenRouter rejected the API key.
- `upstream credit exhausted`: the OpenRouter account is out of credit. The run stops with a budget message instead of counting an error.
- `unparseable: "..."`: the model replied with something that has no UP, DOWN, LEFT or RIGHT. Often it started explaining instead of answering within the 16-token limit. The quote shows the start of its reply.
- `network`: the page could not reach the proxy. Check that `npm run server` is running.

Restart the proxy (`npm run server`) after pulling server changes, because it does not reload itself. Without a restart, failures still show only the bare `http <status>`.

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
