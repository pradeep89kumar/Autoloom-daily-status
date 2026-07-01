import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, Printer, CircleNotch } from "@phosphor-icons/react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { fetchMasterRange, type MasterRangeRow } from "../../lib/sheetSync";
import { LOOM_CATALOG, isNewLoom } from "../../lib/looms";
import { fmtRupees, fmtMeters } from "../../lib/partnerCopy";

// Report constants — kept in step with the Trend screen so the PDF and the
// on-screen figures never disagree.
const FIRM_NAME = "Sri Aarumga Tex";
const MONTHLY_TARGET = 1500000;      // ₹15L revenue target for the month
const PER_LOOM_DAY_TARGET = 3500;    // implied per-loom/day revenue target
const NEW_LOOM_START = "2026-06-07"; // rows before this for new looms are phantoms
const LOOMS = LOOM_CATALOG.map((l) => l.name);

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function longDate(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function monthTitle(d: Date): string {
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

// Newest-first list of selectable months (current month + previous ones).
// The current month is tagged "(so far)" since it is still in progress.
function buildMonthOptions(count: number): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    const label = monthTitle(d) + (i === 0 ? " (so far)" : "");
    out.push({ key, label });
  }
  return out;
}

function shortDay(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", weekday: "short" });
}

function pct(frac: number): string {
  if (!isFinite(frac)) return "—";
  return `${Math.round(frac * 100)}%`;
}

