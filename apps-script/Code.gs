/**
 * Power Loom QC — Apps Script web app
 * Sheet1 columns:
 *  A Date · B (legacy empty) · C Shift · D Loom · E Design · F Customer
 *  G Pick counter · H Meters · I Weft cuts · J Warp cuts · K State · L Notes
 *  M Logged at · N Weaver · O Efficiency % · P Runtime min · Q Edited at
 *
 * Endpoints
 *  GET  ?mode=full            → all rows of last 21 days, full payload
 *  GET  ?mode=loadings        → loading events of last 120 days
 *  GET  ?mode=catalog         → master order list {orders:[]} read from Sheet3 col B
 *  GET  (no mode)             → light rows {date,shift,loomId} for pending detection
 *  POST kind:"production"     → append new row to Sheet1
 *  POST kind:"loading"        → append to Loadings tab + broadcast WhatsApp follow-up
 *  GET  ?mode=master-day&date=YYYY-MM-DD       → master Looms_Production rows for one day
 *  GET  ?mode=master-range&from=YYYY-MM-DD&to=YYYY-MM-DD → light per-loom-per-day aggregates
 *  GET  ?mode=master-orders                    → master Order tab rows
 *  GET  ?mode=master-receivables               → master Paagu ID receivables view
 *  GET  ?mode=master-health                    → authenticated master workbook health
 *  POST kind:"master-health"                  → same health check with token in JSON body
 *  GET  ?mode=cashflow                         → cash position + monthly summary from Master Control tab
 *  GET  ?mode=cashflow-ledger&from=&to=&account=&direction= → ledger entries for the statement view
 *  GET  ?mode=capex&project=6%20Looms          → Capex Register entries + totals for one project (default "6 Looms")
 *  GET  ?mode=beams                            → Beam Register tables from R.O STATUS tab (loaded/vendor/ready/empty/master)
 *  POST kind:"edit"           → overwrite Sheet1 row by rowIndex, only inside edit window
 *  POST kind:"design"         → upsert a loom-setup design (Designs + DesignWarp/Weft/Draft tabs)
 *  GET  ?mode=designs                          → list captured designs (newest first)
 *  GET  ?mode=design&id=…  | &no=…             → one design with warp[], weft[], draft
 */

var SHEET_ID = "1EJ_5mWO5QEY-6gpWfv2nsG778BrFUw9xv3J0d0NH-1A";
var SHEET_NAME = "Sheet1";
var LOADINGS_SHEET = "Loadings";
var ORDERS_SHEET = "Sheet3";
var ORDERS_DESIGN_COL = 2;   // column B — design (combined "Sarvesh 16/1")
var ORDERS_CUSTOMER_COL = 3; // column C — party / customer name

// Partner read-only master workbook (separate spreadsheet).
var MASTER_SHEET_ID = "1WbsCT_pgF9tk5XgIWQSabH7D_ZWt7bqHks_-c7BcQBo";
var MASTER_PRODUCTION_TAB = "Looms_Production";
var MASTER_ORDER_TAB = "Order";
var MASTER_PAAGU_TAB = "Paagu ID";
var MASTER_CASHFLOW_TAB = "Master Control";   // ← confirm exact tab name
var MASTER_CAPEX_TAB = "Capex Register";

// Receivables API safeguards. Keep cache lifetimes deliberately short because
// this is financial data, and fail rather than silently returning a partial
// dataset when a duplicated monthly workbook exceeds the reviewed bounds.
var MASTER_RECEIVABLES_API_VERSION = 2;
var MASTER_RECEIVABLES_SCHEMA_VERSION = "2026-09-29";
var MASTER_RECEIVABLES_CACHE_VERSION = "master-receivables-v1";
var MASTER_RECEIVABLES_CACHE_TTL_SECONDS = 30;
var MASTER_RECEIVABLES_CACHE_CHUNK_BYTES = 85000;
var MASTER_RECEIVABLES_MAX_CACHE_CHUNKS = 40;
var MASTER_RECEIVABLES_MAX_GRID_ROWS = 50000;
var MASTER_RECEIVABLES_MAX_DATA_ROWS = 10000;
var MASTER_RECEIVABLES_MAX_PAGE_SIZE = 250;
var MASTER_PRODUCTION_CACHE_VERSION = "master-production-v1";
var MASTER_PRODUCTION_CACHE_TTL_SECONDS = 30;
var MASTER_PRODUCTION_MAX_GRID_ROWS = 50000;

// Beam Register — separate spreadsheet tracking every physical beam asset.
var BEAM_SHEET_ID = "1sHQIkVJcB-QfuuFVCWo16WpNjlZtLFFne5v4XvcF2YI";
var BEAM_TAB = "R.O STATUS";

// Visit log — access tracking (country/region/city/lat/long) appended on each session.
var VISITS_TAB = "Visits";

// Design master (loom setup sheets) — parent + warp/weft/draft child tabs, all
// in THIS workbook (SHEET_ID), joined by a stable Design ID.
var DESIGNS_TAB      = "Designs";
var DESIGN_WARP_TAB  = "DesignWarp";
var DESIGN_WEFT_TAB  = "DesignWeft";
var DESIGN_DRAFT_TAB = "DesignDraft";

// Capex Register columns (1-indexed, A..G only — only G-and-left are critical):
//  A Date · B Project · C Expense · D Vendor · E Amount · F Paid From · G Funding Source
var CAPEX_WIDTH         = 7;
var CAPEX_COL_DATE      = 1;
var CAPEX_COL_PROJECT   = 2;
var CAPEX_COL_EXPENSE   = 3;
var CAPEX_COL_VENDOR    = 4;
var CAPEX_COL_AMOUNT    = 5;
var CAPEX_COL_PAID_FROM = 6;
var CAPEX_COL_FUNDING   = 7;

// Closing balance row (Bank Statement Closing) + per-account columns (1-indexed).
// Each ledger account spans two columns in the data area: a credit (in) col + a debit (out) col.
// Closing balance values live in the credit column on row 10.
var CF_ROW_CLOSING        = 10;
var CF_COL_TMB_CREDIT     = 5;   // E
var CF_COL_TMB_DEBIT      = 6;   // F
var CF_COL_IOB_CA_CREDIT  = 7;   // G
var CF_COL_IOB_CA_DEBIT   = 8;   // H
var CF_COL_CASH_CREDIT    = 9;   // I  (Petty Cash — "Cash Added")
var CF_COL_CASH_DEBIT     = 10;  // J  ("Expenses")
var CF_COL_CASHBOOK_CREDIT= 11;  // K  (Cashbook App — "Cash Added")
var CF_COL_CASHBOOK_DEBIT = 12;  // L  ("Expenses")
var CF_COL_IOB_CC_DRAWN   = 13;  // M  (Withdrawal — cash drawn from CC)
var CF_COL_IOB_CC_REPAY   = 14;  // N  (Repayment / Credit — reduces CC used)
var CF_COL_IOB_CC_INTEREST= 15;  // O  (Interest)

// Closing-row reads use the credit column for each account.
var CF_COL_TMB        = CF_COL_TMB_CREDIT;
var CF_COL_IOB_CA     = CF_COL_IOB_CA_CREDIT;
var CF_COL_CASHBOOK   = CF_COL_CASHBOOK_CREDIT;
var CF_COL_CASH       = CF_COL_CASH_CREDIT;
var CF_COL_IOB_CC     = CF_COL_IOB_CC_DRAWN;
var CF_IOB_CC_LIMIT   = 2000000;

// Monthly summary cells (per Master Control sheet layout).
var CF_CELL_OP_INFLOW   = "R3";   // Operating Inflow (positive)
var CF_CELL_OP_OUTFLOW  = "S3";   // Operating outflow (stored positive; we negate)
var CF_CELL_OP_NET      = "T3";   // Net Operating Cashflow (signed)
var CF_CELL_AS_OF_DATE  = "";     // not used — "as of" derived from last ledger entry

// Ledger data rows (row 15 onwards), columns A..O.
var CF_LEDGER_START_ROW = 15;
var CF_LEDGER_WIDTH     = 15;     // A..O
var CF_LEDGER_DATE_COL  = 1;      // A
var CF_LEDGER_DESC_COL  = 2;      // B
var CF_LEDGER_TYPE_COL  = 3;      // C  Cash flow type (Operating Inflow/Outflow, Internal transfer, Expansion/Asset, Loan and financing, Partner)
var CF_LEDGER_CAT_COL   = 4;      // D  Cash flow category

// WhatsApp manual relay — single number that forwards to the partner group.
// Leave WA_ENABLED=false until Twilio creds are added; messages are no-ops.
var WA_ENABLED = true;
var WA_RELAY_NUMBER = "+919940111315";

// Partner PWA — used as the tappable nudge link in the daily digest.
var APP_URL = "https://autoloom-daily-status.vercel.app/";
var TWILIO_SID = PropertiesService.getScriptProperties().getProperty("TWILIO_SID") || "";
var TWILIO_AUTH = PropertiesService.getScriptProperties().getProperty("TWILIO_AUTH") || "";
var TWILIO_FROM = PropertiesService.getScriptProperties().getProperty("TWILIO_FROM") || ""; // e.g. whatsapp:+14155238886

// CallMeBot — free WhatsApp relay (no Twilio account needed).
// One-time setup on the RECEIVING phone:
//   1. Save +34 684 770 005 as a contact.
//   2. Send it the WhatsApp message: I allow callmebot to send me messages
//   3. It replies with an API key. Store the values in Script Properties:
//        CALLMEBOT_PHONE  → recipient number with country code, e.g. +919940111315
//        CALLMEBOT_APIKEY → the key it returned
// Note: CallMeBot delivers to ONE registered number per key, not a group.
var CALLMEBOT_PHONE  = PropertiesService.getScriptProperties().getProperty("CALLMEBOT_PHONE")  || "";
var CALLMEBOT_APIKEY = PropertiesService.getScriptProperties().getProperty("CALLMEBOT_APIKEY") || "";

// Channel selector (Script Property WA_PROVIDER): "twilio" (default), "callmebot", or "both".
var WA_PROVIDER = (PropertiesService.getScriptProperties().getProperty("WA_PROVIDER") || "twilio").toLowerCase();

// Design capture — Drive image hosting + Gemini assisted extraction.
// Set GEMINI_API_KEY in Script Properties. Adding these endpoints introduces
// DriveApp + external UrlFetchApp scopes, so the script must be re-authorised
// once (run any function from the editor and accept the prompts) before they work.
var GEMINI_API_KEY = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY") || "";
var GEMINI_MODEL = "gemini-2.0-flash";
var DESIGN_IMG_FOLDER = "SAT Design Images";

// Shared-secret API token (set in Project Settings → Script Properties as API_TOKEN).
// Phase control:
//   API_TOKEN unset + REQUIRED=false → endpoint stays open (legacy migration only).
//   API_TOKEN unset + REQUIRED=true  → fail closed; every web request is rejected.
//   API_TOKEN set + REQUIRED=false → migration mode: a wrong token is rejected,
//                                    but a missing token is still allowed so the
//                                    PWA keeps working until it ships the token.
//   API_TOKEN set + REQUIRED=true  → enforced: every request must carry the token.
var API_TOKEN = PropertiesService.getScriptProperties().getProperty("API_TOKEN") || "";
var API_TOKEN_REQUIRED = true;

// Ensure a phone number carries the whatsapp: channel prefix Twilio requires.
// Accepts "+14155238886", "whatsapp:+14155238886", or "14155238886".
function _waAddr(num) {
  var s = String(num || "").trim();
  if (!s) return "";
  if (s.indexOf("whatsapp:") === 0) return s;
  if (s.charAt(0) !== "+") s = "+" + s;
  return "whatsapp:" + s;
}

function _sheet() {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
}

function _loadingsSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(LOADINGS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LOADINGS_SHEET);
    sh.appendRow(["Captured at", "Loom", "Design", "Customer", "Shift date", "Shift", "Source", "Resumed from runout"]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function _catalogSheet(name) {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(name);
}

function _readOrders() {
  var sh = _catalogSheet(ORDERS_SHEET);
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var width = Math.max(ORDERS_DESIGN_COL, ORDERS_CUSTOMER_COL);
  var values = sh.getRange(2, 1, last - 1, width).getValues();
  var seen = {};
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var design = String(values[i][ORDERS_DESIGN_COL - 1] || "").trim();
    if (!design) continue;
    var customer = String(values[i][ORDERS_CUSTOMER_COL - 1] || "").trim();
    var k = design.toLowerCase() + "||" + customer.toLowerCase();
    if (seen[k]) continue;
    seen[k] = true;
    out.push({ design: design, customer: customer });
  }
  out.sort(function (a, b) {
    var ad = a.design.toLowerCase(), bd = b.design.toLowerCase();
    return ad < bd ? -1 : ad > bd ? 1 : 0;
  });
  return out;
}

// Pull the token from a GET query param or a POST JSON body.
function _extractToken(e) {
  if (e && e.parameter && e.parameter.token) return String(e.parameter.token);
  if (e && e.postData && e.postData.contents) {
    try {
      var b = JSON.parse(e.postData.contents);
      if (b && b.token) return String(b.token);
    } catch (err) { /* not JSON */ }
  }
  return "";
}

// Returns true when the request may proceed. See the API_TOKEN phase notes above.
function _authOk(e) {
  if (!API_TOKEN) return !API_TOKEN_REQUIRED;  // enforced mode must never fail open
  var provided = _extractToken(e);
  if (!provided) return !API_TOKEN_REQUIRED;   // missing token allowed only in migration mode
  return provided === API_TOKEN;               // a supplied token must match exactly
}

function doGet(e) {
  if (!_authOk(e)) return _json({ ok: false, error: "unauthorized" });
  var mode = (e && e.parameter && e.parameter.mode) || "";
  if (mode === "full")     return _json({ ok: true, rows: _readFullRows(21) });
  if (mode === "loadings") return _json({ ok: true, rows: _readLoadings(120) });
  if (mode === "catalog")  return _json({ ok: true, orders: _readOrders() });
  if (mode === "master-day") {
    var date = (e.parameter && e.parameter.date) || _ymd(new Date());
    return _json(_masterReadResponse("master-day", function () {
      return { ok: true, date: date, rows: _readMasterDay(date) };
    }));
  }
  if (mode === "master-range") {
    var from = (e.parameter && e.parameter.from) || "";
    var to = (e.parameter && e.parameter.to) || _ymd(new Date());
    return _json(_masterReadResponse("master-range", function () {
      return { ok: true, from: from, to: to, rows: _readMasterRange(from, to) };
    }));
  }
  if (mode === "master-orders") {
    return _json(_masterReadResponse("master-orders", function () {
      return { ok: true, rows: _readMasterOrders() };
    }));
  }
  if (mode === "master-receivables") {
    return _json(_masterReceivablesResponse(e));
  }
  if (mode === "master-health") {
    return _json(_masterWorkbookHealthResponse(e));
  }
  if (mode === "cashflow") {
    return _json(_masterReadResponse("cashflow", function () {
      return { ok: true, cashflow: _readCashflow() };
    }));
  }
  if (mode === "cashflow-ledger") {
    var cfFrom = (e.parameter && e.parameter.from) || "";
    var cfTo   = (e.parameter && e.parameter.to)   || _ymd(new Date());
    var cfAcct = (e.parameter && e.parameter.account)   || "";
    var cfDir  = (e.parameter && e.parameter.direction) || "";
    return _json(_masterReadResponse("cashflow-ledger", function () {
      return { ok: true, rows: _readCashLedger(cfFrom, cfTo, cfAcct, cfDir) };
    }));
  }
  if (mode === "capex") {
    var capexProject = (e.parameter && e.parameter.project) || "6 Looms";
    return _json(_masterReadResponse("capex", function () {
      return { ok: true, capex: _readCapex(capexProject) };
    }));
  }
  if (mode === "beams") {
    return _readBeams();
  }
  if (mode === "designs") {
    return _json({ ok: true, rows: _readDesigns() });
  }
  if (mode === "design") {
    var dId = (e.parameter && e.parameter.id) || "";
    var dNo = (e.parameter && e.parameter.no) || "";
    return _json({ ok: true, design: _readDesign(dId, dNo) });
  }
  return _json({ ok: true, rows: _readLightRows(21) });
}

