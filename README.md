# Pacman arena

A Pac-Man game where AI models play and compete. Pick models (called through [OpenRouter](https://openrouter.ai)) and a few free built-in players, choose mazes of different sizes and difficulty, and see who scores best. Results build up into a ranking.

You watch each model play live in the browser. A model that answers slowly keeps walking in its last direction until its answer arrives, so speed matters as well as quality.

## What it does

- **Two modes.** Benchmark gives every model its own board on an identical maze, so scores compare fairly. Arena puts all models in one shared maze, racing for the same dots.
- **Many conditions.** Maze size (small 11x11, medium 21x21, large 31x31, huge 61x61), layout (simple, medium, complex, labyrinth), ghosts (0, 1, 2 or 4) and vision (full or fog of war, where a player only sees cells within 4 steps).
- **Free players** to compare against and to try the game at no cost: Random, Greedy and a shortest-path Planner.
- **Ranking across all your runs.** A head-to-head rating (Elo-like, with a 95% range) built from games played on identical mazes, plus an average-rank view. Filter by size, layout, ghosts and vision, and export CSV.
- **Cost safety.** Paid models are never selected by default. Every paid run shows a worst-case cost estimate and asks for confirmation, then sets a spending cap on a local proxy that refuses calls once the cap is reached.

<img width="1920" height="986" alt="ezgif-34a6b324bc9f7220" src="https://github.com/user-attachments/assets/397398b7-df20-4f72-80ff-eacfca19bd46" />

## Quick start

Requires Node 22 and npm.

```
npm install
npm run dev
```

Open the address Vite prints (usually http://localhost:5173) and press **Run**. The three free players are selected by default, so this costs nothing and needs no key.

### Using paid models

```
cp config/.env.example config/.env   # then put your OpenRouter API key in config/.env
npm run server                       # local proxy on http://127.0.0.1:8787, in a second terminal
```

Keep `npm run dev` running too. The key stays in the proxy and is never sent to the browser. `config/.env` is git-ignored.

Models are listed in `src/models.config.ts`. Edit it to add or change models. The OpenRouter ids and price estimates in that file are placeholders to check against the current OpenRouter model pages. The pre-run estimate is a worst-case upper bound, and the real cost comes from OpenRouter and counts against your cap.

## Documentation

- [Usage guide](docs/usage.md): modes, scenarios, reading the board, ranking, cost controls, troubleshooting.
- [Design specs](docs/superpowers/specs/) and [implementation plans](docs/superpowers/plans/): how and why it was built.

## Development

```
npm test            # offline, free
npm run typecheck
npm run build
```

Tests never call OpenRouter. The game engine (`src/engine`) is pure and seeded: the same scenario and seed always produce the same maze and ghost behavior.

```
src/engine    seeded game engine (mazes, ghosts, scoring, levels)
src/agents    agent interface, observations, free players, OpenRouter agent
src/runner    real-time sessions, scenarios, run plans, cost estimates
src/ranking   rating and average-rank computations (pure)
src/server    local proxy with a spending cap and result storage
src/ui        browser UI (canvas boards, ranking panel)
```

## Status and limitations

- Early project. The browser UI was checked with scripted headless runs, not with a full manual test pass.
- Model ids and prices in `src/models.config.ts` are unverified placeholders.
- The proxy runs on your machine only (127.0.0.1) and accepts requests from `localhost` pages. It is not meant to be exposed to a network.
- Rating ranges are bootstrap estimates and are optimistic on small samples. More games narrow them.
