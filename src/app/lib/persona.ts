import { useEffect, useState } from "react";

export type Role = "supervisor" | "partner";

const KEY = "qc.role";
const EVT = "qc.role-change";

export function getRole(): Role {
  try {
    const v = localStorage.getItem(KEY);
    return v === "partner" || v === "supervisor" ? v : "supervisor";
  } catch {
    return "supervisor";
  }
}

export function setRole(r: Role | null): void {
  try {
    if (r === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, r);
    window.dispatchEvent(new CustomEvent(EVT));
  } catch {
    /* ignore */
  }
}

export function usePersona(): Role {
  const [role, setRoleState] = useState<Role>(() => getRole());
  useEffect(() => {
    const onChange = () => setRoleState(getRole());
    window.addEventListener(EVT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return role;
}

// Build-time PIN. Set VITE_PARTNER_PIN to a 4-digit string.
// Default "1234" for local dev only.
export function partnerPin(): string {
  return (import.meta.env.VITE_PARTNER_PIN as string | undefined) || "1234";
}
