/**
 * SettingsShell — Two-pane settings shell on desktop, single-pane on mobile.
 *
 * Driven by registry.ts. From lg width, renders a 240px rail with search
 * and navigation groups beside a scrolling outlet. Below lg, renders the
 * familiar landing list and pages with Back.
 */
import React, { Suspense } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { ChevronLeft, Loader2, Settings as SettingsIcon } from "lucide-react";
import {
  SETTINGS_PAGES,
  REDIRECTS,
  type SettingsPage,
  type RedirectTarget,
} from "./registry";
import { SettingsRail } from "./SettingsRail";
import { SettingsHome } from "./SettingsHome";
import { RequireAdmin } from "../../components/auth/RequireAdmin";
import { useAuth } from "../../components/auth/AuthGate";
import { useMediaQuery, WIDE_QUERY } from "../../hooks/useMediaQuery";
import { usePageTitle } from "../../hooks/usePageTitle";
import { ICON_BTN, PAGE_TITLE } from "../../lib/styles";
import { NAMES } from "../../lib/names";
import { cn } from "../../lib/utils";

// Lazy admin user view for special route /admin/users/new
const UsersView = React.lazy(() =>
  import("./admin/UsersView").then((m) => ({ default: m.UsersView })),
);

const AdminFallback = () => (
  <div className="p-6 flex items-center gap-2 text-sm text-on-surface-variant">
    <Loader2 className="w-4 h-4 animate-spin" />
    Loading…
  </div>
);

const PageFallback = () => (
  <div className="p-6 flex items-center gap-2 text-sm text-on-surface-variant">
    <Loader2 className="w-4 h-4 animate-spin" />
    Loading…
  </div>
);

const AdminRoute = ({
  children,
  ownsScrolling = false,
}: {
  children: React.ReactNode;
  ownsScrolling?: boolean;
}) => (
  <RequireAdmin>
    <div
      className={cn(
        "h-full",
        ownsScrolling ? "overflow-hidden" : "overflow-y-auto",
      )}
    >
      <Suspense fallback={<AdminFallback />}>{children}</Suspense>
    </div>
  </RequireAdmin>
);

const RedirectRoute = ({ to }: { to: RedirectTarget }) => {
  const { isAdmin } = useAuth();
  const target = typeof to === "function" ? to({ isAdmin }) : to;
  return <Navigate to={target} replace />;
};

const lazyComponentCache = new Map<
  string,
  React.LazyExoticComponent<React.ComponentType>
>();

function getLazyComponent(page: SettingsPage) {
  let comp = lazyComponentCache.get(page.id);
  if (!comp) {
    comp = React.lazy(page.load);
    lazyComponentCache.set(page.id, comp);
  }
  return comp;
}

export const SettingsShell = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const isWide = useMediaQuery(WIDE_QUERY);

  // Match subpage by longest matching path
  const subpagesSorted = [...SETTINGS_PAGES].sort(
    (a, b) => b.path.length - a.path.length,
  );
  const currentSubpage = subpagesSorted.find(
    (page) =>
      location.pathname === page.path ||
      location.pathname.startsWith(`${page.path}/`),
  );

  const isSubpage = !!currentSubpage;
  const title = currentSubpage?.title ?? NAMES.settings.title;
  const Icon = currentSubpage?.icon ?? SettingsIcon;
  const ownsScrolling = currentSubpage?.ownsScrolling ?? false;

  usePageTitle(title);

  // Back button behaviour:
  // On wide screens (lg and up): back goes to "/" ("Back to Network")
  // On narrow screens (< lg):
  // - on landing page (/settings): no back control (finding A14)
  // - on subpages: back goes to "/settings" ("Back to Settings")
  const showBackButton = isWide || isSubpage;
  const backLabel = isWide ? "Back to Network" : "Back to Settings";
  const backDestination = isWide ? "/" : "/settings";

  return (
    <div className="h-full flex overflow-hidden bg-surface text-on-surface">
      {/* ── 240px Left Navigation Rail on desktop ── */}
      <div className="hidden lg:block h-full shrink-0">
        <SettingsRail />
      </div>

      {/* ── Content Area (Header + Outlet) ── */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <header className="px-4 sm:px-6 py-4 sm:py-5 bg-surface-container-low shrink-0 border-b border-surface-container/30">
          <div className="flex items-center gap-3 sm:gap-4">
            {showBackButton && (
              <button
                type="button"
                onClick={() => navigate(backDestination)}
                className={cn(
                  ICON_BTN,
                  "inline-flex items-center justify-center min-w-[44px] min-h-[44px]",
                )}
                aria-label={backLabel}
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            <h1 className={cn(PAGE_TITLE, "flex items-center gap-3 min-w-0")}>
              <span className="p-2 bg-primary/10 rounded-xl shrink-0">
                <Icon
                  className={cn(
                    "w-5 h-5 sm:w-6 sm:h-6",
                    currentSubpage?.tone ?? "text-primary",
                  )}
                />
              </span>
              <span className="truncate">{title}</span>
            </h1>
          </div>
        </header>

        <main
          id="main-content"
          className={cn(
            "flex-1 min-h-0",
            ownsScrolling ? "overflow-hidden" : "overflow-y-auto",
          )}
        >
          <Routes>
            <Route path="/" element={<SettingsHome />} />

            {/* Special route for new user in Accounts */}
            <Route
              path="admin/users/new"
              element={
                <AdminRoute>
                  <UsersView createOpen />
                </AdminRoute>
              }
            />

            {/* Registry driven pages */}
            {SETTINGS_PAGES.map((page: SettingsPage) => {
              const Component = getLazyComponent(page);
              const relativePath = page.path.replace(/^\/settings\/?/, "");

              if (page.admin) {
                return (
                  <Route
                    key={page.id}
                    path={relativePath}
                    element={
                      <AdminRoute ownsScrolling={page.ownsScrolling}>
                        <Component />
                      </AdminRoute>
                    }
                  />
                );
              }

              if (page.ownsScrolling) {
                return (
                  <Route
                    key={page.id}
                    path={relativePath}
                    element={
                      <div className="h-full overflow-hidden">
                        <Suspense fallback={<PageFallback />}>
                          <Component />
                        </Suspense>
                      </div>
                    }
                  />
                );
              }

              return (
                <Route
                  key={page.id}
                  path={relativePath}
                  element={
                    <div className="overflow-y-auto h-full">
                      <Suspense fallback={<PageFallback />}>
                        <Component />
                      </Suspense>
                    </div>
                  }
                />
              );
            })}

            {/* Registry driven redirects */}
            {Object.entries(REDIRECTS).map(([from, to]) => {
              const relativeFrom = from.replace(/^\/settings\/?/, "");
              return (
                <Route
                  key={from}
                  path={relativeFrom}
                  element={<RedirectRoute to={to} />}
                />
              );
            })}

            {/* Wildcard fallback to /settings */}
            <Route path="*" element={<Navigate to="/settings" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
};

export default SettingsShell;
