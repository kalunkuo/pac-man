import { GreedyAgent, PlannerAgent, RandomAgent } from '../agents/baselines';
import { OpenRouterAgent } from '../agents/openrouter';
import type { Agent } from '../agents/types';
import { MODELS } from '../models.config';
import { createGame } from '../engine/engine';
import { aggregate, winners } from '../runner/aggregate';
import { estimateRun } from '../runner/estimate';
import { runPlan } from '../runner/run-plan';
import { ALL_SCENARIOS, PRESETS, makeScenario, scenarioConfig } from '../runner/scenarios';
import type { GameSession } from '../runner/session';
import type { GameResult, Mode, RunPlan } from '../runner/types';
import { describePlayer, renderHeatmap, type Metric } from './panels';
import { PLAYER_COLORS, drawBoard } from './render';
import { restoreRun } from './saved';
import { validateSettings } from './settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const BASELINES = [
  { id: 'random', label: 'Random' },
  { id: 'greedy', label: 'Greedy pellets' },
  { id: 'planner', label: 'Shortest-path planner' },
];

function makeAgent(id: string): Agent {
  if (id === 'random') return new RandomAgent('random', 'Random', 1);
  if (id === 'greedy') return new GreedyAgent('greedy', 'Greedy pellets');
  if (id === 'planner') return new PlannerAgent('planner', 'Shortest-path planner');
  const m = MODELS.find((x) => x.id === id);
  if (!m) throw new Error(`unknown model ${id}`);
  return new OpenRouterAgent({ id: m.id, label: m.label, model: m.model });
}

// --- build controls ---
function checkbox(parent: HTMLElement, name: string, value: string, text: string, checked: boolean, disabled = false) {
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.name = name;
  input.value = value;
  input.checked = checked;
  input.disabled = disabled;
  label.append(input, ` ${text}`);
  parent.append(label);
  return input;
}

for (const m of MODELS) {
  const usable = m.enabled && m.model !== '';
  checkbox($('models'), 'agent', m.id, usable ? `${m.label} (${m.model}, paid)` : `${m.label} (set model id in src/models.config.ts)`, false, !usable);
}
for (const b of BASELINES) checkbox($('models'), 'agent', b.id, `${b.label} (free)`, true);

const presetSelect = $<HTMLSelectElement>('preset');
for (const name of Object.keys(PRESETS)) presetSelect.add(new Option(name, name));
for (const s of ALL_SCENARIOS) checkbox($('scenarios'), 'scenario', s.id, s.name, false);
function applyPreset() {
  const ids = new Set(PRESETS[presetSelect.value].map((s) => s.id));
  document.querySelectorAll<HTMLInputElement>('input[name=scenario]').forEach((i) => (i.checked = ids.has(i.value)));
}
presetSelect.onchange = applyPreset;
applyPreset();

// --- read the form ---
const checked = (name: string) =>
  [...document.querySelectorAll<HTMLInputElement>(`input[name=${name}]:checked`)].map((i) => i.value);
const num = (id: string) => Number($<HTMLInputElement>(id).value);

function readPlan(): { plan: RunPlan; llmCosts: { estUsdPerCall: number }[] } | null {
  const agentIds = checked('agent');
  const scenarioIds = new Set(checked('scenario'));
  if (agentIds.length === 0 || scenarioIds.size === 0) {
    $('status').textContent = 'Pick at least one model and one scenario.';
    return null;
  }
  const llmCosts = agentIds.flatMap((id) => {
    const m = MODELS.find((x) => x.id === id);
    return m ? [{ estUsdPerCall: m.estUsdPerCall }] : [];
  });
  const invalid = validateSettings({
    seeds: num('seeds'),
    tickMs: num('tickMs'),
    maxTicks: num('maxTicks'),
    budget: num('budget'),
    hasLlm: llmCosts.length > 0,
  });
  if (invalid) {
    $('status').textContent = invalid;
    return null;
  }
  const agents = agentIds.map(makeAgent);
  const seeds = Array.from({ length: num('seeds') }, (_, i) => i + 1);
  return {
    llmCosts,
    plan: {
      mode: $<HTMLSelectElement>('mode').value as Mode,
      scenarios: ALL_SCENARIOS.filter((s) => scenarioIds.has(s.id)),
      seeds,
      agents,
      tickMs: num('tickMs'),
      // At most one request starts per tick, so a cap equal to maxTicks never binds. It is only a safety net,
      // and it keeps fast models from being throttled before the game ends.
      maxCallsPerGame: num('maxTicks'),
      maxTicks: num('maxTicks'),
    },
  };
}

