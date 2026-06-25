import type { Shift } from "./shift";

export type LoomState =
  | "running"
  | "start"
  | "knotting"
  | "runout"
  | "error_stop"
  | "powercut";

export interface ProductionEntryPayload {
  kind: "production";
  loomId: string;
  designName: string;
  customerName: string;
  weaver: string;
  shift: Shift;          // "A" | "B"
  shiftDate: string;     // YYYY-MM-DD — logical date of the shift
  capturedAt: string;    // ISO of the actual submit time → col M
  pickCounter: number;
  metersProduced: number;
  weftCuts: number;
  warpCuts: number;
  efficiencyPct: number; // mandatory, 0–100
  runtimeMinutes?: number; // optional
  loomState: LoomState;
  note?: string;
}

export interface LoadingPayload {
  kind: "loading";
  loomId: string;
  designName: string;
  customerName: string;
  shift: Shift;
  shiftDate: string;
  capturedAt: string;
  source: "new-loading" | "order-loading";
  resumedFromRunout?: boolean;
}

export interface VisitPayload {
  kind: "visit";
  capturedAt: string;
  country: string;
  region: string;
  city: string;
  latitude: string;
  longitude: string;
  path: string;
  userAgent: string;
}

export type SheetPayload = ProductionEntryPayload | LoadingPayload | VisitPayload | DesignPayload;

const ENDPOINT = import.meta.env.VITE_SHEET_WEBHOOK_URL as string | undefined;
const API_TOKEN = (import.meta.env.VITE_API_TOKEN as string | undefined) || "";

