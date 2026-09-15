import type { ReceivableRow } from "./sheetSync";
import {
  effectivePending,
  formatReceivableDate,
  isNotYetDueReceivable,
  isOverdueReceivable,
  receivableDueBadge,
  receivablePaymentBadge,
  type ReceivablePartyGroup,
  type ReceivableBadgeTone,
  type ReceivablesReportPaymentStatus,
  type ReceivablesReportScope,
} from "./receivables";

export interface ReceivablesReportPdfOptions {
  scope: ReceivablesReportScope;
  paymentStatus: ReceivablesReportPaymentStatus;
  partyLabel: string;
  generatedAt: Date;
  allParties: boolean;
}

function formatPdfAmount(value: number): string {
  return `INR ${Math.round(value || 0).toLocaleString("en-IN")}`;
}

function displayDesign(row: ReceivableRow): string {
  return (row.customerName || row.designDetails || row.orderId || "-").trim();
}

function formatPdfDate(value: string): string {
  const formatted = formatReceivableDate(value);
  return formatted === "—" ? "-" : formatted;
}

type PdfRgb = [number, number, number];

const PDF_BADGE_COLORS: Record<
  ReceivableBadgeTone,
  { fill: PdfRgb; border: PdfRgb; text: PdfRgb }
> = {
  danger: {
    fill: [254, 242, 242],
    border: [185, 28, 28],
    text: [153, 27, 27],
  },
  warning: {
    fill: [255, 251, 235],
    border: [180, 83, 9],
    text: [146, 64, 14],
  },
  info: {
    fill: [239, 246, 255],
    border: [37, 99, 235],
    text: [30, 64, 175],
  },
  neutral: {
    fill: [248, 250, 252],
    border: [100, 116, 139],
    text: [51, 65, 85],
  },
};

export function receivablesReportTitle(scope: ReceivablesReportScope): string {
  return scope === "overdue" ? "SAT overdue report" : "SAT outstanding report";
}

export function receivablesReportScopeLabel(scope: ReceivablesReportScope): string {
  if (scope === "overdue") return "Overdue";
  if (scope === "not-due") return "Not yet due";
  return "Full outstanding";
}

export function receivablesReportPaymentLabel(
  paymentStatus: ReceivablesReportPaymentStatus,
): string {
  if (paymentStatus === "pending") return "Pending";
  if (paymentStatus === "partial") return "Partial";
  return "All outstanding";
}

export function receivablesReportFilename(
  scope: ReceivablesReportScope,
  paymentStatus: ReceivablesReportPaymentStatus,
  partyLabel: string,
  generatedAt: Date,
): string {
  const scopeSlug =
    scope === "overdue"
      ? "overdue"
      : scope === "not-due"
        ? "not-yet-due"
        : "full-outstanding";
  const statusSlug = paymentStatus === "all" ? "all-statuses" : paymentStatus;
  const partySlug = partyLabel === "All parties" ? "all-parties" : "selected-party";
  const year = generatedAt.getFullYear();
  const month = String(generatedAt.getMonth() + 1).padStart(2, "0");
  const day = String(generatedAt.getDate()).padStart(2, "0");
  return `sat-${scopeSlug}-report-${partySlug}-${statusSlug}-${year}-${month}-${day}.pdf`;
}

