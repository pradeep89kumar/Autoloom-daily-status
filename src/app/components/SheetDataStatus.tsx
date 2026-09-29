import { ArrowClockwise, CircleNotch, WarningCircle } from "@phosphor-icons/react";

import type { SheetClientError } from "../lib/sheetClient";

interface SheetDataStatusProps {
  error?: SheetClientError | null;
  warning?: SheetClientError | null;
  refreshing?: boolean;
  lastSyncedAt?: number | null;
  onRetry: () => void;
  className?: string;
}

function failureCopy(error: SheetClientError): { title: string; detail: string } {
  if (error.kind === "auth") {
    return {
      title: "Sheet access was denied",
      detail: "Check the app access settings, then try again.",
    };
  }
  if (error.kind === "timeout") {
    return {
      title: "The sheet is taking too long",
      detail: "The request stopped safely. Try again on a stable connection.",
    };
  }
  if (error.kind === "network") {
    return {
      title: "Could not reach the live sheet",
      detail: "Check the connection and try again.",
    };
  }
  if (error.kind === "schema" || error.kind === "backend") {
    return {
      title: "The sheet data needs attention",
      detail: "The app did not accept an incomplete or unexpected response.",
    };
  }
  if (error.kind === "config") {
    return {
      title: "Sheet connection is not configured",
      detail: "The app configuration must be checked before data can load.",
    };
  }
  return {
    title: "Live data is unavailable",
    detail: "Nothing was replaced with zero. Try the live sync again.",
  };
}

function formatSyncTime(value: number): string {
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SheetDataStatus({
  error,
  warning,
  refreshing = false,
  lastSyncedAt,
  onRetry,
  className = "",
}: SheetDataStatusProps) {
  const failure = error || warning;

  if (!failure && !refreshing) return null;

  if (!failure) {
    return (
      <div
        className={`flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600 ${className}`}
        role="status"
      >
        <CircleNotch className="h-4 w-4 animate-spin" weight="bold" />
        {lastSyncedAt
          ? `Showing last synced data · ${formatSyncTime(lastSyncedAt)} · Refreshing live sheet…`
          : "Refreshing live sheet…"}
      </div>
    );
  }

  const copy = failureCopy(failure);
  const cached = Boolean(warning && lastSyncedAt);
  return (
    <div
      className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 ${
        cached
          ? "border-amber-200 bg-amber-50 text-amber-950"
          : "border-red-200 bg-red-50 text-red-950"
      } ${className}`}
      role="alert"
    >
      <WarningCircle className="mt-0.5 h-4 w-4 shrink-0" weight="fill" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold">
          {cached ? `Showing last synced data · ${formatSyncTime(lastSyncedAt!)}` : copy.title}
        </p>
        <p className="mt-0.5 text-[12px] leading-relaxed opacity-80">
          {cached ? "The live refresh failed; these values were not replaced with zero." : copy.detail}
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        disabled={refreshing}
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-current/20 bg-white/70 px-2 text-[12px] font-semibold disabled:opacity-60"
      >
        {refreshing ? (
          <CircleNotch className="h-3.5 w-3.5 animate-spin" weight="bold" />
        ) : (
          <ArrowClockwise className="h-3.5 w-3.5" weight="bold" />
        )}
        Retry
      </button>
    </div>
  );
}
