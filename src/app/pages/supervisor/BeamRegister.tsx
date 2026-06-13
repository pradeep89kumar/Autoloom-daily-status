import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  MagnifyingGlass,
  Warning,
  X,
  Factory,
  CheckCircle,
  Gear,
  CircleDashed,
  CloudSlash,
  ArrowClockwise,
  ArrowBendDownLeft,
  SquaresFour,
  type Icon,
} from "@phosphor-icons/react";
import { getBeamSource } from "../../lib/beamSource";
import {
  BEAM_STATE_META,
  compareBeamId,
  type Beam,
  type BeamRegisterData,
  type BeamState,
  type ReadyWarp,
} from "../../lib/beams";

/** Active list filter — the four lifecycle states, or the master flat list. */
type Filter = BeamState | "all";

/* Phosphor icon per lifecycle state. */
const STATE_ICON: Record<BeamState, Icon> = {
  vendor: Factory,
  ready: CheckCircle,
  loaded: Gear,
  empty: CircleDashed,
};

export function BeamRegister() {
  const [data, setData] = useState<BeamRegisterData | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Filter>("ready");
  const [query, setQuery] = useState("");

  const load = () => {
    let alive = true;
    const src = getBeamSource();
    setLoading(true);
    setError(false);
    src
      .getBeamRegister()
      .then((d) => {
        if (!alive) return;
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setData(null);
        setError(true);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  };

  useEffect(load, []);

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  const matches = useMemo(() => {
    if (!data || !searching) return [];
    const hit = (s: string | undefined) => !!s && s.toLowerCase().includes(q);
    return data.beams.filter(
      (b) => hit(b.id) || hit(b.rawId) || hit(b.design) || hit(b.vendor) || hit(b.loom) || hit(b.customer),
    );
  }, [data, q, searching]);

  const matchedStates = useMemo(() => new Set(matches.map((m) => m.state)), [matches]);

  return (
    <div className="pb-10">
      {loading && <BeamSkeleton />}

      {!loading && error && <BeamError onRetry={load} />}

      {!loading && !error && data && (
        <>
          {/* Looms-first floor strip — running looms, ready buffer, supply line */}
          <FloorStrip
            data={data}
            selected={selected}
            highlight={searching ? matchedStates : null}
            onSelect={(s) => {
              setSelected(s);
              setQuery("");
            }}
          />

          {/* Search */}
          <div className="px-4 mt-1 mb-3">
            <div className="relative">
              <MagnifyingGlass
                className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
                weight="bold"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a beam — VVK-4, design, vendor…"
                className="w-full h-10 pl-9 pr-9 rounded-lg border border-[var(--color-border-hairline)] text-[14px] bg-white focus:outline-none focus:border-[var(--color-text-primary)]"
              />
              {searching && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[var(--color-text-secondary)]"
                  aria-label="Clear"
                >
                  <X className="w-4 h-4" weight="bold" />
                </button>
              )}
            </div>
          </div>

          {/* Integrity note — ready-warp reconciliation only */}
          {!data.integrity.ok && !searching && selected === "ready" && (
            <div className="mx-4 mb-3 rounded-lg bg-[color-mix(in_srgb,var(--color-status-amber)_8%,white)] border border-[color-mix(in_srgb,var(--color-status-amber)_30%,white)] px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--color-status-amber)] mb-1">
                <Warning className="w-4 h-4" weight="fill" />
                Sheet data gap
              </div>
              {data.integrity.notes.map((n, i) => (
                <p key={i} className="text-[12px] text-[var(--color-text-secondary)] leading-relaxed">
                  {n}
                </p>
              ))}
            </div>
          )}

          {/* List area */}
          {searching ? (
            <SearchResults matches={matches} onClear={() => setQuery("")} />
          ) : selected === "all" ? (
            <AllSection data={data} />
          ) : selected === "ready" ? (
            <ReadySection data={data} />
          ) : (
            <StationSection state={selected} beams={data.beams.filter((b) => b.state === selected)} />
          )}
        </>
      )}
    </div>
  );
}

function BeamError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="px-6 py-16 flex flex-col items-center text-center">
      <CloudSlash className="w-12 h-12 text-[var(--color-text-tertiary)]" weight="duotone" />
      <h3 className="mt-4 text-[15px] font-bold text-[var(--color-text-primary)]">
        Beam data not connected yet
      </h3>
      <p className="mt-1.5 text-[13px] text-[var(--color-text-secondary)] leading-relaxed max-w-[260px]">
        The beam sheet sync is not set up. Beam tracking will appear here once the backend is configured.
      </p>
      <button
        onClick={onRetry}
        className="mt-5 inline-flex items-center gap-1.5 px-4 h-10 rounded-lg border border-[var(--color-border-hairline)] text-[14px] font-semibold text-[var(--color-text-primary)] hover:bg-gray-50"
      >
        <ArrowClockwise className="w-4 h-4" weight="bold" />
        Retry
      </button>
    </div>
  );
}

