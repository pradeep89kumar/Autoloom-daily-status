
# Quality Control App

This is a code bundle for Quality Control App. The original project is available at https://www.figma.com/design/GAZa9tTA7qZQVh3WmNW8v2/Quality-Control-App.

## Required private configuration

Configure these as server-side Vercel environment variables. Do not use a
`VITE_` prefix; that would place the value in the browser bundle.

- `PARTNER_PIN` — exactly four digits
- `SUPERVISOR_PIN` — exactly four digits and different from the Partner PIN
- `SESSION_SECRET` — a random secret of at least 32 characters
- `SHEET_WEBHOOK_URL` — the production Apps Script URL ending in `/exec`
- `SHEET_API_TOKEN` — the same value as the Apps Script `API_TOKEN` property

Use `.env.example` as the local key list. Never commit real values.

## Running the code

Run `npm i` to install the dependencies.

Use `vercel dev` for a complete local run because authentication and sheet
access are provided by `/api/session` and `/api/sheet`. `npm run dev` starts only
the Vite frontend and cannot serve protected data by itself.

Run `npm run build` for the production frontend build.

## Security checks before production deployment

- Add a Vercel Firewall rate limit for `POST /api/session` (recommended: five
  attempts per minute per IP). A four-digit PIN must not rely only on the
  function's failed-login delay.
- Replace the old Partner PIN and rotate the Apps Script `API_TOKEN`; older
  browser/PWA bundles may still contain the former browser-side values.
- Put the rotated token only in Apps Script `API_TOKEN` and Vercel
  `SHEET_API_TOKEN`, remove the former `VITE_` variables, then redeploy.
- Verify Partner and Supervisor logins separately, verify cross-role access is
  denied, and confirm `/api/sheet` returns live data before declaring release.
