import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ChevronRight, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { fetchCashflow, type CashflowData } from "../../lib/sheetSync";

function fmtINR(n: number): string {
  if (!isFinite(n)) return "—";
  const abs = Math.abs(Math.round(n));
  const sign = n < 0 ? "−" : "";
  return `${sign}₹${abs.toLocaleString("en-IN")}`;
}

function daysSince(iso: string): number {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - d.getTime()) / 86400000);
}

function formatAsOf(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function timeAgo(iso: string): string {
  const days = daysSince(iso);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function PartnerCash() {
  const [data, setData] = useState<CashflowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [opExpanded, setOpExpanded] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const startedAt = Date.now();
    fetchCashflow().then((d) => {
      if (!alive) return;
      const elapsed = Date.now() - startedAt;
      const wait = Math.max(0, 400 - elapsed);
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

  const stale = data && daysSince(data.lastEntryDate) > 2;

  return (
    <div className="px-4 py-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">Cash position</h2>
        {data && (
          <span className="text-[12px] text-[var(--color-text-secondary)]">
            As of {formatAsOf(data.asOfDate)} · {timeAgo(data.lastEntryDate)}
          </span>
        )}
      </div>

      {loading && <CashSkeleton />}

      {!loading && !data && (
        <div className="rounded-xl bg-white border border-[var(--color-border-hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.06)] px-4 py-6 text-center">
          <p className="text-[14px] text-[var(--color-text-secondary)]">
            Cashflow data unavailable.
          </p>
        </div>
      )}

      {!loading && data && (
        <>
          {stale && (
            <div className="mb-3 rounded-lg border border-[var(--color-status-amber)]/40 bg-[var(--color-status-amber)]/10 px-3 py-2 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 text-[var(--color-status-amber)] shrink-0" strokeWidth={1.75} />
              <p className="text-[13px] text-[var(--color-text-primary)]">
                Sheet not updated for {daysSince(data.lastEntryDate)} days.
              </p>
            </div>
          )}

          {/* Hero — total available */}
          <div className="rounded-xl bg-white border border-[var(--color-border-hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.06)] px-4 py-5 mb-3">
            <p className="text-[12px] uppercase tracking-wide text-[var(--color-text-secondary)] mb-1">
              Total available
            </p>
            <p className="text-[32px] font-semibold text-[var(--color-text-primary)] tabular-nums leading-tight">
              {fmtINR(data.totalAvailable)}
            </p>
            <p className="text-[12px] text-[var(--color-text-secondary)] mt-1">
              Across all accounts incl. CC headroom
            </p>
          </div>

          {/* Breakup */}
          <div className="rounded-xl bg-white border border-[var(--color-border-hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.06)] px-4 py-3 mb-3">
            <p className="text-[12px] uppercase tracking-wide text-[var(--color-text-secondary)] mb-2">
              Breakup
            </p>
            <BalanceRow label="TMB" value={data.balances.tmb} />
            <BalanceRow label="IOB Current" value={data.balances.iobCa} />
            <BalanceRow label="Cashbook App" value={data.balances.cashbookApp} />
            <BalanceRow label="Cash" value={data.balances.cash} />
            <div className="border-t border-[var(--color-border-hairline)] my-2" />
            <BalanceRow
              label="IOB CC available"
              value={data.balances.iobCcAvailable}
              sub={`Limit ${fmtINR(data.balances.iobCcLimit)} · Used ${fmtINR(data.balances.iobCcUsed)}`}
            />
          </div>

          {/* This month */}
          <div className="rounded-xl bg-white border border-[var(--color-border-hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.06)] px-4 py-3 mb-3">
            <p className="text-[12px] uppercase tracking-wide text-[var(--color-text-secondary)] mb-2">
              This month · {data.monthLabel}
            </p>

            <button
              onClick={() => setOpExpanded((v) => !v)}
              className="w-full flex items-center justify-between py-2 text-left"
            >
              <span className="text-[14px] text-[var(--color-text-primary)]">Op. cashflow (net)</span>
              <span className="flex items-center gap-1.5">
                <span
                  className={`text-[14px] font-medium tabular-nums ${
                    data.month.opCashflowNet < 0
                      ? "text-[var(--color-status-red)]"
                      : "text-[var(--color-text-primary)]"
                  }`}
                >
                  {fmtINR(data.month.opCashflowNet)}
                </span>
                {opExpanded ? (
                  <ChevronUp className="w-4 h-4 text-[var(--color-text-secondary)]" strokeWidth={1.75} />
                ) : (
                  <ChevronDown className="w-4 h-4 text-[var(--color-text-secondary)]" strokeWidth={1.75} />
                )}
              </span>
            </button>
            {opExpanded && (
              <div className="pl-1 pb-1 text-[12px] text-[var(--color-text-secondary)] tabular-nums">
                Inflow {fmtINR(data.month.opInflow)} · Outflow {fmtINR(data.month.opOutflow)}
              </div>
            )}

            <div className="flex items-center justify-between py-2 border-t border-[var(--color-border-hairline)]">
              <span className="text-[14px] text-[var(--color-text-primary)]">CC drawn this month</span>
              <span className="text-[14px] font-medium tabular-nums text-[var(--color-text-primary)]">
                {fmtINR(data.month.ccDrawnThisMonth)}
              </span>
            </div>
          </div>

          <Link
            to="/partner/cash/statement"
            className="flex items-center justify-between rounded-xl bg-white border border-[var(--color-border-hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.06)] px-4 py-3 active:bg-black/[0.02]"
          >
            <span className="text-[14px] font-medium text-[var(--color-text-primary)]">View statement</span>
            <ChevronRight className="w-4 h-4 text-[var(--color-text-secondary)]" strokeWidth={1.75} />
          </Link>
        </>
      )}
    </div>
  );
}

function BalanceRow({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="flex items-start justify-between py-1.5">
      <div className="min-w-0">
        <p className="text-[14px] text-[var(--color-text-primary)] truncate">{label}</p>
        {sub && <p className="text-[11px] text-[var(--color-text-secondary)] mt-0.5">{sub}</p>}
      </div>
      <span className="text-[14px] font-medium tabular-nums text-[var(--color-text-primary)]">
        {fmtINR(value)}
      </span>
    </div>
  );
}

function CashSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="rounded-xl bg-white border border-[var(--color-border-hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.06)] px-4 py-5 mb-3">
        <div className="h-3 w-24 bg-black/[0.06] rounded mb-3" />
        <div className="h-8 w-48 bg-black/[0.08] rounded mb-2" />
        <div className="h-3 w-40 bg-black/[0.06] rounded" />
      </div>
      <div className="rounded-xl bg-white border border-[var(--color-border-hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.06)] px-4 py-3 mb-3 space-y-3">
        <div className="h-3 w-20 bg-black/[0.06] rounded" />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex justify-between">
            <div className="h-3 w-32 bg-black/[0.06] rounded" />
            <div className="h-3 w-20 bg-black/[0.06] rounded" />
          </div>
        ))}
      </div>
      <div className="rounded-xl bg-white border border-[var(--color-border-hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.06)] px-4 py-3 space-y-3">
        <div className="h-3 w-28 bg-black/[0.06] rounded" />
        <div className="flex justify-between">
          <div className="h-3 w-36 bg-black/[0.06] rounded" />
          <div className="h-3 w-20 bg-black/[0.06] rounded" />
        </div>
        <div className="flex justify-between">
          <div className="h-3 w-40 bg-black/[0.06] rounded" />
          <div className="h-3 w-20 bg-black/[0.06] rounded" />
        </div>
      </div>
    </div>
  );
}
