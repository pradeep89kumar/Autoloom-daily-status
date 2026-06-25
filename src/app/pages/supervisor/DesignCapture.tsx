import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  Camera,
  UploadSimple,
  Sparkle,
  Plus,
  Trash,
  FloppyDisk,
  CheckCircle,
  Warning,
  X,
  CircleNotch,
} from "@phosphor-icons/react";
import { Button } from "../../components/ui/button";
import { showToast } from "../../components/Toast";
import {
  submitDesign,
  uploadDesignImage,
  extractDesign,
  type DesignPayload,
  type DesignWarpBand,
  type DesignWeftBand,
  type DesignRecord,
} from "../../lib/sheetSync";
import { buildChecks, StripePreview, ColourLegend } from "./Designs";

/* ------------------------------ form state ------------------------------ */

interface WarpRow {
  count: string;
  colour: string;
  layer: string;
  ends: string;
  extra: string;
}
interface WeftRow {
  count: string;
  colour: string;
  picks: string;
  extra: string;
}

const TEXT_FIELDS = [
  "designNo",
  "designName",
  "sourceFirm",
  "receivedDate",
  "weaveType",
  "reed",
  "reedOrder",
  "pickPPI",
  "warpCount",
  "weftCount",
  "warpWidthIn",
  "clothWidthIn",
  "totalEnds",
  "composition",
  "constructionRaw",
  "repeatEnds",
  "noOfRepeat",
  "extraEnds",
  "totalShafts",
  "totalPicks",
  "notes",
] as const;
type TextField = (typeof TEXT_FIELDS)[number];
type Form = Record<TextField, string>;

const EMPTY_FORM: Form = TEXT_FIELDS.reduce((o, k) => ({ ...o, [k]: "" }), {} as Form);

function s(v: unknown): string {
  if (v == null) return "";
  return String(v);
}

/* ------------------------------ screen ------------------------------ */

