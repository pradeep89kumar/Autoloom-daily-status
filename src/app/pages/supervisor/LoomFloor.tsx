import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { WarningCircle, Check, Clock, Users } from "@phosphor-icons/react";
import { LOOM_CATALOG, isNewLoom } from "../../lib/looms";
import { NewPill } from "../../components/NewPill";

import {
  fetchFullRows,
  fetchLoadings,
  fetchRecentRows,
  type CapturedRow,
  type FullRow,
} from "../../lib/sheetSync";
import { detectPendingSlots } from "../../lib/pending";
import { addDays, currentShift, shiftWindow, shortDate, ymd } from "../../lib/shift";
import {
  latestLoading,
  loadingStatusForTarget,
  mergeLoadings,
  type LoadingEvent,
} from "../../lib/loadings";

export function LoomFloor() {
  const navigate = useNavigate();

  const [rows, setRows] = useState<CapturedRow[] | null>(null);
  const [fullRows, setFullRows] = useState<FullRow[]>([]);
  const [loadings, setLoadings] = useState<LoadingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const refetch = () => {
    setLoading(true);
    const startedAt = Date.now();
    Promise.all([fetchRecentRows(), fetchFullRows(), fetchLoadings()]).then(
      ([r, f, l]) => {
        setRows(r);
        setFullRows(f);
        setLoadings(mergeLoadings(l));
        const wait = Math.max(0, 3000 - (Date.now() - startedAt));
        setTimeout(() => setLoading(false), wait);
      },
    );
  };
  useEffect(() => {
    refetch();
    const onFocus = () => refetch();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Build a set of looms that already have a row for the current shift+date.
  const cs = useMemo(() => currentShift(), []);
  const sw = useMemo(() => shiftWindow(cs.date, cs.shift), [cs]);
  const now = new Date();
  const inNagWindow = now >= sw.nagFrom;

  // Previous shift = the one that just ended. If we're in A, prev is B of yesterday.
  // If we're in B, prev is A of the same logical date.
  const prev = useMemo<{ shift: "A" | "B"; date: Date }>(() => {
    if (cs.shift === "A") return { shift: "B", date: addDays(cs.date, -1) };
    return { shift: "A", date: cs.date };
  }, [cs]);
  const prevWindow = useMemo(() => shiftWindow(prev.date, prev.shift), [prev]);

  const loggedSet = useMemo(() => {
    if (!rows) return new Set<string>();
    const key = `${ymd(cs.date)}|${cs.shift}`;
    return new Set(
      rows
        .filter((r) => `${r.date}|${r.shift}` === key)
        .map((r) => r.loomId.toUpperCase()),
    );
  }, [rows, cs]);

  const prevLoggedSet = useMemo(() => {
    if (!rows) return new Set<string>();
    const key = `${ymd(prev.date)}|${prev.shift}`;
    return new Set(
      rows
        .filter((r) => `${r.date}|${r.shift}` === key)
        .map((r) => r.loomId.toUpperCase()),
    );
  }, [rows, prev]);

  // Lifecycle status per loom for the current shift window. A loom that ended
  // last shift in runout / error_stop is "needs loading" until a new loading
  // event is captured.
  const targetForStatus = useMemo(
    () => ({ date: ymd(cs.date), shift: cs.shift }),
    [cs],
  );
  const needsLoading = (loomName: string) => {
    const s = loadingStatusForTarget(loomName, targetForStatus, fullRows, loadings);
    return s.kind === "completed-needs-loading";
  };

  const prevPending = LOOM_CATALOG.filter(
    (l) => !prevLoggedSet.has(l.name.toUpperCase()) && !needsLoading(l.name),
  );
  const prevLate = now >= prevWindow.cutoff;

  const todayPendingLooms = LOOM_CATALOG.filter(
    (l) => !loggedSet.has(l.name.toUpperCase()) && !needsLoading(l.name),
  );

  // Default target = the latest available shift the operator should fill now.
  // If today's entry window is open and today has pending → today.
  // Else if the previous shift has pending → previous shift.
  // Else null (all caught up).
  const target = useMemo<{ shift: "A" | "B"; date: Date; isToday: boolean } | null>(() => {
    if (!rows) return null;
    if (inNagWindow && todayPendingLooms.length > 0) {
      return { shift: cs.shift, date: cs.date, isToday: true };
    }
    if (prevPending.length > 0) {
      return { shift: prev.shift, date: prev.date, isToday: false };
    }
    return null;
  }, [rows, inNagWindow, todayPendingLooms.length, prevPending.length, cs, prev]);

  const targetWindow = target ? shiftWindow(target.date, target.shift) : null;
  const targetLate = target && targetWindow ? now >= targetWindow.cutoff : false;
  const targetLoggedSet = target?.isToday ? loggedSet : prevLoggedSet;
  const targetPendingCount = target?.isToday ? todayPendingLooms.length : prevPending.length;

  // Progress strip reflects the target shift.
  const totalLooms = LOOM_CATALOG.length;
  const targetLogged = totalLooms - targetPendingCount - LOOM_CATALOG.filter((l) => needsLoading(l.name) && !targetLoggedSet.has(l.name.toUpperCase())).length;

  const pendingSlots = useMemo(() => {
    if (!rows) return [];
    return detectPendingSlots({
      looms: LOOM_CATALOG.map((l) => ({ id: l.id, name: l.name })),
      rows,
      lookbackDays: 14,
    });
  }, [rows]);

  // Banners: any pending shift that isn't the current target.
  const targetKey = target ? `${ymd(target.date)}|${target.shift}` : null;
  const pendingShifts = useMemo(() => {
    const map = new Map<string, { date: Date; shift: "A" | "B"; status: "pending" | "late" }>();
    for (const s of pendingSlots) {
      const key = `${s.dateYmd}|${s.shift}`;
      if (key === targetKey) continue;
      const existing = map.get(key);
      if (!existing || (s.status === "late" && existing.status !== "late")) {
        map.set(key, { date: s.date, shift: s.shift, status: s.status });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.shift < b.shift ? -1 : 1,
    );
  }, [pendingSlots, targetKey]);

  return (
    <div className="pb-8">
      {/* Top action bar — always present */}
      <div className="px-4 py-2.5 border-b border-[var(--color-border-hairline)] flex items-center justify-between gap-2">
        <button
          onClick={() => navigate("/role")}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--color-border-hairline)] text-sm hover:bg-gray-50"
        >
          <Users className="w-4 h-4" weight="bold" />
          Switch
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("/supervisor/beams")}
            className="inline-flex items-center px-2.5 py-1.5 rounded-lg border border-[var(--color-border-hairline)] text-sm hover:bg-gray-50"
          >
            பீம்
          </button>
          <button
            onClick={() => navigate("/supervisor/logs")}
            className="inline-flex items-center px-2.5 py-1.5 rounded-lg border border-[var(--color-border-hairline)] text-sm hover:bg-gray-50"
          >
            பழைய பதிவுகள்
          </button>
        </div>
      </div>

      {loading && <LoomFloorSkeleton />}

      {!loading && (
        <>
      {/* Progress strip — reflects the default target shift */}
      {target && (
        <div className="px-4 pt-3 pb-3 border-b border-[var(--color-border-hairline)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">Progress</span>
            <span className="text-[11px] text-[var(--color-text-secondary)]">
              {targetLogged}/{totalLooms} பதிவு · {targetPendingCount} மீதம்
            </span>
          </div>
          <div className="flex gap-1">
            {LOOM_CATALOG.map((l) => {
              const logged = targetLoggedSet.has(l.name.toUpperCase());
              const runout = needsLoading(l.name);
              const cls = logged
                ? "bg-[var(--color-status-green)]"
                : runout
                  ? "bg-[var(--color-status-amber)]"
                  : targetLate
                    ? "bg-[var(--color-status-red)]"
                    : "bg-[var(--color-border-hairline)]";
              return <span key={l.id} className={`flex-1 h-1.5 rounded-full ${cls}`} />;
            })}
          </div>
        </div>
      )}

      {/* Default fill page — latest available shift to enter */}
      {target && targetWindow && (
        <div className="px-4 pt-4 pb-4">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${
              targetLate
                ? "bg-[var(--color-status-red)] text-white"
                : "bg-[var(--color-text-primary)] text-white"
            }`}>
              {targetLate ? "Late · Backfill" : "Enter now"}
            </span>
            <span className="text-base font-semibold">
              {relativeTag(target.date) ?? shortDate(target.date)}
            </span>
            <span className="text-base font-semibold text-[var(--color-text-secondary)]">·</span>
            <span className="text-base font-semibold">{target.shift} shift</span>
            <span className="text-[12px] text-[var(--color-text-secondary)]">
              ({shortDate(target.date)})
            </span>
          </div>
          <p className="text-[12px] text-[var(--color-text-secondary)] mt-1 mb-3">
            {targetLate
              ? "Cut-off passed — backfill these entries."
              : `Cut-off ${fmtTime(targetWindow.cutoff)}.`}
          </p>
          <div className="grid grid-cols-4 gap-2">
            {LOOM_CATALOG.map((l) => {
              const logged = targetLoggedSet.has(l.name.toUpperCase());
              const runout = needsLoading(l.name);
              const disabled = logged || runout;
              const lateLoading = (() => {
                const ld = latestLoading(l.name, loadings);
                if (!ld || !targetWindow) return null;
                return new Date(ld.capturedAt).getTime() > targetWindow.start.getTime() ? ld : null;
              })();
              return (
                <button
                  key={l.id}
                  type="button"
                  disabled={logged}
                  onClick={() => {
                    if (logged) return;
                    if (runout) {
                      navigate(`/supervisor/new-loading?loom=${l.id}`);
                      return;
                    }
                    navigate(
                      `/supervisor/production/${l.id}?date=${ymd(target.date)}&shift=${target.shift}`,
                    );
                  }}
                  className={`py-3 rounded-lg border text-sm font-semibold relative ${
                    logged
                      ? "border-[var(--color-status-green)] bg-[color-mix(in_srgb,var(--color-status-green)_6%,white)] text-[var(--color-status-green)]"
                      : runout
                        ? "border-[var(--color-status-red)] bg-[color-mix(in_srgb,var(--color-status-red)_6%,white)] text-[var(--color-status-red)]"
                        : targetLate
                          ? "border-[var(--color-status-red)] bg-[color-mix(in_srgb,var(--color-status-red)_6%,white)] text-[var(--color-status-red)]"
                          : "border-[var(--color-text-primary)] bg-white hover:bg-gray-50"
                  }`}
                >
                  <span className="inline-flex items-center gap-1">
                    {l.name}
                    {isNewLoom(l.id) && <NewPill />}
                    {logged && <Check className="w-3.5 h-3.5" weight="bold" />}
                  </span>
                  {logged && (
                    <span className="block text-[10px] mt-0.5 font-medium">Logged</span>
                  )}
                  {runout && !logged && (
                    <span className="block text-[10px] text-[var(--color-status-red)] mt-0.5 font-medium">Needs loading</span>
                  )}
                  {lateLoading && !logged && !runout && (
                    <span className="block text-[10px] text-[var(--color-status-amber)] mt-0.5 font-medium" title={`New loading captured ${new Date(lateLoading.capturedAt).toLocaleString()}`}>New loading</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* All caught up */}
      {rows && !target && (
        <div className="px-4 py-10 text-center">
          <p className="text-sm text-[var(--color-text-secondary)]">All shifts entered. Next entry window opens {fmtTime(sw.nagFrom)}.</p>
        </div>
      )}

      {/* Late / pending shift banners */}
      {pendingShifts.length > 0 && (
        <div className="px-4 pt-4 flex flex-col gap-2 border-t border-[var(--color-border-hairline)]">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-[var(--color-text-secondary)] mt-1">
            Other pending shifts
          </p>
          {pendingShifts.map((s) => (
            <button
              key={`${ymd(s.date)}|${s.shift}`}
              onClick={() => navigate("/supervisor/pending")}
              className={`w-full text-left flex items-center gap-3 px-3.5 py-3 rounded-xl border ${
                s.status === "late"
                  ? "border-[var(--color-status-red)] bg-[color-mix(in_srgb,var(--color-status-red)_6%,white)]"
                  : "border-[var(--color-border-hairline)] bg-gray-50"
              }`}
            >
              {s.status === "late" ? (
                <WarningCircle className="w-4 h-4 text-[var(--color-status-red)] shrink-0" weight="fill" />
              ) : (
                <Clock className="w-4 h-4 text-[var(--color-text-secondary)] shrink-0" weight="duotone" />
              )}
              <span className="flex-1 text-sm">
                <span className={`font-semibold ${s.status === "late" ? "text-[var(--color-status-red)]" : ""}`}>
                  {relativeTag(s.date) ?? shortDate(s.date)} {s.shift} shift
                </span>
                <span className="text-[var(--color-text-secondary)]">
                  {" "}· {s.status === "late" ? "late — backfill now" : `enter before ${fmtTime(shiftWindow(s.date, s.shift).cutoff)}`}
                </span>
              </span>
              <span className="text-[var(--color-text-secondary)] text-sm">›</span>
            </button>
          ))}
        </div>
      )}
        </>
      )}
    </div>
  );
}

function LoomFloorSkeleton() {
  return (
    <div className="px-4 pt-3">
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="h-3 w-16 rounded bg-black/[0.06] animate-pulse" />
          <div className="h-3 w-24 rounded bg-black/[0.04] animate-pulse" />
        </div>
        <div className="flex gap-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <span key={i} className="flex-1 h-1.5 rounded-full bg-black/[0.06] animate-pulse" />
          ))}
        </div>
      </div>
      <div className="h-5 w-44 rounded bg-black/[0.06] animate-pulse mb-2" />
      <div className="h-3 w-32 rounded bg-black/[0.04] animate-pulse mb-4" />
      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-black/[0.05] animate-pulse" />
        ))}
      </div>
    </div>
  );
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function relativeTag(d: Date): string | null {
  const today = ymd(new Date());
  const yesterday = ymd(addDays(new Date(), -1));
  const target = ymd(d);
  if (target === today) return "இன்று";
  if (target === yesterday) return "நேற்று";
  return null;
}