function doPost(e) {
  if (!_authOk(e)) return _json({ ok: false, error: "unauthorized" });
  if (!e || !e.postData) return _json({ ok: false, error: "no payload" });
  var p;
  try { p = JSON.parse(e.postData.contents); }
  catch (err) { return _json({ ok: false, error: "bad json" }); }

  if (p.kind === "production")  return _appendProduction(p);
  if (p.kind === "loading")     return _logLoading(p);
  if (p.kind === "edit")        return _editProduction(p);
  if (p.kind === "visit")       return _logVisit(p);
  if (p.kind === "design")      return _logDesign(p);
  if (p.kind === "design-image") return _saveDesignImage(p);
  if (p.kind === "design-extract") return _extractDesign(p);
  if (p.kind === "master-health") {
    var healthFresh = String(p.fresh || "").toLowerCase();
    return _json(_masterWorkbookHealthResponse({
      parameter: { fresh: healthFresh === "1" || healthFresh === "true" ? "1" : "0" }
    }));
  }
  return _json({ ok: false, error: "unknown kind" });
}

/* ------------------------------ writers ------------------------------ */

function _visitsSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(VISITS_TAB);
  if (!sh) {
    sh = ss.insertSheet(VISITS_TAB);
    sh.appendRow(["Captured at", "Country", "Region", "City", "Latitude", "Longitude", "Path", "User agent"]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function _logVisit(p) {
  var sh = _visitsSheet();
  sh.appendRow([
    _istStamp(p.capturedAt),                   // A
    p.country   || "",                        // B
    p.region    || "",                        // C
    p.city      || "",                        // D
    p.latitude  || "",                        // E
    p.longitude || "",                        // F
    p.path      || "",                        // G
    p.userAgent || "",                        // H
  ]);
  return _json({ ok: true });
}

// Diagnostic — run this from the Apps Script editor, then open View → Logs (or
// Executions). It answers "is the Visits tab still being written to?":
//   • prints the token gate state (a closed gate silently rejects every POST),
//   • reports the row count and WHEN the last visit was captured (so a stale
//     last-entry date tells you logging stopped, and roughly when),
//   • appends a clearly marked TEST row so a successful write is visible at the
//     bottom of the tab immediately. Delete that TEST row afterwards.
function diagnoseVisit() {
  Logger.log("API_TOKEN set: " + (API_TOKEN ? "yes" : "NO"));
  Logger.log("API_TOKEN_REQUIRED: " + API_TOKEN_REQUIRED);
  if (API_TOKEN_REQUIRED && !API_TOKEN) {
    Logger.log("→ CONFIGURATION ERROR: API_TOKEN_REQUIRED is true but API_TOKEN is missing; web requests fail closed.");
    Logger.log("  Set API_TOKEN in Script Properties and keep the matching value in the deployed app configuration.");
  } else if (API_TOKEN && API_TOKEN_REQUIRED) {
    Logger.log("→ Token enforced: any POST without the matching token is rejected as 'unauthorized'.");
    Logger.log("  Confirm Vercel env VITE_API_TOKEN equals this API_TOKEN, and that this web app was redeployed.");
  }

  var sh = _visitsSheet();
  var last = sh.getLastRow();
  Logger.log("Visits tab: \"" + VISITS_TAB + "\" · rows incl header: " + last);

  if (last >= 2) {
    var r = sh.getRange(last, 1, 1, 8).getValues()[0];
    Logger.log("Last visit captured at: " + r[0]);
    Logger.log("Last visit · path: " + r[6] + " · location: " + [r[3], r[2], r[1]].join(", "));
    Logger.log("Last visit · UA: " + String(r[7]).slice(0, 60));
  } else {
    Logger.log("No visit rows yet (header only).");
  }

  // Append a marked test row so a successful write is visible in the sheet.
  _logVisit({
    capturedAt: new Date().toISOString(),
    country: "TEST", region: "diagnoseVisit", city: "", latitude: "", longitude: "",
    path: "/diagnostic", userAgent: "diagnoseVisit() manual run"
  });
  Logger.log("Appended a TEST row. Check the bottom of the \"" + VISITS_TAB + "\" tab; total rows now: " + sh.getLastRow());
}

/* ------------------------------ design master (loom setup) ------------------------------ */
/**
 * Loom setup sheets captured from supplier design documents (printed or
 * handwritten). One parent row in "Designs" plus ordered child rows in
 * "DesignWarp" / "DesignWeft" and an optional "DesignDraft" row, all joined by a
 * stable Design ID. Variable-length warp/weft colour bands live as child rows
 * (never packed into one cell), so the structured warp/weft tables are
 * reconstructed on read. Consumed by fetchDesigns / fetchDesign in sheetSync.ts.
 */

function _designsSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(DESIGNS_TAB);
  if (!sh) {
    sh = ss.insertSheet(DESIGNS_TAB);
    sh.appendRow([
      "Design ID", "Design No", "Design Name", "Source Firm", "Received Date",
      "Weave Type", "Reed", "Reed Order", "Pick PPI", "Warp Count", "Weft Count",
      "Warp Width In", "Cloth Width In", "Total Ends", "Composition", "Construction Raw",
      "Repeat Ends", "No Of Repeat", "Extra Ends", "Total Shafts", "Total Picks",
      "Warp Seq Text", "Weft Seq Text", "Source Image Refs", "Peg Plan Image Ref",
      "Captured By", "Captured At", "Raw Text", "Confidence", "Notes"
    ]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function _designWarpSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(DESIGN_WARP_TAB);
  if (!sh) {
    sh = ss.insertSheet(DESIGN_WARP_TAB);
    sh.appendRow(["Design ID", "Seq", "Count", "Colour", "Layer", "Ends", "Extra"]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function _designWeftSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(DESIGN_WEFT_TAB);
  if (!sh) {
    sh = ss.insertSheet(DESIGN_WEFT_TAB);
    sh.appendRow(["Design ID", "Seq", "Count", "Colour", "Picks", "Extra"]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function _designDraftSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(DESIGN_DRAFT_TAB);
  if (!sh) {
    sh = ss.insertSheet(DESIGN_DRAFT_TAB);
    sh.appendRow(["Design ID", "Draft Order", "Total Shafts", "Total Picks", "Peg Plan Image Ref", "Peg Plan Json"]);
    sh.setFrozenRows(1);
  }
  return sh;
}

// Run once from the Apps Script editor to create all four design tabs (with
// headers) in this workbook. Safe to re-run — existing tabs are left untouched.
function installDesignTabs() {
  _designsSheet();
  _designWarpSheet();
  _designWeftSheet();
  _designDraftSheet();
  Logger.log("Design tabs ready in workbook " + SHEET_ID + ": " +
    [DESIGNS_TAB, DESIGN_WARP_TAB, DESIGN_WEFT_TAB, DESIGN_DRAFT_TAB].join(", "));
}

function _designId() {
  return "D-" + Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyyMMdd-HHmmss") +
    "-" + (Math.floor(Math.random() * 900) + 100);
}

// Flatten warp/weft bands into a human-readable mirror string for the parent
// row, e.g. "Khaki×170 · Green×170 · Black×170".
function _seqText(list, qtyKey) {
  if (!list || !list.length) return "";
  var parts = [];
  for (var i = 0; i < list.length; i++) {
    var b = list[i] || {};
    var colour = String(b.colour || "").trim() || "—";
    var qty = b[qtyKey];
    parts.push(qty ? colour + "×" + qty : colour);
  }
  return parts.join(" · ");
}

function _findRowByValue(sh, col, val) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var values = sh.getRange(2, col, last - 1, 1).getValues();
  var want = String(val).trim();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || "").trim() === want) return i + 2;
  }
  return -1;
}

// Delete every child row whose column A equals designId, then append the new
// block. Keeps a re-captured design from accumulating duplicate child rows.
function _replaceChildren(sh, designId, rows) {
  var last = sh.getLastRow();
  if (last >= 2) {
    var ids = sh.getRange(2, 1, last - 1, 1).getValues();
    var want = String(designId).trim();
    for (var i = ids.length - 1; i >= 0; i--) {
      if (String(ids[i][0] || "").trim() === want) sh.deleteRow(i + 2);
    }
  }
  if (rows && rows.length) {
    var start = sh.getLastRow() + 1;
    sh.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
  }
}

function _logDesign(p) {
  var designId = String(p.designId || "").trim() || _designId();
  var warp = Array.isArray(p.warp) ? p.warp : [];
  var weft = Array.isArray(p.weft) ? p.weft : [];
  var warpSeqText = p.warpSeqText || _seqText(warp, "ends");
  var weftSeqText = p.weftSeqText || _seqText(weft, "picks");

  // Parent — upsert by Design ID.
  var sh = _designsSheet();
  var row = [
    designId,                                  // A
    p.designNo        || "",                   // B
    p.designName      || "",                   // C
    p.sourceFirm      || "",                   // D
    p.receivedDate    || "",                   // E
    p.weaveType       || "",                   // F
    p.reed            || "",                   // G
    p.reedOrder       || "",                   // H
    p.pickPPI         || "",                   // I
    p.warpCount       || "",                   // J
    p.weftCount       || "",                   // K
    p.warpWidthIn     || "",                   // L
    p.clothWidthIn    || "",                   // M
    p.totalEnds       || "",                   // N
    p.composition     || "",                   // O
    p.constructionRaw || "",                   // P
    p.repeatEnds      || "",                   // Q
    p.noOfRepeat      || "",                   // R
    p.extraEnds       || "",                   // S
    p.totalShafts     || "",                   // T
    p.totalPicks      || "",                   // U
    warpSeqText,                               // V
    weftSeqText,                               // W
    p.sourceImageRefs || "",                   // X
    p.pegPlanImageRef || "",                   // Y
    p.capturedBy      || "",                   // Z
    _istStamp(p.capturedAt),                   // AA
    p.rawText         || "",                   // AB
    p.confidence != null ? p.confidence : "",  // AC
    p.notes           || ""                    // AD
  ];
  var pr = _findRowByValue(sh, 1, designId);
  if (pr > 0) sh.getRange(pr, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);

  // Warp bands.
  var warpRows = [];
  for (var i = 0; i < warp.length; i++) {
    var w = warp[i] || {};
    warpRows.push([designId, w.seq || (i + 1), w.count || "", w.colour || "", w.layer || "", w.ends || "", w.extra || ""]);
  }
  _replaceChildren(_designWarpSheet(), designId, warpRows);

  // Weft bands.
  var weftRows = [];
  for (var j = 0; j < weft.length; j++) {
    var f = weft[j] || {};
    weftRows.push([designId, f.seq || (j + 1), f.count || "", f.colour || "", f.picks || "", f.extra || ""]);
  }
  _replaceChildren(_designWeftSheet(), designId, weftRows);

  // Draft / peg plan (optional, 0..1 row).
  if (p.draft) {
    var d = p.draft;
    _replaceChildren(_designDraftSheet(), designId, [[
      designId,
      d.draftOrder || "",
      d.totalShafts || p.totalShafts || "",
      d.totalPicks || p.totalPicks || "",
      d.pegPlanImageRef || p.pegPlanImageRef || "",
      d.pegPlanJson || ""
    ]]);
  }

  return _json({ ok: true, designId: designId });
}

function _designParentObj(r) {
  return {
    designId:        String(r[0] || ""),
    designNo:        String(r[1] || ""),
    designName:      String(r[2] || ""),
    sourceFirm:      String(r[3] || ""),
    receivedDate:    r[4] ? (_toDate(r[4]) ? _ymd(_toDate(r[4])) : String(r[4])) : "",
    weaveType:       String(r[5] || ""),
    reed:            r[6] == null ? "" : String(r[6]),
    reedOrder:       r[7] == null ? "" : String(r[7]),
    pickPPI:         r[8] == null ? "" : String(r[8]),
    warpCount:       String(r[9] || ""),
    weftCount:       String(r[10] || ""),
    warpWidthIn:     r[11] == null ? "" : String(r[11]),
    clothWidthIn:    r[12] == null ? "" : String(r[12]),
    totalEnds:       Number(r[13]) || 0,
    composition:     String(r[14] || ""),
    constructionRaw: String(r[15] || ""),
    repeatEnds:      Number(r[16]) || 0,
    noOfRepeat:      Number(r[17]) || 0,
    extraEnds:       Number(r[18]) || 0,
    totalShafts:     Number(r[19]) || 0,
    totalPicks:      Number(r[20]) || 0,
    warpSeqText:     String(r[21] || ""),
    weftSeqText:     String(r[22] || ""),
    sourceImageRefs: String(r[23] || ""),
    pegPlanImageRef: String(r[24] || ""),
    capturedBy:      String(r[25] || ""),
    capturedAt:      r[26] ? String(r[26]) : "",
    rawText:         String(r[27] || ""),
    confidence:      (r[28] === "" || r[28] == null) ? null : Number(r[28]),
    notes:           String(r[29] || "")
  };
}

function _readDesigns() {
  var sh = _designsSheet();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, 30).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    if (!String(values[i][0] || "").trim()) continue;
    out.push(_designParentObj(values[i]));
  }
  out.reverse(); // newest first (rows are appended at the bottom)
  return out;
}

function _readDesignChildren(sh, designId, kind) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var width = kind === "warp" ? 7 : 6;
  var values = sh.getRange(2, 1, last - 1, width).getValues();
  var want = String(designId).trim();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    if (String(r[0] || "").trim() !== want) continue;
    if (kind === "warp") {
      out.push({ seq: Number(r[1]) || 0, count: String(r[2] || ""), colour: String(r[3] || ""), layer: String(r[4] || ""), ends: Number(r[5]) || 0, extra: Number(r[6]) || 0 });
    } else {
      out.push({ seq: Number(r[1]) || 0, count: String(r[2] || ""), colour: String(r[3] || ""), picks: Number(r[4]) || 0, extra: Number(r[5]) || 0 });
    }
  }
  out.sort(function (a, b) { return a.seq - b.seq; });
  return out;
}

function _readDesignDraft(designId) {
  var sh = _designDraftSheet();
  var last = sh.getLastRow();
  if (last < 2) return null;
  var values = sh.getRange(2, 1, last - 1, 6).getValues();
  var want = String(designId).trim();
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    if (String(r[0] || "").trim() !== want) continue;
    return {
      draftOrder: String(r[1] || ""),
      totalShafts: Number(r[2]) || 0,
      totalPicks: Number(r[3]) || 0,
      pegPlanImageRef: String(r[4] || ""),
      pegPlanJson: String(r[5] || "")
    };
  }
  return null;
}