export function DesignCapture() {
  const navigate = useNavigate();
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [extractTried, setExtractTried] = useState(false);

  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [warp, setWarp] = useState<WarpRow[]>([]);
  const [weft, setWeft] = useState<WeftRow[]>([]);
  const [lowConf, setLowConf] = useState<Set<string>>(new Set());
  const [rawText, setRawText] = useState("");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [imageRefs, setImageRefs] = useState<string[]>([]);

  const [submitting, setSubmitting] = useState(false);

  const set = (k: TextField, v: string) => setForm((f) => ({ ...f, [k]: v }));

  /* ---- photos ---- */
  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    if (picked.length === 0) return;
    setFiles((prev) => [...prev, ...picked]);
    setPreviews((prev) => [...prev, ...picked.map((f) => URL.createObjectURL(f))]);
    e.target.value = "";
  };

  const removePhoto = (i: number) => {
    setFiles((prev) => prev.filter((_, j) => j !== i));
    setPreviews((prev) => {
      const url = prev[i];
      if (url) URL.revokeObjectURL(url);
      return prev.filter((_, j) => j !== i);
    });
  };

  /* ---- assisted extract ---- */
  const onExtract = async () => {
    if (files.length === 0 || extracting) return;
    setExtracting(true);
    setExtractTried(true);
    try {
      const draft = await extractDesign(files);
      if (draft) {
        setForm((f) => {
          const next = { ...f };
          for (const k of TEXT_FIELDS) {
            const val = (draft as Record<string, unknown>)[k];
            if (val != null && s(val).trim() !== "") next[k] = s(val);
          }
          return next;
        });
        if (Array.isArray(draft.warp)) {
          setWarp(
            draft.warp.map((b) => ({
              count: s(b.count),
              colour: s(b.colour),
              layer: s(b.layer),
              ends: b.ends ? String(b.ends) : "",
              extra: b.extra ? String(b.extra) : "",
            })),
          );
        }
        if (Array.isArray(draft.weft)) {
          setWeft(
            draft.weft.map((b) => ({
              count: s(b.count),
              colour: s(b.colour),
              picks: b.picks ? String(b.picks) : "",
              extra: b.extra ? String(b.extra) : "",
            })),
          );
        }
        setLowConf(new Set((draft.lowConfidenceFields || []).map((x) => String(x))));
        if (draft.rawText) setRawText(String(draft.rawText));
        if (typeof draft.confidence === "number") setConfidence(draft.confidence);
        showToast("Details extracted — please review every value.");
      } else {
        showToast("Could not read the photo. Enter the details manually.");
      }
    } finally {
      setExtracting(false);
    }

    // Upload the originals to Drive in the background so the saved design keeps
    // a link to its source sheet. Does not block review.
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const f of files) {
        const u = await uploadDesignImage(f);
        if (u) urls.push(u);
      }
      setImageRefs(urls);
    } finally {
      setUploading(false);
    }
  };

  /* ---- derived: bands as numbers for checks + preview ---- */
  const warpBands: DesignWarpBand[] = useMemo(
    () =>
      warp.map((b, i) => ({
        seq: i + 1,
        count: b.count,
        colour: b.colour,
        layer: b.layer || undefined,
        ends: Number(b.ends) || 0,
        extra: Number(b.extra) || 0,
      })),
    [warp],
  );
  const weftBands: DesignWeftBand[] = useMemo(
    () =>
      weft.map((b, i) => ({
        seq: i + 1,
        count: b.count,
        colour: b.colour,
        picks: Number(b.picks) || 0,
        extra: Number(b.extra) || 0,
      })),
    [weft],
  );

  const checkRecord = useMemo(
    () =>
      ({
        totalEnds: Number(form.totalEnds) || 0,
        repeatEnds: Number(form.repeatEnds) || 0,
        noOfRepeat: Number(form.noOfRepeat) || 0,
        extraEnds: Number(form.extraEnds) || 0,
      }) as unknown as DesignRecord,
    [form.totalEnds, form.repeatEnds, form.noOfRepeat, form.extraEnds],
  );

  const checks = useMemo(
    () => buildChecks(checkRecord, warpBands, weftBands),
    [checkRecord, warpBands, weftBands],
  );

  // Hard block: repeat arithmetic must hold when all three are present.
  const repeatEnds = Number(form.repeatEnds) || 0;
  const noOfRepeat = Number(form.noOfRepeat) || 0;
  const extraEnds = Number(form.extraEnds) || 0;
  const totalEnds = Number(form.totalEnds) || 0;
  const repeatMathBroken =
    repeatEnds > 0 && noOfRepeat > 0 && totalEnds > 0 && repeatEnds * noOfRepeat + extraEnds !== totalEnds;

  const noNumber = !form.designNo.trim();
  const blocked = noNumber || repeatMathBroken;

  /* ---- submit ---- */
  const onSubmit = async () => {
    if (blocked || submitting) return;
    setSubmitting(true);

    const numOrUndef = (v: string) => {
      const n = Number(v);
      return v.trim() !== "" && Number.isFinite(n) ? n : undefined;
    };

    const payload: DesignPayload = {
      kind: "design",
      designNo: form.designNo.trim(),
      designName: form.designName.trim() || undefined,
      sourceFirm: form.sourceFirm.trim() || undefined,
      receivedDate: form.receivedDate.trim() || undefined,
      weaveType: form.weaveType.trim() || undefined,
      reed: form.reed.trim() || undefined,
      reedOrder: form.reedOrder.trim() || undefined,
      pickPPI: form.pickPPI.trim() || undefined,
      warpCount: form.warpCount.trim() || undefined,
      weftCount: form.weftCount.trim() || undefined,
      warpWidthIn: form.warpWidthIn.trim() || undefined,
      clothWidthIn: form.clothWidthIn.trim() || undefined,
      totalEnds: numOrUndef(form.totalEnds),
      composition: form.composition.trim() || undefined,
      constructionRaw: form.constructionRaw.trim() || undefined,
      repeatEnds: numOrUndef(form.repeatEnds),
      noOfRepeat: numOrUndef(form.noOfRepeat),
      extraEnds: numOrUndef(form.extraEnds),
      totalShafts: numOrUndef(form.totalShafts),
      totalPicks: numOrUndef(form.totalPicks),
      warp: warpBands.length ? warpBands : undefined,
      weft: weftBands.length ? weftBands : undefined,
      sourceImageRefs: imageRefs.length ? imageRefs.join(" ") : undefined,
      rawText: rawText.trim() || undefined,
      confidence: confidence != null ? confidence : undefined,
      notes: form.notes.trim() || undefined,
      capturedBy: "Supervisor",
      capturedAt: new Date().toISOString(),
    };

    const res = await submitDesign(payload);
    setSubmitting(false);
    if (res.ok) {
      showToast("Design saved.");
      navigate("/supervisor/designs");
    } else {
      showToast("Could not save. Check the connection and try again.");
    }
  };

  const allChecksOk = checks.every((c) => c.ok);

  return (
    <div className="pb-28">
      {/* photos + extract */}
      <section className="px-4 pt-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)] mb-2">
          Photo of the design sheet
        </h3>

        {previews.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 mb-2">
            {previews.map((src, i) => (
              <div key={i} className="relative shrink-0">
                <img
                  src={src}
                  alt={`Design sheet ${i + 1}`}
                  className="h-28 w-auto rounded-lg border border-[var(--color-border-hairline)] object-cover"
                />
                <button
                  onClick={() => removePhoto(i)}
                  className="absolute -top-1.5 -right-1.5 grid place-items-center w-5 h-5 rounded-full bg-[var(--color-text-primary)] text-white"
                  aria-label="Remove photo"
                >
                  <X className="w-3 h-3" weight="bold" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Camera forces the rear camera; the gallery input (no capture) lets the
            operator pick an image already on the phone, e.g. one received on WhatsApp. */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={onPick}
          className="hidden"
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          multiple
          onChange={onPick}
          className="hidden"
        />
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => cameraRef.current?.click()}>
            <Camera className="w-4 h-4" weight="bold" />
            {previews.length ? "Camera" : "Take photo"}
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => galleryRef.current?.click()}>
            <UploadSimple className="w-4 h-4" weight="bold" />
            Upload file
          </Button>
        </div>
        <Button className="w-full mt-2" onClick={onExtract} disabled={files.length === 0 || extracting}>
          {extracting ? (
            <CircleNotch className="w-4 h-4 animate-spin" weight="bold" />
          ) : (
            <Sparkle className="w-4 h-4" weight="bold" />
          )}
          {extracting ? "Reading…" : "Extract details"}
        </Button>

        {extractTried && !extracting && (
          <p className="mt-2 text-[12px] text-[var(--color-text-tertiary)] leading-relaxed">
            Every value below is a draft. The reading can misjudge reed, count and colours — review and correct
            each field before saving. The supervisor sheet is the source of truth.
            {uploading && " Saving the photo…"}
          </p>
        )}
      </section>

      {/* live preview */}
      {(warpBands.some((b) => b.ends > 0) || weftBands.some((b) => b.picks > 0)) && (
        <Section title="Pattern preview">
          {warpBands.some((b) => b.ends > 0) && (
            <div className="mb-3">
              <div className="text-[11px] text-[var(--color-text-tertiary)] mb-1.5">Warp · across the width</div>
              <StripePreview bands={warpBands} qtyKey="ends" orientation="vertical" />
            </div>
          )}
          {weftBands.some((b) => b.picks > 0) && (
            <div>
              <div className="text-[11px] text-[var(--color-text-tertiary)] mb-1.5">Weft · along the length</div>
              <StripePreview bands={weftBands} qtyKey="picks" orientation="horizontal" />
            </div>
          )}
          <ColourLegend names={[...warpBands.map((b) => b.colour), ...weftBands.map((b) => b.colour)]} />
        </Section>
      )}

      {/* identity */}
      <Section title="Design">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Design No" required value={form.designNo} low={lowConf.has("designNo")} onChange={(v) => set("designNo", v)} />
          <Field label="Design name" value={form.designName} low={lowConf.has("designName")} onChange={(v) => set("designName", v)} />
          <Field label="Source firm" value={form.sourceFirm} low={lowConf.has("sourceFirm")} onChange={(v) => set("sourceFirm", v)} />
          <Field label="Received date" placeholder="YYYY-MM-DD" value={form.receivedDate} low={lowConf.has("receivedDate")} onChange={(v) => set("receivedDate", v)} />
          <Field label="Weave type" value={form.weaveType} low={lowConf.has("weaveType")} onChange={(v) => set("weaveType", v)} />
          <Field label="Composition" value={form.composition} low={lowConf.has("composition")} onChange={(v) => set("composition", v)} />
        </div>
        {noNumber && (
          <p className="mt-2 text-[12px] text-[var(--color-status-red)]">Design No is required to save.</p>
        )}
      </Section>

      {/* construction */}
      <Section title="Construction">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Reed" value={form.reed} low={lowConf.has("reed")} onChange={(v) => set("reed", v)} />
          <Field label="Reed order" value={form.reedOrder} low={lowConf.has("reedOrder")} onChange={(v) => set("reedOrder", v)} />
          <Field label="Pick / PPI" value={form.pickPPI} low={lowConf.has("pickPPI")} onChange={(v) => set("pickPPI", v)} />
          <Field label="Warp count" value={form.warpCount} low={lowConf.has("warpCount")} onChange={(v) => set("warpCount", v)} />
          <Field label="Weft count" value={form.weftCount} low={lowConf.has("weftCount")} onChange={(v) => set("weftCount", v)} />
          <Field label="Warp width (in)" value={form.warpWidthIn} low={lowConf.has("warpWidthIn")} onChange={(v) => set("warpWidthIn", v)} />
          <Field label="Cloth width (in)" value={form.clothWidthIn} low={lowConf.has("clothWidthIn")} onChange={(v) => set("clothWidthIn", v)} />
          <Field label="Total ends" inputMode="numeric" value={form.totalEnds} low={lowConf.has("totalEnds")} onChange={(v) => set("totalEnds", v)} />
          <Field label="Total shafts" inputMode="numeric" value={form.totalShafts} low={lowConf.has("totalShafts")} onChange={(v) => set("totalShafts", v)} />
          <Field label="Total picks" inputMode="numeric" value={form.totalPicks} low={lowConf.has("totalPicks")} onChange={(v) => set("totalPicks", v)} />
        </div>
      </Section>

      {/* repeat */}
      <Section title="Repeat">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Repeat ends" inputMode="numeric" value={form.repeatEnds} low={lowConf.has("repeatEnds")} onChange={(v) => set("repeatEnds", v)} />
          <Field label="× Repeats" inputMode="numeric" value={form.noOfRepeat} low={lowConf.has("noOfRepeat")} onChange={(v) => set("noOfRepeat", v)} />
          <Field label="Extra ends" inputMode="numeric" value={form.extraEnds} low={lowConf.has("extraEnds")} onChange={(v) => set("extraEnds", v)} />
        </div>
        {repeatMathBroken && (
          <p className="mt-2 text-[12px] text-[var(--color-status-red)]">
            {repeatEnds} × {noOfRepeat}
            {extraEnds ? ` + ${extraEnds}` : ""} = {repeatEnds * noOfRepeat + extraEnds}, but total ends says{" "}
            {totalEnds}. Fix before saving.
          </p>
        )}
      </Section>

      {/* warp bands */}
      <Section title={`Warp${warp.length ? ` · ${warp.length} ${warp.length === 1 ? "band" : "bands"}` : ""}`}>
        <BandEditor
          kind="warp"
          warpRows={warp}
          onWarp={setWarp}
        />
      </Section>

      {/* weft bands */}
      <Section title={`Weft${weft.length ? ` · ${weft.length} ${weft.length === 1 ? "band" : "bands"}` : ""}`}>
        <BandEditor
          kind="weft"
          weftRows={weft}
          onWeft={setWeft}
        />
      </Section>

      {/* consistency checks */}
      {checks.length > 0 && (
        <Section title={`Consistency checks${allChecksOk ? "" : " · review"}`}>
          <ul className="space-y-2">
            {checks.map((c, i) => (
              <li key={i} className="flex items-start gap-2">
                {c.ok ? (
                  <CheckCircle className="w-4 h-4 mt-0.5 shrink-0 text-green-600" weight="fill" />
                ) : (
                  <Warning className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" weight="fill" />
                )}
                <span className="text-[13px] text-[var(--color-text-primary)] leading-snug">{c.label}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* notes */}
      <Section title="Notes">
        <textarea
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          rows={3}
          placeholder="Anything the sheet does not capture."
          className="w-full px-3 py-2 rounded-lg border border-[var(--color-border-hairline)] text-[14px] text-[var(--color-text-primary)] bg-white focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--color-brand-primary)_30%,white)]"
        />
      </Section>

      {/* sticky save bar */}
      <div
        className="fixed inset-x-0 bottom-0 z-40 bg-white border-t border-[var(--color-border-hairline)] px-4 py-3 max-w-md mx-auto"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <Button className="w-full h-11" onClick={onSubmit} disabled={blocked || submitting}>
          {submitting ? (
            <CircleNotch className="w-4 h-4 animate-spin" weight="bold" />
          ) : (
            <FloppyDisk className="w-4 h-4" weight="bold" />
          )}
          {submitting ? "Saving…" : "Save design"}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------ pieces ------------------------------ */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-4 mt-5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)] mb-2">
        {title}
      </h3>
      <div className="rounded-xl border border-[var(--color-border-hairline)] bg-white p-3.5">{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  low,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  low?: boolean;
  placeholder?: string;
  inputMode?: "numeric" | "text";
}) {
  return (
    <label className="min-w-0 block">
      <span className="text-[11px] text-[var(--color-text-tertiary)] flex items-center gap-1">
        {label}
        {required && <span className="text-[var(--color-status-red)]">*</span>}
        {low && <span className="text-amber-600" title="Low confidence — please verify">⚠</span>}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className={`mt-1 w-full h-10 px-3 rounded-lg border text-[14px] text-[var(--color-text-primary)] bg-white focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--color-brand-primary)_30%,white)] ${
          low ? "border-amber-400" : "border-[var(--color-border-hairline)]"
        }`}
      />
    </label>
  );
}

function BandEditor(props: {
  kind: "warp";
  warpRows: WarpRow[];
  onWarp: React.Dispatch<React.SetStateAction<WarpRow[]>>;
}): React.ReactElement;
function BandEditor(props: {
  kind: "weft";
  weftRows: WeftRow[];
  onWeft: React.Dispatch<React.SetStateAction<WeftRow[]>>;
}): React.ReactElement;
function BandEditor(props: {
  kind: "warp" | "weft";
  warpRows?: WarpRow[];
  weftRows?: WeftRow[];
  onWarp?: React.Dispatch<React.SetStateAction<WarpRow[]>>;
  onWeft?: React.Dispatch<React.SetStateAction<WeftRow[]>>;
}): React.ReactElement {
  const isWarp = props.kind === "warp";
  const rows = isWarp ? props.warpRows! : props.weftRows!;
  const qtyLabel = isWarp ? "Ends" : "Picks";

  const update = (i: number, key: string, v: string) => {
    if (isWarp) {
      props.onWarp!((prev) => prev.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
    } else {
      props.onWeft!((prev) => prev.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
    }
  };
  const remove = (i: number) => {
    if (isWarp) props.onWarp!((prev) => prev.filter((_, j) => j !== i));
    else props.onWeft!((prev) => prev.filter((_, j) => j !== i));
  };
  const add = () => {
    if (isWarp) props.onWarp!((prev) => [...prev, { count: "", colour: "", layer: "", ends: "", extra: "" }]);
    else props.onWeft!((prev) => [...prev, { count: "", colour: "", picks: "", extra: "" }]);
  };

  const cell =
    "w-full h-9 px-2 rounded-md border border-[var(--color-border-hairline)] text-[13px] text-[var(--color-text-primary)] bg-white focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--color-brand-primary)_30%,white)]";

  return (
    <div>
      {rows.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-secondary)]">No bands yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-12 gap-1.5 items-center">
              <input
                value={r.colour}
                onChange={(e) => update(i, "colour", e.target.value)}
                placeholder="Colour"
                className={`${cell} col-span-4`}
              />
              <input
                value={r.count}
                onChange={(e) => update(i, "count", e.target.value)}
                placeholder="Count"
                className={`${cell} col-span-3`}
              />
              <input
                value={isWarp ? (r as WarpRow).ends : (r as WeftRow).picks}
                onChange={(e) => update(i, isWarp ? "ends" : "picks", e.target.value)}
                placeholder={qtyLabel}
                inputMode="numeric"
                className={`${cell} col-span-2`}
              />
              <input
                value={r.extra}
                onChange={(e) => update(i, "extra", e.target.value)}
                placeholder="Extra"
                inputMode="numeric"
                className={`${cell} col-span-2`}
              />
              <button
                onClick={() => remove(i)}
                className="col-span-1 grid place-items-center text-[var(--color-text-tertiary)]"
                aria-label="Remove band"
              >
                <Trash className="w-4 h-4" weight="bold" />
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        onClick={add}
        className="mt-2.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-brand-primary)]"
      >
        <Plus className="w-4 h-4" weight="bold" />
        Add band
      </button>
    </div>
  );
}
