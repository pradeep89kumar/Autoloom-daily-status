# Project operating instructions

- Change only the persona, tab, screen, feature, or file explicitly requested by the user.
- Do not expand scope to adjacent UI, backend, data schema, dependencies, infrastructure, deployment, refactoring, or cleanup without explicit approval and alignment.
- Before implementing any material scope expansion, explain the proposed change and wait for approval.
- Do not push or deploy unless the user explicitly requests it for that change.
- Treat `apps-script/` as a separate production backend supporting the frontend. Do not modify or deploy Apps Script unless explicitly requested and approved.
- Preserve unrelated existing work. Do not make opportunistic improvements.
- Keep temporary verification changes clearly identifiable, and remove them only when requested.
- Keep all PINs, `SHEET_WEBHOOK_URL`, `SHEET_API_TOKEN` and `SESSION_SECRET` server-only. Never add a `VITE_` version, a browser fallback PIN, or a direct browser-to-Apps-Script path.
- Partner and Supervisor access are separate server-verified roles. Do not weaken the role-specific `/api/sheet` allowlists when adding screens or operations.
