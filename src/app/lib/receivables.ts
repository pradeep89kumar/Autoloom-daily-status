import type { ReceivableRow } from "./sheetSync";

export type ReceivableFilterKey =
  | "all"
  | "pending"
  | "overdue"
  | "partial"
  | "unbilled"
  | "advance";

export type ReceivableStatusKind = "unbilled" | "advance" | "paid" | "partial" | "pending";

export type ReceivablesReportScope = "outstanding" | "overdue" | "not-due";
export type ReceivablesReportPaymentStatus = "all" | "pending" | "partial";

export interface ReceivablePartyGroup {
  key: string;
  party: string;
  total: number;
  advance: number;
  count: number;
  overdue: number;
  rows: ReceivableRow[];
}

// Bill amount is GST-inclusive (5%, mostly uniform). Per CBDT Circular 23/2017,
// TDS is deducted on the taxable value (pre-GST), not on the GST.
const GST_RATE = 0.05;
const TDS_RATE = 0.02;

export function netAfterTds(amount: number): number {
  const taxableBase = amount / (1 + GST_RATE);
  const tds = taxableBase * TDS_RATE;
  return Math.round(amount - tds);
}

export function receivableDateFromYmd(value: string): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

export function formatReceivableDate(value: string): string {
  const date = receivableDateFromYmd(value);
  if (!date) return "—";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear()).slice(-2);
  return `${day}/${month}/${year}`;
}

export function receivableAgeDays(value: string): number | null {
  const date = receivableDateFromYmd(value);
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - date.getTime()) / 86400000);
}

// A real invoice number is neither blank nor a placeholder used before billing.
export function hasRealInvoice(row: ReceivableRow): boolean {
  const invoice = (row.invoiceNumber || "").trim().toLowerCase();
  if (!invoice) return false;
  if (
    invoice.includes("not created") ||
    invoice.includes("no invoice") ||
    invoice.includes("not yet")
  ) {
    return false;
  }
  return true;
}

export function advanceAmount(row: ReceivableRow): number {
  return !hasRealInvoice(row) ? row.receipts || 0 : 0;
}

