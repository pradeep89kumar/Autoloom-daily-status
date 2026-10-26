import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CircleNotch,
  DownloadSimple,
  WhatsappLogo,
} from "@phosphor-icons/react";
import { useNavigate, useSearchParams } from "react-router";

import { SheetDataStatus } from "../../components/SheetDataStatus";
import { useSheetResource } from "../../hooks/useSheetResource";
import { fmtRupees } from "../../lib/partnerCopy";
import {
  fetchMasterUnbilledResult,
  peekMasterUnbilledCache,
  type MasterUnbilledData,
  type SheetReadResult,
} from "../../lib/sheetSync";
import {
  formatUnbilledRunoutDate,
  parseUnbilledReportScope,
  selectUnbilledReportRows,
  summarizeUnbilledReport,
  unbilledAgeDays,
  unbilledAgeLabel,
  unbilledReportFilename,
  unbilledReportScopeLabel,
  type UnbilledReportScope,
} from "../../lib/unbilledReport";
import { buildUnbilledReportPdf } from "../../lib/unbilledReportPdf";

const REPORT_SCOPES: { value: UnbilledReportScope; label: string }[] = [
  { value: "ready", label: "Ready to bill" },
  { value: "running", label: "Running" },
  { value: "all", label: "All" },
];

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

function loadUnbilledReport(
  { fresh }: { fresh: boolean },
): Promise<SheetReadResult<MasterUnbilledData>> {
  return fetchMasterUnbilledResult({ fresh });
}

