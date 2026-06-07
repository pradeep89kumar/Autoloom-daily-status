import type { MasterRow, MasterRangeRow } from "./sheetSync";
import { LOOM_CATALOG } from "./looms";

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
  let target = 0;
  const loomSet = new Set<string>();
  for (const r of rows) {
    meters += r.meters;
    revenue += r.revenue;
    target += r.targetMeters;
    if (r.meters > 0 || r.efficiency > 0) loomSet.add(r.loom);
  }
  return {
    meters,
    revenue,
    weightedEfficiency: target > 0 ? meters / target : 0,
    loomsReporting: loomSet.size,
    loomsTotal: LOOM_CATALOG.length,
    shiftsLogged: rows.length,
  };
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen"];

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
  return `${rounded.toLocaleString("en-IN")} mtr`;
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
 * One calm Tamil sentence summarizing the day for the partner snapshot.
 * Keeps numerals in Arabic digits for fast reading; tone is factual, no exclamations.
 */
export function dayBrief(date: Date, summary: DaySummary, isInProgress: boolean): string {
  const dateLabel = shortDateLong(date);

  if (summary.shiftsLogged === 0) {
    if (isInProgress) return `${dateLabel} — பதிவுகள் இன்னும் வந்துகொண்டிருக்கின்றன.`;
    return `${dateLabel} — பதிவு இல்லை.`;
  }

  const looms = summary.loomsReporting;
  const loomWord = looms === 1 ? "ஒரு தறி" : `${looms} தறிகள்`;
  const m = Math.round(summary.meters);
  const meters = `${m.toLocaleString("en-IN")} mtr`;
  const rupees = fmtRupees(summary.revenue);
  const eff = Math.round(summary.weightedEfficiency * 100);

  const lead = isInProgress
    ? `${dateLabel} (இன்றுவரை)`
    : dateLabel;

  return `${lead} — ${loomWord} ${meters} நெய்தன. வருமானம் ${rupees}, average performance ${eff}%.`;
}

