/**
 * Beam Register — domain model.
 *
 * A *beam* is a fixed physical asset (a warp roller) that this mill owns. Every
 * beam is, at any moment, in exactly one of four lifecycle states:
 *
 *   🏭 vendor  — sent out to a warping vendor; being warped there
 *   ✅ ready   — back in SAT, warped, waiting to be put on a loom
 *   ⚙️ loaded  — mounted on a running loom (knows loom + design + customer)
 *   ⭕ empty   — in SAT, run out, waiting to be sent for re-warp
 *
 * The source sheet ("R.O STATUS") records these as four separate, partially
 * overlapping tables plus a master location list. This module collapses all of
 * that into one canonical `Beam[]`, resolves conflicts, and — because the Ready
 * table lists warps *without* their physical beam id — infers which idle beams
 * must be carrying those ready warps by elimination.
 *
 * This file is pure (no I/O) so the inference + integrity logic stays testable.
 */

export type BeamState = "vendor" | "ready" | "loaded" | "empty";

export const BEAM_STATES: BeamState[] = ["vendor", "ready", "loaded", "empty"];

/** A physical beam asset, resolved to a single lifecycle state. */
export interface Beam {
  /** Canonical asset id — numeric beams get a `SAT-` prefix; `VVK-*` kept. */
  id: string;
  /** Original cell value, for display / debugging. */
  rawId: string;
  state: BeamState;
  /** Human location label: "In SAT", a vendor name, or a loom id when loaded. */
  location: string;
  /** Warping vendor name (vendor state only). */
  vendor?: string;
  /** Loom id, e.g. "L1" (loaded state only). */
  loom?: string;
  /** Design / quality (ready + loaded). */
  design?: string;
  /** Customer name (loaded; only when known). */
  customer?: string;
  /** Warp length in metres (ready + loaded). */
  meters?: number;
  /** Run-out / next-plan date (loaded). */
  roDate?: string;
  /**
   * True when this beam's READY state was inferred by elimination rather than
   * read directly — i.e. it is an in-SAT idle beam presumed to carry a ready
   * warp, but the sheet never mapped a beam id to that warp.
   */
  inferred?: boolean;
}

/** A warp wound and staged in SAT, ready to load. May not name its beam. */
export interface ReadyWarp {
  design: string;
  meters?: number;
  /** Beam id if the sheet provided one; otherwise undefined (the common case). */
  beamId?: string;
}

/**
 * Books-balance check between ready warps and the beams inferred to carry them.
 * Surfaces data-entry holes in the sheet instead of silently inventing mappings.
 */
export interface IntegrityReport {
  ok: boolean;
  readyBeamCount: number;
  readyWarpCount: number;
  /** Ready warps with no beam mapped and none left to infer. */
  unmappedWarps: number;
  /** Idle in-SAT beams beyond what the ready warps account for. */
  unaccountedBeams: number;
  notes: string[];
}

export interface BeamRegisterData {
  beams: Beam[];
  readyWarps: ReadyWarp[];
  counts: Record<BeamState, number>;
  total: number;
  integrity: IntegrityReport;
}

/** Raw shape returned by the sheet backend — one array per sheet table. */
export interface BeamSheetData {
  /** image 1 — LOOM NO · in SAT(=design) · Beam NO */
  loaded: { loom: string; design: string; beamNo: string; customer?: string; roDate?: string }[];
  /** image 2 — OUT SIDE(=warping vendor) · Beam NO */
  vendor: { vendor: string; beamNo: string }[];
  /** image 3 — LOAD WARP IN SAT(=design) · MTRS · BEAM NO (usually blank) */
  ready: { design: string; meters?: number; beamNo?: string }[];
  /** image 4 left — EMPTY BEAM */
  empty: { beamNo: string }[];
  /** image 4 right — master list: Beam NO · location ("in SAT" | vendor) */
  master: { beamNo: string; location: string }[];
}

const IN_SAT = "In SAT";

/** Normalise a raw beam cell into a canonical asset id. */
export function canonicalBeamId(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^\d+$/.test(s)) return `SAT-${s}`;
  const vvk = s.match(/^vvk[\s-]*0*(\d+)$/i);
  if (vvk) return `VVK-${vvk[1]}`;
  return s.toUpperCase();
}

/** True when a master "location" string denotes our own premises (not a vendor). */
function isInSat(location: string): boolean {
  return /^\s*in\s*sat\s*$/i.test(String(location ?? ""));
}

function titleCaseVendor(v: string): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Collapse the four overlapping tables into one canonical beam list.
 *
 * State resolution per asset, most-specific wins:
 *   1. in Loaded table                          → loaded
 *   2. in Vendor table OR master loc = a vendor → vendor
 *   3. in Empty list                            → empty
 *   4. otherwise (in SAT, idle)                 → ready  (inferred)
 */