function _readDesign(id, no) {
  var wantId = String(id || "").trim();
  var wantNo = String(no || "").trim();
  if (!wantId && !wantNo) return null;
  var sh = _designsSheet();
  var last = sh.getLastRow();
  if (last < 2) return null;
  var values = sh.getRange(2, 1, last - 1, 30).getValues();
  var parent = null, foundId = "";
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var rid = String(r[0] || "").trim();
    var rno = String(r[1] || "").trim();
    if ((wantId && rid === wantId) || (wantNo && rno === wantNo)) {
      parent = _designParentObj(r);
      foundId = rid;
      break;
    }
  }
  if (!parent) return null;
  parent.warp = _readDesignChildren(_designWarpSheet(), foundId, "warp");
  parent.weft = _readDesignChildren(_designWeftSheet(), foundId, "weft");
  parent.draft = _readDesignDraft(foundId);
  return parent;
}

function _appendProduction(p) {
  var sh = _sheet();
  sh.appendRow([
    p.shiftDate || "",                 // A
    "",                                // B
    p.shift || "",                     // C
    (p.loomId || "").toUpperCase(),    // D
    p.designName || "",                // E
    p.customerName || "",              // F
    Number(p.pickCounter) || 0,        // G
    Number(p.metersProduced) || 0,     // H
    Number(p.weftCuts) || 0,           // I
    Number(p.warpCuts) || 0,           // J
    p.loomState || "",                 // K
    p.note || "",                      // L
    _istStamp(p.capturedAt),           // M
    p.weaver || "",                    // N
    Number(p.efficiencyPct) || 0,      // O
    p.runtimeMinutes != null ? Number(p.runtimeMinutes) : "", // P
  ]);
  _notifyProduction(p);
  return _json({ ok: true });
}

function _editProduction(p) {
  var rowIndex = Number(p.rowIndex);
  if (!rowIndex || rowIndex < 2) return _json({ ok: false, error: "bad rowIndex" });
  var sh = _sheet();
  var row = sh.getRange(rowIndex, 1, 1, 14).getValues()[0];
  var origDate  = _ymd(row[0]);
  var origShift = String(row[2] || "").toUpperCase();
  if (!_isWithinEditWindow(origDate, origShift, new Date())) {
    return _json({ ok: false, error: "edit window closed" });
  }
  // Overwrite in place. Date, shift, loom remain authoritative from original row;
  // editable: pick/meters/cuts/state/note/weaver/design/customer.
  sh.getRange(rowIndex, 5, 1, 1).setValue(p.designName || row[4]);
  sh.getRange(rowIndex, 6, 1, 1).setValue(p.customerName || row[5]);
  sh.getRange(rowIndex, 7, 1, 1).setValue(Number(p.pickCounter) || 0);
  sh.getRange(rowIndex, 8, 1, 1).setValue(Number(p.metersProduced) || 0);
  sh.getRange(rowIndex, 9, 1, 1).setValue(Number(p.weftCuts) || 0);
  sh.getRange(rowIndex, 10, 1, 1).setValue(Number(p.warpCuts) || 0);
  sh.getRange(rowIndex, 11, 1, 1).setValue(p.loomState || row[10]);
  sh.getRange(rowIndex, 12, 1, 1).setValue(p.note || "");
  sh.getRange(rowIndex, 14, 1, 1).setValue(p.weaver || row[13]);
  sh.getRange(rowIndex, 15, 1, 1).setValue(Number(p.efficiencyPct) || 0);
  sh.getRange(rowIndex, 16, 1, 1).setValue(p.runtimeMinutes != null ? Number(p.runtimeMinutes) : "");
  sh.getRange(rowIndex, 17, 1, 1).setValue(_istStamp()); // Q Edited at
  return _json({ ok: true });
}

function _logLoading(p) {
  var sh = _loadingsSheet();
  sh.appendRow([
    _istStamp(p.capturedAt),                   // A
    (p.loomId || "").toUpperCase(),            // B
    p.designName || "",                        // C
    p.customerName || "",                      // D
    p.shiftDate || "",                         // E
    p.shift || "",                             // F
    p.source || "",                            // G
    p.resumedFromRunout ? "yes" : ""           // H
  ]);
  _notifyLoading(p);
  return _json({ ok: true });
}

function _readLoadings(days) {
  var sh = _loadingsSheet();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, 8).getValues();
  var floorTs = Date.now() - days * 86400000;
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var capturedAt = r[0] ? new Date(r[0]) : null;
    if (!capturedAt || isNaN(capturedAt.getTime())) continue;
    if (capturedAt.getTime() < floorTs) continue;
    out.push({
      capturedAt:   capturedAt.toISOString(),
      loomId:       String(r[1] || "").toUpperCase(),
      designName:   String(r[2] || ""),
      customerName: String(r[3] || ""),
      shiftDate:    r[4] ? _ymd(_toDate(r[4]) || new Date(r[4])) : "",
      shift:        String(r[5] || "").toUpperCase(),
      source:       String(r[6] || ""),
      resumedFromRunout: String(r[7] || "").toLowerCase() === "yes"
    });
  }
  return out;
}

/* ------------------------------ readers ------------------------------ */

function _readLightRows(days) {
  var sh = _sheet();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, 4).getValues(); // A..D
  var floor = _daysAgo(days);
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var d = _toDate(r[0]); if (!d || d < floor) continue;
    out.push({ date: _ymd(d), shift: String(r[2] || "").toUpperCase(), loomId: String(r[3] || "").toUpperCase() });
  }
  return out;
}

function _readFullRows(days) {
  var sh = _sheet();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, 17).getValues(); // A..Q
  var floor = _daysAgo(days);
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var d = _toDate(r[0]); if (!d || d < floor) continue;
    var shift = String(r[2] || "").toUpperCase();
    out.push({
      rowIndex:    i + 2,
      date:        _ymd(d),
      shift:       shift,
      loomId:      String(r[3] || "").toUpperCase(),
      designName:  r[4] || "",
      customerName:r[5] || "",
      pickCounter: Number(r[6]) || 0,
      meters:      Number(r[7]) || 0,
      weftCuts:    Number(r[8]) || 0,
      warpCuts:    Number(r[9]) || 0,
      loomState:   r[10] || "",
      note:        r[11] || "",
      capturedAt:  r[12] ? new Date(r[12]).toISOString() : "",
      weaver:      r[13] || "",
      efficiencyPct: Number(r[14]) || 0,
      runtimeMinutes: r[15] === "" || r[15] == null ? 0 : Number(r[15]) || 0,
      editedAt:    r[16] ? new Date(r[16]).toISOString() : "",
      editable:    _isWithinEditWindow(_ymd(d), shift, new Date()),
    });
  }
  return out;
}

/* ------------------------------ edit window ------------------------------ */
/**
 * A-shift entry of date D is editable until 11:00 (B-cutoff) on D+1.
 * B-shift entry of date D is editable until 22:00 (A-cutoff) on D+1.
 */
function _isWithinEditWindow(dateYmd, shift, now) {
  var parts = String(dateYmd).split("-");
  if (parts.length !== 3) return false;
  var y = +parts[0], m = +parts[1] - 1, d = +parts[2];
  var deadline;
  if (shift === "A") deadline = new Date(y, m, d + 1, 11, 0, 0);
  else if (shift === "B") deadline = new Date(y, m, d + 1, 22, 0, 0);
  else return false;
  return now < deadline;
}

/* ------------------------------ WhatsApp ------------------------------ */

function _notifyProduction(p) {
  if (!WA_ENABLED) return;
  var msg =
    "✅ " + (p.loomId || "") + " · " + (p.shift || "") + " shift\n" +
    (p.weaver ? "Weaver: " + p.weaver + "\n" : "") +
    "Picks: " + (Number(p.pickCounter) || 0) + " · Meters: " + (Number(p.metersProduced) || 0) + "\n" +
    "Cuts: " + (Number(p.weftCuts) || 0) + "W / " + (Number(p.warpCuts) || 0) + "Wp · " + (p.loomState || "");
  _waSend(msg);
}

function _notifyLoading(p) {
  if (!WA_ENABLED) return;
  var prefix = p.resumedFromRunout ? "🟢 New warp confirmed (runout cleared)" : "🧵 Warp loaded";
  var msg = prefix + " · " + (p.loomId || "") + "\n" +
    (p.designName || "") + " · " + (p.customerName || "");
  _waSend(msg);
}

// Route a message through the configured provider(s). Both paths fail silently.
function _waSend(body) {
  if (WA_PROVIDER === "callmebot") { _waSendCallMeBot(body); return; }
  if (WA_PROVIDER === "both")      { _waSendTwilio(body); _waSendCallMeBot(body); return; }
  _waSendTwilio(body); // default
}

function _waSendTwilio(body) {
  if (!TWILIO_SID || !TWILIO_AUTH || !TWILIO_FROM) return;
  try {
    UrlFetchApp.fetch("https://api.twilio.com/2010-04-01/Accounts/" + TWILIO_SID + "/Messages.json", {
      method: "post",
      headers: { Authorization: "Basic " + Utilities.base64Encode(TWILIO_SID + ":" + TWILIO_AUTH) },
      payload: { From: _waAddr(TWILIO_FROM), To: _waAddr(WA_RELAY_NUMBER), Body: body },
      muteHttpExceptions: true,
    });
  } catch (err) { /* silent */ }
}

// CallMeBot delivers via a simple authenticated GET. The phone must be digits
// with country code (no "+", no spaces); the key is the one returned at signup.
function _waSendCallMeBot(body) {
  if (!CALLMEBOT_PHONE || !CALLMEBOT_APIKEY) return;
  try {
    var phone = String(CALLMEBOT_PHONE).replace(/[^0-9]/g, "");
    var url = "https://api.callmebot.com/whatsapp.php"
      + "?phone="  + encodeURIComponent(phone)
      + "&text="   + encodeURIComponent(body)
      + "&apikey=" + encodeURIComponent(CALLMEBOT_APIKEY);
    UrlFetchApp.fetch(url, { method: "get", muteHttpExceptions: true });
  } catch (err) { /* silent */ }
}

/* ------------------------------ time triggers ------------------------------ */
// Install once via Apps Script Triggers UI:
//  - sendAShiftSummary  → daily, 18:05
//  - sendBShiftSummary  → daily, 06:05

function sendAShiftSummary() {
  if (!WA_ENABLED) return;
  var today = _ymd(new Date());
  var rows = _readFullRows(2).filter(function (r) { return r.date === today && r.shift === "A"; });
  _waSend(_buildSummary("A shift · " + today, rows));
}

function sendBShiftSummary() {
  if (!WA_ENABLED) return;
  var d = new Date(); d.setDate(d.getDate() - 1);
  var dayY = _ymd(d);
  var rows = _readFullRows(3).filter(function (r) { return r.date === dayY; });
  _waSend(_buildSummary("Daily · " + dayY, rows));
}

function _buildSummary(title, rows) {
  if (!rows.length) return "📊 " + title + "\nNo entries.";
  var meters = 0, picks = 0;
  rows.forEach(function (r) { meters += r.meters; picks += r.pickCounter; });
  var lines = ["📊 " + title, "Looms logged: " + rows.length, "Total meters: " + meters.toFixed(1), "Total picks: " + picks];
  rows.forEach(function (r) {
    lines.push(r.loomId + " · " + r.weaver + " · " + r.meters + "m · " + r.pickCounter + " picks");
  });
  return lines.join("\n");
}

/* ------------------------------ partner daily digest ------------------------------ */
// Install once via the Apps Script editor: run installDailyReportTrigger().
// Sends one WhatsApp message at 11:00 IST summarising YESTERDAY's master
// production (same figures as the partner Day tab) plus that day's cash-in.

function sendDailyPartnerReport() {
  if (!WA_ENABLED) return;
  var d = new Date(); d.setDate(d.getDate() - 1);
  var dateY = _ymd(d);
  _waSend(_buildPartnerDailyReport(dateY));
}

// Run manually from the Apps Script editor to verify Twilio delivery now,
// without waiting for the 11:00 trigger. Sends yesterday's digest immediately.
function testDailyPartnerReport() {
  var d = new Date(); d.setDate(d.getDate() - 1);
  _waSend(_buildPartnerDailyReport(_ymd(d)));
}

// Diagnostic — run this and open View → Logs (or Executions). It prints the
// exact Twilio response so a failed send is no longer silent. Checks creds,
// then attempts a one-line test message to WA_RELAY_NUMBER.
function diagnoseWhatsApp() {
  Logger.log("WA_ENABLED: " + WA_ENABLED);
  Logger.log("TWILIO_SID set: " + (TWILIO_SID ? "yes (" + TWILIO_SID.slice(0, 6) + "…)" : "NO"));
  Logger.log("TWILIO_AUTH set: " + (TWILIO_AUTH ? "yes" : "NO"));
  Logger.log("TWILIO_FROM: " + (TWILIO_FROM || "NO"));
  Logger.log("To: whatsapp:" + WA_RELAY_NUMBER);

  if (!TWILIO_SID || !TWILIO_AUTH || !TWILIO_FROM) {
    Logger.log("ABORT: one or more script properties are missing. Set them in Project Settings → Script Properties.");
    return;
  }

  var resp = UrlFetchApp.fetch(
    "https://api.twilio.com/2010-04-01/Accounts/" + TWILIO_SID + "/Messages.json",
    {
      method: "post",
      headers: { Authorization: "Basic " + Utilities.base64Encode(TWILIO_SID + ":" + TWILIO_AUTH) },
      payload: { From: _waAddr(TWILIO_FROM), To: _waAddr(WA_RELAY_NUMBER), Body: "SAT test ✅ " + _istStamp() },
      muteHttpExceptions: true,
    }
  );
  Logger.log("HTTP status: " + resp.getResponseCode());
  Logger.log("Response: " + resp.getContentText());
}

// Diagnostic for CallMeBot — run this, then open View → Logs (or Executions).
// Prints the API response so a failed send is no longer silent.
function diagnoseCallMeBot() {
  Logger.log("WA_PROVIDER: " + WA_PROVIDER);
  Logger.log("CALLMEBOT_PHONE: " + (CALLMEBOT_PHONE || "NO"));
  Logger.log("CALLMEBOT_APIKEY set: " + (CALLMEBOT_APIKEY ? "yes" : "NO"));

  if (!CALLMEBOT_PHONE || !CALLMEBOT_APIKEY) {
    Logger.log("ABORT: set CALLMEBOT_PHONE and CALLMEBOT_APIKEY in Project Settings → Script Properties.");
    return;
  }

  var phone = String(CALLMEBOT_PHONE).replace(/[^0-9]/g, "");
  var resp = UrlFetchApp.fetch(
    "https://api.callmebot.com/whatsapp.php"
      + "?phone="  + encodeURIComponent(phone)
      + "&text="   + encodeURIComponent("SAT CallMeBot test ✅ " + _istStamp())
      + "&apikey="  + encodeURIComponent(CALLMEBOT_APIKEY),
    { method: "get", muteHttpExceptions: true }
  );
  Logger.log("HTTP status: " + resp.getResponseCode());
  Logger.log("Response: " + resp.getContentText());
}