/* -------------------------- looms-first floor -------------------------- */
/**
 * Concept B — the floor at a glance, in three stacked zones, each a filter:
 *   • On the looms  — every loaded beam as a spindle (loom no + design).
 *   • Ready buffer  — the warps staged in SAT, feeding the looms.
 *   • Supply line   — empty (run out) → vendor (re-warping), the refill pipe.
 * Tapping any zone (or its header) filters the list below to that state.
 */
function FloorStrip({
  data,
  selected,
  highlight,
  onSelect,
}: {
  data: BeamRegisterData;
  selected: Filter;
  highlight: Set<BeamState> | null;
  onSelect: (s: Filter) => void;
}) {
  const looms = data.beams.filter((b) => b.state === "loaded").sort(byLoom);
  const ready = data.readyWarps;
  const tokens = BEAM_STATE_META;

  return (
    <div className="px-4 pt-4">
      {/* zone: on the looms */}
      <ZoneHeader
        token={tokens.loaded.token}
        label="On the looms"
        count={data.counts.loaded}
        active={selected === "loaded"}
        highlighted={highlight?.has("loaded") ?? false}
        onClick={() => onSelect("loaded")}
      />
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {looms.length === 0 ? (
          <Hint>No looms running</Hint>
        ) : (
          looms.map((b) => (
            <button
              key={b.id}
              onClick={() => onSelect("loaded")}
              className="group flex flex-col items-stretch rounded-lg overflow-hidden border bg-white active:scale-[0.97] transition-transform"
              style={{ borderColor: `color-mix(in srgb, ${tokens.loaded.token} 35%, var(--color-border-hairline))`, minWidth: 52 }}
            >
              <span
                className="text-[10px] font-bold tabular-nums text-center py-0.5 text-white leading-none"
                style={{ background: tokens.loaded.token }}
              >
                {fmtLoom(b.loom)}
              </span>
              <span className="text-[10px] font-semibold text-[var(--color-text-primary)] text-center px-1.5 py-1 leading-tight truncate max-w-[88px]">
                {b.design || "—"}
              </span>
            </button>
          ))
        )}
      </div>

      {/* feed arrow */}
      <div className="flex justify-center my-1.5">
        <ArrowBendDownLeft className="w-3.5 h-3.5 text-[var(--color-text-tertiary)] rotate-90" weight="bold" />
      </div>

      {/* zone: ready buffer */}
      <ZoneHeader
        token={tokens.ready.token}
        label="Ready buffer"
        count={ready.length}
        active={selected === "ready"}
        highlighted={highlight?.has("ready") ?? false}
        onClick={() => onSelect("ready")}
      />
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {ready.length === 0 ? (
          <Hint>Buffer empty — nothing staged</Hint>
        ) : (
          ready.map((w, i) => (
            <button
              key={i}
              onClick={() => onSelect("ready")}
              className="rounded-lg border px-2 py-1.5 active:scale-[0.97] transition-transform"
              style={{ background: `color-mix(in srgb, ${tokens.ready.token} 9%, white)`, borderColor: `color-mix(in srgb, ${tokens.ready.token} 35%, var(--color-border-hairline))` }}
            >
              <span className="block text-[10px] font-semibold text-[var(--color-text-primary)] leading-tight truncate max-w-[96px]">
                {w.design}
              </span>
              {w.meters != null && (
                <span className="block text-[9px] tabular-nums text-[var(--color-text-secondary)] leading-none mt-0.5">
                  {w.meters} m
                </span>
              )}
            </button>
          ))
        )}
      </div>

      {/* zone: supply line (empty → vendor) */}
      <div className="mt-3 flex items-stretch gap-2">
        <SupplyCell
          token={tokens.empty.token}
          icon={STATE_ICON.empty}
          label="Empty"
          sub="run out"
          count={data.counts.empty}
          active={selected === "empty"}
          highlighted={highlight?.has("empty") ?? false}
          onClick={() => onSelect("empty")}
        />
        <div className="flex items-center">
          <ArrowClockwise className="w-3.5 h-3.5 text-[var(--color-text-tertiary)]" weight="bold" />
        </div>
        <SupplyCell
          token={tokens.vendor.token}
          icon={STATE_ICON.vendor}
          label="At vendor"
          sub="re-warping"
          count={data.counts.vendor}
          active={selected === "vendor"}
          highlighted={highlight?.has("vendor") ?? false}
          onClick={() => onSelect("vendor")}
        />
      </div>

      {/* master flat list trigger */}
      <button
        onClick={() => onSelect("all")}
        aria-pressed={selected === "all"}
        className="mt-3 w-full flex items-center justify-center gap-1.5 h-9 rounded-lg border text-[12px] font-semibold transition-colors active:scale-[0.98]"
        style={{
          borderColor: selected === "all" ? "var(--color-text-primary)" : "var(--color-border-hairline)",
          background: selected === "all" ? "color-mix(in srgb, var(--color-text-primary) 6%, white)" : "white",
          color: "var(--color-text-primary)",
        }}
      >
        <SquaresFour className="w-4 h-4" weight={selected === "all" ? "fill" : "regular"} />
        All {data.total} beams
      </button>
    </div>
  );
}