export function normalizeBeams(data: BeamSheetData): BeamRegisterData {
  const beams = new Map<string, Beam>();

  // Helper: only set a beam if not already claimed by a higher-priority state.
  const claim = (id: string, rawId: string, beam: Beam) => {
    if (!id) return;
    if (!beams.has(id)) beams.set(id, beam);
  };

  // 1. Loaded — highest priority.
  for (const r of data.loaded) {
    const id = canonicalBeamId(r.beamNo);
    if (!id) continue;
    claim(id, r.beamNo, {
      id,
      rawId: String(r.beamNo).trim(),
      state: "loaded",
      location: String(r.loom || "").trim().toUpperCase() || IN_SAT,
      loom: String(r.loom || "").trim().toUpperCase() || undefined,
      design: String(r.design || "").trim() || undefined,
      customer: r.customer ? String(r.customer).trim() : undefined,
      roDate: r.roDate ? String(r.roDate).trim() : undefined,
    });
  }

  // 2. Vendor — explicit OUT SIDE table.
  for (const r of data.vendor) {
    const id = canonicalBeamId(r.beamNo);
    if (!id || beams.has(id)) continue;
    const vendor = titleCaseVendor(r.vendor);
    claim(id, r.beamNo, {
      id,
      rawId: String(r.beamNo).trim(),
      state: "vendor",
      location: vendor || "Vendor",
      vendor: vendor || undefined,
    });
  }

  // 2b. Vendor — master rows whose location is a vendor (not "in SAT").
  for (const r of data.master) {
    const id = canonicalBeamId(r.beamNo);
    if (!id || beams.has(id)) continue;
    if (isInSat(r.location)) continue; // handled below as ready/empty
    const vendor = titleCaseVendor(r.location);
    claim(id, r.beamNo, {
      id,
      rawId: String(r.beamNo).trim(),
      state: "vendor",
      location: vendor || "Vendor",
      vendor: vendor || undefined,
    });
  }

  // 3. Empty — explicit EMPTY BEAM list.
  for (const r of data.empty) {
    const id = canonicalBeamId(r.beamNo);
    if (!id || beams.has(id)) continue;
    claim(id, r.beamNo, {
      id,
      rawId: String(r.beamNo).trim(),
      state: "empty",
      location: IN_SAT,
    });
  }

  // 4. Ready by elimination — master in-SAT beams not yet classified.
  const readyWarps: ReadyWarp[] = data.ready
    .map((r) => ({
      design: String(r.design || "").trim(),
      meters: typeof r.meters === "number" && isFinite(r.meters) ? r.meters : undefined,
      beamId: r.beamNo ? canonicalBeamId(r.beamNo) : undefined,
    }))
    .filter((w) => w.design);

  for (const r of data.master) {
    const id = canonicalBeamId(r.beamNo);
    if (!id || beams.has(id)) continue;
    if (!isInSat(r.location)) continue;
    claim(id, r.beamNo, {
      id,
      rawId: String(r.beamNo).trim(),
      state: "ready",
      location: IN_SAT,
      inferred: true,
    });
  }

  // Attach designs/meters from ready warps onto the inferred ready beams, in
  // order, where a 1:1 link is plausible. We never fabricate a mapping the
  // sheet can't support, so this only fills when counts line up; otherwise the
  // beams keep an empty design and the integrity report flags the gap.
  const readyBeams = [...beams.values()].filter((b) => b.state === "ready");
  if (readyBeams.length === readyWarps.length) {
    readyBeams.forEach((b, i) => {
      const w = readyWarps[i];
      b.design = w.design;
      b.meters = w.meters;
    });
  }

  const counts: Record<BeamState, number> = { vendor: 0, ready: 0, loaded: 0, empty: 0 };
  for (const b of beams.values()) counts[b.state] += 1;

  const readyBeamCount = counts.ready;
  const readyWarpCount = readyWarps.length;
  const unmappedWarps = Math.max(0, readyWarpCount - readyBeamCount);
  const unaccountedBeams = Math.max(0, readyBeamCount - readyWarpCount);
  const notes: string[] = [];
  if (unmappedWarps > 0)
    notes.push(
      `${unmappedWarps} ready warp(s) have no beam in the sheet — beam id is captured only when the warp is loaded.`,
    );
  if (unaccountedBeams > 0)
    notes.push(
      `${unaccountedBeams} idle in-SAT beam(s) are not matched to any ready warp — possible data gap in the sheet.`,
    );

  const sorted = [...beams.values()].sort((a, b) => compareBeamId(a.id, b.id));

  return {
    beams: sorted,
    readyWarps,
    counts,
    total: sorted.length,
    integrity: {
      ok: unmappedWarps === 0 && unaccountedBeams === 0,
      readyBeamCount,
      readyWarpCount,
      unmappedWarps,
      unaccountedBeams,
      notes,
    },
  };
}

/** Sort beams so VVK group and SAT group are ordered naturally by number. */
export function compareBeamId(a: string, b: string): number {
  const pa = a.split("-");
  const pb = b.split("-");
  if (pa[0] !== pb[0]) return pa[0] < pb[0] ? -1 : 1;
  const na = parseInt(pa[1] ?? "", 10);
  const nb = parseInt(pb[1] ?? "", 10);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b);
}

export const BEAM_STATE_META: Record<
  BeamState,
  { label: string; tamil: string; emoji: string; token: string }
> = {
  vendor: { label: "At vendor", tamil: "வார்ப்பிங்", emoji: "🏭", token: "var(--color-status-amber)" },
  ready: { label: "Ready", tamil: "தயார்", emoji: "✅", token: "var(--color-status-green)" },
  loaded: { label: "Loaded", tamil: "ஏற்றியது", emoji: "⚙️", token: "var(--color-brand-primary)" },
  empty: { label: "Empty", tamil: "காலி", emoji: "⭕", token: "var(--color-text-tertiary)" },
};
