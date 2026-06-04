import { Outlet, NavLink, useNavigate } from "react-router";
import { Calendar, TrendingUp, Wallet, IndianRupee, ArrowLeft } from "lucide-react";
import { setRole } from "../../lib/persona";

export function PartnerShell() {
  const navigate = useNavigate();

  function exit() {
    setRole("supervisor");
    navigate("/role", { replace: true });
  }

  return (
    <div className="h-[100svh] bg-white flex flex-col max-w-md mx-auto border-x border-[var(--color-border-hairline)]">
      <header className="h-14 bg-white border-b border-[var(--color-border-hairline)] flex items-center px-4 shrink-0">
        <button
          onClick={exit}
          className="p-2 -ml-2 mr-2 text-[var(--color-text-primary)]"
          aria-label="Exit Partner"
        >
          <ArrowLeft className="w-5 h-5" strokeWidth={1.5} />
        </button>
        <h1 className="text-base font-semibold">Partner</h1>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain">
        <Outlet />
      </main>

      <nav
        className="bg-white border-t border-[var(--color-border-hairline)] grid grid-cols-4 shrink-0"
        style={{ paddingBottom: "env(safe-area-inset-bottom)", height: "calc(4rem + env(safe-area-inset-bottom))" }}
      >
        <TabLink to="/partner/day" label="Day" Icon={Calendar} />
        <TabLink to="/partner/cash" label="Cash" Icon={IndianRupee} />
        <TabLink to="/partner/trend" label="Trend" Icon={TrendingUp} />
        <TabLink to="/partner/receivables" label="Receivables" Icon={Wallet} />
      </nav>
    </div>
  );
}

function TabLink({
  to,
  label,
  Icon,
}: {
  to: string;
  label: string;
  Icon: typeof Calendar;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex flex-col items-center justify-center gap-1 text-xs ${
          isActive ? "text-[var(--color-text-primary)] font-medium" : "text-[var(--color-text-secondary)]"
        }`
      }
    >
      <Icon className="w-5 h-5" strokeWidth={1.5} />
      <span>{label}</span>
    </NavLink>
  );
}
