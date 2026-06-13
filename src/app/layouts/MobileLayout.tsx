import { Outlet, NavLink, useNavigate, useLocation } from "react-router";
import { ArrowLeft, House, SquaresFour, Cylinder, type Icon } from "@phosphor-icons/react";
import { ToastHost } from "../components/Toast";

export function MobileLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const isHome = location.pathname === "/supervisor";
  const isBeams = location.pathname.includes("/supervisor/beams");
  // Top-level destinations show the bottom tab bar; deep task pages (entry,
  // pending, new-loading, logs) stay focused with a back/home header instead.
  const isTopLevel = isHome || isBeams;

  let title = "";
  if (isHome) title = "Looms";
  else if (location.pathname.includes("/supervisor/production")) title = "Production";
  else if (location.pathname.includes("/supervisor/pending")) title = "Pending entries";
  else if (location.pathname.includes("/supervisor/new-loading")) title = "New loading";
  else if (location.pathname.includes("/supervisor/beams")) title = "Beam register";
  else if (location.pathname.includes("/supervisor/logs")) title = "Past logs";;

  return (
    <div className="h-[100svh] bg-white flex flex-col max-w-md mx-auto relative border-x border-[var(--color-border-hairline)]">
      <header className="h-14 bg-white border-b border-[var(--color-border-hairline)] flex items-center px-4 shrink-0">
        {!isTopLevel && (
          <button onClick={() => navigate(-1)} className="p-2 -ml-2 mr-2 text-[var(--color-text-primary)]" aria-label="Back">
            <ArrowLeft className="w-5 h-5" weight="bold" />
          </button>
        )}
        <h1 className="text-base font-semibold">{title}</h1>
        {!isTopLevel && (
          <button
            onClick={() => navigate("/supervisor")}
            className="ml-auto p-2 -mr-2 text-[var(--color-text-primary)]"
            aria-label="Home"
            title="Home"
          >
            <House className="w-5 h-5" weight="bold" />
          </button>
        )}
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain">
        <Outlet />
      </main>

      {isTopLevel && (
        <nav
          className="bg-white border-t border-[var(--color-border-hairline)] grid grid-cols-2 shrink-0"
          style={{ paddingBottom: "env(safe-area-inset-bottom)", height: "calc(4rem + env(safe-area-inset-bottom))" }}
        >
          <TabLink to="/supervisor" label="Looms" Icon={SquaresFour} end />
          <TabLink to="/supervisor/beams" label="Beams" Icon={Cylinder} />
        </nav>
      )}

      <ToastHost />
    </div>
  );
}

function TabLink({
  to,
  label,
  Icon,
  end,
}: {
  to: string;
  label: string;
  Icon: Icon;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `relative flex flex-col items-center justify-center gap-1 text-xs ${
          isActive
            ? "text-[var(--color-text-primary)] font-semibold"
            : "text-[var(--color-text-secondary)]/60"
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? (
            <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[3px] rounded-b-full bg-[var(--color-text-primary)]" />
          ) : null}
          <Icon className="w-[22px] h-[22px]" weight={isActive ? "fill" : "regular"} />
          <span>{label}</span>
        </>
      )}
    </NavLink>
  );
}

