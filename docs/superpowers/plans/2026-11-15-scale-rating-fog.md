# Bigger mazes, all-runs rating and harder obstacles implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 61x61 Huge maze and 0-ghost scenarios with size-aware cost estimates, a Bradley-Terry rating across all runs, and harder obstacles (labyrinth layout, fog of war).

**Architecture:** Extends the existing scenario matrix (`src/runner/scenarios.ts`), engine config (`src/engine`), observation encoding and baselines (`src/agents`), pure ranking module (`src/ranking`) and ranking panel (`src/ui`). Spec: `docs/superpowers/specs/2026-11-15-scale-rating-fog-design.md`.

**Tech stack:** TypeScript, Vitest, Vite (existing; no new dependencies).

## Global constraints

- Work only in `/Users/kuok/Documents/GitHub/pac-man`, branch `feat/pacman-arena`. Do not push or touch any git remote.
- The working tree may contain an uncommitted user edit to `src/models.config.ts`. Never stage or commit it. Use explicit `git add <paths>`; never `git add -A` or `git commit -a`.
- A real OpenRouter key is in `config/.env` on this machine. NEVER make a real OpenRouter call, NEVER start the proxy server (`npm run server` or `tsx src/server/index.ts`), never read or print `config/.env`. All tests are offline and free. You may start only the Vite dev server (`npx vite --port 5199`) for a transform smoke check; kill it by PID afterwards and confirm the port is free.
- The engine (`src/engine`) and `src/ranking/*.ts` stay pure: no DOM, no I/O, no `Date`, no `Math.random` (use `makeRng(seed)` for any randomness).
- Code style: 2-space indent, single quotes, semicolons, named exports, no default exports, comments only where the reason is non-obvious. UI copy in sentence case. No `innerHTML` with data; use `textContent` and DOM APIs.
- Never save markdown to the repo root. Docs go in `docs/` and must be updated for every user-visible change (`docs/usage.md`).
- TDD: write the tests first, watch them fail, then implement. Run `npm test && npm run typecheck && npm run build` before every commit; all must pass with clean output.
- Every commit message ends with a blank line then `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- No automated browser test exists; do not claim visual verification of UI changes.

Read before starting any task: `src/runner/scenarios.ts`, `src/runner/estimate.ts`, `src/engine/engine.ts`, `src/engine/maze.ts`, `src/engine/types.ts`, `src/agents/observation.ts`, `src/agents/baselines.ts`, `src/ranking/rank.ts`, `src/ui/ranking-panel.ts`, `src/ui/main.ts`, `docs/usage.md`, and the existing tests for the files you change.

---

### Task 1: Huge maze, 0 ghosts, size-aware cost estimate

**Files:**
- Modify: `src/runner/scenarios.ts`, `src/runner/estimate.ts`, `src/engine/engine.ts`, `src/ranking/rank.ts`, `src/ui/ranking-panel.ts`, `src/ui/main.ts`, `docs/usage.md`
- Test: `tests/runner.test.ts`, `tests/engine.test.ts`, `tests/maze.test.ts`, `tests/rank.test.ts`, `tests/e2e.test.ts`

**Interfaces:**
- Produces:
  - `SizeKey = 'small' | 'medium' | 'large' | 'huge'`; `SIZES.huge = 61`; exported `SIZE_KEYS: SizeKey[]` and `GHOST_COUNTS: (0 | 1 | 2 | 4)[]`.
  - `Scenario.ghosts: 0 | 1 | 2 | 4`; `makeScenario(size, complexity, ghosts)` ids stay `${size}-${complexity}-${ghosts}g` (so `small-simple-0g` is valid); name uses `ghost` only for 1, else `ghosts`.
  - `ALL_SCENARIOS` (4 sizes x 3 layouts x 4 ghost counts = 48 at this point), `PRESETS` keys: `default` (unchanged), `sizeSweep` (unchanged), `complexitySweep` (unchanged), `noGhosts` (small, medium, large; medium layout; 0 ghosts), `huge` (huge; simple and complex layouts; 2 ghosts), `full` (all scenarios).
  - `promptCostFactor(s: Scenario): number` = `Math.max(1, SIZES[s.size] ** 2 / 1000)`.
  - `EstimateInput.scenarioCostFactors?: number[]` (one factor per scenario, default all 1). `maxUsd = sum over factors f of (f * seeds * maxCallsPerGame * sum of llm estUsdPerCall)`; when `scenarioCostFactors` is given its length is used as the scenario count for `games` and `maxCalls` is unchanged (still uses `scenarios`). Keep `scenarios: number` in the input; when the factors array is provided it must have the same length (throw otherwise).
  - `levelConfig`: width and height cap becomes `Math.min(base + grow, Math.max(41, base))`; ghostCount is `0` whenever `base.ghostCount === 0`, otherwise the existing formula.
  - `parseScenarioId` accepts `huge` and `0g`.

- [ ] **Step 1: Write the failing tests.** In the existing test files add: scenarios (48 unique ids; `small-simple-0g` and `huge-complex-2g` exist; presets reference known ids; `PRESETS.full` has 48; `PRESETS.huge` and `PRESETS.noGhosts` contents; `promptCostFactor` for small = 1, medium = 1, large = 1 (961/1000 floors to 1), huge = 3.721; `scenarioConfig` for a huge 0-ghost scenario gives width 61 and ghostCount 0); estimate (factors `[1, 3.721]` with seeds 2, maxCallsPerGame 100, one llm at 0.01 gives `maxUsd` close to `2 * 100 * 0.01 * 4.721`; mismatched factor length throws); engine (`levelConfig` of a 61 base stays 61x61 at level 1, 2 and 10; a 0-ghost base has `ghostCount` 0 at level 1, 3 and 9 and a 1-ghost base still grows; a game with 0 ghosts steps 100 ticks without throwing and no player loses a life to a ghost); maze (generate 61x61 for each complexity with seed 1 and 2: every open cell reachable); rank (`parseScenarioId('huge-simple-0g')` parses with `size: 'huge', ghosts: 0`); e2e (`runPlan` with scenario `makeScenario('huge', 'simple', 0)`, baselines, `maxTicks` 30, `tickMs` 0 completes with finite scores and finishes within the test timeout).
- [ ] **Step 2: Run to verify the new tests fail.** `npx vitest run`.
- [ ] **Step 3: Implement** the changes listed under Interfaces in `scenarios.ts`, `estimate.ts` and `engine.ts`; update the `SCENARIO_RE` in `rank.ts` to `^(small|medium|large|huge)-(simple|medium|complex)-(0|1|2|4)g$`.
- [ ] **Step 4: UI.** In `src/ui/ranking-panel.ts` build the size and ghost checkbox lists from `SIZE_KEYS` and `GHOST_COUNTS` instead of hardcoded lists. In `src/ui/main.ts` pass `scenarioCostFactors: plan.scenarios.map(promptCostFactor)` wherever `estimateRun` is called (Estimate button and Run confirm). Add the new presets to the preset select automatically (it already iterates `PRESETS`).
- [ ] **Step 5: Docs** (`docs/usage.md`): sizes table with Huge 61x61, 0 ghosts as a navigation control, new presets, that the cost estimate scales with maze size (a huge call sends about 3.7 times the text of a large one), and that growth never shrinks a Huge maze.
- [ ] **Step 6: Verify and commit.** `npm test && npm run typecheck && npm run build`, Vite transform smoke on `src/ui/main.ts` and `src/ui/ranking-panel.ts`. Commit: `feat: add huge maze, 0-ghost scenarios and size-aware cost estimates`.

---

### Task 2: Rating across all runs

**Files:**
- Create: `src/ranking/rating.ts`
- Modify: `src/ranking/rank.ts` (infra-failure exclusion), `src/runner/types.ts` (only if `lastError` typing needs it), `src/ui/ranking-panel.ts`, `src/ui/main.ts` (only if needed), `docs/usage.md`
- Test: `tests/rating.test.ts`, `tests/rank.test.ts`

**Interfaces:**
- Consumes: `StoredRun`, `RunMeta`, `RankFilter`, `parseScenarioId`, `groupKey` from `src/ranking/rank.ts`; `makeRng` from `src/engine/rng.ts`; `GameResult` (fields `agentId`, `scenarioId`, `seed`, `score`, `disqualified`, `lastError?`, `truncated`, `avgLatencyMs`, `costUsd`).
- Produces in `src/ranking/rank.ts`: `isConnectionFailure(r: GameResult): boolean` = `r.disqualified && !/^(unparseable|no move)/.test(r.lastError ?? '')`. `buildRanking` and `buildRatings` both skip such games; `Ranking` gains `connectionExcluded: number`.
- Produces in `src/ranking/rating.ts`:
  ```ts
  export interface RatingRow { rank: number; agentId: string; label: string; rating: number; low: number; high: number; matches: number; winRate: number; games: number; meanSurvivedTicks: number; meanLivesLeft: number; meanLatencyMs: number; totalCostUsd: number; costPer1000Points: number | null }
  export interface Ratings { rows: RatingRow[]; notConnected: { agentId: string; label: string }[]; matches: number; truncatedExcluded: number; connectionExcluded: number; arenaSkipped: number }
  export function buildRatings(runs: StoredRun[], filter: Omit<RankFilter, 'settingsKey'> & { settingsKey?: string }): Ratings
  export function ratingsToCsv(rows: RatingRow[]): string
  ```

Algorithm for `buildRatings` (pure, deterministic):
1. Collect results from runs whose `meta` is non-null. Runs with `meta.mode !== 'benchmark'` contribute only to `arenaSkipped` (count of their results after the same scenario filter). If `filter.settingsKey` is set, only runs with that `groupKey` are used; otherwise all benchmark runs are used.
2. Apply the scenario filter (`sizes`, `complexities`, `ghosts` via `parseScenarioId`). Skip unparseable scenario ids. Skip and count `truncated === true` (`truncatedExcluded`) and `isConnectionFailure` games (`connectionExcluded`). Skip results with non-finite `score`.
3. Matches: group remaining games by `groupKey(meta) + '|' + scenarioId + '|' + seed`. When one model has several games in a group, average its score. For every unordered pair of models in a group, one match: the higher mean score wins; equal is a draw.
4. Connectivity: build an undirected graph of models linked by matches; keep the largest connected component (ties: the one whose smallest agentId sorts first); models outside it go to `notConnected`. A model with data but no matches also goes to `notConnected`.
5. Fit Bradley-Terry strengths with the MM update, draws as half a win to each side, plus a prior of one virtual draw between every model and a virtual average opponent of strength 1 (so unbeaten models stay finite). Iterate up to 500 times or until the largest relative change is below 1e-10. Normalize so the geometric mean of strengths is 1. `rating = 1000 + 400 * log10(strength)`.
6. 95% range: 200 bootstrap resamples of the matches (with replacement) using `makeRng(12345)`, refit each, take the 2.5th and 97.5th percentiles per model (nearest rank). A model absent from a resample's connected structure is treated as strength 1 for that resample.
7. `matches` per model = number of matches it is in. `winRate` = (wins + 0.5 * draws) / matches. `games`, `meanSurvivedTicks` (mean of `survivedTicks`), `meanLivesLeft` (mean of `livesLeft`), `meanLatencyMs`, `totalCostUsd`, `costPer1000Points` are over that model's counted games (same definitions as `rank.ts`). Matches are decided by score only: the user chose score as the ranking metric, with survival and lives shown beside it. Add the same two fields `meanSurvivedTicks` and `meanLivesLeft` to `RankRow` in `src/ranking/rank.ts` (computed over the same counted games as `meanScore`) and to `toCsv` (columns `survival_ticks` and `lives_left` right after `games`; decimals 0 and 2), updating the existing `rank.test.ts` expectations. Rows sorted by rating descending, then label; `rank` uses competition numbering on equal ratings rounded to 6 decimals.
8. `ratingsToCsv` writes header `rank,model,rating,low,high,matches,win_rate,games,survival_ticks,lives_left,mean_latency_ms,total_cost_usd,cost_per_1000_points` with the same escaping rules as `toCsv` in `rank.ts`; rating, low, high with 0 decimals, win_rate with 3, survival_ticks 0, lives_left 2, latency 0, cost 4.

- [ ] **Step 1: Write the failing tests** (`tests/rating.test.ts`): a model that always beats another is rated higher with `low <= rating <= high`; two identical models (all draws) have equal ratings near 1000; three models in a chain A beats B, B beats C are all connected and ordered A, B, C; a disconnected pair of models lands in `notConnected` while the larger component is rated; benchmark matches are only formed within the same settings, scenario and seed (a pair that never shares a seed produces no match and so is not connected); arena runs are skipped and counted; truncated and connection-failure games are excluded and counted, while games disqualified with `unparseable: "..."` count; unbeaten models get a finite rating; results are deterministic across two calls (deep equal); the filter by size and `settingsKey` works; `ratingsToCsv` output for one row. In `tests/rank.test.ts` add: `buildRanking` excludes connection-failure games and reports `connectionExcluded`, while `unparseable` disqualified games count; legacy games (no `lastError`, `disqualified: true`) are treated as connection failures.
- [ ] **Step 2: Run to verify they fail.** `npx vitest run tests/rating.test.ts tests/rank.test.ts`.
- [ ] **Step 3: Implement** `rating.ts` and the `rank.ts` changes. Keep `rating.ts` free of DOM and I/O.
- [ ] **Step 4: Panel.** In `src/ui/ranking-panel.ts` add a view toggle (two buttons or a select) with `Rating` (default) and `Average rank`. Rating view: settings select gets an extra first option `All settings` (default); columns Rank, Model, Rating (0 decimals), 95% range (`low-high`), Matches, Win rate (percent, 0 decimals), Games, Survival (ticks, 0 decimals), Lives left (2 decimals), Mean latency, Total cost, Cost per 1,000 pts. The Average rank view also gets Survival (ticks) and Lives left columns after Games. Notes: `N matches between M models.`; `K games stopped early are not counted.`; `C games ended by connection or setup errors are not counted.`; `A arena games are not used for ratings.`; `Not connected yet: <labels> (they have not played the same scenarios and seeds as the others).`; hint when no rows: `No head-to-head matches yet. Run two or more models on the same scenarios and seeds in benchmark mode.` Average rank view keeps its current table and notes and also shows the connection-failure note. The CSV button exports the view shown (`ratingsToCsv` or `toCsv`). Filters (size, layout, ghosts) apply to both views; the settings select applies to both (in the Average rank view `All settings` is not offered and the newest group is the default, as before). Preserve user choices across `update` calls.
- [ ] **Step 5: Docs** (`docs/usage.md`): explain the Rating view in plain words (matches on identical mazes, win/draw, Elo-like scale where 1000 is the average model, 95% range, more runs narrow the range), connection failures are excluded, arena runs are not rated, the Average rank view, and that mixing settings blurs the result.
- [ ] **Step 6: Verify and commit.** Full checks and the Vite transform smoke. Commit: `feat: head-to-head rating across all runs`.

---

### Task 3: Labyrinth layout and fog of war

**Files:**
- Modify: `src/engine/types.ts`, `src/engine/maze.ts`, `src/engine/engine.ts` (only if needed), `src/runner/scenarios.ts`, `src/agents/observation.ts`, `src/agents/baselines.ts`, `src/ranking/rank.ts`, `src/ui/ranking-panel.ts`, `src/ui/main.ts`, `docs/usage.md`
- Test: `tests/maze.test.ts`, `tests/agents.test.ts`, `tests/runner.test.ts`, `tests/rank.test.ts`, `tests/e2e.test.ts`

**Interfaces:**
- `Complexity = 'simple' | 'medium' | 'complex' | 'labyrinth'`.
- `ScenarioConfig.vision: number | null` (Manhattan radius of visible cells; `null` = full vision). Existing test helper `config()` in `tests/helpers.ts` gets `vision: null` by default.
- `Scenario.vision: 'full' | 'fog'`; `makeScenario(size, complexity, ghosts, vision = 'full')`; id is `${size}-${complexity}-${ghosts}g` plus `-fog` when vision is `fog`; name appends `, fog`. Fog radius constant `FOG_RADIUS = 4` exported from `scenarios.ts`; `scenarioConfig` sets `vision: s.vision === 'fog' ? FOG_RADIUS : null`.
- `ALL_SCENARIOS`: every combination of size (4), layout (4), ghosts (4) and vision (2) = 128. Presets: existing presets keep their full-vision scenarios; `full` = all 64 full-vision scenarios; new `fogSweep` = small and medium sizes x simple, complex and labyrinth layouts x 1 ghost x fog (6 scenarios).
- `parseScenarioId(id)` returns `{ size, complexity, ghosts, vision: 'full' | 'fog' }` and accepts `labyrinth` and the optional `-fog` suffix. `RankFilter` gains `visions?: ('full' | 'fog')[]` (empty or undefined = all) applied in both `buildRanking` and `buildRatings`.
- `generateMaze(width, height, 'labyrinth', seed)`: same carve as the others but with a straight bias, no braiding and no extra opened cells (no loops).

Labyrinth carve: while carving, remember the previous step direction; when picking the next step, if continuing in the same direction is possible, take it with probability 0.85 (using the seeded rng); otherwise choose among the remaining options by the existing shuffle. `BRAID.labyrinth = 0`, `EXTRA_OPEN.labyrinth = 0`.

Fog observation (`encodeObservation`): when `state.config.vision` is a number `r`, any cell whose Manhattan distance from the observing player is greater than `r` is drawn as `?` (walls, pellets, ghosts and other players included; the player's own cell stays `P`). The text gains the line `Fog of war: cells more than ${r} steps away are shown as ?.` after the legal moves line and before the maze rows, and a line `Position: (x, y)` right after the status line (x is the column, y the row, both from 0). Observations for `vision: null` stay byte-for-byte identical to today's. `SYSTEM_PROMPT` is not changed.

Fog baselines: when `state.config.vision` is a number `r`, `GreedyAgent` and `PlannerAgent` only consider pellets, power pellets and ghosts within Manhattan distance `r` of the player. If no pellet is visible, they keep moving in the current direction when that move is legal, otherwise take the first legal move that is not the reverse of the current direction (falling back to any legal move). `RandomAgent` is unchanged. With `vision: null` behavior is unchanged.

- [ ] **Step 1: Write the failing tests.** Maze: `labyrinth` has 0 loops and every open cell reachable for seeds 1 to 5 at 21x21; summed over seeds 1 to 5 at 31x31 its `avgCorridorLength` is greater than `complex`'s; deterministic per seed. Observation: with `vision: 3`, cells at distance 4 or more render as `?`, cells within 3 render normally, the `Fog of war` and `Position` lines are present, a ghost 5 cells away is not shown, and a `vision: null` observation equals the previous format (compare against an observation built before the change by snapshotting the old exact text for a fixed seed inside the test). Baselines: with fog and a pellet outside the radius, greedy and planner keep their current direction instead of heading to it; with a pellet inside the radius they go for it; a ghost outside the radius is ignored. Scenarios: 128 unique ids; `PRESETS.full` has 64 and all are full vision; `fogSweep` has 6 fog scenarios; `scenarioConfig` of a fog scenario has `vision: 4`, full has `null`; ids with `-fog` and `labyrinth` parse. Rank: `parseScenarioId` returns `vision`; `buildRanking` and `buildRatings` filter by `visions`. E2E: `runPlan` with a small labyrinth fog scenario and baselines, `maxTicks` 60, completes with finite scores.
- [ ] **Step 2: Run to verify they fail.** `npx vitest run`.
- [ ] **Step 3: Implement** the engine, maze, scenario, observation, baseline and ranking changes above. Update `tests/helpers.ts` `config()` with `vision: null`.
- [ ] **Step 4: UI.** In `src/ui/ranking-panel.ts` add a Vision checkbox group (`full`, `fog`) wired like the others and passed as `visions`. Scenario names already include `fog`; the custom scenario list in `main.ts` iterates `ALL_SCENARIOS` so it now shows 128 entries (it scrolls). Nothing else changes in the live boards.
- [ ] **Step 5: Docs** (`docs/usage.md`): the labyrinth layout, fog of war (what the model sees, that baselines see only the same cells, that the spectator board shows everything, that fog scenarios are listed under Custom selection and in the `fogSweep` preset), updated scenario count, and that the `full` preset stays full-vision to protect cost.
- [ ] **Step 6: Verify and commit.** Full checks and the Vite transform smoke. Commit: `feat: add labyrinth layout and fog of war scenarios`.

---

## Self-review

- **Spec coverage:** Section 1 (huge, 0 ghosts, cost scaling, presets, growth cap) is Task 1. Section 2 (pairwise rating, bootstrap range, connectivity, connection-failure exclusion, arena skipped, secondary average-rank view, CSV, All settings) is Task 2. Section 3 (labyrinth, fog, baselines under fog, scenario counts, presets, ranking filter) is Task 3.
- **Placeholders:** none; algorithmic steps are specified exactly. Tasks edit existing files whose current contents the implementer must read first.
- **Type consistency:** `SizeKey`, `Scenario`, `ScenarioConfig.vision`, `RankFilter`, `RatingRow`, `Ratings` and `parseScenarioId`'s return type are introduced once and reused with the same names across tasks; Task 3 extends `parseScenarioId` and `RankFilter` that Tasks 1 and 2 define.
