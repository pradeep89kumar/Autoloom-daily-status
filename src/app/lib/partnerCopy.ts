import type { MasterRow } from "./sheetSync";

export interface DaySummary {
  meters: number;
  revenue: number;
  weightedEfficiency: number; // 0..1
  loomsReporting: number;
  loomsTotal: number;
  shiftsLogged: number; // 0,1,2... — count of distinct (loom, shift) entries
}

export function summarizeDay(rows: MasterRow[]): DaySummary {
  let meters = 0;
  let revenue = 0;
  let effTimesM = 0;
  const loomSet = new Set<string>();
  for (const r of rows) {
    meters += r.meters;
    revenue += r.revenue;
    effTimesM += r.efficiency * r.meters;
    if (r.meters > 0 || r.efficiency > 0) loomSet.add(r.loom);
  }
  return {
    meters,
    revenue,
    weightedEfficiency: meters > 0 ? effTimesM / meters : 0,
    loomsReporting: loomSet.size,
    loomsTotal: 8,
    shiftsLogged: rows.length,
  };
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

function numberWord(n: number): string {
  return n >= 0 && n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n);
}

/** Locale-aware Indian rupee formatting without forcing decimals. */
export function fmtRupees(n: number): string {
  if (!isFinite(n)) return "—";
  const rounded = Math.round(n);
  return "₹" + rounded.toLocaleString("en-IN");
}

export function fmtMeters(n: number): string {
  if (!isFinite(n)) return "—";
  const rounded = Math.round(n);
  return `${rounded.toLocaleString("en-IN")} m`;
}

export function fmtPercent(frac: number): string {
  if (!isFinite(frac)) return "—";
  return `${Math.round(frac * 100)}%`;
}

export function shortDateLong(d: Date): string {
  // "Mon 1 Jun"
  const day = d.toLocaleDateString("en-GB", { weekday: "short" });
  const date = d.getDate();
  const month = d.toLocaleDateString("en-GB", { month: "short" });
  return `${day} ${date} ${month}`;
}

/**
 * One calm sentence summarizing the day. Tone-locked — no exclamations,
 * no thousand separators below 1,000, no emojis.
 */
export function dayBrief(date: Date, summary: DaySummary, isInProgress: boolean): string {
  if (summary.shiftsLogged === 0) {
    if (isInProgress) return `Entries for ${shortDateLong(date)} are still being captured.`;
    return `No production was logged on ${shortDateLong(date)}.`;
  }

  const looms = summary.loomsReporting;
  const loomWord = looms === 1 ? "one loom" : `${numberWord(looms)} looms`;
  const m = Math.round(summary.meters);
  const meters = m < 1000 ? `${m} metres` : `${m.toLocaleString("en-IN")} metres`;
  const rupees = fmtRupees(summary.revenue);
  const eff = Math.round(summary.weightedEfficiency * 100);

  const lead = isInProgress
    ? `So far on ${shortDateLong(date)}`
    : `On ${shortDateLong(date)}`;

  return `${lead}, ${loomWord} produced ${meters}, earning ${rupees} at an average of ${eff}%.`;
}

/** Aggregate per-loom totals for the Day ledger. */
export interface LoomDayTotal {
  loom: string;
  meters: number;
  revenue: number;
  weightedEfficiency: number;
  endState: string; // last state across A then B
  shifts: number;
  rows: MasterRow[];
}

export function perLoomTotals(rows: MasterRow[]): LoomDayTotal[] {
  const byLoom = new Map<string, MasterRow[]>();
  for (const r of rows) {
    const arr = byLoom.get(r.loom) || [];
    arr.push(r);
    byLoom.set(r.loom, arr);
  }
  const out: LoomDayTotal[] = [];
  for (const [loom, list] of byLoom) {
    let meters = 0, revenue = 0, effTimesM = 0;
    for (const r of list) {
      meters += r.meters;
      revenue += r.revenue;
      effTimesM += r.efficiency * r.meters;
    }
    // End state: prefer B's state if present, else A's.
    const b = list.find((r) => r.shift === "B");
    const a = list.find((r) => r.shift === "A");
    const endState = (b?.state || a?.state || "").trim();
    out.push({
      loom,
      meters,
      revenue,
      weightedEfficiency: meters > 0 ? effTimesM / meters : 0,
      endState,
      shifts: list.length,
      rows: list.sort((x, y) => (x.shift < y.shift ? -1 : 1)),
    });
  }
  return out.sort((a, b) => (a.loom < b.loom ? -1 : 1));
}

export function efficiencyBand(frac: number): "high" | "good" | "fair" | "low" {
  if (frac >= 0.85) return "high";
  if (frac >= 0.70) return "good";
  if (frac >= 0.50) return "fair";
  return "low";
}

/**
 * State pill copy — only show when end-of-day state isn't a normal running state.
 * Returns null when nothing worth surfacing.
 */
export function endStateLabel(state: string): string | null {
  const s = state.toUpperCase().trim();
  if (!s) return null;
  if (s === "RUNNING" || s === "START") return null;
  if (s === "COMPLITED" || s === "COMPLETED") return "Completed";
  if (s === "RUNOUT" || s === "RUN OUT") return "Run out";
  if (s === "ERROR_STOP" || s === "ERROR STOP" || s === "STOP") return "Stopped";
  if (s === "POWERCUT" || s === "POWER CUT") return "Power cut";
  if (s === "KNOTTING") return "Knotting";
  // Fallback: title-case the first word.
  return s.charAt(0) + s.slice(1).toLowerCase();
}