// Keep numberWord helper around in case other copy reuses it.
void numberWord;

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
    let meters = 0, revenue = 0, target = 0;
    for (const r of list) {
      meters += r.meters;
      revenue += r.revenue;
      target += r.targetMeters;
    }
    // End state: prefer B's state if present, else A's.
    const b = list.find((r) => r.shift === "B");
    const a = list.find((r) => r.shift === "A");
    const endState = (b?.state || a?.state || "").trim();
    out.push({
      loom,
      meters,
      revenue,
      weightedEfficiency: target > 0 ? meters / target : 0,
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

export type StateTone = "runout" | "stopped" | "powercut" | "knotting";

export interface StateMeta {
  label: string;
  tone: StateTone;
}

// Master sheet's "Complited"/"Completed" maps to "Run out": for the partner
// the warp finished and a new one is being prepared. Returns null for normal
// running states or unknown raw values so the UI shows nothing in the calm case.
export function endStateMeta(state: string): StateMeta | null {
  const s = state.toUpperCase().trim();
  if (!s) return null;
  if (s === "RUNNING" || s === "START") return null;
  if (s === "COMPLITED" || s === "COMPLETED" || s === "RUNOUT" || s === "RUN OUT") {
    return { label: "Run out", tone: "runout" };
  }
  if (s === "ERROR_STOP" || s === "ERROR STOP" || s === "STOP" || s === "STOPPED") {
    return { label: "Stopped", tone: "stopped" };
  }
  if (s === "POWERCUT" || s === "POWER CUT") {
    return { label: "Power cut", tone: "powercut" };
  }
  if (s === "KNOTTING") return { label: "Knotting", tone: "knotting" };
  return null;
}

export function endStateLabel(state: string): string | null {
  return endStateMeta(state)?.label ?? null;
}

/* ================================ Trend analytics ================================ */

export interface PlanSummary {
  meters: number;
  target: number;
  pct: number; // 0..1+
  band: "on" | "near" | "off"; // ≥0.95 / 0.80–0.95 / <0.80
}

export function planSummary(rows: MasterRangeRow[]): PlanSummary | null {
  let meters = 0, target = 0;
  for (const r of rows) {
    meters += r.meters;
    target += r.targetMeters;
  }
  if (target <= 0) return null;
  const pct = meters / target;
  const band: PlanSummary["band"] = pct >= 0.95 ? "on" : pct >= 0.80 ? "near" : "off";
  return { meters, target, pct, band };
}

export function planSummaryForLoom(rows: MasterRangeRow[], loom: string): PlanSummary | null {
  return planSummary(rows.filter((r) => r.loom === loom));
}

export interface WeekDelta {
  metersPct: number | null;   // (recent - prior) / prior
  revenuePct: number | null;
  effPctPoints: number | null; // recent - prior, in percent-points (e.g. 0.04 = +4pp)
}

/** Split window into recent vs prior halves by date string sort. */
export function weekDeltas(rows: MasterRangeRow[]): WeekDelta {
  const dates = Array.from(new Set(rows.map((r) => r.date))).sort();
  if (dates.length < 2) return { metersPct: null, revenuePct: null, effPctPoints: null };
  const cut = Math.floor(dates.length / 2);
  const priorDates = new Set(dates.slice(0, cut));
  const recentDates = new Set(dates.slice(cut));
  const agg = (set: Set<string>) => {
    let m = 0, r = 0, t = 0;
    for (const row of rows) {
      if (!set.has(row.date)) continue;
      m += row.meters;
      r += row.revenue;
      t += row.targetMeters;
    }
    return { m, r, eff: t > 0 ? m / t : 0 };
  };
  const a = agg(priorDates);
  const b = agg(recentDates);
  return {
    metersPct: a.m > 0 ? (b.m - a.m) / a.m : null,
    revenuePct: a.r > 0 ? (b.r - a.r) / a.r : null,
    effPctPoints: a.eff > 0 || b.eff > 0 ? b.eff - a.eff : null,
  };
}

/**
 * For each loom, take its single best-day meters in the window as a personal
 * ceiling. Sum (best × days reported) − actual meters, convert to revenue at
 * the loom's average rate-per-meter. Returns null when gap < 5% of actual.
 */
export function opportunityGap(rows: MasterRangeRow[]): { rupees: number; meters: number } | null {
  type Acc = { actualM: number; actualRev: number; daysReported: Set<string>; bestDay: number; rateNum: number; rateDen: number };
  const byLoom = new Map<string, Acc>();
  for (const r of rows) {
    let a = byLoom.get(r.loom);
    if (!a) {
      a = { actualM: 0, actualRev: 0, daysReported: new Set(), bestDay: 0, rateNum: 0, rateDen: 0 };
      byLoom.set(r.loom, a);
    }
    a.actualM += r.meters;
    a.actualRev += r.revenue;
    if (r.meters > 0) a.daysReported.add(r.date);
    if (r.ratePerMeter > 0 && r.meters > 0) {
      a.rateNum += r.ratePerMeter * r.meters;
      a.rateDen += r.meters;
    }
  }
  // Best day per loom = max meters across its dates (sum of A+B for that date).
  const dayMeters = new Map<string, number>(); // key loom|date
  for (const r of rows) {
    const k = `${r.loom}|${r.date}`;
    dayMeters.set(k, (dayMeters.get(k) || 0) + r.meters);
  }
  for (const [k, m] of dayMeters) {
    const loom = k.split("|")[0];
    const a = byLoom.get(loom);
    if (a && m > a.bestDay) a.bestDay = m;
  }
  let gapM = 0, gapRev = 0, totalActualRev = 0;
  for (const a of byLoom.values()) {
    totalActualRev += a.actualRev;
    if (a.bestDay <= 0 || a.daysReported.size === 0) continue;
    const ceiling = a.bestDay * a.daysReported.size;
    const dM = ceiling - a.actualM;
    if (dM <= 0) continue;
    const rate = a.rateDen > 0 ? a.rateNum / a.rateDen : 0;
    gapM += dM;
    gapRev += dM * rate;
  }
  if (totalActualRev <= 0) return null;
  if (gapRev / totalActualRev < 0.05) return null;
  return { rupees: gapRev, meters: gapM };
}

export interface BestWatch {
  best: { loom: string; revenue: number; meters: number } | null;
  watch: { loom: string; reason: "below-band" | "warp-gaps"; detail: string } | null;
}

export function bestAndWatch(rows: MasterRangeRow[]): BestWatch {
  const byLoom = new Map<string, { meters: number; revenue: number; effShifts: { eff: number; date: string }[]; runoutDays: Set<string> }>();
  for (const r of rows) {
    let a = byLoom.get(r.loom);
    if (!a) {
      a = { meters: 0, revenue: 0, effShifts: [], runoutDays: new Set() };
      byLoom.set(r.loom, a);
    }
    a.meters += r.meters;
    a.revenue += r.revenue;
    if (r.meters > 0) {
      const perf = r.targetMeters > 0 ? r.meters / r.targetMeters : 0;
      a.effShifts.push({ eff: perf, date: r.date });
    }
    const meta = endStateMeta(r.state);
    if (meta?.tone === "runout") a.runoutDays.add(r.date);
  }
  // Best = highest revenue.
  let bestLoom: string | null = null, bestRev = 0;
  for (const [loom, a] of byLoom) {
    if (a.revenue > bestRev) { bestRev = a.revenue; bestLoom = loom; }
  }
  const best = bestLoom
    ? { loom: bestLoom, revenue: byLoom.get(bestLoom)!.revenue, meters: byLoom.get(bestLoom)!.meters }
    : null;

  // Watch — pick the worst trigger across looms.
  let warpGapsLoom: { loom: string; days: number } | null = null;
  let belowBandLoom: { loom: string; count: number } | null = null;
  for (const [loom, a] of byLoom) {
    if (a.runoutDays.size >= 3) {
      if (!warpGapsLoom || a.runoutDays.size > warpGapsLoom.days) warpGapsLoom = { loom, days: a.runoutDays.size };
    }
    // last 7 distinct dates with reported shifts
    const dates = Array.from(new Set(a.effShifts.map((s) => s.date))).sort().slice(-7);
    const recent = a.effShifts.filter((s) => dates.includes(s.date));
    const lowCount = recent.filter((s) => s.eff > 0 && s.eff < 0.7).length;
    if (lowCount >= 4) {
      if (!belowBandLoom || lowCount > belowBandLoom.count) belowBandLoom = { loom, count: lowCount };
    }
  }
  let watch: BestWatch["watch"] = null;
  if (warpGapsLoom) {
    watch = { loom: warpGapsLoom.loom, reason: "warp-gaps", detail: `${warpGapsLoom.days} run-out days` };
  } else if (belowBandLoom) {
    watch = { loom: belowBandLoom.loom, reason: "below-band", detail: `${belowBandLoom.count} of 7 shifts < 70%` };
  }
  return { best, watch };
}

export interface DisruptionCounts {
  runout: number;
  stopped: number;
  powercut: number;
}

export function disruptionCounts(rows: MasterRangeRow[]): DisruptionCounts {
  const seen = { runout: new Set<string>(), stopped: new Set<string>(), powercut: new Set<string>() };
  for (const r of rows) {
    const meta = endStateMeta(r.state);
    if (!meta) continue;
    const k = `${r.loom}|${r.date}`;
    if (meta.tone === "runout") seen.runout.add(k);
    else if (meta.tone === "stopped") seen.stopped.add(k);
    else if (meta.tone === "powercut") seen.powercut.add(k);
  }
  return { runout: seen.runout.size, stopped: seen.stopped.size, powercut: seen.powercut.size };
}

export function fmtSignedPct(frac: number | null): string {
  if (frac === null || !isFinite(frac)) return "—";
  const pct = Math.round(frac * 100);
  if (pct === 0) return "0%";
  return (pct > 0 ? "+" : "") + pct + "%";
}

export function fmtSignedPp(frac: number | null): string {
  if (frac === null || !isFinite(frac)) return "—";
  const pp = Math.round(frac * 100);
  if (pp === 0) return "0pp";
  return (pp > 0 ? "+" : "") + pp + "pp";
}
