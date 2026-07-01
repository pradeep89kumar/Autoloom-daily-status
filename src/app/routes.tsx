import { createBrowserRouter } from "react-router";

import { Splash } from "./pages/Splash";
import { RoleSelector } from "./pages/RoleSelector";
import { MobileLayout } from "./layouts/MobileLayout";
import { LoomFloor } from "./pages/supervisor/LoomFloor";
import { ProductionEntry } from "./pages/supervisor/ProductionEntry";
import { PendingList } from "./pages/supervisor/PendingList";
import { NewLoading } from "./pages/supervisor/NewLoading";
import { Logs } from "./pages/supervisor/Logs";
import { BeamRegister } from "./pages/supervisor/BeamRegister";
import { DesignsList, DesignDetail } from "./pages/supervisor/Designs";
import { DesignCapture } from "./pages/supervisor/DesignCapture";
import { PinGate } from "./pages/partner/PinGate";
import { PartnerShell } from "./pages/partner/PartnerShell";
import { PartnerDay } from "./pages/partner/Day";
import { PartnerCash } from "./pages/partner/Cash";
import { PartnerCashStatement } from "./pages/partner/CashStatement";
import { PartnerNewShedExpenses } from "./pages/partner/NewShedExpenses";
import { PartnerTrend } from "./pages/partner/Trend";
import { PartnerTrendReport } from "./pages/partner/TrendReport";
import { PartnerReceivables } from "./pages/partner/Receivables";
import { PartnerGuard } from "./pages/partner/PartnerGuard";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Splash,
  },
  {
    path: "/role",
    Component: RoleSelector,
  },
  {
    path: "/supervisor",
    Component: MobileLayout,
    children: [
      { index: true, Component: LoomFloor },
      { path: "production/:loomId", Component: ProductionEntry },
      { path: "pending", Component: PendingList },
      { path: "new-loading", Component: NewLoading },
      { path: "beams", Component: BeamRegister },
      { path: "designs", Component: DesignsList },
      { path: "designs/new", Component: DesignCapture },
      { path: "designs/:designId", Component: DesignDetail },
      { path: "logs", Component: Logs },
    ],
  },
  {
    path: "/partner-pin",
    Component: PinGate,
  },
  {
    path: "/partner",
    Component: PartnerGuard,
    children: [
      {
        path: "",
        Component: PartnerShell,
        children: [
          { index: true, Component: PartnerDay },
          { path: "day", Component: PartnerDay },
          { path: "cash", Component: PartnerCash },
          { path: "trend", Component: PartnerTrend },
          { path: "receivables", Component: PartnerReceivables },
        ],
      },
      { path: "cash/statement", Component: PartnerCashStatement },
      { path: "cash/new-shed", Component: PartnerNewShedExpenses },
      { path: "trend/report", Component: PartnerTrendReport },
    ],
  },
]);

