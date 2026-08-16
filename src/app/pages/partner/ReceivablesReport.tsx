import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CircleNotch,
  DownloadSimple,
  WhatsappLogo,
} from "@phosphor-icons/react";
import { useNavigate } from "react-router";

import {
  effectivePending,
  formatReceivableDate,
  receivableAgeDays,
  receivableStatusKind,
  selectReceivables,
} from "../../lib/receivables";
import {
  buildOverdueReportPdf,
  overdueReportFilename,
} from "../../lib/receivablesPdf";
import { fmtRupees } from "../../lib/partnerCopy";
import { fetchMasterReceivablesResult, type ReceivableRow } from "../../lib/sheetSync";

function designOrCustomer(row: ReceivableRow): string {
  return (row.customerName || row.designDetails || row.orderId || "—").trim();
}

function paymentStatus(row: ReceivableRow): string {
  const explicit = (row.paymentStatus || "").trim();
  if (explicit) return explicit;
  const kind = receivableStatusKind(row);
  if (kind === "partial") return "Partial";
  if (kind === "paid") return "Paid";
  return "Pending";
}

function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function PartnerReceivablesReport() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ReceivableRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [partyKey, setPartyKey] = useState("all");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [dataUnavailable, setDataUnavailable] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setDataUnavailable(false);
    fetchMasterReceivablesResult().then((result) => {
      if (!alive) return;
      if (!result.ok) {
        setRows([]);
        setGeneratedAt(null);
        setDataUnavailable(true);
        setLoading(false);
        return;
      }
      setRows(result.rows);
      setGeneratedAt(new Date());
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const overdue = useMemo(() => selectReceivables(rows || [], "overdue"), [rows]);

  useEffect(() => {
    if (partyKey !== "all" && !overdue.grouped.some((group) => group.key === partyKey)) {
      setPartyKey("all");
    }
  }, [overdue.grouped, partyKey]);

  const visibleGroups = useMemo(
    () =>
      partyKey === "all"
        ? overdue.grouped
        : overdue.grouped.filter((group) => group.key === partyKey),
    [overdue.grouped, partyKey],
  );

  const selectedParty = overdue.grouped.find((group) => group.key === partyKey);
  const scopeLabel = partyKey === "all" ? "All parties" : selectedParty?.party || "Selected party";
  const totalInvoices = visibleGroups.reduce((sum, group) => sum + group.rows.length, 0);
  const totalOutstanding = visibleGroups.reduce((sum, group) => sum + group.total, 0);

  useEffect(() => {
    let alive = true;
    setMessage("");
    setError("");
    setPdfFile(null);

    if (!generatedAt || visibleGroups.length === 0) {
      setPdfBusy(false);
      return () => {
        alive = false;
      };
    }

    setPdfBusy(true);
    buildOverdueReportPdf(visibleGroups, scopeLabel, generatedAt, partyKey === "all")
      .then((blob) => {
        if (!alive) return;
        setPdfFile(
          new File([blob], overdueReportFilename(scopeLabel, generatedAt), {
            type: "application/pdf",
          }),
        );
        setPdfBusy(false);
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        console.error("[receivables-report] PDF generation failed", reason);
        setError("The PDF could not be prepared. Please try again.");
        setPdfBusy(false);
      });

    return () => {
      alive = false;
    };
  }, [generatedAt, partyKey, scopeLabel, visibleGroups]);

  const handleDownload = () => {
    if (!pdfFile) return;
    downloadFile(pdfFile);
    setError("");
    setMessage("PDF downloaded.");
  };

  const openWhatsAppFallback = (file: File) => {
    downloadFile(file);
    const text = [
      "SAT overdue report",
      "The PDF has been downloaded. Please attach it to this WhatsApp chat.",
    ].join(" · ");
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.location.assign(whatsappUrl);
    setError("");
    setMessage("PDF downloaded. Attach it in WhatsApp.");
  };

  const handleWhatsApp = async () => {
    if (!pdfFile) return;
    setMessage("");
    setError("");
    const shareData: ShareData = {
      title: "SAT overdue report",
      text: "Attached: SAT overdue report.",
      files: [pdfFile],
    };
    const canShareFile =
      typeof navigator.share === "function" &&
      (typeof navigator.canShare !== "function" || navigator.canShare(shareData));

    if (!canShareFile) {
      openWhatsAppFallback(pdfFile);
      return;
    }

    try {
      await navigator.share(shareData);
      setMessage("PDF shared.");
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      console.warn("[receivables-report] File sharing failed", reason);
      openWhatsAppFallback(pdfFile);
    }
  };

  const generatedLabel = generatedAt?.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <main className="min-h-screen bg-[#f5f6f8] text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur print:static">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate("/partner/receivables")}
            aria-label="Back to Receivables"
            className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            <ArrowLeft className="h-5 w-5" weight="bold" />
            <span className="hidden sm:inline">Receivables</span>
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownload}
              disabled={!pdfFile || pdfBusy}
              aria-label="Download PDF"
              title="Download PDF"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pdfBusy ? (
                <CircleNotch className="h-4 w-4 animate-spin" weight="bold" />
              ) : (
                <DownloadSimple className="h-4 w-4" weight="bold" />
              )}
            </button>
            <button
              type="button"
              onClick={handleWhatsApp}
              disabled={!pdfFile || pdfBusy}
              aria-label="Share PDF on WhatsApp"
              title="Share PDF on WhatsApp"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <WhatsappLogo className="h-5 w-5" weight="fill" />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-red-600">
                Overdue receivables
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
                SAT overdue report
              </h1>
              <p className="mt-2 text-sm text-slate-500">
                Due date before today · Generated {generatedLabel || "—"}
              </p>
            </div>

            <label className="block w-full sm:w-[310px]">
              <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Export for
              </span>
              <select
                value={partyKey}
                onChange={(event) => setPartyKey(event.target.value)}
                disabled={loading || overdue.grouped.length === 0}
                className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
              >
                <option value="all">All parties ({overdue.grouped.length})</option>
                {overdue.grouped.map((group) => (
                  <option key={group.key} value={group.key}>
                    {group.party} ({group.rows.length})
                  </option>
                ))}
              </select>
            </label>
          </div>

          {loading ? (
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {[0, 1, 2].map((item) => (
                <div key={item} className="h-24 animate-pulse rounded-xl bg-slate-100" />
              ))}
            </div>
          ) : dataUnavailable ? (
            <div className="mt-8 rounded-xl border border-red-200 bg-red-50 px-5 py-10 text-center">
              <p className="font-semibold text-red-800">Receivables data is unavailable.</p>
              <p className="mt-1 text-sm text-red-700">
                Check the connection and Apps Script access, then reopen this report. Export and
                sharing are disabled.
              </p>
            </div>
          ) : visibleGroups.length > 0 ? (
            <>
              <div className="mt-7 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Parties</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-slate-950">
                    {visibleGroups.length}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    Overdue invoices
                  </p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-slate-950">
                    {totalInvoices}
                  </p>
                </div>
                <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-red-600">
                    Total outstanding
                  </p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-red-700">
                    {fmtRupees(totalOutstanding)}
                  </p>
                </div>
              </div>

              <div className="mt-8 space-y-7">
                {visibleGroups.map((group) => (
                  <section key={group.key} className="overflow-hidden rounded-xl border border-slate-200">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 bg-slate-900 px-4 py-3 text-white">
                      <h2 className="text-base font-bold">{group.party}</h2>
                      <p className="text-sm font-semibold tabular-nums text-slate-200">
                        {group.rows.length} overdue {group.rows.length === 1 ? "invoice" : "invoices"}
                      </p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[1080px] border-collapse text-left text-[13px]">
                        <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
                          <tr>
                            <th className="px-3 py-2.5 font-bold">Invoice #</th>
                            <th className="px-3 py-2.5 font-bold">Design / customer</th>
                            <th className="px-3 py-2.5 font-bold">Invoice date</th>
                            <th className="px-3 py-2.5 font-bold">Due date</th>
                            <th className="px-3 py-2.5 text-right font-bold">Overdue</th>
                            <th className="px-3 py-2.5 text-right font-bold">Bill amount</th>
                            <th className="px-3 py-2.5 text-right font-bold">Received</th>
                            <th className="px-3 py-2.5 font-bold">Received on</th>
                            <th className="px-3 py-2.5 text-right font-bold">Outstanding</th>
                            <th className="px-3 py-2.5 font-bold">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {group.rows.map((row, index) => (
                            <tr key={`${group.key}-${row.invoiceNumber}-${index}`} className="bg-white">
                              <td className="whitespace-nowrap px-3 py-3 font-semibold text-slate-900">
                                {row.invoiceNumber || "—"}
                              </td>
                              <td className="max-w-[260px] px-3 py-3 text-slate-700">
                                {designOrCustomer(row)}
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 tabular-nums text-slate-700">
                                {formatReceivableDate(row.invoiceDate)}
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 tabular-nums text-slate-700">
                                {formatReceivableDate(row.dueDate)}
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-red-700">
                                {receivableAgeDays(row.dueDate) ?? 0} days
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-slate-700">
                                {fmtRupees(row.invoiceAmount)}
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-slate-700">
                                {fmtRupees(row.receipts || 0)}
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 tabular-nums text-slate-700">
                                {formatReceivableDate(row.receivedOn)}
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 text-right font-bold tabular-nums text-slate-950">
                                {fmtRupees(effectivePending(row))}
                              </td>
                              <td className="px-3 py-3 text-slate-700">{paymentStatus(row)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="border-t-2 border-slate-300 bg-slate-50">
                          <tr>
                            <td colSpan={8} className="px-3 py-3 text-right font-bold text-slate-700">
                              Party subtotal
                            </td>
                            <td className="whitespace-nowrap px-3 py-3 text-right text-base font-bold tabular-nums text-slate-950">
                              {fmtRupees(group.total)}
                            </td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </section>
                ))}
              </div>

              <div className="mt-8 flex items-center justify-between gap-4 rounded-xl border border-blue-200 bg-blue-50 px-5 py-4">
                <p className="font-bold text-blue-900">
                  {partyKey === "all" ? "Grand total" : "Report total"}
                </p>
                <p className="text-xl font-bold tabular-nums text-blue-900">
                  {fmtRupees(totalOutstanding)}
                </p>
              </div>
            </>
          ) : (
            <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center">
              <p className="font-semibold text-slate-800">No overdue invoices are available.</p>
              <p className="mt-1 text-sm text-slate-500">
                There is no PDF to export. If this is unexpected, check the sheet connection and
                try again.
              </p>
            </div>
          )}

          {(message || error) && (
            <p
              className={`mt-4 text-sm font-medium ${error ? "text-red-700" : "text-emerald-700"}`}
              role="status"
              aria-live="polite"
            >
              {error || message}
            </p>
          )}
          {!loading && visibleGroups.length > 0 && (
            <p className="mt-4 text-xs leading-relaxed text-slate-500">
              WhatsApp shares the PDF through your device share sheet. If file sharing is not
              supported, the PDF downloads first and WhatsApp opens so you can attach it.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
