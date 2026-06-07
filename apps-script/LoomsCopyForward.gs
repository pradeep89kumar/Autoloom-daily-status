/**
 * Daily copy-forward automation for "looms_production".
 *
 * Behaviour:
 *  - Each run finds the latest date present in the sheet and copies its FULL
 *    block (however many rows it spans) forward, stamping the next date.
 *  - If multiple dates are missing (e.g. trigger failed on a previous day),
 *    every missing date up to yesterday is filled in order, each copying the
 *    most recent block at the time of copy.
 *  - Block size is dynamic: whatever the latest day contains is what gets
 *    copied. Add or remove loom rows freely; the next run picks up the change.
 *  - Loom identifiers, weaver, RPM, rate-per-meter etc. are all carried over
 *    from the source block; only the date column is overwritten.
 */

const TARGET_SPREADSHEET_ID = '1WbsCT_pgF9tk5XgIWQSabH7D_ZWt7bqHks_-c7BcQBo';
const DEFAULT_LOOMS_TAB_NAME = 'looms_production';

const LOOMS_TAB = 'LOOMS_TAB';
const LOOMS_MONTH = 'LOOMS_MONTH';
const LOOMS_YEAR = 'LOOMS_YEAR';
const LOOMS_TRIGGER_ID = 'LOOMS_TRIGGER_ID';

function setupLoomsDailyAutomation() {
  const ss = getTargetSpreadsheet_();
  const sheet = getLoomsSheet_(ss, DEFAULT_LOOMS_TAB_NAME);
  const dateCol = getDateColumnIndex_(sheet);
  const latestInfo = getLatestDateInfo_(sheet, dateCol);
  const tz = ss.getSpreadsheetTimeZone();
  const props = PropertiesService.getScriptProperties();

  const existingTriggerId = props.getProperty(LOOMS_TRIGGER_ID);
  if (existingTriggerId) deleteTriggerById_(existingTriggerId);

  const latestMonth = Utilities.formatDate(latestInfo.date, tz, 'M');
  const latestYear = Utilities.formatDate(latestInfo.date, tz, 'yyyy');

  const trigger = ScriptApp.newTrigger('runLoomsDailyAutomation')
    .timeBased()
    .atHour(11)
    .everyDays(1)
    .inTimezone(tz)
    .create();

  props.setProperties({
    LOOMS_TAB: sheet.getName(),
    LOOMS_MONTH: latestMonth,
    LOOMS_YEAR: latestYear,
    LOOMS_TRIGGER_ID: trigger.getUniqueId(),
  }, true);
}

function runLoomsDailyAutomation() {
  const props = PropertiesService.getScriptProperties();
  const tabName = props.getProperty(LOOMS_TAB);
  const monthStr = props.getProperty(LOOMS_MONTH);
  const yearStr = props.getProperty(LOOMS_YEAR);

  if (!tabName || !monthStr || !yearStr) {
    throw new Error('Automation is not setup. Run setupLoomsDailyAutomation() first.');
  }

  const ss = getTargetSpreadsheet_();
  const sheet = getLoomsSheet_(ss, tabName);
  const dateCol = getDateColumnIndex_(sheet);
  const tz = ss.getSpreadsheetTimeZone();

  const month = Number(monthStr);
  const year = Number(yearStr);
  const yesterdayKey = dateKey_(new Date(new Date().setDate(new Date().getDate() - 1)), tz);
  const monthEndKey = dateKey_(new Date(year, month, 0), tz);

  if (yesterdayKey > monthEndKey) {
    cleanupLoomsDailyAutomation();
    return;
  }

  const targetKey = yesterdayKey < monthEndKey ? yesterdayKey : monthEndKey;

  let latestInfo = getLatestDateInfo_(sheet, dateCol);
  let latestKey = dateKey_(latestInfo.date, tz);
  if (latestKey >= targetKey) return;

  // Find the full extent of the latest day's block (dynamic size).
  let { startRow: blockStartRow, size: blockSize } = findLatestBlockBounds_(
    sheet, dateCol, latestInfo.row, latestKey, tz
  );
  const lastColumn = sheet.getLastColumn();

  // Fill every missing date up to yesterday (or month-end), each copying the
  // most recent block. The newly-written block becomes the source for the next
  // iteration so the latest data always propagates forward.
  while (latestKey < targetKey) {
    const nextKey = nextDateKey_(latestKey);
    const nextDate = keyToDate_(nextKey);

    const sourceRange = sheet.getRange(blockStartRow, 1, blockSize, lastColumn);
    const destinationStartRow = sheet.getLastRow() + 1;
    const destinationRange = sheet.getRange(destinationStartRow, 1, blockSize, lastColumn);
    sourceRange.copyTo(destinationRange);

    const nextDateValues = Array.from({ length: blockSize }, () => [nextDate]);
    sheet.getRange(destinationStartRow, dateCol, blockSize, 1).setValues(nextDateValues);

    blockStartRow = destinationStartRow;
    latestKey = nextKey;
  }
}

/**
 * Walks upward from the last data row to find the contiguous block of rows
 * that share the latest date. Returns { startRow, size }.
 */
function findLatestBlockBounds_(sheet, dateCol, lastRow, latestKey, tz) {
  const dateValues = sheet.getRange(2, dateCol, lastRow - 1, 1).getValues();
  let startRow = lastRow;
  for (let row = lastRow - 1; row >= 2; row--) {
    const parsed = parseDateCell_(dateValues[row - 2][0]);
    if (!parsed || dateKey_(parsed, tz) !== latestKey) break;
    startRow = row;
  }
  return { startRow: startRow, size: lastRow - startRow + 1 };
}

function cleanupLoomsDailyAutomation() {
  const props = PropertiesService.getScriptProperties();
  const triggerId = props.getProperty(LOOMS_TRIGGER_ID);
  if (triggerId) deleteTriggerById_(triggerId);
  props.deleteProperty(LOOMS_TAB);
  props.deleteProperty(LOOMS_MONTH);
  props.deleteProperty(LOOMS_YEAR);
  props.deleteProperty(LOOMS_TRIGGER_ID);
}

function getTargetSpreadsheet_() {
  return SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
}

function getLoomsSheet_(ss, requestedName) {
  const exact = ss.getSheetByName(requestedName);
  if (exact) return exact;
  const normalizedRequested = String(requestedName).trim().toLowerCase();
  const match = ss.getSheets().find((s) => s.getName().trim().toLowerCase() === normalizedRequested);
  if (!match) throw new Error('Sheet "' + requestedName + '" was not found.');
  return match;
}

function getDateColumnIndex_(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) throw new Error('Header row is empty.');
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const index = headers.findIndex((h) => String(h).trim().toLowerCase() === 'date');
  if (index === -1) throw new Error('Header "Date" was not found.');
  return index + 1;
}

function getLatestDateInfo_(sheet, dateCol) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('No data rows found.');
  const values = sheet.getRange(2, dateCol, lastRow - 1, 1).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    const parsed = parseDateCell_(values[i][0]);
    if (parsed) return { row: i + 2, date: parsed };
  }
  throw new Error('No valid date value found in Date column.');
}

function parseDateCell_(value) {
  if (!value) return null;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateKey_(date, timezone) {
  return Utilities.formatDate(date, timezone, 'yyyy-MM-dd');
}

function nextDateKey_(key) {
  const parts = key.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function keyToDate_(key) {
  const parts = key.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function deleteTriggerById_(triggerId) {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getUniqueId() === triggerId) {
      ScriptApp.deleteTrigger(triggers[i]);
      return;
    }
  }
}