export function receivablePartyKey(party?: string): string {
  return (party || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function effectivePending(row: ReceivableRow): number {
  if (!hasRealInvoice(row)) return 0;
  const status = (row.paymentStatus || row.status || "").toLowerCase();
  if (status.includes("paid") && !status.includes("partial") && !status.includes("unpaid")) {
    return 0;
  }
  if (row.invoiceAmount > 0) {
    return Math.max(0, row.invoiceAmount - (row.receipts || 0));
  }
  return row.pendingBalance;
}

export function receivableStatusKind(row: ReceivableRow): ReceivableStatusKind {
  const status = (row.paymentStatus || row.status || "").toLowerCase();
  if (!hasRealInvoice(row)) {
    return (row.receipts || 0) > 0 ? "advance" : "unbilled";
  }
  if (status.includes("paid") && !status.includes("partial") && !status.includes("unpaid")) {
    return "paid";
  }
  if (status.includes("partial")) return "partial";
  if (effectivePending(row) <= 0 && row.invoiceAmount > 0) return "paid";
  return "pending";
}

// Keep this definition in one place: overdue means a due date before today and
// a positive effective pending amount, using the existing Receivables behavior.
export function isOverdueReceivable(row: ReceivableRow): boolean {
  const kind = receivableStatusKind(row);
  if (kind === "paid" || kind === "unbilled") return false;
  const overdueDays = receivableAgeDays(row.dueDate);
  return overdueDays !== null && overdueDays > 0 && effectivePending(row) > 0;
}

export function isOutstandingReceivable(row: ReceivableRow): boolean {
  const kind = receivableStatusKind(row);
  return (
    hasRealInvoice(row) &&
    (kind === "pending" || kind === "partial") &&
    effectivePending(row) > 0
  );
}

export function isNotYetDueReceivable(row: ReceivableRow): boolean {
  if (!isOutstandingReceivable(row)) return false;
  const dueDays = receivableAgeDays(row.dueDate);
  return dueDays !== null && dueDays <= 0;
}

export function receivableDuePosition(row: ReceivableRow): string {
  const dueDays = receivableAgeDays(row.dueDate);
  if (dueDays === null) return "No due date";
  if (dueDays > 0) return `Overdue ${dueDays} ${dueDays === 1 ? "day" : "days"}`;
  if (dueDays === 0) return "Due today";
  const daysUntilDue = Math.abs(dueDays);
  return `Due in ${daysUntilDue} ${daysUntilDue === 1 ? "day" : "days"}`;
}

export function filterReceivableRows(
  rows: ReceivableRow[],
  filter: ReceivableFilterKey,
): ReceivableRow[] {
  return rows.filter((row) => {
    const kind = receivableStatusKind(row);
    if (filter === "all") return true;
    if (filter === "unbilled") return kind === "unbilled";
    if (filter === "advance") return kind === "advance";
    if (filter === "partial") return kind === "partial";
    if (filter === "pending") return kind === "pending" || kind === "partial";
    if (filter === "overdue") return isOverdueReceivable(row);
    return true;
  });
}

export function mergeReceivableRows(filtered: ReceivableRow[]): ReceivableRow[] {
  const byInvoice = new Map<string, ReceivableRow>();
  const byAdvance = new Map<string, ReceivableRow>();
  const passthrough: ReceivableRow[] = [];

  for (const row of filtered) {
    if (!hasRealInvoice(row)) {
      if ((row.receipts || 0) > 0) {
        const design = (
          (row.orderId || "").trim() || (row.customerName || "").trim()
        ).toLowerCase();
        const advanceKey = `${receivablePartyKey(row.party)}||adv||${design}`;
        const previous = byAdvance.get(advanceKey);
        if (!previous) {
          byAdvance.set(advanceKey, { ...row });
          continue;
        }
        previous.receipts = (previous.receipts || 0) + (row.receipts || 0);
        previous.pendingBalance =
          (previous.pendingBalance || 0) + (row.pendingBalance || 0);
        const previousReceived =
          receivableDateFromYmd(previous.receivedOn)?.getTime() ?? -Infinity;
        const rowReceived = receivableDateFromYmd(row.receivedOn)?.getTime() ?? -Infinity;
        if (rowReceived > previousReceived && row.receivedOn) {
          previous.receivedOn = row.receivedOn;
        }
        const previousLoom = previous.loadedLoom || previous.loomNumber || "";
        const rowLoom = row.loadedLoom || row.loomNumber || "";
        if (previousLoom && rowLoom && !previousLoom.includes(rowLoom)) {
          previous.loadedLoom = `${previousLoom}, ${rowLoom}`;
        }
        if (previous.paaguId && row.paaguId && !previous.paaguId.includes(row.paaguId)) {
          previous.paaguId = `${previous.paaguId}, ${row.paaguId}`;
        }
        continue;
      }
      passthrough.push(row);
      continue;
    }

    const invoiceNumber = (row.invoiceNumber || "").trim();
    const key = `${receivablePartyKey(row.party)}||${invoiceNumber}`;
    const previous = byInvoice.get(key);
    if (!previous) {
      byInvoice.set(key, { ...row });
      continue;
    }

    previous.invoiceAmount = (previous.invoiceAmount || 0) + (row.invoiceAmount || 0);
    previous.receipts = (previous.receipts || 0) + (row.receipts || 0);
    previous.pendingBalance = (previous.pendingBalance || 0) + (row.pendingBalance || 0);

    const previousInvoice =
      receivableDateFromYmd(previous.invoiceDate)?.getTime() ?? Infinity;
    const rowInvoice = receivableDateFromYmd(row.invoiceDate)?.getTime() ?? Infinity;
    if (rowInvoice < previousInvoice && row.invoiceDate) previous.invoiceDate = row.invoiceDate;

    const previousDue = receivableDateFromYmd(previous.dueDate)?.getTime() ?? -Infinity;
    const rowDue = receivableDateFromYmd(row.dueDate)?.getTime() ?? -Infinity;
    if (rowDue > previousDue && row.dueDate) previous.dueDate = row.dueDate;

    const previousReceived =
      receivableDateFromYmd(previous.receivedOn)?.getTime() ?? -Infinity;
    const rowReceived = receivableDateFromYmd(row.receivedOn)?.getTime() ?? -Infinity;
    if (rowReceived > previousReceived && row.receivedOn) previous.receivedOn = row.receivedOn;

    if (!previous.paymentStatus && row.paymentStatus) previous.paymentStatus = row.paymentStatus;
    if (!previous.status && row.status) previous.status = row.status;

    const previousCustomer = previous.customerName || previous.designDetails || "";
    const rowCustomer = row.customerName || row.designDetails || "";
    if (previousCustomer && rowCustomer && !previousCustomer.includes(rowCustomer)) {
      previous.customerName = `${previousCustomer}, ${rowCustomer}`;
    }

    const previousLoom = previous.loadedLoom || previous.loomNumber || "";
    const rowLoom = row.loadedLoom || row.loomNumber || "";
    if (previousLoom && rowLoom && !previousLoom.includes(rowLoom)) {
      previous.loadedLoom = `${previousLoom}, ${rowLoom}`;
    }

    if (previous.paaguId && row.paaguId && !previous.paaguId.includes(row.paaguId)) {
      previous.paaguId = `${previous.paaguId}, ${row.paaguId}`;
    }
  }

  return [
    ...Array.from(byInvoice.values()),
    ...Array.from(byAdvance.values()),
    ...passthrough,
  ];
}

export function groupReceivableRows(merged: ReceivableRow[]): ReceivablePartyGroup[] {
  const map = new Map<string, ReceivablePartyGroup>();

  for (const row of merged) {
    const key = receivablePartyKey(row.party);
    if (!key) continue;
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        party: (row.party || "").trim(),
        total: 0,
        advance: 0,
        count: 0,
        overdue: 0,
        rows: [],
      };
      map.set(key, group);
    }
    group.total += effectivePending(row);
    group.advance += advanceAmount(row);
    group.count += 1;
    if (isOverdueReceivable(row)) group.overdue += 1;
    group.rows.push(row);
  }

  const groups = Array.from(map.values());
  groups.sort((a, b) => b.total - a.total);
  for (const group of groups) {
    group.rows.sort((a, b) => {
      const first = receivableDateFromYmd(a.invoiceDate)?.getTime() ?? 0;
      const second = receivableDateFromYmd(b.invoiceDate)?.getTime() ?? 0;
      return second - first;
    });
  }
  return groups;
}

