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
 *  GET  ?mode=cashflow                         → cash position + monthly summary from Master Control tab
 *  GET  ?mode=cashflow-ledger&from=&to=&account=&direction= → ledger entries for the statement view
 *  GET  ?mode=capex&project=6%20Looms          → Capex Register entries + totals for one project (default "6 Looms")
 *  GET  ?mode=beams                            → Beam Register tables from R.O STATUS tab (loaded/vendor/ready/empty/master)
 *  POST kind:"edit"           → overwrite Sheet1 row by rowIndex, only inside edit window
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

// Beam Register — separate spreadsheet tracking every physical beam asset.
var BEAM_SHEET_ID = "1sHQIkVJcB-QfuuFVCWo16WpNjlZtLFFne5v4XvcF2YI";
var BEAM_TAB = "R.O STATUS";

// Visit log — access tracking (country/region/city/lat/long) appended on each session.
var VISITS_TAB = "Visits";

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

function doGet(e) {
  var mode = (e && e.parameter && e.parameter.mode) || "";
  if (mode === "full")     return _json({ ok: true, rows: _readFullRows(21) });
  if (mode === "loadings") return _json({ ok: true, rows: _readLoadings(120) });
  if (mode === "catalog")  return _json({ ok: true, orders: _readOrders() });
  if (mode === "master-day") {
    var date = (e.parameter && e.parameter.date) || _ymd(new Date());
    return _json({ ok: true, date: date, rows: _readMasterDay(date) });
  }
  if (mode === "master-range") {
    var from = (e.parameter && e.parameter.from) || "";
    var to = (e.parameter && e.parameter.to) || _ymd(new Date());
    return _json({ ok: true, from: from, to: to, rows: _readMasterRange(from, to) });
  }
  if (mode === "master-orders") {
    return _json({ ok: true, rows: _readMasterOrders() });
  }
  if (mode === "master-receivables") {
    return _json({ ok: true, rows: _readMasterReceivables() });
  }
  if (mode === "cashflow") {
    return _json({ ok: true, cashflow: _readCashflow() });
  }
  if (mode === "cashflow-ledger") {
    var cfFrom = (e.parameter && e.parameter.from) || "";
    var cfTo   = (e.parameter && e.parameter.to)   || _ymd(new Date());
    var cfAcct = (e.parameter && e.parameter.account)   || "";
    var cfDir  = (e.parameter && e.parameter.direction) || "";
    return _json({ ok: true, rows: _readCashLedger(cfFrom, cfTo, cfAcct, cfDir) });
  }
  if (mode === "capex") {
    var capexProject = (e.parameter && e.parameter.project) || "6 Looms";
    return _json({ ok: true, capex: _readCapex(capexProject) });
  }
  if (mode === "beams") {
    return _readBeams();
  }
  return _json({ ok: true, rows: _readLightRows(21) });
}