function _buildPartnerDailyReport(dateYmd) {
  var lines = ["📊 Daily report · " + dateYmd];

  var rows = _readMasterDay(dateYmd);
  if (!rows.length) {
    // Mirror the Day tab empty state: production for this day is not yet fed.
    lines.push("⏳ சூப்பர்வைசர் இன்னும் பதிவு செய்யவில்லை.");
  } else {
    var meters = 0, revenue = 0, target = 0;
    var looms = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      meters += r.meters;
      revenue += r.revenue;
      target += r.targetMeters;
      if (r.meters > 0 || r.efficiency > 0) looms[r.loom] = true;
    }
    var loomCount = 0; for (var k in looms) loomCount++;
    var eff = target > 0 ? Math.round((meters / target) * 100) : 0;
    lines.push(loomCount + (loomCount === 1 ? " loom" : " looms") + " · " + Math.round(meters) + " mtr");
    lines.push("Revenue " + _inr(revenue) + " · Avg " + eff + "%");
  }

  // Reuse one sheet handle for the cash summary and same-day ledger slice.
  var cashflowSheet = _cashflowSheet();
  var cf = _readCashflow(cashflowSheet);
  if (cf && isFinite(cf.totalAvailable)) {
    lines.push("");
    lines.push("🏦 Total cash available " + _inr(cf.totalAvailable));
  }

  // Fresh cash-in only — entries recorded for this day. Nothing shown if none.
  var cashIn = _readCashLedger(dateYmd, dateYmd, "", "in", cashflowSheet);
  if (cashIn.length) {
    var total = 0;
    for (var j = 0; j < cashIn.length; j++) total += cashIn[j].amount;
    lines.push("💰 Cash in today " + _inr(total));
    for (var m = 0; m < cashIn.length; m++) {
      var c = cashIn[m];
      lines.push("• " + (c.description || "—") + " " + _inr(c.amount));
    }
  }

  // Total pending receivables across all open invoices.
  var pending = _totalPendingReceivables();
  lines.push("");
  lines.push("📥 Pending receivables " + _inr(pending));

  // Always nudge to the app — WhatsApp makes the raw URL tappable.
  lines.push("");
  lines.push("👉 Open SAT app: " + APP_URL);

  return lines.join("\n");
}

function installDailyReportTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "sendDailyPartnerReport") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger("sendDailyPartnerReport")
    .timeBased()
    .atHour(11)
    .everyDays(1)
    .inTimezone("Asia/Kolkata")
    .create();
}

// An advance recorded before invoicing carries a placeholder like
// "invoice not created" in the invoice-number cell. Treat that as no invoice.
function _hasRealInvoice(inv) {
  var s = String(inv || "").trim().toLowerCase();
  if (!s) return false;
  if (s.indexOf("not created") >= 0 || s.indexOf("no invoice") >= 0 || s.indexOf("not yet") >= 0) return false;
  return true;
}

// Grand total of pending receivables — mirrors the partner Receivables tab:
// merge rows sharing a party+invoice, then sum the effective pending of each.
function _totalPendingReceivables() {
  var rows = _readMasterReceivables();
  var byInv = {};
  var passthrough = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var inv = String(r.invoiceNumber || "").trim();
    if (!_hasRealInvoice(inv)) { passthrough.push(r); continue; }
    var key = String(r.party || "").trim() + "||" + inv;
    if (!byInv[key]) {
      byInv[key] = {
        invoiceAmount: r.invoiceAmount || 0,
        receipts: r.receipts || 0,
        pendingBalance: r.pendingBalance || 0,
        paymentStatus: r.paymentStatus || "",
        status: r.status || ""
      };
    } else {
      byInv[key].invoiceAmount += r.invoiceAmount || 0;
      byInv[key].receipts += r.receipts || 0;
      byInv[key].pendingBalance += r.pendingBalance || 0;
      if (!byInv[key].paymentStatus && r.paymentStatus) byInv[key].paymentStatus = r.paymentStatus;
      if (!byInv[key].status && r.status) byInv[key].status = r.status;
    }
  }
  var total = 0;
  for (var k in byInv) total += _effectivePending(byInv[k]);
  // Rows without a real invoice (advances / not-yet-billed) are not receivables.
  return total;
}

function _effectivePending(r) {
  var s = String(r.paymentStatus || r.status || "").toLowerCase();
  if (s.indexOf("paid") >= 0 && s.indexOf("partial") < 0 && s.indexOf("unpaid") < 0) return 0;
  if (r.invoiceAmount > 0) return Math.max(0, r.invoiceAmount - (r.receipts || 0));
  return r.pendingBalance || 0;
}

/* ------------------------------ master workbook (Partner) ------------------------------ */
/**
 * Master tab `Looms_Production` columns:
 *  A Date · B Paagu ID · C Loom · D Shift (A/B) · E Weaver · F RPM · G Adj Pick rate
 *  H Achieved Pick · I Produced m · J Target mtr · K Efficiency · L State
 *  M Rate per meter · N Produced revenue · O Customer & design code
 */
function _masterReadResponse(mode, reader) {
  var startedAt = Date.now();
  var requestId = _masterReceivablesRequestId();
  try {
    return reader();
  } catch (err) {
    var code = err && err.code ? String(err.code) : "MASTER_READ_FAILED";
    var message = err && err.publicMessage
      ? String(err.publicMessage)
      : "The requested Partner data is temporarily unavailable.";
    var totalMs = Date.now() - startedAt;
    _masterReceivablesLog({
      event: "master-read",
      mode: mode,
      requestId: requestId,
      ok: false,
      code: code,
      totalMs: totalMs
    });
    var response = {
      ok: false,
      error: code,
      message: message,
      meta: {
        requestId: requestId,
        servedAt: new Date().toISOString(),
        timingMs: { total: totalMs }
      }
    };
    if (err && err.safeDetails) response.meta.details = err.safeDetails;
    return response;
  }
}

function _requiredMasterSheet(tabName, minColumns) {
  var ss;
  try {
    ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  } catch (err) {
    throw _masterReceivablesFailure(
      "MASTER_WORKBOOK_ACCESS",
      "The master workbook could not be opened. Check its ID and deployment-account access."
    );
  }
  var sh = ss.getSheetByName(tabName);
  if (!sh) {
    throw _masterReceivablesFailure(
      "MASTER_TAB_MISSING",
      'The required master tab "' + tabName + '" was not found.',
      { tab: tabName }
    );
  }
  if (minColumns && sh.getMaxColumns() < minColumns) {
    throw _masterReceivablesFailure(
      "MASTER_GRID_TOO_NARROW",
      'The required master tab "' + tabName + '" does not contain all expected columns.',
      { tab: tabName, maxColumns: sh.getMaxColumns(), requiredColumns: minColumns }
    );
  }
  return sh;
}

function _masterProduction() {
  return _requiredMasterSheet(MASTER_PRODUCTION_TAB, 15);
}

function _masterOrderTab() {
  return _requiredMasterSheet(MASTER_ORDER_TAB, 1);
}

function _masterProductionCacheBaseKey() {
  return [
    "mp",
    MASTER_PRODUCTION_CACHE_VERSION,
    MASTER_SHEET_ID,
    MASTER_PRODUCTION_TAB
  ].join(":");
}

function _readMasterProductionCache() {
  try {
    var cache = CacheService.getScriptCache();
    var manifestText = cache.get(_masterProductionCacheBaseKey() + ":manifest");
    if (!manifestText) return null;
    var manifest = JSON.parse(manifestText);
    if (
      !manifest ||
      manifest.cacheVersion !== MASTER_PRODUCTION_CACHE_VERSION ||
      !Array.isArray(manifest.shardKeys) ||
      !Array.isArray(manifest.shardBytes) ||
      manifest.shardKeys.length < 1 ||
      manifest.shardKeys.length > MASTER_RECEIVABLES_MAX_CACHE_CHUNKS ||
      manifest.shardKeys.length !== manifest.shardBytes.length
    ) {
      return null;
    }
    var cached = cache.getAll(manifest.shardKeys);
    var rows = [];
    for (var i = 0; i < manifest.shardKeys.length; i++) {
      var key = manifest.shardKeys[i];
      var shardText = cached[key];
      if (!shardText || _masterReceivablesUtf8Bytes(shardText) !== manifest.shardBytes[i]) return null;
      var shardRows = JSON.parse(shardText);
      if (!Array.isArray(shardRows)) return null;
      rows = rows.concat(shardRows);
    }
    return rows.length === manifest.rowCount ? rows : null;
  } catch (err) {
    return null;
  }
}

function _writeMasterProductionCache(rows) {
  if (!rows || !rows.length) return false;
  var chunks = [];
  var current = [];
  var currentBytes = 2;
  for (var i = 0; i < rows.length; i++) {
    var rowJson = JSON.stringify(rows[i]);
    var rowBytes = _masterReceivablesUtf8Bytes(rowJson);
    if (rowBytes + 2 > MASTER_RECEIVABLES_CACHE_CHUNK_BYTES) return false;
    var addedBytes = rowBytes + (current.length ? 1 : 0);
    if (current.length && currentBytes + addedBytes > MASTER_RECEIVABLES_CACHE_CHUNK_BYTES) {
      chunks.push(JSON.stringify(current));
      current = [];
      currentBytes = 2;
      addedBytes = rowBytes;
    }
    current.push(rows[i]);
    currentBytes += addedBytes;
  }
  if (current.length) chunks.push(JSON.stringify(current));
  if (!chunks.length || chunks.length > MASTER_RECEIVABLES_MAX_CACHE_CHUNKS) return false;

  try {
    var cache = CacheService.getScriptCache();
    var baseKey = _masterProductionCacheBaseKey();
    var datasetId = _masterReceivablesRequestId();
    var shardValues = {};
    var shardKeys = [];
    var shardBytes = [];
    for (var c = 0; c < chunks.length; c++) {
      var chunkBytes = _masterReceivablesUtf8Bytes(chunks[c]);
      if (chunkBytes > MASTER_RECEIVABLES_CACHE_CHUNK_BYTES) return false;
      var shardKey = baseKey + ":" + datasetId + ":" + c;
      shardKeys.push(shardKey);
      shardBytes.push(chunkBytes);
      shardValues[shardKey] = chunks[c];
    }
    var manifestText = JSON.stringify({
      cacheVersion: MASTER_PRODUCTION_CACHE_VERSION,
      rowCount: rows.length,
      shardKeys: shardKeys,
      shardBytes: shardBytes
    });
    if (_masterReceivablesUtf8Bytes(manifestText) > MASTER_RECEIVABLES_CACHE_CHUNK_BYTES) return false;
    var manifestKey = baseKey + ":manifest";
    cache.remove(manifestKey);
    cache.putAll(shardValues, MASTER_PRODUCTION_CACHE_TTL_SECONDS);
    cache.put(manifestKey, manifestText, MASTER_PRODUCTION_CACHE_TTL_SECONDS);
    return true;
  } catch (err) {
    _masterReceivablesLog({ event: "master-production-cache", ok: false, code: "CACHE_WRITE_FAILED" });
    return false;
  }
}

function _buildMasterRows() {
  var sh = _masterProduction();
  var dateHeader = _masterHeaderKey(sh.getRange(1, 1).getDisplayValue());
  if (dateHeader !== "date") {
    throw _masterReceivablesFailure(
      "MASTER_PRODUCTION_SCHEMA_MISMATCH",
      'The "' + MASTER_PRODUCTION_TAB + '" tab must keep Date in column A.',
      { tab: MASTER_PRODUCTION_TAB, expectedColumn: "A", expectedHeader: "Date" }
    );
  }
  var rawLastRow = sh.getLastRow();
  if (rawLastRow > MASTER_PRODUCTION_MAX_GRID_ROWS) {
    throw _masterReceivablesFailure(
      "MASTER_PRODUCTION_GRID_TOO_LARGE",
      "The master production sheet exceeds the reviewed row bound.",
      { lastRow: rawLastRow, maxRows: MASTER_PRODUCTION_MAX_GRID_ROWS }
    );
  }
  if (rawLastRow < 2) return [];

  // Date is mandatory for every normalized production row. Scan only column A
  // first so trailing formula/format rows do not force an A:O read.
  var dateValues = sh.getRange(2, 1, rawLastRow - 1, 1).getValues();
  var lastDateOffset = -1;
  for (var dIndex = 0; dIndex < dateValues.length; dIndex++) {
    if (_toDate(dateValues[dIndex][0])) lastDateOffset = dIndex;
  }
  if (lastDateOffset < 0) return [];
  var dataRows = lastDateOffset + 1;
  var values = sh.getRange(2, 1, dataRows, 15).getValues(); // A..O, bounded to dated rows
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var d = _toDate(r[0]); if (!d) continue;
    var loom = String(r[2] || "").toUpperCase();
    if (!loom) continue;
    var shift = String(r[3] || "").toUpperCase();
    if (shift !== "A" && shift !== "B") continue;
    out.push({
      rowIndex: i + 2,
      date: _ymd(d),
      paaguId: String(r[1] || ""),
      loom: loom,
      shift: shift,
      weaver: String(r[4] || ""),
      rpm: Number(r[5]) || 0,
      adjPickRate: Number(r[6]) || 0,
      achievedPick: Number(r[7]) || 0,
      meters: Number(r[8]) || 0,
      targetMeters: Number(r[9]) || 0,
      efficiency: _normEff(r[10]),
      state: String(r[11] || ""),
      ratePerMeter: Number(r[12]) || 0,
      revenue: Number(r[13]) || 0,
      orderTag: String(r[14] || "")
    });
  }
  return out;
}

function _readMasterRows() {
  var cached = _readMasterProductionCache();
  if (cached) return cached;
  var rows = _buildMasterRows();
  _writeMasterProductionCache(rows);
  return rows;
}

function _readMasterDay(dateYmd) {
  var all = _readMasterRows();
  var out = [];
  for (var i = 0; i < all.length; i++) {
    if (all[i].date === dateYmd) out.push(all[i]);
  }
  return out;
}

function _readMasterRange(fromYmd, toYmd) {
  var fromMs = fromYmd ? _ymdToDate(fromYmd).getTime() : 0;
  var toMs   = toYmd   ? _ymdToDate(toYmd).getTime()   : Date.now();
  var all = _readMasterRows();
  var out = [];
  for (var i = 0; i < all.length; i++) {
    var t = _ymdToDate(all[i].date).getTime();
    if (t < fromMs || t > toMs) continue;
    out.push({
      date: all[i].date,
      loom: all[i].loom,
      shift: all[i].shift,
      meters: all[i].meters,
      targetMeters: all[i].targetMeters,
      ratePerMeter: all[i].ratePerMeter,
      revenue: all[i].revenue,
      efficiency: all[i].efficiency,
      state: all[i].state
    });
  }
  return out;
}

function _readMasterOrders() {
  var sh = _masterOrderTab();
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var width = sh.getLastColumn();
  var values = sh.getRange(1, 1, last, width).getValues();
  var headers = values[0].map(function (h) { return String(h || "").trim(); });
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var row = {};
    var any = false;
    for (var c = 0; c < headers.length; c++) {
      var key = headers[c] || ("col" + (c + 1));
      var val = values[i][c];
      if (val instanceof Date) val = _ymd(val);
      else if (val !== null && val !== "") any = true;
      row[key] = val;
    }
    if (any) out.push(row);
  }
  return out;
}

/**
 * Master tab "Paagu ID" — receivables view.
 * Cols: A Order ID · B Paagu ID · C Customer Name · E Status · Looms Allocated
 *  AA Invoice amount · AB Invoice number · AC Invoice date · AD Due date
 *  AE Receipts · AF Received On · AG Payment status
 *  AN Pending Balance · AP Party
 */
