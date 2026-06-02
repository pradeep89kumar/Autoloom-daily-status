// Deprecated. The "needs new loading" lifecycle is now derived from sheet
// state via `loadingStatusForTarget` in `./loadings.ts`. These exports are
// kept as no-ops so existing call sites continue to compile while remaining
// consistent across devices.
//
// TODO: remove this module once all callers migrate to `loadingStatusForTarget`.

export function isRunoutPending(_loomId: string): boolean {
  return false;
}

export function setRunoutPending(_loomId: string): void {
  /* no-op */
}

export function clearRunoutPending(_loomId: string): void {
  /* no-op */
}

export function listRunoutPending(): string[] {
  return [];
}

