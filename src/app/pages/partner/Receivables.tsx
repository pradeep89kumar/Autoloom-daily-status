import { useMemo, useState } from "react";
import {
  ArrowClockwise,
  CaretDown,
  CaretUp,
  FilePdf,
  MagnifyingGlass,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useLocation, useNavigate } from "react-router";
import { SheetDataStatus } from "../../components/SheetDataStatus";
import { useSheetResource } from "../../hooks/useSheetResource";
import {
  fetchMasterReceivablesResult,
  fetchMasterUnbilledResult,
  peekMasterReceivablesCache,
  peekMasterUnbilledCache,
  type MasterUnbilledData,
  type MasterUnbilledRow,
  type ReceivableRow,
  type SheetReadResult,
} from "../../lib/sheetSync";
import { fmtRupees } from "../../lib/partnerCopy";
import {
  parseUnbilledReportScope,
  type UnbilledReportScope as UnbilledFilter,
} from "../../lib/unbilledReport";
import {
  advanceAmount,
  effectivePending,
  formatReceivableDate as fmtDate,
  hasRealInvoice,
  isOutstandingReceivable,
  isOverdueReceivable,
  mergeReceivableRows,
  netAfterTds,
  receivableAgeDays as ageDays,
  receivablePartyKey,
  receivableStatusKind as statusKind,
  selectReceivables,
  type ReceivableFilterKey as FilterKey,
  type ReceivableStatusKind as StatusKind,
} from "../../lib/receivables";

type ReceivablesView = "party" | "invoice" | "unbilled";
type InvoiceMode = "outstanding" | "paid";
type InvoiceFilter = "pending" | "overdue" | "partial";
type InvoiceSortDirection = "desc" | "asc";

interface ReceivablesRouteState {
  receivablesView?: ReceivablesView;
  unbilledFilter?: UnbilledFilter;
}

async function loadReceivablesResult(
  { fresh }: { fresh: boolean },
): Promise<SheetReadResult<ReceivableRow[]>> {
  const result = await fetchMasterReceivablesResult({ fresh });
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    data: result.rows,
    source: result.source,
    lastSyncedAt: result.lastSyncedAt,
    stale: result.stale,
    warning: result.warning,
  };
}

function loadMasterUnbilledResult(
  { fresh }: { fresh: boolean },
): Promise<SheetReadResult<MasterUnbilledData>> {
  return fetchMasterUnbilledResult({ fresh });
}

const invoiceNumberCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function invoiceLedgerKey(row: ReceivableRow): string {
  return `${receivablePartyKey(row.party)}||${(row.invoiceNumber || "").trim()}`;
}

function invoicePaymentState(row: ReceivableRow) {
  const value = (row.paymentStatus || row.status || "").trim().toLowerCase();
  return {
    paid:
      value.includes("paid") &&
      !value.includes("partial") &&
      !value.includes("unpaid"),
    open:
      value.includes("partial") ||
      value.includes("unpaid") ||
      value.includes("pending"),
  };
}

/**
 * The workbook can retain more than one row for the same party + invoice.
 * Merge first, then reconcile every source row's payment state so row order
 * cannot decide whether the combined invoice appears as outstanding or paid.
 */
function mergeInvoiceRowsForLedger(rows: ReceivableRow[]): ReceivableRow[] {
  const evidence = new Map<string, { paid: boolean; open: boolean }>();

  for (const row of rows) {
    if (!hasRealInvoice(row)) continue;
    const key = invoiceLedgerKey(row);
    const state = invoicePaymentState(row);
    const previous = evidence.get(key) || { paid: false, open: false };
    evidence.set(key, {
      paid: previous.paid || state.paid,
      open: previous.open || state.open,
    });
  }

  return mergeReceivableRows(rows)
    .filter(hasRealInvoice)
    .map((row) => {
      const state = evidence.get(invoiceLedgerKey(row));
      const calculatedBalance =
        row.invoiceAmount > 0
          ? Math.max(0, row.invoiceAmount - (row.receipts || 0))
          : Math.max(0, row.pendingBalance || 0);

      let paymentStatus = row.paymentStatus;
      if (row.invoiceAmount > 0 && calculatedBalance <= 0) {
        paymentStatus = "Paid";
      } else if (state?.open) {
        paymentStatus = (row.receipts || 0) > 0 ? "Partial" : "Pending";
      } else if (state?.paid) {
        paymentStatus = "Paid";
      }

      return paymentStatus === row.paymentStatus ? row : { ...row, paymentStatus };
    });
}

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

