import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, Loader2 } from "lucide-react";
import {
  fetchCashLedger,
  type CashAccount,
  type CashLedgerEntry,
  type CashLedgerFilter,
} from "../../lib/sheetSync";

const ACCOUNT_LABEL: Record<CashAccount, string> = {
  tmb: "TMB",
  iobCa: "IOB CA",
  cashbookApp: "Cashbook App",
  cash: "Cash",
  iobCc: "IOB CC",
};

type RangePreset = "month" | "30d" | "90d";

function fmtINR(n: number): string {
  if (!isFinite(n)) return "—";
  const abs = Math.abs(Math.round(n));
  const sign = n < 0 ? "−" : "";
  return `${sign}₹${abs.toLocaleString("en-IN")}`;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function rangeFor(preset: RangePreset): { from: string; to: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const to = ymd(today);
  if (preset === "month") {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: ymd(first), to };
  }
  const days = preset === "30d" ? 29 : 89;
  const from = new Date(today);
  from.setDate(from.getDate() - days);
  return { from: ymd(from), to };
}

function formatDateHeader(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", weekday: "short" });
}

export function PartnerCashStatement() {
  const navigate = useNavigate();
  const [account, setAccount] = useState<CashAccount | "all">("all");
  const [direction, setDirection] = useState<"all" | "in" | "out">("all");
  const [preset, setPreset] = useState<RangePreset>("month");

  const [entries, setEntries] = useState<CashLedgerEntry[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const { from, to } = rangeFor(preset);
    const filter: CashLedgerFilter = { from, to };
    if (account !== "all") filter.account = account;
    if (direction !== "all") filter.direction = direction;
    const startedAt = Date.now();
    fetchCashLedger(filter).then((rows) => {
      if (!alive) return;
      const elapsed = Date.now() - startedAt;
      const wait = Math.max(0, 300 - elapsed);
      setTimeout(() => {
        if (!alive) return;
        setEntries(rows);
        setLoading(false);
      }, wait);
    });
    return () => {
      alive = false;
    };
  }, [account, direction, preset]);

  const grouped = useMemo(() => groupByDate(entries || []), [entries]);
  const totals = useMemo(() => computeTotals(entries || []), [entries]);

  return (
    <div className="h-[100dvh] bg-white flex flex-col max-w-md mx-auto border-x border-[var(--color-border-hairline)]">
      <header className="h-14 bg-white border-b border-[var(--color-border-hairline)] flex items-center px-4 shrink-0">
        <button
          onClick={() => navigate(-1)}
          className="p-2 -ml-2 mr-2 text-[var(--color-text-primary)]"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" strokeWidth={1.5} />
        </button>
        <h1 className="text-base font-semibold">Statement</h1>
      </header>

      {/* Filters */}
      <div className="px-4 py-3 border-b border-[var(--color-border-hairline)] shrink-0 space-y-2">
        <ChipRow
          options={[
            { value: "all", label: "All accounts" },
            { value: "tmb", label: "TMB" },
            { value: "iobCa", label: "IOB CA" },
            { value: "cashbookApp", label: "Cashbook App" },
            { value: "cash", label: "Cash" },
            { value: "iobCc", label: "IOB CC" },
          ]}
          value={account}
          onChange={(v) => setAccount(v as CashAccount | "all")}
        />
        <div className="flex items-center justify-between gap-2">
          <ChipRow
            options={[
              { value: "all", label: "All" },
              { value: "in", label: "In" },
              { value: "out", label: "Out" },
            ]}
            value={direction}
            onChange={(v) => setDirection(v as "all" | "in" | "out")}
          />
          <ChipRow
            options={[
              { value: "month", label: "This month" },
              { value: "30d", label: "30d" },
              { value: "90d", label: "90d" },
            ]}
            value={preset}
            onChange={(v) => setPreset(v as RangePreset)}
          />
        </div>
      </div>

      <main className="flex-1 min-h-0 overflow-y-auto relative">
        {loading && entries === null && <StatementSkeleton />}

        {loading && entries !== null && (
          <div className="absolute inset-0 bg-white/60 flex items-start justify-center pt-10 z-10">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--color-text-secondary)]" strokeWidth={1.75} />
          </div>
        )}

        {!loading && entries !== null && entries.length === 0 && (
          <div className="px-4 py-10 text-center">
            <p className="text-[14px] text-[var(--color-text-secondary)]">No entries in this range.</p>
          </div>
        )}

        {entries !== null && entries.length > 0 && (
          <div>
            {grouped.map((g) => (
              <div key={g.date}>
                <div className="sticky top-0 z-[1] bg-[var(--color-bg-canvas,#fafafa)] px-4 py-1.5 text-[11px] uppercase tracking-wide text-[var(--color-text-secondary)] border-b border-[var(--color-border-hairline)]">
                  {formatDateHeader(g.date)}
                </div>
                {g.entries.map((e, i) => (
                  <EntryRow key={`${g.date}-${i}`} entry={e} />
                ))}
              </div>
            ))}
          </div>
        )}
      </main>

      {entries !== null && entries.length > 0 && (
        <footer className="shrink-0 border-t border-[var(--color-border-hairline)] bg-white px-4 py-2.5 flex items-center justify-between text-[12px] tabular-nums">
          <span className="text-[var(--color-status-green)] font-medium">In {fmtINR(totals.inflow)}</span>
          <span className="text-[var(--color-status-red)] font-medium">Out {fmtINR(totals.outflow)}</span>
          <span className="text-[var(--color-text-primary)] font-semibold">Net {fmtINR(totals.net)}</span>
        </footer>
      )}
    </div>
  );
}