function fmtThousand(n: number): string {
  if (!isFinite(n)) return "";
  if (Math.abs(n) >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  return `₹${Math.round(n / 1000)}k`;
}

// Efficiency tint for the heatmap — explicit rgba so it survives print.
function effTint(frac: number | null): string {
  if (frac === null) return "rgba(0,0,0,0.05)";
  if (frac < 0.5) return "rgba(220,38,38,0.22)";
  if (frac < 0.7) return "rgba(232,163,23,0.30)";
  if (frac < 0.85) return "rgba(22,163,74,0.22)";
  return "rgba(22,163,74,0.44)";
}

interface LoomStat {
  loom: string;
  meters: number;
  revenue: number;
  days: number;
  avg: number;
  band: "on" | "below" | "weak" | "idle";
}

interface DayStat {
  date: string;
  meters: number;
  revenue: number;
  target: number;
  looms: number;
}

const BAND_LABEL: Record<LoomStat["band"], string> = {
  on: "On target",
  below: "Below",
  weak: "Weak",
  idle: "Idle",
};

export function PartnerTrendReport() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<MasterRangeRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // Month picker — defaults to the PREVIOUS complete month, because the report
  // is downloaded on the 1st to capture the month that just ended.
  const monthOptions = useMemo(() => buildMonthOptions(6), []);
  const [monthKey, setMonthKey] = useState(() => monthOptions[1]?.key ?? monthOptions[0].key);

  const period = useMemo(() => {
    const [y, m] = monthKey.split("-").map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0);                 // last day of the month
    const periodEnd = end < today ? end : today;   // cap the current month at today
    const complete = today > end;                  // whole month is in the past
    return { start, end, periodEnd, complete, daysInMonth: end.getDate() };
  }, [monthKey, today]);

  const generatedAt = useMemo(
    () => new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
    [],
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchMasterRange(ymd(period.start), ymd(period.periodEnd)).then((r) => {
      if (!alive) return;
      const filtered = r.filter((row) => !(isNewLoom(row.loom) && row.date < NEW_LOOM_START));
      setRows(filtered);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [period]);

  // Month-to-date fleet summary — mirrors the Trend screen's target tracker.
  const summary = useMemo(() => {
    const daysInMonth = period.daysInMonth;
    const targetPerDay = MONTHLY_TARGET / daysInMonth;
    let revenue = 0;
    let meters = 0;
    const activeDates = new Set<string>();
    for (const r of rows || []) {
      revenue += r.revenue;
      meters += r.meters;
      if (r.revenue > 0 || r.meters > 0) activeDates.add(r.date);
    }
    const daysElapsed = activeDates.size;
    const shouldBeByToday = targetPerDay * daysElapsed;
    const paceFraction = shouldBeByToday > 0 ? revenue / shouldBeByToday : 0;
    const avgPerDay = daysElapsed > 0 ? revenue / daysElapsed : 0;
    const projected = avgPerDay * daysInMonth;
    const gap = MONTHLY_TARGET - projected;
    const finalGap = MONTHLY_TARGET - revenue;
    return {
      daysInMonth,
      daysElapsed,
      revenue,
      meters,
      paceFraction,
      avgPerDay,
      projected,
      gap,
      finalGap,
      targetFraction: MONTHLY_TARGET > 0 ? revenue / MONTHLY_TARGET : 0,
    };
  }, [rows, period]);

  // Per-loom month-to-date breakdown.
  const loomStats = useMemo<LoomStat[]>(() => {
    const rev = new Map<string, number>();
    const met = new Map<string, number>();
    const days = new Map<string, Set<string>>();
    for (const r of rows || []) {
      rev.set(r.loom, (rev.get(r.loom) || 0) + r.revenue);
      met.set(r.loom, (met.get(r.loom) || 0) + r.meters);
      if (r.revenue > 0 || r.meters > 0) {
        if (!days.has(r.loom)) days.set(r.loom, new Set());
        days.get(r.loom)!.add(r.date);
      }
    }
    return LOOMS.map((loom) => {
      const revenue = rev.get(loom) || 0;
      const meters = met.get(loom) || 0;
      const d = days.get(loom)?.size || 0;
      const avg = d > 0 ? revenue / d : 0;
      let band: LoomStat["band"];
      if (revenue <= 0 || d === 0) band = "idle";
      else if (avg >= PER_LOOM_DAY_TARGET) band = "on";
      else if (avg >= PER_LOOM_DAY_TARGET * 0.6) band = "below";
      else band = "weak";
      return { loom, meters, revenue, days: d, avg, band };
    });
  }, [rows]);

  // Day-by-day fleet trend for the month.
  const dayStats = useMemo<DayStat[]>(() => {
    const byDate = new Map<string, DayStat>();
    for (const r of rows || []) {
      const cur = byDate.get(r.date) || { date: r.date, meters: 0, revenue: 0, target: 0, looms: 0 };
      cur.meters += r.meters;
      cur.revenue += r.revenue;
      cur.target += r.targetMeters;
      byDate.set(r.date, cur);
    }
    // Count active looms per day.
    const loomsByDate = new Map<string, Set<string>>();
    for (const r of rows || []) {
      if (r.revenue > 0 || r.meters > 0) {
        if (!loomsByDate.has(r.date)) loomsByDate.set(r.date, new Set());
        loomsByDate.get(r.date)!.add(r.loom);
      }
    }
    const out = Array.from(byDate.values()).map((d) => ({
      ...d,
      looms: loomsByDate.get(d.date)?.size || 0,
    }));
    out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return out;
  }, [rows]);

  const fleetTotals = useMemo(() => {
    let meters = 0;
    let revenue = 0;
    for (const s of loomStats) {
      meters += s.meters;
      revenue += s.revenue;
    }
    return { meters, revenue };
  }, [loomStats]);

  // Every calendar day in the reported range (for chart x-axis + heatmap columns).
  const monthDates = useMemo(() => {
    const out: Date[] = [];
    const d = new Date(period.start);
    while (d <= period.periodEnd) {
      out.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, [period]);

  // Daily fleet income vs the flat daily target line.
  const chartData = useMemo(() => {
    const dailyTarget = MONTHLY_TARGET / period.daysInMonth;
    return dayStats.map((d) => ({
      label: String(new Date(d.date).getDate()),
      income: Math.round(d.revenue),
      target: Math.round(dailyTarget),
    }));
  }, [dayStats, period]);

  // Per-loom × per-day efficiency grid for the heatmap.
  const heatGrid = useMemo(() => {
    const m = new Map<string, { meters: number; target: number }>();
    for (const r of rows || []) {
      const k = `${r.loom}|${r.date}`;
      const cur = m.get(k) || { meters: 0, target: 0 };
      cur.meters += r.meters;
      cur.target += r.targetMeters;
      m.set(k, cur);
    }
    return m;
  }, [rows]);

  return (
    <div className="min-h-screen bg-white text-black">
      {/* Screen-only action bar */}
      <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-black/10 bg-white px-4 py-3">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-[14px] font-medium text-black/70"
        >
          <ArrowLeft className="h-4 w-4" weight="bold" />
          Back
        </button>
        <div className="flex items-center gap-2">
          <select
            value={monthKey}
            onChange={(e) => setMonthKey(e.target.value)}
            className="rounded-lg border border-black/15 bg-white px-2.5 py-2 text-[13px] font-medium text-black/80"
          >
            {monthOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => window.print()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-[14px] font-semibold text-white disabled:opacity-50"
          >
            {loading ? (
              <CircleNotch className="h-4 w-4 animate-spin" weight="bold" />
            ) : (
              <Printer className="h-4 w-4" weight="bold" />
            )}
            Save as PDF
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-black/50">
          <CircleNotch className="h-6 w-6 animate-spin" weight="bold" />
        </div>
      ) : (
        <div className="report mx-auto max-w-[794px] px-6 py-6">
          {/* Header */}
          <header className="mb-5 border-b-2 border-black pb-3">
            <h1 className="text-[22px] font-bold leading-tight">{FIRM_NAME}</h1>
            <p className="text-[14px] font-semibold text-black/80">
              Monthly Production Report · {monthTitle(period.start)}
            </p>
            <p className="mt-1 text-[12px] text-black/60">
              Period: {longDate(period.start)} — {longDate(period.periodEnd)}
              {period.complete ? "" : " (in progress)"} · Generated {generatedAt}
            </p>
          </header>

          {/* Summary KPIs */}
          <section className="mb-6">
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-black/70">
              Month-to-date summary
            </h2>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-3">
              <Kpi label="Revenue so far" value={fmtRupees(summary.revenue)} />
              <Kpi label="Monthly target" value={fmtRupees(MONTHLY_TARGET)} />
              <Kpi label="Target achieved" value={pct(summary.targetFraction)} />
              <Kpi label="Meters woven" value={fmtMeters(summary.meters)} />
              <Kpi label="Avg / active day" value={fmtRupees(summary.avgPerDay)} />
              <Kpi
                label="Active days"
                value={`${summary.daysElapsed} of ${summary.daysInMonth}`}
              />
              {!period.complete && (
                <>
                  <Kpi label="Pace vs target" value={pct(summary.paceFraction)} />
                  <Kpi label="Projected month-end" value={fmtRupees(summary.projected)} />
                </>
              )}
              <Kpi
                label={
                  period.complete
                    ? summary.finalGap > 0
                      ? "Shortfall vs target"
                      : "Surplus vs target"
                    : summary.gap > 0
                      ? "Projected shortfall"
                      : "Projected surplus"
                }
                value={fmtRupees(Math.abs(period.complete ? summary.finalGap : summary.gap))}
              />
            </div>
          </section>

          {/* Income trend chart */}
          <section className="mb-6">
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-black/70">
              Income trend
            </h2>
            {chartData.length === 0 ? (
              <p className="text-[12px] text-black/50">No income recorded this month.</p>
            ) : (
              <div className="overflow-x-auto">
                <LineChart
                  width={680}
                  height={220}
                  data={chartData}
                  margin={{ top: 8, right: 16, left: 4, bottom: 0 }}
                >
                  <CartesianGrid stroke="#e5e5e5" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "#666" }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tickFormatter={(v: number) => fmtThousand(v)}
                    tick={{ fontSize: 10, fill: "#666" }}
                    axisLine={false}
                    tickLine={false}
                    width={46}
                  />
                  <Line
                    type="monotone"
                    dataKey="target"
                    stroke="#6B7280"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="income"
                    stroke="#16A34A"
                    strokeWidth={2.5}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </div>
            )}
            <div className="mt-1 flex items-center gap-4 text-[10px] text-black/55">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-[2.5px] w-4 rounded-full" style={{ backgroundColor: "#16A34A" }} />
                Income
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: "#6B7280" }} />
                Daily target
              </span>
            </div>
          </section>

          {/* Per-loom breakdown */}
          <section className="mb-6">
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-black/70">
              Per-loom breakdown
            </h2>
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b-2 border-black text-left">
                  <Th>Loom</Th>
                  <Th align="right">Active days</Th>
                  <Th align="right">Meters</Th>
                  <Th align="right">Revenue</Th>
                  <Th align="right">Avg / day</Th>
                  <Th align="right">Status</Th>
                </tr>
              </thead>
              <tbody>
                {loomStats.map((s) => (
                  <tr key={s.loom} className="border-b border-black/15">
                    <Td>{s.loom}</Td>
                    <Td align="right">{s.days || "—"}</Td>
                    <Td align="right">{s.meters > 0 ? fmtMeters(s.meters) : "—"}</Td>
                    <Td align="right">{s.revenue > 0 ? fmtRupees(s.revenue) : "—"}</Td>
                    <Td align="right">{s.avg > 0 ? fmtRupees(s.avg) : "—"}</Td>
                    <Td align="right">{BAND_LABEL[s.band]}</Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-black font-bold">
                  <Td>Fleet total</Td>
                  <Td align="right">—</Td>
                  <Td align="right">{fmtMeters(fleetTotals.meters)}</Td>
                  <Td align="right">{fmtRupees(fleetTotals.revenue)}</Td>
                  <Td align="right">—</Td>
                  <Td align="right">—</Td>
                </tr>
              </tfoot>
            </table>
          </section>

          {/* Performance heatmap */}
          <section className="mb-6">
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-black/70">
              Performance heatmap
            </h2>
            <div className="overflow-x-auto">
              <table className="border-separate" style={{ borderSpacing: 2 }}>
                <thead>
                  <tr>
                    <th className="w-7" />
                    {monthDates.map((d) => (
                      <th
                        key={ymd(d)}
                        className="text-[9px] font-medium text-black/50 tabular-nums"
                        style={{ width: 14 }}
                      >
                        {d.getDate()}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {LOOMS.map((loom) => (
                    <tr key={loom}>
                      <td className="pr-1 text-[11px] font-semibold text-black">{loom}</td>
                      {monthDates.map((d) => {
                        const cell = heatGrid.get(`${loom}|${ymd(d)}`);
                        const frac = cell && cell.target > 0 ? cell.meters / cell.target : null;
                        return (
                          <td
                            key={ymd(d)}
                            title={`${loom} · ${shortDay(ymd(d))} · ${frac === null ? "no data" : pct(frac)}`}
                            style={{ width: 14, height: 14, borderRadius: 2, backgroundColor: effTint(frac) }}
                          />
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex items-center gap-3 text-[10px] text-black/55">
              <LegendSwatch color={effTint(0.3)} label="<50%" />
              <LegendSwatch color={effTint(0.6)} label="50–70%" />
              <LegendSwatch color={effTint(0.78)} label="70–85%" />
              <LegendSwatch color={effTint(0.95)} label="85%+" />
            </div>
          </section>

          {/* Day-by-day trend */}
          <section className="mb-4">
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-black/70">
              Day-by-day trend
            </h2>
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b-2 border-black text-left">
                  <Th>Date</Th>
                  <Th align="right">Looms run</Th>
                  <Th align="right">Meters</Th>
                  <Th align="right">Revenue</Th>
                  <Th align="right">Efficiency</Th>
                </tr>
              </thead>
              <tbody>
                {dayStats.map((d) => (
                  <tr key={d.date} className="border-b border-black/15">
                    <Td>{shortDay(d.date)}</Td>
                    <Td align="right">{d.looms || "—"}</Td>
                    <Td align="right">{d.meters > 0 ? fmtMeters(d.meters) : "—"}</Td>
                    <Td align="right">{d.revenue > 0 ? fmtRupees(d.revenue) : "—"}</Td>
                    <Td align="right">{d.target > 0 ? pct(d.meters / d.target) : "—"}</Td>
                  </tr>
                ))}
                {dayStats.length === 0 && (
                  <tr>
                    <Td>No production recorded this month.</Td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <footer className="mt-6 border-t border-black/20 pt-2 text-[10px] text-black/50">
            {FIRM_NAME} · Confidential — for internal use only.
          </footer>
        </div>
      )}

      {/* Print styles: A4, hide the action bar, keep table colours crisp. */}
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm; }
          .no-print { display: none !important; }
          .report { max-width: none !important; padding: 0 !important; }
          html, body { background: #fff !important; }
          table { page-break-inside: auto; }
          tr { page-break-inside: avoid; page-break-after: auto; }
          thead { display: table-header-group; }
          section { page-break-inside: avoid; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] text-black/55">{label}</span>
      <span className="text-[15px] font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th className={`py-1.5 pr-2 font-bold ${align === "right" ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}

function Td({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <td className={`py-1.5 pr-2 tabular-nums ${align === "right" ? "text-right" : "text-left"}`}>
      {children}
    </td>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block h-3 w-3 rounded-[2px]" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