function sortByInvoiceNumber(
  rows: ReceivableRow[],
  direction: InvoiceSortDirection,
): ReceivableRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const firstInvoice = (left.row.invoiceNumber || "").trim();
      const secondInvoice = (right.row.invoiceNumber || "").trim();
      if (!firstInvoice && secondInvoice) return 1;
      if (firstInvoice && !secondInvoice) return -1;

      const invoiceOrder = invoiceNumberCollator.compare(firstInvoice, secondInvoice);
      if (invoiceOrder !== 0) return direction === "asc" ? invoiceOrder : -invoiceOrder;

      // The natural collator intentionally treats case and zero-padding as equal.
      // Keep those distinct invoice IDs deterministic before falling back to dates.
      const rawInvoiceOrder =
        firstInvoice === secondInvoice ? 0 : firstInvoice < secondInvoice ? -1 : 1;
      if (rawInvoiceOrder !== 0) {
        return direction === "asc" ? rawInvoiceOrder : -rawInvoiceOrder;
      }

      const dateOrder = (right.row.invoiceDate || "").localeCompare(
        left.row.invoiceDate || "",
      );
      if (dateOrder !== 0) return dateOrder;

      const partyOrder = invoiceNumberCollator.compare(
        (left.row.party || "").trim(),
        (right.row.party || "").trim(),
      );
      if (partyOrder !== 0) return partyOrder;
      return left.index - right.index;
    })
    .map(({ row }) => row);
}

