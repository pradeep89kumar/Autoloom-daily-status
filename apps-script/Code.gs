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
var WA_ENABLED = false;
var WA_RELAY_NUMBER = "+919940111315";
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
  return _json({ ok: false, error: "unknown kind" });
}

/* ------------------------------ writers ------------------------------ */

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
    p.capturedAt || new Date().toISOString(), // M
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
  sh.getRange(rowIndex, 17, 1, 1).setValue(new Date().toISOString()); // Q Edited at
  return _json({ ok: true });
}

function _logLoading(p) {
  var sh = _loadingsSheet();
  sh.appendRow([
    p.capturedAt || new Date().toISOString(),  // A
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
 * Cols: A Order ID · B Paagu ID · C Customer Name · E Status
 *  AA Invoice amount · AB Invoice number · AC Invoice date · AD Due date
 *  AE Receipts · AF Received On · AG Payment status
 *  AN Pending Balance · AP Party
 */
function _readMasterReceivables() {
  var sh = SpreadsheetApp.openById(MASTER_SHEET_ID).getSheetByName(MASTER_PAAGU_TAB);
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, 42).getValues(); // A..AP
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var party = String(r[41] || "").trim();
    if (!party) continue;
    var orderId = String(r[0] || "").trim();
    var paaguId = String(r[1] || "").trim();
    var pending = Number(r[39]) || 0;
    var invoiceAmount = Number(r[26]) || 0;
    var invoiceNumber = String(r[27] || "").trim();
    if (!invoiceNumber && !pending && !invoiceAmount && !orderId && !paaguId) continue;
    out.push({
      orderId: orderId,
      paaguId: paaguId,
      customerName: String(r[2] || ""),
      status: String(r[4] || ""),
      invoiceAmount: invoiceAmount,
      invoiceNumber: invoiceNumber,
      invoiceDate: r[28] ? _ymd(_toDate(r[28]) || new Date(r[28])) : "",
      dueDate: r[29] ? _ymd(_toDate(r[29]) || new Date(r[29])) : "",
      receipts: Number(r[30]) || 0,
      receivedOn: r[31] ? _ymd(_toDate(r[31]) || new Date(r[31])) : "",
      paymentStatus: String(r[32] || "").trim(),
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
  // For CC, withdrawals (M) bring cash into operations → IN; repayment (N) and interest (O) are OUT.
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
    { key: "iobCc",       col: CF_COL_IOB_CC_REPAY - 1,    sign: -1, kind: "repay"  },
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
