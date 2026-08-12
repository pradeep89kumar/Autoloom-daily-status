import type { ReceivableRow } from "./sheetSync";
import {
  effectivePending,
  formatReceivableDate,
  receivableAgeDays,
  receivableStatusKind,
  type ReceivablePartyGroup,
} from "./receivables";

function formatPdfAmount(value: number): string {
  return `INR ${Math.round(value || 0).toLocaleString("en-IN")}`;
}

function displayDesign(row: ReceivableRow): string {
  return (row.customerName || row.designDetails || row.orderId || "-").trim();
}

function displayStatus(row: ReceivableRow): string {
  const explicit = (row.paymentStatus || "").trim();
  if (explicit) return explicit;
  const kind = receivableStatusKind(row);
  if (kind === "partial") return "Partial";
  if (kind === "paid") return "Paid";
  return "Pending";
}

function formatPdfDate(value: string): string {
  const formatted = formatReceivableDate(value);
  return formatted === "—" ? "-" : formatted;
}

export function overdueReportFilename(scopeLabel: string, generatedAt: Date): string {
  const scope = scopeLabel === "All parties" ? "all-parties" : "selected-party";
  const year = generatedAt.getFullYear();
  const month = String(generatedAt.getMonth() + 1).padStart(2, "0");
  const day = String(generatedAt.getDate()).padStart(2, "0");
  return `sat-overdue-report-${scope}-${year}-${month}-${day}.pdf`;
}

export async function buildOverdueReportPdf(
  groups: ReceivablePartyGroup[],
  scopeLabel: string,
  generatedAt: Date,
  allParties: boolean,
): Promise<Blob> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const totalInvoices = groups.reduce((sum, group) => sum + group.rows.length, 0);
  const totalOutstanding = groups.reduce((sum, group) => sum + group.total, 0);
  const generatedLabel = generatedAt.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  doc.setProperties({
    title: "SAT overdue report",
    subject: `Overdue receivables - ${scopeLabel}`,
    creator: "SAT Quality Control App",
  });

  doc.setFillColor(31, 41, 55);
  doc.rect(0, 0, pageWidth, 29, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("SAT overdue report", 12, 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Scope: ${scopeLabel}`, 12, 19);
  doc.text(`Generated: ${generatedLabel}`, 12, 24);

  doc.setFont("helvetica", "bold");
  doc.text(`${groups.length} ${groups.length === 1 ? "party" : "parties"}`, 146, 12, {
    align: "center",
  });
  doc.text(`${totalInvoices} overdue ${totalInvoices === 1 ? "invoice" : "invoices"}`, 205, 12, {
    align: "center",
  });
  doc.text(formatPdfAmount(totalOutstanding), pageWidth - 12, 12, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Parties", 146, 18, { align: "center" });
  doc.text("Invoices", 205, 18, { align: "center" });
  doc.text("Outstanding", pageWidth - 12, 18, { align: "right" });

  let cursorY = 37;
  for (const [groupIndex, group] of groups.entries()) {
    if (cursorY > pageHeight - 38) {
      doc.addPage();
      cursorY = 15;
    }

    doc.setTextColor(31, 41, 55);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(group.party || "Unnamed party", 12, cursorY);
    doc.setFontSize(8.5);
    doc.setTextColor(75, 85, 99);
    doc.text(
      `${group.rows.length} overdue ${group.rows.length === 1 ? "invoice" : "invoices"}`,
      pageWidth - 12,
      cursorY,
      { align: "right" },
    );

    autoTable(doc, {
      startY: cursorY + 3,
      margin: { left: 12, right: 12, bottom: 14 },
      theme: "grid",
      head: [
        [
          "Invoice #",
          "Design / customer",
          "Invoice date",
          "Due date",
          "Overdue",
          "Bill amount",
          "Received",
          "Received on",
          "Outstanding",
          "Status",
        ],
      ],
      body: group.rows.map((row) => [
        row.invoiceNumber || "-",
        displayDesign(row),
        formatPdfDate(row.invoiceDate),
        formatPdfDate(row.dueDate),
        `${receivableAgeDays(row.dueDate) ?? 0} days`,
        formatPdfAmount(row.invoiceAmount),
        formatPdfAmount(row.receipts || 0),
        formatPdfDate(row.receivedOn),
        formatPdfAmount(effectivePending(row)),
        displayStatus(row),
      ]),
      foot: [
        [
          {
            content: "Party subtotal",
            colSpan: 8,
            styles: { halign: "right", fontStyle: "bold" },
          },
          {
            content: formatPdfAmount(group.total),
            styles: { halign: "right", fontStyle: "bold" },
          },
          "",
        ],
        ...(allParties && groupIndex === groups.length - 1
          ? [
              [
                {
                  content: "Grand total",
                  colSpan: 8,
                  styles: {
                    halign: "right" as const,
                    fontStyle: "bold" as const,
                    fillColor: [239, 246, 255] as [number, number, number],
                    textColor: [30, 64, 175] as [number, number, number],
                  },
                },
                {
                  content: formatPdfAmount(totalOutstanding),
                  styles: {
                    halign: "right" as const,
                    fontStyle: "bold" as const,
                    fillColor: [239, 246, 255] as [number, number, number],
                    textColor: [30, 64, 175] as [number, number, number],
                  },
                },
                {
                  content: "",
                  styles: { fillColor: [239, 246, 255] as [number, number, number] },
                },
              ],
            ]
          : []),
      ],
      styles: {
        font: "helvetica",
        fontSize: 7.2,
        cellPadding: 1.6,
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
        0: { cellWidth: 24 },
        1: { cellWidth: 71 },
        2: { cellWidth: 19 },
        3: { cellWidth: 19 },
        4: { cellWidth: 16, halign: "right" },
        5: { cellWidth: 27, halign: "right" },
        6: { cellWidth: 26, halign: "right" },
        7: { cellWidth: 20 },
        8: { cellWidth: 29, halign: "right" },
        9: { cellWidth: 22 },
      },
      showHead: "everyPage",
      showFoot: "lastPage",
      rowPageBreak: "avoid",
      willDrawPage: (data) => {
        if (data.pageNumber === 1) return;
        doc.setFillColor(249, 250, 251);
        doc.rect(12, 6, pageWidth - 24, 6.5, "F");
        doc.setTextColor(55, 65, 81);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.text(`${group.party || "Unnamed party"} - continued`, 14, 10.4);
      },
    });

    const withLastTable = doc as typeof doc & { lastAutoTable?: { finalY?: number } };
    cursorY = (withLastTable.lastAutoTable?.finalY ?? cursorY + 12) + 9;
  }

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(229, 231, 235);
    doc.line(12, pageHeight - 11, pageWidth - 12, pageHeight - 11);
    doc.setTextColor(107, 114, 128);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text("SAT overdue report", 12, pageHeight - 6.5);
    doc.text(`Page ${page} of ${pageCount}`, pageWidth - 12, pageHeight - 6.5, {
      align: "right",
    });
  }

  return doc.output("blob");
}
