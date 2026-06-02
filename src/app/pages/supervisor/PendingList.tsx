import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { AlertCircle, Check, Clock } from "lucide-react";
import { LOOM_CATALOG } from "../../lib/looms";
import { fetchRecentRows, type CapturedRow } from "../../lib/sheetSync";
import { detectPendingSlots, type PendingSlot } from "../../lib/pending";
import { isRunoutPending } from "../../lib/runoutFlags";
import { shortDate, ymd, addDays } from "../../lib/shift";

type RowStatus = "logged" | "pending" | "late" | "runout";

interface RowItem {
  loomId: string;
  loomName: string;
  status: RowStatus;
  runout: boolean;
  rowIndex?: number;
}

export function PendingList() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<CapturedRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();
    fetchRecentRows().then((r) => {
      if (cancelled) return;
      const wait = Math.max(0, 3000 - (Date.now() - startedAt));
      setTimeout(() => {
        if (cancelled) return;
        setRows(r);
      }, wait);
    });
    return () => { cancelled = true; };
  }, []);

  const slots = useMemo(() => {
    if (!rows) return [];
    return detectPendingSlots({
      looms: LOOM_CATALOG.map((l) => ({ id: l.id, name: l.name })),
      rows,
      lookbackDays: 14,
    });
  }, [rows]);

  const grouped = useMemo(() => groupAllLooms(slots, rows ?? []), [slots, rows]);

  if (rows === null) {
    return (
      <div className="px-4 pt-4 pb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="mb-3 rounded-xl border border-[var(--color-border-hairline)] p-3">
            <div className="h-4 w-40 rounded bg-black/[0.06] animate-pulse mb-2" />
            <div className="h-3 w-56 rounded bg-black/[0.04] animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-base font-medium">All caught up.</p>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          No backfill entries needed.
        </p>
      </div>
    );
  }

  return (
    <div className="pb-12">
      <div className="px-4 pt-4 pb-3">
        <p className="text-sm text-[var(--color-text-secondary)]">
          Tap a row to log that shift's production.
        </p>
      </div>

      <div className="border-t border-[var(--color-border-hairline)]">
        {grouped.map((group) => (
          <div key={group.key}>
            <div className="px-4 py-2.5 bg-gray-50 border-b border-[var(--color-border-hairline)] flex items-center justify-between">
              <div className="text-[15px] font-semibold">
                {relativeTag(group.date) ?? shortDate(group.date)} {group.shift} shift
                {relativeTag(group.date) && (
                  <span className="ml-1.5 text-[13px] font-normal text-[var(--color-text-secondary)]">
                    ({shortDate(group.date)})
                  </span>
                )}
              </div>
              <StatusChip status={group.status} />
            </div>
            <ul>
              {group.items.map((s) => {
                const isLogged = s.status === "logged";
                const isRunout = s.status === "runout";
                const disabled = isLogged;
                return (
                  <li key={`${s.loomId}|${group.key}`} className="border-b border-[var(--color-border-hairline)]">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        if (disabled) return;
                        navigate(`/supervisor/production/${s.loomId}?date=${ymd(group.date)}&shift=${group.shift}`);
                      }}
                      className={`w-full text-left px-4 py-3.5 flex items-center gap-3 ${
                        disabled ? "opacity-70 cursor-default" : "hover:bg-gray-50"
                      }`}
                    >
                      <span className="font-semibold">{s.loomName}</span>
                      <span className="flex-1 text-sm text-[var(--color-text-secondary)] flex items-center gap-2">
                        {isLogged ? (
                          <span className="inline-flex items-center gap-1 text-[var(--color-status-green)]">
                            <Check className="w-3.5 h-3.5" strokeWidth={2.25} /> Logged
                          </span>
                        ) : (
                          <span>Enter production</span>
                        )}
                        {isRunout && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-[color-mix(in_srgb,var(--color-status-amber)_15%,white)] text-[var(--color-status-amber)] border border-[var(--color-status-amber)]">
                            Run out
                          </span>
                        )}
                      </span>
                      {!disabled && <span className="text-[var(--color-text-secondary)] text-sm">›</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: "pending" | "late" }) {
  if (status === "late") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-status-red)]">
        <AlertCircle className="w-3 h-3" strokeWidth={2} /> Late
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
      <Clock className="w-3 h-3" strokeWidth={2} /> Pending
    </span>
  );
}

interface Group {
  key: string;
  date: Date;
  shift: "A" | "B";
  status: "pending" | "late";
  items: RowItem[];
}

function groupAllLooms(slots: PendingSlot[], rows: CapturedRow[]): Group[] {
  // Build groups from the (date, shift) pairs that have at least one pending/late slot.
  const map = new Map<string, Group>();
  for (const s of slots) {
    const key = `${s.dateYmd}|${s.shift}`;
    let g = map.get(key);
    if (!g) {
      g = { key, date: s.date, shift: s.shift, status: s.status, items: [] };
      map.set(key, g);
    }
    if (s.status === "late") g.status = "late";
  }

  // For each group, list every loom in the catalog with its status.
  const pendingByKey = new Map<string, Map<string, PendingSlot>>();
  for (const s of slots) {
    const k = `${s.dateYmd}|${s.shift}`;
    if (!pendingByKey.has(k)) pendingByKey.set(k, new Map());
    pendingByKey.get(k)!.set(s.loomName.toUpperCase(), s);
  }
  const rowByKey = new Map<string, CapturedRow>();
  for (const r of rows) {
    rowByKey.set(`${r.date}|${r.shift}|${r.loomId.toUpperCase()}`, r);
  }

  for (const g of map.values()) {
    for (const loom of LOOM_CATALOG) {
      const upper = loom.name.toUpperCase();
      const pending = pendingByKey.get(g.key)?.get(upper);
      const row = rowByKey.get(`${ymd(g.date)}|${g.shift}|${upper}`);
      const runout = isRunoutPending(loom.id);
      let status: RowStatus;
      if (row) status = "logged";
      else if (runout) status = "runout";
      else if (pending) status = pending.status;
      else status = "logged"; // not pending, no row → not relevant; treat as logged-equivalent (won't show as missing)
      g.items.push({
        loomId: loom.id,
        loomName: loom.name,
        status,
        runout,
        rowIndex: row?.rowIndex,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    a.key < b.key ? 1 : a.key > b.key ? -1 : 0,
  );
}

function relativeTag(d: Date): string | null {
  const today = ymd(new Date());
  const yesterday = ymd(addDays(new Date(), -1));
  const target = ymd(d);
  if (target === today) return "Today";
  if (target === yesterday) return "Yesterday";
  return null;
}