function _masterReceivableColumnSpecs() {
  return [
    { key: "orderId", aliases: ["Order ID"], index: 0, required: false },
    { key: "paaguId", aliases: ["Paagu ID", "Paagu"], index: 1, required: true },
    { key: "customerName", aliases: ["Customer Name", "Design Details"], index: 2, required: true },
    { key: "status", aliases: ["Status"], index: 4, required: true },
    {
      key: "loadedLoom",
      aliases: ["Looms Allocated", "Loaded Loom", "Loom Allocated"],
      index: 10,
      required: false
    },
    { key: "invoiceAmount", aliases: ["Invoice amount"], index: 26, required: true },
    { key: "invoiceNumber", aliases: ["Invoice number"], index: 27, required: true },
    { key: "invoiceDate", aliases: ["Invoice date"], index: 28, required: true },
    { key: "dueDate", aliases: ["Due date"], index: 29, required: true },
    { key: "receipts", aliases: ["Receipts"], index: 30, required: true },
    { key: "receivedOn", aliases: ["Received On"], index: 31, required: true },
    { key: "paymentStatus", aliases: ["Payment status"], index: 32, required: true },
    { key: "pendingBalance", aliases: ["Pending Balance"], index: 39, required: true },
    { key: "party", aliases: ["Party"], index: 41, required: true }
  ];
}

