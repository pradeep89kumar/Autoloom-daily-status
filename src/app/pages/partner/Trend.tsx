import { useEffect, useMemo, useState } from "react";
import { fetchMasterRange, type MasterRangeRow } from "../../lib/sheetSync";
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
    if (m === "meters") return c?.meters ?? null;
    if (m === "revenue") return c?.revenue ?? null;
    return null;
  }
  if (m === "meters") return c.meters;
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

  const dates = useMemo(() => lastNDates(DAYS), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const from = ymd(dates[0]);
    const to = ymd(dates[dates.length - 1]);
    const startedAt = Date.now();
    fetchMasterRange(from, to).then((r) => {
      if (!alive) return;
      const wait = Math.max(0, 400 - (Date.now() - startedAt));
      setTimeout(() => {
        if (!alive) return;
        setRows(r);
        setLoading(false);
      }, wait);
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
      <div className="grid grid-cols-3 gap-1 p-1 bg-black/[0.04] rounded-lg mb-5 text-[14px]">
        <SegBtn active={metric === "efficiency"} onClick={() => setMetric("efficiency")} label="Performance" />
        <SegBtn active={metric === "meters"} onClick={() => setMetric("meters")} label="mtr" />
        <SegBtn active={metric === "revenue"} onClick={() => setMetric("revenue")} label="வருமானம்" />
      </div>

      {/* Heatmap */}
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
              <Legend tint="bg-[var(--color-text-primary)]/[0.06]" label="குறைவு" />
              <Legend tint="bg-[var(--color-text-primary)]/[0.36]" label="அதிகம்" />
            </>
          )}
        </div>
      </div>

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
              const avgMeters = activeDays > 0 ? (t?.meters ?? 0) / activeDays : 0;
              return (
                <li key={loom} className="py-3 flex items-center gap-3">
                  <span className="w-10 text-[16px] font-bold tabular-nums">{loom}</span>
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
                    ) : metric === "revenue" ? (
                      <>
                        <span className="block text-[18px] font-bold tabular-nums text-[var(--color-text-primary)] leading-tight">
                          {fmtRupees(avgRevenue)}
                        </span>
                        <span className="block text-[11px] text-[var(--color-text-secondary)]">
                          / நாள் ({activeDays}d)
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="block text-[18px] font-bold tabular-nums text-[var(--color-text-primary)] leading-tight">
                          {fmtMeters(avgMeters)}
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
