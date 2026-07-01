import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, Printer, CircleNotch } from "@phosphor-icons/react";
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

function shortDay(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", weekday: "short" });
}

function pct(frac: number): string {
  if (!isFinite(frac)) return "—";
  return `${Math.round(frac * 100)}%`;
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

  const monthStart = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }, []);
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const generatedAt = useMemo(
    () => new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
    [],
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchMasterRange(ymd(monthStart), ymd(today)).then((r) => {
      if (!alive) return;
      const filtered = r.filter((row) => !(isNewLoom(row.loom) && row.date < NEW_LOOM_START));
      setRows(filtered);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [monthStart, today]);

  // Month-to-date fleet summary — mirrors the Trend screen's target tracker.
  const summary = useMemo(() => {
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
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
    return {
      daysInMonth,
      daysElapsed,
      revenue,
      meters,
      paceFraction,
      avgPerDay,
      projected,
      gap,
      targetFraction: MONTHLY_TARGET > 0 ? revenue / MONTHLY_TARGET : 0,
    };
  }, [rows, today]);

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

      {loading ? (
        <div className="flex items-center justify-center py-24 text-black/50">
          <CircleNotch className="h-6 w-6 animate-spin" weight="bold" />
        </div>
      ) : (
        <div className="report mx-auto max-w-[794px] px-6 py-6">
          {/* Header */}
          <header className="mb-5 border-b-2 border-black pb-3">
            <h1 className="text-[22px] font-bold leading-tight">{FIRM_NAME}</h1>
            <p className="text-[14px] font-semibold text-black/80">Monthly Production Report</p>
            <p className="mt-1 text-[12px] text-black/60">
              Period: {longDate(monthStart)} — {longDate(today)} · Generated {generatedAt}
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
              <Kpi label="Pace vs target" value={pct(summary.paceFraction)} />
              <Kpi label="Projected month-end" value={fmtRupees(summary.projected)} />
              <Kpi
                label={summary.gap > 0 ? "Projected shortfall" : "Projected surplus"}
                value={fmtRupees(Math.abs(summary.gap))}
              />
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