function _masterHeaderKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function _masterColumnLetter(index) {
  var n = index + 1;
  var out = "";
  while (n > 0) {
    var rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function _masterReceivablesFailure(code, publicMessage, details) {
  var err = new Error(publicMessage || "Master receivables could not be read.");
  err.code = code || "MASTER_RECEIVABLES_READ_FAILED";
  err.publicMessage = publicMessage || "Master receivables could not be read.";
  err.safeDetails = details || null;
  return err;
}

function _masterReceivablesRequestId() {
  return Utilities.getUuid().replace(/-/g, "").slice(0, 12);
}

function _masterSafeIdSuffix(value) {
  var text = String(value || "");
  return text ? text.slice(-8) : "";
}

function _masterReceivablesLog(event) {
  try {
    Logger.log(JSON.stringify(event));
  } catch (err) {
    Logger.log("master-receivables log unavailable");
  }
}

function _parseMasterReceivablesQuery(e) {
  var p = (e && e.parameter) || {};
  var rawPageSize = p.pageSize;
  var paginated = rawPageSize !== undefined && rawPageSize !== null && String(rawPageSize) !== "";
  var freshText = String(p.fresh || "").toLowerCase();
  var query = {
    fresh: freshText === "1" || freshText === "true",
    paginated: paginated,
    page: 1,
    pageSize: 0
  };
  if (!paginated) return query;

  if (!/^\d+$/.test(String(rawPageSize))) {
    throw _masterReceivablesFailure("INVALID_PAGE_SIZE", "pageSize must be a whole number.");
  }
  query.pageSize = Number(rawPageSize);
  if (query.pageSize < 1 || query.pageSize > MASTER_RECEIVABLES_MAX_PAGE_SIZE) {
    throw _masterReceivablesFailure(
      "INVALID_PAGE_SIZE",
      "pageSize must be between 1 and " + MASTER_RECEIVABLES_MAX_PAGE_SIZE + "."
    );
  }

  var rawPage = p.page === undefined || p.page === null || String(p.page) === "" ? "1" : String(p.page);
  if (!/^\d+$/.test(rawPage) || Number(rawPage) < 1) {
    throw _masterReceivablesFailure("INVALID_PAGE", "page must be a positive whole number.");
  }
  query.page = Number(rawPage);
  return query;
}

function _masterReceivablesErrorResponse(err, requestId, startedAt) {
  var code = err && err.code ? String(err.code) : "MASTER_RECEIVABLES_READ_FAILED";
  var message = err && err.publicMessage
    ? String(err.publicMessage)
    : "Master receivables are temporarily unavailable.";
  var safeDetails = err && err.safeDetails ? err.safeDetails : undefined;
  var totalMs = Date.now() - startedAt;
  _masterReceivablesLog({
    event: "master-receivables",
    requestId: requestId,
    ok: false,
    code: code,
    totalMs: totalMs
  });
  var response = {
    ok: false,
    error: code,
    message: message,
    meta: {
      apiVersion: MASTER_RECEIVABLES_API_VERSION,
      schemaVersion: MASTER_RECEIVABLES_SCHEMA_VERSION,
      requestId: requestId,
      servedAt: new Date().toISOString(),
      timingMs: { total: totalMs }
    }
  };
  if (safeDetails) response.meta.details = safeDetails;
  return response;
}

function _masterReceivablesResponse(e) {
  var startedAt = Date.now();
  var requestId = _masterReceivablesRequestId();
  try {
    var query = _parseMasterReceivablesQuery(e);
    var dataset = _loadMasterReceivablesDataset({
      useCache: true,
      fresh: query.fresh
    });
    var rows = dataset.rows;
    var pagination = null;
    if (query.paginated) {
      var totalRows = rows.length;
      var totalPages = totalRows ? Math.ceil(totalRows / query.pageSize) : 0;
      var start = (query.page - 1) * query.pageSize;
      rows = start < totalRows ? rows.slice(start, start + query.pageSize) : [];
      pagination = {
        page: query.page,
        pageSize: query.pageSize,
        totalRows: totalRows,
        totalPages: totalPages,
        hasMore: start + query.pageSize < totalRows,
        datasetId: dataset.datasetId
      };
    }

    var timing = {};
    var timingSource = dataset.timingMs || {};
    for (var timingKey in timingSource) timing[timingKey] = timingSource[timingKey];
    timing.total = Date.now() - startedAt;

    var response = {
      ok: true,
      rows: rows,
      meta: {
        apiVersion: MASTER_RECEIVABLES_API_VERSION,
        schemaVersion: MASTER_RECEIVABLES_SCHEMA_VERSION,
        requestId: requestId,
        datasetId: dataset.datasetId,
        generatedAt: dataset.generatedAt,
        servedAt: new Date().toISOString(),
        source: dataset.sourceMeta,
        health: dataset.health,
        cache: dataset.cache,
        timingMs: timing
      }
    };
    if (pagination) response.pagination = pagination;

    _masterReceivablesLog({
      event: "master-receivables",
      requestId: requestId,
      ok: true,
      rows: rows.length,
      totalRows: dataset.rows.length,
      cache: dataset.cache.status,
      sourceIdSuffix: dataset.sourceMeta.spreadsheetIdSuffix,
      totalMs: timing.total
    });
    return response;
  } catch (err) {
    return _masterReceivablesErrorResponse(err, requestId, startedAt);
  }
}

function _masterReceivablesCacheBaseKey() {
  return [
    "mr",
    MASTER_RECEIVABLES_CACHE_VERSION,
    MASTER_SHEET_ID,
    MASTER_PAAGU_TAB
  ].join(":");
}

function _masterReceivablesUtf8Bytes(value) {
  return Utilities.newBlob(String(value || ""), "text/plain").getBytes().length;
}

function _readMasterReceivablesCache() {
  var startedAt = Date.now();
  try {
    var cache = CacheService.getScriptCache();
    var manifestText = cache.get(_masterReceivablesCacheBaseKey() + ":manifest");
    if (!manifestText) return { dataset: null, lookupMs: Date.now() - startedAt };
    var manifest = JSON.parse(manifestText);
    if (
      !manifest ||
      manifest.cacheVersion !== MASTER_RECEIVABLES_CACHE_VERSION ||
      !Array.isArray(manifest.shardKeys) ||
      !Array.isArray(manifest.shardBytes) ||
      manifest.shardKeys.length < 1 ||
      manifest.shardKeys.length > MASTER_RECEIVABLES_MAX_CACHE_CHUNKS ||
      manifest.shardKeys.length !== manifest.shardBytes.length
    ) {
      return { dataset: null, lookupMs: Date.now() - startedAt };
    }

    var cached = cache.getAll(manifest.shardKeys);
    var rows = [];
    for (var i = 0; i < manifest.shardKeys.length; i++) {
      var key = manifest.shardKeys[i];
      var shardText = cached[key];
      if (!shardText || _masterReceivablesUtf8Bytes(shardText) !== manifest.shardBytes[i]) {
        return { dataset: null, lookupMs: Date.now() - startedAt };
      }
      var shardRows = JSON.parse(shardText);
      if (!Array.isArray(shardRows)) {
        return { dataset: null, lookupMs: Date.now() - startedAt };
      }
      rows = rows.concat(shardRows);
    }
    if (rows.length !== manifest.rowCount) {
      return { dataset: null, lookupMs: Date.now() - startedAt };
    }

    return {
      dataset: {
        rows: rows,
        datasetId: manifest.datasetId,
        generatedAt: manifest.generatedAt,
        sourceMeta: manifest.sourceMeta,
        health: manifest.health,
        buildTimingMs: manifest.buildTimingMs || {}
      },
      lookupMs: Date.now() - startedAt
    };
  } catch (err) {
    return { dataset: null, lookupMs: Date.now() - startedAt };
  }
}

function _writeMasterReceivablesCache(dataset) {
  if (!dataset || !dataset.rows || !dataset.rows.length) return false;
  var chunks = [];
  var current = [];
  var currentBytes = 2; // opening and closing brackets

  for (var i = 0; i < dataset.rows.length; i++) {
    var rowJson = JSON.stringify(dataset.rows[i]);
    var rowBytes = _masterReceivablesUtf8Bytes(rowJson);
    if (rowBytes + 2 > MASTER_RECEIVABLES_CACHE_CHUNK_BYTES) return false;
    var addedBytes = rowBytes + (current.length ? 1 : 0);
    if (current.length && currentBytes + addedBytes > MASTER_RECEIVABLES_CACHE_CHUNK_BYTES) {
      chunks.push(JSON.stringify(current));
      current = [];
      currentBytes = 2;
      addedBytes = rowBytes;
    }
    current.push(dataset.rows[i]);
    currentBytes += addedBytes;
  }
  if (current.length) chunks.push(JSON.stringify(current));
  if (!chunks.length || chunks.length > MASTER_RECEIVABLES_MAX_CACHE_CHUNKS) return false;

  try {
    var cache = CacheService.getScriptCache();
    var baseKey = _masterReceivablesCacheBaseKey();
    var shardValues = {};
    var shardKeys = [];
    var shardBytes = [];
    for (var c = 0; c < chunks.length; c++) {
      var chunkBytes = _masterReceivablesUtf8Bytes(chunks[c]);
      if (chunkBytes > MASTER_RECEIVABLES_CACHE_CHUNK_BYTES) return false;
      var shardKey = baseKey + ":" + dataset.datasetId + ":" + c;
      shardKeys.push(shardKey);
      shardBytes.push(chunkBytes);
      shardValues[shardKey] = chunks[c];
    }

    var manifest = {
      cacheVersion: MASTER_RECEIVABLES_CACHE_VERSION,
      datasetId: dataset.datasetId,
      generatedAt: dataset.generatedAt,
      rowCount: dataset.rows.length,
      shardKeys: shardKeys,
      shardBytes: shardBytes,
      sourceMeta: dataset.sourceMeta,
      health: dataset.health,
      buildTimingMs: dataset.buildTimingMs || {}
    };
    var manifestText = JSON.stringify(manifest);
    if (_masterReceivablesUtf8Bytes(manifestText) > MASTER_RECEIVABLES_CACHE_CHUNK_BYTES) {
      return false;
    }

    var manifestKey = baseKey + ":manifest";
    cache.remove(manifestKey);
    cache.putAll(shardValues, MASTER_RECEIVABLES_CACHE_TTL_SECONDS);
    // Publish the manifest last. Readers ignore orphaned or incomplete shards.
    cache.put(manifestKey, manifestText, MASTER_RECEIVABLES_CACHE_TTL_SECONDS);
    return true;
  } catch (err) {
    _masterReceivablesLog({ event: "master-receivables-cache", ok: false, code: "CACHE_WRITE_FAILED" });
    return false;
  }
}

function _loadMasterReceivablesDataset(options) {
  options = options || {};
  var useCache = options.useCache !== false;
  var fresh = options.fresh === true;
  var cacheLookup = { dataset: null, lookupMs: 0 };

  if (useCache && !fresh) {
    cacheLookup = _readMasterReceivablesCache();
    if (cacheLookup.dataset) {
      cacheLookup.dataset.cache = {
        status: "hit",
        ageMs: Math.max(0, Date.now() - new Date(cacheLookup.dataset.generatedAt).getTime()),
        ttlSeconds: MASTER_RECEIVABLES_CACHE_TTL_SECONDS
      };
      cacheLookup.dataset.timingMs = {
        cacheLookup: cacheLookup.lookupMs,
        total: cacheLookup.lookupMs
      };
      return cacheLookup.dataset;
    }
  }

  var lock = null;
  var locked = false;
  var lockStartedAt = Date.now();
  if (useCache) {
    try {
      lock = LockService.getScriptLock();
      locked = lock.tryLock(2500);
    } catch (lockErr) {
      locked = false;
    }
  }

  try {
    if (locked && !fresh) {
      var secondLookup = _readMasterReceivablesCache();
      cacheLookup.lookupMs += secondLookup.lookupMs;
      if (secondLookup.dataset) {
        secondLookup.dataset.cache = {
          status: "hit-after-wait",
          ageMs: Math.max(0, Date.now() - new Date(secondLookup.dataset.generatedAt).getTime()),
          ttlSeconds: MASTER_RECEIVABLES_CACHE_TTL_SECONDS
        };
        secondLookup.dataset.timingMs = {
          cacheLookup: cacheLookup.lookupMs,
          lockWait: Date.now() - lockStartedAt,
          total: Date.now() - lockStartedAt + cacheLookup.lookupMs
        };
        return secondLookup.dataset;
      }
    }

    var dataset = _buildMasterReceivablesDataset();
    var cacheWriteStartedAt = Date.now();
    var stored = useCache ? _writeMasterReceivablesCache(dataset) : false;
    dataset.cache = {
      status: fresh ? "refresh" : "miss",
      stored: stored,
      ttlSeconds: stored ? MASTER_RECEIVABLES_CACHE_TTL_SECONDS : 0
    };
    dataset.timingMs = {};
    var builtTiming = dataset.buildTimingMs || {};
    for (var key in builtTiming) dataset.timingMs[key] = builtTiming[key];
    dataset.timingMs.cacheLookup = cacheLookup.lookupMs;
    dataset.timingMs.lockWait = Date.now() - lockStartedAt;
    dataset.timingMs.cacheWrite = Date.now() - cacheWriteStartedAt;
    return dataset;
  } finally {
    if (locked && lock) lock.releaseLock();
  }
}

function _openMasterReceivablesContext() {
  var ss;
  try {
    ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  } catch (err) {
    throw _masterReceivablesFailure(
      "MASTER_WORKBOOK_ACCESS",
      "The master workbook could not be opened. Check its ID and deployment-account access."
    );
  }
  var sh = ss.getSheetByName(MASTER_PAAGU_TAB);
  if (!sh) {
    throw _masterReceivablesFailure(
      "MASTER_TAB_MISSING",
      'The required master tab "' + MASTER_PAAGU_TAB + '" was not found.'
    );
  }
  if (sh.getMaxColumns() < 42) {
    throw _masterReceivablesFailure(
      "MASTER_GRID_TOO_NARROW",
      'The "' + MASTER_PAAGU_TAB + '" tab must include columns through AP.',
      { maxColumns: sh.getMaxColumns(), requiredColumns: 42 }
    );
  }
  return { spreadsheet: ss, sheet: sh };
}

function _resolveMasterReceivablesSchema(sheet) {
  var width = Math.min(sheet.getLastColumn(), 42);
  if (width < 1) {
    throw _masterReceivablesFailure("MASTER_SCHEMA_EMPTY", "The master receivables header row is empty.");
  }
  var headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  var normalized = [];
  for (var h = 0; h < headers.length; h++) normalized.push(_masterHeaderKey(headers[h]));
  var specs = _masterReceivableColumnSpecs();
  var columns = {};
  var resolved = {};
  var warnings = [];

  for (var s = 0; s < specs.length; s++) {
    var spec = specs[s];
    var index = spec.index;
    if (index >= 42) {
      throw _masterReceivablesFailure(
        "MASTER_SCHEMA_MAPPING_INVALID",
        "A configured receivables column is outside the supported A:AP layout.",
        { field: spec.key, column: _masterColumnLetter(index) }
      );
    }

    // A:AP is the established source contract. Header text is diagnostic only:
    // it must never remap a financial field or block a valid fixed-column read.
    var acceptedHeaderKeys = [];
    for (var a = 0; a < spec.aliases.length; a++) {
      acceptedHeaderKeys.push(_masterHeaderKey(spec.aliases[a]));
    }
    var actualHeader = String(headers[index] || "");
    var headerMatched = acceptedHeaderKeys.indexOf(normalized[index] || "") >= 0;
    var matchingColumns = [];
    for (var c = 0; c < normalized.length; c++) {
      if (acceptedHeaderKeys.indexOf(normalized[c]) >= 0) {
        matchingColumns.push(_masterColumnLetter(c));
      }
    }
    if (!headerMatched) {
      warnings.push({
        code: "FIXED_COLUMN_HEADER_MISMATCH",
        field: spec.key,
        column: _masterColumnLetter(index),
        expectedHeaders: spec.aliases.slice(),
        actualHeader: actualHeader,
        matchingHeaderColumns: matchingColumns
      });
    } else if (matchingColumns.length > 1) {
      warnings.push({
        code: "DUPLICATE_HEADER_IGNORED",
        field: spec.key,
        column: _masterColumnLetter(index),
        matchingHeaderColumns: matchingColumns
      });
    }

    columns[spec.key] = index;
    resolved[spec.key] = {
      column: _masterColumnLetter(index),
      header: actualHeader,
      source: "fixed",
      headerMatched: headerMatched,
      required: spec.required
    };
  }
  return { columns: columns, resolved: resolved, warnings: warnings, specs: specs };
}

function _masterSheetErrorCode(value) {
  var text = String(value === null || value === undefined ? "" : value).trim().toUpperCase();
  var codes = ["#REF!", "#N/A", "#VALUE!", "#ERROR!", "#NAME?", "#NUM!", "#DIV/0!", "#NULL!"];
  for (var i = 0; i < codes.length; i++) {
    if (text.indexOf(codes[i]) === 0) return codes[i];
  }
  return "";
}

function _masterReceivablesFormulaStats(values, financialFormulas, schema) {
  var requiredByIndex = {};
  for (var i = 0; i < schema.specs.length; i++) {
    var spec = schema.specs[i];
    if (spec.required && schema.columns[spec.key] !== undefined) {
      requiredByIndex[schema.columns[spec.key]] = spec.key;
    }
  }
  var requiredFields = {};
  var requiredErrorCells = 0;
  var financialErrorCells = 0;
  for (var r = 0; r < values.length; r++) {
    if (!String(values[r][schema.columns.party] || "").trim()) continue;
    var formulaRow = financialFormulas[r] || [];
    for (var f = 0; f < formulaRow.length; f++) {
      if (!String(formulaRow[f] || "").trim()) continue;
      var c = 26 + f; // getFormulas batch is AA:AP
      if (!_masterSheetErrorCode(values[r][c])) continue;
      financialErrorCells += 1;
      if (requiredByIndex[c]) {
        requiredErrorCells += 1;
        requiredFields[requiredByIndex[c]] = (requiredFields[requiredByIndex[c]] || 0) + 1;
      }
    }
  }
  return {
    requiredErrorCells: requiredErrorCells,
    requiredFields: requiredFields,
    financialErrorCells: financialErrorCells
  };
}

function _masterReceivablesBaseHealth(schemaWarnings) {
  var warnings = (schemaWarnings || []).slice();
  var copyForwardAvailable = typeof TARGET_SPREADSHEET_ID !== "undefined";
  var idsMatch = copyForwardAvailable ? String(TARGET_SPREADSHEET_ID) === String(MASTER_SHEET_ID) : null;
  if (copyForwardAvailable && !idsMatch) {
    warnings.push({ code: "MASTER_COPY_FORWARD_ID_MISMATCH" });
  }
  return {
    status: warnings.length ? "warning" : "healthy",
    warnings: warnings,
    copyForwardConfigured: copyForwardAvailable,
    idsMatch: idsMatch,
    copyForwardIdSuffix: copyForwardAvailable ? _masterSafeIdSuffix(TARGET_SPREADSHEET_ID) : ""
  };
}

function _buildMasterReceivablesDataset() {
  var totalStartedAt = Date.now();
  var timing = {};
  var stepStartedAt = Date.now();
  var context = _openMasterReceivablesContext();
  timing.open = Date.now() - stepStartedAt;

  stepStartedAt = Date.now();
  var schema = _resolveMasterReceivablesSchema(context.sheet);
  timing.schema = Date.now() - stepStartedAt;
  var sh = context.sheet;
  var rawLastRow = sh.getLastRow();
  var lastColumn = sh.getLastColumn();
  if (rawLastRow > MASTER_RECEIVABLES_MAX_GRID_ROWS) {
    throw _masterReceivablesFailure(
      "SOURCE_GRID_TOO_LARGE",
      "The master receivables sheet exceeds the reviewed row bound.",
      { lastRow: rawLastRow, maxRows: MASTER_RECEIVABLES_MAX_GRID_ROWS }
    );
  }

  var sourceMeta = {
    spreadsheetIdSuffix: _masterSafeIdSuffix(MASTER_SHEET_ID),
    tabName: MASTER_PAAGU_TAB,
    rawLastRow: rawLastRow,
    effectiveLastRow: rawLastRow < 2 ? 1 : 0,
    lastColumn: lastColumn,
    maxColumns: sh.getMaxColumns(),
    rowsRead: 0,
    rowsReturned: 0,
    partyRows: 0,
    invoiceRows: 0,
    skippedNoParty: 0,
    skippedEmpty: 0,
    formulaErrorCells: 0,
    latestInvoiceDate: "",
    resolvedColumns: schema.resolved
  };
  var health = _masterReceivablesBaseHealth(schema.warnings);
  if (rawLastRow < 2) {
    health.warnings.push({ code: "NO_RECEIVABLE_ROWS" });
    health.status = "warning";
    timing.totalBuild = Date.now() - totalStartedAt;
    return {
      rows: [],
      datasetId: _masterReceivablesRequestId(),
      generatedAt: new Date().toISOString(),
      sourceMeta: sourceMeta,
      health: health,
      buildTimingMs: timing
    };
  }

  stepStartedAt = Date.now();
  var partyValues = sh
    .getRange(2, schema.columns.party + 1, rawLastRow - 1, 1)
    .getDisplayValues();
  var lastPartyOffset = -1;
  for (var p = 0; p < partyValues.length; p++) {
    if (String(partyValues[p][0] || "").trim()) lastPartyOffset = p;
  }
  timing.partyScan = Date.now() - stepStartedAt;

  if (lastPartyOffset < 0) {
    health.warnings.push({ code: "NO_PARTY_ROWS" });
    health.status = "warning";
    timing.totalBuild = Date.now() - totalStartedAt;
    return {
      rows: [],
      datasetId: _masterReceivablesRequestId(),
      generatedAt: new Date().toISOString(),
      sourceMeta: sourceMeta,
      health: health,
      buildTimingMs: timing
    };
  }

  var effectiveLastRow = lastPartyOffset + 2;
  var dataRows = effectiveLastRow - 1;
  sourceMeta.effectiveLastRow = effectiveLastRow;
  if (dataRows > MASTER_RECEIVABLES_MAX_DATA_ROWS) {
    throw _masterReceivablesFailure(
      "SOURCE_DATA_TOO_LARGE",
      "The master receivables dataset exceeds the reviewed row bound.",
      { meaningfulRows: dataRows, maxRows: MASTER_RECEIVABLES_MAX_DATA_ROWS }
    );
  }
  if (rawLastRow > effectiveLastRow) {
    health.warnings.push({
      code: "TRAILING_FORMULA_ROWS_IGNORED",
      rows: rawLastRow - effectiveLastRow
    });
    health.status = "warning";
  }

  stepStartedAt = Date.now();
  var values = sh.getRange(2, 1, dataRows, 42).getValues(); // A..AP, bounded above
  timing.sheetRead = Date.now() - stepStartedAt;
  sourceMeta.rowsRead = values.length;

  stepStartedAt = Date.now();
  var financialFormulas = sh.getRange(2, 27, dataRows, 16).getFormulas(); // AA..AP only
  timing.formulaRead = Date.now() - stepStartedAt;
  var formulaStats = _masterReceivablesFormulaStats(values, financialFormulas, schema);
  sourceMeta.formulaErrorCells = formulaStats.financialErrorCells;
  if (formulaStats.requiredErrorCells > 0) {
    throw _masterReceivablesFailure(
      "MASTER_FORMULA_ERRORS",
      "Required receivables columns contain formula errors.",
      {
        errorCells: formulaStats.requiredErrorCells,
        fields: Object.keys(formulaStats.requiredFields)
      }
    );
  }
  if (formulaStats.financialErrorCells > 0) {
    health.warnings.push({
      code: "OPTIONAL_FINANCIAL_FORMULA_ERRORS",
      cells: formulaStats.financialErrorCells
    });
    health.status = "warning";
  }

  stepStartedAt = Date.now();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var party = String(r[schema.columns.party] || "").trim();
    if (!party) {
      sourceMeta.skippedNoParty += 1;
      continue;
    }
    sourceMeta.partyRows += 1;
    var orderId = String(r[schema.columns.orderId] || "").trim(); // backward-compatible
    var paaguId = String(r[schema.columns.paaguId] || "").trim();
    var customerName = String(r[schema.columns.customerName] || "").trim();
    var loadedLoom = String(r[schema.columns.loadedLoom] || "").trim();
    var pending = Number(r[schema.columns.pendingBalance]) || 0;
    var invoiceAmount = Number(r[schema.columns.invoiceAmount]) || 0;
    var invoiceNumber = String(r[schema.columns.invoiceNumber] || "").trim();
    if (!invoiceNumber && !pending && !invoiceAmount && !customerName && !paaguId) {
      sourceMeta.skippedEmpty += 1;
      continue;
    }
    if (invoiceNumber) sourceMeta.invoiceRows += 1;
    var invoiceDate = r[schema.columns.invoiceDate]
      ? _ymd(_toDate(r[schema.columns.invoiceDate]) || new Date(r[schema.columns.invoiceDate]))
      : "";
    if (invoiceDate && invoiceDate > sourceMeta.latestInvoiceDate) {
      sourceMeta.latestInvoiceDate = invoiceDate;
    }
    out.push({
      orderId: orderId,
      paaguId: paaguId,
      customerName: customerName,
      loadedLoom: loadedLoom,
      designDetails: customerName,
      loomNumber: loadedLoom,
      status: String(r[schema.columns.status] || ""),
      invoiceAmount: invoiceAmount,
      invoiceNumber: invoiceNumber,
      invoiceDate: invoiceDate,
      dueDate: r[schema.columns.dueDate]
        ? _ymd(_toDate(r[schema.columns.dueDate]) || new Date(r[schema.columns.dueDate]))
        : "",
      receipts: Number(r[schema.columns.receipts]) || 0,
      receivedOn: r[schema.columns.receivedOn]
        ? _ymd(_toDate(r[schema.columns.receivedOn]) || new Date(r[schema.columns.receivedOn]))
        : "",
      paymentStatus: String(r[schema.columns.paymentStatus] || "").trim(),
      pendingBalance: pending,
      party: party
    });
  }
  timing.normalize = Date.now() - stepStartedAt;
  sourceMeta.rowsReturned = out.length;
  if (!out.length) {
    health.warnings.push({ code: "NO_RECEIVABLE_ROWS" });
    health.status = "warning";
  }
  timing.totalBuild = Date.now() - totalStartedAt;
  return {
    rows: out,
    datasetId: _masterReceivablesRequestId(),
    generatedAt: new Date().toISOString(),
    sourceMeta: sourceMeta,
    health: health,
    buildTimingMs: timing
  };
}

// Compatibility wrapper used by the daily Partner digest. It receives the
// same normalized rows as the web endpoint and shares its short server cache.
function _readMasterReceivables() {
  return _loadMasterReceivablesDataset({ useCache: true, fresh: false }).rows;
}

function _latestMasterProductionDateHealth(spreadsheet) {
  var sh = spreadsheet.getSheetByName(MASTER_PRODUCTION_TAB);
  if (!sh) return { latestDate: "", rowsChecked: 0, literalDateRows: 0, ignoredFormulaRows: 0 };
  var last = sh.getLastRow();
  if (last < 2) return { latestDate: "", rowsChecked: 0, literalDateRows: 0, ignoredFormulaRows: 0 };
  if (last > MASTER_PRODUCTION_MAX_GRID_ROWS) {
    return {
      latestDate: "",
      rowsChecked: 0,
      literalDateRows: 0,
      ignoredFormulaRows: 0,
      error: "MASTER_PRODUCTION_GRID_TOO_LARGE"
    };
  }
  var count = last - 1;
  var dateRange = sh.getRange(2, 1, count, 1);
  var values = dateRange.getValues();
  var formulas = dateRange.getFormulas();
  var latest = "";
  var latestMs = 0;
  var literalDateRows = 0;
  var ignoredFormulaRows = 0;
  for (var i = 0; i < values.length; i++) {
    if (formulas[i] && String(formulas[i][0] || "").trim()) {
      ignoredFormulaRows += 1;
      continue;
    }
    var d = _toDate(values[i][0]);
    if (d) {
      literalDateRows += 1;
      if (d.getTime() <= latestMs) continue;
      latestMs = d.getTime();
      latest = _ymd(d);
    }
  }
  return {
    latestDate: latest,
    rowsChecked: count,
    literalDateRows: literalDateRows,
    ignoredFormulaRows: ignoredFormulaRows
  };
}

function _masterWorkbookLayoutHealth(spreadsheet) {
  var requiredTabs = [
    MASTER_PRODUCTION_TAB,
    MASTER_ORDER_TAB,
    MASTER_PAAGU_TAB,
    MASTER_CASHFLOW_TAB,
    MASTER_CAPEX_TAB
  ];
  var tabs = {};
  var errors = [];
  for (var i = 0; i < requiredTabs.length; i++) {
    var tabName = requiredTabs[i];
    tabs[tabName] = !!spreadsheet.getSheetByName(tabName);
    if (!tabs[tabName]) errors.push({ code: "REQUIRED_TAB_MISSING", tab: tabName });
  }

  var productionSheet = spreadsheet.getSheetByName(MASTER_PRODUCTION_TAB);
  var productionLayout = null;
  var productionDates = { latestDate: "", rowsChecked: 0, literalDateRows: 0, ignoredFormulaRows: 0 };
  if (productionSheet) {
    productionLayout = {
      maxColumns: productionSheet.getMaxColumns(),
      rawLastRow: productionSheet.getLastRow(),
      dateHeader: String(productionSheet.getRange(1, 1).getDisplayValue() || "")
    };
    if (productionLayout.maxColumns < 15) {
      errors.push({
        code: "MASTER_PRODUCTION_GRID_TOO_NARROW",
        tab: MASTER_PRODUCTION_TAB,
        maxColumns: productionLayout.maxColumns,
        requiredColumns: 15
      });
    }
    if (_masterHeaderKey(productionLayout.dateHeader) !== "date") {
      errors.push({
        code: "MASTER_PRODUCTION_SCHEMA_MISMATCH",
        tab: MASTER_PRODUCTION_TAB,
        expectedColumn: "A",
        expectedHeader: "Date"
      });
    }
    if (productionLayout.rawLastRow > MASTER_PRODUCTION_MAX_GRID_ROWS) {
      errors.push({
        code: "MASTER_PRODUCTION_GRID_TOO_LARGE",
        tab: MASTER_PRODUCTION_TAB,
        lastRow: productionLayout.rawLastRow,
        maxRows: MASTER_PRODUCTION_MAX_GRID_ROWS
      });
    } else {
      productionDates = _latestMasterProductionDateHealth(spreadsheet);
    }
  }

  var cashflowSheet = spreadsheet.getSheetByName(MASTER_CASHFLOW_TAB);
  var cashflowLayout = null;
  if (cashflowSheet) {
    cashflowLayout = {
      maxColumns: cashflowSheet.getMaxColumns(),
      maxRows: cashflowSheet.getMaxRows()
    };
    if (cashflowLayout.maxColumns < 20) {
      errors.push({
        code: "MASTER_CASHFLOW_GRID_TOO_NARROW",
        tab: MASTER_CASHFLOW_TAB,
        maxColumns: cashflowLayout.maxColumns,
        requiredColumns: 20
      });
    }
    if (cashflowLayout.maxRows < CF_LEDGER_START_ROW) {
      errors.push({
        code: "MASTER_CASHFLOW_LAYOUT_TOO_SHORT",
        tab: MASTER_CASHFLOW_TAB,
        maxRows: cashflowLayout.maxRows,
        requiredRows: CF_LEDGER_START_ROW
      });
    }
  }

  var capexSheet = spreadsheet.getSheetByName(MASTER_CAPEX_TAB);
  var capexLayout = null;
  if (capexSheet) {
    capexLayout = { maxColumns: capexSheet.getMaxColumns() };
    if (capexLayout.maxColumns < CAPEX_WIDTH) {
      errors.push({
        code: "MASTER_CAPEX_GRID_TOO_NARROW",
        tab: MASTER_CAPEX_TAB,
        maxColumns: capexLayout.maxColumns,
        requiredColumns: CAPEX_WIDTH
      });
    }
  }

  return {
    requiredTabs: tabs,
    errors: errors,
    production: productionDates,
    layouts: {
      production: productionLayout,
      cashflow: cashflowLayout,
      capex: capexLayout
    }
  };
}

function _masterWorkbookHealthResponse(e) {
  var startedAt = Date.now();
  var requestId = _masterReceivablesRequestId();
  try {
    var query = _parseMasterReceivablesQuery(e);
    var dataset = _loadMasterReceivablesDataset({ useCache: true, fresh: query.fresh });
    var openStartedAt = Date.now();
    var spreadsheet;
    try {
      spreadsheet = SpreadsheetApp.openById(MASTER_SHEET_ID);
    } catch (openErr) {
      throw _masterReceivablesFailure(
        "MASTER_WORKBOOK_ACCESS",
        "The master workbook could not be opened. Check its ID and deployment-account access."
      );
    }
    var healthOpenMs = Date.now() - openStartedAt;
    var layoutStartedAt = Date.now();
    var layout = _masterWorkbookLayoutHealth(spreadsheet);
    var layoutMs = Date.now() - layoutStartedAt;
    var errors = layout.errors;
    var warnings = (dataset.health.warnings || []).slice();
    var production = layout.production;
    var productionLayoutInvalid = false;
    for (var i = 0; i < errors.length; i++) {
      if (String(errors[i].code || "").indexOf("MASTER_PRODUCTION_") === 0) {
        productionLayoutInvalid = true;
        break;
      }
    }
    if (!production.latestDate && !productionLayoutInvalid) {
      warnings.push({ code: "PRODUCTION_DATE_UNAVAILABLE" });
    }
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var latestProductionDate = production.latestDate ? _ymdToDate(production.latestDate) : null;
    if (
      production.latestDate &&
      latestProductionDate &&
      Math.floor((today.getTime() - latestProductionDate.getTime()) / 86400000) > 3
    ) {
      warnings.push({ code: "PRODUCTION_DATA_STALE", latestDate: production.latestDate });
    }

    var health = {
      status: errors.length ? "unhealthy" : warnings.length ? "warning" : "healthy",
      errors: errors,
      warnings: warnings,
      spreadsheetIdSuffix: _masterSafeIdSuffix(MASTER_SHEET_ID),
      copyForwardConfigured: dataset.health.copyForwardConfigured,
      copyForwardIdSuffix: dataset.health.copyForwardIdSuffix,
      idsMatch: dataset.health.idsMatch,
      requiredTabs: layout.requiredTabs,
      layouts: layout.layouts,
      latestProductionDate: production.latestDate,
      productionRowsChecked: production.rowsChecked,
      productionLiteralDateRows: production.literalDateRows,
      productionFormulaRowsIgnored: production.ignoredFormulaRows,
      receivables: {
        tabName: dataset.sourceMeta.tabName,
        rawLastRow: dataset.sourceMeta.rawLastRow,
        effectiveLastRow: dataset.sourceMeta.effectiveLastRow,
        rowsRead: dataset.sourceMeta.rowsRead,
        rowsReturned: dataset.sourceMeta.rowsReturned,
        partyRows: dataset.sourceMeta.partyRows,
        invoiceRows: dataset.sourceMeta.invoiceRows,
        formulaErrorCells: dataset.sourceMeta.formulaErrorCells,
        latestInvoiceDate: dataset.sourceMeta.latestInvoiceDate,
        resolvedColumns: dataset.sourceMeta.resolvedColumns
      }
    };
    var healthOk = errors.length === 0;
    var totalMs = Date.now() - startedAt;
    _masterReceivablesLog({
      event: "master-health",
      requestId: requestId,
      ok: healthOk,
      status: health.status,
      errorCount: errors.length,
      warningCount: warnings.length,
      totalMs: totalMs
    });
    var response = {
      ok: healthOk,
      health: health,
      meta: {
        apiVersion: MASTER_RECEIVABLES_API_VERSION,
        schemaVersion: MASTER_RECEIVABLES_SCHEMA_VERSION,
        requestId: requestId,
        datasetId: dataset.datasetId,
        generatedAt: dataset.generatedAt,
        servedAt: new Date().toISOString(),
        cache: dataset.cache,
        timingMs: {
          healthOpen: healthOpenMs,
          layoutChecks: layoutMs,
          total: totalMs
        }
      }
    };
    if (!healthOk) {
      response.error = "MASTER_HEALTH_FAILED";
      response.message = "The master workbook is missing a required tab or layout.";
    }
    return response;
  } catch (err) {
    return _masterReceivablesErrorResponse(err, requestId, startedAt);
  }
}

// Read-only editor diagnostic for monthly rollover. It never writes to Sheets.
function diagnoseMasterWorkbook() {
  var result = _masterWorkbookHealthResponse({ parameter: { fresh: "1" } });
  Logger.log(JSON.stringify(result));
  return result;
}

// Authenticated deployment diagnostic for monthly rollover. WEB_APP_URL must
// be the exact production /exec URL used by the frontend. This avoids
// ScriptApp.getService().getUrl() selecting a different/restricted deployment
// when a project has multiple web-app deployments. API_TOKEN stays in the POST
// body and is never placed in a URL or written to the execution log.
function diagnoseDeployedMasterHealth() {
  var scriptProperties = PropertiesService.getScriptProperties();
  var webAppUrl = String(scriptProperties.getProperty("WEB_APP_URL") || "").trim();
  var token = String(scriptProperties.getProperty("API_TOKEN") || "");
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/i.test(webAppUrl)) {
    throw new Error("Set WEB_APP_URL to the exact production Apps Script /exec URL before running the deployed health check.");
  }
  if (!token) {
    throw new Error("Set API_TOKEN before running the authenticated deployment health check.");
  }

  var deploymentIdMatch = webAppUrl.match(/\/s\/([^/]+)\/exec$/i);
  var deploymentId = deploymentIdMatch ? deploymentIdMatch[1] : "";

  var response = UrlFetchApp.fetch(webAppUrl, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ kind: "master-health", fresh: true, token: token }),
    followRedirects: true,
    muteHttpExceptions: true
  });
  var httpStatus = response.getResponseCode();
  var result;
  try {
    result = JSON.parse(response.getContentText());
  } catch (parseErr) {
    result = { ok: false, error: "NON_JSON_HEALTH_RESPONSE" };
  }
  Logger.log(JSON.stringify({
    event: "deployed-master-health",
    deploymentIdSuffix: _masterSafeIdSuffix(deploymentId),
    httpStatus: httpStatus,
    ok: result.ok === true,
    error: result.error || "",
    health: result.health || null,
    meta: result.meta || null
  }));
  if (httpStatus < 200 || httpStatus >= 300 || result.ok !== true) {
    if (httpStatus === 401) {
      throw new Error("The WEB_APP_URL deployment returned HTTP 401; verify that it is the app's public /exec deployment.");
    }
    throw new Error("Deployed master health check failed; review the sanitized execution log.");
  }
  return result;
}

