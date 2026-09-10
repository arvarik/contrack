/**
 * RequireAdmin — hides the administration area from a member.
 *
 * This is not the gate. The gate is on the server: every route under
 * `/api/admin` carries `requireAdmin` and answers a member with
 * `403 ADMIN_REQUIRED`, and that is what actually protects anything. This
 * only stops a member reaching a page that would show them a screenful of
 * refusals.
 *
 * It also catches the case an admin runs into rather than a member: a tab
 * left open through a demotion. `useAuth()` re-reads on every `refresh()`, so
 * the redirect happens the next time anything asks.
 *
 * It uses `<Navigate>`, so it must live inside the router. AuthGate mounts
 * outside `BrowserRouter` and cannot host it.
 */
import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthGate";

export const RequireAdmin = ({ children }: { children: ReactNode }) => {
  const { isAdmin, isResolved } = useAuth();
  // Nothing is known while the server is unreachable, and `isAdmin` is false
  // there for want of an answer rather than because of one. Redirecting on
  // that throws away the address the admin was on, and it does not come back
  // when the server does.
  if (!isResolved) return null;
  // `replace`, so the browser's back button does not bounce off the redirect
  // and land here again.
  if (!isAdmin) return <Navigate to="/settings" replace />;
  return <>{children}</>;
};
