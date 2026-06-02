import { Outlet, useNavigate, useLocation } from "react-router";
import { ArrowLeft, Home } from "lucide-react";
import { ToastHost } from "../components/Toast";

export function MobileLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const isHome = location.pathname === "/supervisor";

  let title = "";
  if (isHome) title = "Looms";
  else if (location.pathname.includes("/supervisor/production")) title = "Production";
  else if (location.pathname.includes("/supervisor/pending")) title = "Pending entries";
  else if (location.pathname.includes("/supervisor/new-loading")) title = "New loading";
  else if (location.pathname.includes("/supervisor/logs")) title = "Past logs";;

  return (
    <div className="min-h-screen bg-white flex flex-col max-w-md mx-auto relative border-x border-[var(--color-border-hairline)]">
      <header className="h-14 bg-white border-b border-[var(--color-border-hairline)] flex items-center px-4 shrink-0">
        {!isHome && (
          <button onClick={() => navigate(-1)} className="p-2 -ml-2 mr-2 text-[var(--color-text-primary)]" aria-label="Back">
            <ArrowLeft className="w-5 h-5" strokeWidth={1.5} />
          </button>
        )}
        <h1 className="text-base font-semibold">{title}</h1>
        {!isHome && (
          <button
            onClick={() => navigate("/supervisor")}
            className="ml-auto p-2 -mr-2 text-[var(--color-text-primary)]"
            aria-label="Home"
            title="Home"
          >
            <Home className="w-5 h-5" strokeWidth={1.5} />
          </button>
        )}
      </header>

      <main className="flex-1 overflow-y-auto overflow-x-hidden">
        <Outlet />
      </main>

      <ToastHost />
    </div>
  );
}

