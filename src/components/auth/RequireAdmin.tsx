/**
 * Hides the administration area from a member. Not the guard: every
 * `/api/admin` route answers a member `403 ADMIN_REQUIRED`. This also moves
 * a tab off an admin page after a demotion. It uses `<Navigate>`, so it
 * lives inside the router, not in AuthGate.
 */
import { useEffect, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "./AuthGate";

/** Back to the Settings list, with one toast that says why. */
export const SettingsRedirect = ({ notice }: { notice: string }) => {
  useEffect(() => {
    // One id, so a second render does not stack a second toast.
    toast.info(notice, { id: "settings-redirect" });
  }, [notice]);
  return <Navigate to="/settings" replace />;
};

export const RequireAdmin = ({ children }: { children: ReactNode }) => {
  const { isAdmin, isResolved } = useAuth();
  // Unreachable: `isAdmin` is false for want of an answer, and a redirect
  // would lose the admin's address.
  if (!isResolved) return null;
  // `replace`, so the browser's back button does not bounce off the redirect
  // and land here again.
  if (!isAdmin) {
    return <SettingsRedirect notice="Only an admin can open that page" />;
  }
  return <>{children}</>;
};
