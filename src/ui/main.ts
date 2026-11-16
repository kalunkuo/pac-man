import { GreedyAgent, PlannerAgent, RandomAgent } from '../agents/baselines';
import { OpenRouterAgent } from '../agents/openrouter';
import type { Agent } from '../agents/types';
import { MODELS } from '../models.config';
import { aggregate, winners } from '../runner/aggregate';
import { estimateRun } from '../runner/estimate';
import { runPlan } from '../runner/run-plan';
import { ALL_SCENARIOS, PRESETS } from '../runner/scenarios';
import type { GameSession } from '../runner/session';
import type { GameResult, Mode, RunPlan } from '../runner/types';
import { describePlayer, renderHeatmap, type Metric } from './panels';
import { PLAYER_COLORS, drawBoard } from './render';

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
  checkbox($('models'), 'agent', m.id, usable ? `${m.label} (${m.model})` : `${m.label} (set model id in src/models.config.ts)`, usable, !usable);
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
  const agents = agentIds.map(makeAgent);
  const seeds = Array.from({ length: num('seeds') }, (_, i) => i + 1);
  const llmCosts = agentIds.flatMap((id) => {
    const m = MODELS.find((x) => x.id === id);
    return m ? [{ estUsdPerCall: m.estUsdPerCall }] : [];
  });
  return {
    llmCosts,
    plan: {
      mode: $<HTMLSelectElement>('mode').value as Mode,
      scenarios: ALL_SCENARIOS.filter((s) => scenarioIds.has(s.id)),
      seeds,
      agents,
      tickMs: num('tickMs'),
      maxCallsPerGame: num('maxCalls'),
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
  $('status').textContent = `${e.games} games, up to ${e.maxCalls} model calls, worst case $${e.maxUsd.toFixed(2)} (budget cap $${num('budget')}).`;
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

// --- run ---
let controller: AbortController | null = null;
let results: GameResult[] = [];
let shownAgents: Agent[] = [];
let shownScenarios = ALL_SCENARIOS.slice(0, 0);

function refreshResults() {
  const cells = aggregate(results);
  renderHeatmap($('heatmap'), cells, shownAgents, shownScenarios, $<HTMLSelectElement>('metric').value as Metric);
  const win = winners(cells);
  $('winners').textContent = shownScenarios
    .filter((s) => win[s.id])
    .map((s) => `${s.name}: ${shownAgents.find((a) => a.id === win[s.id])?.label}`)
    .join('  |  ');
}
$<HTMLSelectElement>('metric').onchange = refreshResults;

async function postJson(url: string, body: unknown) {
  await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

$('btnRun').onclick = async () => {
  if (controller) return;
  const p = readPlan();
  if (!p) return;
  const e = estimate(p);
  if (e.maxUsd > 0) {
    const ok = confirm(`Worst case ${e.maxCalls} model calls, up to $${e.maxUsd.toFixed(2)}. Budget cap $${num('budget')}. Run?`);
    if (!ok) return;
    await postJson('/api/budget', { budgetUsd: num('budget'), maxCalls: e.maxCalls });
  }
  controller = new AbortController();
  results = [];
  shownAgents = p.plan.agents;
  shownScenarios = p.plan.scenarios;
  colors = Object.fromEntries(p.plan.agents.map((a, i) => [a.id, PLAYER_COLORS[i % PLAYER_COLORS.length]]));
  $('status').textContent = 'Running...';
  const poll = setInterval(async () => {
    try {
      const b = (await (await fetch('/api/budget')).json()) as { spentUsd: number };
      $('spent').textContent = `$${b.spentUsd.toFixed(4)}`;
    } catch {
      /* server not running: fine for baseline-only runs */
    }
  }, 1000);

  const out = await runPlan(
    p.plan,
    {
      onGroupStart: (g) => {
        $('status').textContent = `Running ${g.scenario.name}, seed ${g.seed}`;
        showGroup(g.sessions, p.plan.agents);
      },
      onResult: (r) => {
        results.push(r);
        refreshResults();
      },
    },
    controller.signal,
  );
  clearInterval(poll);
  const halted = boards.some((b) => b.session.halted);
  $('status').textContent = halted ? 'Stopped: budget cap reached. Partial results kept.' : controller.signal.aborted ? 'Stopped.' : 'Done.';
  controller = null;
  try {
    await postJson('/api/results', { runId: `run-${Date.now()}`, results: out });
  } catch {
    /* saving is optional */
  }
};

$('btnStop').onclick = () => controller?.abort();
