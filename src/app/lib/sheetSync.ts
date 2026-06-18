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

export type SheetPayload = ProductionEntryPayload | LoadingPayload | VisitPayload;

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