function matchesGlobalInvoiceSearch(row: ReceivableRow, query: string): boolean {
  const normalizedQuery = query.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-IN");
  if (!normalizedQuery) return true;
  return [row.invoiceNumber, row.party, row.customerName, row.designDetails].some((value) =>
    (value || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLocaleLowerCase("en-IN")
      .includes(normalizedQuery),
  );
}

function InvoiceLedgerTable({ rows }: { rows: ReceivableRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-border-hairline)] bg-white shadow-sm">
      <table className="w-full table-fixed border-collapse text-left">
        <caption className="sr-only">Invoices sorted by invoice number</caption>
        <colgroup>
          <col className="w-[28%]" />
          <col className="w-[34%]" />
          <col className="w-[38%]" />
        </colgroup>
        <thead className="border-b border-[var(--color-border-hairline)] bg-slate-50 text-[10px] uppercase leading-3 tracking-wide text-[var(--color-text-secondary)]">
          <tr>
            <th scope="col" className="px-2 py-2.5 font-bold">
              Invoice
            </th>
            <th scope="col" className="px-2 py-2.5 font-bold">
              Party / design
            </th>
            <th scope="col" className="px-2 py-2.5 text-right font-bold">
              Amount / status
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border-hairline)]">
          {rows.map((row, index) => {
            const kind = statusKind(row);
            const badge = statusBadge(kind, ageDays(row.dueDate));
            const paid = kind === "paid";
            const primaryAmount = paid ? row.receipts || 0 : effectivePending(row);
            const hasRecordedReceipt = (row.receipts || 0) > 0;
            const design = row.customerName || row.designDetails || "—";
            const loom = fmtLoom(row.loadedLoom || row.loomNumber);
            return (
              <tr key={`${row.party}||${row.invoiceNumber}||${index}`} className="align-top">
                <td className="px-2 py-3">
                  <p className="[overflow-wrap:anywhere] text-[12px] font-bold leading-4 text-[var(--color-text-primary)]">
                    {row.invoiceNumber || "—"}
                  </p>
                  <p className="mt-1 text-[11px] tabular-nums text-[var(--color-text-secondary)]">
                    Inv {fmtDate(row.invoiceDate)}
                  </p>
                </td>
                <td className="px-2 py-3">
                  <p className="break-words text-[12px] font-semibold leading-4 text-[var(--color-text-primary)]">
                    {row.party || "—"}
                  </p>
                  <p className="mt-1 break-words text-[11px] leading-4 text-[var(--color-text-secondary)]">
                    {design}
                    {loom ? ` · ${loom}` : ""}
                  </p>
                </td>
                <td className="px-2 py-3 text-right">
                  <p className="text-[12px] font-bold tabular-nums text-[var(--color-text-primary)]">
                    {paid && !hasRecordedReceipt ? "—" : fmtRupees(primaryAmount)}
                  </p>
                  <p className="mt-0.5 text-[10px] font-medium text-[var(--color-text-tertiary)]">
                    {paid
                      ? hasRecordedReceipt
                        ? "Recorded receipt"
                        : "Receipt not recorded"
                      : "Outstanding"}
                  </p>
                  <span
                    className={`mt-1.5 inline-flex whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-bold ${badge.cls}`}
                  >
                    {badge.label}
                  </span>
                  <p className="mt-1 text-[10px] tabular-nums text-[var(--color-text-secondary)]">
                    {paid
                      ? row.receivedOn
                        ? `Paid ${fmtDate(row.receivedOn)}`
                        : "Paid date unavailable"
                      : `Due ${fmtDate(row.dueDate)}`}
                  </p>
                  {paid && (
                    <p className="mt-0.5 text-[10px] tabular-nums text-[var(--color-text-tertiary)]">
                      Invoice {fmtRupees(row.invoiceAmount)}
                    </p>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const metersFormatter = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 1,
});

function UnbilledTable({ rows }: { rows: MasterUnbilledRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-border-hairline)] bg-white shadow-sm">
      <table className="w-full table-fixed border-collapse text-left">
        <caption className="sr-only">Unbilled production by customer and design</caption>
        <colgroup>
          <col className="w-[44%]" />
          <col className="w-[22%]" />
          <col className="w-[34%]" />
        </colgroup>
        <thead className="border-b border-[var(--color-border-hairline)] bg-slate-50 text-[10px] uppercase leading-3 tracking-wide text-[var(--color-text-secondary)]">
          <tr>
            <th scope="col" className="px-2 py-2.5 font-bold">
              Customer / design
            </th>
            <th scope="col" className="px-2 py-2.5 text-right font-bold">
              Produced m
            </th>
            <th scope="col" className="px-2 py-2.5 text-right font-bold">
              Unbilled value
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border-hairline)]">
          {rows.map((row) => {
            const runningLooms = row.runningLooms.map(fmtLoom).filter(Boolean);
            return (
              <tr key={row.key} className="align-top">
                <td className="px-2 py-3">
                  <p className="break-words text-[12px] font-semibold leading-4 text-[var(--color-text-primary)]">
                    {row.customerDesign || "—"}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span
                      className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                        row.status === "ready"
                          ? "bg-blue-50 text-blue-700"
                          : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {row.status === "ready" ? "Ready to bill" : "Running"}
                    </span>
                    <span className="text-[10px] leading-4 text-[var(--color-text-secondary)]">
                      {row.status === "ready"
                        ? row.latestRunout
                          ? `Last run-out ${fmtDate(row.latestRunout)}`
                          : "Run-out date unavailable"
                        : runningLooms.length > 0
                          ? `Running ${runningLooms.join(", ")}${
                              row.latestRunout
                                ? ` · Last run-out ${fmtDate(row.latestRunout)}`
                                : ""
                            }`
                          : row.latestRunout
                            ? `Production active · Last run-out ${fmtDate(row.latestRunout)}`
                            : "Production active"}
                    </span>
                  </div>
                </td>
                <td className="px-2 py-3 text-right text-[12px] font-semibold tabular-nums text-[var(--color-text-primary)]">
                  {metersFormatter.format(row.producedMeters)}
                </td>
                <td className="px-2 py-3 text-right text-[12px] font-bold tabular-nums text-[var(--color-text-primary)]">
                  {fmtRupees(row.estimatedUnbilled)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Mounted only after the Unbilled tab is selected, so existing views do not wait for this request. */
function UnbilledReceivablesView({
  initialFilter = "ready",
}: {
  initialFilter?: UnbilledFilter;
}) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<UnbilledFilter>(initialFilter);
  const resource = useSheetResource<MasterUnbilledData>({
    resourceKey: "partner:master-unbilled",
    load: loadMasterUnbilledResult,
    peek: peekMasterUnbilledCache,
  });
  const data = resource.data;
  const rows = useMemo(() => {
    if (!data) return [];
    if (filter === "all") return data.rows;
    return data.rows.filter((row) => row.status === filter);
  }, [data, filter]);
  const backendUpdateNeeded =
    !data && resource.error?.code === "upstream_incompatible_response";

  return (
    <>
      {backendUpdateNeeded ? (
        <div
          className="mb-3 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-950"
          role="alert"
        >
          <WarningCircle className="mt-0.5 h-4 w-4 shrink-0" weight="fill" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold">Unbilled data update is not live yet</p>
            <p className="mt-0.5 text-[12px] leading-relaxed opacity-80">
              Update the approved Apps Script deployment, then retry. Existing receivables remain available.
            </p>
          </div>
          <button
            type="button"
            onClick={resource.refresh}
            disabled={resource.refreshing}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-current/20 bg-white/70 px-2 text-[12px] font-semibold disabled:opacity-60"
          >
            <ArrowClockwise
              className={`h-3.5 w-3.5 ${resource.refreshing ? "animate-spin" : ""}`}
              weight="bold"
            />
            Retry
          </button>
        </div>
      ) : (
        <SheetDataStatus
          error={resource.error}
          warning={resource.warning}
          refreshing={resource.refreshing}
          lastSyncedAt={resource.lastSyncedAt}
          onRetry={resource.refresh}
          className="mb-3"
        />
      )}

      {(resource.loading || data) && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2">
            {resource.loading && !data ? (
              [0, 1, 2].map((item) => (
                <div
                  key={item}
                  className={`min-h-[76px] rounded-xl border border-[var(--color-border-hairline)] bg-white p-3 ${
                    item === 0 ? "col-span-2" : ""
                  }`}
                >
                  <div className="h-3 w-16 animate-pulse rounded bg-black/[0.05]" />
                  <div className="mt-2 h-5 w-20 animate-pulse rounded bg-black/[0.07]" />
                </div>
              ))
            ) : (
              [
                {
                  label: "Total unbilled",
                  value: data?.summary.totalEstimatedUnbilled || 0,
                  wide: true,
                },
                {
                  label: "Ready to bill",
                  value: data?.summary.readyToBillValue || 0,
                  wide: false,
                },
                {
                  label: "Running",
                  value: data?.summary.runningValue || 0,
                  wide: false,
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className={`min-w-0 rounded-xl border border-[var(--color-border-hairline)] bg-white p-3 ${
                    item.wide ? "col-span-2" : ""
                  }`}
                >
                  <p className="text-[10px] font-semibold uppercase leading-3 tracking-wide text-[var(--color-text-secondary)]">
                    {item.label}
                  </p>
                  <p className="mt-1 break-words text-[15px] font-bold leading-5 tabular-nums text-[var(--color-text-primary)]">
                    {fmtRupees(item.value)}
                  </p>
                </div>
              ))
            )}
          </div>

          <div className="mb-3 flex justify-end">
            <button
              type="button"
              onClick={() =>
                navigate(`/partner/receivables/unbilled-report?scope=${filter}`)
              }
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[13px] font-semibold text-blue-700 transition-colors hover:bg-blue-100"
            >
              <FilePdf className="h-4 w-4" weight="bold" />
              Generate report
            </button>
          </div>

          <div
            role="group"
            aria-label="Unbilled production filter"
            className="mb-3 flex gap-2 overflow-x-auto -mx-1 px-1"
          >
            {(
              [
                { key: "all", label: "All" },
                { key: "running", label: "Running" },
                { key: "ready", label: "Ready to bill" },
              ] as { key: UnbilledFilter; label: string }[]
            ).map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={filter === option.key}
                onClick={() => setFilter(option.key)}
                className={`min-h-11 whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] font-medium ${
                  filter === option.key
                    ? "border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-white"
                    : "border-[var(--color-border-hairline)] bg-white text-[var(--color-text-secondary)]"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {resource.loading && !data ? (
            <div className="overflow-hidden rounded-xl border border-[var(--color-border-hairline)] bg-white">
              {[0, 1, 2, 3].map((item) => (
                <div
                  key={item}
                  className="grid grid-cols-3 gap-3 border-b border-[var(--color-border-hairline)] px-3 py-4 last:border-b-0"
                >
                  <div className="h-4 animate-pulse rounded bg-black/[0.06]" />
                  <div className="h-4 animate-pulse rounded bg-black/[0.05]" />
                  <div className="h-4 animate-pulse rounded bg-black/[0.06]" />
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="text-[15px] italic text-[var(--color-text-secondary)]">
              {filter === "ready"
                ? "No production is ready to bill."
                : filter === "running"
                  ? "No running production is available."
                  : "No unbilled production is available."}
            </p>
          ) : (
            <UnbilledTable rows={rows} />
          )}

          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-4 text-[var(--color-text-secondary)]">
            Values use Total value and meters use OK mtr from Paagu ID. Rows with an invoice number are excluded. Invoice amounts include 5% GST.
          </p>
        </>
      )}
    </>
  );
}

export function PartnerReceivables() {
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = location.state as ReceivablesRouteState | null;
  const initialView = routeState?.receivablesView === "unbilled" ? "unbilled" : "party";
  const initialUnbilledFilter = parseUnbilledReportScope(
    routeState?.unbilledFilter ?? null,
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FilterKey>("pending");
  const [view, setView] = useState<ReceivablesView>(initialView);
  const [invoiceMode, setInvoiceMode] = useState<InvoiceMode>("outstanding");
  const [invoiceFilter, setInvoiceFilter] = useState<InvoiceFilter>("pending");
  const [invoiceSort, setInvoiceSort] = useState<InvoiceSortDirection>("desc");
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const receivablesResource = useSheetResource<ReceivableRow[]>({
    resourceKey: "partner:receivables:all",
    load: loadReceivablesResult,
    peek: peekMasterReceivablesCache,
  });
  const { data: rows, loading } = receivablesResource;

  const { merged, grouped, grandTotal, grandAdvance } = useMemo(
    () => selectReceivables(rows || [], filter),
    [rows, filter],
  );

  const allInvoiceRows = useMemo(
    () => mergeInvoiceRowsForLedger(rows || []),
    [rows],
  );

  const outstandingInvoiceRows = useMemo(
    () =>
      allInvoiceRows.filter((row) => {
        if (invoiceFilter === "overdue") return isOverdueReceivable(row);
        if (invoiceFilter === "partial") {
          return statusKind(row) === "partial" && effectivePending(row) > 0;
        }
        return isOutstandingReceivable(row);
      }),
    [allInvoiceRows, invoiceFilter],
  );

  const paidInvoiceRows = useMemo(
    () => allInvoiceRows.filter((row) => statusKind(row) === "paid"),
    [allInvoiceRows],
  );

  const normalizedInvoiceSearch = invoiceSearch.trim();
  const searchingInvoices = normalizedInvoiceSearch.length > 0;
  const visibleInvoiceRows = useMemo(() => {
    const selectedRows = searchingInvoices
      ? allInvoiceRows.filter((row) => matchesGlobalInvoiceSearch(row, normalizedInvoiceSearch))
      : invoiceMode === "paid"
        ? paidInvoiceRows
        : outstandingInvoiceRows;
    return sortByInvoiceNumber(selectedRows, invoiceSort);
  }, [
    allInvoiceRows,
    invoiceMode,
    invoiceSort,
    normalizedInvoiceSearch,
    outstandingInvoiceRows,
    paidInvoiceRows,
    searchingInvoices,
  ]);

  const paidInvoiceValue = paidInvoiceRows.reduce(
    (sum, row) => sum + (row.invoiceAmount || 0),
    0,
  );
  const paidReceipts = paidInvoiceRows.reduce((sum, row) => sum + (row.receipts || 0), 0);
  const outstandingInvoiceTotal = outstandingInvoiceRows.reduce(
    (sum, row) => sum + effectivePending(row),
    0,
  );
  const invoicePartyCount = new Set(
    visibleInvoiceRows.map((row) => receivablePartyKey(row.party)),
  ).size;

  return (
    <div className="px-4 pt-4 pb-6">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[18px] font-bold text-[var(--color-text-primary)]">Receivables</h2>
          <p className="text-[14px] text-[var(--color-text-secondary)] mt-0.5">
            {view === "party"
              ? "Party-wise pending against raised invoices."
              : view === "invoice"
                ? "Invoice ledger across outstanding and paid history."
                : "Estimated production value not yet invoiced."}
          </p>
        </div>
        {view !== "unbilled" && (
          <button
            type="button"
            onClick={() => navigate("/partner/receivables/report")}
            className="shrink-0 inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[13px] font-semibold text-blue-700 transition-colors hover:bg-blue-100"
          >
            <FilePdf className="h-4 w-4" weight="bold" />
            Generate report
          </button>
        )}
      </div>

      <div
        role="group"
        aria-label="Receivables view"
        className="mb-3 grid grid-cols-3 rounded-xl border border-[var(--color-border-hairline)] bg-slate-50 p-1"
      >
        {(
          [
            { key: "party", label: "Party view" },
            { key: "invoice", label: "Invoice view" },
            { key: "unbilled", label: "Unbilled" },
          ] as { key: ReceivablesView; label: string }[]
        ).map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={view === option.key}
            onClick={() => setView(option.key)}
            className={`min-h-11 rounded-lg px-3 py-2 text-[13px] font-bold transition-colors ${
              view === option.key
                ? "bg-white text-[var(--color-text-primary)] shadow-sm"
                : "text-[var(--color-text-secondary)]"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {view !== "unbilled" && (
        <SheetDataStatus
          error={receivablesResource.error}
          warning={receivablesResource.warning}
          refreshing={receivablesResource.refreshing}
          lastSyncedAt={receivablesResource.lastSyncedAt}
          onRetry={receivablesResource.refresh}
          className="mb-3"
        />
      )}

      {view === "unbilled" ? (
        <UnbilledReceivablesView initialFilter={initialUnbilledFilter} />
      ) : loading || rows !== null ? (view === "party" ? (
        <>

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
        </>
      ) : (
        <>
          <div className="mb-3 flex items-stretch gap-2">
            <div className="relative min-w-0 flex-1">
              <MagnifyingGlass
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-tertiary)]"
                weight="bold"
              />
              <input
                type="search"
                value={invoiceSearch}
                onChange={(event) => setInvoiceSearch(event.target.value)}
                placeholder="Search all invoices"
                aria-label="Search all outstanding and paid invoices"
                className="min-h-11 w-full rounded-lg border border-[var(--color-border-hairline)] bg-white py-2 pl-9 pr-9 text-[13px] text-[var(--color-text-primary)] outline-none transition-colors placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-brand-primary)] focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1"
              />
              {invoiceSearch && (
                <button
                  type="button"
                  onClick={() => setInvoiceSearch("")}
                  aria-label="Clear invoice search"
                  className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-slate-100"
                >
                  <X className="h-4 w-4" weight="bold" />
                </button>
              )}
            </div>
            <select
              value={invoiceSort}
              onChange={(event) =>
                setInvoiceSort(event.target.value as InvoiceSortDirection)
              }
              aria-label="Sort invoices by invoice number"
              className="min-h-11 w-[132px] rounded-lg border border-[var(--color-border-hairline)] bg-white px-2 text-[12px] font-semibold text-[var(--color-text-primary)] outline-none focus:border-[var(--color-brand-primary)] focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1"
            >
              <option value="desc">Invoice # ↓</option>
              <option value="asc">Invoice # ↑</option>
            </select>
          </div>

          {searchingInvoices ? (
            <div className="mb-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-[12px] font-medium text-blue-800">
              Searching all outstanding and paid invoices
            </div>
          ) : (
            <div
              role="group"
              aria-label="Invoice history mode"
              className="mb-3 grid grid-cols-2 rounded-xl border border-[var(--color-border-hairline)] bg-slate-50 p-1"
            >
              {(
                [
                  { key: "outstanding", label: "Outstanding" },
                  { key: "paid", label: "Paid history" },
                ] as { key: InvoiceMode; label: string }[]
              ).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={invoiceMode === option.key}
                  onClick={() => setInvoiceMode(option.key)}
                  className={`min-h-11 rounded-lg px-3 py-2 text-[13px] font-bold transition-colors ${
                    invoiceMode === option.key
                      ? "bg-white text-[var(--color-text-primary)] shadow-sm"
                      : "text-[var(--color-text-secondary)]"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}

          {!searchingInvoices && invoiceMode === "outstanding" && (
            <div
              role="group"
              aria-label="Outstanding invoice filter"
              className="mb-3 flex gap-2 overflow-x-auto -mx-1 px-1"
            >
              {(
                [
                  { key: "pending", label: "All" },
                  { key: "overdue", label: "Overdue" },
                  { key: "partial", label: "Partial" },
                ] as { key: InvoiceFilter; label: string }[]
              ).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={invoiceFilter === option.key}
                  onClick={() => setInvoiceFilter(option.key)}
                  className={`min-h-11 whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] font-medium ${
                    invoiceFilter === option.key
                      ? "border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-white"
                      : "border-[var(--color-border-hairline)] bg-white text-[var(--color-text-secondary)]"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}

          <div
            className="mb-4 rounded-xl border border-[var(--color-border-hairline)] p-4"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {loading ? (
              <>
                <div className="h-4 w-36 animate-pulse rounded bg-black/[0.05]" />
                <div className="mt-2 h-7 w-28 animate-pulse rounded bg-black/[0.07]" />
              </>
            ) : searchingInvoices ? (
              <>
                <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                  Global search results
                </p>
                <p className="mt-0.5 text-[22px] font-bold tabular-nums text-[var(--color-text-primary)]">
                  {visibleInvoiceRows.length}{" "}
                  {visibleInvoiceRows.length === 1 ? "invoice" : "invoices"}
                </p>
                <p className="mt-0.5 text-[13px] text-[var(--color-text-secondary)]">
                  Across {invoicePartyCount}{" "}
                  {invoicePartyCount === 1 ? "party" : "parties"} · Outstanding and paid
                </p>
              </>
            ) : invoiceMode === "paid" ? (
              <>
                <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                  Paid history · All available
                </p>
                <p className="mt-0.5 text-[22px] font-bold tabular-nums text-[var(--color-text-primary)]">
                  {paidInvoiceRows.length}{" "}
                  {paidInvoiceRows.length === 1 ? "paid invoice" : "paid invoices"}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--color-border-hairline)] pt-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
                      Invoice value
                    </p>
                    <p className="mt-0.5 text-[15px] font-bold tabular-nums text-[var(--color-text-primary)]">
                      {fmtRupees(paidInvoiceValue)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
                      Recorded receipts
                    </p>
                    <p className="mt-0.5 text-[15px] font-bold tabular-nums text-[var(--color-status-green)]">
                      {fmtRupees(paidReceipts)}
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <>
                <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                  {invoiceFilter === "pending"
                    ? "Total outstanding"
                    : invoiceFilter === "overdue"
                      ? "Total overdue"
                      : "Total partial"}
                </p>
                <p className="mt-0.5 text-[22px] font-bold tabular-nums text-[var(--color-text-primary)]">
                  {fmtRupees(outstandingInvoiceTotal)}
                </p>
                <p className="mt-0.5 text-[13px] text-[var(--color-text-secondary)]">
                  {visibleInvoiceRows.length}{" "}
                  {visibleInvoiceRows.length === 1 ? "invoice" : "invoices"} · Across{" "}
                  {invoicePartyCount} {invoicePartyCount === 1 ? "party" : "parties"}
                </p>
              </>
            )}
          </div>

          {loading ? (
            <div className="overflow-hidden rounded-xl border border-[var(--color-border-hairline)] bg-white">
              {[0, 1, 2, 3].map((item) => (
                <div
                  key={item}
                  className="grid grid-cols-3 gap-3 border-b border-[var(--color-border-hairline)] px-3 py-4 last:border-b-0"
                >
                  <div className="h-4 animate-pulse rounded bg-black/[0.06]" />
                  <div className="h-4 animate-pulse rounded bg-black/[0.05]" />
                  <div className="h-4 animate-pulse rounded bg-black/[0.06]" />
                </div>
              ))}
            </div>
          ) : visibleInvoiceRows.length === 0 ? (
            <p className="text-[15px] italic text-[var(--color-text-secondary)]">
              {searchingInvoices
                ? `No invoices match “${normalizedInvoiceSearch}”.`
                : invoiceMode === "paid"
                  ? "No paid invoices are available."
                  : "No matching outstanding invoices."}
            </p>
          ) : (
            <InvoiceLedgerTable rows={visibleInvoiceRows} />
          )}
        </>
      )) : null}
    </div>
  );
}
