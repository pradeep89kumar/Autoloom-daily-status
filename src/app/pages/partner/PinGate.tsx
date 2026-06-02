import { useState } from "react";
import { useNavigate } from "react-router";
import { setRole, partnerPin } from "../../lib/persona";

export function PinGate() {
  const navigate = useNavigate();
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);

  function press(d: string) {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    setErr(false);
    if (next.length === 4) {
      // Defer briefly so the last dot renders.
      setTimeout(() => {
        if (next === partnerPin()) {
          setRole("partner");
          navigate("/partner/day", { replace: true });
        } else {
          setErr(true);
          setPin("");
        }
      }, 80);
    }
  }

  function backspace() {
    setErr(false);
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
        <div className="text-sm text-[var(--color-text-secondary)] mb-2">Partner</div>
        <h1 className="text-xl font-semibold">Enter access PIN</h1>
      </div>

      <div className="flex gap-3 mb-2 h-3">{dots}</div>
      <div className="text-xs text-[var(--color-text-secondary)] mb-8 h-4">
        {err ? "PIN does not match. Try again." : "\u00A0"}
      </div>

      <div className="grid grid-cols-3 gap-3 w-64">
        {keys.map((k, i) => {
          if (k === "") return <div key={i} />;
          if (k === "←") {
            return (
              <button
                key={i}
                onClick={backspace}
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
              className="h-16 rounded-xl text-xl font-medium border border-[var(--color-border-hairline)] hover:bg-black/5"
            >
              {k}
            </button>
          );
        })}
      </div>

      <button
        onClick={() => navigate("/role")}
        className="mt-10 text-sm text-[var(--color-text-secondary)] underline-offset-4 hover:underline"
      >
        Back
      </button>
    </div>
  );
}
