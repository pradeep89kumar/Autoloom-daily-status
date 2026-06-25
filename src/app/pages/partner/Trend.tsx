import { useEffect, useMemo, useState } from "react";
import { TrendUp, TrendDown, ArrowRight, CaretDown } from "@phosphor-icons/react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { fetchMasterRange, type MasterRangeRow } from "../../lib/sheetSync";
import { LOOM_CATALOG, isNewLoom } from "../../lib/looms";
import { NewPill } from "../../components/NewPill";
import {
  fmtMeters,
  fmtPercent,
  fmtRupees,
  shortDateLong,
  planSummaryForLoom,
  weekDeltas,
  opportunityGap,
  bestAndWatch,
  disruptionCounts,
  fmtSignedPct,
  fmtSignedPp,
} from "../../lib/partnerCopy";

type Metric = "efficiency" | "revenue";

const DAYS = 14;
const LOOMS = LOOM_CATALOG.map((l) => l.name);

// Monthly revenue target (round figure). ₹15L is the only hard number.
// Days are calendar days of the current month (28–31), since the looms run
// every calendar day in shifts — no Sunday/holiday exclusion.
const MONTHLY_TARGET = 1500000;
// Per-loom/day target implied by ₹15L ÷ 30 ÷ 14 ≈ ₹3,571, rounded.
const PER_LOOM_DAY_TARGET = 3500;
// Daily revenue target for the full 14-loom fleet — ₹15L ÷ 30 days = a round
// ₹50,000/day. Split evenly across the loom catalog so the chart's
// active-aware target lands on ₹50,000 when every loom is running.
const DAILY_FLEET_TARGET = 50000;
const PER_LOOM_CHART_TARGET = DAILY_FLEET_TARGET / LOOMS.length;
// Celebration accent for days that beat the target line — a warm gold, kept
// distinct from the amber "warning" tint used elsewhere in the app.
const GOLD = "#E8A317";
// New looms were rolled out on this date; rows before it are copy-forward
// phantoms that never physically ran.
const NEW_LOOM_START = "2026-06-07";

function fmtLakh(n: number): string {
  if (!isFinite(n)) return "—";
  return `₹${(n / 100000).toFixed(1)}L`;
}

function fmtThousand(n: number): string {
  if (!isFinite(n)) return "—";
  if (Math.abs(n) >= 100000) return fmtLakh(n);
  return `₹${(Math.round(n / 100) / 10).toFixed(1)}k`;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function lastNDates(n: number): Date[] {
  const out: Date[] = [];
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    out.push(d);
  }
  return out;
}

interface Cell {
  meters: number;
  revenue: number;
  target: number;
}

function buildGrid(rows: MasterRangeRow[]): Map<string, Cell> {
  const grid = new Map<string, Cell>();
  for (const r of rows) {
    const key = `${r.loom}|${r.date}`;
    const cur = grid.get(key) || { meters: 0, revenue: 0, target: 0 };
    cur.meters += r.meters;
    cur.revenue += r.revenue;
    cur.target += r.targetMeters;
    grid.set(key, cur);
  }
  return grid;
}

function metricValue(c: Cell | undefined, m: Metric): number | null {
  if (!c || c.meters === 0) {
    if (m === "revenue") return c?.revenue ?? null;
    return null;
  }
  if (m === "revenue") return c.revenue;
  return c.target > 0 ? c.meters / c.target : null;
}

function tintForEfficiency(frac: number | null): string {
  if (frac === null) return "bg-black/[0.04]";
  if (frac < 0.5) return "bg-[var(--color-status-red)]/15";
  if (frac < 0.7) return "bg-[var(--color-status-amber)]/15";
  if (frac < 0.85) return "bg-[var(--color-status-green)]/15";
  return "bg-[var(--color-status-green)]/30";
}

function tintForMagnitude(value: number | null, max: number): string {
  if (value === null || max <= 0) return "bg-black/[0.04]";
  const t = Math.min(1, value / max);
  if (t < 0.25) return "bg-[var(--color-text-primary)]/[0.06]";
  if (t < 0.5) return "bg-[var(--color-text-primary)]/[0.12]";
  if (t < 0.75) return "bg-[var(--color-text-primary)]/[0.22]";
  return "bg-[var(--color-text-primary)]/[0.36]";
}

