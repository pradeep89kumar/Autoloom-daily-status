import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Lock, Pencil } from "lucide-react";
import { fetchFullRows, type FullRow } from "../../lib/sheetSync";
import { fromYmd, shortDate } from "../../lib/shift";
import { LOOM_CATALOG } from "../../lib/looms";

type Preset = "today" | "yesterday" | "7d" | "all" | "custom";

export function Logs() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<FullRow[] | null>(null);
  const [preset, setPreset] = useState<Preset>("7d");
  const [loomFilter, setLoomFilter] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();
    fetchFullRows().then((r) => {
      if (cancelled) return;
      const sorted = [...r].sort((a, b) =>
        a.date === b.date
          ? (a.shift === b.shift ? a.loomId.localeCompare(b.loomId) : a.shift < b.shift ? 1 : -1)
          : a.date < b.date ? 1 : -1,
      );
      const wait = Math.max(0, 3000 - (Date.now() - startedAt));
      setTimeout(() => {
        if (cancelled) return;
        setRows(sorted);
      }, wait);
    });
    return () => { cancelled = true; };
  }, []);

  const range = useMemo(() => computeRange(preset, from, to), [preset, from, to]);

  const visible = useMemo(() => {
    if (!rows) return [];
    return rows.filter((r) => {
      if (range.from && r.date < range.from) return false;
      if (range.to && r.date > range.to) return false;
      if (loomFilter && r.loomId !== loomFilter) return false;
      return true;
    });
  }, [rows, range, loomFilter]);

  const grouped = useMemo(() => groupByDateShift(visible), [visible]);

  if (rows === null) {
    return (
      <div className="px-4 pt-4 pb-6">
        <div className="flex gap-2 mb-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-8 w-16 rounded-full bg-black/[0.05] animate-pulse" />
          ))}
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="mb-3 rounded-xl border border-[var(--color-border-hairline)] p-3">
            <div className="h-4 w-32 rounded bg-black/[0.06] animate-pulse mb-2" />
            <div className="h-3 w-48 rounded bg-black/[0.04] animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="pb-12">
      <div className="px-4 pt-4 pb-3 flex flex-col gap-3">
        <div className="flex gap-2 overflow-x-auto -mx-4 px-4">
          {(["today", "yesterday", "7d", "all", "custom"] as Preset[]).map((p) => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className={`px-3 py-1.5 rounded-full text-sm border whitespace-nowrap ${
                preset === p
                  ? "border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-white"
                  : "border-[var(--color-border-hairline)] bg-white text-[var(--color-text-secondary)]"
              }`}
            >
              {presetLabel(p)}
            </button>
          ))}
        </div>

        {preset === "custom" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border-hairline)] text-sm"
            />
            <span className="text-sm text-[var(--color-text-secondary)]">to</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border-hairline)] text-sm"
            />
          </div>
        )}

        <div className="flex items-center gap-2">
          <label className="text-[13px] text-[var(--color-text-secondary)]">Loom</label>
          <select
            value={loomFilter}
            onChange={(e) => setLoomFilter(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border-hairline)] text-sm bg-white"
          >
            <option value="">All looms</option>
            {LOOM_CATALOG.map((l) => (
              <option key={l.id} value={l.name}>{l.name}</option>
            ))}
          </select>
        </div>
      </div>

      {grouped.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-[var(--color-text-secondary)]">
          No entries.
        </div>
      ) : (
        <div className="border-t border-[var(--color-border-hairline)]">
          {grouped.map((g) => (
            <div key={g.key}>
              <div className="px-4 py-2.5 bg-gray-50 border-b border-[var(--color-border-hairline)] flex items-baseline justify-between">
                <div className="flex items-baseline gap-2">
                  <span className="text-[15px] font-semibold">{shortDate(fromYmd(g.date))}</span>
                  <span className="text-[13px] text-[var(--color-text-secondary)]">{g.shift} shift</span>
                </div>
                <span className="text-[11px] text-[var(--color-text-secondary)]">
                  {g.items.length} {g.items.length === 1 ? "entry" : "entries"}
                </span>
              </div>
              <ul>
                {g.items.map((r) => (
                  <li key={r.rowIndex} className="border-b border-[var(--color-border-hairline)]">
                    <button
                      onClick={() =>
                        navigate(
                          `/supervisor/production/${r.loomId.toLowerCase()}?date=${r.date}&shift=${r.shift}&rowIndex=${r.rowIndex}`,
                        )
                      }
                      className="w-full text-left px-4 py-3 flex flex-col gap-0.5 hover:bg-gray-50"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="font-semibold text-[15px]">{r.loomId}</span>
                        <span className="text-[13px] text-[var(--color-text-secondary)] truncate">
                          {r.weaver || "—"}
                        </span>
                        <span className="ml-auto inline-flex items-center gap-2">
                          {r.editedAt && (
                            <span className="text-[10px] uppercase tracking-wide text-[var(--color-status-amber)]">
                              Edited
                            </span>
                          )}
                          {r.editable ? (
                            <span
                              className="w-6 h-6 rounded-full bg-[color-mix(in_srgb,var(--color-brand-primary)_10%,white)] text-[var(--color-brand-primary)] flex items-center justify-center"
                              aria-label="Editable"
                              title="Editable"
                            >
                              <Pencil className="w-3.5 h-3.5" strokeWidth={1.75} />
                            </span>
                          ) : (
                            <span
                              className="w-6 h-6 rounded-full bg-gray-100 text-[var(--color-text-secondary)] flex items-center justify-center"
                              aria-label="Locked"
                              title="Locked · edit on Google Sheet"
                            >
                              <Lock className="w-3.5 h-3.5" strokeWidth={1.75} />
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="text-[13px] text-[var(--color-text-secondary)] flex items-center gap-2 flex-wrap">
                        <span>{r.meters} mtr</span>
                        <span>·</span>
                        <span>{Math.round(r.pickCounter / 1000)}k picks</span>
                        <span>·</span>
                        <span>{r.weftCuts}W / {r.warpCuts}Wp cuts</span>
                        {r.efficiencyPct ? <><span>·</span><span>{r.efficiencyPct}% eff</span></> : null}
                        {r.loomState && <><span>·</span><span>{r.loomState}</span></>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface Group { key: string; date: string; shift: "A" | "B"; items: FullRow[]; }

function groupByDateShift(rows: FullRow[]): Group[] {
  const map = new Map<string, Group>();
  for (const r of rows) {
    const key = `${r.date}|${r.shift}`;
    let g = map.get(key);
    if (!g) { g = { key, date: r.date, shift: r.shift, items: [] }; map.set(key, g); }
    g.items.push(r);
  }
  return Array.from(map.values()).sort((a, b) =>
    a.date === b.date ? (a.shift < b.shift ? 1 : -1) : a.date < b.date ? 1 : -1,
  );
}

function ymdLocal(d: Date): string {
  const m = d.getMonth() + 1, day = d.getDate();
  return `${d.getFullYear()}-${m < 10 ? "0" + m : m}-${day < 10 ? "0" + day : day}`;
}

function presetLabel(p: Preset): string {
  switch (p) {
    case "today":     return "Today";
    case "yesterday": return "Yesterday";
    case "7d":        return "Last 7 days";
    case "all":       return "All (21d)";
    case "custom":    return "Custom";
  }
}

function computeRange(preset: Preset, from: string, to: string): { from: string; to: string } {
  const now = new Date();
  const todayY = ymdLocal(now);
  if (preset === "today") return { from: todayY, to: todayY };
  if (preset === "yesterday") {
    const y = new Date(now); y.setDate(y.getDate() - 1);
    const yY = ymdLocal(y);
    return { from: yY, to: yY };
  }
  if (preset === "7d") {
    const start = new Date(now); start.setDate(start.getDate() - 6);
    return { from: ymdLocal(start), to: todayY };
  }
  if (preset === "custom") return { from: from || "", to: to || "" };
  return { from: "", to: "" };
}
