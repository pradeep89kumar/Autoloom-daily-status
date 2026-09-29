import { useCallback, useEffect, useState } from "react";
import { Navigate, Outlet, useNavigate } from "react-router";
import { AUTH_EXPIRED_EVENT, checkSessionRole } from "../../lib/authClient";
import type { Role } from "../../lib/persona";
import { clearAllSheetCache, logVisit } from "../../lib/sheetSync";

export function PartnerGuard() {
  return <RoleGuard requiredRole="partner" />;
}

export function SupervisorGuard() {
  return <RoleGuard requiredRole="supervisor" />;
}

type GuardState = "checking" | "granted" | "denied" | "unavailable";

function RoleGuard({ requiredRole }: { requiredRole: Role }) {
  const navigate = useNavigate();
  const [state, setState] = useState<GuardState>("checking");

  const verify = useCallback(async (showLoading = true) => {
    if (showLoading) setState("checking");
    const result = await checkSessionRole();
    if (!result.ok) {
      setState("unavailable");
      return;
    }
    if (result.role !== requiredRole) {
      clearAllSheetCache();
      setState("denied");
      return;
    }
    setState("granted");
  }, [requiredRole]);

  useEffect(() => {
    void verify();
    const expired = () => {
      clearAllSheetCache();
      setState("denied");
    };
    const recheck = () => void verify(false);
    const recheckWhenVisible = () => {
      if (document.visibilityState === "visible") void verify(false);
    };
    const recheckRestoredPage = (event: PageTransitionEvent) => {
      if (event.persisted) void verify(false);
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, expired);
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheckWhenVisible);
    window.addEventListener("pageshow", recheckRestoredPage);
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheckWhenVisible);
      window.removeEventListener("pageshow", recheckRestoredPage);
    };
  }, [verify]);

  useEffect(() => {
    if (state === "granted") void logVisit();
  }, [state]);

  if (state === "denied") {
    return <Navigate to={requiredRole === "partner" ? "/partner-pin" : "/supervisor-pin"} replace />;
  }
  if (state === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-sm text-[var(--color-text-secondary)]">
        Checking access…
      </div>
    );
  }
  if (state === "unavailable") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white px-6 text-center">
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Access check unavailable</h1>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Check the connection and try again.</p>
        <div className="mt-6 flex gap-3">
          <button onClick={() => void verify()} className="h-11 rounded-xl bg-[var(--color-text-primary)] px-5 text-sm font-semibold text-white">
            Retry
          </button>
          <button onClick={() => navigate("/role", { replace: true })} className="h-11 rounded-xl border border-[var(--color-border-hairline)] px-5 text-sm font-semibold">
            Back
          </button>
        </div>
      </div>
    );
  }
  return <Outlet />;
}
