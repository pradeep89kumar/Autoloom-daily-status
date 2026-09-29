/**
 * Beam Register — data source abstraction.
 *
 * The UI talks ONLY to a `BeamSource`, never to the sheet directly. Today the
 * Google Sheet ("R.O STATUS") is the source of truth and the app is read-only.
 * Later, supervisors will edit beams in-app: we add the write methods to a new
 * source implementation and the UI does not change.
 *
 *   Phase 1 (now):   GoogleSheetBeamSource  — read-only, via Apps Script
 *   Phase 2 (later): AppStoreBeamSource      — writable; moveBeam()/updateBeam()
 *
 * `getBeamRegister()` returns the already-normalised, conflict-resolved data so
 * screens never see the raw four-table mess.
 */

import {
  normalizeBeams,
  type BeamRegisterData,
  type BeamSheetData,
} from "./beams";
import {
  isSheetArrayOf,
  isSheetFiniteNumber,
  isSheetJsonRecord,
  isSheetString,
  peekSheetCache,
  readSheet,
  type SheetCacheSnapshot,
  type SheetReadRequest,
  type SheetReadResult,
} from "./sheetClient";

export interface BeamSource {
  /** Fetch + normalise the current beam register. */
  getBeamRegister(): Promise<BeamRegisterData>;
  /** Whether this source can mutate (Phase 2). */
  readonly canEdit: boolean;
  /** True when the data is live from the sheet (vs. local sample). */
  readonly isLive: boolean;
}

/* ----------------------------- sample data ----------------------------- */
// Mirrors the four R.O STATUS tables as seen on the floor sheet, so the module
// is fully usable before the `?mode=beams` backend is deployed. Once the backend
// returns data, the live source supersedes this automatically.
export const SAMPLE_BEAM_SHEET: BeamSheetData = {
  loaded: [
    { loom: "L1", design: "VC/B-16-2", beamNo: "VVK-1" },
    { loom: "L2", design: "VC/B-15", beamNo: "VVK-6" },
    { loom: "L3", design: "249JB-2", beamNo: "VVK-5" },
    { loom: "L4", design: "ASF000-920-5", beamNo: "15" },
    { loom: "L5", design: "VC/B-16-1", beamNo: "21" },
    { loom: "L6", design: "ASF000-920-4", beamNo: "13" },
    { loom: "L7", design: "SL-2717-3", beamNo: "12" },
    { loom: "L8", design: "SL-2717-2", beamNo: "VVK-7" },
  ],
  vendor: [
    { vendor: "THEIVAMANI", beamNo: "14" },
    { vendor: "THEIVAMANI", beamNo: "24" },
    { vendor: "THEIVAMANI", beamNo: "VVK-4" },
  ],
  ready: [
    { design: "K-SRI-5", meters: 2300 },
    { design: "K-SRI RED DOBBY-2", meters: 2550 },
    { design: "VIMAL-VC/B4", meters: 2250 },
    { design: "VIMAL-VC/B4", meters: 2250 },
  ],
  empty: [
    { beamNo: "VVK-2" },
    { beamNo: "18" },
    { beamNo: "17" },
    { beamNo: "23" },
    { beamNo: "11" },
    { beamNo: "25" },
    { beamNo: "vvk-3" },
    { beamNo: "22" },
    { beamNo: "20" },
  ],
  master: [
    { beamNo: "21", location: "in SAT" },
    { beamNo: "22", location: "in SAT" },
    { beamNo: "23", location: "in SAT" },
    { beamNo: "24", location: "THEIVAMANI" },
    { beamNo: "25", location: "in SAT" },
    { beamNo: "26", location: "in SAT" },
    { beamNo: "27", location: "in SAT" },
    { beamNo: "VVK-1", location: "in SAT" },
    { beamNo: "VVK-2", location: "in SAT" },
    { beamNo: "VVK-3", location: "in SAT" },
    { beamNo: "VVK-4", location: "THEIVAMANI" },
    { beamNo: "VVK-5", location: "in SAT" },
    { beamNo: "VVK-6", location: "in SAT" },
    { beamNo: "VVK-7", location: "in SAT" },
    { beamNo: "VVK-8", location: "in SAT" },
  ],
};

/* ----------------------------- mock source ----------------------------- */
export class MockBeamSource implements BeamSource {
  readonly canEdit = false;
  readonly isLive = false;
  constructor(private readonly data: BeamSheetData = SAMPLE_BEAM_SHEET) {}
  async getBeamRegister(): Promise<BeamRegisterData> {
    await new Promise((r) => setTimeout(r, 300));
    return normalizeBeams(this.data);
  }
}

/* -------------------------- google sheet source ------------------------ */
function optionalString(value: unknown): boolean {
  return value === undefined || isSheetString(value);
}

