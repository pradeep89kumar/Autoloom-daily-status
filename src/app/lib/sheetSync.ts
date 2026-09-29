import type { Shift } from "./shift";
import {
  clearSheetCache,
  isSheetArrayOf,
  isSheetBoolean,
  isSheetFiniteNumber,
  isSheetJsonRecord,
  isSheetString,
  peekSheetCache,
  postSheet,
  readSheet,
  type SheetCacheSnapshot,
  type SheetClientError,
  type SheetJsonRecord,
  type SheetMutationResult,
  type SheetReadRequest,
  type SheetReadResult,
} from "./sheetClient";

export { clearSheetCache, peekSheetCache } from "./sheetClient";
export type { SheetCacheSnapshot, SheetClientError, SheetMutationResult, SheetReadResult } from "./sheetClient";

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

const PARTNER_CACHE_PREFIX = "partner:";
const SUPERVISOR_CACHE_PREFIX = "supervisor:";
const DEFAULT_ROWS_CACHE_MS = 24 * 60 * 60 * 1_000;
const VISIT_GAP_MS = 30 * 60 * 1_000;

function selectRows(body: SheetJsonRecord): unknown {
  return body.rows;
}

function warnLegacyFailure(label: string, error: SheetClientError): void {
  console.warn(`[sheetSync] ${label} failed`, error.kind, error.code || "");
}

function legacyValue<T, F>(result: SheetReadResult<T>, fallback: F, label: string): T | F {
  if (!result.ok) {
    warnLegacyFailure(label, result.error);
    return fallback;
  }
  if (result.warning) warnLegacyFailure(`${label} refresh`, result.warning);
  return result.data;
}

/** Clear every partner/financial last-known-good value, for example on logout. */
export function clearPartnerSheetCache(): void {
  clearSheetCache(PARTNER_CACHE_PREFIX);
}

export function clearSupervisorSheetCache(): void {
  clearSheetCache(SUPERVISOR_CACHE_PREFIX);
}

export function clearAllSheetCache(): void {
  clearSheetCache();
}

function clearSupervisorOperationalCaches(kind: "production" | "loading" | "edit"): void {
  if (kind === "production") clearSheetCache("supervisor:recent-rows");
  if (kind === "production" || kind === "edit") clearSheetCache("supervisor:full-rows");
  if (kind === "loading") clearSheetCache("supervisor:loadings");
}

export async function submitToSheetResult(
  p: SheetPayload,
): Promise<SheetMutationResult<SheetJsonRecord>> {
  const result = await postSheet(p, { keepalive: p.kind !== "design" });
  if (result.ok && (p.kind === "production" || p.kind === "loading")) {
    clearSupervisorOperationalCaches(p.kind);
  }
  return result;
}

export async function submitToSheet(p: SheetPayload): Promise<{ ok: boolean; verified: boolean }> {
  const result = await submitToSheetResult(p);
  if (!result.ok) warnLegacyFailure("submit", result.error);
  return { ok: result.ok, verified: result.ok && result.verified };
}

export function submitLoadingToSheet(p: LoadingPayload): void {
  // fire-and-forget; loading events are notification-only, never block the UI
  void submitToSheet(p);
}