function _normEff(v) {
  // Sheet may store either 0.81 or 81 or "81%". Normalize to a 0..1 fraction.
  if (v === null || v === "" || v === undefined) return 0;
  if (typeof v === "number") return v > 1.5 ? v / 100 : v;
  var s = String(v).replace("%", "").trim();
  var n = parseFloat(s);
  if (isNaN(n)) return 0;
  return n > 1.5 ? n / 100 : n;
}

function _ymdToDate(s) {
  var p = String(s).split("-");
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

/* ------------------------------ master workbook · cashflow ------------------------------ */

function _cashflowSheet() {
  return _requiredMasterSheet(MASTER_CASHFLOW_TAB, 20);
}

function _readCashflow(sheet) {
  var sh = sheet || _cashflowSheet();

  // One row read covers all five closing balances (E:O).
  var closing = sh
    .getRange(CF_ROW_CLOSING, CF_COL_TMB_CREDIT, 1, CF_COL_IOB_CC_INTEREST - CF_COL_TMB_CREDIT + 1)
    .getValues()[0];
  var tmb         = Number(closing[CF_COL_TMB - CF_COL_TMB_CREDIT])        || 0;
  var iobCa       = Number(closing[CF_COL_IOB_CA - CF_COL_TMB_CREDIT])     || 0;
  var cashbookApp = Number(closing[CF_COL_CASHBOOK - CF_COL_TMB_CREDIT])  || 0;
  var cash        = Number(closing[CF_COL_CASH - CF_COL_TMB_CREDIT])      || 0;
  var iobCcRaw    = Number(closing[CF_COL_IOB_CC - CF_COL_TMB_CREDIT])     || 0;
  var iobCcUsed   = Math.abs(iobCcRaw);
  var iobCcAvailable = Math.max(0, CF_IOB_CC_LIMIT - iobCcUsed);
  var totalAvailable = tmb + iobCa + cashbookApp + cash + iobCcAvailable;

  // R3:T3 is contiguous, so fetch the monthly summary in one call.
  var monthlySummary = sh.getRange(3, 18, 1, 3).getValues()[0];
  var opInflow      = Number(monthlySummary[0]) || 0;
  var opOutflowVal  = Number(monthlySummary[1]) || 0;
  var opOutflow     = opOutflowVal > 0 ? -opOutflowVal : opOutflowVal; // ensure negative
  var opCashflowNet = Number(monthlySummary[2]);
  if (!isFinite(opCashflowNet)) opCashflowNet = opInflow + opOutflow;

  // Read A:O once. The same rows provide both current-month CC withdrawals and
  // the most recent ledger date used by the summary.
  var ccDrawn = 0;
  var lastRow = sh.getLastRow();
  var ledgerValues = [];
  if (lastRow >= CF_LEDGER_START_ROW) {
    var n = lastRow - CF_LEDGER_START_ROW + 1;
    ledgerValues = sh.getRange(CF_LEDGER_START_ROW, 1, n, CF_LEDGER_WIDTH).getValues();
  }

  var lastEntry = "";
  var maxMs = 0;
  var nowD = new Date();
  var curY = nowD.getFullYear();
  var curM = nowD.getMonth();
  for (var i = 0; i < ledgerValues.length; i++) {
    var d = _toDate(ledgerValues[i][CF_LEDGER_DATE_COL - 1]);
    if (!d) continue;
    if (d.getTime() > maxMs) maxMs = d.getTime();
    if (d.getFullYear() === curY && d.getMonth() === curM) {
      var ccValue = Number(ledgerValues[i][CF_COL_IOB_CC_DRAWN - 1]);
      if (ccValue && !isNaN(ccValue)) ccDrawn += Math.abs(ccValue);
    }
  }
  if (maxMs) lastEntry = _ymd(new Date(maxMs));
  if (!lastEntry) lastEntry = _ymd(new Date());
  var asOfDate = lastEntry;

  var monthLabel = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMM yyyy");

  return {
    asOfDate: asOfDate,
    lastEntryDate: lastEntry,
    monthLabel: monthLabel,
    balances: {
      tmb: tmb,
      iobCa: iobCa,
      cashbookApp: cashbookApp,
      cash: cash,
      iobCcUsed: iobCcUsed,
      iobCcLimit: CF_IOB_CC_LIMIT,
      iobCcAvailable: iobCcAvailable
    },
    totalAvailable: totalAvailable,
    month: {
      opInflow: opInflow,
      opOutflow: opOutflow,
      opCashflowNet: opCashflowNet,
      ccDrawnThisMonth: ccDrawn
    }
  };
}

function _readCashLedger(fromYmd, toYmd, accountKey, direction, sheet) {
  var sh = sheet || _cashflowSheet();
  var last = sh.getLastRow();
  if (last < CF_LEDGER_START_ROW) return [];

  var values = sh.getRange(CF_LEDGER_START_ROW, 1, last - CF_LEDGER_START_ROW + 1, CF_LEDGER_WIDTH).getValues();
  var fromMs = fromYmd ? _ymdToDate(fromYmd).getTime() : 0;
  var toMs   = toYmd   ? _ymdToDate(toYmd).getTime() + 86399000 : Date.now();

  // Each account contributes one or two columns in the row.
  // Inflow/outflow are kept as separate sources so we can sign them correctly.
  // For CC: drawing from the CC to pay an expense (M) is cash OUT; a credit into
  // the CC — e.g. a bill collection that pays it down (N) — is cash IN; interest (O) is OUT.
  var SOURCES = [
    { key: "tmb",         col: CF_COL_TMB_CREDIT - 1,      sign:  1, kind: "credit" },
    { key: "tmb",         col: CF_COL_TMB_DEBIT - 1,       sign: -1, kind: "debit"  },
    { key: "iobCa",       col: CF_COL_IOB_CA_CREDIT - 1,   sign:  1, kind: "credit" },
    { key: "iobCa",       col: CF_COL_IOB_CA_DEBIT - 1,    sign: -1, kind: "debit"  },
    { key: "cashbookApp", col: CF_COL_CASHBOOK_CREDIT - 1, sign:  1, kind: "credit" },
    { key: "cashbookApp", col: CF_COL_CASHBOOK_DEBIT - 1,  sign: -1, kind: "debit"  },
    { key: "cash",        col: CF_COL_CASH_CREDIT - 1,     sign:  1, kind: "credit" },
    { key: "cash",        col: CF_COL_CASH_DEBIT - 1,      sign: -1, kind: "debit"  },
    { key: "iobCc",       col: CF_COL_IOB_CC_DRAWN - 1,    sign: -1, kind: "spend" },
    { key: "iobCc",       col: CF_COL_IOB_CC_REPAY - 1,    sign:  1, kind: "credit"  },
    { key: "iobCc",       col: CF_COL_IOB_CC_INTEREST - 1, sign: -1, kind: "interest" }
  ];

  var out = [];
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var d = _toDate(r[CF_LEDGER_DATE_COL - 1]);
    if (!d) continue;
    var t = d.getTime();
    if (t < fromMs || t > toMs) continue;

    var desc = String(r[CF_LEDGER_DESC_COL - 1] || "").trim();
    var typeRaw = String(r[CF_LEDGER_TYPE_COL - 1] || "").trim();
    var typeNorm = typeRaw.toLowerCase();
    var isInternal = typeNorm.indexOf("internal") >= 0;
    var cat  = String(r[CF_LEDGER_CAT_COL - 1] || "").trim();

    for (var a = 0; a < SOURCES.length; a++) {
      var src = SOURCES[a];
      var amtRaw = r[src.col];
      if (amtRaw === "" || amtRaw === null || amtRaw === undefined) continue;
      var mag = Math.abs(Number(amtRaw));
      if (!mag || isNaN(mag)) continue;
      var amt = mag * src.sign;

      if (accountKey && accountKey !== src.key) continue;
      if (direction === "in")  { if (amt <= 0 || isInternal) continue; }
      if (direction === "out") { if (amt >= 0 || isInternal) continue; }

      var entry = {
        date: _ymd(d),
        description: desc,
        account: src.key,
        amount: amt,
        kind: src.kind,
        type: typeRaw,
        internal: isInternal
      };
      if (cat) entry.category = cat;
      out.push(entry);
    }
  }

  out.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  return out;
}

