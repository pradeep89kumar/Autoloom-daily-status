import { useEffect, useMemo, useState } from "react";
import { fetchMasterRange, type MasterRangeRow } from "../../lib/sheetSync";
import { fmtMeters, fmtPercent, fmtRupees, shortDateLong } from "../../lib/partnerCopy";

type Metric = "efficiency" | "meters" | "revenue";

const DAYS = 14;
const LOOMS = ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"];

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
  effTimesM: number;
}

function buildGrid(rows: MasterRangeRow[]): Map<string, Cell> {
  const grid = new Map<string, Cell>();
  for (const r of rows) {
    const key = `${r.loom}|${r.date}`;
    const cur = grid.get(key) || { meters: 0, revenue: 0, effTimesM: 0 };
    cur.meters += r.meters;
    cur.revenue += r.revenue;
    cur.effTimesM += r.efficiency * r.meters;
    grid.set(key, cur);
  }
  return grid;
}

function metricValue(c: Cell | undefined, m: Metric): number | null {
  if (!c || c.meters === 0) {
    if (m === "meters") return c?.meters ?? null;
    if (m === "revenue") return c?.revenue ?? null;
    return null;
  }
  if (m === "meters") return c.meters;
  if (m === "revenue") return c.revenue;
  return c.effTimesM / c.meters;
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

  const dates = useMemo(() => lastNDates(DAYS), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const from = ymd(dates[0]);
    const to = ymd(dates[dates.length - 1]);
    fetchMasterRange(from, to).then((r) => {
      if (!alive) return;
      setRows(r);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [dates]);

  const grid = useMemo(() => buildGrid(rows || []), [rows]);

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
    const out = new Map<string, { meters: number; revenue: number; effTimesM: number }>();
    for (const loom of LOOMS) out.set(loom, { meters: 0, revenue: 0, effTimesM: 0 });
    for (const r of rows || []) {
      const cur = out.get(r.loom);
      if (!cur) continue;
      cur.meters += r.meters;
      cur.revenue += r.revenue;
      cur.effTimesM += r.efficiency * r.meters;
    }
    return out;
  }, [rows]);

  return (
    <div className="px-4 py-4">
      <div className="mb-4">
        <h2 className="text-[18px] font-bold mb-1 text-[var(--color-text-primary)]">Last {DAYS} days</h2>
        <p className="text-[14px] text-[var(--color-text-secondary)]">
          {shortDateLong(dates[0])} — {shortDateLong(dates[dates.length - 1])}
        </p>
      </div>

      {/* Metric toggle */}
      <div className="grid grid-cols-3 gap-1 p-1 bg-black/[0.04] rounded-lg mb-5 text-[14px]">
        <SegBtn active={metric === "efficiency"} onClick={() => setMetric("efficiency")} label="Efficiency" />
        <SegBtn active={metric === "meters"} onClick={() => setMetric("meters")} label="Metres" />
        <SegBtn active={metric === "revenue"} onClick={() => setMetric("revenue")} label="Revenue" />
      </div>

      {/* Heatmap */}
      <div className="mb-6">
        <div className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] mb-2">Daily heatmap</div>
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
                          ? "No data"
                          : metric === "efficiency"
                            ? fmtPercent(v)
                            : metric === "meters"
                              ? fmtMeters(v)
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
          {metric === "efficiency" ? (
            <>
              <Legend tint="bg-[var(--color-status-red)]/15" label="<50%" />
              <Legend tint="bg-[var(--color-status-amber)]/15" label="50–70" />
              <Legend tint="bg-[var(--color-status-green)]/15" label="70–85" />
              <Legend tint="bg-[var(--color-status-green)]/30" label="85+" />
            </>
          ) : (
            <>
              <Legend tint="bg-[var(--color-text-primary)]/[0.06]" label="lower" />
              <Legend tint="bg-[var(--color-text-primary)]/[0.36]" label="higher" />
            </>
          )}
        </div>
      </div>

      {/* Per-loom totals */}
      <div>
        <div className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] mb-2">Loom totals</div>
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
              const eff = t && t.meters > 0 ? t.effTimesM / t.meters : 0;
              const value =
                metric === "meters"
                  ? fmtMeters(t?.meters ?? 0)
                  : metric === "revenue"
                    ? fmtRupees(t?.revenue ?? 0)
                    : fmtPercent(eff);
              return (
                <li key={loom} className="py-3 flex items-center gap-3">
                  <span className="w-10 text-[16px] font-bold tabular-nums">{loom}</span>
                  <span className="flex-1 text-[14px] text-[var(--color-text-secondary)] tabular-nums">
                    {fmtMeters(t?.meters ?? 0)} · {fmtRupees(t?.revenue ?? 0)}
                  </span>
                  <span className="text-[18px] font-bold tabular-nums text-[var(--color-text-primary)]">{value}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
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
