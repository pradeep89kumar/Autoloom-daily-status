# Monthly Google Sheet and Apps Script Rollover

Use this checklist when a new monthly Partner/master Google Sheet is created by duplicating the previous workbook. This is an operating procedure only. Do not change or deploy anything until the new spreadsheet URL has been supplied and the rollover is explicitly approved.

## Assumptions

- The complete Partner/master workbook is duplicated, not only one tab.
- The existing Apps Script project and web-app deployment URL will continue to be used.
- The Supervisor transactional workbook and Beam workbook remain unchanged.
- The duplicate keeps the historical rows needed by previous-month and cross-month reports.

If any assumption is false, stop and review the migration before changing an ID.

## Monthly record

- Month: `________________`
- New spreadsheet URL: `________________`
- New spreadsheet ID: `________________`
- Apps Script deployment URL unchanged: `Yes / No`
- Completed by: `________________`
- Completion date: `________________`

The spreadsheet ID is the value between `/d/` and `/edit` in a normal Google Sheets URL:

```text
https://docs.google.com/spreadsheets/d/NEW_SPREADSHEET_ID/edit
```

## 1. Prepare and verify the duplicated workbook

1. Duplicate the entire current Partner/master workbook.
2. Keep these tab names exactly as written:
   - `Looms_Production`
   - `Order`
   - `Paagu ID`
   - `Master Control`
   - `Capex Register`
3. Preserve formulas, formatting, named ranges, protected ranges and any external-sheet references.
4. Confirm the Apps Script execution account has access to the new workbook.
5. Keep historical rows required by the app. The current backend reads only one master spreadsheet ID and cannot look up older monthly files.
6. Verify the important layouts were preserved:
   - `Looms_Production`: columns A–O remain unchanged, and row 1 includes `Date`.
   - `Paagu ID`: columns through AP remain available.
   - `Master Control`: balance row 10, ledger from row 15, and summary cells R3/S3/T3 remain intact.
   - `Capex Register`: columns A–G remain unchanged.
7. Check that formulas and external references in the duplicate point to the intended source data and have permission to refresh.

## 2. Update the two master spreadsheet IDs

The same new ID must be placed in both files. Updating only one creates a split condition where the app reads one workbook while automation writes to another.

### Partner/master API

In [`apps-script/Code.gs`](apps-script/Code.gs), update only `MASTER_SHEET_ID`:

```javascript
var MASTER_SHEET_ID = "NEW_SPREADSHEET_ID";
```

### Daily production copy-forward

In [`apps-script/LoomsCopyForward.gs`](apps-script/LoomsCopyForward.gs), update only `TARGET_SPREADSHEET_ID`:

```javascript
const TARGET_SPREADSHEET_ID = 'NEW_SPREADSHEET_ID';
```

For a Partner/master rollover, do not change:

- `SHEET_ID` — Supervisor production, loadings, catalog, visits and designs.
- `BEAM_SHEET_ID` — Beam Register.
- `VITE_SHEET_WEBHOOK_URL` — unless a new Apps Script deployment URL is created.
- `VITE_API_TOKEN` — unless the Apps Script API token is intentionally changed.

## 3. Update the production Apps Script deployment

The repository is not automatically connected to the live Apps Script project. A GitHub push or Vercel deployment does not publish `Code.gs` or `LoomsCopyForward.gs`.

1. Apply the same two approved ID changes in the actual production Apps Script project.
2. Save the Apps Script project.
3. Update the existing web-app deployment to a new version while retaining the same deployment URL.
4. Confirm the deployment executor can open the new spreadsheet.
5. Review the Apps Script execution log for permission, missing-tab or formula errors.

If a completely new Apps Script project or deployment URL is used, this is no longer a normal monthly rollover. The new project will also require its Script Properties, authorizations and triggers, and Vercel will require the new `VITE_SHEET_WEBHOOK_URL` plus a frontend redeployment.

## 4. Prepare the new month and copy-forward trigger

### Required Script Properties safety check

Complete this check before running any setup function.

The current setup function calls `setProperties(..., true)`. The `true` argument deletes every other Script Property in the same Apps Script project. In a shared project, it can erase `API_TOKEN`, Twilio, CallMeBot, WhatsApp-provider and Gemini configuration.

Do not continue to step 5 below until one of these is confirmed:

- `LoomsCopyForward.gs` is isolated in its own Apps Script project; or
- the setup implementation has been approved and corrected so it preserves unrelated properties.

1. In `Looms_Production`, ensure the newest dated rows form one complete, contiguous loom block for the new month.
2. Set every row in that seed block to the intended first date of the month.
3. Verify loom identifiers, shifts, weavers, RPM, rates and formulas.
4. Reset any literal result values that should not be carried from the previous month. The automation copies every used column and changes only `Date`.
5. Only after the new-month seed block is the latest valid block, run `setupLoomsDailyAutomation()` once.
6. Verify one daily `runLoomsDailyAutomation` trigger exists for the 9 AM hour in the spreadsheet timezone.
7. Verify the new month/year and trigger ID were stored in the `LOOMS_*` Script Properties.

## 5. Verify the rollover

After the Apps Script deployment is updated:

1. Open Partner → Daily and confirm data loads from the new workbook for a known date.
2. Open Partner → Trend and confirm current-month figures load.
3. Open Partner → Cash and confirm balances and monthly summary are present.
4. Open Partner → Receivables and confirm expected invoices/parties load.
5. Open New Shed Expenses and confirm `Capex Register` data loads.
6. After the next automation run, confirm the expected dated block was appended to `Looms_Production` exactly once.
7. Check Apps Script Executions for errors.
8. If the installed PWA shows old data during a network problem, retry on a reliable connection or in a fresh browser session; Apps Script GET responses can fall back to cache for up to 24 hours.

Do not treat an empty screen as proof that a sheet is empty. Several current frontend reads convert backend, permission and parsing failures into an empty state.

## 6. Rollback

If verification fails:

1. Restore both Apps Script constants to the previous master spreadsheet ID.
2. Update the existing Apps Script web-app deployment again.
3. Disable the newly created copy-forward trigger if it targets the wrong workbook or month.
4. Remove only rows that were positively identified as erroneous duplicates; retain the original workbook unchanged.
5. Recheck Partner Daily, Cash and Receivables before declaring rollback complete.

## Completion check

- [ ] Complete master workbook duplicated
- [ ] Required tabs and layouts verified
- [ ] Historical reporting data retained
- [ ] New spreadsheet ID extracted and recorded
- [ ] `MASTER_SHEET_ID` updated
- [ ] `TARGET_SPREADSHEET_ID` updated to the same value
- [ ] Unrelated workbook IDs left unchanged
- [ ] Live Apps Script project saved and deployment updated
- [ ] Script Properties protected
- [ ] Copy-forward trigger configured for the new month
- [ ] Partner screens verified
- [ ] Apps Script execution log checked
- [ ] Previous workbook retained for rollback