/* ------------------------------ master workbook · capex (New Shed) ------------------------------ */

function _capexSheet() {
  return _requiredMasterSheet(MASTER_CAPEX_TAB, CAPEX_WIDTH);
}

function _readCapex(projectFilter) {
  var empty = { project: projectFilter, total: 0, count: 0, byFunding: {}, byExpense: {}, byPaidFrom: {}, rows: [] };
  var sh = _capexSheet();
  var last = sh.getLastRow();
  if (last < 1) return empty;

  var values = sh.getRange(1, 1, last, CAPEX_WIDTH).getValues();
  var key = String(projectFilter || "").trim().toLowerCase();

  var rows = [];
  var total = 0;
  var byFunding = {};
  var byExpense = {};
  var byPaidFrom = {};

  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var d = _toDate(r[CAPEX_COL_DATE - 1]);
    if (!d) continue; // skip Total / header / blank rows
    var project = String(r[CAPEX_COL_PROJECT - 1] || "").trim();
    if (key && project.toLowerCase().indexOf(key) === -1) continue;
    var amt = Number(r[CAPEX_COL_AMOUNT - 1]) || 0;
    if (!amt) continue;

    var expense  = String(r[CAPEX_COL_EXPENSE - 1] || "").trim();
    var vendor   = String(r[CAPEX_COL_VENDOR - 1] || "").trim();
    var paidFrom = String(r[CAPEX_COL_PAID_FROM - 1] || "").trim();
    var funding  = String(r[CAPEX_COL_FUNDING - 1] || "").trim();

    rows.push({
      date: _ymd(d),
      project: project,
      expense: expense,
      vendor: vendor,
      amount: amt,
      paidFrom: paidFrom,
      fundingSource: funding
    });
    total += amt;
    if (funding)  byFunding[funding]   = (byFunding[funding]   || 0) + amt;
    if (expense)  byExpense[expense]   = (byExpense[expense]   || 0) + amt;
    if (paidFrom) byPaidFrom[paidFrom] = (byPaidFrom[paidFrom] || 0) + amt;
  }

  rows.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });

  return {
    project: projectFilter,
    total: total,
    count: rows.length,
    byFunding: byFunding,
    byExpense: byExpense,
    byPaidFrom: byPaidFrom,
    rows: rows
  };
}

/* ------------------------------ beam register ------------------------------ */
/**
 * Reads the four beam tables from the "R.O STATUS" tab and returns them raw.
 * The front-end normaliser collapses them into one beam list, resolves
 * conflicts, and infers ready-beam ids by elimination — so this stays "dumb"
 * and just locates each block by its header text (robust to the sheet's exact
 * row/column layout, which is hand-maintained).
 *
 *   loaded : LOOM NO · in SAT(=design) · Beam NO
 *   vendor : OUT SIDE(=warping vendor) · Beam NO
 *   ready  : LOAD WARP IN SAT(=design) · MTRS · BEAM NO (usually blank)
 *   empty  : EMPTY BEAM
 *   master : <beam id> · <location: "in SAT" | vendor>   (scanned by pattern)
 */
function _readBeams() {
  try {
    var ss = SpreadsheetApp.openById(BEAM_SHEET_ID);
    var sh = ss.getSheetByName(BEAM_TAB);
    if (!sh) return _json({ ok: false, error: "tab not found: " + BEAM_TAB });
    var g = sh.getDataRange().getValues();

    var norm = function (v) { return String(v == null ? "" : v).trim(); };
    var low = function (v) { return norm(v).toLowerCase(); };
    var isBeamId = function (v) {
      var s = norm(v);
      return /^\d+$/.test(s) || /^vvk[\s-]*\d+$/i.test(s);
    };
    var isInSat = function (v) { return /^in\s*sat$/i.test(norm(v)); };

    // Locate a header row+columns by matching label predicates within one row.
    var findHeader = function (labels) {
      for (var r = 0; r < g.length; r++) {
        var cols = {};
        var hit = 0;
        for (var c = 0; c < g[r].length; c++) {
          var cell = low(g[r][c]);
          for (var k in labels) {
            if (cols[k] == null && labels[k].test(cell)) { cols[k] = c; hit++; }
          }
        }
        var need = 0; for (var kk in labels) need++;
        if (hit === need) return { row: r, cols: cols };
      }
      return null;
    };

    var loaded = [];
    var hl = findHeader({ loom: /^loom\s*no$/, design: /^in\s*sat$/, beam: /^beam\s*no$/ });
    if (hl) {
      for (var r1 = hl.row + 1; r1 < g.length; r1++) {
        var lm = norm(g[r1][hl.cols.loom]);
        var bd = norm(g[r1][hl.cols.beam]);
        if (!lm && !bd) break;
        if (!bd) continue;
        loaded.push({ loom: lm, design: norm(g[r1][hl.cols.design]), beamNo: bd });
      }
    }

    var vendor = [];
    var hv = findHeader({ out: /^out\s*side$/ });
    if (hv) {
      // The tab lays several tables side by side, so a single header row can
      // hold more than one "Beam NO". This table's Beam NO is the first one to
      // the RIGHT of its OUT SIDE column (S.NO · OUT SIDE · Beam NO).
      var vbeam = -1;
      for (var vc = hv.cols.out + 1; vc < g[hv.row].length; vc++) {
        if (/^beam\s*no$/.test(low(g[hv.row][vc]))) { vbeam = vc; break; }
      }
      if (vbeam >= 0) {
        for (var r2 = hv.row + 1; r2 < g.length; r2++) {
          var vn = norm(g[r2][hv.cols.out]);
          var vb = norm(g[r2][vbeam]);
          if (!vn && !vb) break;
          if (!vb) continue;
          vendor.push({ vendor: vn, beamNo: vb });
        }
      }
    }

    var ready = [];
    var hr = findHeader({ design: /^load\s*warp\s*in\s*sat$/, mtrs: /^mtrs$/ });
    if (hr) {
      var rbeam = hr.cols.beam != null ? hr.cols.beam : null;
      for (var r3 = hr.row + 1; r3 < g.length; r3++) {
        var rd = norm(g[r3][hr.cols.design]);
        if (!rd) {
          // stop only after a run of blanks; tolerate the trailing empty rows
          var aheadBlank = !norm(g[r3 + 1] ? g[r3 + 1][hr.cols.design] : "");
          if (aheadBlank) break; else continue;
        }
        var mtr = Number(g[r3][hr.cols.mtrs]);
        ready.push({
          design: rd,
          meters: isFinite(mtr) && mtr > 0 ? mtr : null,
          beamNo: rbeam != null ? norm(g[r3][rbeam]) : ""
        });
      }
    }

    var empty = [];
    var he = findHeader({ eb: /^empty\s*beam$/ });
    if (he) {
      for (var r4 = he.row + 1; r4 < g.length; r4++) {
        var eb = norm(g[r4][he.cols.eb]);
        if (!eb) {
          var nextBlank = !norm(g[r4 + 1] ? g[r4 + 1][he.cols.eb] : "");
          if (nextBlank) break; else continue;
        }
        empty.push({ beamNo: eb });
      }
    }

    // Master list — the full universe of assets, headed "BEAM NO · BEAM AT".
    // Anchor on the "BEAM AT" column (unique to this table) and take the
    // "Beam NO" column immediately to its left, so the side-by-side S.NO
    // columns of the other tables are never misread as beam ids.
    var master = [];
    var hmst = findHeader({ at: /^beam\s*at$/ });
    if (hmst) {
      var mbeam = -1;
      for (var mc = hmst.cols.at - 1; mc >= 0; mc--) {
        if (/^beam\s*no$/.test(low(g[hmst.row][mc]))) { mbeam = mc; break; }
      }
      if (mbeam >= 0) {
        for (var mr = hmst.row + 1; mr < g.length; mr++) {
          var mb = norm(g[mr][mbeam]);
          var ml = norm(g[mr][hmst.cols.at]);
          if (!mb && !ml) {
            var nb = norm(g[mr + 1] ? g[mr + 1][mbeam] : "");
            if (!nb) break; else continue;
          }
          if (!mb) continue;
          master.push({ beamNo: mb, location: ml });
        }
      }
    }

    return _json({ ok: true, loaded: loaded, vendor: vendor, ready: ready, empty: empty, master: master });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

/* ------------------------------ design capture (Drive + Gemini) ------------------------------ */

// Get-or-create the shared Drive folder that holds captured design photos.
function _designImageFolder() {
  var it = DriveApp.getFoldersByName(DESIGN_IMG_FOLDER);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(DESIGN_IMG_FOLDER);
}

// Store one captured photo in Drive and return a public-by-link view URL.
// Payload: { dataBase64, mimeType, filename? }
function _saveDesignImage(p) {
  try {
    var b64 = String(p.dataBase64 || "");
    if (!b64) return _json({ ok: false, error: "no image data" });
    var mime = String(p.mimeType || "image/jpeg");
    var name = String(p.filename || "design-" + Date.now() + ".jpg");
    var bytes = Utilities.base64Decode(b64);
    var blob = Utilities.newBlob(bytes, mime, name);
    var file = _designImageFolder().createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var id = file.getId();
    return _json({ ok: true, id: id, url: "https://drive.google.com/uc?id=" + id });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

var _DESIGN_PROMPT =
  "You are reading a power-loom design / loom-setup sheet for a cotton weaving unit. " +
  "The photo may be a handwritten or printed sheet, often in Tamil and English mixed. " +
  "Extract the construction details into a single JSON object. Do NOT invent values: " +
  "if a field is not clearly visible, return an empty string for it (or omit warp/weft bands you cannot read). " +
  "Return ONLY the JSON object, no markdown, no commentary.\n\n" +
  "JSON shape (all fields optional, use the exact keys):\n" +
  "{\n" +
  '  "designNo": string, "designName": string, "sourceFirm": string, "weaveType": string,\n' +
  '  "reed": string, "reedOrder": string, "pickPPI": string, "warpCount": string, "weftCount": string,\n' +
  '  "warpWidthIn": string, "clothWidthIn": string, "totalEnds": number, "composition": string,\n' +
  '  "constructionRaw": string, "repeatEnds": number, "noOfRepeat": number, "extraEnds": number,\n' +
  '  "totalShafts": number, "totalPicks": number,\n' +
  '  "warp": [ { "count": string, "colour": string, "layer": string, "ends": number, "extra": number } ],\n' +
  '  "weft": [ { "count": string, "colour": string, "picks": number, "extra": number } ],\n' +
  '  "rawText": string,\n' +
  '  "confidence": number,\n' +
  '  "lowConfidenceFields": [ string ]\n' +
  "}\n\n" +
  "Notes: reed may contain fractions like 65 1/2 — keep it as text. Keep colour names as written. " +
  "ends/picks/extra are whole numbers per band. confidence is 0..1 overall. " +
  "lowConfidenceFields lists field names you are unsure about. " +
  "rawText is your best transcription of the whole sheet.";

// Run Gemini over one or more captured photos and return a draft DesignPayload.
// Payload: { images: [ { dataBase64, mimeType } ], hint? }
function _extractDesign(p) {
  if (!GEMINI_API_KEY) return _json({ ok: false, error: "GEMINI_API_KEY not set" });
  var images = Array.isArray(p.images) ? p.images : [];
  if (images.length === 0) return _json({ ok: false, error: "no images" });

  var parts = [{ text: _DESIGN_PROMPT + (p.hint ? "\n\nOperator hint: " + String(p.hint) : "") }];
  for (var i = 0; i < images.length; i++) {
    var img = images[i] || {};
    if (!img.dataBase64) continue;
    parts.push({
      inline_data: { mime_type: String(img.mimeType || "image/jpeg"), data: String(img.dataBase64) },
    });
  }

  var body = {
    contents: [{ role: "user", parts: parts }],
    generationConfig: { temperature: 0, response_mime_type: "application/json" },
  };

  try {
    var url = "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL +
      ":generateContent?key=" + encodeURIComponent(GEMINI_API_KEY);
    var resp = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    var code = resp.getResponseCode();
    if (code < 200 || code >= 300) {
      return _json({ ok: false, error: "gemini http " + code, detail: resp.getContentText().slice(0, 400) });
    }
    var data = JSON.parse(resp.getContentText());
    var text = "";
    try { text = data.candidates[0].content.parts[0].text || ""; } catch (e2) { text = ""; }
    if (!text) return _json({ ok: false, error: "empty gemini response" });

    var draft;
    try { draft = JSON.parse(text); }
    catch (e3) {
      var m = text.match(/\{[\s\S]*\}/);
      if (!m) return _json({ ok: false, error: "gemini did not return json" });
      draft = JSON.parse(m[0]);
    }
    return _json({ ok: true, draft: draft });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

/* ------------------------------ helpers ------------------------------ */

function _json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function _toDate(v) {
  if (v instanceof Date) return v;
  if (!v) return null;
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function _ymd(d) {
  if (!(d instanceof Date)) d = _toDate(d);
  if (!d) return "";
  var m = d.getMonth() + 1, day = d.getDate();
  return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
}
function _daysAgo(n) { var d = new Date(); d.setDate(d.getDate() - n); d.setHours(0,0,0,0); return d; }
function _inr(n) {
  n = Math.round(Number(n) || 0);
  var sign = n < 0 ? "-" : "";
  n = Math.abs(n);
  var s = String(n);
  var last3 = s.length > 3 ? s.slice(-3) : s;
  var rest = s.length > 3 ? s.slice(0, -3) : "";
  if (rest) {
    rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    last3 = "," + last3;
  }
  return sign + "₹" + rest + last3;
}
function _istStamp(iso) {
  var d = iso ? _toDate(iso) : new Date();
  if (!d) d = new Date();
  return Utilities.formatDate(d, "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss");
}
