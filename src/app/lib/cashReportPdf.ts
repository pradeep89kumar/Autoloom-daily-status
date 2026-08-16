import type { RowInput } from "jspdf-autotable";

import type { CashflowData, CashLedgerEntry } from "./sheetSync";

const FIRM_NAME = "Sri Aarumga Tex";

const ACCOUNT_LABEL: Record<string, string> = {
  tmb: "TMB",
  iobCa: "IOB CA",
  cashbookApp: "Cashbook App",
  cash: "Cash",
  iobCc: "IOB CC",
};

export interface CashReportPdfTotals {
  inflow: number;
  outflow: number;
  net: number;
  internal: number;
  count: number;
}

export interface CashReportPdfAccountStat {
  account: string;
  in: number;
  out: number;
  net: number;
}

export interface CashReportPdfGroup {
  date: string;
  entries: CashLedgerEntry[];
}

export interface CashReportPdfInput {
  periodStart: Date;
  periodEnd: Date;
  periodComplete: boolean;
  generatedAt: Date;
  totals: CashReportPdfTotals;
  accountStats: CashReportPdfAccountStat[];
  groups: CashReportPdfGroup[];
  cashflow: CashflowData | null;
}

function monthTitle(date: Date): string {
  return date.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function longDate(date: Date): string {
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function dayHeader(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "-";
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    weekday: "short",
  });
}

function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return `INR ${Math.abs(Math.round(value)).toLocaleString("en-IN")}`;
}

function formatSignedAmount(value: number): string {
  if (!Number.isFinite(value)) return "-";
  const sign = value < 0 ? "-" : "";
  return `${sign}INR ${Math.abs(Math.round(value)).toLocaleString("en-IN")}`;
}

function tableEndY(doc: unknown, fallback: number): number {
  const withLastTable = doc as { lastAutoTable?: { finalY?: number } };
  return withLastTable.lastAutoTable?.finalY ?? fallback;
}

export function cashReportFilename(periodStart: Date): string {
  const year = periodStart.getFullYear();
  const month = String(periodStart.getMonth() + 1).padStart(2, "0");
  return `sat-cash-report-${year}-${month}.pdf`;
}

