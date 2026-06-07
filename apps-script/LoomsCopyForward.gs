/**
 * Daily copy-forward automation for "looms_production".
 * LOOMS_PER_DAY is authoritative: each run normalises the latest day's block
 * to exactly this many rows before copying forward.
 *
 * Bootstrap on first 14-loom run:
 *   The latest day has 8 rows -> the script pads with 6 duplicates of the 8th row.
 *   Open the sheet once and rename those 6 rows to your real loom identifiers
 *   (e.g. L9..L14). Every subsequent day carries the corrected names automatically.
 */

const TARGET_SPREADSHEET_ID = '1WbsCT_pgF9tk5XgIWQSabH7D_ZWt7bqHks_-c7BcQBo';
const DEFAULT_LOOMS_TAB_NAME = 'looms_production';
const LOOMS_PER_DAY = 14;

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

  // Normalise to LOOMS_PER_DAY before copy-forward.
  normaliseLatestBlockToLoomsPerDay_(sheet, dateCol, tz);

  // Re-read after normalisation.
  latestInfo = getLatestDateInfo_(sheet, dateCol);
  latestKey = dateKey_(latestInfo.date, tz);
  const latestRow = latestInfo.row;
  const lastColumn = sheet.getLastColumn();

  let currentBlockStart = latestRow - LOOMS_PER_DAY + 1;
  while (latestKey < targetKey) {
    const nextKey = nextDateKey_(latestKey);
    const nextDate = keyToDate_(nextKey);

    const sourceRange = sheet.getRange(currentBlockStart, 1, LOOMS_PER_DAY, lastColumn);
    const destinationStartRow = sheet.getLastRow() + 1;
    const destinationRange = sheet.getRange(destinationStartRow, 1, LOOMS_PER_DAY, lastColumn);
    sourceRange.copyTo(destinationRange);

    const nextDateValues = Array.from({ length: LOOMS_PER_DAY }, () => [nextDate]);
    sheet.getRange(destinationStartRow, dateCol, LOOMS_PER_DAY, 1).setValues(nextDateValues);

    currentBlockStart = destinationStartRow;
    latestKey = nextKey;
  }
}

/**
 * Ensures the latest date's block is exactly LOOMS_PER_DAY rows.
 *  - too many  -> deletes trailing rows of the block
 *  - too few   -> duplicates the LAST row of the block to fill
 * No-op if already correct.
 */
function normaliseLatestBlockToLoomsPerDay_(sheet, dateCol, tz) {
  const info = getLatestDateInfo_(sheet, dateCol);
  const latestKey = dateKey_(info.date, tz);
  const lastRow = info.row;

  const dateValues = sheet.getRange(2, dateCol, lastRow - 1, 1).getValues();
  let blockStartRow = lastRow;
  for (let row = lastRow - 1; row >= 2; row--) {
    const parsed = parseDateCell_(dateValues[row - 2][0]);
    if (!parsed || dateKey_(parsed, tz) !== latestKey) break;
    blockStartRow = row;
  }

  const currentSize = lastRow - blockStartRow + 1;
  if (currentSize === LOOMS_PER_DAY) return;

  const lastColumn = sheet.getLastColumn();

  if (currentSize > LOOMS_PER_DAY) {
    const toDelete = currentSize - LOOMS_PER_DAY;
    sheet.deleteRows(blockStartRow + LOOMS_PER_DAY, toDelete);
    Logger.log('Trimmed ' + toDelete + ' row(s) from ' + latestKey + ' to reach ' + LOOMS_PER_DAY + '.');
    return;
  }

  const padCount = LOOMS_PER_DAY - currentSize;
  const templateRange = sheet.getRange(lastRow, 1, 1, lastColumn);
  for (let i = 0; i < padCount; i++) {
    const destRow = lastRow + 1 + i;
    sheet.insertRowAfter(destRow - 1);
    templateRange.copyTo(sheet.getRange(destRow, 1, 1, lastColumn));
  }
  const padDateValues = Array.from({ length: padCount }, () => [info.date]);
  sheet.getRange(lastRow + 1, dateCol, padCount, 1).setValues(padDateValues);

  Logger.log(
    'Padded ' + padCount + ' row(s) on ' + latestKey + ' to reach ' + LOOMS_PER_DAY +
    '. Rename the padded rows to your new loom identifiers (e.g. L9..L14).'
  );
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
