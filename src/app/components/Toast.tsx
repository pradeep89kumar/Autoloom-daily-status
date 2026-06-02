import { useEffect, useState } from "react";

const KEY = "qc.toast";

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      setMsg(detail);
      window.setTimeout(() => setMsg(null), 2400);
    };
    window.addEventListener(KEY, handler as EventListener);
    return () => window.removeEventListener(KEY, handler as EventListener);
  }, []);
  return msg;
}

export function showToast(message: string) {
  window.dispatchEvent(new CustomEvent(KEY, { detail: message }));
}

export function ToastHost() {
  const msg = useToast();
  if (!msg) return null;
  return (
    <div className="fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 pointer-events-none">
      <div className="px-4 py-2.5 rounded-full bg-[var(--color-text-primary)] text-white text-sm shadow-lg">
        {msg}
      </div>
    </div>
  );
}
