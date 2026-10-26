import type { MasterUnbilledRow } from "./sheetSync";

export type UnbilledReportScope = "all" | "running" | "ready";

export interface UnbilledReportSummary {
  designCount: number;
  producedMeters: number;
  unbilledValue: number;
  readyValue: number;
  runningValue: number;
}

function ymdParts(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function parseUnbilledReportScope(value: string | null): UnbilledReportScope {
  return value === "all" || value === "running" || value === "ready" ? value : "ready";
}

export function unbilledReportScopeLabel(scope: UnbilledReportScope): string {
  if (scope === "all") return "All unbilled production";
  if (scope === "running") return "Running";
  return "Ready to bill";
}

export function selectUnbilledReportRows(
  rows: MasterUnbilledRow[],
  scope: UnbilledReportScope,
): MasterUnbilledRow[] {
  if (scope === "all") return [...rows];
  return rows.filter((row) => row.status === scope);
}

export function summarizeUnbilledReport(rows: MasterUnbilledRow[]): UnbilledReportSummary {
  return rows.reduce<UnbilledReportSummary>(
    (summary, row) => {
      summary.designCount += 1;
      summary.producedMeters += row.producedMeters;
      summary.unbilledValue += row.estimatedUnbilled;
      if (row.status === "ready") summary.readyValue += row.estimatedUnbilled;
      else summary.runningValue += row.estimatedUnbilled;
      return summary;
    },
    {
      designCount: 0,
      producedMeters: 0,
      unbilledValue: 0,
      readyValue: 0,
      runningValue: 0,
    },
  );
}

export function formatUnbilledRunoutDate(value: string): string {
  const parts = ymdParts(value);
  if (!parts) return "—";
  return `${String(parts.day).padStart(2, "0")}/${String(parts.month).padStart(2, "0")}/${parts.year}`;
}

export function unbilledAgeDays(value: string, asOf: Date): number | null {
  const parts = ymdParts(value);
  if (!parts || Number.isNaN(asOf.getTime())) return null;
  const runoutUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  const asOfUtc = Date.UTC(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  const days = Math.floor((asOfUtc - runoutUtc) / 86_400_000);
  return days >= 0 ? days : null;
}

export function unbilledAgeLabel(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"} unbilled`;
}

export function unbilledReportFilename(
  scope: UnbilledReportScope,
  generatedAt: Date,
): string {
  const year = generatedAt.getFullYear();
  const month = String(generatedAt.getMonth() + 1).padStart(2, "0");
  const day = String(generatedAt.getDate()).padStart(2, "0");
  return `sat-unbilled-report-${scope}-${year}-${month}-${day}.pdf`;
}
