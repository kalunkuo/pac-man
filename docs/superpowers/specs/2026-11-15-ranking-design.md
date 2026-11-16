# Model ranking design

Date: 2026-11-15. Extends `2026-11-15-pacman-arena-design.md`.

## Goal

A ranking of models that builds up automatically from every finished run, replacing the "Saved runs" list as the main way to look at results.

## Behavior

- A **Ranking** panel sits above the live results heatmap. It shows a ranked table: rank, model, average rank, scenarios covered, wins, games, mean score, mean level, mean latency, total cost, cost per 1,000 points.
- Filters: maze size, layout complexity, ghost count, and run settings (mode, tick speed, max ticks). The settings filter is a single choice; the others are multi-select with "no selection" meaning all.
- A CSV export button downloads the table currently shown.
- Every finished run is already saved by the proxy (`results/run-*.json`). The ranking reads all saved runs (`GET /api/results`), on page load and after each run, so it persists across reloads. If the proxy is not running, the panel shows the current session's runs only, with a note.
- The "Saved runs" section (select and two buttons) is removed from the page.

## Ranking rule

1. Only runs with the same settings (mode, tick speed, max ticks) are combined. Runs saved without metadata (older format) cannot be grouped and are left out, with a count shown.
2. Games stopped early (`truncated: true`) are excluded and counted in a note.
3. A scenario is considered when at least 2 models have completed games in it.
4. Only models with completed games in every considered scenario are ranked. Other models are listed as "not enough data yet" with the number of considered scenarios they are missing.
5. In each considered scenario, ranked models are ordered by mean score. Tied scores share the average of the positions they occupy.
6. Overall order is by average rank across considered scenarios (lower is better). Ties in average rank share a rank number and are listed by higher mean score, then by label.
7. Wins = number of considered scenarios where the model's mean score equals the best mean score.
8. Cost per 1,000 points = total cost of the model's counted games divided by (sum of its game scores / 1,000). Shown as `-` when the score sum is 0.

## Units

- `src/ranking/rank.ts`: pure functions (`parseScenarioId`, `listGroups`, `buildRanking`, `toCsv`) and their types. No DOM, no I/O.
- `src/ui/ranking-panel.ts`: DOM for filters, table, notes and CSV download. Calls `rank.ts`.
- `src/ui/main.ts`: loads stored runs, keeps the current session's runs as a fallback, refreshes the panel after each run.

## Out of scope

Sharing the ranking with other people (needs a snapshot export and hosting), Elo or confidence intervals, deleting stored runs.
