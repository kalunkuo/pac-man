/** Tracks spend and call count for one run. Checked before every upstream call. */
export class Budget {
  spentUsd = 0;
  calls = 0;

  constructor(
    public budgetUsd = 1,
    public maxCalls = 5000,
  ) {}

  exhausted(): boolean {
    return this.spentUsd >= this.budgetUsd || this.calls >= this.maxCalls;
  }

  record(costUsd: number): void {
    this.calls++;
    this.spentUsd += costUsd;
  }

  reset(budgetUsd: number, maxCalls: number): void {
    this.budgetUsd = budgetUsd;
    this.maxCalls = maxCalls;
    this.spentUsd = 0;
    this.calls = 0;
  }

  snapshot() {
    return { budgetUsd: this.budgetUsd, maxCalls: this.maxCalls, spentUsd: this.spentUsd, calls: this.calls };
  }
}

export function parseBudgetBody(body: unknown): { budgetUsd: number; maxCalls: number } | null {
  if (typeof body !== 'object' || body === null) return null;
  const { budgetUsd, maxCalls } = body as { budgetUsd?: unknown; maxCalls?: unknown };
  if (typeof budgetUsd !== 'number' || !Number.isFinite(budgetUsd) || budgetUsd < 0) return null;
  if (typeof maxCalls !== 'number' || !Number.isInteger(maxCalls) || maxCalls < 0) return null;
  return { budgetUsd, maxCalls };
}
