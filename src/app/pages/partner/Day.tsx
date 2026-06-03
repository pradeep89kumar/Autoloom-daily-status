import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from "lucide-react";
import { fetchMasterDay, type MasterRow } from "../../lib/sheetSync";
import {
  summarizeDay,
  perLoomTotals,
  fmtMeters,
  fmtRupees,
  fmtPercent,
  dayBrief,
  shortDateLong,
  efficiencyBand,
  endStateMeta,
  type LoomDayTotal,
  type StateTone,
} from "../../lib/partnerCopy";

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function fromYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dateLabel(d: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86400000);
  if (diffDays === 0) return "இன்று";
  if (diffDays === 1) return "நேற்று";
  return shortDateLong(d);
}

export function PartnerDay() {
  // Default to yesterday — the most recent fully closed day.
  const [date, setDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d;
  });
  const [rows, setRows] = useState<MasterRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setExpanded(null);
    const startedAt = Date.now();
    fetchMasterDay(ymd(date)).then((r) => {
      if (!alive) return;
      const elapsed = Date.now() - startedAt;
      const wait = Math.max(0, 400 - elapsed);
      setTimeout(() => {
        if (!alive) return;
        setRows(r);
        setLoading(false);
      }, wait);
    });
    return () => {
      alive = false;
    };
  }, [date]);

  const summary = useMemo(() => summarizeDay(rows || []), [rows]);
  const looms = useMemo(() => perLoomTotals(rows || []), [rows]);

  const isToday = ymd(date) === ymd(new Date());
  const inProgress = isToday;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isFuture = date.getTime() > today.getTime();

  function step(days: number) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    next.setHours(0, 0, 0, 0);
    if (next.getTime() > today.getTime()) return;
    setDate(next);
  }

  return (
    <div className="px-4 py-4">
      {/* Day stepper */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => step(-1)}
          className="p-2 -ml-2 text-[var(--color-text-primary)]"
          aria-label="Previous day"
        >
          <ChevronLeft className="w-5 h-5" strokeWidth={1.5} />
        </button>
        <label className="relative inline-flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-black/[0.03] cursor-pointer">
          <span className="text-[14px] text-[var(--color-text-secondary)] leading-none">
            {dateLabel(date)}
          </span>
          <span className="text-[16px] font-semibold text-[var(--color-text-primary)] tabular-nums leading-none">
            {shortDateLong(date)}
          </span>
          <ChevronDown className="w-4 h-4 text-[var(--color-text-secondary)]" strokeWidth={1.75} />
          <input
            type="date"
            value={ymd(date)}
            max={ymd(today)}
            onChange={(e) => {
              if (e.target.value) setDate(fromYmd(e.target.value));
            }}
            className="absolute inset-0 opacity-0 cursor-pointer"
            aria-label="Pick date"
          />
        </label>
        <button
          onClick={() => step(1)}
          disabled={isToday || isFuture}
          className="p-2 -mr-2 text-[var(--color-text-primary)] disabled:opacity-30"
          aria-label="Next day"
        >
          <ChevronRight className="w-5 h-5" strokeWidth={1.5} />
        </button>
      </div>

      {/* Header brief */}
      {loading ? (
        <SkeletonHeader />
      ) : (
        <>
          <div className="rounded-xl bg-white border border-[var(--color-border-hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.06)] px-4 py-3.5 mb-5">
            <p className="text-[16px] leading-relaxed text-[var(--color-text-primary)]">
              {dayBrief(date, summary, inProgress)}
            </p>
          </div>

          {summary.shiftsLogged > 0 && (
            <div className="grid grid-cols-3 gap-3 mb-6 pb-5 border-b border-[var(--color-border-hairline)]">
              <Stat label="Revenue" value={fmtRupees(summary.revenue)} primary />
              <Stat label="mtr" value={fmtMeters(summary.meters)} subtle />
              <Stat
                label="Performance"
                value={fmtPercent(summary.weightedEfficiency)}
                sub={`${summary.loomsReporting} of ${summary.loomsTotal} looms`}
              />
            </div>
          )}
        </>
      )}

      {/* Per-loom rows */}
      {loading ? (
        <SkeletonRows />
      ) : looms.length === 0 ? (
        <EmptyState date={date} inProgress={inProgress} />
      ) : (
        <>
          {summary.loomsReporting < summary.loomsTotal && (
            <PartialBanner
              missing={summary.loomsTotal - summary.loomsReporting}
              total={summary.loomsTotal}
              inProgress={inProgress}
            />
          )}
          <ul className="divide-y divide-[var(--color-border-hairline)]">
            {looms.map((l) => (
              <LoomRow
                key={l.loom}
                data={l}
                open={expanded === l.loom}
                onToggle={() => setExpanded(expanded === l.loom ? null : l.loom)}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function StatusPill({ label, tone }: { label: string; tone: StateTone }) {
  const styles: Record<StateTone, { bg: string; fg: string }> = {
    runout:   { bg: "color-mix(in srgb, var(--color-status-amber) 12%, white)", fg: "var(--color-status-amber)" },
    powercut: { bg: "color-mix(in srgb, var(--color-status-amber) 12%, white)", fg: "var(--color-status-amber)" },
    stopped:  { bg: "color-mix(in srgb, var(--color-status-red) 10%, white)",   fg: "var(--color-status-red)" },
    knotting: { bg: "var(--color-bg-subtle, #F3F4F6)",                          fg: "var(--color-text-secondary)" },
  };
  const s = styles[tone];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-semibold"
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      {label}
    </span>
  );
}

function Stat({ label, value, sub, primary, subtle }: { label: string; value: string; sub?: string; primary?: boolean; subtle?: boolean }) {
  const valueCls = primary
    ? "text-[22px] font-bold tabular-nums text-[var(--color-text-primary)]"
    : subtle
      ? "text-[16px] font-semibold tabular-nums text-[var(--color-text-secondary)]"
      : "text-[18px] font-semibold tabular-nums text-[var(--color-text-primary)]";
  return (
    <div>
      <div className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] mb-1">{label}</div>
      <div className={valueCls}>{value}</div>
      {sub && <div className="text-[14px] text-[var(--color-text-secondary)] mt-0.5">{sub}</div>}
    </div>
  );
}

function RevenueValue({ value }: { value: number }) {
  if (value > 0 && value < 2000) {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[18px] font-bold tabular-nums bg-[color-mix(in_srgb,var(--color-status-red)_12%,white)] text-[var(--color-status-red)] animate-pulse">
        {fmtRupees(value)}
      </span>
    );
  }
  if (value > 0 && value < 3000) {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[18px] font-bold tabular-nums bg-[color-mix(in_srgb,var(--color-status-amber)_12%,white)] text-[var(--color-status-amber)]">
        {fmtRupees(value)}
      </span>
    );
  }
  return (
    <span className="text-[18px] font-bold tabular-nums text-[var(--color-text-primary)]">
      {fmtRupees(value)}
    </span>
  );
}

function bandClass(eff: number): string {
  const b = efficiencyBand(eff);
  if (b === "high") return "text-[var(--color-status-green)]";
  if (b === "good") return "text-[var(--color-text-primary)]";
  if (b === "fair") return "text-[var(--color-status-amber)]";
  return "text-[var(--color-status-red)]";
}

function LoomRow({
  data,
  open,
  onToggle,
}: {
  data: LoomDayTotal;
  open: boolean;
  onToggle: () => void;
}) {
  const meta = endStateMeta(data.endState);

  // Show order tag(s) on the row itself. If A and B carry different orders,
  // show both joined by " · "; otherwise show the single tag.
  const tags = Array.from(
    new Set(
      data.rows
        .map((r) => r.orderTag.trim())
        .filter((t) => t.length > 0),
    ),
  );
  const orderLine = tags.join(" · ");

  return (
    <li>
      <button
        onClick={onToggle}
        className="w-full py-4 flex items-center gap-3 text-left"
      >
        <div className="w-10 shrink-0">
          <div className="text-[18px] font-bold tabular-nums">{data.loom}</div>
        </div>
        <div className="flex-1 min-w-0">
          {orderLine && (
            <div className="text-[15px] text-[var(--color-text-primary)] font-medium truncate mb-0.5">
              {orderLine}
            </div>
          )}
          <div className="flex items-baseline gap-2">
            <RevenueValue value={data.revenue} />
            <span className="text-[14px] text-[var(--color-text-secondary)] tabular-nums">{fmtMeters(data.meters)}</span>
          </div>
          {meta && (
            <div className="mt-1.5">
              <StatusPill label={meta.label} tone={meta.tone} />
            </div>
          )}
        </div>
        <div className={`text-[18px] font-bold tabular-nums ${bandClass(data.weightedEfficiency)}`}>
          {fmtPercent(data.weightedEfficiency)}
        </div>
        <div className="text-[var(--color-text-secondary)]">
          {open ? <ChevronUp className="w-4 h-4" strokeWidth={1.5} /> : <ChevronDown className="w-4 h-4" strokeWidth={1.5} />}
        </div>
      </button>

      {open && <ShiftDrawer rows={data.rows} />}
    </li>
  );
}

function ShiftDrawer({ rows }: { rows: MasterRow[] }) {
  const a = rows.find((r) => r.shift === "A");
  const b = rows.find((r) => r.shift === "B");
  return (
    <div className="pb-4 -mt-1 grid grid-cols-2 gap-3">
      <ShiftCard letter="A" row={a} />
      <ShiftCard letter="B" row={b} />
    </div>
  );
}

function ShiftCard({ letter, row }: { letter: "A" | "B"; row: MasterRow | undefined }) {
  if (!row) {
    return (
      <div className="rounded-lg border border-[var(--color-border-hairline)] p-3">
        <div className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Shift {letter}</div>
        <div className="text-[14px] text-[var(--color-text-secondary)] mt-2">தரவு இல்லை</div>
      </div>
    );
  }
  const meta = endStateMeta(row.state);
  const perf = row.targetMeters > 0 ? row.meters / row.targetMeters : 0;
  return (
    <div className="rounded-lg border border-[var(--color-border-hairline)] p-3">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Shift {letter}</span>
        <span className={`text-[15px] font-bold tabular-nums ${bandClass(perf)}`}>
          {fmtPercent(perf)}
        </span>
      </div>
      <div className="text-[16px] font-semibold text-[var(--color-text-primary)] mb-1 truncate">{row.weaver || "—"}</div>
      <div className="text-[14px] text-[var(--color-text-secondary)] mb-2 truncate">{row.orderTag || "—"}</div>
      <dl className="space-y-1 text-[14px]">
        <Item k="Revenue" v={fmtRupees(row.revenue)} primary />
        <Item k="mtr" v={fmtMeters(row.meters)} subtle />
        <Item k="RPM" v={row.rpm ? row.rpm.toFixed(0) : "—"} />
        <Item k="Achieved pick" v={row.achievedPick ? row.achievedPick.toFixed(0) : "—"} />
      </dl>
      {meta && (
        <div className="mt-2">
          <StatusPill label={meta.label} tone={meta.tone} />
        </div>
      )}
    </div>
  );
}

function Item({ k, v, primary, subtle }: { k: string; v: string; primary?: boolean; subtle?: boolean }) {
  const vCls = primary
    ? "tabular-nums text-[var(--color-text-primary)] font-semibold"
    : subtle
      ? "tabular-nums text-[var(--color-text-secondary)]"
      : "tabular-nums text-[var(--color-text-primary)]";
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-[var(--color-text-secondary)]">{k}</dt>
      <dd className={vCls}>{v}</dd>
    </div>
  );
}

function PartialBanner({ missing, total, inProgress }: { missing: number; total: number; inProgress: boolean }) {
  const reported = total - missing;
  const bg = inProgress
    ? "bg-[color-mix(in_srgb,var(--color-status-amber)_10%,white)] border-[color-mix(in_srgb,var(--color-status-amber)_30%,transparent)]"
    : "bg-[color-mix(in_srgb,var(--color-status-red)_10%,white)] border-[color-mix(in_srgb,var(--color-status-red)_30%,transparent)]";
  const fg = inProgress ? "text-[var(--color-status-amber)]" : "text-[var(--color-status-red)]";
  const dot = inProgress ? "bg-[var(--color-status-amber)]" : "bg-[var(--color-status-red)]";
  return (
    <div className={`mb-3 rounded-lg border ${bg} px-3.5 py-2.5 flex items-start gap-2.5`}>
      <span className={`mt-1.5 inline-block w-1.5 h-1.5 rounded-full ${dot} animate-pulse shrink-0`} />
      <div className="flex-1 min-w-0">
        <p className={`text-[12px] font-semibold ${fg} uppercase tracking-wide`}>
          {inProgress ? "பதிவு நிலுவையில்" : "பதிவு முழுமையடையவில்லை"}
        </p>
        <p className="text-[14px] text-[var(--color-text-primary)] mt-0.5 leading-snug">
          {reported}/{total} தறிகள் பதிவாகியுள்ளன · {missing} இன்னும் {inProgress ? "எதிர்பார்க்கப்படுகிறது" : "பதிவாகவில்லை"}.
        </p>
      </div>
    </div>
  );
}

function EmptyState({ date, inProgress }: { date: Date; inProgress: boolean }) {
  return (
    <div className="pt-10 pb-6 flex flex-col items-center text-center">
      <img
        src="/icon-512.png"
        alt=""
        aria-hidden
        className="w-20 h-20 rounded-2xl opacity-30 grayscale mb-5 select-none"
        draggable={false}
      />
      {inProgress ? (
        <>
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--color-status-amber)] mb-2">
            பதிவு நிலுவையில்
          </p>
          <h3 className="text-[18px] font-semibold text-[var(--color-text-primary)] mb-1.5">
            இன்னும் பதிவுகள் வரவில்லை
          </h3>
          <p className="text-[14px] leading-relaxed text-[var(--color-text-secondary)] max-w-[18rem]">
            Shift A &amp; B முடிந்த பின் ஒவ்வொரு தறியின் பதிவு இங்கு தோன்றும்.
          </p>
        </>
      ) : (
        <>
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--color-status-red)] mb-2">
            பதிவு இல்லை
          </p>
          <h3 className="text-[18px] font-semibold text-[var(--color-text-primary)] mb-1.5">
            இந்த நாளுக்கான பதிவுகள் இல்லை
          </h3>
          <p className="text-[14px] leading-relaxed text-[var(--color-text-secondary)] max-w-[18rem]">
            {shortDateLong(date)} — சூப்பர்வைசர் இன்னும் பதிவு செய்யவில்லை.
          </p>
        </>
      )}
    </div>
  );
}

function SkeletonHeader() {
  return (
    <div className="animate-pulse">
      <div className="h-4 bg-black/5 rounded w-3/4 mb-2" />
      <div className="h-4 bg-black/5 rounded w-1/2 mb-6" />
      <div className="grid grid-cols-3 gap-3 mb-6 pb-5 border-b border-[var(--color-border-hairline)]">
        <div className="h-12 bg-black/5 rounded" />
        <div className="h-12 bg-black/5 rounded" />
        <div className="h-12 bg-black/5 rounded" />
      </div>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="animate-pulse divide-y divide-[var(--color-border-hairline)]">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="py-4 h-12 flex items-center">
          <div className="h-4 w-full bg-black/5 rounded" />
        </div>
      ))}
    </div>
  );
}
