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

Edit `src/models.config.ts`. Set `model` to the OpenRouter model id, set `enabled: true`, and set `estUsdPerCall` to a rough worst-case price per call (check current OpenRouter prices). The estimate is only used for the pre-run warning. It scales with maze size: a Huge maze is about 3.9 times the area of a Large one. The estimate uses a factor of 1.7 for Small to Large (allowing for later levels growing to 41x41) and 3.7 for Huge, so the worst-case figure is an upper bound. The real cost comes from OpenRouter and counts against the budget cap.

## Modes

- Benchmark: each model gets its own board on an identical seeded maze. Scores are directly comparable.
- Arena: all models race through one shared maze.

Both run in real time. A model keeps its last direction until its next answer arrives, so slow models lose ground.

## Scenarios

Size: small 11x11, medium 21x21, large 31x31, huge 61x61. Complexity: simple (open, many loops), medium (classic corridors), complex (perfect maze, many dead ends, no loops). Ghosts: 0, 1, 2 or 4 (0 is a pure navigation control with nothing chasing the player) with mixed chase, ambush and random behavior. Each level grows the maze by 4 cells per side (cap 41) and adds a ghost every second level (cap 6). Growth never shrinks a huge maze, and a 0-ghost scenario stays at 0 ghosts.

Presets: `default` (2 scenarios, cheapest), `sizeSweep` (Small, Medium and Large only), `complexitySweep`, `noGhosts` (small, medium and large, medium layout, 0 ghosts), `huge` (huge, simple and complex layouts, 2 ghosts), `full` (48). Use "Custom selection" to pick any combination.

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

The Board size selector in Run settings sets how large the boards are drawn. Auto (the default) fits the boards to the page width, so a single board is large and several boards share a row. The other choices fix the board width from Small (320 px) to Extra large (960 px), and a change applies immediately, even during a run.

Before the first run the page shows a static preview board. Nothing plays on it, and the live boards replace it when a run starts.

The heatmap shows models by scenario for the chosen metric (mean score, level, survival, latency). The winner line lists the highest mean score per scenario.

Truncated games: a game stopped early (Stop button or budget cap) is marked truncated. It is left out of every mean and cannot win a scenario, but its cost still counts. A heatmap cell with stopped games shows `*` (hover for the count), and a note appears under the heatmap. A cell with no finished games shows `-`.

## Ranking

The Ranking panel above the results heatmap rates models across every finished run. When a run ends it is saved to `results/run-<timestamp>.json` (git-ignored) with the models, scenarios and settings used. The panel reads all of those files on page load and after each run, so the results build up over time and survive reloads. This needs `npm run server`. Without it the panel shows only this session's runs and says so. Reading saved runs never starts a run or calls a model.

Two buttons switch the view: Rating (the default) and Average rank.

### Rating view

The Rating view compares models head to head across all runs, so you do not have to run everything at once.

- A match is two models playing the same maze: the same run settings, scenario and seed. The model with the higher score wins and equal scores are a draw. If a model played that maze more than once, its mean score is used. Matches are decided by score only. Survival (ticks) and Lives left are shown beside it for context.
- Wins and draws are turned into a rating on an Elo-like scale. 1000 is the average model, and every 400 points means about 10 times the odds of winning a match.
- 95% range is how much the rating could move with different luck, found by resampling the matches. More runs on more seeds and scenarios narrow the range, so a wide range means the rating is still uncertain.
- Only models that are linked by shared matches can be compared. Models that have not played the same scenarios and seeds as the rest are listed under "Not connected yet".
- Games stopped early are not counted. Games that ended by connection or setup errors (for example a wrong model id or a network failure) are not counted either, so a broken setup does not hurt a model's rating. A model that answered but gave no usable move still counts. Each exclusion is shown in a note.
- Arena runs are not rated. They are counted in a note.
- The first select starts on All settings, which mixes runs with different tick speeds and max ticks. That gives more matches but blurs the result, because the same model can score differently at different settings. Pick one settings group for a cleaner comparison.
- Cost per 1,000 pts is the model's total cost divided by its total score in thousands, or `-` when its score is 0.

### Average rank view

- Only runs with the same settings (mode, tick speed, max ticks) are combined, so arena and benchmark runs are ranked separately. Pick the settings in the first select (newest first).
- Games stopped early and games that ended by connection or setup errors are left out and counted in notes. Runs saved without settings info (older format) are left out, with a count.
- Ranking uses the largest block of overlapping data: a set of scenarios and the models that have finished games in every one of them. Other models are listed under "Not enough data yet" with the number of scenarios they are missing.
- In each scenario, models are ordered by mean score. Ties share the average of their positions. The overall order is the average rank across scenarios (lower is better), and ties in average rank share a rank number.
- Wins is the number of scenarios where a model has the best mean score.
- Survival (ticks) and Lives left are the mean over the model's counted games.

### Filters and download

Filters: tick maze sizes, layout complexities or ghost counts to use only those scenarios. With nothing ticked in a group, all are included. They apply to both views. If the filters leave too little data, the panel says so.

Download CSV saves the table that is currently shown, as `rating.csv` or `ranking.csv`.

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
