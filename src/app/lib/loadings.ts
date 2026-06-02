// Loading events. Source-of-truth lives in the Google Sheet "Loadings" tab;
// localStorage is a write-through cache so that a brand-new submit reflects
// instantly on the same device even before the next remote fetch completes.

import type { Shift } from "./shift";
import { shiftWindow, fromYmd } from "./shift";
import type { FullRow, LoomState, RemoteLoading } from "./sheetSync";

export interface LoadingEvent {
  loomId: string;       // upper-case
  designName: string;
  customerName: string;
  shiftDate: string;    // YYYY-MM-DD of the shift the loading was effective from
  shift: Shift;
  capturedAt: string;   // ISO submit time — primary ordering key
}

const KEY = "qc.loadings";

function readLocal(): LoadingEvent[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function recordLoading(e: LoadingEvent): void {
  const all = readLocal();
  all.push({ ...e, loomId: e.loomId.toUpperCase() });
  localStorage.setItem(KEY, JSON.stringify(all));
}

/** Merge remote + local, dedup by (loomId|capturedAt). Newest first. */
export function mergeLoadings(remote: RemoteLoading[]): LoadingEvent[] {
  const out = new Map<string, LoadingEvent>();
  for (const r of remote) {
    if (r.shift !== "A" && r.shift !== "B") continue;
    const key = `${r.loomId.toUpperCase()}|${r.capturedAt}`;
    out.set(key, {
      loomId: r.loomId.toUpperCase(),
      designName: r.designName,
      customerName: r.customerName,
      shiftDate: r.shiftDate,
      shift: r.shift,
      capturedAt: r.capturedAt,
    });
  }
  for (const l of readLocal()) {
    const key = `${l.loomId.toUpperCase()}|${l.capturedAt}`;
    if (!out.has(key)) {
      out.set(key, { ...l, loomId: l.loomId.toUpperCase() });
    }
  }
  return Array.from(out.values()).sort((a, b) =>
    a.capturedAt < b.capturedAt ? 1 : -1,
  );
}

/**
 * A loading takes effect from its capturedAt onward. It applies to the target
 * shift if captured before that shift ends — including loadings logged mid-shift.
 * Returns the most-recent applicable loading for `loomId` against `target`.
 */
export function findLoadingForTarget(
  loomId: string,
  target: { date: string; shift: Shift },
  loadings: LoadingEvent[],
): LoadingEvent | null {
  const id = loomId.toUpperCase();
  const targetEnd = shiftWindow(fromYmd(target.date), target.shift).end.getTime();
  for (const e of loadings) {
    if (e.loomId !== id) continue;
    if (new Date(e.capturedAt).getTime() < targetEnd) return e;
  }
  return null;
}

/** Newest loading for the loom regardless of target. */
export function latestLoading(
  loomId: string,
  loadings: LoadingEvent[],
): LoadingEvent | null {
  const id = loomId.toUpperCase();
  for (const e of loadings) {
    if (e.loomId === id) return e;
  }
  return null;
}

// A loading is considered terminated when its latest production row reports
// one of these states. Any subsequent shift requires a new loading event.
// Pause states like "powercut" and "knotting" carry the design forward.
export const TERMINATING_STATES: LoomState[] = ["runout", "error_stop"];
// "stop" is a transient state in this app's vocabulary. The user requested
// run-out, stop, and error-stop as terminal — we treat the dedicated stop as
// `error_stop` (matches the K column legacy values).

export function isTerminating(state: LoomState | "" | undefined): boolean {
  if (!state) return false;
  return (TERMINATING_STATES as string[]).includes(state);
}

interface RowAt {
  capturedAt: number; // shift-window-start ms
  designName: string;
  customerName: string;
  loomState: LoomState | "";
}

function latestRowOnOrBefore(
  loomId: string,
  rows: FullRow[],
  beforeMs: number,
): RowAt | null {
  const id = loomId.toUpperCase();
  let best: RowAt | null = null;
  for (const r of rows) {
    if (r.loomId.toUpperCase() !== id) continue;
    const t = shiftWindow(fromYmd(r.date), r.shift).start.getTime();
    if (t >= beforeMs) continue;
    if (!best || t > best.capturedAt) {
      best = {
        capturedAt: t,
        designName: r.designName,
        customerName: r.customerName,
        loomState: r.loomState,
      };
    }
  }
  return best;
}

export type LoadingStatus =
  | {
      kind: "active";
      designName: string;
      customerName: string;
      source: "loading" | "row";
    }
  | {
      kind: "completed-needs-loading";
      lastDesign: string;
      lastCustomer: string;
      reason: LoomState;
    }
  | { kind: "fresh" };

/**
 * Resolves what should appear in the Production form for `loomId` at the
 * given target shift. Combines prior production rows and loading events to
 * decide whether the loading is active, terminated, or never started.
 */
export function loadingStatusForTarget(
  loomId: string,
  target: { date: string; shift: Shift },
  rows: FullRow[],
  loadings: LoadingEvent[],
): LoadingStatus {
  const targetStart = shiftWindow(fromYmd(target.date), target.shift).start.getTime();
  const lastRow = latestRowOnOrBefore(loomId, rows, targetStart);
  const lastLoading = findLoadingForTarget(loomId, target, loadings);

  const lastLoadingMs = lastLoading ? new Date(lastLoading.capturedAt).getTime() : -1;
  const lastRowMs = lastRow ? lastRow.capturedAt : -1;

  // Nothing on record at all → fresh loom, fall back to catalog.
  if (!lastRow && !lastLoading) return { kind: "fresh" };

  // If a loading event is newer than the latest row, the loading is active.
  if (lastLoadingMs > lastRowMs && lastLoading) {
    return {
      kind: "active",
      designName: lastLoading.designName,
      customerName: lastLoading.customerName,
      source: "loading",
    };
  }

  // Otherwise the latest production row drives status.
  if (lastRow) {
    if (isTerminating(lastRow.loomState)) {
      return {
        kind: "completed-needs-loading",
        lastDesign: lastRow.designName,
        lastCustomer: lastRow.customerName,
        reason: lastRow.loomState as LoomState,
      };
    }
    return {
      kind: "active",
      designName: lastRow.designName,
      customerName: lastRow.customerName,
      source: "row",
    };
  }

  // Loading exists but no rows yet — active.
  if (lastLoading) {
    return {
      kind: "active",
      designName: lastLoading.designName,
      customerName: lastLoading.customerName,
      source: "loading",
    };
  }

  return { kind: "fresh" };
}