// Append the shared-secret token to a GET URL. No-op when no token is set, so
// the app keeps working before the token is configured.
function withToken(url: string): string {
  if (!API_TOKEN) return url;
  const sep = url.indexOf("?") >= 0 ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(API_TOKEN)}`;
}

// Merge the shared-secret token into a POST payload. No-op when no token is set.
function withTokenBody<T extends object>(p: T): T & { token?: string } {
  return API_TOKEN ? { ...p, token: API_TOKEN } : p;
}

export async function submitToSheet(p: SheetPayload): Promise<{ ok: boolean }> {
  if (!ENDPOINT) {
    console.log(`[sheetSync] no VITE_SHEET_WEBHOOK_URL set — payload:`, p);
    await new Promise((r) => setTimeout(r, 400));
    return { ok: true };
  }
  try {
    await fetch(ENDPOINT, {
      method: "POST",
      mode: "no-cors",
      keepalive: true,
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(withTokenBody(p)),
    });
    return { ok: true };
  } catch (e) {
    console.error("[sheetSync] submit failed", e);
    return { ok: false };
  }
}

export function submitLoadingToSheet(p: LoadingPayload): void {
  // fire-and-forget; loading events are notification-only, never block the UI
  void submitToSheet(p);
}

export async function logVisit(): Promise<void> {
  // Best-effort access logging — geo comes from the Vercel edge function, which
  // only returns real data on the deployed domain. Geo is strictly optional: if
  // the edge function is unavailable or returns non-JSON, log the visit anyway
  // with blank geo rather than dropping the row entirely. Never disrupt the app.
  let g: Partial<{
    country: string;
    region: string;
    city: string;
    latitude: string;
    longitude: string;
  }> = {};
  try {
    const r = await fetch("/api/geo");
    if (r.ok) g = await r.json();
  } catch {
    /* geo unavailable — fall through and log the visit with blank geo */
  }
  try {
    void submitToSheet({
      kind: "visit",
      capturedAt: new Date().toISOString(),
      country: g.country ?? "",
      region: g.region ?? "",
      city: g.city ?? "",
      latitude: g.latitude ?? "",
      longitude: g.longitude ?? "",
      path: window.location.pathname,
      userAgent: navigator.userAgent,
    });
  } catch {
    /* ignore — visit logging must not affect the user */
  }
}

export interface CapturedRow {
  date: string;   // YYYY-MM-DD
  shift: Shift;
  loomId: string;
}

export async function fetchRecentRows(): Promise<CapturedRow[]> {
  if (!ENDPOINT) return [];
  try {
    const res = await fetch(withToken(ENDPOINT), { method: "GET" });
    const data = await res.json();
    if (!data?.ok || !Array.isArray(data.rows)) return [];
    return (data.rows as CapturedRow[]).filter(
      (r) => r && r.date && (r.shift === "A" || r.shift === "B") && r.loomId,
    );
  } catch (e) {
    console.warn("[sheetSync] fetchRecentRows failed", e);
    return [];
  }
}

export interface FullRow {
  rowIndex: number;
  date: string;
  shift: Shift;
  loomId: string;
  designName: string;
  customerName: string;
  pickCounter: number;
  meters: number;
  weftCuts: number;
  warpCuts: number;
  loomState: LoomState | "";
  note: string;
  capturedAt: string;
  weaver: string;
  editedAt: string;
  editable: boolean;
  efficiencyPct: number;
  runtimeMinutes: number;
}

export async function fetchFullRows(): Promise<FullRow[]> {
  if (!ENDPOINT) return [];
  try {
    const res = await fetch(withToken(`${ENDPOINT}?mode=full`), { method: "GET" });
    const data = await res.json();
    if (!data?.ok || !Array.isArray(data.rows)) return [];
    return data.rows as FullRow[];
  } catch (e) {
    console.warn("[sheetSync] fetchFullRows failed", e);
    return [];
  }
}

export interface RemoteLoading {
  capturedAt: string;
  loomId: string;
  designName: string;
  customerName: string;
  shiftDate: string;
  shift: Shift | "";
  source: string;
  resumedFromRunout: boolean;
}

export async function fetchLoadings(): Promise<RemoteLoading[]> {
  if (!ENDPOINT) return [];
  try {
    const res = await fetch(withToken(`${ENDPOINT}?mode=loadings`), { method: "GET" });
    const data = await res.json();
    if (!data?.ok || !Array.isArray(data.rows)) return [];
    return data.rows as RemoteLoading[];
  } catch (e) {
    console.warn("[sheetSync] fetchLoadings failed", e);
    return [];
  }
}

export interface OrderOption {
  design: string;   // combined string from Sheet3 col B (e.g. "Sarvesh 16/1")
  customer: string; // party name from Sheet3 col C (e.g. "Sarvesh")
}

export interface Catalog {
  orders: OrderOption[];
}

export async function fetchCatalog(): Promise<Catalog> {
  if (!ENDPOINT) return { orders: [] };
  try {
    const res = await fetch(withToken(`${ENDPOINT}?mode=catalog`), { method: "GET" });
    const data = await res.json();
    if (!data?.ok) return { orders: [] };
    const raw: unknown = data.orders;
    if (!Array.isArray(raw)) return { orders: [] };
    const orders: OrderOption[] = raw
      .map((o): OrderOption | null => {
        if (typeof o === "string") {
          // Backwards-compat: if Apps Script hasn't been redeployed yet,
          // it may still return strings. Treat the whole string as design,
          // empty customer.
          return o.trim() ? { design: o.trim(), customer: "" } : null;
        }
        if (o && typeof o === "object") {
          const design = String((o as { design?: unknown }).design || "").trim();
          const customer = String((o as { customer?: unknown }).customer || "").trim();
          return design ? { design, customer } : null;
        }
        return null;
      })
      .filter((x): x is OrderOption => x !== null);
    return { orders };
  } catch (e) {
    console.warn("[sheetSync] fetchCatalog failed", e);
    return { orders: [] };
  }
}

export interface EditPayload {
  kind: "edit";
  rowIndex: number;
  designName: string;
  customerName: string;
  weaver: string;
  pickCounter: number;
  metersProduced: number;
  weftCuts: number;
  warpCuts: number;
  efficiencyPct: number;
  runtimeMinutes?: number;
  loomState: LoomState;
  note?: string;
}

export async function editProductionRow(p: EditPayload): Promise<{ ok: boolean }> {
  if (!ENDPOINT) {
    console.log(`[sheetSync] no VITE_SHEET_WEBHOOK_URL set — edit:`, p);
    await new Promise((r) => setTimeout(r, 300));
    return { ok: true };
  }
  try {
    await fetch(ENDPOINT, {
      method: "POST",
      mode: "no-cors",
      keepalive: true,
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(withTokenBody(p)),
    });
    return { ok: true };
  } catch (e) {
    console.error("[sheetSync] edit failed", e);
    return { ok: false };
  }
}

/* ------------------------------ master workbook (Partner) ------------------------------ */

export interface MasterRow {
  rowIndex: number;
  date: string;       // YYYY-MM-DD
  paaguId: string;
  loom: string;       // upper-case (e.g. "L1")
  shift: "A" | "B";
  weaver: string;
  rpm: number;
  adjPickRate: number;
  achievedPick: number;
  meters: number;
  targetMeters: number;
  efficiency: number; // 0..1 fraction
  state: string;      // "RUNNING" | "COMPLITED" | "START" | ...
  ratePerMeter: number;
  revenue: number;
  orderTag: string;   // "Sarvesh 16/1", combined customer + design
}

export interface MasterRangeRow {
  date: string;
  loom: string;
  shift: "A" | "B";
  meters: number;
  targetMeters: number;
  ratePerMeter: number;
  revenue: number;
  efficiency: number;
  state: string;
}

export async function fetchMasterDay(date: string): Promise<MasterRow[]> {
  if (!ENDPOINT) return [];
  try {
    const res = await fetch(withToken(`${ENDPOINT}?mode=master-day&date=${encodeURIComponent(date)}`), { method: "GET" });
    const data = await res.json();
    if (!data?.ok || !Array.isArray(data.rows)) return [];
    return data.rows as MasterRow[];
  } catch (e) {
    console.warn("[sheetSync] fetchMasterDay failed", e);
    return [];
  }
}

export async function fetchMasterRange(from: string, to: string): Promise<MasterRangeRow[]> {
  if (!ENDPOINT) return [];
  try {
    const res = await fetch(
      withToken(`${ENDPOINT}?mode=master-range&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
      { method: "GET" },
    );
    const data = await res.json();
    if (!data?.ok || !Array.isArray(data.rows)) return [];
    return data.rows as MasterRangeRow[];
  } catch (e) {
    console.warn("[sheetSync] fetchMasterRange failed", e);
    return [];
  }
}

