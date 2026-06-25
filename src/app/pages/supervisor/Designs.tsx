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
} from "@phosphor-icons/react";
import { fetchDesigns, fetchDesign, type DesignRecord } from "../../lib/sheetSync";

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
