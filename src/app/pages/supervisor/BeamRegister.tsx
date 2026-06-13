import { useEffect, useMemo, useState } from "react";
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
  Funnel,
  type Icon,
} from "@phosphor-icons/react";
import { getBeamSource } from "../../lib/beamSource";
import {
  BEAM_STATE_META,
  type Beam,
  type BeamRegisterData,
  type BeamState,
  type ReadyWarp,
} from "../../lib/beams";

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
  const [selected, setSelected] = useState<BeamState>("ready");
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
      </div>

      {loading && <BeamSkeleton />}

      {!loading && error && <BeamError onRetry={load} />}

      {!loading && !error && data && (
        <>
          {/* Buffer-health summary + flow river */}
          <AmIShort data={data} />
          <FlowStrip
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

/* --------------------------- am I short? --------------------------- */
/**
 * Buffer-health summary. The floor question is: do I have enough *ready* beams
 * to cover the looms currently *running*, so a run-out can be reloaded at once?
 *   running = loaded · buffer = ready · covered = min(buffer, running)
 *   short   = running − covered
 */
function shortStats(data: BeamRegisterData) {
  const running = data.counts.loaded;
  const buffer = data.counts.ready;
  const covered = Math.min(buffer, running);
  const short = Math.max(0, running - covered);
  let tone: "green" | "amber" | "red";
  if (running === 0 || short === 0) tone = "green";
  else if (buffer * 2 >= running) tone = "amber";
  else tone = "red";
  return { running, buffer, covered, short, tone };
}

function AmIShort({ data }: { data: BeamRegisterData }) {
  const { running, buffer, covered, short, tone } = shortStats(data);
  const token =
    tone === "green"
      ? "var(--color-status-green)"
      : tone === "amber"
      ? "var(--color-status-amber)"
      : "var(--color-status-red)";

  const headline =
    running === 0
      ? "No looms running"
      : short === 0
      ? `Buffer healthy — ${buffer} ready for ${running} running`
      : tone === "amber"
      ? `Buffer tight — ${buffer} ready for ${running} running`
      : `Short by ${short} — only ${buffer} ready for ${running} running`;

  const coveredPct = running > 0 ? (covered / running) * 100 : 100;
  const shortPct = running > 0 ? (short / running) * 100 : 0;

  return (
    <div className="px-4 pt-4">
      <div
        className="rounded-xl px-3.5 py-3 border"
        style={{
          background: `color-mix(in srgb, ${token} 7%, white)`,
          borderColor: `color-mix(in srgb, ${token} 28%, var(--color-border-hairline))`,
        }}
      >
        <div className="flex items-center gap-1.5">
          {tone === "green" ? (
            <CheckCircle style={{ color: token, width: 16, height: 16 }} weight="fill" />
          ) : (
            <Warning style={{ color: token, width: 16, height: 16 }} weight="fill" />
          )}
          <span className="text-[13px] font-bold" style={{ color: token }}>
            {headline}
          </span>
        </div>

        {/* coverage bar: how much of the running looms a run-out can refill now */}
        {running > 0 && (
          <div className="mt-2 flex h-2 rounded-full overflow-hidden bg-black/[0.05]">
            <div style={{ width: `${coveredPct}%`, background: "var(--color-status-green)" }} />
            {short > 0 && (
              <div style={{ width: `${shortPct}%`, background: "var(--color-status-red)" }} />
            )}
          </div>
        )}

        <p className="mt-1.5 text-[12px] text-[var(--color-text-secondary)]">
          {data.counts.empty} empty to send · {data.counts.vendor} at vendor refilling
        </p>
      </div>
    </div>
  );
}

/* ----------------------------- flow river ----------------------------- */
/** Production order, left → right, with a re-warp return from empty to vendor. */
const FLOW: BeamState[] = ["vendor", "ready", "loaded", "empty"];

function FlowStrip({
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
  // viewBox geometry (meet, no distortion). 100 wide × 40 tall.
  const VB_W = 100;
  const VB_H = 40;
  const W = 7; // bar width
  const YC = 15; // band centre line
  const MIN_H = 6;
  const MAX_H = 24;
  const maxCount = Math.max(...FLOW.map((s) => data.counts[s]), 1);

  const nodes = FLOW.map((s, i) => {
    const x = (i + 0.5) * (VB_W / FLOW.length);
    const h = MIN_H + (data.counts[s] / maxCount) * (MAX_H - MIN_H);
    return { s, x, h, top: YC - h / 2, bot: YC + h / 2 };
  });

  const ribbons = nodes.slice(0, -1).map((n0, i) => {
    const n1 = nodes[i + 1];
    return { d: ribbonPath(n0, n1, W), from: n0.s, to: n1.s, key: `${n0.s}-${n1.s}` };
  });

  // re-warp return loop: empty (last) → vendor (first), arcing below.
  const last = nodes[nodes.length - 1];
  const first = nodes[0];
  const loopY = 33;
  const loop = `M ${last.x} ${last.bot} C ${last.x} ${loopY}, ${first.x} ${loopY}, ${first.x} ${first.bot}`;

  return (
    <div className="px-4 pt-3">
      <div className="relative w-full max-w-[360px] mx-auto">
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full block">
          <defs>
            {ribbons.map((r) => (
              <linearGradient id={`bm-grad-${r.key}`} key={r.key} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={BEAM_STATE_META[r.from].token} />
                <stop offset="100%" stopColor={BEAM_STATE_META[r.to].token} />
              </linearGradient>
            ))}
            <marker id="bm-loop-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--color-text-tertiary)" />
            </marker>
          </defs>

          {/* ribbons */}
          {ribbons.map((r) => (
            <path key={r.key} d={r.d} fill={`url(#bm-grad-${r.key})`} opacity={0.28} />
          ))}

          {/* re-warp return loop */}
          <path
            d={loop}
            fill="none"
            stroke="var(--color-text-tertiary)"
            strokeWidth={0.7}
            strokeDasharray="1.5 1.5"
            markerEnd="url(#bm-loop-arrow)"
            opacity={0.7}
          />
          <text x={(first.x + last.x) / 2} y={loopY + 3.2} textAnchor="middle" fontSize={3.2} fill="var(--color-text-tertiary)">
            re-warp
          </text>

          {/* node bands */}
          {nodes.map((n) => {
            const meta = BEAM_STATE_META[n.s];
            const isSel = selected === n.s;
            const isHi = highlight?.has(n.s) ?? false;
            return (
              <g key={n.s}>
                {(isSel || isHi) && (
                  <rect
                    x={n.x - W / 2 - 1.2}
                    y={n.top - 1.2}
                    width={W + 2.4}
                    height={n.h + 2.4}
                    rx={3}
                    fill="none"
                    stroke={meta.token}
                    strokeWidth={isHi ? 1.1 : 0.8}
                    opacity={isHi ? 0.9 : 0.6}
                  />
                )}
                <rect x={n.x - W / 2} y={n.top} width={W} height={n.h} rx={2.2} fill={meta.token} opacity={isSel ? 1 : 0.85} />
              </g>
            );
          })}
        </svg>

        {/* filter chips — clearly tappable, one stage at a time */}
        <div className="mt-2.5">
          <div className="flex items-center gap-1 mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
            <Funnel className="w-3 h-3" weight="bold" />
            Tap a stage to filter
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {nodes.map((n) => {
              const meta = BEAM_STATE_META[n.s];
              const StateIcon = STATE_ICON[n.s];
              const isSel = selected === n.s;
              return (
                <button
                  key={n.s}
                  onClick={() => onSelect(n.s)}
                  aria-pressed={isSel}
                  className="flex flex-col items-center gap-1 py-2 rounded-xl border transition-colors active:scale-[0.97]"
                  style={{
                    borderColor: isSel ? meta.token : "var(--color-border-hairline)",
                    background: isSel ? `color-mix(in srgb, ${meta.token} 12%, white)` : "white",
                    boxShadow: isSel ? `inset 0 0 0 1px ${meta.token}` : "none",
                  }}
                >
                  <div className="flex items-center gap-1">
                    <StateIcon style={{ color: meta.token, width: 14, height: 14 }} weight={isSel ? "fill" : "duotone"} />
                    <span className="text-[16px] font-bold tabular-nums leading-none" style={{ color: meta.token }}>
                      {data.counts[n.s]}
                    </span>
                  </div>
                  <span
                    className="text-[10px] leading-tight font-semibold"
                    style={{ color: isSel ? meta.token : "var(--color-text-secondary)" }}
                  >
                    {meta.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Tapering filled ribbon connecting the right edge of one band to the left
 *  edge of the next, following each band's height. */
function ribbonPath(
  n0: { x: number; top: number; bot: number },
  n1: { x: number; top: number; bot: number },
  w: number,
): string {
  const x0 = n0.x + w / 2;
  const x1 = n1.x - w / 2;
  const cx = (x0 + x1) / 2;
  return [
    `M ${x0.toFixed(2)} ${n0.top.toFixed(2)}`,
    `C ${cx.toFixed(2)} ${n0.top.toFixed(2)}, ${cx.toFixed(2)} ${n1.top.toFixed(2)}, ${x1.toFixed(2)} ${n1.top.toFixed(2)}`,
    `L ${x1.toFixed(2)} ${n1.bot.toFixed(2)}`,
    `C ${cx.toFixed(2)} ${n1.bot.toFixed(2)}, ${cx.toFixed(2)} ${n0.bot.toFixed(2)}, ${x0.toFixed(2)} ${n0.bot.toFixed(2)}`,
    "Z",
  ].join(" ");
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
function BeamCard({ beam, showState }: { beam: Beam; showState?: boolean }) {
  const meta = BEAM_STATE_META[beam.state];
  const StateIcon = STATE_ICON[beam.state];
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
              <StateIcon style={{ width: 11, height: 11 }} weight="fill" />
              {meta.label}
            </span>
          )}
        </div>
        <div className="text-[12px] text-[var(--color-text-secondary)] mt-0.5 truncate">
          {subtitle(beam)}
        </div>
      </div>
      <div className="text-right shrink-0">
        {beam.state === "loaded" && beam.loom && (
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
