import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, CircleNotch } from "@phosphor-icons/react";
import { fetchCapex, type CapexData, type CapexRow } from "../../lib/sheetSync";

function fmtINR(n: number): string {
  if (!isFinite(n)) return "—";
  const abs = Math.abs(Math.round(n));
  const sign = n < 0 ? "−" : "";
  return `${sign}₹${abs.toLocaleString("en-IN")}`;
}

function formatDateHeader(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", weekday: "short" });
}

function groupByDate(rows: CapexRow[]): { date: string; rows: CapexRow[] }[] {
  const map = new Map<string, CapexRow[]>();
  for (const r of rows) {
    if (!map.has(r.date)) map.set(r.date, []);
    map.get(r.date)!.push(r);
  }
  return Array.from(map.entries()).map(([date, rows]) => ({ date, rows }));
}

function sortedBreakup(obj: Record<string, number>): { label: string; amount: number }[] {
  return Object.entries(obj)
    .map(([label, amount]) => ({ label, amount }))
    .sort((a, b) => b.amount - a.amount);
}

export function PartnerNewShedExpenses() {
  const navigate = useNavigate();
  const [data, setData] = useState<CapexData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const startedAt = Date.now();
    fetchCapex("6 Looms").then((d) => {
      if (!alive) return;
      const elapsed = Date.now() - startedAt;
      const wait = Math.max(0, 300 - elapsed);
      setTimeout(() => {
        if (!alive) return;
        setData(d);
        setLoading(false);
      }, wait);
    });
    return () => {
      alive = false;
    };
  }, []);

  const grouped = data ? groupByDate(data.rows) : [];
  const byFunding = data ? sortedBreakup(data.byFunding) : [];
  const byExpense = data ? sortedBreakup(data.byExpense) : [];

  return (
    <div className="h-[100dvh] bg-white flex flex-col max-w-md mx-auto border-x border-[var(--color-border-hairline)]">
      <header className="h-14 bg-white border-b border-[var(--color-border-hairline)] flex items-center px-4 shrink-0">
        <button
          onClick={() => navigate(-1)}
          className="p-2 -ml-2 mr-2 text-[var(--color-text-primary)]"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" weight="bold" />
        </button>
        <div className="flex flex-col">
          <h1 className="text-base font-semibold leading-tight">New Shed Expenses</h1>
          <span className="text-[11px] text-[var(--color-text-secondary)] leading-tight">6 looms project</span>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto relative">
        {loading && data === null && <ExpensesSkeleton />}

        {!loading && data === null && (
          <div className="px-4 py-10 text-center">
            <p className="text-[14px] text-[var(--color-text-secondary)]">Capex data unavailable.</p>
          </div>
        )}

        {data && (
          <>
            {/* Total */}
            <div className="px-4 pt-4 pb-3">
              <div className="rounded-xl bg-white border border-[var(--color-border-hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.06)] px-4 py-5">
                <p className="text-[12px] uppercase tracking-wide text-[var(--color-text-secondary)] mb-1">
                  Total spent · 6 looms project
                </p>
                <p className="text-[32px] font-semibold text-[var(--color-text-primary)] tabular-nums leading-tight">
                  {fmtINR(data.total)}
                </p>
                <p className="text-[12px] text-[var(--color-text-secondary)] mt-1">
                  {data.count} {data.count === 1 ? "entry" : "entries"}
                </p>
              </div>
            </div>

            {/* Breakup — by Funding Source */}
            {byFunding.length > 0 && (
              <div className="px-4 pb-3">
                <div className="rounded-xl bg-white border border-[var(--color-border-hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.06)] px-4 py-3">
                  <p className="text-[12px] uppercase tracking-wide text-[var(--color-text-secondary)] mb-2">
                    By Funding Source
                  </p>
                  {byFunding.map((b) => (
                    <BreakupRow key={b.label} label={b.label} amount={b.amount} total={data.total} />
                  ))}
                </div>
              </div>
            )}

            {/* Breakup — by Expense */}
            {byExpense.length > 0 && (
              <div className="px-4 pb-3">
                <div className="rounded-xl bg-white border border-[var(--color-border-hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.06)] px-4 py-3">
                  <p className="text-[12px] uppercase tracking-wide text-[var(--color-text-secondary)] mb-2">
                    By Expense
                  </p>
                  {byExpense.map((b) => (
                    <BreakupRow key={b.label} label={b.label} amount={b.amount} total={data.total} />
                  ))}
                </div>
              </div>
            )}

            {/* Entries */}
            {grouped.length > 0 && (
              <div className="pt-2 pb-6">
                <p className="px-4 pb-2 text-[12px] uppercase tracking-wide text-[var(--color-text-secondary)]">
                  Entries
                </p>
                {grouped.map((g) => (
                  <div key={g.date}>
                    <div className="sticky top-0 z-[1] bg-[var(--color-bg-canvas,#fafafa)] px-4 py-1.5 text-[11px] uppercase tracking-wide text-[var(--color-text-secondary)] border-y border-[var(--color-border-hairline)]">
                      {formatDateHeader(g.date)}
                    </div>
                    {g.rows.map((r, i) => (
                      <EntryRow key={`${g.date}-${i}`} row={r} />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {loading && data !== null && (
          <div className="absolute inset-0 bg-white/60 flex items-start justify-center pt-10 z-10">
            <CircleNotch className="w-5 h-5 animate-spin text-[var(--color-text-secondary)]" weight="bold" />
          </div>
        )}
      </main>
    </div>
  );
}

function BreakupRow({ label, amount, total }: { label: string; amount: number; total: number }) {
  const pct = total > 0 ? Math.round((amount / total) * 100) : 0;
  return (
    <div className="flex items-start justify-between py-1.5">
      <div className="min-w-0">
        <p className="text-[14px] text-[var(--color-text-primary)] truncate">{label}</p>
        <p className="text-[11px] text-[var(--color-text-secondary)] mt-0.5">{pct}%</p>
      </div>
      <span className="text-[14px] font-medium tabular-nums text-[var(--color-text-primary)]">
        {fmtINR(amount)}
      </span>
    </div>
  );
}

function EntryRow({ row }: { row: CapexRow }) {
  const subParts = [
    row.vendor,
    row.paidFrom ? `Paid · ${row.paidFrom}` : "",
    row.fundingSource ? `Source · ${row.fundingSource}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="px-4 py-2.5 border-b border-[var(--color-border-hairline)] flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] text-[var(--color-text-primary)] truncate">{row.expense || "—"}</p>
        {subParts && (
          <p className="text-[11px] text-[var(--color-text-secondary)] mt-0.5 truncate">{subParts}</p>
        )}
      </div>
      <span className="text-[14px] font-medium tabular-nums shrink-0 text-[var(--color-status-red)]">
        −{fmtINR(row.amount)}
      </span>
    </div>
  );
}

function ExpensesSkeleton() {
  return (
    <div className="animate-pulse px-4 pt-4">
      <div className="rounded-xl bg-white border border-[var(--color-border-hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.06)] px-4 py-5 mb-3">
        <div className="h-3 w-32 bg-black/[0.06] rounded mb-3" />
        <div className="h-8 w-48 bg-black/[0.08] rounded mb-2" />
        <div className="h-3 w-24 bg-black/[0.06] rounded" />
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="rounded-xl bg-white border border-[var(--color-border-hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.06)] px-4 py-3 mb-3 space-y-3">
          <div className="h-3 w-28 bg-black/[0.06] rounded" />
          {[0, 1, 2].map((j) => (
            <div key={j} className="flex justify-between">
              <div className="h-3 w-32 bg-black/[0.06] rounded" />
              <div className="h-3 w-20 bg-black/[0.06] rounded" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
