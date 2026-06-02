import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { AlertCircle, Check, ChevronDown, ChevronLeft, ChevronRight, Lock, Plus, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { showToast } from "../../components/Toast";
import {
  editProductionRow,
  fetchFullRows,
  fetchLoadings,
  fetchRecentRows,
  submitToSheet,
  type FullRow,
  type LoomState,
} from "../../lib/sheetSync";
import { currentShift, fromYmd, shiftWindow, shortDate, ymd, type Shift } from "../../lib/shift";
import { getLoom, LOOM_CATALOG } from "../../lib/looms";
import { addWeaver, getWeavers } from "../../lib/weavers";
import { loadingStatusForTarget, mergeLoadings, type LoadingEvent } from "../../lib/loadings";

const STATE_OPTIONS: { value: LoomState; label: string }[] = [
  { value: "running",     label: "Running" },
  { value: "start",       label: "Start" },
  { value: "knotting",    label: "Knotting" },
  { value: "runout",      label: "Runout" },
  { value: "error_stop",  label: "Error stop" },
  { value: "powercut",    label: "Powercut" },
];

const QUICK_TAGS = [
  "Many warp cuts",
  "Many weft cuts",
  "Power cut",
  "Electrical issue",
  "Knotting",
  "Idle",
];

export function ProductionEntry() {
  const navigate = useNavigate();
  const { loomId = "" } = useParams();
  const [params] = useSearchParams();

  const loom = getLoom(loomId) ?? {
    id: loomId,
    name: loomId.toUpperCase() || "—",
    designName: "—",
    customerName: "—",
    lastPickK: 0,
  };

  // Backfill mode: ?date=YYYY-MM-DD&shift=A locks shift + date.
  const backfillDateParam = params.get("date");
  const backfillShiftParam = params.get("shift") as Shift | null;
  const isBackfill = !!(backfillDateParam && (backfillShiftParam === "A" || backfillShiftParam === "B"));

  // Edit mode: ?rowIndex=N (loaded from Past logs)
  const rowIndexParam = params.get("rowIndex");
  const rowIndex = rowIndexParam ? parseInt(rowIndexParam, 10) : null;
  const isEdit = !!rowIndex && Number.isFinite(rowIndex);

  const [editRow, setEditRow] = useState<FullRow | null>(null);
  const [editLoading, setEditLoading] = useState(isEdit);
  const locked = isEdit && editRow !== null && !editRow.editable;

  const auto = currentShift();
  const [shift, setShift] = useState<Shift>(isBackfill ? backfillShiftParam! : auto.shift);
  const shiftDate = isBackfill ? fromYmd(backfillDateParam!) : auto.date;

  // Reset form + sheet whenever the user navigates to a different loom
  // (e.g. via NextLoomSheet). Without this, picking the next loom keeps
  // the bottom sheet visible over the new form and prior values stay.
  useEffect(() => {
    setShowNext(false);
    setTouched(false);
    setSubmitting(false);
    setWeaver("");
    setPickCounter("");
    setMeters("");
    setWeftCuts("");
    setWarpCuts("");
    setEfficiency("");
    setRuntime("");
    setTags([]);
    setState("running");
    setNote("");
  }, [loomId]);

  // Edit prefill: fetch the target row and hydrate fields once.
  // Also keeps `allRows` for day-stepper and `loadings` for design/customer resolution.
  const [allRows, setAllRows] = useState<FullRow[]>([]);
  const [loadings, setLoadings] = useState<LoadingEvent[]>([]);
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchFullRows(), fetchLoadings()]).then(([rows, remoteLoadings]) => {
      if (cancelled) return;
      setAllRows(rows);
      setLoadings(mergeLoadings(remoteLoadings));
      if (!isEdit || !rowIndex) return;
      const r = rows.find((x) => x.rowIndex === rowIndex);
      setEditRow(r ?? null);
      setEditLoading(false);
      if (!r) return;
      setWeaver(r.weaver || "");
      setPickCounter(String(Math.round(r.pickCounter / 1000)));
      setMeters(String(r.meters));
      setWeftCuts(String(r.weftCuts));
      setWarpCuts(String(r.warpCuts));
      setEfficiency(r.efficiencyPct ? String(r.efficiencyPct) : "");
      setRuntime(r.runtimeMinutes ? String(r.runtimeMinutes) : "");
      const { tags: parsedTags, rest } = parseTagsFromNote(r.note || "");
      setTags(parsedTags);
      setNote(rest);
      if (r.loomState) setState(r.loomState as LoomState);
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowIndex, isEdit]);

  // Resolved design/customer + lifecycle status for the target shift.
  // In edit mode, the row's saved design/customer is authoritative.
  // Otherwise: derive from prior production rows + loading events. If the
  // last event was a terminating state (runout / error_stop), the form is
  // blocked until a new loading is captured.
  const status = useMemo(() => {
    if (isEdit && editRow) {
      return {
        kind: "active" as const,
        designName: editRow.designName,
        customerName: editRow.customerName,
        source: "row" as const,
      };
    }
    return loadingStatusForTarget(
      loom.name,
      { date: ymd(shiftDate), shift },
      allRows,
      loadings,
    );
  }, [allRows, loadings, loom.name, shiftDate, shift, isEdit, editRow]);

  const resolved = useMemo(() => {
    if (status.kind === "active") {
      return { designName: status.designName, customerName: status.customerName };
    }
    if (status.kind === "completed-needs-loading") {
      return { designName: status.lastDesign, customerName: status.lastCustomer };
    }
    return { designName: loom.designName, customerName: loom.customerName };
  }, [status, loom.designName, loom.customerName]);

  const needsLoading = !isEdit && status.kind === "completed-needs-loading";
  const effectiveDesign = resolved.designName.trim();
  const effectiveCustomer = resolved.customerName.trim();

  // Last pick counter (in thousands) for this loom — derived from the latest
  // production row on/before the target shift, falls back to the static catalog.
  const lastPickK = useMemo(() => {
    const id = loom.name.toUpperCase();
    const targetKey = `${ymd(shiftDate)}|${shift === "A" ? 0 : 1}`;
    let best: { capturedAt: string; pickCounter: number } | null = null;
    for (const r of allRows) {
      if (r.loomId.toUpperCase() !== id) continue;
      const k = `${r.date}|${r.shift === "A" ? 0 : 1}`;
      if (k >= targetKey) continue;
      if (!best || r.capturedAt > best.capturedAt) {
        best = { capturedAt: r.capturedAt, pickCounter: r.pickCounter };
      }
    }
    if (best) return Math.round(best.pickCounter / 1000);
    return loom.lastPickK;
  }, [allRows, loom.name, loom.lastPickK, shiftDate, shift]);

  // Weaver
  const [weavers, setWeavers] = useState<string[]>(getWeavers());
  const [weaver, setWeaver] = useState("");
  const [weaverOpen, setWeaverOpen] = useState(false);
  const [newWeaver, setNewWeaver] = useState("");
  const [adding, setAdding] = useState(false);

  // Numbers
  const [pickCounter, setPickCounter] = useState("");
  const [meters, setMeters] = useState("");
  const [weftCuts, setWeftCuts] = useState("");
  const [warpCuts, setWarpCuts] = useState("");
  const [efficiency, setEfficiency] = useState("");
  const [runtime, setRuntime] = useState(""); // minutes, optional
  const [tags, setTags] = useState<string[]>([]);
  const [state, setState] = useState<LoomState>("running");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);
  const [showNext, setShowNext] = useState(false);

  const pickInt = pickCounter ? parseInt(pickCounter, 10) : NaN;
  const pickDeltaK = Number.isFinite(pickInt) ? Math.max(0, pickInt - lastPickK) : null;
  const pickRegression = Number.isFinite(pickInt) && pickInt < lastPickK && !isBackfill;

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!weaver) e.weaver = "Required.";
    if (!pickCounter) e.pick = "Required.";
    else if (!Number.isFinite(pickInt) || pickInt <= 0) e.pick = "Enter a number.";
    if (!meters) e.meters = "Required.";
    else if (!Number.isFinite(parseFloat(meters)) || parseFloat(meters) < 0) e.meters = "Invalid.";
    if (weftCuts === "") e.weft = "Required.";
    if (warpCuts === "") e.warp = "Required.";
    const eff = parseFloat(efficiency);
    if (efficiency === "") e.efficiency = "Required.";
    else if (!Number.isFinite(eff) || eff < 0 || eff > 100) e.efficiency = "0–100.";
    if (runtime !== "" && (!Number.isFinite(parseInt(runtime, 10)) || parseInt(runtime, 10) < 0)) {
      e.runtime = "Invalid.";
    }
    return e;
  }, [weaver, pickCounter, pickInt, meters, weftCuts, warpCuts, efficiency, runtime]);

  const isComplete = Object.keys(errors).length === 0;

  const handleSubmit = async () => {
    setTouched(true);
    if (!isComplete || submitting || locked || needsLoading) return;
    setSubmitting(true);
    if (isEdit && rowIndex) {
      const res = await editProductionRow({
        kind: "edit",
        rowIndex,
        designName: effectiveDesign,
        customerName: effectiveCustomer,
        weaver,
        pickCounter: pickInt * 1000,
        metersProduced: parseFloat(meters),
        weftCuts: parseInt(weftCuts, 10),
        warpCuts: parseInt(warpCuts, 10),
        efficiencyPct: parseFloat(efficiency),
        runtimeMinutes: runtime === "" ? undefined : parseInt(runtime, 10),
        loomState: state,
        note: composeNote(tags, note) || undefined,
      });
      setSubmitting(false);
      if (res.ok) {
        showToast(`Updated ${loom.name} · ${shift} shift · ${shortDate(shiftDate)}`);
        navigate("/supervisor/logs");
      }
      return;
    }
    const res = await submitToSheet({
      kind: "production",
      loomId: loom.name,
      designName: effectiveDesign,
      customerName: effectiveCustomer,
      weaver,
      shift,
      shiftDate: ymd(shiftDate),
      capturedAt: new Date().toISOString(),
      pickCounter: pickInt * 1000,
      metersProduced: parseFloat(meters),
      weftCuts: parseInt(weftCuts, 10),
      warpCuts: parseInt(warpCuts, 10),
      efficiencyPct: parseFloat(efficiency),
      runtimeMinutes: runtime === "" ? undefined : parseInt(runtime, 10),
      loomState: state,
      note: composeNote(tags, note) || undefined,
    });
    setSubmitting(false);
    if (res.ok) {
      showToast(`Logged for ${loom.name} · ${shift} shift · ${shortDate(shiftDate)}`);
      if (isBackfill) {
        navigate("/supervisor/pending");
      } else {
        setShowNext(true);
      }
    }
  };

  const onAddWeaver = () => {
    const next = addWeaver(newWeaver);
    setWeavers(next);
    setWeaver(newWeaver.trim());
    setNewWeaver("");
    setAdding(false);
    setWeaverOpen(false);
  };

  useEffect(() => {
    if (!weaverOpen) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-weaver-popover]") && !t.closest("[data-weaver-trigger]")) {
        setWeaverOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [weaverOpen]);

  return (
    <div className="pb-32">
      <div className="px-4 pt-4 pb-3 border-b border-[var(--color-border-hairline)]">
        {isEdit && (
          <div className="mb-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--color-brand-primary)] text-white text-[11px] tracking-wide uppercase">
            Edit
          </div>
        )}
        {isBackfill && !isEdit && (
          <div className="mb-2 inline-flex items-center px-2 py-0.5 rounded-full bg-[var(--color-text-primary)] text-white text-[11px] tracking-wide uppercase">
            Backfill
          </div>
        )}
        {locked && (
          <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--color-border-hairline)] bg-gray-50 text-[12px] text-[var(--color-text-secondary)]">
            <Lock className="w-3.5 h-3.5" strokeWidth={1.5} />
            <span>Edit window closed. Update directly on Google Sheet.</span>
          </div>
        )}
        <div className="flex items-baseline gap-2 flex-wrap">
          <h2 className="text-lg font-semibold">{loom.name}</h2>
          <span className="text-sm text-[var(--color-text-secondary)] truncate">
            {effectiveDesign || effectiveCustomer || <span className="italic">(not loaded)</span>}
          </span>
        </div>
        {needsLoading && (
          <div className="mt-3 p-3 rounded-lg border border-[var(--color-status-red)] bg-[color-mix(in_srgb,var(--color-status-red)_6%,white)]">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-[var(--color-status-red)] shrink-0 mt-0.5" strokeWidth={1.75} />
              <div className="flex-1">
                <p className="text-[13px] font-semibold text-[var(--color-status-red)]">
                  Loading completed
                </p>
                <p className="text-[12px] text-[var(--color-text-secondary)] mt-0.5">
                  Last shift ended in {status.kind === "completed-needs-loading" ? labelForState(status.reason) : "runout"}. Capture a new loading before entering production.
                </p>
                <button
                  type="button"
                  onClick={() => navigate(`/supervisor/new-loading?loom=${loom.id}`)}
                  className="mt-2 px-3 py-1.5 rounded-lg bg-[var(--color-status-red)] text-white text-[12px] font-semibold"
                >
                  Capture new loading
                </button>
              </div>
            </div>
          </div>
        )}
        {isEdit && allRows.length > 0 && (
          <DayStepper
            allRows={allRows}
            currentLoomId={loom.name}
            currentRowIndex={rowIndex!}
            onJump={(idx, dateYmd, sh) =>
              navigate(
                `/supervisor/production/${loom.id}?date=${dateYmd}&shift=${sh}&rowIndex=${idx}`,
                { replace: true },
              )
            }
          />
        )}
      </div>

      <div className="px-4 mt-4 flex flex-col gap-3.5">
        <fieldset disabled={locked || needsLoading} className="contents">
        <Field label="Shift">
          <div className="flex items-center gap-3">
            <SegToggle
              options={[
                { value: "A", label: "A shift" },
                { value: "B", label: "B shift" },
              ]}
              value={shift}
              onChange={(v) => !isBackfill && setShift(v as Shift)}
              disabled={isBackfill}
            />
            <span className="text-sm text-[var(--color-text-secondary)]">
              {shortDate(shiftDate)}
            </span>
          </div>
        </Field>

        <Field label="Weaver" error={touched ? errors.weaver : undefined}>
          <div className="relative">
            <button
              type="button"
              data-weaver-trigger
              onClick={() => { setWeaverOpen((v) => !v); setAdding(false); }}
              className={`input text-left flex items-center justify-between ${
                touched && errors.weaver ? "input-error" : ""
              }`}
            >
              <span className={weaver ? "" : "text-[var(--color-text-secondary)]"}>
                {weaver || "Select weaver"}
              </span>
              <ChevronDown className="w-4 h-4 text-[var(--color-text-secondary)]" strokeWidth={1.5} />
            </button>
            {weaverOpen && (
              <ul
                data-weaver-popover
                className="absolute z-10 mt-1 w-full bg-white border border-[var(--color-border-hairline)] rounded-lg shadow-sm max-h-64 overflow-auto"
              >
                {weavers.map((w) => (
                  <li key={w}>
                    <button
                      type="button"
                      onClick={() => { setWeaver(w); setWeaverOpen(false); }}
                      className="w-full text-left px-3 py-2.5 text-[15px] hover:bg-gray-50 flex items-center justify-between"
                    >
                      <span>{w}</span>
                      {weaver === w && <Check className="w-4 h-4" strokeWidth={1.5} />}
                    </button>
                  </li>
                ))}
                <li className="border-t border-[var(--color-border-hairline)]">
                  {adding ? (
                    <div className="p-2 flex gap-2">
                      <input
                        autoFocus
                        value={newWeaver}
                        onChange={(e) => setNewWeaver(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && onAddWeaver()}
                        placeholder="New weaver name"
                        className="input flex-1"
                      />
                      <button
                        type="button"
                        onClick={onAddWeaver}
                        className="px-3 rounded-lg bg-[var(--color-text-primary)] text-white text-sm"
                      >
                        Add
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAdding(true)}
                      className="w-full text-left px-3 py-2.5 text-[15px] hover:bg-gray-50 flex items-center gap-2 text-[var(--color-brand-primary)]"
                    >
                      <Plus className="w-4 h-4" strokeWidth={1.5} />
                      Add new weaver
                    </button>
                  )}
                </li>
              </ul>
            )}
          </div>
        </Field>

        <Field
          label="Pick counter reading"
          hint={
            pickRegression
              ? `Lower than last reading ${lastPickK}k. Re-check before submitting.`
              : pickDeltaK !== null
                ? `Last reading ${lastPickK}k. This shift: ${pickDeltaK}k picks.`
                : `Last reading ${lastPickK}k. Enter the first 3 digits shown on the machine.`
          }
          hintTone={pickRegression ? "warn" : undefined}
          error={touched ? errors.pick : undefined}
        >
          <div className="relative">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={3}
              value={pickCounter}
              onChange={(e) => setPickCounter(e.target.value.replace(/\D/g, "").slice(0, 3))}
              placeholder={String(lastPickK + 18)}
              className={`input pr-14 ${touched && errors.pick ? "input-error" : ""}`}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-text-secondary)] pointer-events-none">
              ×1000
            </span>
          </div>
        </Field>

        <Field label="Meters produced this shift" error={touched ? errors.meters : undefined}>
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              value={meters}
              onChange={(e) => setMeters(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="24.5"
              className={`input pr-10 ${touched && errors.meters ? "input-error" : ""}`}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-text-secondary)] pointer-events-none">
              mtr
            </span>
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Weft cuts" error={touched ? errors.weft : undefined}>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={weftCuts}
              onChange={(e) => setWeftCuts(e.target.value.replace(/\D/g, ""))}
              placeholder="0"
              className={`input ${touched && errors.weft ? "input-error" : ""}`}
            />
          </Field>
          <Field label="Warp cuts" error={touched ? errors.warp : undefined}>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={warpCuts}
              onChange={(e) => setWarpCuts(e.target.value.replace(/\D/g, ""))}
              placeholder="0"
              className={`input ${touched && errors.warp ? "input-error" : ""}`}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Efficiency" error={touched ? errors.efficiency : undefined}>
            <div className="relative">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={3}
                value={efficiency}
                onChange={(e) => setEfficiency(e.target.value.replace(/\D/g, "").slice(0, 3))}
                placeholder="85"
                className={`input pr-8 ${touched && errors.efficiency ? "input-error" : ""}`}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-text-secondary)] pointer-events-none">%</span>
            </div>
          </Field>
          <Field label="Run time (optional)" error={touched ? errors.runtime : undefined}>
            <div className="relative">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                value={runtime}
                onChange={(e) => setRuntime(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="—"
                className={`input pr-10 ${touched && errors.runtime ? "input-error" : ""}`}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-text-secondary)] pointer-events-none">min</span>
            </div>
          </Field>
        </div>

        <Field label="Loom status now">
          <div className="grid grid-cols-3 gap-2">
            {STATE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setState(opt.value)}
                className={`px-2 py-2.5 rounded-lg border text-sm transition-colors ${
                  state === opt.value
                    ? "border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-white"
                    : "border-[var(--color-border-hairline)] bg-white"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Quick notes (optional)">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_TAGS.map((t) => {
              const on = tags.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() =>
                    setTags((prev) => (on ? prev.filter((x) => x !== t) : [...prev, t]))
                  }
                  className={`px-2.5 py-1 rounded-full text-[12px] border-dashed border transition-colors ${
                    on
                      ? "border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-white"
                      : "border-[var(--color-border-hairline)] text-[var(--color-text-secondary)]"
                  }`}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Note (optional)">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Anything unusual…"
            className="input resize-none"
          />
        </Field>
        </fieldset>
      </div>

      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white border-t border-[var(--color-border-hairline)]">
        <div className="px-4 py-3">
          <Button
            size="lg"
            className="w-full"
            disabled={submitting || locked || needsLoading || editLoading}
            onClick={handleSubmit}
          >
            {submitting
              ? (isEdit ? "Saving…" : "Submitting…")
              : locked
                ? "Locked"
                : needsLoading
                  ? "Capture loading first"
                  : isEdit
                    ? "Save changes"
                    : isBackfill
                      ? "Submit backfill"
                      : "Submit production"}
          </Button>
        </div>
      </div>

      {showNext && (
        <NextLoomSheet
          currentLoomId={loom.id}
          currentShift={shift}
          currentDateYmd={ymd(shiftDate)}
          onClose={() => navigate("/supervisor")}
          onPick={(id) => navigate(`/supervisor/production/${id}`, { replace: true })}
        />
      )}

      <style>{`
        .input {
          width: 100%;
          padding: 12px 14px;
          border-radius: 10px;
          border: 1px solid var(--color-border-hairline);
          background: white;
          font-size: 16px;
          line-height: 1.2;
          color: var(--color-text-primary);
          -webkit-appearance: none;
          appearance: none;
        }
        .input::placeholder { color: var(--color-text-secondary); }
        .input:focus { outline: none; border-color: var(--color-text-primary); box-shadow: 0 0 0 3px rgba(17,17,17,0.06); }
        .input-error { border-color: var(--color-status-red); }
        .input-error:focus { box-shadow: 0 0 0 3px rgba(200,49,43,0.12); }
      `}</style>
    </div>
  );
}

function composeNote(tags: string[], free: string): string {
  const t = tags.length ? `[${tags.join(", ")}]` : "";
  const f = free.trim();
  return [t, f].filter(Boolean).join(" ");
}

function parseTagsFromNote(s: string): { tags: string[]; rest: string } {
  const m = s.match(/^\s*\[([^\]]*)\]\s*(.*)$/s);
  if (!m) return { tags: [], rest: s };
  const tags = m[1]
    .split(",")
    .map((x) => x.trim())
    .filter((x) => QUICK_TAGS.includes(x));
  return { tags, rest: m[2] || "" };
}

function DayStepper({
  allRows,
  currentLoomId,
  currentRowIndex,
  onJump,
}: {
  allRows: FullRow[];
  currentLoomId: string;
  currentRowIndex: number;
  onJump: (rowIndex: number, dateYmd: string, shift: Shift) => void;
}) {
  // Same-loom rows, ordered date-shift ascending.
  const sameLoom = useMemo(
    () =>
      [...allRows]
        .filter((r) => r.loomId.toUpperCase() === currentLoomId.toUpperCase())
        .sort((a, b) =>
          a.date === b.date ? (a.shift < b.shift ? -1 : 1) : a.date < b.date ? -1 : 1,
        ),
    [allRows, currentLoomId],
  );
  const idx = sameLoom.findIndex((r) => r.rowIndex === currentRowIndex);
  const prev = idx > 0 ? sameLoom[idx - 1] : null;
  const next = idx >= 0 && idx < sameLoom.length - 1 ? sameLoom[idx + 1] : null;
  const cur = idx >= 0 ? sameLoom[idx] : null;
  if (!cur) return null;

  return (
    <div className="mt-3 flex items-center gap-2">
      <button
        type="button"
        disabled={!prev}
        onClick={() => prev && onJump(prev.rowIndex, prev.date, prev.shift)}
        className="w-8 h-8 rounded-full border border-[var(--color-border-hairline)] flex items-center justify-center disabled:opacity-30"
        aria-label="Previous entry"
      >
        <ChevronLeft className="w-4 h-4" strokeWidth={1.75} />
      </button>
      <div className="flex-1 text-center text-[13px]">
        <span className="font-semibold">{shortDate(fromYmd(cur.date))}</span>
        <span className="text-[var(--color-text-secondary)]"> · {cur.shift} shift</span>
        <span className="text-[11px] text-[var(--color-text-secondary)] ml-1">
          ({idx + 1}/{sameLoom.length})
        </span>
      </div>
      <button
        type="button"
        disabled={!next}
        onClick={() => next && onJump(next.rowIndex, next.date, next.shift)}
        className="w-8 h-8 rounded-full border border-[var(--color-border-hairline)] flex items-center justify-center disabled:opacity-30"
        aria-label="Next entry"
      >
        <ChevronRight className="w-4 h-4" strokeWidth={1.75} />
      </button>
    </div>
  );
}

function Field({
  label,
  hint,
  hintTone,
  error,
  children,
}: {
  label: string;
  hint?: string;
  hintTone?: "warn";
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[13px] font-medium text-[var(--color-text-primary)] tracking-tight">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-[var(--color-status-red)]">{error}</p>
      ) : hint ? (
        <p className={`text-xs ${hintTone === "warn" ? "text-[var(--color-status-amber)]" : "text-[var(--color-text-secondary)]"}`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function NextLoomSheet({
  currentLoomId,
  currentShift: shift,
  currentDateYmd,
  onClose,
  onPick,
}: {
  currentLoomId: string;
  currentShift: Shift;
  currentDateYmd: string;
  onClose: () => void;
  onPick: (loomId: string) => void;
}) {
  const [loggedSet, setLoggedSet] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    fetchRecentRows().then((rows) => {
      if (cancelled) return;
      const key = `${currentDateYmd}|${shift}`;
      setLoggedSet(
        new Set(
          rows
            .filter((r) => `${r.date}|${r.shift}` === key)
            .map((r) => r.loomId.toUpperCase()),
        ),
      );
    });
    return () => { cancelled = true; };
  }, [currentDateYmd, shift]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center max-w-md mx-auto bg-black/30" onClick={onClose}>
      <div
        className="w-full bg-white rounded-t-2xl border-t border-[var(--color-border-hairline)] pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div className="text-base font-semibold">Submitted. Next loom?</div>
          <button onClick={onClose} className="p-1 -mr-1" aria-label="Close">
            <X className="w-5 h-5" strokeWidth={1.5} />
          </button>
        </div>
        <div className="px-4 grid grid-cols-4 gap-2 mt-2">
          {LOOM_CATALOG.map((l) => {
            const isCurrent = l.id === currentLoomId;
            const isLogged = !isCurrent && loggedSet.has(l.name.toUpperCase());
            const blocked = false;
            const disabled = isCurrent || isLogged;
            return (
              <button
                key={l.id}
                disabled={disabled}
                onClick={() => !disabled && onPick(l.id)}
                className={`py-2.5 rounded-lg border text-sm font-medium relative ${
                  isCurrent
                    ? "border-[var(--color-status-green)] bg-[color-mix(in_srgb,var(--color-status-green)_8%,white)] text-[var(--color-status-green)]"
                    : isLogged
                      ? "border-[var(--color-status-green)] bg-[color-mix(in_srgb,var(--color-status-green)_6%,white)] text-[var(--color-status-green)] opacity-80"
                      : blocked
                        ? "border-[var(--color-border-hairline)] bg-gray-50 text-[var(--color-text-secondary)] opacity-60"
                        : "border-[var(--color-border-hairline)] bg-white hover:bg-gray-50"
                }`}
              >
                <span className="inline-flex items-center gap-1">
                  {l.name}
                  {(isCurrent || isLogged) && <Check className="w-3.5 h-3.5" strokeWidth={2.25} />}
                </span>
                {isCurrent && (
                  <span className="block text-[10px] mt-0.5">Submitted</span>
                )}
                {isLogged && (
                  <span className="block text-[10px] mt-0.5">Logged</span>
                )}
                {blocked && (
                  <span className="block text-[10px] text-[var(--color-status-amber)] mt-0.5">Loading</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="px-4 mt-4">
          <button
            onClick={onClose}
            className="w-full py-2.5 text-sm text-[var(--color-text-secondary)] border border-[var(--color-border-hairline)] rounded-lg hover:bg-gray-50"
          >
            Back to looms
          </button>
        </div>
      </div>
    </div>
  );
}

function SegToggle({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={`inline-flex p-0.5 rounded-lg border border-[var(--color-border-hairline)] bg-gray-50 ${
        disabled ? "opacity-70" : ""
      }`}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
            value === o.value
              ? "bg-white text-[var(--color-text-primary)] shadow-sm"
              : "text-[var(--color-text-secondary)]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function labelForState(s: LoomState): string {
  switch (s) {
    case "runout": return "run out";
    case "error_stop": return "error stop";
    case "powercut": return "power cut";
    case "knotting": return "knotting";
    case "start": return "start";
    case "running": return "running";
    default: return s;
  }
}