export function selectReceivables(rows: ReceivableRow[], filter: ReceivableFilterKey) {
  const filtered = filterReceivableRows(rows, filter);
  // Preserve the existing screen order: filter first, then merge matching rows.
  const merged = mergeReceivableRows(filtered);
  const grouped = groupReceivableRows(merged);
  const grandTotal = grouped.reduce((sum, group) => sum + group.total, 0);
  const grandAdvance = grouped.reduce((sum, group) => sum + group.advance, 0);

  return { filtered, merged, grouped, grandTotal, grandAdvance };
}

export function selectReceivablesReport(
  rows: ReceivableRow[],
  scope: ReceivablesReportScope,
  paymentStatus: ReceivablesReportPaymentStatus,
) {
  // Keep the established overdue pipeline untouched. The broader report scopes
  // start from the existing Pending population, which already includes Partial.
  const baseMerged =
    scope === "overdue"
      ? selectReceivables(rows, "overdue").merged
      : selectReceivables(rows, "pending").merged.filter((row) =>
          scope === "not-due"
            ? isNotYetDueReceivable(row)
            : isOutstandingReceivable(row),
        );

  const merged = baseMerged.filter((row) => {
    if (paymentStatus === "all") return true;
    return receivableStatusKind(row) === paymentStatus;
  });
  const grouped = groupReceivableRows(merged);
  const grandTotal = grouped.reduce((sum, group) => sum + group.total, 0);

  return { merged, grouped, grandTotal };
}
