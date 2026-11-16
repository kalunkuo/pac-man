import { ALL_SCENARIOS, type Scenario } from '../runner/scenarios';
import type { GameResult } from '../runner/types';

export interface RestoredRun {
  agents: { id: string; label: string }[];
  scenarios: Scenario[];
  results: GameResult[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function asResult(v: unknown): GameResult | null {
  if (!isObj(v) || typeof v.agentId !== 'string' || typeof v.scenarioId !== 'string' || typeof v.score !== 'number') return null;
  // Runs saved before truncation tracking have no flag: treat them as complete.
  return { ...(v as unknown as GameResult), truncated: v.truncated === true };
}

function metaAgents(v: unknown): { id: string; label: string }[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.flatMap((a) => (isObj(a) && typeof a.id === 'string' && typeof a.label === 'string' ? [{ id: a.id, label: a.label }] : []));
  return out.length === v.length ? out : null;
}

function metaScenarios(v: unknown): Scenario[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.filter((s): s is Scenario => isObj(s) && typeof s.id === 'string' && typeof s.name === 'string');
  return out.length === v.length ? out : null;
}

/**
 * Turns whatever the proxy stored for a run (`{ meta, results }` or a bare legacy array) into
 * what the results view needs. Returns null for anything that is not a list of game results.
 */
export function restoreRun(stored: unknown): RestoredRun | null {
  const raw = Array.isArray(stored) ? stored : isObj(stored) ? stored.results : null;
  if (!Array.isArray(raw)) return null;
  const results = raw.map(asResult);
  if (results.some((r) => r === null)) return null;
  const games = results as GameResult[];

  const meta = isObj(stored) && isObj(stored.meta) ? stored.meta : null;
  const agents =
    (meta && metaAgents(meta.agents)) ??
    [...new Set(games.map((g) => g.agentId))].map((id) => ({ id, label: id }));
  const scenarios =
    (meta && metaScenarios(meta.scenarios)) ??
    [...new Set(games.map((g) => g.scenarioId))].flatMap((id) => ALL_SCENARIOS.filter((s) => s.id === id));
  return { agents, scenarios, results: games };
}
