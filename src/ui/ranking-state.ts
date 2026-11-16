/** Keeps the previous select value while it is still offered, otherwise uses the default. */
export function reconcileChoice(previous: string | undefined, optionKeys: string[], defaultKey: string): string {
  return previous !== undefined && optionKeys.includes(previous) ? previous : defaultKey;
}
