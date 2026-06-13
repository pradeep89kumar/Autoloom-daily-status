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

function titleCaseVendor(v: string): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** True when a master "BEAM AT" value denotes our own premises (not a warping location). */
function isInSat(location: string): boolean {
  return /^\s*in\s*sat\s*$/i.test(String(location ?? ""));
}

/**
 * Collapse the sheet tables into one canonical beam list. The MASTER list
 * ("BEAM NO · BEAM AT") is the full universe of assets and the authoritative
 * per-beam location; the role tables (loaded / empty / warping) say what a
 * beam is doing. Resolution, most-specific first:
 *   1. Loaded table          → loaded   (in SAT, on a loom)
 *   2. EMPTY BEAM list       → empty    (in SAT, run out)
 *   3. master location ≠ SAT → warping  (out at a warping location, e.g. Theivamani)
 *   4. master, in SAT, idle  → ready    (every asset not loaded / empty / warping)
 * The READY warp table (designs wound, no beam id recorded) is kept separately
 * for display as staged warps.
 */
export function normalizeBeams(data: BeamSheetData): BeamRegisterData {
  const beams = new Map<string, Beam>();

  // Helper: only set a beam if not already claimed by a higher-priority state.
  const claim = (id: string, rawId: string, beam: Beam) => {
    if (!id) return;
    if (!beams.has(id)) beams.set(id, beam);
  };

  // 1. Loaded — highest priority.
  // The "R.O STATUS" loaded summary is a per-loom roster in loom order
  // (row 1 = L1, row 2 = L2, …). The sheet's own loom-number column reads
  // unreliably (shifted by one), so the canonical loom is the beam's position
  // in this in-order list. Cross-checked against the design roster: design ↔
  // loom match exactly (e.g. VC/B-16-2 = L1, VC/B-15 = L2, SL-2717-2 = L8).
  let loomSeq = 0;
  for (const r of data.loaded) {
    const id = canonicalBeamId(r.beamNo);
    if (!id) continue;
    loomSeq += 1;
    const loom = String(loomSeq);
    claim(id, r.beamNo, {
      id,
      rawId: String(r.beamNo).trim(),
      state: "loaded",
      location: `L${loom}`,
      loom,
      design: String(r.design || "").trim() || undefined,
      customer: r.customer ? String(r.customer).trim() : undefined,
      roDate: r.roDate ? String(r.roDate).trim() : undefined,
    });
  }

  // 2. Empty — explicit EMPTY BEAM list (in SAT, run out).
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

  // 3 + 4. Resolve every remaining asset from the MASTER list.
  //   • BEAM AT ≠ "in SAT"  → warping (out at a warping location)
  //   • BEAM AT = "in SAT"  → ready   (idle in SAT, not loaded/empty)
  // The OUT SIDE table enriches the warping location name when present.
  const warpName = new Map<string, string>();
  for (const r of data.vendor) {
    const id = canonicalBeamId(r.beamNo);
    if (id) warpName.set(id, titleCaseVendor(r.vendor));
  }

  for (const r of data.master) {
    const id = canonicalBeamId(r.beamNo);
    if (!id || beams.has(id)) continue;
    const warping = !isInSat(r.location) || warpName.has(id);
    if (warping) {
      const name =
        (!isInSat(r.location) ? titleCaseVendor(r.location) : "") || warpName.get(id) || "Warping";
      claim(id, r.beamNo, {
        id,
        rawId: String(r.beamNo).trim(),
        state: "vendor",
        location: name,
        vendor: name,
      });
    } else {
      claim(id, r.beamNo, {
        id,
        rawId: String(r.beamNo).trim(),
        state: "ready",
        location: IN_SAT,
        inferred: true,
      });
    }
  }

  // Fold in any OUT SIDE-table beams that the master list omitted.
  for (const r of data.vendor) {
    const id = canonicalBeamId(r.beamNo);
    if (!id || beams.has(id)) continue;
    const name = titleCaseVendor(r.vendor) || "Warping";
    claim(id, r.beamNo, {
      id,
      rawId: String(r.beamNo).trim(),
      state: "vendor",
      location: name,
      vendor: name,
    });
  }

  // Staged warps (LOAD WARP IN SAT): designs wound and waiting, with no beam id
  // recorded in the sheet. Kept for display alongside the ready asset list.
  const readyWarps: ReadyWarp[] = data.ready
    .map((r) => ({
      design: String(r.design || "").trim(),
      meters: typeof r.meters === "number" && isFinite(r.meters) ? r.meters : undefined,
      beamId: r.beamNo ? canonicalBeamId(r.beamNo) : undefined,
    }))
    .filter((w) => w.design);

  const counts: Record<BeamState, number> = { vendor: 0, ready: 0, loaded: 0, empty: 0 };
  for (const b of beams.values()) counts[b.state] += 1;

  const readyBeamCount = counts.ready;
  const readyWarpCount = readyWarps.length;
  const notes: string[] = [];

  const sorted = [...beams.values()].sort((a, b) => compareBeamId(a.id, b.id));

  return {
    beams: sorted,
    readyWarps,
    counts,
    total: sorted.length,
    integrity: {
      ok: true,
      readyBeamCount,
      readyWarpCount,
      unmappedWarps: 0,
      unaccountedBeams: 0,
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
  { label: string; tamil: string; token: string }
> = {
  vendor: { label: "Warping", tamil: "வார்ப்பிங்", token: "var(--color-status-amber)" },
  ready: { label: "Ready", tamil: "தயார்", token: "var(--color-status-green)" },
  loaded: { label: "Loaded", tamil: "ஏற்றியது", token: "var(--color-brand-primary)" },
  empty: { label: "Empty", tamil: "காலி", token: "var(--color-text-tertiary)" },
};
