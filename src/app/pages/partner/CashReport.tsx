import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, Printer, CircleNotch } from "@phosphor-icons/react";
import {
  fetchCashflow,
  fetchCashLedger,
  type CashflowData,
  type CashLedgerEntry,
} from "../../lib/sheetSync";

// Report constants — kept in step with the Cash screen so the PDF and the
// on-screen figures never disagree.
const FIRM_NAME = "Sri Aarumga Tex";

const ACCOUNT_LABEL: Record<string, string> = {
  tmb: "TMB",
  iobCa: "IOB CA",
  cashbookApp: "Cashbook App",
  cash: "Cash",
  iobCc: "IOB CC",
};
const ACCOUNT_ORDER = ["tmb", "iobCa", "cashbookApp", "cash", "iobCc"];

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

function dayHeader(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", weekday: "short" });
}

// Absolute rupee value for column cells (sign implied by the In/Out column).
function fmtINR(n: number): string {
  if (!isFinite(n)) return "—";
  return `₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;
}

// Signed rupee value for the net figures.
function fmtSignedINR(n: number): string {
  if (!isFinite(n)) return "—";
  const sign = n < 0 ? "−" : "";
  return `${sign}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;
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

interface AccountStat {
  account: string;
  in: number;
  out: number;
  net: number;
}

export function PartnerCashReport() {
  const navigate = useNavigate();
  const [ledger, setLedger] = useState<CashLedgerEntry[] | null>(null);
  const [cashflow, setCashflow] = useState<CashflowData | null>(null);
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
    return { start, end, periodEnd, complete };
  }, [monthKey, today]);

  const generatedAt = useMemo(
    () => new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
    [],
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      fetchCashLedger({ from: ymd(period.start), to: ymd(period.periodEnd) }),
      fetchCashflow(),
    ]).then(([rows, cf]) => {
      if (!alive) return;
      setLedger(rows);
      setCashflow(cf);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [period]);

  // Month totals — internal transfers are excluded from in/out/net, counted separately.
  const totals = useMemo(() => {
    let inflow = 0;
    let outflow = 0;
    let internal = 0;
    let count = 0;
    for (const e of ledger || []) {
      count++;
      if (e.internal) {
        internal += Math.abs(e.amount);
        continue;
      }
      if (e.amount > 0) inflow += e.amount;
      else outflow += e.amount;
    }
    return { inflow, outflow, net: inflow + outflow, internal, count };
  }, [ledger]);

  // Per-account movement for the month (internal transfers excluded).
  const accountStats = useMemo<AccountStat[]>(() => {
    const m = new Map<string, { in: number; out: number }>();
    for (const e of ledger || []) {
      if (e.internal) continue;
      const cur = m.get(e.account) || { in: 0, out: 0 };
      if (e.amount > 0) cur.in += e.amount;
      else cur.out += e.amount;
      m.set(e.account, cur);
    }
    return ACCOUNT_ORDER.filter((k) => m.has(k)).map((k) => {
      const v = m.get(k)!;
      return { account: k, in: v.in, out: v.out, net: v.in + v.out };
    });
  }, [ledger]);

  // Ledger grouped by date (chronological — a printed statement reads oldest-first).
  const groups = useMemo(() => {
    const sorted = [...(ledger || [])].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    );
    const map = new Map<string, CashLedgerEntry[]>();
    for (const e of sorted) {
      const list = map.get(e.date) || [];
      list.push(e);
      map.set(e.date, list);
    }
    return Array.from(map.entries()).map(([date, entries]) => ({ date, entries }));
  }, [ledger]);

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
              Monthly Cash Report · {monthTitle(period.start)}
            </p>
            <p className="mt-1 text-[12px] text-black/60">
              Period: {longDate(period.start)} — {longDate(period.periodEnd)}
              {period.complete ? "" : " (in progress)"} · Generated {generatedAt}
            </p>
          </header>

          {/* Month summary */}
          <section className="mb-6">
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-black/70">
              {monthTitle(period.start)} summary
            </h2>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              <Kpi label="Cash in" value={fmtINR(totals.inflow)} />
              <Kpi label="Cash out" value={fmtINR(totals.outflow)} />
              <Kpi label="Net movement" value={fmtSignedINR(totals.net)} />
              <Kpi label="Entries" value={String(totals.count)} />
            </div>
            {totals.internal > 0 && (
              <p className="mt-2 text-[11px] text-black/50">
                Excludes {fmtINR(totals.internal)} of internal transfers between own accounts.
              </p>
            )}
          </section>

          {/* Current cash position (live snapshot from the master sheet) */}
          {cashflow && (
            <section className="mb-6">
              <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-black/70">
                Current cash position
                <span className="ml-2 font-normal normal-case text-black/50">
                  live · as of {longDate(new Date(cashflow.asOfDate))}
                </span>
              </h2>
              <div className="mb-3 rounded-lg border border-black/15 px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-black/55">Total available</p>
                <p className="text-[24px] font-bold tabular-nums">
                  {fmtINR(cashflow.totalAvailable)}
                </p>
                <p className="text-[11px] text-black/50">All accounts, CC headroom included</p>
              </div>
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-black/20 text-black/60">
                    <Th>Account</Th>
                    <Th align="right">Balance</Th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-black/10">
                    <Td>TMB</Td>
                    <Td align="right">{fmtINR(cashflow.balances.tmb)}</Td>
                  </tr>
                  <tr className="border-b border-black/10">
                    <Td>IOB Current</Td>
                    <Td align="right">{fmtINR(cashflow.balances.iobCa)}</Td>
                  </tr>
                  <tr className="border-b border-black/10">
                    <Td>Cashbook App</Td>
                    <Td align="right">{fmtINR(cashflow.balances.cashbookApp)}</Td>
                  </tr>
                  <tr className="border-b border-black/10">
                    <Td>Cash</Td>
                    <Td align="right">{fmtINR(cashflow.balances.cash)}</Td>
                  </tr>
                  <tr className="border-b border-black/10">
                    <Td>
                      IOB CC available
                      <span className="ml-1 text-[10px] text-black/45">
                        (limit {fmtINR(cashflow.balances.iobCcLimit)} · used{" "}
                        {fmtINR(cashflow.balances.iobCcUsed)})
                      </span>
                    </Td>
                    <Td align="right">{fmtINR(cashflow.balances.iobCcAvailable)}</Td>
                  </tr>
                </tbody>
              </table>
            </section>
          )}

          {/* By account */}
          <section className="mb-6">
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-black/70">
              By account · {monthTitle(period.start)}
            </h2>
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-black/20 text-black/60">
                  <Th>Account</Th>
                  <Th align="right">In</Th>
                  <Th align="right">Out</Th>
                  <Th align="right">Net</Th>
                </tr>
              </thead>
              <tbody>
                {accountStats.map((a) => (
                  <tr key={a.account} className="border-b border-black/10">
                    <Td>{ACCOUNT_LABEL[a.account] || a.account}</Td>
                    <Td align="right">{a.in > 0 ? fmtINR(a.in) : "—"}</Td>
                    <Td align="right">{a.out < 0 ? fmtINR(a.out) : "—"}</Td>
                    <Td align="right">{fmtSignedINR(a.net)}</Td>
                  </tr>
                ))}
                {accountStats.length === 0 && (
                  <tr>
                    <Td>No cash movement recorded this month.</Td>
                  </tr>
                )}
              </tbody>
              {accountStats.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-black/40 font-semibold">
                    <Td>Total</Td>
                    <Td align="right">{fmtINR(totals.inflow)}</Td>
                    <Td align="right">{fmtINR(totals.outflow)}</Td>
                    <Td align="right">{fmtSignedINR(totals.net)}</Td>
                  </tr>
                </tfoot>
              )}
            </table>
          </section>

          {/* Statement */}
          <section className="mb-4">
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-black/70">
              Statement
            </h2>
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-black/20 text-black/60">
                  <Th>Particulars</Th>
                  <Th>Account</Th>
                  <Th align="right">In</Th>
                  <Th align="right">Out</Th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.date}>
                    <tr className="bg-black/[0.04]">
                      <td
                        colSpan={4}
                        className="py-1 pl-1 text-[11px] font-semibold uppercase tracking-wide text-black/60"
                      >
                        {dayHeader(g.date)}
                      </td>
                    </tr>
                    {g.entries.map((e, i) => (
                      <tr key={`${g.date}-${i}`} className="border-b border-black/10">
                        <Td>
                          <span className={e.internal ? "text-black/45" : ""}>
                            {e.description || "—"}
                            {e.internal ? " (internal)" : ""}
                          </span>
                        </Td>
                        <Td>{ACCOUNT_LABEL[e.account] || e.account}</Td>
                        <Td align="right">
                          <span className={e.internal ? "text-black/45" : ""}>
                            {e.amount > 0 ? fmtINR(e.amount) : ""}
                          </span>
                        </Td>
                        <Td align="right">
                          <span className={e.internal ? "text-black/45" : ""}>
                            {e.amount < 0 ? fmtINR(e.amount) : ""}
                          </span>
                        </Td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
                {groups.length === 0 && (
                  <tr>
                    <Td>No entries this month.</Td>
                  </tr>
                )}
              </tbody>
              {groups.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-black/40 font-semibold">
                    <Td>Total (excludes internal transfers)</Td>
                    <Td> </Td>
                    <Td align="right">{fmtINR(totals.inflow)}</Td>
                    <Td align="right">{fmtINR(totals.outflow)}</Td>
                  </tr>
                  <tr className="font-semibold">
                    <Td>Net movement</Td>
                    <Td> </Td>
                    <Td align="right"> </Td>
                    <Td align="right">{fmtSignedINR(totals.net)}</Td>
                  </tr>
                </tfoot>
              )}
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
