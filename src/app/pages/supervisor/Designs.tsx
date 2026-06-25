import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  MagnifyingGlass,
  X,
  Scroll,
  CloudSlash,
  ArrowClockwise,
  CaretRight,
  ImageSquare,
  ArrowLeft,
  CheckCircle,
  Warning,
  Plus,
} from "@phosphor-icons/react";
import {
  fetchDesigns,
  fetchDesign,
  type DesignRecord,
  type DesignWarpBand,
  type DesignWeftBand,
} from "../../lib/sheetSync";

/* ------------------------------ list ------------------------------ */

export function DesignsList() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<DesignRecord[] | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  const load = () => {
    let alive = true;
    setLoading(true);
    setError(false);
    fetchDesigns()
      .then((d) => {
        if (!alive) return;
        setRows(d);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setRows(null);
        setError(true);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  };

  useEffect(load, []);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!rows) return [];
    if (!q) return rows;
    const hit = (s: string | undefined) => !!s && s.toLowerCase().includes(q);
    return rows.filter(
      (r) => hit(r.designNo) || hit(r.designName) || hit(r.sourceFirm) || hit(r.weaveType) || hit(r.composition),
    );
  }, [rows, q]);

  return (
    <div className="pb-10">
      {loading && <DesignsSkeleton />}

      {!loading && error && <DesignsError onRetry={load} />}

      {!loading && !error && rows && rows.length === 0 && <DesignsEmpty />}

      {!loading && !error && rows && rows.length > 0 && (
        <>
          <div className="px-4 pt-4 pb-3">
            <div className="relative">
              <MagnifyingGlass
                className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
                weight="bold"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a design — number, name, firm, weave"
                className="w-full h-10 pl-9 pr-9 rounded-full border-0 text-[14px] bg-[var(--color-bg-base)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--color-brand-primary)_30%,white)] focus:bg-white"
              />
              {q && (
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

          {filtered.length === 0 ? (
            <p className="px-6 py-10 text-center text-[13px] text-[var(--color-text-secondary)]">
              No design matches “{query}”.
            </p>
          ) : (
            <ul className="px-4 space-y-2">
              {filtered.map((r) => (
                <li key={r.designId}>
                  <button
                    onClick={() => navigate(`/supervisor/designs/${encodeURIComponent(r.designId)}`)}
                    className="w-full flex items-center gap-3 text-left rounded-xl border border-[var(--color-border-hairline)] bg-white px-3.5 py-3 active:scale-[0.99] transition-transform"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[15px] font-bold text-[var(--color-text-primary)] truncate">
                          {r.designNo || "—"}
                        </span>
                        {r.designName && (
                          <span className="text-[13px] text-[var(--color-text-secondary)] truncate">
                            {r.designName}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-[var(--color-text-tertiary)]">
                        {r.sourceFirm && <span className="truncate">{r.sourceFirm}</span>}
                        {r.sourceFirm && r.weaveType && <span>·</span>}
                        {r.weaveType && <span className="truncate">{r.weaveType}</span>}
                        {(r.sourceFirm || r.weaveType) && r.receivedDate && <span>·</span>}
                        {r.receivedDate && <span className="shrink-0 tabular-nums">{r.receivedDate}</span>}
                      </div>
                    </div>
                    <CaretRight className="w-4 h-4 shrink-0 text-[var(--color-text-tertiary)]" weight="bold" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {!loading && (
        <div
          className="fixed inset-x-0 z-30 max-w-md mx-auto px-4 flex justify-end pointer-events-none"
          style={{ bottom: "calc(4.5rem + env(safe-area-inset-bottom))" }}
        >
          <button
            onClick={() => navigate("/supervisor/designs/new")}
            className="pointer-events-auto inline-flex items-center gap-1.5 h-11 px-4 rounded-full bg-[var(--color-brand-primary)] text-white text-[14px] font-semibold shadow-lg active:scale-95 transition-transform"
          >
            <Plus className="w-4 h-4" weight="bold" />
            Add design
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ detail (loom-setup sheet) ------------------------------ */

export function DesignDetail() {
  const { designId = "" } = useParams();
  const navigate = useNavigate();
  const [design, setDesign] = useState<DesignRecord | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showRaw, setShowRaw] = useState(false);

  const load = () => {
    let alive = true;
    setLoading(true);
    setError(false);
    fetchDesign({ id: designId })
      .then((d) => {
        if (!alive) return;
        setDesign(d);
        setError(!d);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setDesign(null);
        setError(true);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  };

  useEffect(load, [designId]);

  if (loading) return <DesignsSkeleton />;
  if (error || !design) return <DesignsError onRetry={load} notFound={!loading && !design && !error} />;

  const d = design;
  const warp = d.warp ?? [];
  const weft = d.weft ?? [];
  const sourceImages = splitRefs(d.sourceImageRefs);

  return (
    <div className="pb-12">
      {/* header */}
      <div className="px-4 pt-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-[19px] font-bold text-[var(--color-text-primary)] leading-tight">
              {d.designNo || "Untitled design"}
            </h2>
            {d.designName && (
              <p className="text-[14px] text-[var(--color-text-secondary)] mt-0.5">{d.designName}</p>
            )}
          </div>
          {d.confidence != null && <ConfidenceBadge value={d.confidence} />}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-[var(--color-text-tertiary)]">
          {d.sourceFirm && <span>{d.sourceFirm}</span>}
          {d.receivedDate && <span className="tabular-nums">Received {d.receivedDate}</span>}
          {d.weaveType && <span>{d.weaveType}</span>}
        </div>
      </div>

      {/* pattern preview */}
      {(warp.length > 0 || weft.length > 0) && (
        <Section title="Pattern preview">
          {warp.length > 0 && (
            <div className="mb-3">
              <div className="text-[11px] text-[var(--color-text-tertiary)] mb-1.5">Warp · across the width</div>
              <StripePreview bands={warp} qtyKey="ends" orientation="vertical" />
            </div>
          )}
          {weft.length > 0 && (
            <div>
              <div className="text-[11px] text-[var(--color-text-tertiary)] mb-1.5">Weft · along the length</div>
              <StripePreview bands={weft} qtyKey="picks" orientation="horizontal" />
            </div>
          )}
          <ColourLegend names={[...warp.map((b) => b.colour), ...weft.map((b) => b.colour)]} />
          <p className="mt-2 text-[11px] text-[var(--color-text-tertiary)] leading-relaxed">
            Indicative only. Colours are approximated from the captured names for a visual check, not exact shades.
          </p>
        </Section>
      )}

      {/* construction summary */}
      <Section title="Construction">
        <StatGrid
          items={[
            ["Reed", d.reed],
            ["Reed order", d.reedOrder],
            ["Pick / PPI", d.pickPPI],
            ["Warp count", d.warpCount],
            ["Weft count", d.weftCount],
            ["Warp width", fmtIn(d.warpWidthIn)],
            ["Cloth width", fmtIn(d.clothWidthIn)],
            ["Total ends", d.totalEnds ? String(d.totalEnds) : ""],
            ["Total shafts", d.totalShafts ? String(d.totalShafts) : ""],
            ["Total picks", d.totalPicks ? String(d.totalPicks) : ""],
            ["Composition", d.composition],
          ]}
        />
        {d.constructionRaw && (
          <p className="mt-2 text-[12px] text-[var(--color-text-tertiary)] leading-relaxed">
            {d.constructionRaw}
          </p>
        )}
      </Section>

      {/* warp */}
      <Section title={`Warp${warp.length ? ` · ${warp.length} ${warp.length === 1 ? "band" : "bands"}` : ""}`}>
        {warp.length === 0 ? (
          <EmptyLine text={d.warpSeqText || "No warp bands captured."} />
        ) : (
          <BandTable
            cols={["Colour", "Count", "Ends", "Extra"]}
            rows={warp.map((b) => [b.colour || "—", b.count || "—", num(b.ends), num(b.extra), b.layer])}
            hasLayer={warp.some((b) => !!b.layer)}
          />
        )}
        {(d.repeatEnds || d.noOfRepeat || d.extraEnds) ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {d.repeatEnds ? <Chip label="Repeat ends" value={d.repeatEnds} /> : null}
            {d.noOfRepeat ? <Chip label="× Repeats" value={d.noOfRepeat} /> : null}
            {d.extraEnds ? <Chip label="Extra ends" value={d.extraEnds} /> : null}
          </div>
        ) : null}
      </Section>

      {/* consistency checks */}
      <ConsistencyChecks d={d} warp={warp} weft={weft} />

      {/* weft */}
      <Section title={`Weft${weft.length ? ` · ${weft.length} ${weft.length === 1 ? "band" : "bands"}` : ""}`}>
        {weft.length === 0 ? (
          <EmptyLine text={d.weftSeqText || "No weft bands captured."} />
        ) : (
          <BandTable
            cols={["Colour", "Count", "Picks", "Extra"]}
            rows={weft.map((b) => [b.colour || "—", b.count || "—", num(b.picks), num(b.extra)])}
          />
        )}
      </Section>

      {/* draft / peg plan */}
      {d.draft && (
        <Section title="Draft / peg plan">
          <StatGrid
            items={[
              ["Draft order", d.draft.draftOrder],
              ["Total shafts", d.draft.totalShafts ? String(d.draft.totalShafts) : ""],
              ["Total picks", d.draft.totalPicks ? String(d.draft.totalPicks) : ""],
            ]}
          />
          {d.draft.pegPlanImageRef && <ImageLink href={d.draft.pegPlanImageRef} label="Open peg-plan image" />}
        </Section>
      )}

      {/* source images */}
      {sourceImages.length > 0 && (
        <Section title="Source documents">
          <div className="space-y-1.5">
            {sourceImages.map((href, i) => (
              <ImageLink key={i} href={href} label={`Source image ${sourceImages.length > 1 ? i + 1 : ""}`.trim()} />
            ))}
          </div>
        </Section>
      )}

      {/* notes + raw */}
      {(d.notes || d.rawText) && (
        <Section title="Notes">
          {d.notes && (
            <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-wrap">
              {d.notes}
            </p>
          )}
          {d.rawText && (
            <div className="mt-2">
              <button
                onClick={() => setShowRaw((v) => !v)}
                className="text-[12px] font-semibold text-[var(--color-brand-primary)]"
              >
                {showRaw ? "Hide captured text" : "Show captured text"}
              </button>
              {showRaw && (
                <pre className="mt-1.5 text-[11px] text-[var(--color-text-tertiary)] leading-relaxed whitespace-pre-wrap bg-[var(--color-bg-base)] rounded-lg p-3">
                  {d.rawText}
                </pre>
              )}
            </div>
          )}
        </Section>
      )}

      {/* provenance */}
      <div className="px-4 mt-5 text-[11px] text-[var(--color-text-tertiary)]">
        {d.capturedBy && <span>Captured by {d.capturedBy}</span>}
        {d.capturedBy && d.capturedAt && <span> · </span>}
        {d.capturedAt && <span>{d.capturedAt}</span>}
      </div>

      <div className="px-4 mt-6">
        <button
          onClick={() => navigate("/supervisor/designs")}
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-text-secondary)]"
        >
          <ArrowLeft className="w-4 h-4" weight="bold" />
          Back to all designs
        </button>
      </div>
    </div>
  );
}

/* ------------------------------ pieces ------------------------------ */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-4 mt-5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)] mb-2">
        {title}
      </h3>
      <div className="rounded-xl border border-[var(--color-border-hairline)] bg-white p-3.5">{children}</div>
    </section>
  );
}

function StatGrid({ items }: { items: [string, string | undefined][] }) {
  const shown = items.filter(([, v]) => v != null && String(v).trim() !== "");
  if (shown.length === 0) return <EmptyLine text="Not captured." />;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
      {shown.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <div className="text-[11px] text-[var(--color-text-tertiary)]">{k}</div>
          <div className="text-[14px] font-medium text-[var(--color-text-primary)] truncate">{v}</div>
        </div>
      ))}
    </div>
  );
}

function BandTable({
  cols,
  rows,
  hasLayer,
}: {
  cols: string[];
  rows: (string | undefined)[][];
  hasLayer?: boolean;
}) {
  return (
    <div>
      <div
        className="grid gap-2 pb-1.5 mb-1.5 border-b border-[var(--color-border-hairline)] text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]"
        style={{ gridTemplateColumns: `1.4fr repeat(${cols.length - 1}, 1fr)` }}
      >
        {cols.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div
            key={i}
            className="grid gap-2 text-[13px] text-[var(--color-text-primary)] items-baseline"
            style={{ gridTemplateColumns: `1.4fr repeat(${cols.length - 1}, 1fr)` }}
          >
            <span className="font-medium truncate">
              {r[0]}
              {hasLayer && r[4] ? (
                <span className="ml-1 text-[10px] text-[var(--color-text-tertiary)]">({r[4]})</span>
              ) : null}
            </span>
            {r.slice(1, cols.length).map((cell, j) => (
              <span key={j} className="tabular-nums">
                {cell || "—"}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Chip({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-baseline gap-1 rounded-full bg-[var(--color-bg-base)] px-2.5 py-1 text-[12px]">
      <span className="text-[var(--color-text-tertiary)]">{label}</span>
      <span className="font-semibold tabular-nums text-[var(--color-text-primary)]">{value}</span>
    </span>
  );
}

function ConfidenceBadge({ value }: { value: number }) {
  const pct = value <= 1 ? Math.round(value * 100) : Math.round(value);
  const tone =
    pct >= 80
      ? "bg-green-50 text-green-700"
      : pct >= 50
        ? "bg-amber-50 text-amber-700"
        : "bg-red-50 text-red-700";
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{pct}%</span>
  );
}

function ImageLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-brand-primary)]"
    >
      <ImageSquare className="w-4 h-4" weight="bold" />
      {label}
    </a>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed">{text}</p>;
}

function DesignsEmpty() {
  return (
    <div className="px-6 py-16 flex flex-col items-center text-center">
      <Scroll className="w-12 h-12 text-[var(--color-text-tertiary)]" weight="duotone" />
      <h3 className="mt-4 text-[15px] font-bold text-[var(--color-text-primary)]">No designs captured yet</h3>
      <p className="mt-1.5 text-[13px] text-[var(--color-text-secondary)] leading-relaxed max-w-[280px]">
        Loom-setup sheets will appear here once a design is captured. They are stored in the Designs tab of the
        workbook.
      </p>
    </div>
  );
}

function DesignsError({ onRetry, notFound }: { onRetry: () => void; notFound?: boolean }) {
  return (
    <div className="px-6 py-16 flex flex-col items-center text-center">
      <CloudSlash className="w-12 h-12 text-[var(--color-text-tertiary)]" weight="duotone" />
      <h3 className="mt-4 text-[15px] font-bold text-[var(--color-text-primary)]">
        {notFound ? "Design not found" : "Could not load designs"}
      </h3>
      <p className="mt-1.5 text-[13px] text-[var(--color-text-secondary)] leading-relaxed max-w-[260px]">
        {notFound
          ? "This design may have been removed."
          : "The design sheet could not be reached. Check the connection and try again."}
      </p>
      <button
        onClick={onRetry}
        className="mt-5 inline-flex items-center gap-1.5 px-4 h-10 rounded-lg border border-[var(--color-border-hairline)] text-[14px] font-semibold text-[var(--color-text-primary)] hover:bg-gray-50"
      >
        <ArrowClockwise className="w-4 h-4" weight="bold" />
        Try again
      </button>
    </div>
  );
}

function DesignsSkeleton() {
  return (
    <div className="px-4 pt-4 space-y-2 animate-pulse">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-16 rounded-xl bg-[var(--color-bg-base)]" />
      ))}
    </div>
  );
}

/* ------------------------------ utils ------------------------------ */

function num(n: number): string {
  return n ? String(n) : "—";
}

function fmtIn(v: string): string {
  const s = String(v || "").trim();
  if (!s) return "";
  return /["”']|in\b/i.test(s) ? s : `${s}"`;
}

function splitRefs(s: string): string[] {
  return String(s || "")
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter((x) => /^https?:\/\//i.test(x));
}

/* ------------------------------ pattern preview + checks ------------------------------ */

// Common loom colour names → an approximate swatch. Unknown names get a stable
// generated colour so distinct names still read as distinct; the legend always
// shows the captured name beside the swatch, so the name remains authoritative.
const COLOUR_HEX: Record<string, string> = {
  white: "#f4f4f3", cream: "#f3ecd9", "off white": "#ece5d4", beige: "#d9c8a9",
  black: "#1c1c1c", grey: "#8a8a8a", gray: "#8a8a8a", "dark grey": "#555555", silver: "#c0c0c0",
  red: "#c0392b", maroon: "#7b241c", wine: "#5e2129", rani: "#d6336c", pink: "#e8a0bf", "rani pink": "#d6336c",
  green: "#2e7d32", "dark green": "#1b5e20", "parrot green": "#7cb342", olive: "#808000", mehendi: "#8a9a30",
  blue: "#1565c0", navy: "#1a237e", "navy blue": "#1a237e", "sky blue": "#4fc3f7", firozi: "#17a2b8", turquoise: "#1abc9c", "t blue": "#1565c0",
  yellow: "#f4c20d", gold: "#d4af37", golden: "#d4af37", mustard: "#d9a404", lemon: "#e6e64d",
  orange: "#e67e22", brown: "#6d4c41", coffee: "#4e342e", rust: "#a0522d", chocolate: "#3e2723",
  purple: "#7b1fa2", violet: "#8e44ad", magenta: "#c2185b",
  khaki: "#b5a642", sandal: "#d2b48c", copper: "#b87333",
};

function colourHex(name: string): string {
  const k = String(name || "").trim().toLowerCase();
  if (!k) return "#d4d4d4";
  if (COLOUR_HEX[k]) return COLOUR_HEX[k];
  for (const key of Object.keys(COLOUR_HEX)) {
    if (k.includes(key)) return COLOUR_HEX[key];
  }
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 45% 60%)`;
}

export function StripePreview({
  bands,
  qtyKey,
  orientation,
}: {
  bands: (DesignWarpBand | DesignWeftBand)[];
  qtyKey: "ends" | "picks";
  orientation: "vertical" | "horizontal";
}) {
  const usable = bands.filter((b) => (Number((b as Record<string, unknown>)[qtyKey]) || 0) > 0);
  if (usable.length === 0) {
    return (
      <p className="text-[12px] text-[var(--color-text-tertiary)]">
        No {qtyKey === "ends" ? "ends" : "picks"} captured — preview unavailable.
      </p>
    );
  }
  const isV = orientation === "vertical";
  return (
    <div
      className={`flex ${isV ? "flex-row h-16" : "flex-col h-12"} w-full overflow-hidden rounded-lg border border-[var(--color-border-hairline)]`}
    >
      {usable.map((b, i) => {
        const qty = Number((b as Record<string, unknown>)[qtyKey]) || 0;
        return (
          <div
            key={i}
            style={{ flexGrow: qty, flexBasis: 0, backgroundColor: colourHex(b.colour) }}
            title={`${b.colour || "—"} · ${qty}`}
          />
        );
      })}
    </div>
  );
}

export function ColourLegend({ names }: { names: string[] }) {
  const uniq = Array.from(new Set(names.map((n) => (n || "").trim()).filter(Boolean)));
  if (uniq.length === 0) return null;
  return (
    <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1.5">
      {uniq.map((n) => (
        <span key={n} className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-text-secondary)]">
          <span
            className="w-3 h-3 rounded-sm border border-[var(--color-border-hairline)]"
            style={{ backgroundColor: colourHex(n) }}
          />
          {n}
        </span>
      ))}
    </div>
  );
}

export type Check = { ok: boolean; label: string };

export function buildChecks(d: DesignRecord, warp: DesignWarpBand[], weft: DesignWeftBand[]): Check[] {
  const out: Check[] = [];
  const warpSum = warp.reduce((s, b) => s + (Number(b.ends) || 0), 0);
  const totalEnds = Number(d.totalEnds) || 0;
  const repeatEnds = Number(d.repeatEnds) || 0;
  const noOfRepeat = Number(d.noOfRepeat) || 0;
  const extraEnds = Number(d.extraEnds) || 0;

  // Warp band ends vs total ends (or one repeat) — pure arithmetic, no unit ambiguity.
  if (warp.length > 0 && warpSum > 0) {
    if (totalEnds > 0 && warpSum === totalEnds) {
      out.push({ ok: true, label: `Warp bands add up to the total ends (${totalEnds}).` });
    } else if (repeatEnds > 0 && warpSum === repeatEnds) {
      out.push({ ok: true, label: `Warp bands add up to one repeat (${repeatEnds} ends).` });
    } else if (totalEnds > 0) {
      out.push({ ok: false, label: `Warp bands add up to ${warpSum}, but total ends says ${totalEnds}.` });
    }
    const missing = warp.filter((b) => !(Number(b.ends) > 0)).length;
    if (missing > 0) {
      out.push({ ok: false, label: `${missing} warp band${missing === 1 ? "" : "s"} ${missing === 1 ? "has" : "have"} no ends value.` });
    }
  }

  // Repeat identity: repeat ends × repeats (+ extra) should equal total ends.
  if (repeatEnds > 0 && noOfRepeat > 0 && totalEnds > 0) {
    const expected = repeatEnds * noOfRepeat + extraEnds;
    const sum = `${repeatEnds} × ${noOfRepeat}${extraEnds ? ` + ${extraEnds}` : ""}`;
    out.push(
      expected === totalEnds
        ? { ok: true, label: `Repeat math checks out: ${sum} = ${totalEnds}.` }
        : { ok: false, label: `Repeat math: ${sum} = ${expected}, but total ends says ${totalEnds}.` },
    );
  }

  // Weft completeness.
  if (weft.length > 0) {
    const missingW = weft.filter((b) => !(Number(b.picks) > 0)).length;
    if (missingW > 0) {
      out.push({ ok: false, label: `${missingW} weft band${missingW === 1 ? "" : "s"} ${missingW === 1 ? "has" : "have"} no picks value.` });
    }
  }

  return out;
}

function ConsistencyChecks({
  d,
  warp,
  weft,
}: {
  d: DesignRecord;
  warp: DesignWarpBand[];
  weft: DesignWeftBand[];
}) {
  const checks = buildChecks(d, warp, weft);
  if (checks.length === 0) return null;
  const allOk = checks.every((c) => c.ok);
  return (
    <Section title={`Consistency checks${allOk ? "" : " · review"}`}>
      <ul className="space-y-2">
        {checks.map((c, i) => (
          <li key={i} className="flex items-start gap-2">
            {c.ok ? (
              <CheckCircle className="w-4 h-4 mt-0.5 shrink-0 text-green-600" weight="fill" />
            ) : (
              <Warning className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" weight="fill" />
            )}
            <span className="text-[13px] text-[var(--color-text-primary)] leading-snug">{c.label}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
