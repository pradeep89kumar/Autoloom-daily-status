import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
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
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
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
  if (s.includes("partial")) return "partial";
  if (effectivePending(r) <= 0 && r.invoiceAmount > 0) return "paid";
  return "pending";
}

function effectivePending(r: ReceivableRow): number {
  const s = (r.paymentStatus || r.status || "").toLowerCase();
  if (s.includes("partial") && r.invoiceAmount > 0) {
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
  const [filter, setFilter] = useState<FilterKey>("partial");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchMasterReceivables().then((r) => {
      if (!alive) return;
      setRows(r);
      setLoading(false);
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

  const grouped = useMemo(() => {
    const map = new Map<string, { party: string; total: number; count: number; rows: ReceivableRow[] }>();
    for (const r of filtered) {
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
        <h2 className="text-lg font-semibold">Receivables</h2>
        <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
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
            className={`px-3 py-1.5 rounded-full text-[13px] whitespace-nowrap border ${
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
        <p className="text-[12px] text-[var(--color-text-secondary)] uppercase tracking-wide">
          Total {filter === "all" ? "" : filter} pending
        </p>
        <p className="text-2xl font-semibold mt-0.5">{fmtRupees(grandTotal)}</p>
        <p className="text-[12px] text-[var(--color-text-secondary)] mt-0.5">
          Across {grouped.length} {grouped.length === 1 ? "party" : "parties"} ·{" "}
          {filtered.length} {filtered.length === 1 ? "invoice" : "invoices"}
        </p>
      </div>

      {loading && (
        <p className="text-sm text-[var(--color-text-secondary)] italic">Loading…</p>
      )}

      {!loading && grouped.length === 0 && (
        <p className="text-sm text-[var(--color-text-secondary)] italic">
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
                  <p className="text-[15px] font-medium truncate">{g.party}</p>
                  <p className="text-[12px] text-[var(--color-text-secondary)] mt-0.5">
                    {g.count} {g.count === 1 ? "invoice" : "invoices"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[15px] font-semibold">{fmtRupees(g.total)}</span>
                  {isOpen ? (
                    <ChevronUp
                      className="w-4 h-4 text-[var(--color-text-secondary)]"
                      strokeWidth={1.5}
                    />
                  ) : (
                    <ChevronDown
                      className="w-4 h-4 text-[var(--color-text-secondary)]"
                      strokeWidth={1.5}
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
                          <p className="text-[14px] font-medium truncate">
                            {r.invoiceNumber || r.paaguId || r.orderId || "—"}
                          </p>
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded-full ${badge.cls}`}
                          >
                            {badge.label}
                          </span>
                        </div>
                        <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[12px] text-[var(--color-text-secondary)]">
                          <span>Inv {fmtDate(r.invoiceDate)}</span>
                          <span>Due {fmtDate(r.dueDate)}</span>
                          <span>Order · {r.orderId || "—"}</span>
                          <span>Paagu · {r.paaguId || "—"}</span>
                        </div>
                        <div className="mt-1.5 flex items-baseline justify-between gap-2 text-[13px]">
                          <span className="text-[var(--color-text-secondary)]">
                            Inv {fmtRupees(r.invoiceAmount)}
                            {r.receipts > 0 && <> · Recd {fmtRupees(r.receipts)}</>}
                          </span>
                          <span className="font-semibold">
                            {fmtRupees(effectivePending(r))}
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