function isLoadedBeam(value: unknown): value is BeamSheetData["loaded"][number] {
  return (
    isSheetJsonRecord(value) &&
    isSheetString(value.loom) &&
    isSheetString(value.design) &&
    isSheetString(value.beamNo) &&
    optionalString(value.customer) &&
    optionalString(value.roDate)
  );
}

function isVendorBeam(value: unknown): value is BeamSheetData["vendor"][number] {
  return (
    isSheetJsonRecord(value) &&
    isSheetString(value.vendor) &&
    isSheetString(value.beamNo)
  );
}

function isReadyBeam(value: unknown): value is BeamSheetData["ready"][number] {
  return (
    isSheetJsonRecord(value) &&
    isSheetString(value.design) &&
    (value.meters === undefined || isSheetFiniteNumber(value.meters)) &&
    optionalString(value.beamNo)
  );
}

function isRawReadyBeam(value: unknown): value is Record<string, unknown> {
  return (
    isSheetJsonRecord(value) &&
    isSheetString(value.design) &&
    (value.meters === undefined || value.meters === null || isSheetFiniteNumber(value.meters)) &&
    optionalString(value.beamNo)
  );
}

function isEmptyBeam(value: unknown): value is BeamSheetData["empty"][number] {
  return isSheetJsonRecord(value) && isSheetString(value.beamNo);
}

function isMasterBeam(value: unknown): value is BeamSheetData["master"][number] {
  return (
    isSheetJsonRecord(value) &&
    isSheetString(value.beamNo) &&
    isSheetString(value.location)
  );
}

function isBeamSheetData(value: unknown): value is BeamSheetData {
  if (!isSheetJsonRecord(value)) return false;
  return (
    isSheetArrayOf(value.loaded, isLoadedBeam) &&
    isSheetArrayOf(value.vendor, isVendorBeam) &&
    isSheetArrayOf(value.ready, isReadyBeam) &&
    isSheetArrayOf(value.empty, isEmptyBeam) &&
    isSheetArrayOf(value.master, isMasterBeam)
  );
}

function parseBeamSheetData(body: Record<string, unknown>): BeamSheetData {
  if (
    !isSheetArrayOf(body.loaded, isLoadedBeam) ||
    !isSheetArrayOf(body.vendor, isVendorBeam) ||
    !isSheetArrayOf(body.ready, isRawReadyBeam) ||
    !isSheetArrayOf(body.empty, isEmptyBeam) ||
    !isSheetArrayOf(body.master, isMasterBeam)
  ) {
    throw new Error("invalid beams response");
  }
  return {
    loaded: body.loaded,
    vendor: body.vendor,
    ready: body.ready.map((item) => {
      const row = item as Record<string, unknown>;
      const meters = isSheetFiniteNumber(row.meters) && row.meters > 0 ? row.meters : undefined;
      return {
        design: row.design as string,
        meters,
        beamNo: typeof row.beamNo === "string" ? row.beamNo : undefined,
      };
    }),
    empty: body.empty,
    master: body.master,
  };
}

function beamSheetRequest(): SheetReadRequest<BeamSheetData> {
  return {
    key: "supervisor:beams",
    params: { mode: "beams" },
    select: parseBeamSheetData,
    validate: isBeamSheetData,
  };
}

function mapBeamResult(result: SheetReadResult<BeamSheetData>): SheetReadResult<BeamRegisterData> {
  if (!result.ok) return result;
  return { ...result, data: normalizeBeams(result.data) };
}

export async function fetchBeamRegisterResult(): Promise<SheetReadResult<BeamRegisterData>> {
  return mapBeamResult(await readSheet(beamSheetRequest()));
}

export function peekBeamRegisterCache(): SheetCacheSnapshot<BeamRegisterData> | null {
  const cached = peekSheetCache(beamSheetRequest());
  return cached ? { ...cached, data: normalizeBeams(cached.data) } : null;
}

export class GoogleSheetBeamSource implements BeamSource {
  readonly canEdit = false;
  readonly isLive = true;
  async getBeamRegister(): Promise<BeamRegisterData> {
    const result = await fetchBeamRegisterResult();
    if (!result.ok) throw new Error(`beam source unavailable (${result.error.kind})`);
    return result.data;
  }
}

/* ------------------------------- factory ------------------------------- */
/**
 * Returns the live Google Sheet source. There is intentionally NO mock
 * fallback: until the Apps Script `?mode=beams` endpoint is deployed, the
 * source throws and the UI shows a "not connected" message rather than
 * misleading sample data.
 */
export function getBeamSource(): BeamSource {
  return new GoogleSheetBeamSource();
}
