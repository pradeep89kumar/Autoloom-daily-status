import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt: () => Promise<void>;
};

export type InstallState =
  | { kind: "installed" }
  | { kind: "available"; prompt: () => Promise<void> }
  | { kind: "ios" }
  | { kind: "unavailable" };

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream;
}

export function usePwaInstall(): InstallState {
  const [state, setState] = useState<InstallState>(() => {
    if (isStandalone()) return { kind: "installed" };
    if (isIos()) return { kind: "ios" };
    return { kind: "unavailable" };
  });

  useEffect(() => {
    if (state.kind === "installed") return;

    function onBeforeInstall(e: Event) {
      e.preventDefault();
      const evt = e as BeforeInstallPromptEvent;
      setState({
        kind: "available",
        prompt: async () => {
          await evt.prompt();
          const choice = await evt.userChoice;
          if (choice.outcome === "accepted") {
            setState({ kind: "installed" });
          }
        },
      });
    }

    function onInstalled() {
      setState({ kind: "installed" });
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [state.kind]);

  return state;
}
