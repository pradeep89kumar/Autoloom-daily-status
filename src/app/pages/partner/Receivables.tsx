import { useEffect, useMemo, useState } from "react";
import { CaretDown, CaretUp } from "@phosphor-icons/react";
import { fetchMasterReceivables, type ReceivableRow } from "../../lib/sheetSync";
import { fmtRupees } from "../../lib/partnerCopy";

type FilterKey = "all" | "pending" | "overdue" | "partial" | "unbilled";

function fromYmd(s: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function fmtDate(s: string): string {
  const d = fromYmd(s);
  if (!d) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

/** Loom display: bare number "6" → "L6"; already-prefixed "L6" stays as-is. */
function fmtLoom(raw?: string): string {
  const t = (raw || "").trim();
  if (!t) return "";
  return /^\d+$/.test(t) ? `L${t}` : t.toUpperCase();
}

function ageDays(s: string): number | null {
  const d = fromYmd(s);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - d.getTime()) / 86400000);
}

type StatusKind = "unbilled" | "paid" | "partial" | "pending";

function statusKind(r: ReceivableRow): StatusKind {
  const s = (r.paymentStatus || r.status || "").toLowerCase();
  if (!r.invoiceNumber || s.includes("unbilled")) return "unbilled";
  // Honor explicit "Paid" mark from sheet — settlements with TDS / small
  // debits won't show full receipts, so trust the status label.
  if (s.includes("paid") && !s.includes("partial") && !s.includes("unpaid")) return "paid";
  if (s.includes("partial")) return "partial";
  if (effectivePending(r) <= 0 && r.invoiceAmount > 0) return "paid";
  return "pending";
}

function effectivePending(r: ReceivableRow): number {
  const s = (r.paymentStatus || r.status || "").toLowerCase();
  if (s.includes("paid") && !s.includes("partial") && !s.includes("unpaid")) return 0;
  if (r.invoiceAmount > 0) {
    return Math.max(0, r.invoiceAmount - (r.receipts || 0));
  }
  return r.pendingBalance;
}

function statusBadge(kind: StatusKind, overdueDays: number | null) {
  if (kind === "unbilled") return { label: "Unbilled", cls: "bg-gray-100 text-gray-700" };
  if (kind === "paid") return { label: "Paid", cls: "bg-green-100 text-green-700" };
  if (kind === "partial") return { label: "Partial", cls: "bg-amber-100 text-amber-700" };
  if (overdueDays !== null && overdueDays > 0) {
    return { label: `Overdue ${overdueDays}d`, cls: "bg-red-100 text-red-700" };
  }
  return { label: "Pending", cls: "bg-blue-50 text-blue-700" };
}

