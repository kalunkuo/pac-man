import type { Complexity } from '../engine/types';
import { buildRanking, listGroups, toCsv, type RankRow, type StoredRun } from '../ranking/rank';
import type { SizeKey } from '../runner/scenarios';

const SIZE_OPTIONS: SizeKey[] = ['small', 'medium', 'large'];
const COMPLEXITY_OPTIONS: Complexity[] = ['simple', 'medium', 'complex'];
const GHOST_OPTIONS = [1, 2, 4];

const COLUMNS = [
  'Rank', 'Model', 'Avg rank', 'Scenarios', 'Wins', 'Games',
  'Mean score', 'Mean level', 'Mean latency', 'Total cost', 'Cost per 1,000 pts',
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  return e;
}

export function mountRankingPanel(container: HTMLElement): { update(runs: StoredRun[], note?: string): void } {
  let runs: StoredRun[] = [];
  let note: string | undefined;
  let currentRows: RankRow[] = [];

  const settings = el('select');
  const empty = el('p', 'No saved runs with metadata yet. Finish a run to start the ranking.');
  empty.className = 'muted';
  const settingsLabel = el('label', 'Run settings ');
  settingsLabel.append(settings);

  function checkGroup<T extends string | number>(legend: string, name: string, values: T[]) {
    const fs = el('fieldset');
    fs.append(el('legend', legend));
    const inputs = values.map((v) => {
      const label = el('label');
      label.style.display = 'inline-block';
      label.style.marginRight = '10px';
      const input = el('input');
      input.type = 'checkbox';
      input.name = name;
      input.value = String(v);
      input.onchange = render;
      label.append(input, ` ${v}`);
      fs.append(label);
      return { value: v, input };
    });
    const selected = () => inputs.filter((i) => i.input.checked).map((i) => i.value);
    return { fs, selected };
  }

  const sizes = checkGroup<SizeKey>('Maze size', 'rank-size', SIZE_OPTIONS);
  const complexities = checkGroup<Complexity>('Layout complexity', 'rank-complexity', COMPLEXITY_OPTIONS);
  const ghosts = checkGroup<number>('Ghosts', 'rank-ghosts', GHOST_OPTIONS);

  const filters = el('div');
  filters.append(sizes.fs, complexities.fs, ghosts.fs);

  const table = el('table');
  table.className = 'heatmap';
  const notes = el('div');
  notes.className = 'muted';

  const csvButton = el('button', 'Download CSV');
  csvButton.onclick = () => {
    const blob = new Blob([toCsv(currentRows)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = el('a');
    a.href = url;
    a.download = 'ranking.csv';
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  settings.onchange = render;
  container.replaceChildren(empty, settingsLabel, filters, table, notes, csvButton);

  function cell(row: HTMLTableRowElement, text: string) {
    row.append(el('td', text));
  }

  function render() {
    const { groups, legacyRuns } = listGroups(runs);
    const hasGroups = groups.length > 0;
    empty.hidden = hasGroups;
    settingsLabel.hidden = !hasGroups;
    filters.hidden = !hasGroups;
    table.hidden = !hasGroups;
    csvButton.hidden = !hasGroups;

    const previous = settings.value;
    settings.replaceChildren(...groups.map((g) => new Option(`${g.label} (${g.runs} ${g.runs === 1 ? 'run' : 'runs'})`, g.key)));
    if (groups.some((g) => g.key === previous)) settings.value = previous;

    const lines: string[] = [];
    currentRows = [];
    table.replaceChildren();

    if (hasGroups) {
      const ranking = buildRanking(runs, {
        settingsKey: settings.value,
        sizes: sizes.selected(),
        complexities: complexities.selected(),
        ghosts: ghosts.selected(),
      });
      currentRows = ranking.rows;

      const head = el('tr');
      for (const c of COLUMNS) head.append(el('td', c));
      table.append(head);
      for (const r of ranking.rows) {
        const tr = el('tr');
        cell(tr, String(r.rank));
        cell(tr, r.label);
        cell(tr, r.avgRank.toFixed(2));
        cell(tr, String(r.scenarios));
        cell(tr, String(r.wins));
        cell(tr, String(r.games));
        cell(tr, r.meanScore.toFixed(0));
        cell(tr, r.meanLevel.toFixed(1));
        cell(tr, `${r.meanLatencyMs.toFixed(0)} ms`);
        cell(tr, `$${r.totalCostUsd.toFixed(4)}`);
        cell(tr, r.costPer1000Points === null ? '-' : `$${r.costPer1000Points.toFixed(4)}`);
        table.append(tr);
      }

      if (ranking.rows.length > 0) {
        lines.push(`Ranked on ${ranking.scenarios.length} scenarios from ${ranking.games} games.`);
      } else {
        lines.push('Not enough overlapping data. Pick fewer scenarios in the filters, or run more models on the same scenarios.');
      }
      if (ranking.truncatedExcluded > 0) lines.push(`${ranking.truncatedExcluded} games stopped early are not counted.`);
      if (ranking.notRanked.length > 0) {
        const parts = ranking.notRanked.map((n) => `${n.label} (missing ${n.missing} scenarios)`);
        lines.push(`Not enough data yet: ${parts.join(', ')}`);
      }
    }
    if (legacyRuns > 0) lines.push(`${legacyRuns} older runs without settings info are left out.`);
    if (note) lines.push(note);

    notes.replaceChildren(...lines.map((l) => el('div', l)));
    csvButton.disabled = currentRows.length === 0;
  }

  return {
    update(nextRuns, nextNote) {
      runs = nextRuns;
      note = nextNote;
      render();
    },
  };
}