function EntryRow({ entry }: { entry: CashLedgerEntry }) {
  const positive = entry.amount > 0;
  return (
    <div className="px-4 py-2.5 border-b border-[var(--color-border-hairline)] flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] text-[var(--color-text-primary)] truncate">{entry.description || "—"}</p>
        <p className="text-[11px] text-[var(--color-text-secondary)] mt-0.5 truncate">
          {ACCOUNT_LABEL[entry.account] || entry.account}
          {entry.category ? ` · ${entry.category}` : ""}
        </p>
      </div>
      <span
        className={`text-[14px] font-medium tabular-nums shrink-0 ${
          positive ? "text-[var(--color-status-green)]" : "text-[var(--color-status-red)]"
        }`}
      >
        {fmtINR(entry.amount)}
      </span>
    </div>
  );
}

function ChipRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 no-scrollbar">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`shrink-0 px-3 py-1 rounded-full text-[12px] border ${
              active
                ? "bg-[var(--color-text-primary)] text-white border-[var(--color-text-primary)]"
                : "bg-white text-[var(--color-text-secondary)] border-[var(--color-border-hairline)]"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function StatementSkeleton() {
  return (
    <div className="animate-pulse">
      {[0, 1].map((g) => (
        <div key={g}>
          <div className="px-4 py-1.5 border-b border-[var(--color-border-hairline)]">
            <div className="h-3 w-32 bg-black/[0.06] rounded" />
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="px-4 py-3 border-b border-[var(--color-border-hairline)] flex justify-between">
              <div className="space-y-1.5 flex-1">
                <div className="h-3 w-44 bg-black/[0.06] rounded" />
                <div className="h-2.5 w-24 bg-black/[0.06] rounded" />
              </div>
              <div className="h-3 w-16 bg-black/[0.06] rounded" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function groupByDate(entries: CashLedgerEntry[]): { date: string; entries: CashLedgerEntry[] }[] {
  const map = new Map<string, CashLedgerEntry[]>();
  for (const e of entries) {
    const list = map.get(e.date) || [];
    list.push(e);
    map.set(e.date, list);
  }
  return Array.from(map.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([date, entries]) => ({ date, entries }));
}

function computeTotals(entries: CashLedgerEntry[]): { inflow: number; outflow: number; net: number } {
  let inflow = 0;
  let outflow = 0;
  for (const e of entries) {
    if (e.amount > 0) inflow += e.amount;
    else outflow += e.amount;
  }
  return { inflow, outflow, net: inflow + outflow };
}