function doPost(e) {
  if (!e || !e.postData) return _json({ ok: false, error: "no payload" });
  var p;
  try { p = JSON.parse(e.postData.contents); }
  catch (err) { return _json({ ok: false, error: "bad json" }); }

  if (p.kind === "production")  return _appendProduction(p);
  if (p.kind === "loading")     return _logLoading(p);
  if (p.kind === "edit")        return _editProduction(p);
  if (p.kind === "visit")       return _logVisit(p);
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

function _waSend(body) {
  if (!TWILIO_SID || !TWILIO_AUTH || !TWILIO_FROM) return;
  try {
    UrlFetchApp.fetch("https://api.twilio.com/2010-04-01/Accounts/" + TWILIO_SID + "/Messages.json", {
      method: "post",
      headers: { Authorization: "Basic " + Utilities.base64Encode(TWILIO_SID + ":" + TWILIO_AUTH) },
      payload: { From: TWILIO_FROM, To: "whatsapp:" + WA_RELAY_NUMBER, Body: body },
      muteHttpExceptions: true,
    });
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
      payload: { From: TWILIO_FROM, To: "whatsapp:" + WA_RELAY_NUMBER, Body: "SAT test ✅ " + _istStamp() },
      muteHttpExceptions: true,
    }
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

  var cf = _readCashflow();
  if (cf && isFinite(cf.totalAvailable)) {
    lines.push("");
    lines.push("🏦 Total cash available " + _inr(cf.totalAvailable));
  }

  // Fresh cash-in only — entries recorded for this day. Nothing shown if none.
  var cashIn = _readCashLedger(dateYmd, dateYmd, "", "in");
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

// Grand total of pending receivables — mirrors the partner Receivables tab:
// merge rows sharing a party+invoice, then sum the effective pending of each.
function _totalPendingReceivables() {
  var rows = _readMasterReceivables();
  var byInv = {};
  var passthrough = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var inv = String(r.invoiceNumber || "").trim();
    if (!inv) { passthrough.push(r); continue; }
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
  for (var j = 0; j < passthrough.length; j++) total += _effectivePending(passthrough[j]);
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
function _masterProduction() {
  return SpreadsheetApp.openById(MASTER_SHEET_ID).getSheetByName(MASTER_PRODUCTION_TAB);
}

function _masterOrderTab() {
  return SpreadsheetApp.openById(MASTER_SHEET_ID).getSheetByName(MASTER_ORDER_TAB);
}

function _readMasterRows() {
  var sh = _masterProduction();
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, 15).getValues(); // A..O
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
function _readMasterReceivables() {
  var sh = SpreadsheetApp.openById(MASTER_SHEET_ID).getSheetByName(MASTER_PAAGU_TAB);
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var width = sh.getLastColumn();
  var header = sh.getRange(1, 1, 1, width).getValues()[0];
  var normHeader = function (s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); };
  var headerNorm = [];
  for (var h = 0; h < header.length; h++) headerNorm.push(normHeader(header[h]));
  var findCol = function (aliases, fallbackIdx) {
    for (var a = 0; a < aliases.length; a++) {
      var want = normHeader(aliases[a]);
      for (var c = 0; c < headerNorm.length; c++) {
        if (headerNorm[c] === want) return c;
      }
    }
    return fallbackIdx;
  };

  var cOrderId = findCol(["Order ID"], 0);
  var cPaaguId = findCol(["Paagu ID", "Paagu"], 1);
  var cCustomerName = findCol(["Customer Name", "Design Details"], 2);
  var cStatus = findCol(["Status"], 4);
  // Looms Allocated lives in column K (index 10) — read by header, but force the
  // column-K fallback when the header lookup returns the same fixed position.
  var cLoadedLoom = findCol(["Looms Allocated", "Loaded Loom", "Loom Allocated"], 10);
  var cInvoiceAmount = findCol(["Invoice amount"], 26);
  var cInvoiceNumber = findCol(["Invoice number"], 27);
  var cInvoiceDate = findCol(["Invoice date"], 28);
  var cDueDate = findCol(["Due date"], 29);
  var cReceipts = findCol(["Receipts"], 30);
  var cReceivedOn = findCol(["Received On"], 31);
  var cPaymentStatus = findCol(["Payment status"], 32);
  var cPendingBalance = findCol(["Pending Balance"], 39);
  var cParty = findCol(["Party"], 41);

  var values = sh.getRange(2, 1, last - 1, 42).getValues(); // A..AP
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var party = String(r[cParty] || "").trim();
    if (!party) continue;
    var orderId = String(r[cOrderId] || "").trim(); // retained for backward compatibility
    var paaguId = String(r[cPaaguId] || "").trim();
    var customerName = String(r[cCustomerName] || "").trim();
    var loadedLoom = String(r[cLoadedLoom] || "").trim();
    var pending = Number(r[cPendingBalance]) || 0;
    var invoiceAmount = Number(r[cInvoiceAmount]) || 0;
    var invoiceNumber = String(r[cInvoiceNumber] || "").trim();
    if (!invoiceNumber && !pending && !invoiceAmount && !customerName && !paaguId) continue;
    out.push({
      orderId: orderId,
      paaguId: paaguId,
      customerName: customerName,
      loadedLoom: loadedLoom,
      designDetails: customerName, // backward-compatible alias consumed by older UI
      loomNumber: loadedLoom,      // backward-compatible alias consumed by older UI
      status: String(r[cStatus] || ""),
      invoiceAmount: invoiceAmount,
      invoiceNumber: invoiceNumber,
      invoiceDate: r[cInvoiceDate] ? _ymd(_toDate(r[cInvoiceDate]) || new Date(r[cInvoiceDate])) : "",
      dueDate: r[cDueDate] ? _ymd(_toDate(r[cDueDate]) || new Date(r[cDueDate])) : "",
      receipts: Number(r[cReceipts]) || 0,
      receivedOn: r[cReceivedOn] ? _ymd(_toDate(r[cReceivedOn]) || new Date(r[cReceivedOn])) : "",
      paymentStatus: String(r[cPaymentStatus] || "").trim(),
      pendingBalance: pending,
      party: party
    });
  }
  return out;
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
  return SpreadsheetApp.openById(MASTER_SHEET_ID).getSheetByName(MASTER_CASHFLOW_TAB);
}

function _readCashflow() {
  var sh = _cashflowSheet();
  if (!sh) return null;

  // Closing balances (row 10)
  var tmb         = Number(sh.getRange(CF_ROW_CLOSING, CF_COL_TMB).getValue())      || 0;
  var iobCa       = Number(sh.getRange(CF_ROW_CLOSING, CF_COL_IOB_CA).getValue())   || 0;
  var cashbookApp = Number(sh.getRange(CF_ROW_CLOSING, CF_COL_CASHBOOK).getValue()) || 0;
  var cash        = Number(sh.getRange(CF_ROW_CLOSING, CF_COL_CASH).getValue())     || 0;
  var iobCcRaw    = Number(sh.getRange(CF_ROW_CLOSING, CF_COL_IOB_CC).getValue())   || 0;
  var iobCcUsed   = Math.abs(iobCcRaw);
  var iobCcAvailable = Math.max(0, CF_IOB_CC_LIMIT - iobCcUsed);
  var totalAvailable = tmb + iobCa + cashbookApp + cash + iobCcAvailable;

  // Monthly summary cells
  var opInflow      = Number(sh.getRange(CF_CELL_OP_INFLOW).getValue())  || 0;
  var opOutflowVal  = Number(sh.getRange(CF_CELL_OP_OUTFLOW).getValue()) || 0;
  var opOutflow     = opOutflowVal > 0 ? -opOutflowVal : opOutflowVal; // ensure negative
  var opCashflowNet = Number(sh.getRange(CF_CELL_OP_NET).getValue());
  if (!isFinite(opCashflowNet)) opCashflowNet = opInflow + opOutflow;

  // CC drawn this month = sum of column M (Withdrawal) for current-month entries.
  // Sheet stores withdrawals as positive numbers in M, so just sum them.
  var ccDrawn = 0;
  var lastRow = sh.getLastRow();
  if (lastRow >= CF_LEDGER_START_ROW) {
    var n = lastRow - CF_LEDGER_START_ROW + 1;
    var ledgerDates = sh.getRange(CF_LEDGER_START_ROW, CF_LEDGER_DATE_COL, n, 1).getValues();
    var ledgerCc    = sh.getRange(CF_LEDGER_START_ROW, CF_COL_IOB_CC_DRAWN, n, 1).getValues();
    var nowD = new Date();
    var curY = nowD.getFullYear();
    var curM = nowD.getMonth();
    for (var k = 0; k < n; k++) {
      var dRow = _toDate(ledgerDates[k][0]);
      if (!dRow) continue;
      if (dRow.getFullYear() !== curY || dRow.getMonth() !== curM) continue;
      var v = Number(ledgerCc[k][0]);
      if (!v || isNaN(v)) continue;
      ccDrawn += Math.abs(v);
    }
  }

  // As-of date — use the most recent ledger entry; fall back to today.
  var lastEntry = "";
  var last = sh.getLastRow();
  if (last >= CF_LEDGER_START_ROW) {
    var dates = sh.getRange(CF_LEDGER_START_ROW, CF_LEDGER_DATE_COL, last - CF_LEDGER_START_ROW + 1, 1).getValues();
    var maxMs = 0;
    for (var i = 0; i < dates.length; i++) {
      var d = _toDate(dates[i][0]);
      if (d && d.getTime() > maxMs) maxMs = d.getTime();
    }
    if (maxMs) lastEntry = _ymd(new Date(maxMs));
  }
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

function _readCashLedger(fromYmd, toYmd, accountKey, direction) {
  var sh = _cashflowSheet();
  if (!sh) return [];
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
  return SpreadsheetApp.openById(MASTER_SHEET_ID).getSheetByName(MASTER_CAPEX_TAB);
}

function _readCapex(projectFilter) {
  var empty = { project: projectFilter, total: 0, count: 0, byFunding: {}, byExpense: {}, byPaidFrom: {}, rows: [] };
  var sh = _capexSheet();
  if (!sh) return empty;
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