function ZoneHeader({
  token,
  label,
  count,
  active,
  highlighted,
  onClick,
}: {
  token: string;
  label: string;
  count: number;
  active: boolean;
  highlighted: boolean;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} aria-pressed={active} className="w-full flex items-center gap-2 group">
      <span className="w-1 h-3.5 rounded-full" style={{ background: token, opacity: active || highlighted ? 1 : 0.5 }} />
      <span
        className="text-[12px] font-bold"
        style={{ color: active ? token : "var(--color-text-primary)" }}
      >
        {label}
      </span>
      <span
        className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full"
        style={{ background: `color-mix(in srgb, ${token} 14%, white)`, color: token }}
      >
        {count}
      </span>
      {(active || highlighted) && <span className="ml-auto text-[10px] font-semibold" style={{ color: token }}>showing</span>}
    </button>
  );
}

function SupplyCell({
  token,
  icon: SupplyIcon,
  label,
  sub,
  count,
  active,
  highlighted,
  onClick,
}: {
  token: string;
  icon: Icon;
  label: string;
  sub: string;
  count: number;
  active: boolean;
  highlighted: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className="flex-1 flex items-center gap-2 rounded-xl border px-3 py-2 transition-colors active:scale-[0.97]"
      style={{
        borderColor: active || highlighted ? token : "var(--color-border-hairline)",
        background: active ? `color-mix(in srgb, ${token} 10%, white)` : "white",
        boxShadow: active ? `inset 0 0 0 1px ${token}` : "none",
      }}
    >
      <SupplyIcon style={{ color: token, width: 16, height: 16 }} weight={active ? "fill" : "duotone"} />
      <span className="flex flex-col items-start leading-none">
        <span className="text-[15px] font-bold tabular-nums" style={{ color: token }}>{count}</span>
        <span className="text-[10px] text-[var(--color-text-secondary)] mt-0.5">{label} · {sub}</span>
      </span>
    </button>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <span className="text-[11px] text-[var(--color-text-tertiary)] py-1">{children}</span>;
}

/* ----------------------------- sections ----------------------------- */
function StationSection({ state, beams }: { state: BeamState; beams: Beam[] }) {
  const meta = BEAM_STATE_META[state];
  // Looms run in number order — list loaded beams in loom sequence.
  const ordered = state === "loaded" ? [...beams].sort(byLoom) : beams;
  return (
    <div className="px-4">
      <SectionHeader state={state} count={ordered.length} />
      {ordered.length === 0 ? (
        <Empty label={`No beams ${meta.label.toLowerCase()}`} />
      ) : (
        <div className="flex flex-col gap-2">
          {ordered.map((b) => (
            <BeamCard key={b.id} beam={b} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Loom display: bare number → "L8"; already-prefixed stays as-is. */
function fmtLoom(loom?: string): string {
  if (!loom) return "";
  const t = loom.trim();
  return /^l/i.test(t) ? t.toUpperCase() : `L${t}`;
}

/** Sort beams by loom number ascending; non-numeric looms sink to the end. */
function byLoom(a: Beam, b: Beam): number {
  const na = parseInt(a.loom ?? "", 10);
  const nb = parseInt(b.loom ?? "", 10);
  if (Number.isNaN(na) && Number.isNaN(nb)) return 0;
  if (Number.isNaN(na)) return 1;
  if (Number.isNaN(nb)) return -1;
  return na - nb;
}

function ReadySection({ data }: { data: BeamRegisterData }) {
  const warps = data.readyWarps;
  return (
    <div className="px-4">
      <SectionHeader state="ready" count={warps.length} />
      {warps.length === 0 ? (
        <Empty label="No warps ready to load" />
      ) : (
        <div className="flex flex-col gap-2">
          {warps.map((w, i) => (
            <ReadyWarpCard key={i} warp={w} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Master flat list — every beam at once, in lifecycle then id order. */
function AllSection({ data }: { data: BeamRegisterData }) {
  const order: Record<BeamState, number> = { loaded: 0, ready: 1, empty: 2, vendor: 3 };
  const all = [...data.beams].sort(
    (a, b) => order[a.state] - order[b.state] || compareBeamId(a.id, b.id),
  );
  return (
    <div className="px-4">
      <div className="flex items-center gap-2 mb-2.5 mt-1">
        <SquaresFour className="w-4 h-4 text-[var(--color-text-primary)]" weight="fill" />
        <span className="text-[14px] font-bold text-[var(--color-text-primary)]">All beams</span>
        <span className="text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded-full bg-[var(--color-bg-base)] text-[var(--color-text-secondary)]">
          {all.length}
        </span>
      </div>
      {all.length === 0 ? (
        <Empty label="No beams" />
      ) : (
        <div className="flex flex-col gap-2">
          {all.map((b) => (
            <BeamCard key={b.id} beam={b} showState />
          ))}
        </div>
      )}
    </div>
  );
}

function SearchResults({ matches, onClear }: { matches: Beam[]; onClear: () => void }) {
  return (
    <div className="px-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] font-semibold text-[var(--color-text-secondary)]">
          {matches.length} match{matches.length === 1 ? "" : "es"}
        </span>
        <button onClick={onClear} className="text-[12px] text-[var(--color-brand-primary)] font-medium">
          Clear
        </button>
      </div>
      {matches.length === 0 ? (
        <Empty label="No beam found" />
      ) : (
        <div className="flex flex-col gap-2">
          {matches.map((b) => (
            <BeamCard key={b.id} beam={b} showState />
          ))}
        </div>
      )}
    </div>
  );
}

function SectionHeader({ state, count }: { state: BeamState; count: number }) {
  const meta = BEAM_STATE_META[state];
  const StateIcon = STATE_ICON[state];
  return (
    <div className="flex items-center gap-2 mb-2.5 mt-1">
      <StateIcon style={{ color: meta.token, width: 16, height: 16 }} weight="fill" />
      <span className="text-[14px] font-bold text-[var(--color-text-primary)]">{meta.label}</span>
      <span
        className="text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded-full"
        style={{ background: `color-mix(in srgb, ${meta.token} 14%, white)`, color: meta.token }}
      >
        {count}
      </span>
    </div>
  );
}

/* ------------------------------ cards ------------------------------ */
/**
 * Asset id as a little ticket stub — a notched left edge (the perforation),
 * monospace id, and a faint origin tint (VVK group vs SAT group) so a physical
 * beam reads as a tracked object wherever it appears, not plain text.
 */
function AssetId({ id, rawId }: { id: string; rawId?: string }) {
  const label = (rawId && rawId.trim()) || id;
  const isVvk = /^vvk/i.test(id);
  const tint = isVvk ? "var(--color-brand-primary)" : "var(--color-status-amber)";
  return (
    <span
      className="relative inline-flex items-center pl-2.5 pr-2 py-0.5 rounded-[5px] text-[11px] font-bold tracking-tight tabular-nums"
      style={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        background: `color-mix(in srgb, ${tint} 12%, white)`,
        color: `color-mix(in srgb, ${tint} 65%, var(--color-text-primary))`,
        border: `1px solid color-mix(in srgb, ${tint} 30%, var(--color-border-hairline))`,
      }}
    >
      {/* perforation notch */}
      <span
        className="absolute left-[3px] top-1/2 -translate-y-1/2 flex flex-col gap-[2px]"
        aria-hidden
      >
        <span className="block w-[2px] h-[2px] rounded-full" style={{ background: tint, opacity: 0.55 }} />
        <span className="block w-[2px] h-[2px] rounded-full" style={{ background: tint, opacity: 0.55 }} />
        <span className="block w-[2px] h-[2px] rounded-full" style={{ background: tint, opacity: 0.55 }} />
      </span>
      {label}
    </span>
  );
}

function BeamCard({ beam, showState }: { beam: Beam; showState?: boolean }) {
  const meta = BEAM_STATE_META[beam.state];
  const StateIcon = STATE_ICON[beam.state];
  const isLoaded = beam.state === "loaded";
  // A real physical id was read from the sheet (ready warps often have none).
  const hasAssetId = !!(beam.rawId && beam.rawId.trim());

  return (
    <div
      className="rounded-xl bg-white border px-3.5 py-3 flex items-center justify-between gap-3"
      style={{ borderColor: `color-mix(in srgb, ${meta.token} 28%, var(--color-border-hairline))` }}
    >
      <div className="min-w-0">
        {isLoaded ? (
          // Design is the headline on a running loom; asset id is the stub below.
          <>
            <div className="text-[15px] font-bold text-[var(--color-text-primary)] truncate">
              {beam.design || "Running"}
            </div>
            <div className="flex items-center gap-2 mt-1">
              {hasAssetId && <AssetId id={beam.id} rawId={beam.rawId} />}
              {showState && <StateBadge meta={meta} StateIcon={StateIcon} />}
            </div>
          </>
        ) : hasAssetId ? (
          <>
            <div className="flex items-center gap-2">
              <AssetId id={beam.id} rawId={beam.rawId} />
              {showState && <StateBadge meta={meta} StateIcon={StateIcon} />}
            </div>
            <div className="text-[12px] text-[var(--color-text-secondary)] mt-1 truncate">
              {subtitle(beam)}
            </div>
          </>
        ) : (
          // No physical id (ready warp) — lead with the design, no stub.
          <>
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-bold text-[var(--color-text-primary)] truncate">
                {beam.design || subtitle(beam)}
              </span>
              {showState && <StateBadge meta={meta} StateIcon={StateIcon} />}
            </div>
            <div className="text-[12px] text-[var(--color-text-secondary)] mt-0.5 truncate">
              {beam.design ? "Ready to load" : subtitle(beam)}
            </div>
          </>
        )}
      </div>
      <div className="text-right shrink-0">
        {isLoaded && beam.loom && (
          <span className="text-[13px] font-bold text-[var(--color-brand-primary)] tabular-nums">{fmtLoom(beam.loom)}</span>
        )}
        {beam.state === "vendor" && (
          <span className="text-[12px] font-semibold text-[var(--color-status-amber)]">{beam.vendor}</span>
        )}
        {beam.meters != null && (
          <div className="text-[12px] text-[var(--color-text-secondary)] tabular-nums">{beam.meters} m</div>
        )}
      </div>
    </div>
  );
}

function StateBadge({ meta, StateIcon }: { meta: { label: string; token: string }; StateIcon: Icon }) {
  return (
    <span
      className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full inline-flex items-center gap-1"
      style={{ background: `color-mix(in srgb, ${meta.token} 14%, white)`, color: meta.token }}
    >
      <StateIcon style={{ width: 11, height: 11 }} weight="fill" />
      {meta.label}
    </span>
  );
}

function subtitle(b: Beam): string {
  switch (b.state) {
    case "loaded":
      return [b.design, b.customer, b.roDate ? `R.O ${b.roDate}` : ""].filter(Boolean).join(" · ") || "Running";
    case "ready":
      return b.design || "Warped · ready to load";
    case "vendor":
      return "Being warped";
    case "empty":
      return "Run out · needs re-warp";
  }
}

function ReadyWarpCard({ warp }: { warp: ReadyWarp }) {
  const meta = BEAM_STATE_META.ready;
  return (
    <div
      className="rounded-xl bg-white border px-3.5 py-3 flex items-center justify-between gap-3"
      style={{ borderColor: `color-mix(in srgb, ${meta.token} 28%, var(--color-border-hairline))` }}
    >
      <div className="min-w-0">
        <div className="text-[15px] font-bold text-[var(--color-text-primary)] truncate">{warp.design}</div>
        <div className="text-[12px] text-[var(--color-text-secondary)] mt-0.5">
          {warp.beamId ? `Beam ${warp.beamId}` : "Ready to load"}
        </div>
      </div>
      {warp.meters != null && (
        <span className="text-[13px] font-semibold text-[var(--color-text-secondary)] tabular-nums shrink-0">
          {warp.meters} m
        </span>
      )}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="py-8 text-center text-[13px] text-[var(--color-text-tertiary)]">{label}</div>
  );
}

function BeamSkeleton() {
  return (
    <div className="px-4 pt-6 animate-pulse">
      <div className="w-full max-w-[330px] mx-auto aspect-square rounded-2xl bg-gray-100" />
      <div className="h-10 bg-gray-100 rounded-lg mt-4" />
      <div className="flex flex-col gap-2 mt-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 bg-gray-100 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
