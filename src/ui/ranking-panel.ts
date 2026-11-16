import type { Complexity } from '../engine/types';
import { buildRanking, listGroups, toCsv, type StoredRun } from '../ranking/rank';
import { buildRatings, ratingsToCsv } from '../ranking/rating';
import { GHOST_COUNTS, SIZE_KEYS, type SizeKey } from '../runner/scenarios';

const ALL_SETTINGS = '';
const COMPLEXITY_OPTIONS: Complexity[] = ['simple', 'medium', 'complex'];

type View = 'rating' | 'rank';

const RATING_COLUMNS = [
  'Rank', 'Model', 'Rating', '95% range', 'Matches', 'Win rate', 'Games',
  'Survival (ticks)', 'Lives left', 'Mean latency', 'Total cost', 'Cost per 1,000 pts',
];

const COLUMNS = [
  'Rank', 'Model', 'Avg rank', 'Scenarios', 'Wins', 'Games', 'Survival (ticks)', 'Lives left',
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
  let currentCsv = '';
  let currentFile = 'rating.csv';
  let view: View = 'rating';
  // Each view remembers its own settings choice. Rating starts on all settings, Average rank on the newest group.
  const chosen: Record<View, string | undefined> = { rating: ALL_SETTINGS, rank: undefined };

  const settings = el('select');
  const empty = el('p', 'No saved runs with metadata yet. Finish a run to start the ranking.');
  empty.className = 'muted';
  const settingsLabel = el('label', 'Run settings ');
  settingsLabel.append(settings);

  const viewButtons = el('div');
  const viewButtonFor = (v: View, text: string) => {
    const b = el('button', text);
    b.onclick = () => {
      chosen[view] = settings.value;
      view = v;
      render();
    };
    return b;
  };
  const ratingButton = viewButtonFor('rating', 'Rating');
  const rankButton = viewButtonFor('rank', 'Average rank');
  viewButtons.append(ratingButton, ' ', rankButton);

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

  const sizes = checkGroup<SizeKey>('Maze size', 'rank-size', SIZE_KEYS);
  const complexities = checkGroup<Complexity>('Layout complexity', 'rank-complexity', COMPLEXITY_OPTIONS);
  const ghosts = checkGroup<number>('Ghosts', 'rank-ghosts', GHOST_COUNTS);

  const filters = el('div');
  filters.append(sizes.fs, complexities.fs, ghosts.fs);

  const table = el('table');
  table.className = 'heatmap';
  const notes = el('div');
  notes.className = 'muted';

  const csvButton = el('button', 'Download CSV');
  csvButton.onclick = () => {
    const blob = new Blob([currentCsv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = el('a');
    a.href = url;
    a.download = currentFile;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  settings.onchange = render;
  container.replaceChildren(empty, viewButtons, settingsLabel, filters, table, notes, csvButton);

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

    viewButtons.hidden = !hasGroups;
    ratingButton.disabled = view === 'rating';
    rankButton.disabled = view === 'rank';

    const options = groups.map((g) => new Option(`${g.label} (${g.runs} ${g.runs === 1 ? 'run' : 'runs'})`, g.key));
    if (view === 'rating') options.unshift(new Option('All settings', ALL_SETTINGS));
    settings.replaceChildren(...options);
    const previous = chosen[view];
    if (previous !== undefined && options.some((o) => o.value === previous)) settings.value = previous;
    chosen[view] = settings.value;

    const lines: string[] = [];
    currentCsv = '';
    currentFile = view === 'rating' ? 'rating.csv' : 'ranking.csv';
    let hasRows = false;
    table.replaceChildren();

    if (hasGroups && view === 'rating') {
      const ratings = buildRatings(runs, {
        settingsKey: settings.value === ALL_SETTINGS ? undefined : settings.value,
        sizes: sizes.selected(),
        complexities: complexities.selected(),
        ghosts: ghosts.selected(),
      });
      hasRows = ratings.rows.length > 0;
      currentCsv = ratingsToCsv(ratings.rows);

      const head = el('tr');
      for (const c of RATING_COLUMNS) head.append(el('td', c));
      table.append(head);
      for (const r of ratings.rows) {
        const tr = el('tr');
        cell(tr, String(r.rank));
        cell(tr, r.label);
        cell(tr, r.rating.toFixed(0));
        cell(tr, `${r.low.toFixed(0)}-${r.high.toFixed(0)}`);
        cell(tr, String(r.matches));
        cell(tr, `${(r.winRate * 100).toFixed(0)}%`);
        cell(tr, String(r.games));
        cell(tr, r.meanSurvivedTicks.toFixed(0));
        cell(tr, r.meanLivesLeft.toFixed(2));
        cell(tr, `${r.meanLatencyMs.toFixed(0)} ms`);
        cell(tr, `$${r.totalCostUsd.toFixed(4)}`);
        cell(tr, r.costPer1000Points === null ? '-' : `$${r.costPer1000Points.toFixed(4)}`);
        table.append(tr);
      }

      if (hasRows) {
        lines.push(`${ratings.matches} matches between ${ratings.rows.length} models.`);
      } else {
        lines.push('No head-to-head matches yet. Run two or more models on the same scenarios and seeds in benchmark mode.');
      }
      if (ratings.truncatedExcluded > 0) lines.push(`${ratings.truncatedExcluded} games stopped early are not counted.`);
      if (ratings.connectionExcluded > 0) lines.push(`${ratings.connectionExcluded} games ended by connection or setup errors are not counted.`);
      if (ratings.arenaSkipped > 0) lines.push(`${ratings.arenaSkipped} arena games are not used for ratings.`);
      if (ratings.notConnected.length > 0) {
        const names = ratings.notConnected.map((n) => n.label).join(', ');
        lines.push(`Not connected yet: ${names} (they have not played the same scenarios and seeds as the others).`);
      }
    } else if (hasGroups) {
      const ranking = buildRanking(runs, {
        settingsKey: settings.value,
        sizes: sizes.selected(),
        complexities: complexities.selected(),
        ghosts: ghosts.selected(),
      });
      hasRows = ranking.rows.length > 0;
      currentCsv = toCsv(ranking.rows);

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
        cell(tr, r.meanSurvivedTicks.toFixed(0));
        cell(tr, r.meanLivesLeft.toFixed(2));
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
      if (ranking.connectionExcluded > 0) lines.push(`${ranking.connectionExcluded} games ended by connection or setup errors are not counted.`);
      if (ranking.notRanked.length > 0) {
        const parts = ranking.notRanked.map((n) => `${n.label} (missing ${n.missing} scenarios)`);
        lines.push(`Not enough data yet: ${parts.join(', ')}`);
      }
    }
    if (legacyRuns > 0) lines.push(`${legacyRuns} older runs without settings info are left out.`);
    if (note) lines.push(note);

    notes.replaceChildren(...lines.map((l) => el('div', l)));
    csvButton.disabled = !hasRows;
  }

  return {
    update(nextRuns, nextNote) {
      runs = nextRuns;
      note = nextNote;
      render();
    },
  };
}
