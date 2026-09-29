import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { loginWithPin } from "../../lib/authClient";
import type { Role } from "../../lib/persona";

export function PinGate() {
  return <AccessPinGate role="partner" />;
}

export function SupervisorPinGate() {
  return <AccessPinGate role="supervisor" />;
}

function AccessPinGate({ role }: { role: Role }) {
  const navigate = useNavigate();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<"invalid" | "unavailable" | null>(null);
  const [checking, setChecking] = useState(false);
  const active = useRef(true);
  const delayTimer = useRef<number | null>(null);
  const loginRequest = useRef<AbortController | null>(null);

  const isPartner = role === "partner";

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (delayTimer.current !== null) window.clearTimeout(delayTimer.current);
      loginRequest.current?.abort();
    };
  }, []);

  function press(d: string) {
    if (checking || pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    setError(null);
    if (next.length === 4) {
      // Defer briefly so the last dot renders.
      setChecking(true);
      delayTimer.current = window.setTimeout(async () => {
        const controller = new AbortController();
        loginRequest.current = controller;
        const result = await loginWithPin(role, next, controller.signal);
        if (!active.current || controller.signal.aborted) return;
        if (result.ok) {
          navigate(isPartner ? "/partner/day" : "/supervisor", { replace: true });
          return;
        }
        setError(result.reason);
        setPin("");
        setChecking(false);
      }, 80);
    }
  }

  function backspace() {
    if (checking) return;
    setError(null);
    setPin((p) => p.slice(0, -1));
  }

  const dots = [0, 1, 2, 3].map((i) => (
    <span
      key={i}
      className={`w-3 h-3 rounded-full transition-colors ${
        i < pin.length ? "bg-[var(--color-text-primary)]" : "bg-[var(--color-border-hairline)]"
      }`}
    />
  ));

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "←"];

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white px-6 py-10 max-w-md mx-auto">
      <div className="text-center mb-10">
        <div className="text-sm text-[var(--color-text-secondary)] mb-2">
          {isPartner ? "Partner" : "Supervisor"}
        </div>
        <h1 className="text-xl font-semibold">Enter access PIN</h1>
      </div>

      <div className="flex gap-3 mb-2 h-3">{dots}</div>
      <div className="text-xs text-[var(--color-text-secondary)] mb-8 h-4">
        {error === "invalid"
          ? "PIN does not match. Try again."
          : error === "unavailable"
            ? "Access check is unavailable. Try again."
            : checking
              ? "Checking…"
              : "\u00A0"}
      </div>

      <div className="grid grid-cols-3 gap-3 w-64">
        {keys.map((k, i) => {
          if (k === "") return <div key={i} />;
          if (k === "←") {
            return (
              <button
                key={i}
                onClick={backspace}
                disabled={checking}
                className="h-16 rounded-xl text-lg font-medium text-[var(--color-text-secondary)] hover:bg-black/5"
                aria-label="Delete"
              >
                ←
              </button>
            );
          }
          return (
            <button
              key={i}
              onClick={() => press(k)}
              disabled={checking}
              className="h-16 rounded-xl text-xl font-medium border border-[var(--color-border-hairline)] hover:bg-black/5"
            >
              {k}
            </button>
          );
        })}
      </div>

      <button
        onClick={() => navigate("/role")}
        disabled={checking}
        className="mt-10 text-sm text-[var(--color-text-secondary)] underline-offset-4 hover:underline"
      >
        Back
      </button>
    </div>
  );
}
