
  import { createRoot } from "react-dom/client";
  import { registerSW } from "virtual:pwa-register";
  import App from "./app/App.tsx";
  import "./styles/index.css";

  registerSW({ immediate: true });

  // Retire the former Workbox runtime cache. It could contain token-bearing
  // Apps Script request URLs and HTTP-200 error payloads from older app builds.
  if ("caches" in window) {
    void window.caches.delete("apps-script");
  }

  createRoot(document.getElementById("root")!).render(<App />);
