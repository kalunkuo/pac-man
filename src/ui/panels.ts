import type { Player } from '../engine/types';
import type { Cell } from '../runner/aggregate';
import type { Scenario } from '../runner/scenarios';
import type { PlayerStats } from '../runner/session';

export type Metric = 'meanScore' | 'meanLevel' | 'meanSurvivedTicks' | 'meanLatencyMs';

/** 0..1 position of `value` in [min, max]. 1 is best. */
export function shade(value: number, min: number, max: number, higherIsBetter: boolean): number {
  if (max === min) return 0.5;
  const t = (value - min) / (max - min);
  return higherIsBetter ? t : 1 - t;
}

export function describePlayer(label: string, p: Player, s: PlayerStats, level: number): string {
  const avg = s.totalLatencyMs / Math.max(1, s.calls);
  const status = s.disqualified ? ' · disqualified' : !p.alive ? ' · out' : '';
  return (
    `${label} · score ${p.score} · lives ${p.lives} · level ${level} · calls ${s.calls} · ` +
    `errors ${s.errors} · ${Math.round(avg)} ms · $${s.costUsd.toFixed(4)}${status}`
  );
}

export function renderHeatmap(
  container: HTMLElement,
  cells: Cell[],
  agents: { id: string; label: string }[],
  scenarios: Scenario[],
  metric: Metric,
): void {
  const higherIsBetter = metric !== 'meanLatencyMs';
  const find = (a: string, s: string) => cells.find((c) => c.agentId === a && c.scenarioId === s);
  const table = document.createElement('table');
  table.className = 'heatmap';

  const head = table.insertRow();
  head.insertCell().textContent = 'Model';
  for (const s of scenarios) head.insertCell().textContent = s.name;

  const columns = scenarios.map((s) => {
    const values = agents.map((a) => find(a.id, s.id)?.[metric]).filter((v): v is number => v !== undefined);
    return { min: Math.min(...values), max: Math.max(...values) };
  });

  for (const a of agents) {
    const row = table.insertRow();
    row.insertCell().textContent = a.label;
    scenarios.forEach((s, i) => {
      const td = row.insertCell();
      const c = find(a.id, s.id);
      if (!c) {
        td.textContent = '-';
        return;
      }
      const v = c[metric];
      td.textContent = metric === 'meanLatencyMs' ? `${Math.round(v)} ms` : v.toFixed(metric === 'meanLevel' ? 1 : 0);
      const t = shade(v, columns[i].min, columns[i].max, higherIsBetter);
      td.style.background = `rgba(60, 200, 120, ${0.1 + 0.6 * t})`;
      if (t === 1 && columns[i].max !== columns[i].min) td.style.fontWeight = '700';
    });
  }
  container.replaceChildren(table);
}