export async function buildReceivablesReportPdf(
  groups: ReceivablePartyGroup[],
  options: ReceivablesReportPdfOptions,
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
  const contentBottom = pageHeight - 17;
  const title = receivablesReportTitle(options.scope);
  const scopeLabel = receivablesReportScopeLabel(options.scope);
  const paymentLabel = receivablesReportPaymentLabel(options.paymentStatus);
  const allRows = groups.flatMap((group) => group.rows);
  const totalInvoices = allRows.length;
  const totalOutstanding = groups.reduce((sum, group) => sum + group.total, 0);
  const overdueAmount = allRows.reduce(
    (sum, row) => sum + (isOverdueReceivable(row) ? effectivePending(row) : 0),
    0,
  );
  const notDueAmount = allRows.reduce(
    (sum, row) => sum + (isNotYetDueReceivable(row) ? effectivePending(row) : 0),
    0,
  );
  const generatedLabel = options.generatedAt.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  doc.setProperties({
    title,
    subject: `${scopeLabel} receivables - ${options.partyLabel} - ${paymentLabel}`,
    creator: "SAT Quality Control App",
  });

  const fitText = (value: string, maxWidth: number): string => {
    if (doc.getTextWidth(value) <= maxWidth) return value;
    let shortened = value;
    while (shortened.length > 1 && doc.getTextWidth(`${shortened}...`) > maxWidth) {
      shortened = shortened.slice(0, -1);
    }
    return `${shortened.trimEnd()}...`;
  };

  const badgeHeight = 5.4;
  const dueBadgeCellMinHeight = 8.2;
  const statusBadgeCellMinHeight = 12.3;
  const drawBadge = (
    label: string,
    tone: ReceivableBadgeTone,
    cell: { x: number; y: number; width: number; height: number },
    placement: "center" | "below-amount",
  ) => {
    const previousFont = doc.getFont();
    const previousFontSize = doc.getFontSize();
    const previousTextColor = doc.getTextColor();
    const previousFillColor = doc.getFillColor();
    const previousDrawColor = doc.getDrawColor();
    const previousLineWidth = doc.getLineWidth();
    const palette = PDF_BADGE_COLORS[tone];

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.3);
    const maxWidth = Math.max(8, cell.width - 2.8);
    const visibleLabel = fitText(label, maxWidth - 2.8);
    const badgeWidth = Math.min(maxWidth, doc.getTextWidth(visibleLabel) + 2.8);
    const badgeX =
      placement === "below-amount"
        ? cell.x + cell.width - 1.4 - badgeWidth
        : cell.x + (cell.width - badgeWidth) / 2;
    const badgeY =
      placement === "below-amount"
        ? Math.min(cell.y + 5, cell.y + cell.height - 1.3 - badgeHeight)
        : cell.y + (cell.height - badgeHeight) / 2;

    doc.setFillColor(...palette.fill);
    doc.setDrawColor(...palette.border);
    doc.setLineWidth(0.28);
    doc.roundedRect(badgeX, badgeY, badgeWidth, badgeHeight, 1.2, 1.2, "FD");
    doc.setTextColor(...palette.text);
    doc.text(visibleLabel, badgeX + badgeWidth / 2, badgeY + 3.55, { align: "center" });

    doc.setFont(previousFont.fontName, previousFont.fontStyle);
    doc.setFontSize(previousFontSize);
    doc.setTextColor(previousTextColor);
    doc.setFillColor(previousFillColor);
    doc.setDrawColor(previousDrawColor);
    doc.setLineWidth(previousLineWidth);
  };

  const drawFirstPageHeader = () => {
    doc.setFillColor(31, 41, 55);
    doc.rect(0, 0, pageWidth, 37, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.text(title, marginX, 11.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text(`Scope: ${scopeLabel}`, marginX, 19);
    doc.text(`Party: ${fitText(options.partyLabel, contentWidth - 13)}`, marginX, 25);
    doc.text(
      fitText(`Payment status: ${paymentLabel} | Generated: ${generatedLabel}`, contentWidth),
      marginX,
      31,
    );
  };

  const drawSummaryCard = (
    x: number,
    y: number,
    width: number,
    label: string,
    value: string,
    accent = false,
  ) => {
    doc.setFillColor(...(accent ? ([239, 246, 255] as const) : ([249, 250, 251] as const)));
    doc.setDrawColor(...(accent ? ([191, 219, 254] as const) : ([229, 231, 235] as const)));
    doc.roundedRect(x, y, width, 13, 1.8, 1.8, "FD");
    doc.setTextColor(...(accent ? ([30, 64, 175] as const) : ([107, 114, 128] as const)));
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text(label.toUpperCase(), x + 3, y + 4.5);
    doc.setTextColor(...(accent ? ([30, 64, 175] as const) : ([17, 24, 39] as const)));
    doc.setFontSize(10.5);
    doc.text(fitText(value, width - 6), x + 3, y + 10.3);
  };

  const summaryGap = 3;
  const summaryWidth = (contentWidth - summaryGap) / 2;
  const drawSummary = () => {
    drawSummaryCard(
      marginX,
      42,
      summaryWidth,
      "Parties / invoices",
      `${groups.length} / ${totalInvoices}`,
    );
    drawSummaryCard(
      marginX + summaryWidth + summaryGap,
      42,
      summaryWidth,
      "Total outstanding",
      formatPdfAmount(totalOutstanding),
      true,
    );
    drawSummaryCard(marginX, 58, summaryWidth, "Overdue", formatPdfAmount(overdueAmount));
    drawSummaryCard(
      marginX + summaryWidth + summaryGap,
      58,
      summaryWidth,
      "Not yet due",
      formatPdfAmount(notDueAmount),
    );
  };

  const drawContinuationPageHeader = () => {
    doc.setFillColor(31, 41, 55);
    doc.rect(0, 0, pageWidth, 16, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.text(title, marginX, 7.2);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(fitText(`${scopeLabel} | ${options.partyLabel} | ${paymentLabel}`, contentWidth), marginX, 12.2);
  };

  const addContentPage = (): number => {
    doc.addPage();
    drawContinuationPageHeader();
    return 20;
  };

  drawFirstPageHeader();
  drawSummary();
  let cursorY = 76;

  const tableColumnWidths = [23, 48, 33, 23, 31, 28];
  const tableBodyFontSize = 7.4;
  const tableCellPadding = 1.7;
  const invoiceMinimumFontSize = 6.5;
  const invoiceTwoLineMinimumFontSize = 4.5;
  const tableHeadLabels = [
    "Invoice",
    "Design / customer",
    "Dates",
    "Due position",
    "Bill / received",
    "Outstanding / status",
  ];
  const pointsToMm = 25.4 / 72;
  const measureCellHeight = (
    value: string,
    width: number,
    fontSize: number,
    padding: number,
    fontStyle: "normal" | "bold" = "normal",
  ): number => {
    doc.setFont("helvetica", fontStyle);
    doc.setFontSize(fontSize);
    const lines = doc.splitTextToSize(value || "-", Math.max(1, width - padding * 2));
    const lineHeight = fontSize * doc.getLineHeightFactor() * pointsToMm;
    return Math.max(1, lines.length) * lineHeight + padding * 2;
  };

  const measureInvoiceWidth = (value: string, fontSize: number): number => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(fontSize);
    return doc.getTextWidth(value);
  };

  const fitInvoiceFontSize = (
    lines: string[],
    availableWidth: number,
    minimumFontSize: number,
  ): number => {
    const widestAtDefaultSize = Math.max(
      ...lines.map((line) => measureInvoiceWidth(line, tableBodyFontSize)),
    );
    if (widestAtDefaultSize <= availableWidth) return tableBodyFontSize;

    const calculatedSize =
      (tableBodyFontSize * availableWidth * 0.98) / widestAtDefaultSize;
    return Math.max(
      minimumFontSize,
      Math.floor(Math.min(tableBodyFontSize, calculatedSize) * 10) / 10,
    );
  };

  const invoiceNumberLayout = (
    invoiceNumber: string,
  ): { lines: string[]; fontSize: number } => {
    const value = invoiceNumber.trim() || "-";
    const availableWidth = tableColumnWidths[0] - tableCellPadding * 2;
    const singleLineFontSize = fitInvoiceFontSize(
      [value],
      availableWidth,
      invoiceMinimumFontSize,
    );

    if (measureInvoiceWidth(value, singleLineFontSize) <= availableWidth) {
      return { lines: [value], fontSize: singleLineFontSize };
    }

    const separatorBreaks = Array.from(value)
      .map((character, index) => ({ character, position: index + 1 }))
      .filter(
        ({ character, position }) =>
          (character === "/" || character === "-" || character === " ") &&
          position > 1 &&
          position < value.length,
      )
      .map(({ position }) => position);

    const allBreaks = Array.from({ length: Math.max(0, value.length - 1) }, (_, index) =>
      index + 1,
    );
    const chooseBreak = (positions: number[]): number | undefined =>
      positions
        .map((position) => {
          const first = value.slice(0, position);
          const second = value.slice(position);
          const firstWidth = measureInvoiceWidth(first, invoiceMinimumFontSize);
          const secondWidth = measureInvoiceWidth(second, invoiceMinimumFontSize);
          const widest = Math.max(firstWidth, secondWidth);
          return {
            position,
            fits: widest <= availableWidth,
            widest,
            balance: Math.abs(firstWidth - secondWidth),
          };
        })
        .sort((left, right) => {
          if (left.fits !== right.fits) return left.fits ? -1 : 1;
          if (left.widest !== right.widest) return left.widest - right.widest;
          return left.balance - right.balance;
        })[0]?.position;

    const separatorBreak = chooseBreak(separatorBreaks);
    const separatorLines = separatorBreak
      ? [value.slice(0, separatorBreak), value.slice(separatorBreak)]
      : [];
    const separatorFits =
      separatorLines.length === 2 &&
      separatorLines.every(
        (line) => measureInvoiceWidth(line, invoiceMinimumFontSize) <= availableWidth,
      );
    const breakPosition = separatorFits
      ? separatorBreak
      : chooseBreak(allBreaks) ?? Math.ceil(value.length / 2);
    const lines = [value.slice(0, breakPosition), value.slice(breakPosition)];

    return {
      lines,
      fontSize: fitInvoiceFontSize(
        lines,
        availableWidth,
        invoiceTwoLineMinimumFontSize,
      ),
    };
  };

  const finalTotalLabel = options.allParties ? "Grand total" : "Report total";

  for (const [groupIndex, group] of groups.entries()) {
    const isLastGroup = groupIndex === groups.length - 1;
    const partyHeading = `${group.party || "Unnamed party"} | ${group.rows.length} ${
      group.rows.length === 1 ? "invoice" : "invoices"
    } | ${formatPdfAmount(group.total)}`;
    const invoiceLayouts = group.rows.map((row) =>
      invoiceNumberLayout(row.invoiceNumber || "-"),
    );
    const bodyRows = group.rows.map((row, rowIndex) => [
      invoiceLayouts[rowIndex].lines.join("\n"),
      displayDesign(row),
      `Invoice: ${formatPdfDate(row.invoiceDate)}\nDue: ${formatPdfDate(row.dueDate)}\nReceived: ${formatPdfDate(row.receivedOn)}`,
      receivableDueBadge(row).compactLabel,
      `Bill: ${formatPdfAmount(row.invoiceAmount)}\nReceived: ${formatPdfAmount(row.receipts || 0)}`,
      `${formatPdfAmount(effectivePending(row))}\n${receivablePaymentBadge(row).compactLabel}`,
    ]);
    const partySubtotalRow = [
      {
        content: "Party subtotal",
        colSpan: 5,
        styles: { halign: "right", fontStyle: "bold" },
      },
      {
        content: formatPdfAmount(group.total),
        styles: {
          halign: "right",
          fontStyle: "bold",
          textColor: [30, 64, 175],
        },
      },
    ];
    const finalTotalRow = [
      {
        content: finalTotalLabel,
        colSpan: 5,
        styles: {
          halign: "left",
          fontStyle: "bold",
          fontSize: 10,
          cellPadding: 2.4,
          fillColor: [239, 246, 255],
          textColor: [30, 64, 175],
        },
      },
      {
        content: formatPdfAmount(totalOutstanding),
        styles: {
          halign: "right",
          fontStyle: "bold",
          fontSize: 10,
          cellPadding: 2.4,
          fillColor: [239, 246, 255],
          textColor: [30, 64, 175],
        },
      },
    ];
    const footRows = [partySubtotalRow, ...(isLastGroup ? [finalTotalRow] : [])];
    const partyHeadHeight = measureCellHeight(partyHeading, contentWidth, 9, 2.4, "bold");
    const columnHeadHeight = Math.max(
      ...tableHeadLabels.map((label, index) =>
        measureCellHeight(label, tableColumnWidths[index], 7.2, 1.7, "bold"),
      ),
    );
    const firstRowHeight = bodyRows[0]
      ? Math.max(
          ...bodyRows[0].map((value, index) => {
            const invoiceLayout = invoiceLayouts[0];
            return measureCellHeight(
              value,
              tableColumnWidths[index],
              index === 0 ? invoiceLayout.fontSize : tableBodyFontSize,
              tableCellPadding,
              index === 0 || index === 5 ? "bold" : "normal",
            );
          }),
          dueBadgeCellMinHeight,
          statusBadgeCellMinHeight,
        )
      : 0;
    const partySubtotalHeight = Math.max(
      measureCellHeight(
        "Party subtotal",
        tableColumnWidths.slice(0, 5).reduce((sum, width) => sum + width, 0),
        8,
        1.8,
        "bold",
      ),
      measureCellHeight(
        formatPdfAmount(group.total),
        tableColumnWidths[5],
        8,
        1.8,
        "bold",
      ),
    );
    const finalTotalHeight = isLastGroup
      ? Math.max(
          measureCellHeight(
            finalTotalLabel,
            tableColumnWidths.slice(0, 5).reduce((sum, width) => sum + width, 0),
            10,
            2.4,
            "bold",
          ),
          measureCellHeight(
            formatPdfAmount(totalOutstanding),
            tableColumnWidths[5],
            10,
            2.4,
            "bold",
          ),
        )
      : 0;
    const oneRowFooterHeight =
      bodyRows.length === 1 ? partySubtotalHeight + finalTotalHeight : 0;
    const firstBlockHeight =
      partyHeadHeight + columnHeadHeight + firstRowHeight + oneRowFooterHeight + 1;

    // Avoid leaving the party and column headings stranded at the bottom of a page.
    if (cursorY + firstBlockHeight > contentBottom) cursorY = addContentPage();

    autoTable(doc, {
      startY: cursorY,
      margin: { top: 20, right: marginX, bottom: 14, left: marginX },
      theme: "grid",
      head: [
        [
          {
            content: partyHeading,
            colSpan: 6,
            styles: {
              fillColor: [55, 65, 81],
              textColor: [255, 255, 255],
              fontStyle: "bold",
              fontSize: 9,
              cellPadding: 2.4,
            },
          },
        ],
        tableHeadLabels,
      ],
      body: bodyRows,
      foot: footRows,
      styles: {
        font: "helvetica",
        fontSize: tableBodyFontSize,
        cellPadding: tableCellPadding,
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
        cellPadding: 1.7,
      },
      footStyles: {
        fillColor: [241, 245, 249],
        textColor: [51, 65, 85],
        fontSize: 8,
        cellPadding: 1.8,
      },
      alternateRowStyles: { fillColor: [249, 250, 251] },
      columnStyles: {
        0: {
          cellWidth: tableColumnWidths[0],
          fontStyle: "bold",
          textColor: [17, 24, 39],
        },
        1: { cellWidth: tableColumnWidths[1] },
        2: { cellWidth: tableColumnWidths[2] },
        3: { cellWidth: tableColumnWidths[3] },
        4: { cellWidth: tableColumnWidths[4] },
        5: {
          cellWidth: tableColumnWidths[5],
          halign: "right",
          fontStyle: "bold",
          textColor: [30, 64, 175],
        },
      },
      showHead: "everyPage",
      showFoot: "lastPage",
      rowPageBreak: "avoid",
      didParseCell: (data) => {
        if (data.section !== "body") return;
        const row = group.rows[data.row.index];
        if (!row) return;
        if (data.column.index === 0) {
          const invoiceLayout = invoiceLayouts[data.row.index];
          data.cell.text = invoiceLayout.lines;
          data.cell.styles.fontSize = invoiceLayout.fontSize;
        }
        if (data.column.index === 3) {
          data.cell.text = [];
          data.cell.styles.minCellHeight = Math.max(
            Number(data.cell.styles.minCellHeight) || 0,
            dueBadgeCellMinHeight,
          );
        }
        if (data.column.index === 5) {
          data.cell.text = [formatPdfAmount(effectivePending(row))];
          data.cell.styles.minCellHeight = Math.max(
            Number(data.cell.styles.minCellHeight) || 0,
            statusBadgeCellMinHeight,
          );
          data.cell.styles.valign = "top";
        }
      },
      didDrawCell: (data) => {
        if (data.section !== "body") return;
        const row = group.rows[data.row.index];
        if (!row) return;
        if (data.column.index === 3) {
          const badge = receivableDueBadge(row);
          drawBadge(badge.compactLabel, badge.tone, data.cell, "center");
        }
        if (data.column.index === 5) {
          const badge = receivablePaymentBadge(row);
          drawBadge(badge.compactLabel, badge.tone, data.cell, "below-amount");
        }
      },
      willDrawPage: (data) => {
        if (data.pageNumber === 1) return;
        drawContinuationPageHeader();
      },
    });

    const withLastTable = doc as typeof doc & { lastAutoTable?: { finalY?: number } };
    cursorY = (withLastTable.lastAutoTable?.finalY ?? cursorY + 25) + 6;
  }

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(229, 231, 235);
    doc.line(marginX, pageHeight - 11, pageWidth - marginX, pageHeight - 11);
    doc.setTextColor(107, 114, 128);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(title, marginX, pageHeight - 6.5);
    doc.text(`Page ${page} of ${pageCount}`, pageWidth - marginX, pageHeight - 6.5, {
      align: "right",
    });
  }

  return doc.output("blob");
}
