import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Check, ChevronDown } from "lucide-react";
import { LOOM_CATALOG } from "../../lib/looms";
import { Button } from "../../components/ui/button";
import { showToast } from "../../components/Toast";
import {
  fetchCatalog,
  fetchFullRows,
  fetchLoadings,
  submitLoadingToSheet,
  type FullRow,
  type OrderOption,
} from "../../lib/sheetSync";
import {
  loadingStatusForTarget,
  mergeLoadings,
  recordLoading,
  type LoadingEvent,
} from "../../lib/loadings";
import { currentShift, ymd } from "../../lib/shift";

export function NewLoading() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const presetLoom = params.get("loom") || "";
  const returnTo = params.get("return") || "";

  const [selected, setSelected] = useState<string>(presetLoom);
  const [order, setOrder] = useState<OrderOption | null>(null);
  const [orderQuery, setOrderQuery] = useState("");
  const [orderOpen, setOrderOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showAllLooms, setShowAllLooms] = useState(false);

  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [rows, setRows] = useState<FullRow[]>([]);
  const [loadings, setLoadings] = useState<LoadingEvent[]>([]);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchCatalog(), fetchFullRows(), fetchLoadings()]).then(
      ([cat, fr, ld]) => {
        if (!alive) return;
        setOrders(cat.orders);
        setRows(fr);
        setLoadings(mergeLoadings(ld));
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  const target = useMemo(() => {
    const cs = currentShift(new Date());
    return { date: ymd(cs.date), shift: cs.shift };
  }, []);

  const loomStatuses = useMemo(() => {
    const out: Record<string, ReturnType<typeof loadingStatusForTarget>> = {};
    for (const l of LOOM_CATALOG) {
      out[l.id] = loadingStatusForTarget(l.name, target, rows, loadings);
    }
    return out;
  }, [rows, loadings, target]);

  const isAvailable = (loomId: string) => {
    const s = loomStatuses[loomId];
    if (!s) return true;
    return s.kind !== "active";
  };

  const isRunoutResume =
    !!presetLoom && loomStatuses[presetLoom]?.kind === "completed-needs-loading";

  const orderMatches = useMemo(() => {
    const q = orderQuery.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter(
      (o) =>
        o.design.toLowerCase().includes(q) ||
        o.customer.toLowerCase().includes(q),
    );
  }, [orders, orderQuery]);

  const errors: Record<string, string> = {};
  if (!selected) errors.loom = "Pick a loom.";
  else if (!isAvailable(selected) && !showAllLooms) {
    errors.loom = "Loom is currently running. Toggle Show all looms to override.";
  }
  if (!order) errors.order = "Select from the order list.";

  const isComplete = Object.keys(errors).length === 0;

  const submit = async () => {
    setTouched(true);
    if (!isComplete || submitting) return;
    setSubmitting(true);

    const wasRunoutResume =
      !!selected && loomStatuses[selected]?.kind === "completed-needs-loading";
    const now = new Date();
    const cs = currentShift(now);
    submitLoadingToSheet({
      kind: "loading",
      loomId: selected.toUpperCase(),
      designName: order!.design,
      customerName: order!.customer,
      shift: cs.shift,
      shiftDate: ymd(cs.date),
      capturedAt: now.toISOString(),
      source: "new-loading",
      resumedFromRunout: wasRunoutResume,
    });
    recordLoading({
      loomId: selected.toUpperCase(),
      designName: order!.design,
      customerName: order!.customer,
      shift: cs.shift,
      shiftDate: ymd(cs.date),
      capturedAt: now.toISOString(),
    });
    showToast(`New warp on ${selected.toUpperCase()}`);
    setTimeout(() => {
      if (returnTo) navigate(decodeURIComponent(returnTo), { replace: true });
      else navigate("/supervisor");
    }, 450);
  };

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (orderOpen && !t.closest("[data-order-popover]") && !t.closest("[data-order-trigger]")) {
        setOrderOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [orderOpen]);

  return (
    <div className="pb-28">
      <div className="px-4 pt-4 pb-3 border-b border-[var(--color-border-hairline)]">
        {isRunoutResume && (
          <div className="mb-2 inline-flex items-center px-2 py-0.5 rounded-full bg-[var(--color-status-amber)] text-white text-[11px] tracking-wide uppercase">
            Runout · new loading required
          </div>
        )}
        <h2 className="text-lg font-semibold">New loading</h2>
        <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
          {isRunoutResume
            ? "Confirm new warp before the next production entry."
            : "Pick a loom and the order being loaded. Starts at 0 m."}
        </p>
      </div>

      <div className="px-4 mt-4 flex flex-col gap-5">
        {!presetLoom && (
          <Field label="Loom" error={touched ? errors.loom : undefined}>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[12px] text-[var(--color-text-secondary)]">
                Only looms with a completed loading are available.
              </p>
              <label className="flex items-center gap-1.5 text-[12px] text-[var(--color-text-secondary)]">
                <input
                  type="checkbox"
                  checked={showAllLooms}
                  onChange={(e) => setShowAllLooms(e.target.checked)}
                />
                Show all
              </label>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {LOOM_CATALOG.map((l) => {
                const avail = isAvailable(l.id);
                const disabled = !avail && !showAllLooms;
                const status = loomStatuses[l.id];
                const sub =
                  status?.kind === "active"
                    ? `Running · ${status.designName || "—"}`
                    : status?.kind === "completed-needs-loading"
                      ? "Needs loading"
                      : "Fresh";
                return (
                  <button
                    key={l.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => setSelected(l.id)}
                    className={`py-2 px-1 rounded-lg border text-sm font-medium flex flex-col items-center gap-0.5 ${
                      selected === l.id
                        ? "border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-white"
                        : disabled
                          ? "border-[var(--color-border-hairline)] bg-gray-100 text-[var(--color-text-secondary)] opacity-60"
                          : "border-[var(--color-border-hairline)] bg-white"
                    }`}
                  >
                    <span>{l.name}</span>
                    <span className="text-[10px] font-normal opacity-80 truncate max-w-full">{sub}</span>
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        {presetLoom && (
          <div className="text-sm">
            <span className="text-[var(--color-text-secondary)]">Loom · </span>
            <span className="font-semibold">{presetLoom.toUpperCase()}</span>
          </div>
        )}

        <Field label="Design" error={touched ? errors.order : undefined}>
          <div className="relative">
            <button
              type="button"
              data-order-trigger
              onClick={() => setOrderOpen((v) => !v)}
              className={`input text-left flex items-center justify-between ${
                touched && errors.order ? "input-error" : ""
              }`}
            >
              <span className={order ? "" : "text-[var(--color-text-secondary)]"}>
                {order ? order.design : "Select design"}
              </span>
              <ChevronDown className="w-4 h-4 text-[var(--color-text-secondary)]" strokeWidth={1.5} />
            </button>
            {orderOpen && (
              <div
                data-order-popover
                className="absolute z-10 mt-1 w-full bg-white border border-[var(--color-border-hairline)] rounded-lg shadow-sm overflow-hidden"
              >
                <div className="p-2 border-b border-[var(--color-border-hairline)]">
                  <input
                    autoFocus
                    value={orderQuery}
                    onChange={(e) => setOrderQuery(e.target.value)}
                    placeholder="Search design or customer…"
                    className="input"
                  />
                </div>
                <ul className="max-h-56 overflow-auto">
                  {orderMatches.length === 0 && (
                    <li className="px-3 py-2.5 text-[13px] text-[var(--color-text-secondary)] italic">
                      No matches. Add the order in Sheet3 (B = design, C = customer) first.
                    </li>
                  )}
                  {orderMatches.map((o, idx) => {
                    const key = `${o.design}||${o.customer}||${idx}`;
                    const isSel =
                      order && order.design === o.design && order.customer === o.customer;
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          onClick={() => { setOrder(o); setOrderQuery(""); setOrderOpen(false); }}
                          className="w-full text-left px-3 py-2.5 hover:bg-gray-50 flex items-center justify-between"
                        >
                          <span className="flex flex-col">
                            <span className="text-[15px]">{o.design}</span>
                            {o.customer && (
                              <span className="text-[12px] text-[var(--color-text-secondary)]">{o.customer}</span>
                            )}
                          </span>
                          {isSel && <Check className="w-4 h-4" strokeWidth={1.5} />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
          {order && order.customer && (
            <p className="text-[12px] text-[var(--color-text-secondary)] mt-1.5">
              Customer · <span className="text-[var(--color-text-primary)] font-medium">{order.customer}</span>
            </p>
          )}
          {orders.length === 0 && (
            <p className="text-[11px] text-[var(--color-text-secondary)] mt-1">
              Order list is empty. Populate Sheet3 (B = design, C = customer) in the Google Sheet.
            </p>
          )}
        </Field>
      </div>

      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white border-t border-[var(--color-border-hairline)]">
        <div className="px-4 py-3">
          <Button size="lg" className="w-full" disabled={submitting} onClick={submit}>
            {submitting ? "Saving…" : "Confirm loading"}
          </Button>
        </div>
      </div>

      <style>{`
        .input {
          width: 100%;
          padding: 12px 14px;
          border-radius: 10px;
          border: 1px solid var(--color-border-hairline);
          background: white;
          font-size: 16px;
          color: var(--color-text-primary);
        }
        .input::placeholder { color: var(--color-text-secondary); }
        .input:focus { outline: none; border-color: var(--color-text-primary); box-shadow: 0 0 0 3px rgba(17,17,17,0.06); }
        .input-error { border-color: var(--color-status-red); }
      `}</style>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[13px] font-medium tracking-tight">{label}</label>
      {children}
      {error && <p className="text-xs text-[var(--color-status-red)]">{error}</p>}
    </div>
  );
}
