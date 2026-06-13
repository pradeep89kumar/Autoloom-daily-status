import { useEffect, useMemo, useState, Fragment } from "react";
import {
  MagnifyingGlass,
  X,
  Factory,
  CheckCircle,
  Gear,
  CircleDashed,
  CloudSlash,
  ArrowClockwise,
  CaretRight,
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

/* -------------------------- lifecycle pipeline -------------------------- */
/**
 * The beam lifecycle as a simple four-stage pipeline, each stage a filter:
 *   Empty → Warping → Ready → Loaded
 * An empty beam is sent out to warping, returns ready, is loaded on a loom,
 * then runs out back to empty. Tapping a stage filters the list below to it.
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
  const stages: BeamState[] = ["empty", "vendor", "ready", "loaded"];

  return (
    <div className="px-4 pt-4">
      <div className="flex items-stretch gap-0.5">
        {stages.map((state, i) => (
          <Fragment key={state}>
            {i > 0 && (
              <div className="flex items-center self-center shrink-0">
                <CaretRight className="w-3 h-3 text-[var(--color-text-tertiary)]" weight="bold" />
              </div>
            )}
            <StageChip
              state={state}
              count={data.counts[state]}
              active={selected === state}
              highlighted={highlight?.has(state) ?? false}
              onClick={() => onSelect(state)}
            />
          </Fragment>
        ))}
      </div>

      {/* master flat list trigger */}
      <button
        onClick={() => onSelect("all")}
        aria-pressed={selected === "all"}
        className="mt-2.5 w-full flex items-center justify-center gap-1.5 h-9 rounded-lg border text-[12px] font-semibold transition-colors active:scale-[0.98]"
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

function StageChip({
  state,
  count,
  active,
  highlighted,
  onClick,
}: {
  state: BeamState;
  count: number;
  active: boolean;
  highlighted: boolean;
  onClick: () => void;
}) {
  const meta = BEAM_STATE_META[state];
  const StageIcon = STATE_ICON[state];
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className="flex-1 min-w-0 flex flex-col items-center gap-1 rounded-xl border px-1 py-2.5 transition-colors active:scale-[0.97]"
      style={{
        borderColor: active || highlighted ? meta.token : "var(--color-border-hairline)",
        background: active ? meta.token : "white",
      }}
    >
      <StageIcon
        style={{ color: active ? "white" : meta.token, width: 17, height: 17 }}
        weight={active ? "fill" : "duotone"}
      />
      <span
        className="text-[18px] font-bold tabular-nums leading-none"
        style={{ color: active ? "white" : "var(--color-text-primary)" }}
      >
        {count}
      </span>
      <span
        className="text-[10px] font-semibold leading-none text-center"
        style={{ color: active ? "rgba(255,255,255,0.9)" : "var(--color-text-secondary)" }}
      >
        {meta.label}
      </span>
    </button>
  );
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
  const ready = data.beams
    .filter((b) => b.state === "ready")
    .sort((a, b) => compareBeamId(a.id, b.id));
  const warps = data.readyWarps;
  return (
    <div className="px-4">
      <SectionHeader state="ready" count={ready.length} />

      {/* Derivation note — how the ready list is arrived at. */}
      <div className="mb-3 rounded-lg bg-[color-mix(in_srgb,var(--color-status-green)_7%,white)] border border-[color-mix(in_srgb,var(--color-status-green)_28%,white)] px-3 py-2.5">
        <p className="text-[12px] text-[var(--color-text-secondary)] leading-relaxed">
          Ready to load is derived from the master list: any beam in SAT that is not
          loaded on a loom, empty, or out warping. These assets are available to take
          the next warp.
        </p>
      </div>

      {ready.length === 0 ? (
        <Empty label="No beams ready to load" />
      ) : (
        <div className="flex flex-col gap-2">
          {ready.map((b) => (
            <BeamCard key={b.id} beam={b} />
          ))}
        </div>
      )}

      {/* Staged warps — warps wound in SAT with no beam id recorded yet. */}
      {warps.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[13px] font-bold text-[var(--color-text-primary)]">Warps staged in SAT</span>
            <span className="text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded-full bg-[var(--color-bg-base)] text-[var(--color-text-secondary)]">
              {warps.length}
            </span>
          </div>
          <p className="text-[12px] text-[var(--color-text-tertiary)] leading-relaxed mb-2">
            Warps wound and waiting in SAT. The sheet records no beam id for these yet.
          </p>
          <div className="flex flex-col gap-2">
            {warps.map((w, i) => (
              <ReadyWarpCard key={i} warp={w} />
            ))}
          </div>
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
 * Asset id as a small machined plate — neutral, monospace, with a dot at each
 * of the four corners like the screws on a luggage tag. The id itself carries
 * the SAT / VVK prefix; the treatment is identical for every beam.
 */
function AssetId({ id }: { id: string }) {
  const screw =
    "absolute w-[2.5px] h-[2.5px] rounded-full bg-[var(--color-text-tertiary)]";
  return (
    <span
      className="relative inline-flex items-center justify-center px-3 py-1 rounded-[5px] text-[11px] font-bold tracking-tight tabular-nums text-[var(--color-text-primary)] bg-[var(--color-bg-base)] border border-[var(--color-border-hairline)]"
      style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
    >
      <span className={`${screw} left-[3px] top-[3px]`} aria-hidden />
      <span className={`${screw} right-[3px] top-[3px]`} aria-hidden />
      <span className={`${screw} left-[3px] bottom-[3px]`} aria-hidden />
      <span className={`${screw} right-[3px] bottom-[3px]`} aria-hidden />
      {id}
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
              {hasAssetId && <AssetId id={beam.id} />}
              {showState && <StateBadge meta={meta} StateIcon={StateIcon} />}
            </div>
          </>
        ) : hasAssetId ? (
          <>
            <div className="flex items-center gap-2">
              <AssetId id={beam.id} />
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
