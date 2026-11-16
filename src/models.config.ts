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
export const MODELS: ModelEntry[] = [
  { id: 'jev', label: 'Jev (System 1)', model: '', estUsdPerCall: 0.0005, enabled: false },
  { id: 'fast-a', label: 'Fast model A', model: 'openai/gpt-4o-mini', estUsdPerCall: 0.0003, enabled: true },
  { id: 'fast-b', label: 'Fast model B', model: 'anthropic/claude-haiku-4.5', estUsdPerCall: 0.001, enabled: true },
  { id: 'llm', label: 'Regular LLM', model: 'anthropic/claude-sonnet-4.5', estUsdPerCall: 0.004, enabled: true },
];
