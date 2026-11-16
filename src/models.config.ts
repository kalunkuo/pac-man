export interface ModelEntry {
  id: string;
  label: string;
  /** OpenRouter model id. Leave empty to hide the model from runs. */
  model: string;
  /** Rough worst-case dollars per call, used only for the pre-run estimate. Check current OpenRouter prices. */
  estUsdPerCall: number;
  enabled: boolean;
}

/**
 * Edit this list. Set Jev's OpenRouter model id and flip `enabled` to true.
 * The estimate assumes about 1,000 input tokens per call; large mazes cost more.
 */
// Ids below come from openrouter.ai/rankings/decisions (Nov 15, 2026). Their model pages were not
// reachable when this was written, so prices are unverified: 0.004 is a deliberately high placeholder.
// Replace each with the real price (about 1,000 input tokens per call) once you have it.
export const MODELS: ModelEntry[] = [
  { id: 'jev-1-13', label: 'Jev 1.13 (System 1)', model: 'typesafe/jev-1.13', estUsdPerCall: 0.004, enabled: true },
  { id: 'jev-1-14', label: 'Jev 1.14 (System 1)', model: 'typesafe/jev-1.14', estUsdPerCall: 0.004, enabled: true },
  { id: 'decider-1-2', label: 'Perplexity Decider v1.2', model: 'perplexity/pplx-decider-v1.2', estUsdPerCall: 0.004, enabled: true },
  { id: 'decider-1-3-free', label: 'Perplexity Decider v1.3 (free)', model: 'perplexity/pplx-decider-v1.3:free', estUsdPerCall: 0, enabled: true },
  { id: 'drex-max', label: 'Drex Max', model: 'nace-ai/drex-max', estUsdPerCall: 0.004, enabled: true },
  { id: 'liquid-d1-1', label: 'Liquid d1.1', model: 'liquid/d1.1', estUsdPerCall: 0.004, enabled: true },
  { id: 'luna-decisions', label: 'GPT-6 Luna Decisions', model: 'openai/gpt-6-luna-decisions', estUsdPerCall: 0.004, enabled: true },
  { id: 'fast-a', label: 'Fast model A', model: 'openai/gpt-4o-mini', estUsdPerCall: 0.0003, enabled: true },
  { id: 'fast-b', label: 'Fast model B', model: 'anthropic/claude-haiku-4.5', estUsdPerCall: 0.001, enabled: true },
  { id: 'llm', label: 'Regular LLM', model: 'anthropic/claude-sonnet-4.5', estUsdPerCall: 0.004, enabled: true },
];