export function PartnerReceivables() {
  const [rows, setRows] = useState<ReceivableRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
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

  const filtered = useMemo(() => {
    if (!rows) return [];
    return rows.filter((r) => {
      const kind = statusKind(r);
      if (filter === "all") return true;
      if (filter === "unbilled") return kind === "unbilled";
      if (filter === "partial") return kind === "partial";
      if (filter === "pending") return kind === "pending" || kind === "partial";
      if (filter === "overdue") {
        if (kind === "paid" || kind === "unbilled") return false;
        const od = ageDays(r.dueDate);
        return od !== null && od > 0 && effectivePending(r) > 0;
      }
      return true;
    });
  }, [rows, filter]);

  const merged = useMemo(() => {
    // Combine rows that share the same invoice number into one logical invoice.
    // Sum invoiceAmount + receipts; keep earliest invoiceDate, latest dueDate / receivedOn.
    const byInv = new Map<string, ReceivableRow>();
    const passthrough: ReceivableRow[] = [];
    for (const r of filtered) {
      const inv = (r.invoiceNumber || "").trim();
      if (!inv) {
        passthrough.push(r);
        continue;
      }
      const key = `${(r.party || "").trim()}||${inv}`;
      const prev = byInv.get(key);
      if (!prev) {
        byInv.set(key, { ...r });
        continue;
      }
      prev.invoiceAmount = (prev.invoiceAmount || 0) + (r.invoiceAmount || 0);
      prev.receipts = (prev.receipts || 0) + (r.receipts || 0);
      prev.pendingBalance = (prev.pendingBalance || 0) + (r.pendingBalance || 0);
      const aInv = fromYmd(prev.invoiceDate)?.getTime() ?? Infinity;
      const bInv = fromYmd(r.invoiceDate)?.getTime() ?? Infinity;
      if (bInv < aInv && r.invoiceDate) prev.invoiceDate = r.invoiceDate;
      const aDue = fromYmd(prev.dueDate)?.getTime() ?? -Infinity;
      const bDue = fromYmd(r.dueDate)?.getTime() ?? -Infinity;
      if (bDue > aDue && r.dueDate) prev.dueDate = r.dueDate;
      const aRcv = fromYmd(prev.receivedOn)?.getTime() ?? -Infinity;
      const bRcv = fromYmd(r.receivedOn)?.getTime() ?? -Infinity;
      if (bRcv > aRcv && r.receivedOn) prev.receivedOn = r.receivedOn;
      if (!prev.paymentStatus && r.paymentStatus) prev.paymentStatus = r.paymentStatus;
      if (!prev.status && r.status) prev.status = r.status;
      const prevCustomer = prev.customerName || prev.designDetails || "";
      const rowCustomer = r.customerName || r.designDetails || "";
      if (prevCustomer && rowCustomer && !prevCustomer.includes(rowCustomer)) {
        prev.customerName = `${prevCustomer}, ${rowCustomer}`;
      }
      const prevLoom = prev.loadedLoom || prev.loomNumber || "";
      const rowLoom = r.loadedLoom || r.loomNumber || "";
      if (prevLoom && rowLoom && !prevLoom.includes(rowLoom)) {
        prev.loadedLoom = `${prevLoom}, ${rowLoom}`;
      }
      if (prev.paaguId && r.paaguId && !prev.paaguId.includes(r.paaguId)) {
        prev.paaguId = `${prev.paaguId}, ${r.paaguId}`;
      }
    }
    return [...Array.from(byInv.values()), ...passthrough];
  }, [filtered]);

  const grouped = useMemo(() => {
    const map = new Map<string, { party: string; total: number; count: number; rows: ReceivableRow[] }>();
    for (const r of merged) {
      const key = (r.party || "").trim();
      if (!key) continue;
      let g = map.get(key);
      if (!g) {
        g = { party: key, total: 0, count: 0, rows: [] };
        map.set(key, g);
      }
      g.total += effectivePending(r);
      g.count += 1;
      g.rows.push(r);
    }
    const list = Array.from(map.values());
    list.sort((a, b) => b.total - a.total);
    for (const g of list) {
      g.rows.sort((a, b) => {
        const ad = fromYmd(a.invoiceDate)?.getTime() ?? 0;
        const bd = fromYmd(b.invoiceDate)?.getTime() ?? 0;
        return bd - ad;
      });
    }
    return list;
  }, [filtered]);

  const grandTotal = useMemo(
    () => grouped.reduce((s, g) => s + g.total, 0),
    [grouped],
  );

  return (
    <div className="px-4 pt-4 pb-6">
      <div className="mb-3">
        <h2 className="text-[18px] font-bold text-[var(--color-text-primary)]">Receivables</h2>
        <p className="text-[14px] text-[var(--color-text-secondary)] mt-0.5">
          Party-wise pending against raised invoices.
        </p>
      </div>

      <div className="mb-3 flex gap-2 overflow-x-auto -mx-1 px-1">
        {(
          [
            { k: "pending", label: "Pending" },
            { k: "overdue", label: "Overdue" },
            { k: "partial", label: "Partial" },
            { k: "unbilled", label: "Unbilled" },
            { k: "all", label: "All" },
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
          Total {filter === "all" ? "" : filter} pending
        </p>
        {loading ? (
          <>
            <div className="mt-1 h-7 w-32 rounded bg-black/[0.06] animate-pulse" />
            <div className="mt-2 h-4 w-44 rounded bg-black/[0.04] animate-pulse" />
          </>
        ) : (
          <>
            <p className="text-[22px] font-bold tabular-nums text-[var(--color-text-primary)] mt-0.5">{fmtRupees(grandTotal)}</p>
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

      <ul className="flex flex-col gap-2">
        {grouped.map((g) => {
          const isOpen = expanded === g.party;
          return (
            <li
              key={g.party}
              className="rounded-xl border border-[var(--color-border-hairline)] bg-white"
            >
              <button
                onClick={() => setExpanded(isOpen ? null : g.party)}
                className="w-full px-4 py-3 flex items-center justify-between text-left"
              >
                <div className="min-w-0">
                  <p className="text-[16px] font-semibold text-[var(--color-text-primary)] truncate">{g.party}</p>
                  <p className="text-[14px] text-[var(--color-text-secondary)] mt-0.5">
                    {g.count} {g.count === 1 ? "invoice" : "invoices"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[18px] font-bold tabular-nums text-[var(--color-text-primary)]">{fmtRupees(g.total)}</span>
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
                    return (
                      <li
                        key={`${r.paaguId}||${r.invoiceNumber}||${idx}`}
                        className="px-4 py-3"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-[16px] font-semibold text-[var(--color-text-primary)] truncate">
                            {r.invoiceNumber || r.customerName || r.designDetails || "—"}
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
                        </p>
                        <div className="mt-1.5 flex justify-end">
                          <span className="text-[18px] font-bold tabular-nums text-[var(--color-text-primary)]">
                            {fmtRupees(r.invoiceAmount)}
                          </span>
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