function estimate(p: { plan: RunPlan; llmCosts: { estUsdPerCall: number }[] }) {
  return estimateRun({
    scenarios: p.plan.scenarios.length,
    seeds: p.plan.seeds.length,
    mode: p.plan.mode,
    agentCount: p.plan.agents.length,
    llmAgents: p.llmCosts,
    maxCallsPerGame: p.plan.maxCallsPerGame,
  });
}

$('btnEstimate').onclick = () => {
  const p = readPlan();
  if (!p) return;
  const e = estimate(p);
  $('status').textContent = `${e.games} games, worst case ${e.maxCalls} model calls, up to $${e.maxUsd.toFixed(2)} (a fast model can make about one call per tick). Budget cap $${num('budget')}.`;
};

// --- live boards ---
type Board = { session: GameSession; canvas: HTMLCanvasElement; info: HTMLElement; wrap: HTMLElement; labels: Record<string, string> };
let boards: Board[] = [];
let colors: Record<string, string> = {};

function frame() {
  for (const b of boards) {
    drawBoard(b.canvas, b.session.state, colors);
    b.info.textContent = b.session.state.players
      .map((p) => describePlayer(b.labels[p.id], p, b.session.stats[p.id], b.session.state.level))
      .join('\n');
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function showGroup(sessions: GameSession[], agents: Agent[]) {
  const labels = Object.fromEntries(agents.map((a) => [a.id, a.label]));
  boards = sessions.map((session) => {
    const wrap = document.createElement('div');
    wrap.className = 'board';
    const canvas = document.createElement('canvas');
    const info = document.createElement('pre');
    wrap.append(canvas, info);
    return { session, canvas, info, labels, wrap };
  });
  $('boards').replaceChildren(...boards.map((b) => b.wrap));
}

// Static preview so the page shows a game before the first run. Nothing plays on it, and
// showGroup() replaces it with the live boards.
function showPreview() {
  const state = createGame(scenarioConfig(makeScenario('medium', 'medium', 2), 1), ['preview']);
  const wrap = document.createElement('div');
  wrap.className = 'board';
  const canvas = document.createElement('canvas');
  const caption = document.createElement('pre');
  caption.textContent = 'Preview. Pick models and click Run to start a game.';
  wrap.append(canvas, caption);
  $('boards').replaceChildren(wrap);
  drawBoard(canvas, state, { preview: PLAYER_COLORS[0] });
}
showPreview();

// --- run ---
let controller: AbortController | null = null;
let results: GameResult[] = [];
let shownAgents: { id: string; label: string }[] = [];
let shownScenarios = ALL_SCENARIOS.slice(0, 0);

function refreshResults() {
  const cells = aggregate(results);
  $('heatmapNote').textContent = cells.some((c) => c.truncatedGames > 0)
    ? '* some games were stopped early and are not counted.'
    : '';
  renderHeatmap($('heatmap'), cells, shownAgents, shownScenarios, $<HTMLSelectElement>('metric').value as Metric);
  const win = winners(cells);
  $('winners').textContent = shownScenarios
    .filter((s) => win[s.id])
    .map((s) => `${s.name}: ${shownAgents.find((a) => a.id === win[s.id])?.label}`)
    .join('  |  ');
}
$<HTMLSelectElement>('metric').onchange = refreshResults;

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`POST ${url} failed with status ${res.status}`);
}

let running = false;

