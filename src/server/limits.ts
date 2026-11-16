export const DEFAULT_BODY_LIMIT = 1_000_000;
export const RESULTS_BODY_LIMIT = 25_000_000;

/** True once a request body of `size` bytes is over `limit`. */
export const exceedsLimit = (size: number, limit: number): boolean => size > limit;
