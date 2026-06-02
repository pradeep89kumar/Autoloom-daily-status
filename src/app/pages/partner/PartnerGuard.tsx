import { Navigate, Outlet } from "react-router";
import { getRole } from "../../lib/persona";

export function PartnerGuard() {
  if (getRole() !== "partner") {
    return <Navigate to="/partner-pin" replace />;
  }
  return <Outlet />;
}