export async function fetchMasterOrders(): Promise<Record<string, unknown>[]> {
  if (!ENDPOINT) return [];
  try {
    const res = await fetch(withToken(`${ENDPOINT}?mode=master-orders`), { method: "GET" });
    const data = await res.json();
    if (!data?.ok || !Array.isArray(data.rows)) return [];
    return data.rows as Record<string, unknown>[];
  } catch (e) {
    console.warn("[sheetSync] fetchMasterOrders failed", e);
    return [];
  }
}

export interface ReceivableRow {
  orderId?: string;
  paaguId: string;
  customerName?: string;
  loadedLoom?: string;
  designDetails?: string;
  loomNumber?: string;
  status: string;
  invoiceAmount: number;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  receipts: number;
  receivedOn: string;
  paymentStatus: string;
  pendingBalance: number;
  party: string;
}

export async function fetchMasterReceivables(): Promise<ReceivableRow[]> {
  if (!ENDPOINT) return [];
  try {
    const res = await fetch(withToken(`${ENDPOINT}?mode=master-receivables`), { method: "GET" });
    const data = await res.json();
    if (!data?.ok || !Array.isArray(data.rows)) return [];
    return data.rows as ReceivableRow[];
  } catch (e) {
    console.warn("[sheetSync] fetchMasterReceivables failed", e);
    return [];
  }
}

/* ------------------------------ design master (loom setup) ------------------------------ */

export interface DesignWarpBand {
  seq: number;
  count: string;
  colour: string;
  layer?: string;   // "base" | "top" | "3rd" for double cloth; blank otherwise
  ends: number;
  extra: number;
}

export interface DesignWeftBand {
  seq: number;
  count: string;
  colour: string;
  picks: number;
  extra: number;
}

export interface DesignDraft {
  draftOrder: string;       // e.g. "1,2,3,4;5,6,7,8" (semicolon = new line)
  totalShafts: number;
  totalPicks: number;
  pegPlanImageRef: string;  // Drive URL of the dobby/peg grid crop
  pegPlanJson?: string;     // optional encoded grid for a future editor
}

export interface DesignRecord {
  designId: string;
  designNo: string;
  designName: string;
  sourceFirm: string;
  receivedDate: string;     // YYYY-MM-DD
  weaveType: string;
  reed: string;             // kept as string — fractions like "65½" occur
  reedOrder: string;
  pickPPI: string;
  warpCount: string;
  weftCount: string;
  warpWidthIn: string;
  clothWidthIn: string;
  totalEnds: number;
  composition: string;
  constructionRaw: string;
  repeatEnds: number;
  noOfRepeat: number;
  extraEnds: number;
  totalShafts: number;
  totalPicks: number;
  warpSeqText: string;
  weftSeqText: string;
  sourceImageRefs: string;
  pegPlanImageRef: string;
  capturedBy: string;
  capturedAt: string;
  rawText: string;
  confidence: number | null;
  notes: string;
  // Populated only by fetchDesign (single record), not by the list endpoint:
  warp?: DesignWarpBand[];
  weft?: DesignWeftBand[];
  draft?: DesignDraft | null;
}

