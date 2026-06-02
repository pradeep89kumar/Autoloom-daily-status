import { useNavigate } from "react-router";
import { Wallet, HardHat, Lock, ChevronRight, Download, Share, MoreVertical } from "lucide-react";
import { usePwaInstall } from "../lib/usePwaInstall";

export function RoleSelector() {
  const navigate = useNavigate();
  const install = usePwaInstall();

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
        <p className="text-[13px] font-semibold tracking-wide text-[var(--color-text-secondary)] text-center">
          யார் பயன்படுத்துகிறார்?
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

      {install.kind === "available" && (
        <button
          onClick={() => install.prompt()}
          className="mt-8 inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-[var(--color-brand-primary)] text-white text-[14px] font-semibold active:translate-y-px"
        >
          <Download className="w-4 h-4" strokeWidth={2} />
          Install on this device
        </button>
      )}

      {install.kind === "ios" && (
        <div className="mt-8 w-full max-w-sm rounded-2xl border border-[var(--color-border-hairline)] bg-white px-4 py-3.5">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--color-text-primary)]">
            <Share className="w-4 h-4" strokeWidth={2} />
            Add to Home Screen
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
            In Safari, tap the <span className="font-semibold text-[var(--color-text-primary)]">Share</span> button at the bottom, then choose <span className="font-semibold text-[var(--color-text-primary)]">"Add to Home Screen"</span>.
          </p>
        </div>
      )}

      {install.kind === "android" && (
        <div className="mt-8 w-full max-w-sm rounded-2xl border border-[var(--color-border-hairline)] bg-white px-4 py-3.5">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--color-text-primary)]">
            <MoreVertical className="w-4 h-4" strokeWidth={2} />
            Install on Home Screen
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
            In Chrome, tap the <span className="font-semibold text-[var(--color-text-primary)]">⋮ menu</span> at the top right, then choose <span className="font-semibold text-[var(--color-text-primary)]">"Install app"</span> or <span className="font-semibold text-[var(--color-text-primary)]">"Add to Home screen"</span>.
          </p>
        </div>
      )}

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