export async function logVisit(): Promise<void> {
  // Visit writes require an authenticated role. Guards call this only after the
  // server confirms the session; keep the previous 30-minute coalescing here so
  // route changes and guard remounts cannot create duplicate rows.
  try {
    const last = Number(localStorage.getItem("lastVisitTs") || 0);
    if (last && Date.now() - last <= VISIT_GAP_MS) return;
    localStorage.setItem("lastVisitTs", String(Date.now()));
  } catch {
    // Restricted storage: continue with one best-effort authenticated write.
  }
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

function isCapturedRow(value: unknown): value is CapturedRow {
  if (!isSheetJsonRecord(value)) return false;
  return (
    isSheetString(value.date) &&
    (value.shift === "A" || value.shift === "B") &&
    isSheetString(value.loomId) &&
    value.loomId.length > 0
  );
}

function recentRowsRequest(): SheetReadRequest<CapturedRow[]> {
  return {
    key: "supervisor:recent-rows",
    select: selectRows,
    validate: (value): value is CapturedRow[] => isSheetArrayOf(value, isCapturedRow),
    maxCacheAgeMs: DEFAULT_ROWS_CACHE_MS,
  };
}

export function peekRecentRowsCache(): SheetCacheSnapshot<CapturedRow[]> | null {
  return peekSheetCache(recentRowsRequest());
}

export function fetchRecentRowsResult(): Promise<SheetReadResult<CapturedRow[]>> {
  return readSheet(recentRowsRequest());
}

export async function fetchRecentRows(): Promise<CapturedRow[]> {
  return legacyValue(await fetchRecentRowsResult(), [], "fetchRecentRows");
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

function isFullRow(value: unknown): value is FullRow {
  if (!isSheetJsonRecord(value)) return false;
  return (
    isSheetFiniteNumber(value.rowIndex) &&
    isSheetString(value.date) &&
    (value.shift === "A" || value.shift === "B") &&
    isSheetString(value.loomId) &&
    isSheetString(value.designName) &&
    isSheetString(value.customerName) &&
    isSheetFiniteNumber(value.pickCounter) &&
    isSheetFiniteNumber(value.meters) &&
    isSheetFiniteNumber(value.weftCuts) &&
    isSheetFiniteNumber(value.warpCuts) &&
    isSheetString(value.loomState) &&
    isSheetString(value.note) &&
    isSheetString(value.capturedAt) &&
    isSheetString(value.weaver) &&
    isSheetString(value.editedAt) &&
    isSheetBoolean(value.editable) &&
    isSheetFiniteNumber(value.efficiencyPct) &&
    isSheetFiniteNumber(value.runtimeMinutes)
  );
}

function fullRowsRequest(): SheetReadRequest<FullRow[]> {
  return {
    key: "supervisor:full-rows",
    params: { mode: "full" },
    select: selectRows,
    validate: (value): value is FullRow[] => isSheetArrayOf(value, isFullRow),
    maxCacheAgeMs: DEFAULT_ROWS_CACHE_MS,
  };
}

export function peekFullRowsCache(): SheetCacheSnapshot<FullRow[]> | null {
  return peekSheetCache(fullRowsRequest());
}

export function fetchFullRowsResult(): Promise<SheetReadResult<FullRow[]>> {
  return readSheet(fullRowsRequest());
}

export async function fetchFullRows(): Promise<FullRow[]> {
  return legacyValue(await fetchFullRowsResult(), [], "fetchFullRows");
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

function isRemoteLoading(value: unknown): value is RemoteLoading {
  if (!isSheetJsonRecord(value)) return false;
  return (
    isSheetString(value.capturedAt) &&
    isSheetString(value.loomId) &&
    isSheetString(value.designName) &&
    isSheetString(value.customerName) &&
    isSheetString(value.shiftDate) &&
    (value.shift === "" || value.shift === "A" || value.shift === "B") &&
    isSheetString(value.source) &&
    isSheetBoolean(value.resumedFromRunout)
  );
}

function loadingsRequest(): SheetReadRequest<RemoteLoading[]> {
  return {
    key: "supervisor:loadings",
    params: { mode: "loadings" },
    select: selectRows,
    validate: (value): value is RemoteLoading[] => isSheetArrayOf(value, isRemoteLoading),
    maxCacheAgeMs: DEFAULT_ROWS_CACHE_MS,
  };
}

export function peekLoadingsCache(): SheetCacheSnapshot<RemoteLoading[]> | null {
  return peekSheetCache(loadingsRequest());
}

export function fetchLoadingsResult(): Promise<SheetReadResult<RemoteLoading[]>> {
  return readSheet(loadingsRequest());
}

export async function fetchLoadings(): Promise<RemoteLoading[]> {
  return legacyValue(await fetchLoadingsResult(), [], "fetchLoadings");
}

export interface OrderOption {
  design: string;   // combined string from Sheet3 col B (e.g. "Sarvesh 16/1")
  customer: string; // party name from Sheet3 col C (e.g. "Sarvesh")
}

export interface Catalog {
  orders: OrderOption[];
}

function isOrderOption(value: unknown): value is OrderOption {
  return (
    isSheetJsonRecord(value) &&
    isSheetString(value.design) &&
    value.design.length > 0 &&
    isSheetString(value.customer)
  );
}

function normalizeCatalog(body: SheetJsonRecord): Catalog {
  if (!Array.isArray(body.orders)) throw new Error("orders must be an array");
  const orders = body.orders.map((item): OrderOption => {
    if (typeof item === "string") {
      const design = item.trim();
      if (!design) throw new Error("empty legacy order");
      return { design, customer: "" };
    }
    if (!isSheetJsonRecord(item)) throw new Error("invalid order");
    const design = typeof item.design === "string" ? item.design.trim() : "";
    const customer = typeof item.customer === "string" ? item.customer.trim() : "";
    if (!design) throw new Error("invalid order design");
    return { design, customer };
  });
  return { orders };
}

function catalogRequest(): SheetReadRequest<Catalog> {
  return {
    key: "supervisor:catalog",
    params: { mode: "catalog" },
    select: normalizeCatalog,
    validate: (value): value is Catalog =>
      isSheetJsonRecord(value) && isSheetArrayOf(value.orders, isOrderOption),
    maxCacheAgeMs: DEFAULT_ROWS_CACHE_MS,
  };
}

export function fetchCatalogResult(): Promise<SheetReadResult<Catalog>> {
  return readSheet(catalogRequest());
}

export async function fetchCatalog(): Promise<Catalog> {
  return legacyValue(await fetchCatalogResult(), { orders: [] }, "fetchCatalog");
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

export async function editProductionRowResult(
  p: EditPayload,
): Promise<SheetMutationResult<SheetJsonRecord>> {
  const result = await postSheet(p, { keepalive: true });
  if (result.ok) clearSupervisorOperationalCaches("edit");
  return result;
}

export async function editProductionRow(p: EditPayload): Promise<{ ok: boolean; verified: boolean }> {
  const result = await editProductionRowResult(p);
  if (!result.ok) warnLegacyFailure("editProductionRow", result.error);
  return { ok: result.ok, verified: result.ok && result.verified };
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

function isMasterRow(value: unknown): value is MasterRow {
  if (!isSheetJsonRecord(value)) return false;
  return (
    isSheetFiniteNumber(value.rowIndex) &&
    isSheetString(value.date) &&
    isSheetString(value.paaguId) &&
    isSheetString(value.loom) &&
    (value.shift === "A" || value.shift === "B") &&
    isSheetString(value.weaver) &&
    isSheetFiniteNumber(value.rpm) &&
    isSheetFiniteNumber(value.adjPickRate) &&
    isSheetFiniteNumber(value.achievedPick) &&
    isSheetFiniteNumber(value.meters) &&
    isSheetFiniteNumber(value.targetMeters) &&
    isSheetFiniteNumber(value.efficiency) &&
    isSheetString(value.state) &&
    isSheetFiniteNumber(value.ratePerMeter) &&
    isSheetFiniteNumber(value.revenue) &&
    isSheetString(value.orderTag)
  );
}

function isMasterRangeRow(value: unknown): value is MasterRangeRow {
  if (!isSheetJsonRecord(value)) return false;
  return (
    isSheetString(value.date) &&
    isSheetString(value.loom) &&
    (value.shift === "A" || value.shift === "B") &&
    isSheetFiniteNumber(value.meters) &&
    isSheetFiniteNumber(value.targetMeters) &&
    isSheetFiniteNumber(value.ratePerMeter) &&
    isSheetFiniteNumber(value.revenue) &&
    isSheetFiniteNumber(value.efficiency) &&
    isSheetString(value.state)
  );
}

function masterDayRequest(
  date: string,
  options: { fresh?: boolean } = {},
): SheetReadRequest<MasterRow[]> {
  return {
    key: `${PARTNER_CACHE_PREFIX}master-day`,
    params: { mode: "master-day", date },
    fresh: options.fresh,
    select: selectRows,
    validate: (value): value is MasterRow[] => isSheetArrayOf(value, isMasterRow),
    maxCacheAgeMs: DEFAULT_ROWS_CACHE_MS,
  };
}

function masterRangeRequest(
  from: string,
  to: string,
  options: { fresh?: boolean } = {},
): SheetReadRequest<MasterRangeRow[]> {
  return {
    key: `${PARTNER_CACHE_PREFIX}master-range`,
    params: { mode: "master-range", from, to },
    fresh: options.fresh,
    select: selectRows,
    validate: (value): value is MasterRangeRow[] => isSheetArrayOf(value, isMasterRangeRow),
    maxCacheAgeMs: DEFAULT_ROWS_CACHE_MS,
  };
}

export function peekMasterDayCache(date: string): SheetCacheSnapshot<MasterRow[]> | null {
  return peekSheetCache(masterDayRequest(date));
}

export function peekMasterRangeCache(from: string, to: string): SheetCacheSnapshot<MasterRangeRow[]> | null {
  return peekSheetCache(masterRangeRequest(from, to));
}

export function fetchMasterDayResult(
  date: string,
  options: { fresh?: boolean } = {},
): Promise<SheetReadResult<MasterRow[]>> {
  return readSheet(masterDayRequest(date, options));
}

export async function fetchMasterDay(date: string): Promise<MasterRow[]> {
  return legacyValue(await fetchMasterDayResult(date), [], "fetchMasterDay");
}

export function fetchMasterRangeResult(
  from: string,
  to: string,
  options: { fresh?: boolean } = {},
): Promise<SheetReadResult<MasterRangeRow[]>> {
  return readSheet(masterRangeRequest(from, to, options));
}

export async function fetchMasterRange(from: string, to: string): Promise<MasterRangeRow[]> {
  return legacyValue(await fetchMasterRangeResult(from, to), [], "fetchMasterRange");
}

function masterOrdersRequest(): SheetReadRequest<Record<string, unknown>[]> {
  return {
    key: `${PARTNER_CACHE_PREFIX}master-orders`,
    params: { mode: "master-orders" },
    select: selectRows,
    validate: (value): value is Record<string, unknown>[] =>
      isSheetArrayOf(value, isSheetJsonRecord),
    maxCacheAgeMs: DEFAULT_ROWS_CACHE_MS,
  };
}

export function fetchMasterOrdersResult(): Promise<SheetReadResult<Record<string, unknown>[]>> {
  return readSheet(masterOrdersRequest());
}

export async function fetchMasterOrders(): Promise<Record<string, unknown>[]> {
  return legacyValue(await fetchMasterOrdersResult(), [], "fetchMasterOrders");
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

function optionalString(value: unknown): boolean {
  return value === undefined || isSheetString(value);
}

function isReceivableRow(value: unknown): value is ReceivableRow {
  if (!isSheetJsonRecord(value)) return false;
  return (
    optionalString(value.orderId) &&
    isSheetString(value.paaguId) &&
    optionalString(value.customerName) &&
    optionalString(value.loadedLoom) &&
    optionalString(value.designDetails) &&
    optionalString(value.loomNumber) &&
    isSheetString(value.status) &&
    isSheetFiniteNumber(value.invoiceAmount) &&
    isSheetString(value.invoiceNumber) &&
    isSheetString(value.invoiceDate) &&
    isSheetString(value.dueDate) &&
    isSheetFiniteNumber(value.receipts) &&
    isSheetString(value.receivedOn) &&
    isSheetString(value.paymentStatus) &&
    isSheetFiniteNumber(value.pendingBalance) &&
    isSheetString(value.party)
  );
}

function selectMasterReceivablesRows(body: SheetJsonRecord): unknown {
  const meta = isSheetJsonRecord(body.meta) ? body.meta : null;
  const health = meta && isSheetJsonRecord(meta.health) ? meta.health : null;
  if (health) {
    const status = typeof health.status === "string" ? health.status.trim().toLowerCase() : "";
    const unsafeWarningCodes = new Set(["NO_RECEIVABLE_ROWS", "NO_PARTY_ROWS"]);
    const hasUnsafeWarning =
      Array.isArray(health.warnings) &&
      health.warnings.some((warning) => {
        if (typeof warning === "string") return unsafeWarningCodes.has(warning.trim().toUpperCase());
        if (!isSheetJsonRecord(warning) || typeof warning.code !== "string") return false;
        return unsafeWarningCodes.has(warning.code.trim().toUpperCase());
      });
    if (status === "unhealthy" || hasUnsafeWarning) {
      throw new Error("Master receivables health check failed");
    }
  }
  return body.rows;
}

function masterReceivablesRequest(
  options: { fresh?: boolean } = {},
): SheetReadRequest<ReceivableRow[]> {
  return {
    key: `${PARTNER_CACHE_PREFIX}master-receivables`,
    params: { mode: "master-receivables" },
    fresh: options.fresh,
    select: selectMasterReceivablesRows,
    validate: (value): value is ReceivableRow[] => isSheetArrayOf(value, isReceivableRow),
    // v2 discards any empty LKG written before response health was enforced.
    cacheVersion: 2,
    maxCacheAgeMs: DEFAULT_ROWS_CACHE_MS,
  };
}

export type ReceivablesFetchResult =
  | {
      ok: true;
      rows: ReceivableRow[];
      source: "network" | "cache";
      lastSyncedAt: number;
      stale: boolean;
      warning?: SheetClientError;
    }
  | { ok: false; rows: ReceivableRow[]; error: SheetClientError };

export function peekMasterReceivablesCache(): SheetCacheSnapshot<ReceivableRow[]> | null {
  return peekSheetCache(masterReceivablesRequest());
}

export async function fetchMasterReceivablesResult(
  options: { fresh?: boolean } = {},
): Promise<ReceivablesFetchResult> {
  const result = await readSheet(masterReceivablesRequest(options));
  if (!result.ok) return { ok: false, rows: [], error: result.error };
  return {
    ok: true,
    rows: result.data,
    source: result.source,
    lastSyncedAt: result.lastSyncedAt,
    stale: result.stale,
    warning: result.warning,
  };
}

export async function fetchMasterReceivables(): Promise<ReceivableRow[]> {
  const result = await fetchMasterReceivablesResult();
  if (!result.ok) warnLegacyFailure("fetchMasterReceivables", result.error);
  else if (result.warning) warnLegacyFailure("fetchMasterReceivables refresh", result.warning);
  return result.rows;
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

function isDesignWarpBand(value: unknown): value is DesignWarpBand {
  if (!isSheetJsonRecord(value)) return false;
  return (
    isSheetFiniteNumber(value.seq) &&
    isSheetString(value.count) &&
    isSheetString(value.colour) &&
    (value.layer === undefined || isSheetString(value.layer)) &&
    isSheetFiniteNumber(value.ends) &&
    isSheetFiniteNumber(value.extra)
  );
}

function isDesignWeftBand(value: unknown): value is DesignWeftBand {
  if (!isSheetJsonRecord(value)) return false;
  return (
    isSheetFiniteNumber(value.seq) &&
    isSheetString(value.count) &&
    isSheetString(value.colour) &&
    isSheetFiniteNumber(value.picks) &&
    isSheetFiniteNumber(value.extra)
  );
}

function isDesignDraft(value: unknown): value is DesignDraft {
  if (!isSheetJsonRecord(value)) return false;
  return (
    isSheetString(value.draftOrder) &&
    isSheetFiniteNumber(value.totalShafts) &&
    isSheetFiniteNumber(value.totalPicks) &&
    isSheetString(value.pegPlanImageRef) &&
    (value.pegPlanJson === undefined || isSheetString(value.pegPlanJson))
  );
}

function isDesignRecord(value: unknown): value is DesignRecord {
  if (!isSheetJsonRecord(value)) return false;
  const stringFields = [
    "designId",
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
    "composition",
    "constructionRaw",
    "warpSeqText",
    "weftSeqText",
    "sourceImageRefs",
    "pegPlanImageRef",
    "capturedBy",
    "capturedAt",
    "rawText",
    "notes",
  ];
  const numberFields = [
    "totalEnds",
    "repeatEnds",
    "noOfRepeat",
    "extraEnds",
    "totalShafts",
    "totalPicks",
  ];
  if (!stringFields.every((field) => isSheetString(value[field]))) return false;
  if (!numberFields.every((field) => isSheetFiniteNumber(value[field]))) return false;
  if (!(value.confidence === null || isSheetFiniteNumber(value.confidence))) return false;
  if (value.warp !== undefined && !isSheetArrayOf(value.warp, isDesignWarpBand)) return false;
  if (value.weft !== undefined && !isSheetArrayOf(value.weft, isDesignWeftBand)) return false;
  if (value.draft !== undefined && value.draft !== null && !isDesignDraft(value.draft)) return false;
  return true;
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

// Upsert a captured design through the authenticated same-origin proxy.
export async function submitDesign(p: DesignPayload): Promise<{ ok: boolean; verified: boolean }> {
  return submitToSheet(p);
}

/* ------------------------------ design capture (photo + assisted extract) ------------------------------ */

// Image upload and assisted extraction can legitimately outlive the standard
// 12-second request budget. They remain single-attempt writes to avoid duplicate
// Drive files or Gemini jobs.
async function postReadable<T extends SheetJsonRecord>(
  p: object,
  validate: (value: unknown) => value is T,
): Promise<T | null> {
  const kind = isSheetJsonRecord(p) && typeof p.kind === "string" ? p.kind : "";
  const longRunning = kind === "design-image" || kind === "design-extract";
  const result = await postSheet<T>(p, {
    validate,
    timeoutMs: longRunning ? 55_000 : undefined,
    expectJsonResponse: true,
  });
  if (!result.ok) {
    warnLegacyFailure("postReadable", result.error);
    return null;
  }
  if (!result.verified) return null;
  return result.data;
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
  const r = await postReadable<{ ok: true; url: string }>(
    {
      kind: "design-image",
      dataBase64: data,
      mimeType,
      filename: file.name || `design-${Date.now()}.jpg`,
    },
    (value): value is { ok: true; url: string } =>
      isSheetJsonRecord(value) && value.ok === true && isSheetString(value.url),
  );
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
  const r = await postReadable<{ ok: true; draft: ExtractedDesign }>(
    {
      kind: "design-extract",
      images,
      hint: hint || "",
    },
    (value): value is { ok: true; draft: ExtractedDesign } =>
      isSheetJsonRecord(value) && value.ok === true && isSheetJsonRecord(value.draft),
  );
  if (!r?.ok || !r.draft) {
    return null;
  }
  return r.draft;
}

// List captured designs (newest first). Parent rows only — no warp/weft bands.
function designsRequest(): SheetReadRequest<DesignRecord[]> {
  return {
    key: "supervisor:designs",
    params: { mode: "designs" },
    select: selectRows,
    validate: (value): value is DesignRecord[] => isSheetArrayOf(value, isDesignRecord),
    maxCacheAgeMs: DEFAULT_ROWS_CACHE_MS,
  };
}

export function fetchDesignsResult(): Promise<SheetReadResult<DesignRecord[]>> {
  return readSheet(designsRequest());
}

export async function fetchDesigns(): Promise<DesignRecord[]> {
  return legacyValue(await fetchDesignsResult(), [], "fetchDesigns");
}

// One full design with reconstructed warp[], weft[] and draft. Look up by
// Design ID or by the printed Design No.
function designRequest(opts: { id?: string; no?: string }): SheetReadRequest<DesignRecord | null> {
  return {
    key: "supervisor:design",
    params: { mode: "design", id: opts.id, no: opts.no },
    select: (body) => body.design,
    validate: (value): value is DesignRecord | null => value === null || isDesignRecord(value),
    maxCacheAgeMs: DEFAULT_ROWS_CACHE_MS,
  };
}

export function fetchDesignResult(opts: { id?: string; no?: string }): Promise<SheetReadResult<DesignRecord | null>> {
  return readSheet(designRequest(opts));
}

export async function fetchDesign(opts: { id?: string; no?: string }): Promise<DesignRecord | null> {
  return legacyValue(await fetchDesignResult(opts), null, "fetchDesign");
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

function isCashflowData(value: unknown): value is CashflowData {
  if (!isSheetJsonRecord(value) || !isSheetJsonRecord(value.balances) || !isSheetJsonRecord(value.month)) {
    return false;
  }
  const balanceFields = [
    "tmb",
    "iobCa",
    "cashbookApp",
    "cash",
    "iobCcUsed",
    "iobCcLimit",
    "iobCcAvailable",
  ];
  const monthFields = ["opInflow", "opOutflow", "opCashflowNet", "ccDrawnThisMonth"];
  return (
    isSheetString(value.asOfDate) &&
    isSheetString(value.lastEntryDate) &&
    isSheetString(value.monthLabel) &&
    isSheetFiniteNumber(value.totalAvailable) &&
    balanceFields.every((field) => isSheetFiniteNumber(value.balances[field])) &&
    monthFields.every((field) => isSheetFiniteNumber(value.month[field]))
  );
}

function cashflowRequest(): SheetReadRequest<CashflowData> {
  return {
    key: `${PARTNER_CACHE_PREFIX}cashflow`,
    params: { mode: "cashflow" },
    select: (body) => body.cashflow,
    validate: isCashflowData,
    maxCacheAgeMs: DEFAULT_ROWS_CACHE_MS,
  };
}

export function peekCashflowCache(): SheetCacheSnapshot<CashflowData> | null {
  return peekSheetCache(cashflowRequest());
}

export function fetchCashflowResult(): Promise<SheetReadResult<CashflowData>> {
  return readSheet(cashflowRequest());
}

export async function fetchCashflow(): Promise<CashflowData | null> {
  return legacyValue(await fetchCashflowResult(), null, "fetchCashflow");
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

function isCashLedgerEntry(value: unknown): value is CashLedgerEntry {
  if (!isSheetJsonRecord(value)) return false;
  const account = value.account;
  return (
    isSheetString(value.date) &&
    isSheetString(value.description) &&
    (account === "tmb" || account === "iobCa" || account === "cashbookApp" || account === "cash" || account === "iobCc") &&
    optionalString(value.category) &&
    isSheetFiniteNumber(value.amount) &&
    optionalString(value.type) &&
    (value.internal === undefined || isSheetBoolean(value.internal)) &&
    optionalString(value.kind)
  );
}

function cashLedgerRequest(f: CashLedgerFilter = {}): SheetReadRequest<CashLedgerEntry[]> {
  return {
    key: `${PARTNER_CACHE_PREFIX}cashflow-ledger`,
    params: {
      mode: "cashflow-ledger",
      from: f.from,
      to: f.to,
      account: f.account,
      direction: f.direction,
    },
    select: selectRows,
    validate: (value): value is CashLedgerEntry[] => isSheetArrayOf(value, isCashLedgerEntry),
    maxCacheAgeMs: DEFAULT_ROWS_CACHE_MS,
  };
}

export function peekCashLedgerCache(f: CashLedgerFilter = {}): SheetCacheSnapshot<CashLedgerEntry[]> | null {
  return peekSheetCache(cashLedgerRequest(f));
}

export function fetchCashLedgerResult(f: CashLedgerFilter = {}): Promise<SheetReadResult<CashLedgerEntry[]>> {
  return readSheet(cashLedgerRequest(f));
}

export async function fetchCashLedger(f: CashLedgerFilter = {}): Promise<CashLedgerEntry[]> {
  return legacyValue(await fetchCashLedgerResult(f), [], "fetchCashLedger");
}

export interface CashReportData {
  cashflow: CashflowData;
  rows: CashLedgerEntry[];
}

function isCashReportData(value: unknown): value is CashReportData {
  return (
    isSheetJsonRecord(value) &&
    isCashflowData(value.cashflow) &&
    isSheetArrayOf(value.rows, isCashLedgerEntry)
  );
}

function cashReportRequest(f: CashLedgerFilter = {}): SheetReadRequest<CashReportData> {
  return {
    key: `${PARTNER_CACHE_PREFIX}cashflow-report`,
    params: {
      mode: "cashflow-report",
      from: f.from,
      to: f.to,
      account: f.account,
      direction: f.direction,
    },
    select: (body) => body.report,
    validate: isCashReportData,
    maxCacheAgeMs: DEFAULT_ROWS_CACHE_MS,
  };
}

function hasIncompatibleCashReportResponse(result: SheetReadResult<CashReportData>): boolean {
  const problem = result.ok ? result.warning : result.error;
  return problem?.code === "upstream_incompatible_response";
}

function combineLegacyCashReportResults(
  cashflowResult: SheetReadResult<CashflowData>,
  ledgerResult: SheetReadResult<CashLedgerEntry[]>,
): SheetReadResult<CashReportData> {
  if (!cashflowResult.ok) return cashflowResult;
  if (!ledgerResult.ok) return ledgerResult;

  const source =
    cashflowResult.source === "network" && ledgerResult.source === "network"
      ? "network"
      : "cache";
  const warning = cashflowResult.warning ?? ledgerResult.warning;
  const combined: SheetReadResult<CashReportData> = {
    ok: true,
    data: { cashflow: cashflowResult.data, rows: ledgerResult.data },
    source,
    lastSyncedAt: Math.min(cashflowResult.lastSyncedAt, ledgerResult.lastSyncedAt),
    stale: source === "cache" || cashflowResult.stale || ledgerResult.stale,
  };
  if (warning) combined.warning = warning;
  return combined;
}

/**
 * Prefer the atomic combined endpoint. During the Apps Script rollout only,
 * the proxy can explicitly report that the deployed script does not recognise
 * the new mode; in that case rebuild the same validated shape from the two
 * existing Partner-only endpoints.
 */
export async function fetchCashReportResult(
  f: CashLedgerFilter = {},
): Promise<SheetReadResult<CashReportData>> {
  const combinedResult = await readSheet(cashReportRequest(f));
  if (!hasIncompatibleCashReportResponse(combinedResult)) return combinedResult;

  const [cashflowResult, ledgerResult] = await Promise.all([
    fetchCashflowResult(),
    fetchCashLedgerResult(f),
  ]);
  const legacyResult = combineLegacyCashReportResults(cashflowResult, ledgerResult);

  // A clean pair of legacy network responses is fully current and may be used
  // for PDF export. Otherwise retain the newest complete validated LKG rather
  // than ever joining a partial response.
  if (!legacyResult.ok) return combinedResult.ok ? combinedResult : legacyResult;
  if (!combinedResult.ok) return legacyResult;
  return legacyResult.lastSyncedAt >= combinedResult.lastSyncedAt
    ? legacyResult
    : combinedResult;
}

export function peekCashReportCache(
  f: CashLedgerFilter = {},
): SheetCacheSnapshot<CashReportData> | null {
  const combined = peekSheetCache(cashReportRequest(f));
  const cashflow = peekCashflowCache();
  const ledger = peekCashLedgerCache(f);
  const legacy = cashflow && ledger
    ? {
        data: { cashflow: cashflow.data, rows: ledger.data },
        source: "cache" as const,
        lastSyncedAt: Math.min(cashflow.lastSyncedAt, ledger.lastSyncedAt),
        stale: true as const,
      }
    : null;

  if (!combined) return legacy;
  if (!legacy) return combined;
  return legacy.lastSyncedAt >= combined.lastSyncedAt ? legacy : combined;
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

function isCapexRow(value: unknown): value is CapexRow {
  if (!isSheetJsonRecord(value)) return false;
  return (
    isSheetString(value.date) &&
    isSheetString(value.project) &&
    isSheetString(value.expense) &&
    isSheetString(value.vendor) &&
    isSheetFiniteNumber(value.amount) &&
    isSheetString(value.paidFrom) &&
    isSheetString(value.fundingSource)
  );
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return (
    isSheetJsonRecord(value) &&
    Object.values(value).every((item) => isSheetFiniteNumber(item))
  );
}

function isCapexData(value: unknown): value is CapexData {
  if (!isSheetJsonRecord(value)) return false;
  return (
    isSheetString(value.project) &&
    isSheetFiniteNumber(value.total) &&
    isSheetFiniteNumber(value.count) &&
    isNumberRecord(value.byFunding) &&
    isNumberRecord(value.byExpense) &&
    isNumberRecord(value.byPaidFrom) &&
    isSheetArrayOf(value.rows, isCapexRow)
  );
}

function capexRequest(project: string): SheetReadRequest<CapexData> {
  return {
    key: `${PARTNER_CACHE_PREFIX}capex`,
    params: { mode: "capex", project },
    select: (body) => body.capex,
    validate: isCapexData,
    maxCacheAgeMs: DEFAULT_ROWS_CACHE_MS,
  };
}

export function peekCapexCache(project: string = "6 Looms"): SheetCacheSnapshot<CapexData> | null {
  return peekSheetCache(capexRequest(project));
}

export function fetchCapexResult(project: string = "6 Looms"): Promise<SheetReadResult<CapexData>> {
  return readSheet(capexRequest(project));
}

export async function fetchCapex(project: string = "6 Looms"): Promise<CapexData | null> {
  return legacyValue(await fetchCapexResult(project), null, "fetchCapex");
}