export interface DesignPayload {
  kind: "design";
  designId?: string;        // omit to create a new design; include to upsert
  designNo: string;
  designName?: string;
  sourceFirm?: string;
  receivedDate?: string;    // YYYY-MM-DD
  weaveType?: string;
  reed?: string | number;
  reedOrder?: string | number;
  pickPPI?: string | number;
  warpCount?: string;
  weftCount?: string;
  warpWidthIn?: string | number;
  clothWidthIn?: string | number;
  totalEnds?: number;
  composition?: string;
  constructionRaw?: string;
  repeatEnds?: number;
  noOfRepeat?: number;
  extraEnds?: number;
  totalShafts?: number;
  totalPicks?: number;
  warpSeqText?: string;     // optional — backend regenerates if omitted
  weftSeqText?: string;
  sourceImageRefs?: string;
  pegPlanImageRef?: string;
  capturedBy?: string;
  capturedAt?: string;      // ISO; backend stamps to IST
  rawText?: string;
  confidence?: number;
  notes?: string;
  warp?: DesignWarpBand[];
  weft?: DesignWeftBand[];
  draft?: DesignDraft;
}

// Upsert a captured design. Fire-and-forget (no-cors), like the other writers.
export async function submitDesign(p: DesignPayload): Promise<{ ok: boolean }> {
  return submitToSheet(p);
}

/* ------------------------------ design capture (photo + assisted extract) ------------------------------ */

// Unlike submitToSheet (no-cors, opaque), image upload and extraction need the
// response body back. Apps Script answers a "simple" cross-origin POST without a
// preflight when the content type is text/plain, so we keep that header and read
// the JSON. Token still travels in the body via withTokenBody.
async function postReadable<T>(p: object): Promise<T | null> {
  if (!ENDPOINT) {
    console.log(`[sheetSync] no VITE_SHEET_WEBHOOK_URL set — postReadable:`, p);
    return null;
  }
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(withTokenBody(p)),
    });
    return (await res.json()) as T;
  } catch (e) {
    console.warn("[sheetSync] postReadable failed", e);
    return null;
  }
}

// Downscale + re-encode a captured photo so uploads and Gemini calls stay small.
// Returns base64 (no data: prefix) and the mime type actually used.
async function imageToBase64(file: File, maxEdge = 1600, quality = 0.8): Promise<{ data: string; mimeType: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode failed"));
      el.src = dataUrl;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height || 1));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(img, 0, 0, w, h);
      const out = canvas.toDataURL("image/jpeg", quality);
      const comma = out.indexOf(",");
      if (comma > -1) return { data: out.slice(comma + 1), mimeType: "image/jpeg" };
    }
  } catch (e) {
    console.warn("[sheetSync] image compress failed, sending original", e);
  }

  // Fallback: original bytes.
  const comma = dataUrl.indexOf(",");
  return { data: comma > -1 ? dataUrl.slice(comma + 1) : dataUrl, mimeType: file.type || "image/jpeg" };
}

// Store a captured photo in Drive; returns a public-by-link view URL, or null.
export async function uploadDesignImage(file: File): Promise<string | null> {
  const { data, mimeType } = await imageToBase64(file);
  const r = await postReadable<{ ok: boolean; url?: string }>({
    kind: "design-image",
    dataBase64: data,
    mimeType,
    filename: file.name || `design-${Date.now()}.jpg`,
  });
  return r?.ok && r.url ? r.url : null;
}

// What Gemini returns: a draft design plus capture-quality hints. All editable.
export interface ExtractedDesign extends Partial<DesignPayload> {
  confidence?: number;
  lowConfidenceFields?: string[];
  rawText?: string;
}

// Run assisted extraction over one or more captured photos. Values are a DRAFT —
// the supervisor must review and correct them before saving.
export async function extractDesign(files: File[], hint?: string): Promise<ExtractedDesign | null> {
  const images = await Promise.all(
    files.map(async (f) => {
      const { data, mimeType } = await imageToBase64(f);
      return { dataBase64: data, mimeType };
    }),
  );
  const r = await postReadable<{ ok: boolean; draft?: ExtractedDesign; error?: string }>({
    kind: "design-extract",
    images,
    hint: hint || "",
  });
  if (!r?.ok || !r.draft) {
    if (r?.error) console.warn("[sheetSync] extractDesign error", r.error);
    return null;
  }
  return r.draft;
}

// List captured designs (newest first). Parent rows only — no warp/weft bands.
export async function fetchDesigns(): Promise<DesignRecord[]> {
  if (!ENDPOINT) return [];
  try {
    const res = await fetch(withToken(`${ENDPOINT}?mode=designs`), { method: "GET" });
    const data = await res.json();
    if (!data?.ok || !Array.isArray(data.rows)) return [];
    return data.rows as DesignRecord[];
  } catch (e) {
    console.warn("[sheetSync] fetchDesigns failed", e);
    return [];
  }
}

