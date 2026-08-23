import { useEffect, useMemo, useState } from "react";
import { CaretDown, CaretUp, FilePdf } from "@phosphor-icons/react";
import { useNavigate } from "react-router";
import { fetchMasterReceivables, type ReceivableRow } from "../../lib/sheetSync";
import { fmtRupees } from "../../lib/partnerCopy";
import {
  advanceAmount,
  formatReceivableDate as fmtDate,
  hasRealInvoice,
  netAfterTds,
  receivableAgeDays as ageDays,
  receivableStatusKind as statusKind,
  selectReceivables,
  type ReceivableFilterKey as FilterKey,
  type ReceivableStatusKind as StatusKind,
} from "../../lib/receivables";

/** Loom display: bare number "6" → "L6"; already-prefixed "L6" stays as-is. */
function fmtLoom(raw?: string): string {
  const t = (raw || "").trim();
  if (!t) return "";
  return /^\d+$/.test(t) ? `L${t}` : t.toUpperCase();
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Aging heat for the days-since-invoice chip:
//   1–15d  dark green → light green
//   16–30d yellow → orange
//   >30d   no tint (the Overdue badge already signals urgency)
function ageColor(days: number): string | null {
  if (days <= 0) return null;
  if (days <= 15) {
    const t = Math.min(1, Math.max(0, (days - 1) / 14));
    return `hsl(${lerp(140, 100, t)} ${lerp(65, 55, t)}% ${lerp(30, 45, t)}%)`;
  }
  if (days <= 30) {
    const t = Math.min(1, Math.max(0, (days - 16) / 14));
    return `hsl(${lerp(50, 28, t)} 90% 48%)`;
  }
  return null;
}

function statusBadge(kind: StatusKind, overdueDays: number | null) {
  if (kind === "unbilled") return { label: "Unbilled", cls: "bg-gray-100 text-gray-700" };
  if (kind === "advance") return { label: "Advance", cls: "bg-emerald-100 text-emerald-700" };
  if (kind === "paid") return { label: "Paid", cls: "bg-green-100 text-green-700" };
  if (kind === "partial") return { label: "Partial", cls: "bg-amber-100 text-amber-700" };
  if (overdueDays !== null && overdueDays > 0) {
    return { label: `Overdue ${overdueDays}d`, cls: "bg-red-100 text-red-700" };
  }
  return { label: "Pending", cls: "bg-blue-50 text-blue-700" };
}

export function PartnerReceivables() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ReceivableRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FilterKey>("pending");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const startedAt = Date.now();
    fetchMasterReceivables().then((r) => {
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
  }, []);

  const { merged, grouped, grandTotal, grandAdvance } = useMemo(
    () => selectReceivables(rows || [], filter),
    [rows, filter],
  );

  return (
    <div className="px-4 pt-4 pb-6">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[18px] font-bold text-[var(--color-text-primary)]">Receivables</h2>
          <p className="text-[14px] text-[var(--color-text-secondary)] mt-0.5">
            Party-wise pending against raised invoices.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/partner/receivables/report")}
          className="shrink-0 inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[13px] font-semibold text-blue-700 transition-colors hover:bg-blue-100"
        >
          <FilePdf className="h-4 w-4" weight="bold" />
          Generate report
        </button>
      </div>

      <div className="mb-3 flex gap-2 overflow-x-auto -mx-1 px-1">
        {(
          [
            { k: "pending", label: "Pending" },
            { k: "overdue", label: "Overdue" },
            { k: "partial", label: "Partial" },
            { k: "advance", label: "Advance" },
          ] as { k: FilterKey; label: string }[]
        ).map((f) => (
          <button
            key={f.k}
            onClick={() => setFilter(f.k)}
            className={`px-3 py-1.5 rounded-full text-[14px] font-medium whitespace-nowrap border ${
              filter === f.k
                ? "bg-[var(--color-text-primary)] text-white border-[var(--color-text-primary)]"
                : "bg-white text-[var(--color-text-secondary)] border-[var(--color-border-hairline)]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-[var(--color-border-hairline)] p-4 mb-4">
        <p className="text-[13px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">
          {filter === "pending" ? "Total pending" : `Total ${filter}`}
        </p>
        {loading ? (
          <>
            <div className="mt-1 h-7 w-32 rounded bg-black/[0.06] animate-pulse" />
            <div className="mt-2 h-4 w-44 rounded bg-black/[0.04] animate-pulse" />
          </>
        ) : (
          <>
            <p className="text-[22px] font-bold tabular-nums text-[var(--color-text-primary)] mt-0.5">
              {fmtRupees(filter === "advance" ? grandAdvance : grandTotal)}
            </p>
            {filter !== "advance" && (
              <p className="text-[14px] font-semibold tabular-nums text-[var(--color-text-secondary)] mt-0.5">
                After TDS {fmtRupees(netAfterTds(grandTotal))}
              </p>
            )}
            {filter !== "advance" && grandAdvance > 0 && (
              <p className="text-[14px] font-semibold tabular-nums text-[var(--color-status-green)] mt-0.5">
                Advance held {fmtRupees(grandAdvance)} · Net {fmtRupees(Math.max(0, grandTotal - grandAdvance))}
              </p>
            )}
            <p className="text-[14px] text-[var(--color-text-secondary)] mt-0.5">
              Across {grouped.length} {grouped.length === 1 ? "party" : "parties"} ·{" "}
              {merged.length} {merged.length === 1 ? "invoice" : "invoices"}
            </p>
          </>
        )}
      </div>

      {loading && (
        <ul className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <li
              key={i}
              className="rounded-xl border border-[var(--color-border-hairline)] bg-white px-4 py-3"
            >
              <div className="h-4 w-40 rounded bg-black/[0.06] animate-pulse" />
              <div className="mt-2 h-3 w-24 rounded bg-black/[0.04] animate-pulse" />
            </li>
          ))}
        </ul>
      )}

      {!loading && grouped.length === 0 && (
        <p className="text-[15px] text-[var(--color-text-secondary)] italic">
          No matching invoices.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {grouped.map((g) => {
          const isOpen =
            filter === "overdue" ? !collapsed.has(g.party) : expanded === g.party;
          const toggle = () => {
            if (filter === "overdue") {
              setCollapsed((prev) => {
                const next = new Set(prev);
                if (next.has(g.party)) next.delete(g.party);
                else next.add(g.party);
                return next;
              });
            } else {
              setExpanded(isOpen ? null : g.party);
            }
          };
          return (
            <li
              key={g.party}
              className={`rounded-xl border bg-white overflow-hidden transition-shadow ${
                isOpen
                  ? "border-[var(--color-text-primary)]/15 shadow-md"
                  : "border-[var(--color-border-hairline)] shadow-sm"
              }`}
            >
              <button
                onClick={toggle}
                className="w-full px-4 py-3.5 flex items-center justify-between text-left"
              >
                <div className="min-w-0">
                  <p className="text-[18px] font-bold text-[var(--color-text-primary)] truncate">{g.party}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[14px] text-[var(--color-text-secondary)]">
                      {g.count} {g.count === 1 ? "invoice" : "invoices"}
                    </span>
                    {g.overdue > 0 && (
                      <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                        {g.overdue} overdue
                      </span>
                    )}
                    {g.advance > 0 && (
                      <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                        Advance {fmtRupees(g.advance)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[18px] font-bold tabular-nums ${filter === "advance" ? "text-[var(--color-status-green)]" : "text-[var(--color-brand-primary)]"}`}>
                    {fmtRupees(filter === "advance" ? g.advance : g.total)}
                  </span>
                  {isOpen ? (
                    <CaretUp
                      className="w-4 h-4 text-[var(--color-text-secondary)]"
                      weight="bold"
                    />
                  ) : (
                    <CaretDown
                      className="w-4 h-4 text-[var(--color-text-secondary)]"
                      weight="bold"
                    />
                  )}
                </div>
              </button>
              {isOpen && (
                <ul className="border-t border-[var(--color-border-hairline)] divide-y divide-[var(--color-border-hairline)]">
                  {g.rows.map((r, idx) => {
                    const kind = statusKind(r);
                    const od = ageDays(r.dueDate);
                    const badge = statusBadge(kind, od);
                    const invAge = ageDays(r.invoiceDate);
                    const pendingState = kind === "pending" || kind === "partial";
                    const ageTint =
                      pendingState && invAge !== null && invAge >= 0 ? ageColor(invAge) : null;
                    return (
                      <li
                        key={`${r.paaguId}||${r.invoiceNumber}||${idx}`}
                        className="px-4 py-3"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-[16px] font-semibold text-[var(--color-text-primary)] truncate">
                            {hasRealInvoice(r)
                              ? r.invoiceNumber
                              : r.customerName || r.designDetails || r.paaguId || "—"}
                          </p>
                          <span
                            className={`text-[13px] font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}
                          >
                            {badge.label}
                          </span>
                        </div>
                        <p className="mt-1 text-[14px] text-[var(--color-text-secondary)] truncate">
                          {r.customerName || r.designDetails || "—"}
                          {fmtLoom(r.loadedLoom || r.loomNumber) && (
                            <span className="text-[var(--color-text-tertiary)]"> · {fmtLoom(r.loadedLoom || r.loomNumber)}</span>
                          )}
                        </p>
                        <p className="mt-0.5 text-[14px] text-[var(--color-text-secondary)] tabular-nums">
                          Inv {fmtDate(r.invoiceDate)}   ·   Due {fmtDate(r.dueDate)}
                          {pendingState && invAge !== null && invAge >= 0 && (
                            <span
                              className={ageTint ? "font-semibold" : "text-[var(--color-text-tertiary)]"}
                              style={ageTint ? { color: ageTint } : undefined}
                            >
                              {"   ·   "}{invAge}d
                            </span>
                          )}
                        </p>
                        <div className="mt-1.5 flex items-baseline justify-between gap-2">
                          {kind === "advance" ? (
                            <>
                              <span className="text-[14px] text-[var(--color-text-secondary)]">
                                Advance received
                              </span>
                              <div className="flex flex-col items-end">
                                <span className="text-[18px] font-bold tabular-nums text-[var(--color-status-green)]">
                                  {fmtRupees(advanceAmount(r))}
                                </span>
                                <span className="text-[12px] font-medium tabular-nums text-[var(--color-text-secondary)]">
                                  Awaiting invoice
                                </span>
                              </div>
                            </>
                          ) : (
                            <>
                              {kind === "partial" && (r.receipts || 0) > 0 ? (
                                <span className="text-[14px] font-bold text-[var(--color-status-green)] tabular-nums">
                                  Paid {fmtRupees(r.receipts)} so far
                                </span>
                              ) : (
                                <span />
                              )}
                              <div className="flex flex-col items-end">
                                <span className="text-[18px] font-bold tabular-nums text-[var(--color-text-primary)]">
                                  {fmtRupees(r.invoiceAmount)}
                                </span>
                                <span className="text-[12px] font-medium tabular-nums text-[var(--color-text-secondary)]">
                                  After TDS {fmtRupees(netAfterTds(r.invoiceAmount))}
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
