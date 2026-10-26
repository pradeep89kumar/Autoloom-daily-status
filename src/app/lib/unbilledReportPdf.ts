import type { RowInput } from "jspdf-autotable";

import type { MasterUnbilledRow } from "./sheetSync";
import {
  formatUnbilledRunoutDate,
  summarizeUnbilledReport,
  unbilledAgeDays,
  unbilledAgeLabel,
  unbilledReportScopeLabel,
  type UnbilledReportScope,
} from "./unbilledReport";

export interface UnbilledReportPdfOptions {
  scope: UnbilledReportScope;
  generatedAt: Date;
}

function formatPdfAmount(value: number): string {
  return `INR ${Math.round(value || 0).toLocaleString("en-IN")}`;
}

function formatPdfMeters(value: number): string {
  return Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

function reportDate(value: Date): string {
  return value.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function readyRunoutText(row: MasterUnbilledRow, asOf: Date): string {
  const age = unbilledAgeDays(row.latestRunout, asOf);
  if (age === null) return "Run-out date unavailable";
  return `Run-out ${formatUnbilledRunoutDate(row.latestRunout)}\n${unbilledAgeLabel(age)}`;
}

function tableEndY(doc: unknown, fallback: number): number {
  const withLastTable = doc as { lastAutoTable?: { finalY?: number } };
  return withLastTable.lastAutoTable?.finalY ?? fallback;
}

export async function buildUnbilledReportPdf(
  rows: MasterUnbilledRow[],
  options: UnbilledReportPdfOptions,
): Promise<Blob> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 12;
  const contentWidth = pageWidth - marginX * 2;
  const scopeLabel = unbilledReportScopeLabel(options.scope);
  const summary = summarizeUnbilledReport(rows);
  const title = "SAT unbilled report";

  doc.setProperties({
    title,
    subject: `${scopeLabel} report`,
    creator: "SAT Quality Control App",
  });

  doc.setFillColor(17, 24, 39);
  doc.rect(0, 0, pageWidth, 34, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text(title, marginX, 12);
  doc.setFontSize(10);
  doc.text(scopeLabel, marginX, 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(`Generated: ${reportDate(options.generatedAt)}`, marginX, 27);

  const gap = 3;
  const cardWidth = (contentWidth - gap * 2) / 3;
  const cards = [
    ["Designs", String(summary.designCount)],
    ["Produced metres", formatPdfMeters(summary.producedMeters)],
    ["Unbilled value", formatPdfAmount(summary.unbilledValue)],
  ];
  cards.forEach(([label, value], index) => {
    const x = marginX + index * (cardWidth + gap);
    doc.setFillColor(index === 2 ? 239 : 249, index === 2 ? 246 : 250, index === 2 ? 255 : 251);
    doc.setDrawColor(index === 2 ? 191 : 226, index === 2 ? 219 : 232, index === 2 ? 254 : 240);
    doc.roundedRect(x, 40, cardWidth, 17, 1.5, 1.5, "FD");
    doc.setTextColor(index === 2 ? 30 : 100, index === 2 ? 64 : 116, index === 2 ? 175 : 139);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.8);
    doc.text(label.toUpperCase(), x + 3, 46);
    doc.setTextColor(index === 2 ? 30 : 17, index === 2 ? 64 : 24, index === 2 ? 175 : 39);
    doc.setFontSize(index === 2 ? 9.2 : 11);
    doc.text(value, x + 3, 53.2, { maxWidth: cardWidth - 6 });
  });

  doc.setTextColor(71, 85, 105);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.4);
  doc.text(
    "Ready age is measured from the final run-out date. Running designs do not accrue billing age.",
    marginX,
    64,
    { maxWidth: contentWidth },
  );

  const body: RowInput[] = rows.map((row) => [
    row.customerDesign || "-",
    row.status === "ready"
      ? `READY TO BILL\n${readyRunoutText(row, options.generatedAt)}`
      : "RUNNING\nStill running",
    formatPdfMeters(row.producedMeters),
    formatPdfAmount(row.estimatedUnbilled),
  ]);

  autoTable(doc, {
    startY: 70,
    margin: { top: 18, right: marginX, bottom: 17, left: marginX },
    theme: "grid",
    head: [["Customer / design", "Status / run-out", "Produced m", "Unbilled value"]],
    body,
    foot: [
      [
        {
          content: "Report total",
          colSpan: 2,
          styles: { fontStyle: "bold", halign: "right" },
        },
        {
          content: formatPdfMeters(summary.producedMeters),
          styles: { fontStyle: "bold", halign: "right" },
        },
        {
          content: formatPdfAmount(summary.unbilledValue),
          styles: { fontStyle: "bold", halign: "right", textColor: [30, 64, 175] },
        },
      ],
    ],
    styles: {
      font: "helvetica",
      fontSize: 7.6,
      cellPadding: 2,
      textColor: [51, 65, 85],
      lineColor: [203, 213, 225],
      lineWidth: 0.12,
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: [241, 245, 249],
      textColor: [71, 85, 105],
      fontStyle: "bold",
      fontSize: 7.2,
    },
    footStyles: {
      fillColor: [239, 246, 255],
      textColor: [30, 64, 175],
      fontStyle: "bold",
      fontSize: 8,
    },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    columnStyles: {
      0: { cellWidth: 69, fontStyle: "bold", textColor: [17, 24, 39] },
      1: { cellWidth: 49 },
      2: { cellWidth: 28, halign: "right" },
      3: { cellWidth: 40, halign: "right", fontStyle: "bold", textColor: [30, 64, 175] },
    },
    showHead: "everyPage",
    showFoot: "lastPage",
    rowPageBreak: "avoid",
    didParseCell: (data) => {
      if (data.section !== "body") return;
      const row = rows[data.row.index];
      if (!row || data.column.index !== 1) return;
      data.cell.styles.fontStyle = "bold";
      data.cell.styles.textColor = row.status === "ready" ? [30, 64, 175] : [4, 120, 87];
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        doc.setTextColor(31, 41, 55);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.text(`${title} · ${scopeLabel}`, marginX, 10);
      }
      doc.setTextColor(100, 116, 139);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.text(`Page ${data.pageNumber}`, pageWidth - marginX, pageHeight - 7, { align: "right" });
    },
  });

  let noteY = tableEndY(doc, 90) + 7;
  if (noteY > pageHeight - 24) {
    doc.addPage();
    const notePageNumber = doc.getNumberOfPages();
    doc.setTextColor(31, 41, 55);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(`${title} · ${scopeLabel}`, marginX, 10);
    doc.setTextColor(100, 116, 139);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(`Page ${notePageNumber}`, pageWidth - marginX, pageHeight - 7, {
      align: "right",
    });
    noteY = 18;
  }
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(marginX, noteY, contentWidth, 16, 1.5, 1.5, "FD");
  doc.setTextColor(71, 85, 105);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.2);
  doc.text(
    "Values use Total value and metres use OK mtr from Paagu ID. Rows with an invoice number are excluded. Invoice amounts include 5% GST.",
    marginX + 3,
    noteY + 5.5,
    { maxWidth: contentWidth - 6 },
  );

  return doc.output("blob");
}