$('btnRun').onclick = async () => {
  if (running || controller) return;
  running = true;
  $<HTMLButtonElement>('btnRun').disabled = true;
  let poll: ReturnType<typeof setInterval> | undefined;
  try {
    const p = readPlan();
    if (!p) return;
    const e = estimate(p);
    if (p.llmCosts.length > 0) {
      const cost = e.maxUsd > 0 ? `up to $${e.maxUsd.toFixed(2)}` : 'cost estimate unavailable';
      const ok = confirm(`A paid model is selected. Worst case ${e.maxCalls} model calls, ${cost} (a fast model can make about one call per tick). Budget cap $${num('budget')}. Run?`);
      if (!ok) return;
      try {
        await postJson('/api/budget', { budgetUsd: num('budget'), maxCalls: e.maxCalls });
      } catch {
        $('status').textContent = 'Could not set the budget on the proxy server (is npm run server running?). Run cancelled.';
        return;
      }
    }
    controller = new AbortController();
    const signal = controller.signal;
    results = [];
    refreshResults();
    shownAgents = p.plan.agents.map((a) => ({ id: a.id, label: a.label }));
    shownScenarios = p.plan.scenarios;
    colors = Object.fromEntries(p.plan.agents.map((a, i) => [a.id, PLAYER_COLORS[i % PLAYER_COLORS.length]]));
    $('status').textContent = 'Running...';
    poll = setInterval(async () => {
      try {
        const b = (await (await fetch('/api/budget')).json()) as { spentUsd: number };
        $('spent').textContent = `$${b.spentUsd.toFixed(4)}`;
      } catch {
        /* server not running: fine for baseline-only runs */
      }
    }, 1000);

    let sawHalt = false;
    let groupSessions: GameSession[] = [];
    const out = await runPlan(
      p.plan,
      {
        onGroupStart: (g) => {
          groupSessions = g.sessions;
          $('status').textContent = `Running ${g.scenario.name}, seed ${g.seed}`;
          showGroup(g.sessions, p.plan.agents);
        },
        onResult: (r) => {
          if (groupSessions.some((s) => s.halted)) sawHalt = true;
          results.push(r);
          refreshResults();
        },
      },
      signal,
    );
    $('status').textContent = signal.aborted ? 'Stopped.' : sawHalt ? 'Stopped: budget cap reached. Partial results kept.' : 'Done.';
    try {
      const meta = {
        savedAt: new Date().toISOString(),
        mode: p.plan.mode,
        maxTicks: p.plan.maxTicks,
        tickMs: p.plan.tickMs,
        agents: shownAgents,
        scenarios: p.plan.scenarios.map(({ id, name, size, complexity, ghosts }) => ({ id, name, size, complexity, ghosts })),
      };
      await postJson('/api/results', { runId: `run-${Date.now()}`, results: { meta, results: out } });
    } catch {
      $('status').textContent += ' (Could not save this run to the proxy.)';
    }
  } catch (err) {
    $('status').textContent = `Run failed: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    if (poll !== undefined) clearInterval(poll);
    controller = null;
    running = false;
    $<HTMLButtonElement>('btnRun').disabled = false;
  }
};

// --- saved runs ---
let savedRuns: { runId: string; results: unknown }[] = [];

$('btnLoadList').onclick = async () => {
  try {
    const res = await fetch('/api/results');
    if (!res.ok) throw new Error(`status ${res.status}`);
    savedRuns = (await res.json()) as { runId: string; results: unknown }[];
    const select = $<HTMLSelectElement>('saved');
    select.replaceChildren(...savedRuns.map((r) => new Option(r.runId, r.runId)));
    $('status').textContent = savedRuns.length ? `${savedRuns.length} saved run(s) found.` : 'No saved runs yet.';
  } catch {
    $('status').textContent = 'Could not list saved runs (is npm run server running?).';
  }
};

// Reloading only reads a file the proxy already stored. It never starts a run or calls a model.
$('btnLoad').onclick = () => {
  if (running) {
    $('status').textContent = 'Wait for the current run to finish or click Stop first.';
    return;
  }
  const run = savedRuns.find((r) => r.runId === $<HTMLSelectElement>('saved').value);
  const restored = run ? restoreRun(run.results) : null;
  if (!run || !restored) {
    $('status').textContent = run ? 'That saved run could not be read.' : 'Click Refresh list and pick a saved run first.';
    return;
  }
  results = restored.results;
  shownAgents = restored.agents;
  shownScenarios = restored.scenarios;
  refreshResults();
  $('status').textContent = `Showing saved run ${run.runId}.`;
};

$('btnStop').onclick = () => controller?.abort();
