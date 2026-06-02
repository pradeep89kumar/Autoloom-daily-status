import { useNavigate } from "react-router";
import { Wallet, HardHat, Lock, ChevronRight } from "lucide-react";

export function RoleSelector() {
  const navigate = useNavigate();

  return (
    <div
      className="min-h-screen bg-white px-6 py-10 flex flex-col items-center"
      style={{
        backgroundImage:
          "repeating-linear-gradient(90deg, rgba(31,79,224,0.045) 0 1px, transparent 1px 14px)",
      }}
    >
      <header className="w-full max-w-sm text-center mt-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.32em] text-[var(--color-text-secondary)]">
          Erode
        </div>
        <h1 className="mt-2 text-[26px] font-bold leading-tight text-[var(--color-text-primary)]">
          Sri Aarumga Tex
        </h1>
        <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
          Quality auto-loom weaving
        </p>
      </header>

      <div className="w-full max-w-sm mt-10 mb-6">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] text-center">
          Who is this?
        </p>
      </div>

      <div className="w-full max-w-sm flex flex-col gap-3">
        <RoleCard
          tone="brand"
          Icon={Wallet}
          title="Partners"
          subtitle="Daily ledger · trends · receivables"
          locked
          onClick={() => navigate("/partner-pin")}
        />
        <RoleCard
          tone="neutral"
          Icon={HardHat}
          title="Supervisor"
          subtitle="Shop-floor logging · loadings"
          onClick={() => navigate("/supervisor")}
        />
      </div>

      <footer className="mt-auto pt-10 text-center">
        <p className="text-[12px] text-[var(--color-text-secondary)]">
          Power Loom QC
        </p>
      </footer>
    </div>
  );
}

function RoleCard({
  tone,
  Icon,
  title,
  subtitle,
  locked,
  onClick,
}: {
  tone: "brand" | "neutral";
  Icon: typeof Wallet;
  title: string;
  subtitle: string;
  locked?: boolean;
  onClick: () => void;
}) {
  const railCls =
    tone === "brand"
      ? "bg-[var(--color-brand-primary)]"
      : "bg-[var(--color-text-primary)]";
  const iconWrapCls =
    tone === "brand"
      ? "bg-[var(--color-brand-primary)]/10 text-[var(--color-brand-primary)]"
      : "bg-black/[0.06] text-[var(--color-text-primary)]";
  return (
    <button
      onClick={onClick}
      className="relative w-full bg-white rounded-xl border border-[var(--color-border-hairline)] py-5 pl-5 pr-4 flex items-center gap-4 text-left active:translate-y-px transition-transform hover:border-[var(--color-text-primary)] overflow-hidden"
    >
      <span
        aria-hidden
        className={`absolute left-0 top-0 bottom-0 w-1 ${railCls}`}
      />
      <span
        className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${iconWrapCls}`}
      >
        <Icon className="w-6 h-6" strokeWidth={1.75} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="text-[20px] font-bold text-[var(--color-text-primary)]">
            {title}
          </span>
          {locked && (
            <Lock
              className="w-3.5 h-3.5 text-[var(--color-text-secondary)]"
              strokeWidth={2}
            />
          )}
        </span>
        <span className="block mt-0.5 text-[14px] text-[var(--color-text-secondary)]">
          {subtitle}
        </span>
      </span>
      <ChevronRight
        className="w-5 h-5 text-[var(--color-text-secondary)] shrink-0"
        strokeWidth={1.5}
      />
    </button>
  );
}