export function PartnerTrend() {
  const [metric, setMetric] = useState<Metric>("efficiency");
  const [rows, setRows] = useState<MasterRangeRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [mtdRows, setMtdRows] = useState<MasterRangeRow[] | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const dates = useMemo(() => lastNDates(DAYS), []);

  const monthStart = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const from = ymd(dates[0]);
    const to = ymd(dates[dates.length - 1]);
    const startedAt = Date.now();
    fetchMasterRange(from, to).then((r) => {
      if (!alive) return;
      // Drop rows for newly added looms before their production-start date —
      // they were copied forward by the master sheet automation but never
      // physically ran. Otherwise their averages and heatmap would be skewed
      // by zero-meter rows.
      const filtered = r.filter((row) => !(isNewLoom(row.loom) && row.date < NEW_LOOM_START));
      const wait = Math.max(0, 400 - (Date.now() - startedAt));
      setTimeout(() => {
        if (!alive) return;
        setRows(filtered);
        setLoading(false);
      }, wait);
    });
    return () => {
      alive = false;
    };
  }, [dates]);

  useEffect(() => {
    let alive = true;
    const from = ymd(monthStart);
    const to = ymd(new Date());
    fetchMasterRange(from, to).then((r) => {
      if (!alive) return;
      const filtered = r.filter(
        (row) => !(isNewLoom(row.loom) && row.date < NEW_LOOM_START),
      );
      setMtdRows(filtered);
    });
    return () => {
      alive = false;
    };
  }, [monthStart]);

  const grid = useMemo(() => buildGrid(rows || []), [rows]);

  const targetStats = useMemo(() => {
    if (!mtdRows) return null;
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const targetPerDay = MONTHLY_TARGET / daysInMonth;

    // Pace is measured over days that actually produced. Today is normally
    // still in progress (or not yet entered), so it falls out on its own —
    // that is what makes the denominator "12 completed days" on the 13th,
    // not 13. Avoids flattering or punishing the run-rate with a half day.
    let revenue = 0;
    const dateSet = new Set<string>();
    for (const r of mtdRows) {
      revenue += r.revenue;
      if (r.revenue > 0 || r.meters > 0) dateSet.add(r.date);
    }
    const daysElapsed = dateSet.size;

    const shouldBeByToday = targetPerDay * daysElapsed;
    const paceFraction = shouldBeByToday > 0 ? revenue / shouldBeByToday : 0;
    const avgPerDay = daysElapsed > 0 ? revenue / daysElapsed : 0;
    const projected = avgPerDay * daysInMonth;
    const gap = MONTHLY_TARGET - projected;
    const targetFraction = MONTHLY_TARGET > 0 ? revenue / MONTHLY_TARGET : 0;
    const todayMarkFraction = MONTHLY_TARGET > 0 ? shouldBeByToday / MONTHLY_TARGET : 0;

    return {
      revenue,
      daysInMonth,
      daysElapsed,
      shouldBeByToday,
      paceFraction,
      avgPerDay,
      projected,
      gap,
      targetFraction,
      todayMarkFraction,
    };
  }, [mtdRows]);

  // Per-loom month-to-date status, for the diagnosis tier.
  const loomStatus = useMemo(() => {
    if (!mtdRows) return null;
    const revByLoom = new Map<string, number>();
    const daysByLoom = new Map<string, Set<string>>();
    for (const r of mtdRows) {
      revByLoom.set(r.loom, (revByLoom.get(r.loom) || 0) + r.revenue);
      if (r.revenue > 0 || r.meters > 0) {
        if (!daysByLoom.has(r.loom)) daysByLoom.set(r.loom, new Set());
        daysByLoom.get(r.loom)!.add(r.date);
      }
    }
    const out = LOOMS.map((loom) => {
      const total = revByLoom.get(loom) || 0;
      // Divide by each loom's own active days so newly added looms are judged
      // on the days they actually ran, not the whole month.
      const days = daysByLoom.get(loom)?.size || 0;
      const avg = days > 0 ? total / days : 0;
      let band: "on" | "below" | "weak" | "idle";
      if (total <= 0 || days === 0) band = "idle";
      else if (avg >= PER_LOOM_DAY_TARGET) band = "on";
      else if (avg >= PER_LOOM_DAY_TARGET * 0.6) band = "below";
      else band = "weak";
      return { loom, total, avg, band };
    });
    return out;
  }, [mtdRows]);

  // Momentum — this week's pace vs last week's pace (from the 14-day window).
  // Needs enough prior data; otherwise we hide the chip rather than mislead.
  const momentum = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoff = new Date(today);
    cutoff.setDate(today.getDate() - 6); // last 7 days incl. today
    const cutoffY = ymd(cutoff);
    const priorStart = new Date(today);
    priorStart.setDate(today.getDate() - 13);
    const priorStartY = ymd(priorStart);

    let thisWeek = 0;
    const thisDays = new Set<string>();
    let lastWeek = 0;
    const lastDays = new Set<string>();
    for (const r of rows) {
      if (r.date >= cutoffY) {
        thisWeek += r.revenue;
        thisDays.add(r.date);
      } else if (r.date >= priorStartY) {
        lastWeek += r.revenue;
        lastDays.add(r.date);
      }
    }
    if (lastDays.size < 4 || thisDays.size < 4) return null;
    const thisPace = thisWeek / thisDays.size;
    const lastPace = lastWeek / lastDays.size;
    if (lastPace <= 0) return null;
    const delta = (thisPace - lastPace) / lastPace;
    let dir: "up" | "flat" | "down";
    if (delta > 0.03) dir = "up";
    else if (delta < -0.03) dir = "down";
    else dir = "flat";
    return { dir, delta, thisPace, lastPace };
  }, [rows]);

  const maxByMetric = useMemo(() => {
    let max = 0;
    for (const loom of LOOMS) {
      for (const d of dates) {
        const v = metricValue(grid.get(`${loom}|${ymd(d)}`), metric);
        if (v !== null && v > max) max = v;
      }
    }
    return max;
  }, [grid, dates, metric]);

  const totals = useMemo(() => {
    const out = new Map<string, { meters: number; revenue: number; target: number }>();
    for (const loom of LOOMS) out.set(loom, { meters: 0, revenue: 0, target: 0 });
    for (const r of rows || []) {
      const cur = out.get(r.loom);
      if (!cur) continue;
      cur.meters += r.meters;
      cur.revenue += r.revenue;
      cur.target += r.targetMeters;
    }
    return out;
  }, [rows]);

  const planByLoom = useMemo(() => {
    const m = new Map<string, ReturnType<typeof planSummaryForLoom>>();
    for (const loom of LOOMS) m.set(loom, planSummaryForLoom(rows || [], loom));
    return m;
  }, [rows]);
  const wow = useMemo(() => weekDeltas(rows || []), [rows]);
  const oppGap = useMemo(() => opportunityGap(rows || []), [rows]);
  const bw = useMemo(() => bestAndWatch(rows || []), [rows]);
  const disruptions = useMemo(() => disruptionCounts(rows || []), [rows]);

  return (
    <div className="px-4 py-4">
      {/* Monthly target tracker — verdict-first */}
      {targetStats ? (
        <MonthTargetCard stats={targetStats} monthStart={monthStart} momentum={momentum} loomStatus={loomStatus} />
      ) : (
        <div className="h-56 bg-black/[0.04] rounded-xl animate-pulse mb-5" />
      )}

      {/* Tier 4 — detail on demand */}
      <button
        onClick={() => setShowDetail((v) => !v)}
        className="w-full flex items-center justify-between rounded-xl bg-white border border-[var(--color-border-hairline)] px-4 py-3 active:bg-black/[0.02]"
      >
        <span className="text-[14px] font-medium text-[var(--color-text-primary)]">14 நாள் விவரம்</span>
        <Chevron open={showDetail} />
      </button>

      {!showDetail ? null : (
      <div className="mt-5">
      <div className="mb-4">
        <h2 className="text-[18px] font-bold mb-1 text-[var(--color-text-primary)]">கடந்த {DAYS} நாட்கள்</h2>
        <p className="text-[14px] text-[var(--color-text-secondary)]">
          {shortDateLong(dates[0])} — {shortDateLong(dates[dates.length - 1])}
        </p>
      </div>

      {/* Week-over-week delta strip */}
      {loading ? (
        <div className="h-14 bg-black/[0.04] rounded-lg animate-pulse mb-5" />
      ) : (
        <WowStrip wow={wow} />
      )}

      {/* Metric toggle */}
      <div className="grid grid-cols-2 gap-1 p-1 bg-black/[0.04] rounded-lg mb-5 text-[14px]">
        <SegBtn active={metric === "efficiency"} onClick={() => setMetric("efficiency")} label="Performance" />
        <SegBtn active={metric === "revenue"} onClick={() => setMetric("revenue")} label="வருமானம்" />
      </div>

      {/* Income trend line — revenue view only */}
      {metric === "revenue" ? (
        loading || !rows ? (
          <div className="h-64 bg-black/[0.04] rounded-xl animate-pulse mb-6" />
        ) : (
          <IncomeLineSection rows={rows} mtdRows={mtdRows} dates={dates} monthStart={monthStart} />
        )
      ) : null}

      {/* Day-by-day heatmap — Performance view only */}
      {metric === "efficiency" ? (
      <div className="mb-6">
        <div className="text-[13px] font-semibold tracking-wide text-[var(--color-text-secondary)] mb-2">நாள் வாரியான பார்வை</div>
        {loading ? (
          <div className="h-44 bg-black/[0.04] rounded animate-pulse" />
        ) : (
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="border-separate border-spacing-1">
              <thead>
                <tr>
                  <th className="w-8" />
                  {dates.map((d) => (
                    <th
                      key={ymd(d)}
                      className="text-[12px] font-medium text-[var(--color-text-secondary)] tabular-nums px-0.5"
                    >
                      {d.getDate()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {LOOMS.map((loom) => (
                  <tr key={loom}>
                    <td className="text-[13px] font-semibold text-[var(--color-text-primary)] pr-1">{loom}</td>
                    {dates.map((d) => {
                      const cell = grid.get(`${loom}|${ymd(d)}`);
                      const v = metricValue(cell, metric);
                      const tint =
                        metric === "efficiency"
                          ? tintForEfficiency(v)
                          : tintForMagnitude(v, maxByMetric);
                      const title = `${loom} · ${shortDateLong(d)}\n${
                        v === null
                          ? "தரவு இல்லை"
                          : metric === "efficiency"
                            ? fmtPercent(v)
                            : fmtRupees(v)
                      }`;
                      return (
                        <td
                          key={ymd(d)}
                          title={title}
                          className={`w-6 h-6 rounded-[3px] ${tint}`}
                        />
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center gap-3 mt-3 text-[13px] text-[var(--color-text-secondary)]">
          <Legend tint="bg-[var(--color-status-red)]/15" label="<50%" />
          <Legend tint="bg-[var(--color-status-amber)]/15" label="50–70" />
          <Legend tint="bg-[var(--color-status-green)]/15" label="70–85" />
          <Legend tint="bg-[var(--color-status-green)]/30" label="85+" />
        </div>
      </div>
      ) : null}

      {/* Opportunity sentence */}
      {!loading && oppGap ? (
        <p className="text-[14px] text-[var(--color-text-secondary)] mb-5 leading-relaxed">
          ஒவ்வொரு தறியும் இந்த 14 நாட்களின் சிறந்த நாளுக்கு ஈடாக ஓடியிருந்தால், மேலும் <span className="font-semibold text-[var(--color-text-primary)]">{fmtRupees(oppGap.rupees)}</span> ({fmtMeters(oppGap.meters)}) வந்திருக்கும்.
        </p>
      ) : null}

      {/* Best · Watch callouts */}
      {!loading && (bw.best || bw.watch) ? (
        <div className={`grid ${bw.best && bw.watch ? "grid-cols-2" : "grid-cols-1"} gap-2 mb-5`}>
          {bw.best ? (
            <div className="rounded-lg border border-[var(--color-status-green)]/30 bg-[var(--color-status-green)]/10 px-3 py-2.5">
              <div className="text-[11px] uppercase tracking-wide text-[var(--color-status-green)] font-semibold mb-0.5">முன்னணி</div>
              <div className="text-[15px] font-bold text-[var(--color-text-primary)]">{bw.best.loom}</div>
              <div className="text-[12px] text-[var(--color-text-secondary)] tabular-nums">{fmtRupees(bw.best.revenue)}</div>
            </div>
          ) : null}
          {bw.watch ? (
            <div className={`rounded-lg border px-3 py-2.5 ${
              bw.watch.reason === "warp-gaps"
                ? "border-[var(--color-status-red)]/30 bg-[var(--color-status-red)]/10"
                : "border-[var(--color-status-amber)]/30 bg-[var(--color-status-amber)]/10"
            }`}>
              <div className={`text-[11px] uppercase tracking-wide font-semibold mb-0.5 ${
                bw.watch.reason === "warp-gaps" ? "text-[var(--color-status-red)]" : "text-[var(--color-status-amber)]"
              }`}>கவனிக்க</div>
              <div className="text-[15px] font-bold text-[var(--color-text-primary)]">{bw.watch.loom}</div>
              <div className="text-[12px] text-[var(--color-text-secondary)]">{bw.watch.detail}</div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Disruption summary */}
      {!loading && (disruptions.runout + disruptions.stopped + disruptions.powercut > 0) ? (
        <div className="mb-5">
          <div className="text-[13px] font-semibold tracking-wide text-[var(--color-text-secondary)] mb-2">இடையூறுகள்</div>
          <div className="flex flex-wrap gap-2">
            {disruptions.runout > 0 ? (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[var(--color-status-amber)]/10 text-[var(--color-status-amber)] text-[12px] font-medium">
                <span className="tabular-nums font-bold">{disruptions.runout}</span> Run out
              </span>
            ) : null}
            {disruptions.stopped > 0 ? (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[var(--color-status-red)]/10 text-[var(--color-status-red)] text-[12px] font-medium">
                <span className="tabular-nums font-bold">{disruptions.stopped}</span> Stopped
              </span>
            ) : null}
            {disruptions.powercut > 0 ? (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[var(--color-text-primary)]/10 text-[var(--color-text-primary)] text-[12px] font-medium">
                <span className="tabular-nums font-bold">{disruptions.powercut}</span> Power cut
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Per-loom totals */}
      <div>
        <div className="text-[13px] font-semibold tracking-wide text-[var(--color-text-secondary)] mb-2">தறி மொத்தம்</div>
        {loading ? (
          <div className="space-y-2">
            {LOOMS.map((l) => (
              <div key={l} className="h-10 bg-black/[0.04] rounded animate-pulse" />
            ))}
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-border-hairline)]">
            {LOOMS.map((loom) => {
              const t = totals.get(loom);
              const eff = t && t.target > 0 ? t.meters / t.target : 0;
              let activeDays = 0;
              for (const d of dates) {
                const c = grid.get(`${loom}|${ymd(d)}`);
                if (c && c.meters > 0) activeDays++;
              }
              const avgRevenue = activeDays > 0 ? (t?.revenue ?? 0) / activeDays : 0;
              return (
                <li key={loom} className="py-3 flex items-center gap-3">
                  <span className="w-12 inline-flex items-baseline gap-1 text-[16px] font-bold tabular-nums">
                    {loom}
                    {isNewLoom(loom) && <NewPill />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14px] text-[var(--color-text-secondary)] tabular-nums truncate">
                      {fmtMeters(t?.meters ?? 0)} · {fmtRupees(t?.revenue ?? 0)}
                    </span>
                    {planByLoom.get(loom) ? <PlanBar plan={planByLoom.get(loom)!} /> : null}
                  </span>
                  <span className="text-right">
                    {metric === "efficiency" ? (
                      <span className="text-[18px] font-bold tabular-nums text-[var(--color-text-primary)]">
                        {fmtPercent(eff)}
                      </span>
                    ) : (
                      <>
                        <span className="block text-[18px] font-bold tabular-nums text-[var(--color-text-primary)] leading-tight">
                          {fmtRupees(avgRevenue)}
                        </span>
                        <span className="block text-[11px] text-[var(--color-text-secondary)]">
                          / நாள் ({activeDays}d)
                        </span>
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      </div>
      )}
    </div>
  );
}

function MonthTargetCard({
  stats,
  monthStart,
  momentum,
  loomStatus,
}: {
  stats: {
    revenue: number;
    daysInMonth: number;
    daysElapsed: number;
    shouldBeByToday: number;
    paceFraction: number;
    avgPerDay: number;
    projected: number;
    gap: number;
    targetFraction: number;
    todayMarkFraction: number;
  };
  monthStart: Date;
  momentum: { dir: "up" | "flat" | "down"; delta: number } | null;
  loomStatus: { loom: string; total: number; avg: number; band: "on" | "below" | "weak" | "idle" }[] | null;
}) {
  const monthName = monthStart.toLocaleDateString("en-GB", { month: "long" });

  // On-track status = how the money earned so far compares with where it
  // should be by now. This colours the bar and the gap line — NOT the hero
  // number, which stays neutral because it is a plain fact, not a verdict.
  const pace = stats.paceFraction;
  const tone =
    pace >= 0.97
      ? { text: "text-[var(--color-status-green)]", bar: "bg-[var(--color-status-green)]" }
      : pace >= 0.8
      ? { text: "text-[var(--color-status-amber)]", bar: "bg-[var(--color-status-amber)]" }
      : { text: "text-[var(--color-status-red)]", bar: "bg-[var(--color-status-red)]" };

  // Momentum chip = production speed this week vs last week (a trend, not a
  // level), so it is kept small and separate from the on-track status.
  const momoTone =
    momentum?.dir === "up"
      ? "bg-[var(--color-status-green)]/10 text-[var(--color-status-green)]"
      : momentum?.dir === "down"
      ? "bg-[var(--color-status-red)]/10 text-[var(--color-status-red)]"
      : "bg-black/[0.05] text-[var(--color-text-secondary)]";

  const barFill = Math.max(0, Math.min(1, stats.targetFraction)) * 100;
  const tickPos = Math.max(0, Math.min(1, stats.todayMarkFraction)) * 100;
  const short = stats.gap > 0;

  const diagnosis = loomStatus ? buildDiagnosis(loomStatus) : null;

  return (
    <div className="rounded-xl bg-white border border-[var(--color-border-hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.06)] px-4 pt-4 pb-4 mb-4">
      {/* Header — month + production-speed trend */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] uppercase tracking-wide text-[var(--color-text-secondary)]">
          இந்த மாதம் · {monthName}
        </span>
        {momentum ? (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-semibold ${momoTone}`}>
            {momentum.dir === "up" ? (
              <>
                <TrendUp className="w-3.5 h-3.5" weight="bold" />
                வேகம் கூடுது
              </>
            ) : momentum.dir === "down" ? (
              <>
                <TrendDown className="w-3.5 h-3.5" weight="bold" />
                வேகம் குறையுது
              </>
            ) : (
              <>
                <ArrowRight className="w-3.5 h-3.5" weight="bold" />
                வேகம் நிலையானது
              </>
            )}
          </span>
        ) : null}
      </div>

      {/* Hero — what has actually been earned, against the hard ₹15L target */}
      <div className="flex items-baseline gap-1.5">
        <span className="text-[32px] font-bold tabular-nums leading-tight text-[var(--color-text-primary)]">
          {fmtLakh(stats.revenue)}
        </span>
        <span className="text-[16px] font-semibold tabular-nums text-[var(--color-text-secondary)] leading-tight">
          / ₹15L இலக்கு
        </span>
      </div>
      <div className="text-[13px] text-[var(--color-text-secondary)] mt-0.5">
        தயாரித்தது · {stats.daysElapsed} நாட்களில்
      </div>

      {/* Progress toward the hard ₹15L target, with a tick for "by today" */}
      <div className="mt-3 relative h-2.5 rounded-full bg-black/[0.06]">
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${tone.bar}`}
          style={{ width: `${barFill}%` }}
        />
        <div
          className="absolute -top-1 -bottom-1 w-[2px] rounded-full bg-[var(--color-text-primary)]/45"
          style={{ left: `${tickPos}%` }}
          title="இன்றுவரை இருக்கவேண்டிய இடம்"
        />
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[12px] text-[var(--color-text-secondary)] tabular-nums">
          இன்றுவரை {fmtLakh(stats.shouldBeByToday)} இருக்கவேண்டும்
        </span>
        <span className={`text-[12px] font-semibold tabular-nums ${tone.text}`}>
          {fmtPercent(stats.targetFraction)}
        </span>
      </div>

      {/* Trio — earned / pace / projection at a glance */}
      <div className="mt-3 pt-3 border-t border-[var(--color-border-hairline)] grid grid-cols-3 gap-2">
        <TrioCell label="தயாரித்தது" value={fmtLakh(stats.revenue)} />
        <TrioCell label="Pace" value={`${fmtThousand(stats.avgPerDay)}/day`} />
        <TrioCell label="Projected" value={fmtLakh(stats.projected)} />
      </div>

      {/* Gap line — makes it unambiguous that "Projected" is NOT the target */}
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-text-primary)]">
        {short ? (
          <>
            இந்த வேகத்தில் மாத இறுதியில் <span className="font-bold tabular-nums">{fmtLakh(stats.projected)}</span> — ₹15L இலக்கைவிட{" "}
            <span className={`font-bold tabular-nums ${tone.text}`}>{fmtLakh(stats.gap)} குறைவு</span>
          </>
        ) : (
          <>
            இந்த வேகத்தில் ₹15L இலக்கைவிட{" "}
            <span className="font-bold tabular-nums text-[var(--color-status-green)]">{fmtLakh(-stats.gap)} அதிகம்</span>
          </>
        )}
      </p>

      {/* Diagnosis — why the gap exists */}
      {loomStatus ? (
        <div className="mt-3 pt-3 border-t border-[var(--color-border-hairline)]">
          <div className="text-[12px] uppercase tracking-wide text-[var(--color-text-secondary)] mb-1.5">காரணம்</div>
          {diagnosis ? (
            <p className="text-[13px] text-[var(--color-text-primary)] leading-relaxed mb-2.5">{diagnosis}</p>
          ) : null}
          <LoomChips status={loomStatus} />
        </div>
      ) : null}
    </div>
  );
}

function TrioCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-[var(--color-text-secondary)]">{label}</div>
      <div className="text-[15px] font-bold tabular-nums text-[var(--color-text-primary)] leading-tight">{value}</div>
    </div>
  );
}

const CHIP_TONE: Record<"on" | "below" | "weak" | "idle", string> = {
  on: "bg-[var(--color-status-green)]/15 text-[var(--color-status-green)]",
  below: "bg-[var(--color-status-amber)]/15 text-[var(--color-status-amber)]",
  weak: "bg-[var(--color-status-red)]/15 text-[var(--color-status-red)]",
  idle: "bg-black/[0.06] text-[var(--color-text-secondary)]",
};

function LoomChips({
  status,
}: {
  status: { loom: string; band: "on" | "below" | "weak" | "idle" }[];
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {status.map((s) => (
        <span
          key={s.loom}
          className={`inline-flex items-center justify-center min-w-[32px] px-1.5 py-1 rounded-md text-[12px] font-semibold tabular-nums ${CHIP_TONE[s.band]}`}
        >
          {s.loom}
        </span>
      ))}
    </div>
  );
}

// Build a plain-language reason sentence. English-leaning with loom IDs so the
// partner can scan it like an ops note.
function buildDiagnosis(
  status: { loom: string; band: "on" | "below" | "weak" | "idle" }[],
): string {
  const on = status.filter((s) => s.band === "on");
  const idle = status.filter((s) => s.band === "idle");
  const lagging = status.filter((s) => s.band === "below" || s.band === "weak");

  const parts: string[] = [];
  if (on.length === status.length) {
    return `All ${status.length} looms on target.`;
  }
  parts.push(`${on.length}/${status.length} looms on target.`);

  const tail: string[] = [];
  if (lagging.length > 0) {
    tail.push(`${joinLooms(lagging.map((s) => s.loom))} ramping`);
  }
  if (idle.length > 0) {
    tail.push(`${joinLooms(idle.map((s) => s.loom))} idle`);
  }
  if (tail.length > 0) {
    parts.push(`Shortfall is ${tail.join(", ")}.`);
  }
  return parts.join(" ");
}

// Compress consecutive loom IDs (L9, L10, L11 → L9–L11) for a tidy sentence.
function joinLooms(looms: string[]): string {
  const nums = looms
    .map((l) => ({ l, n: parseInt(l.replace(/\D/g, ""), 10) }))
    .filter((x) => !isNaN(x.n))
    .sort((a, b) => a.n - b.n);
  if (nums.length === 0) return looms.join(", ");
  const ranges: string[] = [];
  let start = nums[0];
  let prev = nums[0];
  for (let i = 1; i < nums.length; i++) {
    if (nums[i].n === prev.n + 1) {
      prev = nums[i];
    } else {
      ranges.push(start === prev ? start.l : `${start.l}–${prev.l}`);
      start = nums[i];
      prev = nums[i];
    }
  }
  ranges.push(start === prev ? start.l : `${start.l}–${prev.l}`);
  return ranges.join(", ");
}

function Chevron({ open }: { open: boolean }) {
  return (
    <CaretDown
      className={`w-4 h-4 text-[var(--color-text-secondary)] transition-transform ${open ? "rotate-180" : ""}`}
      weight="bold"
    />
  );
}

function SegBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`py-1.5 rounded-md transition-colors ${
        active
          ? "bg-white text-[var(--color-text-primary)] font-medium shadow-sm"
          : "text-[var(--color-text-secondary)]"
      }`}
    >
      {label}
    </button>
  );
}

function Legend({ tint, label }: { tint: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block w-3 h-3 rounded-[2px] ${tint}`} />
      {label}
    </span>
  );
}

type PlanShape = NonNullable<ReturnType<typeof planSummaryForLoom>>;

function bandClasses(band: PlanShape["band"]): { bar: string; text: string; bg: string; border: string; chip: string } {
  if (band === "on") {
    return {
      bar: "bg-[var(--color-status-green)]",
      text: "text-[var(--color-status-green)]",
      bg: "bg-[var(--color-status-green)]/8",
      border: "border-[var(--color-status-green)]/25",
      chip: "On track",
    };
  }
  if (band === "near") {
    return {
      bar: "bg-[var(--color-status-amber)]",
      text: "text-[var(--color-status-amber)]",
      bg: "bg-[var(--color-status-amber)]/8",
      border: "border-[var(--color-status-amber)]/25",
      chip: "Near plan",
    };
  }
  return {
    bar: "bg-[var(--color-status-red)]",
    text: "text-[var(--color-status-red)]",
    bg: "bg-[var(--color-status-red)]/8",
    border: "border-[var(--color-status-red)]/25",
    chip: "Below plan",
  };
}

function WowStrip({ wow }: { wow: ReturnType<typeof weekDeltas> }) {
  if (wow.metersPct === null && wow.revenuePct === null && wow.effPctPoints === null) return null;
  return (
    <div className="grid grid-cols-3 gap-2 mb-5">
      <WowCell label="மீட்டர்" value={fmtSignedPct(wow.metersPct)} frac={wow.metersPct} />
      <WowCell label="வருமானம்" value={fmtSignedPct(wow.revenuePct)} frac={wow.revenuePct} />
      <WowCell label="Performance" value={fmtSignedPp(wow.effPctPoints)} frac={wow.effPctPoints} />
    </div>
  );
}

function WowCell({ label, value, frac }: { label: string; value: string; frac: number | null }) {
  const tone =
    frac === null
      ? "text-[var(--color-text-secondary)]"
      : Math.abs(frac) < 0.02
        ? "text-[var(--color-text-secondary)]"
        : frac > 0
          ? "text-[var(--color-status-green)]"
          : "text-[var(--color-status-red)]";
  const arrow =
    frac === null || Math.abs(frac) < 0.02 ? "·" : frac > 0 ? "▲" : "▼";
  return (
    <div className="rounded-lg border border-[var(--color-border-hairline)] px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-[var(--color-text-secondary)] font-semibold mb-0.5">{label}</div>
      <div className={`text-[15px] font-bold tabular-nums ${tone}`}>
        <span className="mr-1">{arrow}</span>
        {value}
      </div>
      <div className="text-[10px] text-[var(--color-text-secondary)]">முன்/பின் 7 நாட்கள்</div>
    </div>
  );
}

function PlanBar({ plan }: { plan: PlanShape }) {
  const cls = bandClasses(plan.band);
  const fillPct = Math.min(100, Math.round(plan.pct * 100));
  return (
    <span className="mt-1 flex items-center gap-2">
      <span className="flex-1 h-1 rounded-full bg-black/[0.06] overflow-hidden">
        <span className={`block h-full ${cls.bar}`} style={{ width: `${fillPct}%` }} />
      </span>
      <span className={`text-[11px] tabular-nums font-semibold ${cls.text}`}>{Math.round(plan.pct * 100)}%</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Income trend line (Option A) — one bold line = summed income across the
// selected looms per day, against an active-aware ₹3,500/loom target line.
// ---------------------------------------------------------------------------

interface IncomePoint {
  date: string;
  label: string;
  income: number;
  target: number;
  latest: boolean;
}

// Wide row for the by-loom view: one numeric key per loom (null on days the
// loom did not yet exist) + the shared per-loom target.
interface ByLoomPoint {
  date: string;
  label: string;
  latest: boolean;
  target: number;
  [loom: string]: number | string | boolean | null;
}

// Distinct, stable colour per loom (by catalogue index) for the by-loom lines.
const LOOM_COLORS = [
  "#2563eb", "#db2777", "#0891b2", "#7c3aed", "#ea580c", "#0d9488", "#9333ea",
  "#0284c7", "#e11d48", "#4f46e5", "#65a30d", "#b45309", "#be123c", "#c026d3",
];

function loomColor(loom: string): string {
  const i = LOOMS.indexOf(loom);
  return LOOM_COLORS[(i >= 0 ? i : 0) % LOOM_COLORS.length];
}

const PER_LOOM_TARGET_ROUND = Math.round(PER_LOOM_CHART_TARGET);

// Default by-loom selection: the two lowest + two highest earners over the
// window (avg income across each loom's active days), so the breakdown opens
// pre-focused on the laggards and the leaders for contrast. Looms with no data
// in the window are not eligible; if fewer than four qualify, take what exists.
function deriveDefaultLooms(rows: MasterRangeRow[], dates: Date[]): Set<string> {
  const dateSet = new Set(dates.map((d) => ymd(d)));
  const revByLoom = new Map<string, number>();
  const daysByLoom = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!dateSet.has(r.date)) continue;
    if (r.revenue > 0) {
      revByLoom.set(r.loom, (revByLoom.get(r.loom) || 0) + r.revenue);
      let s = daysByLoom.get(r.loom);
      if (!s) {
        s = new Set();
        daysByLoom.set(r.loom, s);
      }
      s.add(r.date);
    }
  }
  const ranked = LOOMS.map((loom) => {
    const days = daysByLoom.get(loom)?.size || 0;
    return { loom, days, avg: days > 0 ? (revByLoom.get(loom) || 0) / days : 0 };
  })
    .filter((x) => x.days > 0)
    .sort((a, b) => a.avg - b.avg);
  if (ranked.length <= 4) return new Set(ranked.map((x) => x.loom));
  return new Set([
    ranked[0].loom,
    ranked[1].loom,
    ranked[ranked.length - 2].loom,
    ranked[ranked.length - 1].loom,
  ]);
}

function IncomeLineSection({
  rows,
  mtdRows,
  dates,
  monthStart,
}: {
  rows: MasterRangeRow[];
  mtdRows: MasterRangeRow[] | null;
  dates: Date[];
  monthStart: Date;
}) {
  const [view, setView] = useState<"overall" | "byLoom">("overall");
  const [mode, setMode] = useState<"month" | "7d">("month");
  // null = follow the auto-derived default; a concrete Set = user override.
  const [selected, setSelected] = useState<Set<string> | null>(null);

  // Month-to-date calendar days (1st → yesterday) — today is never charted, as
  // it is still in progress; the most recent complete day is the live point.
  const monthDates = useMemo(() => {
    const out: Date[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(monthStart);
    d.setHours(0, 0, 0, 0);
    while (d < today) {
      out.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, [monthStart]);

  // "7d" reads from the rolling 14-day window (spans month boundaries);
  // "month" reads from the month-to-date rows. Both exclude today — slice(-8, -1)
  // yields the seven complete days ending yesterday.
  const shownDates = mode === "7d" ? dates.slice(-8, -1) : monthDates;
  const sourceRows = mode === "7d" ? rows : mtdRows || [];

  // Auto default tracks the data/range until the partner picks looms manually.
  const autoDefault = useMemo(
    () => deriveDefaultLooms(sourceRows, shownDates),
    [sourceRows, shownDates],
  );
  const effSelected = selected ?? autoDefault;

  // Overall view — one summed line across the whole fleet (selection-agnostic).
  const overallData = useMemo<IncomePoint[]>(() => {
    const rev = new Map<string, number>();
    for (const r of sourceRows) {
      const k = `${r.date}|${r.loom}`;
      rev.set(k, (rev.get(k) || 0) + r.revenue);
    }
    const lastIdx = shownDates.length - 1;
    return shownDates.map((d, i) => {
      const ds = ymd(d);
      let income = 0;
      let expected = 0; // looms physically running that day
      for (const loom of LOOMS) {
        income += rev.get(`${ds}|${loom}`) || 0;
        const phantom = isNewLoom(loom) && ds < NEW_LOOM_START;
        if (!phantom) expected++;
      }
      return {
        date: ds,
        label: String(d.getDate()),
        income,
        target: Math.round(expected * PER_LOOM_CHART_TARGET),
        latest: i === lastIdx,
      };
    });
  }, [sourceRows, shownDates]);

  // By-loom view — a wide row per day carrying every loom's income.
  const byLoomData = useMemo<ByLoomPoint[]>(() => {
    const rev = new Map<string, number>();
    for (const r of sourceRows) {
      const k = `${r.date}|${r.loom}`;
      rev.set(k, (rev.get(k) || 0) + r.revenue);
    }
    const lastIdx = shownDates.length - 1;
    return shownDates.map((d, i) => {
      const ds = ymd(d);
      const point: ByLoomPoint = {
        date: ds,
        label: String(d.getDate()),
        latest: i === lastIdx,
        target: PER_LOOM_TARGET_ROUND,
      };
      for (const loom of LOOMS) {
        const phantom = isNewLoom(loom) && ds < NEW_LOOM_START;
        point[loom] = phantom ? null : rev.get(`${ds}|${loom}`) || 0;
      }
      return point;
    });
  }, [sourceRows, shownDates]);

  const total = useMemo(() => overallData.reduce((s, p) => s + p.income, 0), [overallData]);
  // Days whose fleet income beat that day's target line — the achievement count.
  const beatDays = useMemo(
    () => overallData.filter((p) => p.target > 0 && p.income >= p.target).length,
    [overallData],
  );
  const allOn = effSelected.size === LOOMS.length;
  // Full-fleet daily target (legend readout for the overall view).
  const fleetTarget = Math.round(LOOMS.length * PER_LOOM_CHART_TARGET);

  // Draw unselected (grey) looms first, selected (coloured) on top.
  const loomOrder = useMemo(
    () => [...LOOMS].sort((a, b) => (effSelected.has(a) ? 1 : 0) - (effSelected.has(b) ? 1 : 0)),
    [effSelected],
  );

  const toggle = (loom: string) => {
    const base = new Set(selected ?? autoDefault);
    if (base.has(loom)) {
      if (base.size === 1) return; // keep at least one loom highlighted
      base.delete(loom);
    } else {
      base.add(loom);
    }
    setSelected(base);
  };

  return (
    <div className="rounded-xl bg-white border border-[var(--color-border-hairline)] px-3 pt-3 pb-2 mb-6">
      {/* View switch — overall fleet vs per-loom breakdown */}
      <div className="inline-flex rounded-md bg-black/[0.04] p-0.5 text-[12px] font-medium mb-2">
        {([
          { key: "overall", label: "மொத்தம்" },
          { key: "byLoom", label: "தறி வாரியாக" },
        ] as const).map((opt) => (
          <button
            key={opt.key}
            onClick={() => setView(opt.key)}
            className={`px-2.5 py-1 rounded transition-colors ${
              view === opt.key
                ? "bg-white text-[var(--color-text-primary)] shadow-sm"
                : "text-[var(--color-text-secondary)]"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Header — window readout + range toggle */}
      <div className="flex items-center justify-between mb-2 px-1">
        <div>
          <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">வருமானம் / நாள்</div>
          <div className="text-[12px] text-[var(--color-text-secondary)] tabular-nums">
            {view === "overall"
              ? `மொத்தம் ${fmtRupees(total)} · ${shownDates.length} நாட்கள்`
              : `${effSelected.size} தறி · ${shownDates.length} நாட்கள்`}
          </div>
          {view === "overall" && beatDays > 0 ? (
            <div
              className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-semibold"
              style={{ color: GOLD }}
            >
              <span aria-hidden>⭐</span>
              <span>{beatDays} நாள் இலக்கைத் தாண்டியது</span>
            </div>
          ) : null}
        </div>
        <div className="inline-flex rounded-md bg-black/[0.04] p-0.5 text-[12px] font-medium">
          {([
            { key: "7d", label: "7 நாள்" },
            { key: "month", label: "இந்த மாதம்" },
          ] as const).map((opt) => (
            <button
              key={opt.key}
              onClick={() => setMode(opt.key)}
              className={`px-2.5 py-1 rounded transition-colors ${
                mode === opt.key
                  ? "bg-white text-[var(--color-text-primary)] shadow-sm"
                  : "text-[var(--color-text-secondary)]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Line chart */}
      <div className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={view === "overall" ? overallData : byLoomData}
            margin={{ top: 8, right: 10, left: -10, bottom: 0 }}
          >
            <CartesianGrid stroke="var(--color-border-hairline)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={(v: number) => fmtThousand(v)}
              tick={{ fontSize: 10, fill: "var(--color-text-secondary)" }}
              axisLine={false}
              tickLine={false}
              width={42}
            />
            <Tooltip
              content={view === "overall" ? <IncomeTooltip /> : <ByLoomTooltip selected={effSelected} />}
              cursor={{ stroke: "var(--color-border-hairline)" }}
            />
            {/* Target — dashed hairline (active-aware fleet, or flat per-loom) */}
            <Line
              type="monotone"
              dataKey="target"
              stroke="var(--color-text-secondary)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              isAnimationActive={false}
            />
            {view === "overall" ? (
              <Line
                type="monotone"
                dataKey="income"
                stroke="var(--color-status-green)"
                strokeWidth={2.5}
                dot={<IncomeDot />}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            ) : (
              loomOrder.map((loom) => {
                const on = effSelected.has(loom);
                return (
                  <Line
                    key={loom}
                    type="monotone"
                    dataKey={loom}
                    stroke={on ? loomColor(loom) : "var(--color-text-secondary)"}
                    strokeWidth={on ? 2.5 : 1}
                    strokeOpacity={on ? 1 : 0.18}
                    dot={false}
                    activeDot={on ? { r: 3 } : false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                );
              })
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Legend — what each line means */}
      <div className="flex items-center gap-4 mt-1 px-1 text-[12px] text-[var(--color-text-secondary)]">
        {view === "overall" ? (
          <>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-4 h-[2.5px] rounded-full bg-[var(--color-status-green)]" />
              வருமானம்
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-4 border-t-[1.5px] border-dashed border-[var(--color-text-secondary)]" />
              இலக்கு · {fmtRupees(fleetTarget)}/நாள்
            </span>
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 border-t-[1.5px] border-dashed border-[var(--color-text-secondary)]" />
            ஒரு தறி இலக்கு · {fmtRupees(PER_LOOM_TARGET_ROUND)}/நாள்
          </span>
        )}
      </div>

      {/* Loom filter — by-loom view only */}
      {view === "byLoom" ? (
        <div className="flex gap-1.5 overflow-x-auto -mx-3 px-3 pt-2 pb-1">
          <FilterChip label="All" active={allOn} onClick={() => setSelected(new Set(LOOMS))} />
          {LOOMS.map((loom) => (
            <FilterChip
              key={loom}
              label={loom}
              active={effSelected.has(loom)}
              color={loomColor(loom)}
              onClick={() => toggle(loom)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// The most recent complete day gets a live, pulsing marker — an expanding ring
// that fades out — signalling the trend is ongoing and will continue. Days that
// beat their target line are celebrated with a calm gold star; if the latest day
// is also a target-beating day, its pulse turns gold and carries the star.
function IncomeDot(props: { cx?: number; cy?: number; payload?: IncomePoint }) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload) return null;
  const beat = payload.target > 0 && payload.income >= payload.target;

  if (payload.latest) {
    const color = beat ? GOLD : "var(--color-status-green)";
    return (
      <g>
        <circle cx={cx} cy={cy} r={4} fill={color} opacity={0.5}>
          <animate attributeName="r" values="4;10" dur="1.5s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.5;0" dur="1.5s" repeatCount="indefinite" />
        </circle>
        {beat ? (
          <GoldStar cx={cx} cy={cy} />
        ) : (
          <circle cx={cx} cy={cy} r={4} fill={color} stroke="white" strokeWidth={1.5} />
        )}
      </g>
    );
  }

  // Earlier day that beat its target — a calm, static gold star (no motion).
  if (beat) return <GoldStar cx={cx} cy={cy} />;

  return null;
}

// A small 5-point gold star, white-outlined so it reads against the green line.
function GoldStar({ cx, cy }: { cx: number; cy: number }) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 6 : 2.6;
    const a = (Math.PI / 5) * i - Math.PI / 2; // first point at the top
    pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
  }
  return (
    <polygon
      points={pts.join(" ")}
      fill={GOLD}
      stroke="white"
      strokeWidth={1}
      strokeLinejoin="round"
    />
  );
}

function IncomeTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: IncomePoint }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md bg-[var(--color-text-primary)] text-white px-2.5 py-1.5 text-[12px] shadow-lg">
      <div className="font-semibold tabular-nums">{fmtRupees(p.income)}</div>
      <div className="opacity-70 tabular-nums">இலக்கு {fmtRupees(p.target)}</div>
    </div>
  );
}

function ByLoomTooltip({
  active,
  payload,
  selected,
}: {
  active?: boolean;
  payload?: Array<{ payload: ByLoomPoint }>;
  selected?: Set<string>;
}) {
  if (!active || !payload || payload.length === 0 || !selected) return null;
  const p = payload[0].payload;
  const items = LOOMS.filter((l) => selected.has(l) && p[l] != null)
    .map((l) => ({ loom: l, val: p[l] as number }))
    .sort((a, b) => b.val - a.val);
  if (items.length === 0) return null;
  return (
    <div className="rounded-md bg-[var(--color-text-primary)] text-white px-2.5 py-1.5 text-[12px] shadow-lg">
      {items.map((it) => (
        <div key={it.loom} className="flex items-center gap-1.5 tabular-nums">
          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: loomColor(it.loom) }} />
          <span className="font-medium">{it.loom}</span>
          <span className="ml-auto">{fmtRupees(it.val)}</span>
        </div>
      ))}
      <div className="opacity-60 mt-1 pt-1 border-t border-white/20 tabular-nums">
        இலக்கு {fmtRupees(PER_LOOM_TARGET_ROUND)}
      </div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  color,
  onClick,
}: {
  label: string;
  active: boolean;
  color?: string;
  onClick: () => void;
}) {
  const activeStyle = active && color ? { color, borderColor: color, backgroundColor: `${color}26` } : undefined;
  return (
    <button
      onClick={onClick}
      style={activeStyle}
      className={`shrink-0 px-2.5 py-1 rounded-full text-[12px] font-semibold tabular-nums border transition-colors ${
        active
          ? color
            ? ""
            : "bg-[var(--color-status-green)]/15 text-[var(--color-status-green)] border-[var(--color-status-green)]/30"
          : "bg-transparent text-[var(--color-text-secondary)] border-[var(--color-border-hairline)]"
      }`}
    >
      {label}
    </button>
  );
}