export async function buildCashReportPdf(input: CashReportPdfInput): Promise<Blob> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const left = 14;
  const right = 14;
  const contentWidth = pageWidth - left - right;
  const monthLabel = monthTitle(input.periodStart);
  const generatedLabel = input.generatedAt.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  doc.setProperties({
    title: `SAT monthly cash report - ${monthLabel}`,
    subject: `Cash position and cash movements for ${monthLabel}`,
    creator: "SAT Quality Control App",
  });

  doc.setFillColor(17, 24, 39);
  doc.rect(0, 0, pageWidth, 32, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text(FIRM_NAME, left, 11);
  doc.setFontSize(11);
  doc.text(`Monthly Cash Report - ${monthLabel}`, left, 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.2);
  const periodSuffix = input.periodComplete ? "" : " (in progress)";
  doc.text(
    `Period: ${longDate(input.periodStart)} - ${longDate(input.periodEnd)}${periodSuffix}`,
    left,
    24,
  );
  doc.text(`Generated: ${generatedLabel}`, left, 29);

  const cardGap = 3;
  const cardWidth = (contentWidth - cardGap * 3) / 4;
  const summaryCards = [
    ["Cash in", formatAmount(input.totals.inflow)],
    ["Cash out", formatAmount(input.totals.outflow)],
    ["Net movement", formatSignedAmount(input.totals.net)],
    ["Entries", String(input.totals.count)],
  ];
  summaryCards.forEach(([label, value], index) => {
    const x = left + index * (cardWidth + cardGap);
    doc.setFillColor(249, 250, 251);
    doc.setDrawColor(209, 213, 219);
    doc.roundedRect(x, 38, cardWidth, 18, 1.5, 1.5, "FD");
    doc.setTextColor(107, 114, 128);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.2);
    doc.text(label.toUpperCase(), x + 3, 44);
    doc.setTextColor(17, 24, 39);
    doc.setFontSize(index === 3 ? 12 : 9.5);
    doc.text(value, x + 3, 51.5, { maxWidth: cardWidth - 6 });
  });

  let cursorY = 63;
  if (input.totals.internal > 0) {
    doc.setTextColor(107, 114, 128);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.8);
    doc.text(
      `Summary excludes ${formatAmount(input.totals.internal)} of internal transfers between own accounts.`,
      left,
      cursorY,
    );
    cursorY += 6;
  }

  const addSectionHeading = (title: string, requestedY: number): number => {
    let y = requestedY;
    if (y > pageHeight - 30) {
      doc.addPage();
      y = 16;
    }
    doc.setTextColor(55, 65, 81);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.text(title.toUpperCase(), left, y);
    return y + 3;
  };

  if (input.cashflow) {
    const cashflow = input.cashflow;
    cursorY = addSectionHeading(
      `Current cash position - live as of ${longDate(new Date(cashflow.asOfDate))}`,
      cursorY,
    );

    autoTable(doc, {
      startY: cursorY,
      margin: { left, right, bottom: 16 },
      theme: "grid",
      head: [["Account", "Balance"]],
      body: [
        [
          {
            content: "Total available - all accounts, CC headroom included",
            styles: { fontStyle: "bold", fillColor: [239, 246, 255] },
          },
          {
            content: formatAmount(cashflow.totalAvailable),
            styles: {
              halign: "right",
              fontStyle: "bold",
              fillColor: [239, 246, 255],
              textColor: [30, 64, 175],
            },
          },
        ],
        ["TMB", formatAmount(cashflow.balances.tmb)],
        ["IOB Current", formatAmount(cashflow.balances.iobCa)],
        ["Cashbook App", formatAmount(cashflow.balances.cashbookApp)],
        ["Cash", formatAmount(cashflow.balances.cash)],
        [
          `IOB CC available (limit ${formatAmount(cashflow.balances.iobCcLimit)}; used ${formatAmount(cashflow.balances.iobCcUsed)})`,
          formatAmount(cashflow.balances.iobCcAvailable),
        ],
      ],
      styles: {
        font: "helvetica",
        fontSize: 8.2,
        cellPadding: 2,
        textColor: [31, 41, 55],
        lineColor: [209, 213, 219],
        lineWidth: 0.15,
        overflow: "linebreak",
        valign: "middle",
      },
      headStyles: {
        fillColor: [243, 244, 246],
        textColor: [55, 65, 81],
        fontStyle: "bold",
      },
      columnStyles: {
        0: { cellWidth: contentWidth - 45 },
        1: { cellWidth: 45, halign: "right" },
      },
      pageBreak: "avoid",
    });
    cursorY = tableEndY(doc, cursorY + 42) + 9;
  }

  cursorY = addSectionHeading(`By account - ${monthLabel}`, cursorY);
  const accountBody: RowInput[] = input.accountStats.length
    ? input.accountStats.map((account) => [
        ACCOUNT_LABEL[account.account] || account.account,
        account.in > 0 ? formatAmount(account.in) : "-",
        account.out < 0 ? formatAmount(account.out) : "-",
        formatSignedAmount(account.net),
      ])
    : [[{ content: "No cash movement recorded this month.", colSpan: 4 }]];

  autoTable(doc, {
    startY: cursorY,
    margin: { left, right, bottom: 16 },
    theme: "grid",
    head: [["Account", "In", "Out", "Net"]],
    body: accountBody,
    foot: input.accountStats.length
      ? [
          [
            { content: "Total", styles: { fontStyle: "bold" } },
            { content: formatAmount(input.totals.inflow), styles: { fontStyle: "bold" } },
            { content: formatAmount(input.totals.outflow), styles: { fontStyle: "bold" } },
            { content: formatSignedAmount(input.totals.net), styles: { fontStyle: "bold" } },
          ],
        ]
      : [],
    styles: {
      font: "helvetica",
      fontSize: 8.2,
      cellPadding: 2,
      textColor: [31, 41, 55],
      lineColor: [209, 213, 219],
      lineWidth: 0.15,
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: [243, 244, 246],
      textColor: [55, 65, 81],
      fontStyle: "bold",
    },
    footStyles: {
      fillColor: [249, 250, 251],
      textColor: [31, 41, 55],
    },
    columnStyles: {
      0: { cellWidth: contentWidth - 105 },
      1: { cellWidth: 35, halign: "right" },
      2: { cellWidth: 35, halign: "right" },
      3: { cellWidth: 35, halign: "right" },
    },
    pageBreak: "avoid",
  });
  cursorY = tableEndY(doc, cursorY + 30) + 9;

  cursorY = addSectionHeading("Statement", cursorY);
  const statementBody: RowInput[] = [];
  for (const group of input.groups) {
    statementBody.push([
      {
        content: dayHeader(group.date).toUpperCase(),
        colSpan: 4,
        styles: {
          fillColor: [249, 250, 251],
          textColor: [75, 85, 99],
          fontStyle: "bold",
        },
      },
    ]);
    for (const entry of group.entries) {
      const textColor: [number, number, number] = entry.internal
        ? [107, 114, 128]
        : [31, 41, 55];
      statementBody.push([
        {
          content: `${entry.description || "-"}${entry.internal ? " (internal)" : ""}`,
          styles: { textColor },
        },
        {
          content: ACCOUNT_LABEL[entry.account] || entry.account,
          styles: { textColor },
        },
        {
          content: entry.amount > 0 ? formatAmount(entry.amount) : "",
          styles: { textColor, halign: "right" },
        },
        {
          content: entry.amount < 0 ? formatAmount(entry.amount) : "",
          styles: { textColor, halign: "right" },
        },
      ]);
    }
  }
  if (statementBody.length === 0) {
    statementBody.push([{ content: "No entries this month.", colSpan: 4 }]);
  }

  let activeStatementDate = "";
  const labeledContinuationPages = new Set<number>();

  autoTable(doc, {
    startY: cursorY,
    margin: { top: 14, left, right, bottom: 16 },
    theme: "grid",
    head: [["Particulars", "Account", "In", "Out"]],
    body: statementBody,
    foot: input.groups.length
      ? [
          [
            { content: "Total (excludes internal transfers)", colSpan: 2, styles: { fontStyle: "bold" } },
            { content: formatAmount(input.totals.inflow), styles: { fontStyle: "bold" } },
            { content: formatAmount(input.totals.outflow), styles: { fontStyle: "bold" } },
          ],
          [
            { content: "Net movement", colSpan: 3, styles: { fontStyle: "bold" } },
            { content: formatSignedAmount(input.totals.net), styles: { fontStyle: "bold" } },
          ],
        ]
      : [],
    styles: {
      font: "helvetica",
      fontSize: 7.8,
      cellPadding: 1.8,
      textColor: [31, 41, 55],
      lineColor: [229, 231, 235],
      lineWidth: 0.12,
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: [243, 244, 246],
      textColor: [55, 65, 81],
      fontStyle: "bold",
    },
    footStyles: {
      fillColor: [249, 250, 251],
      textColor: [31, 41, 55],
      halign: "right",
    },
    columnStyles: {
      0: { cellWidth: contentWidth - 105 },
      1: { cellWidth: 35 },
      2: { cellWidth: 35, halign: "right" },
      3: { cellWidth: 35, halign: "right" },
    },
    showHead: "everyPage",
    showFoot: "lastPage",
    rowPageBreak: "avoid",
    willDrawCell: (data) => {
      if (data.section !== "body" || data.column.index !== 0) return;

      const isDateHeading = data.cell.colSpan === 4;
      if (isDateHeading) {
        activeStatementDate = data.cell.text.join(" ");
      }

      if (
        data.pageNumber <= 1 ||
        isDateHeading ||
        !activeStatementDate ||
        labeledContinuationPages.has(data.pageNumber)
      ) {
        return;
      }

      labeledContinuationPages.add(data.pageNumber);
      const previousFont = doc.getFont();
      const previousFontSize = doc.getFontSize();
      const previousTextColor = doc.getTextColor();
      const previousFillColor = doc.getFillColor();
      const previousDrawColor = doc.getDrawColor();
      const previousLineWidth = doc.getLineWidth();
      doc.setFillColor(249, 250, 251);
      doc.rect(left, 5, contentWidth, 6.5, "F");
      doc.setTextColor(75, 85, 99);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.8);
      doc.text(`Statement - ${activeStatementDate} continued`, left + 2, 9.4);
      doc.setFont(previousFont.fontName, previousFont.fontStyle);
      doc.setFontSize(previousFontSize);
      doc.setTextColor(previousTextColor);
      doc.setFillColor(previousFillColor);
      doc.setDrawColor(previousDrawColor);
      doc.setLineWidth(previousLineWidth);
    },
  });

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(229, 231, 235);
    doc.line(left, pageHeight - 11, pageWidth - right, pageHeight - 11);
    doc.setTextColor(107, 114, 128);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.2);
    doc.text(`${FIRM_NAME} - Confidential - for internal use only.`, left, pageHeight - 6.5);
    doc.text(`Page ${page} of ${pageCount}`, pageWidth - right, pageHeight - 6.5, {
      align: "right",
    });
  }

  return doc.output("blob");
}
