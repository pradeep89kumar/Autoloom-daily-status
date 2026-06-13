import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { MagnifyingGlass, Warning, X } from "@phosphor-icons/react";
import { getBeamSource } from "../../lib/beamSource";
import {
  BEAM_STATE_META,
  type Beam,
  type BeamRegisterData,
  type BeamState,
  type ReadyWarp,
} from "../../lib/beams";

/* Cyclic order of the lifecycle, drawn clockwise from the top. */
const CYCLE: BeamState[] = ["vendor", "ready", "loaded", "empty"];

export function BeamRegister() {
  const navigate = useNavigate();
  const [data, setData] = useState<BeamRegisterData | null>(null);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<BeamState>("ready");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    const src = getBeamSource();
    setLoading(true);
    src.getBeamRegister().then((d) => {
      if (!alive) return;
      setData(d);
      setLive(src.isLive);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

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
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-[var(--color-border-hairline)]">
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-bold text-[var(--color-text-primary)]">Beam Register</h2>
          {data && (
            <span className="text-[12px] text-[var(--color-text-secondary)] tabular-nums">
              {data.total} beams
            </span>
          )}
        </div>
        {!loading && !live && (
          <p className="text-[11px] text-[var(--color-status-amber)] mt-0.5">
            Sample data — live sheet not connected yet
          </p>
        )}
      </div>

      {loading && <BeamSkeleton />}

      {!loading && data && (
        <>
          {/* Pictorial lifecycle */}
          <LifecycleDiagram
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

          {/* Integrity note */}
          {!data.integrity.ok && !searching && (
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
          ) : selected === "ready" ? (
            <ReadySection data={data} />
          ) : (
            <StationSection state={selected} beams={data.beams.filter((b) => b.state === selected)} />
          )}
        </>
      )}

      {/* Back to floor */}
      <div className="px-4 mt-6">
        <button
          onClick={() => navigate("/supervisor")}
          className="w-full h-11 rounded-lg border border-[var(--color-border-hairline)] text-[14px] font-semibold text-[var(--color-text-primary)] hover:bg-gray-50"
        >
          Back to looms
        </button>
      </div>
    </div>
  );
}

/* ----------------------------- diagram ----------------------------- */
function LifecycleDiagram({
  data,
  selected,
  highlight,
  onSelect,
}: {
  data: BeamRegisterData;
  selected: BeamState;
  highlight: Set<BeamState> | null;
  onSelect: (s: BeamState) => void;
}) {
  // Node centres on a circle (viewBox 0..100), clockwise from top.
  const R = 37;
  const pos: Record<BeamState, { x: number; y: number }> = {
    vendor: { x: 50, y: 50 - R },
    ready: { x: 50 + R, y: 50 },
    loaded: { x: 50, y: 50 + R },
    empty: { x: 50 - R, y: 50 },
  };
  // Arc connectors between consecutive stations (clockwise).
  const arcs = CYCLE.map((from, i) => {
    const to = CYCLE[(i + 1) % CYCLE.length];
    return arcPath(pos[from], pos[to], R, 13);
  });

  return (
    <div className="px-4 pt-4">
      <div className="relative w-full max-w-[330px] mx-auto aspect-square">
        {/* arrows behind the nodes */}
        <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full">
          <defs>
            <marker id="bm-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--color-text-tertiary)" />
            </marker>
          </defs>
          {arcs.map((d, i) => (
            <path
              key={i}
              d={d}
              fill="none"
              stroke="var(--color-text-tertiary)"
              strokeWidth={0.9}
              strokeLinecap="round"
              markerEnd="url(#bm-arrow)"
              opacity={0.5}
            />
          ))}
        </svg>

        {/* centre label */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
          <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)] leading-tight">
            lifecycle
          </div>
          <div className="text-[20px] font-bold tabular-nums text-[var(--color-text-primary)] leading-tight">
            {data.total}
          </div>
          <div className="text-[10px] text-[var(--color-text-tertiary)] leading-tight">beams</div>
        </div>

        {/* nodes */}
        {CYCLE.map((s) => {
          const meta = BEAM_STATE_META[s];
          const isSel = selected === s;
          const isHi = highlight?.has(s) ?? false;
          const isHero = s === "ready";
          const size = isHero ? 92 : 84;
          return (
            <button
              key={s}
              onClick={() => onSelect(s)}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-2xl flex flex-col items-center justify-center transition-all"
              style={{
                left: `${pos[s].x}%`,
                top: `${pos[s].y}%`,
                width: size,
                height: size,
                background: isSel ? `color-mix(in srgb, ${meta.token} 12%, white)` : "white",
                border: `2px solid ${isSel || isHi ? meta.token : "var(--color-border-hairline)"}`,
                boxShadow: isHi
                  ? `0 0 0 3px color-mix(in srgb, ${meta.token} 35%, transparent)`
                  : isSel
                  ? "0 2px 8px rgba(0,0,0,0.08)"
                  : "0 1px 3px rgba(0,0,0,0.05)",
              }}
            >
              <span className="text-[18px] leading-none mb-0.5">{meta.emoji}</span>
              <span
                className="text-[22px] font-bold tabular-nums leading-none"
                style={{ color: meta.token }}
              >
                {data.counts[s]}
              </span>
              <span className="text-[10px] font-medium text-[var(--color-text-secondary)] mt-0.5 leading-tight">
                {meta.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** SVG arc between two points on a circle of radius R about (50,50), trimmed by
 *  `gapDeg` at each end so it doesn't overlap the nodes; arrowhead at the end. */
function arcPath(
  a: { x: number; y: number },
  b: { x: number; y: number },
  R: number,
  gapDeg: number,
): string {
  const ang = (p: { x: number; y: number }) => Math.atan2(p.y - 50, p.x - 50);
  let a0 = ang(a);
  let a1 = ang(b);
  // ensure clockwise (increasing angle in SVG's y-down space)
  if (a1 < a0) a1 += Math.PI * 2;
  const g = (gapDeg * Math.PI) / 180;
  const s = a0 + g;
  const e = a1 - g;
  const r = R - 3;
  const sx = 50 + r * Math.cos(s);
  const sy = 50 + r * Math.sin(s);
  const ex = 50 + r * Math.cos(e);
  const ey = 50 + r * Math.sin(e);
  return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 0 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
}

/* ----------------------------- sections ----------------------------- */
function StationSection({ state, beams }: { state: BeamState; beams: Beam[] }) {
  const meta = BEAM_STATE_META[state];
  return (
    <div className="px-4">
      <SectionHeader state={state} count={beams.length} />
      {beams.length === 0 ? (
        <Empty label={`No beams ${meta.label.toLowerCase()}`} />
      ) : (
        <div className="flex flex-col gap-2">
          {beams.map((b) => (
            <BeamCard key={b.id} beam={b} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReadySection({ data }: { data: BeamRegisterData }) {
  const warps = data.readyWarps;
  const readyBeams = data.beams.filter((b) => b.state === "ready");
  return (
    <div className="px-4">
      <SectionHeader state="ready" count={warps.length || readyBeams.length} />
      {warps.length === 0 ? (
        <Empty label="No warps ready to load" />
      ) : (
        <div className="flex flex-col gap-2">
          {warps.map((w, i) => (
            <ReadyWarpCard key={i} warp={w} />
          ))}
        </div>
      )}
      {readyBeams.length > 0 && (
        <p className="mt-2.5 text-[12px] text-[var(--color-text-secondary)] leading-relaxed">
          On beams:{" "}
          <span className="font-medium text-[var(--color-text-primary)]">
            {readyBeams.map((b) => b.id).join(" · ")}
          </span>
        </p>
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
  return (
    <div className="flex items-center gap-2 mb-2.5 mt-1">
      <span className="text-[15px]">{meta.emoji}</span>
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
function BeamCard({ beam, showState }: { beam: Beam; showState?: boolean }) {
  const meta = BEAM_STATE_META[beam.state];
  return (
    <div
      className="rounded-xl bg-white border px-3.5 py-3 flex items-center justify-between gap-3"
      style={{ borderColor: `color-mix(in srgb, ${meta.token} 28%, var(--color-border-hairline))` }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-bold text-[var(--color-text-primary)] tabular-nums">{beam.id}</span>
          {showState && (
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full inline-flex items-center gap-1"
              style={{ background: `color-mix(in srgb, ${meta.token} 14%, white)`, color: meta.token }}
            >
              {meta.emoji} {meta.label}
            </span>
          )}
        </div>
        <div className="text-[12px] text-[var(--color-text-secondary)] mt-0.5 truncate">
          {subtitle(beam)}
        </div>
      </div>
      <div className="text-right shrink-0">
        {beam.state === "loaded" && beam.loom && (
          <span className="text-[13px] font-bold text-[var(--color-brand-primary)]">{beam.loom}</span>
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
