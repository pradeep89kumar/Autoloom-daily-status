
  import { createRoot } from "react-dom/client";
  import { registerSW } from "virtual:pwa-register";
  import App from "./app/App.tsx";
  import { logVisit } from "./app/lib/sheetSync.ts";
  import "./styles/index.css";

  registerSW({ immediate: true });

  // Log an access row on each fresh app open (city/region/lat-long via the edge
  // function). To avoid spamming on rapid reloads / route changes, coalesce
  // within a 30-minute window: only log when the last logged visit was more than
  // 30 minutes ago (or never). This yields a new row per genuine open/return and
  // at least one per day. localStorage persists across sessions, unlike the old
  // once-per-session guard.
  const VISIT_GAP_MS = 30 * 60 * 1000;
  try {
    const last = Number(localStorage.getItem("lastVisitTs") || 0);
    if (!last || Date.now() - last > VISIT_GAP_MS) {
      localStorage.setItem("lastVisitTs", String(Date.now()));
      void logVisit();
    }
  } catch {
    // localStorage unavailable (e.g. private mode) — log best-effort.
    void logVisit();
  }

  createRoot(document.getElementById("root")!).render(<App />);
  