// One full design with reconstructed warp[], weft[] and draft. Look up by
// Design ID or by the printed Design No.
export async function fetchDesign(opts: { id?: string; no?: string }): Promise<DesignRecord | null> {
  if (!ENDPOINT) return null;
  const params = new URLSearchParams({ mode: "design" });
  if (opts.id) params.set("id", opts.id);
  if (opts.no) params.set("no", opts.no);
  try {
    const res = await fetch(withToken(`${ENDPOINT}?${params.toString()}`), { method: "GET" });
    const data = await res.json();
    if (!data?.ok || !data.design) return null;
    return data.design as DesignRecord;
  } catch (e) {
    console.warn("[sheetSync] fetchDesign failed", e);
    return null;
  }
}

export type CashAccount = "tmb" | "iobCa" | "cashbookApp" | "cash" | "iobCc";

export interface CashflowData {
  asOfDate: string;       // ISO YYYY-MM-DD or display string from sheet
  lastEntryDate: string;  // ISO YYYY-MM-DD
  monthLabel: string;     // e.g. "Jun 2026"
  balances: {
    tmb: number;
    iobCa: number;
    cashbookApp: number;
    cash: number;
    iobCcUsed: number;
    iobCcLimit: number;
    iobCcAvailable: number;
  };
  totalAvailable: number;
  month: {
    opInflow: number;
    opOutflow: number;       // negative number
    opCashflowNet: number;
    ccDrawnThisMonth: number;
  };
}

export async function fetchCashflow(): Promise<CashflowData | null> {
  if (!ENDPOINT) return null;
  try {
    const res = await fetch(withToken(`${ENDPOINT}?mode=cashflow`), { method: "GET" });
    const data = await res.json();
    if (!data?.ok || !data.cashflow) return null;
    return data.cashflow as CashflowData;
  } catch (e) {
    console.warn("[sheetSync] fetchCashflow failed", e);
    return null;
  }
}

export interface CashLedgerEntry {
  date: string;          // ISO YYYY-MM-DD
  description: string;
  account: CashAccount;
  category?: string;
  amount: number;        // signed: positive inflow, negative outflow
  type?: string;         // raw "Cash flow type" from sheet
  internal?: boolean;    // true for internal transfers — should render as neutral
  kind?: string;         // "credit" | "debit" | "withdraw" | "repay" | "interest"
}

export interface CashLedgerFilter {
  from?: string;         // ISO
  to?: string;           // ISO
  account?: CashAccount; // omit for all
  direction?: "in" | "out";
}

export async function fetchCashLedger(f: CashLedgerFilter = {}): Promise<CashLedgerEntry[]> {
  if (!ENDPOINT) return [];
  const params = new URLSearchParams({ mode: "cashflow-ledger" });
  if (f.from) params.set("from", f.from);
  if (f.to) params.set("to", f.to);
  if (f.account) params.set("account", f.account);
  if (f.direction) params.set("direction", f.direction);
  try {
    const res = await fetch(withToken(`${ENDPOINT}?${params.toString()}`), { method: "GET" });
    const data = await res.json();
    if (!data?.ok || !Array.isArray(data.rows)) return [];
    return data.rows as CashLedgerEntry[];
  } catch (e) {
    console.warn("[sheetSync] fetchCashLedger failed", e);
    return [];
  }
}

/* ------------------------------ capex (New Shed Expenses) ------------------------------ */

export interface CapexRow {
  date: string;            // YYYY-MM-DD
  project: string;
  expense: string;
  vendor: string;
  amount: number;
  paidFrom: string;
  fundingSource: string;
}

export interface CapexData {
  project: string;
  total: number;
  count: number;
  byFunding: Record<string, number>;
  byExpense: Record<string, number>;
  byPaidFrom: Record<string, number>;
  rows: CapexRow[];
}

export async function fetchCapex(project: string = "6 Looms"): Promise<CapexData | null> {
  if (!ENDPOINT) return null;
  const params = new URLSearchParams({ mode: "capex", project });
  try {
    const res = await fetch(withToken(`${ENDPOINT}?${params.toString()}`), { method: "GET" });
    const data = await res.json();
    if (!data?.ok || !data.capex) return null;
    return data.capex as CapexData;
  } catch (e) {
    console.warn("[sheetSync] fetchCapex failed", e);
    return null;
  }
}
