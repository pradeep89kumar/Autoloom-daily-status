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

export interface BeamSource {
  /** Fetch + normalise the current beam register. */
  getBeamRegister(): Promise<BeamRegisterData>;
  /** Whether this source can mutate (Phase 2). */
  readonly canEdit: boolean;
  /** True when the data is live from the sheet (vs. local sample). */
  readonly isLive: boolean;
}

const ENDPOINT = import.meta.env.VITE_SHEET_WEBHOOK_URL as string | undefined;
const API_TOKEN = (import.meta.env.VITE_API_TOKEN as string | undefined) || "";

// Append the shared-secret token to a GET URL. No-op when no token is set.
function withToken(url: string): string {
  if (!API_TOKEN) return url;
  const sep = url.indexOf("?") >= 0 ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(API_TOKEN)}`;
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
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function parseSheetData(raw: unknown): BeamSheetData | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const loaded = asArray(o.loaded).map((x) => {
    const r = (x ?? {}) as Record<string, unknown>;
    return {
      loom: String(r.loom ?? ""),
      design: String(r.design ?? ""),
      beamNo: String(r.beamNo ?? ""),
      customer: r.customer != null ? String(r.customer) : undefined,
      roDate: r.roDate != null ? String(r.roDate) : undefined,
    };
  });
  const vendor = asArray(o.vendor).map((x) => {
    const r = (x ?? {}) as Record<string, unknown>;
    return { vendor: String(r.vendor ?? ""), beamNo: String(r.beamNo ?? "") };
  });
  const ready = asArray(o.ready).map((x) => {
    const r = (x ?? {}) as Record<string, unknown>;
    const m = Number(r.meters);
    return {
      design: String(r.design ?? ""),
      meters: isFinite(m) && m > 0 ? m : undefined,
      beamNo: r.beamNo != null ? String(r.beamNo) : undefined,
    };
  });
  const empty = asArray(o.empty).map((x) => {
    const r = (x ?? {}) as Record<string, unknown>;
    return { beamNo: String(r.beamNo ?? "") };
  });
  const master = asArray(o.master).map((x) => {
    const r = (x ?? {}) as Record<string, unknown>;
    return { beamNo: String(r.beamNo ?? ""), location: String(r.location ?? "") };
  });
  return { loaded, vendor, ready, empty, master };
}

export class GoogleSheetBeamSource implements BeamSource {
  readonly canEdit = false;
  readonly isLive = true;
  async getBeamRegister(): Promise<BeamRegisterData> {
    if (!ENDPOINT) throw new Error("no endpoint");
    const res = await fetch(withToken(`${ENDPOINT}?mode=beams`), { method: "GET" });
    const data = await res.json();
    if (!data?.ok) throw new Error("beams endpoint not ready");
    // An endpoint that doesn't yet handle ?mode=beams falls through to the
    // default light-rows response ({ok:true, rows:[...]}) with none of the beam
    // keys. Treat that as "not deployed" so we fall back to the sample.
    const hasBeamKeys = ["loaded", "vendor", "ready", "empty", "master"].some(
      (k) => Array.isArray((data as Record<string, unknown>)[k]),
    );
    if (!hasBeamKeys) throw new Error("beams endpoint not deployed");
    const parsed = parseSheetData(data);
    if (!parsed) throw new Error("bad beams payload");
    return normalizeBeams(parsed);
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