export function PartnerUnbilledReport() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const scope = parseUnbilledReportScope(searchParams.get("scope"));
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const resource = useSheetResource<MasterUnbilledData>({
    resourceKey: "partner:unbilled-report",
    load: loadUnbilledReport,
    peek: peekMasterUnbilledCache,
  });
  const data = resource.data;
  const rows = useMemo(
    () => selectUnbilledReportRows(data?.rows || [], scope),
    [data?.rows, scope],
  );
  const summary = useMemo(() => summarizeUnbilledReport(rows), [rows]);
  const generatedAt = useMemo(
    () => (resource.lastSyncedAt ? new Date(resource.lastSyncedAt) : null),
    [resource.lastSyncedAt],
  );
  const canExport =
    resource.canUseForExport && !resource.refreshing && rows.length > 0 && generatedAt !== null;

  useEffect(() => {
    let alive = true;
    setPdfFile(null);
    setMessage("");
    setError("");

    if (!canExport || !generatedAt) {
      setPdfBusy(false);
      return () => {
        alive = false;
      };
    }

    setPdfBusy(true);
    buildUnbilledReportPdf(rows, { scope, generatedAt })
      .then((blob) => {
        if (!alive) return;
        setPdfFile(
          new File([blob], unbilledReportFilename(scope, generatedAt), {
            type: "application/pdf",
          }),
        );
        setPdfBusy(false);
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        console.error("[unbilled-report] PDF generation failed", reason);
        setError("The PDF could not be prepared. Please try again.");
        setPdfBusy(false);
      });

    return () => {
      alive = false;
    };
  }, [canExport, generatedAt, rows, scope]);

  const handleDownload = () => {
    if (!canExport || !pdfFile) return;
    downloadFile(pdfFile);
    setError("");
    setMessage("PDF downloaded.");
  };

  const openWhatsAppFallback = (file: File) => {
    downloadFile(file);
    const text = [
      "SAT unbilled report",
      unbilledReportScopeLabel(scope),
      "The PDF has been downloaded. Please attach it to this WhatsApp chat.",
    ].join(" · ");
    window.location.assign(`https://wa.me/?text=${encodeURIComponent(text)}`);
    setError("");
    setMessage("PDF downloaded. Attach it in WhatsApp.");
  };

  const handleWhatsApp = async () => {
    if (!canExport || !pdfFile) return;
    setMessage("");
    setError("");
    const shareData: ShareData = {
      title: "SAT unbilled report",
      text: `Attached: ${unbilledReportScopeLabel(scope)} unbilled report.`,
      files: [pdfFile],
    };

    let canShareFile = false;
    try {
      canShareFile =
        typeof navigator.share === "function" &&
        (typeof navigator.canShare !== "function" || navigator.canShare(shareData));
    } catch (reason) {
      console.warn("[unbilled-report] File sharing is unavailable", reason);
    }

    if (!canShareFile) {
      openWhatsAppFallback(pdfFile);
      return;
    }

    try {
      await navigator.share(shareData);
      setMessage("PDF shared.");
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      console.warn("[unbilled-report] File sharing failed", reason);
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
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-[900px] items-center justify-between gap-3">
          <button
            type="button"
            onClick={() =>
              navigate("/partner/receivables", {
                state: {
                  receivablesView: "unbilled",
                  unbilledFilter: scope,
                },
              })
            }
            aria-label="Back to Receivables"
            className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            <ArrowLeft className="h-5 w-5" weight="bold" />
            <span className="hidden sm:inline">Receivables</span>
          </button>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            <select
              value={scope}
              onChange={(event) => {
                setPdfFile(null);
                setMessage("");
                setError("");
                setSearchParams({ scope: event.target.value }, { replace: true });
              }}
              disabled={resource.loading}
              aria-label="Unbilled report scope"
              className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 text-[13px] font-semibold text-slate-800 disabled:bg-slate-100 sm:max-w-[190px]"
            >
              {REPORT_SCOPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleDownload}
              disabled={!canExport || !pdfFile || pdfBusy}
              aria-label="Download PDF"
              title={canExport ? "Download PDF" : "Waiting for live data"}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
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
              disabled={!canExport || !pdfFile || pdfBusy}
              aria-label="Share PDF on WhatsApp"
              title={canExport ? "Share PDF on WhatsApp" : "Waiting for live data"}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <WhatsappLogo className="h-5 w-5" weight="fill" />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[900px] px-4 py-6 sm:px-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-7">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-700">
            Receivables report
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            SAT unbilled report
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {unbilledReportScopeLabel(scope)} · Generated {generatedLabel || "—"}
          </p>

          {(resource.error || resource.warning || resource.refreshing) && (
            <SheetDataStatus
              error={resource.error}
              warning={resource.warning}
              refreshing={resource.refreshing}
              lastSyncedAt={resource.lastSyncedAt}
              onRetry={resource.refresh}
              className="mt-5"
            />
          )}
          {(resource.error || resource.warning) && (
            <p className="mt-1.5 text-xs text-slate-500">
              PDF download and WhatsApp sharing stay disabled until the live refresh succeeds.
            </p>
          )}

          {resource.loading && !data ? (
            <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[0, 1, 2].map((item) => (
                <div key={item} className="h-20 animate-pulse rounded-xl bg-slate-100" />
              ))}
            </div>
          ) : data === null ? (
            <div className="mt-7 rounded-xl border border-slate-200 bg-slate-50 px-5 py-10 text-center">
              <p className="font-semibold text-slate-800">Live unbilled data is unavailable.</p>
              <p className="mt-1 text-sm text-slate-600">Retry the live sync before exporting.</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="mt-7 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center">
              <p className="font-semibold text-slate-800">No rows match this report filter.</p>
              <p className="mt-1 text-sm text-slate-500">Choose another report scope.</p>
            </div>
          ) : (
            <>
              <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Designs</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-slate-950">
                    {summary.designCount}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Produced m</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-slate-950">
                    {summary.producedMeters.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                  </p>
                </div>
                <div className="col-span-2 rounded-xl border border-blue-200 bg-blue-50 p-3.5 sm:col-span-1">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-blue-700">Unbilled value</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-blue-900">
                    {fmtRupees(summary.unbilledValue)}
                  </p>
                </div>
              </div>

              <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full table-fixed border-collapse text-left">
                  <caption className="sr-only">Unbilled production report</caption>
                  <colgroup>
                    <col className="w-[48%]" />
                    <col className="w-[20%]" />
                    <col className="w-[32%]" />
                  </colgroup>
                  <thead className="bg-slate-100 text-[10px] uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-2.5 py-2.5 font-bold">Customer / design</th>
                      <th className="px-2.5 py-2.5 text-right font-bold">Produced m</th>
                      <th className="px-2.5 py-2.5 text-right font-bold">Unbilled value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {rows.map((row) => {
                      const age =
                        row.status === "ready" && generatedAt
                          ? unbilledAgeDays(row.latestRunout, generatedAt)
                          : null;
                      return (
                        <tr key={row.key} className="align-top">
                          <td className="px-2.5 py-3">
                            <p className="break-words text-[12px] font-semibold leading-4 text-slate-950">
                              {row.customerDesign || "—"}
                            </p>
                            <span
                              className={`mt-1 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                                row.status === "ready"
                                  ? "bg-blue-50 text-blue-700"
                                  : "bg-emerald-100 text-emerald-700"
                              }`}
                            >
                              {row.status === "ready" ? "Ready to bill" : "Running"}
                            </span>
                            {row.status === "ready" ? (
                              age === null ? (
                                <p className="mt-1 text-[11px] font-bold text-amber-700">
                                  Run-out date unavailable
                                </p>
                              ) : (
                                <p className="mt-1 text-[11px] font-bold leading-4 text-slate-800">
                                  Run-out {formatUnbilledRunoutDate(row.latestRunout)}
                                  <br />
                                  <span className="text-blue-700">{unbilledAgeLabel(age)}</span>
                                </p>
                              )
                            ) : (
                              <p className="mt-1 text-[11px] font-semibold text-emerald-700">
                                Still running
                              </p>
                            )}
                          </td>
                          <td className="px-2.5 py-3 text-right text-[12px] font-semibold tabular-nums text-slate-700">
                            {row.producedMeters.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                          </td>
                          <td className="px-2.5 py-3 text-right text-[12px] font-bold tabular-nums text-slate-950">
                            {fmtRupees(row.estimatedUnbilled)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="border-t-2 border-slate-300 bg-blue-50">
                    <tr>
                      <td className="px-2.5 py-3 font-bold text-blue-900">Report total</td>
                      <td className="px-2.5 py-3 text-right font-bold tabular-nums text-blue-900">
                        {summary.producedMeters.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                      </td>
                      <td className="px-2.5 py-3 text-right font-bold tabular-nums text-blue-900">
                        {fmtRupees(summary.unbilledValue)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-4 text-slate-500">
                Values use Total value and metres use OK mtr from Paagu ID. Rows with an invoice number are excluded. Invoice amounts include 5% GST.
              </p>
            </>
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
          {!resource.loading && rows.length > 0 && (
            <p className="mt-4 text-xs leading-relaxed text-slate-500">
              WhatsApp shares this PDF through your device share sheet. If file sharing is unavailable, the PDF downloads first and WhatsApp opens so you can attach it.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
