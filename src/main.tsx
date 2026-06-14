
  import { createRoot } from "react-dom/client";
  import { registerSW } from "virtual:pwa-register";
  import App from "./app/App.tsx";
  import { logVisit } from "./app/lib/sheetSync.ts";
  import "./styles/index.css";

  registerSW({ immediate: true });

  // Log one access row per session (city/region/lat-long via the edge function).
  if (!sessionStorage.getItem("visitLogged")) {
    sessionStorage.setItem("visitLogged", "1");
    void logVisit();
  }

  createRoot(document.getElementById("root")!).render(<App />);
  