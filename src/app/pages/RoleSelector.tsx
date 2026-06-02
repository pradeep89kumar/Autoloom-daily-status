import { useNavigate } from "react-router";

export function RoleSelector() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center bg-white p-6">
      <div className="max-w-sm w-full">
        <h1 className="text-2xl font-semibold mb-1">Power Loom</h1>
        <p className="text-[var(--color-text-secondary)] text-sm mb-8">
          Shop-floor logging.
        </p>

        <div className="flex flex-col gap-3">
          <button
            onClick={() => navigate("/supervisor")}
            className="w-full text-left px-4 py-4 rounded-xl border border-[var(--color-border-hairline)] hover:border-[var(--color-text-primary)] transition-colors"
          >
            <div className="font-semibold">Supervisor</div>
            <div className="text-sm text-[var(--color-text-secondary)]">Mobile · shop floor</div>
          </button>
          <button
            onClick={() => navigate("/partner-pin")}
            className="w-full text-left px-4 py-4 rounded-xl border border-[var(--color-border-hairline)] hover:border-[var(--color-text-primary)] transition-colors"
          >
            <div className="font-semibold">Partner</div>
            <div className="text-sm text-[var(--color-text-secondary)]">Daily ledger · trend</div>
          </button>
        </div>
      </div>
    </div>
  );
}

