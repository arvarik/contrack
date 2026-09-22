/**
 * SettingsShell — Two-pane settings shell on desktop, single-pane on mobile.
 *
 * Driven by registry.ts. From lg width, renders a 240px rail with search
 * and navigation groups beside a scrolling outlet. Below lg, renders the
 * familiar landing list and pages with a link back to it.
 *
 * The page's header is `PageHeader`, drawn above the scrolling outlet so it
 * stays in place while the page scrolls under it.
 */
import React, { Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { History, Loader2 } from "lucide-react";
import { ActionMenu } from "../../components/ui/ActionMenu";
import { PageHeader } from "../../components/layout/PageHeader";
import { useDedupeOptional } from "../../contexts/DedupeContext";
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
import { PAGE_TOP, PAGE_X } from "../../lib/styles";
import { NAMES } from "../../lib/names";
import { cn } from "../../lib/utils";
import { SETTINGS_BOX, SETTINGS_PAGE } from "./layout";

// Lazy admin user view for special route /admin/users/new
const UsersView = React.lazy(() =>
  import("./admin/UsersView").then((m) => ({ default: m.UsersView })),
);

/** A page on its way, in the page's own box, so its content lands in place. */
const PageFallback = () => (
  <div
    className={cn(
      SETTINGS_PAGE,
      "flex items-center gap-2 text-sm text-on-surface-variant",
    )}
  >
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
      <Suspense fallback={<PageFallback />}>{children}</Suspense>
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
  const ownsScrolling = currentSubpage?.ownsScrolling ?? false;

  usePageTitle(title);

  // The back link names the page it goes to.
  // On wide screens (lg and up) the rail is on screen, so it goes to "/",
  // the Network.
  // On narrow screens (< lg):
  // - on the landing page (/settings): no back link (finding A14)
  // - on subpages: it goes to "/settings", the landing list
  const back = isWide
    ? { to: "/", label: NAMES.network.label }
    : isSubpage
      ? { to: "/settings", label: NAMES.settings.label }
      : undefined;

  const dedupe = useDedupeOptional();

  // A page that scrolls carries its header with it, the way Pulse and the
  // Tracked page do, so text never slides under a fixed title. A page that
  // owns its scrolling (a full-width tool) keeps the header fixed above it.
  const header = (
    <PageHeader
      back={back}
      title={title}
      actions={
        // Below sm, Merge activity moves into an ActionMenu in the header
        // for Duplicates.
        currentSubpage?.id === "duplicates" ? (
          <div className="sm:hidden">
            <ActionMenu
              label="Duplicates actions"
              items={[
                {
                  id: "merge-activity",
                  label: "Merge activity",
                  icon: History,
                  onSelect: () => dedupe?.setShowActivity(true),
                },
              ]}
            />
          </div>
        ) : undefined
      }
      className={cn(
        PAGE_TOP,
        // A page that owns its scrolling is a full-width tool, and its
        // header spans the column. Every other page is a centred box, and
        // the header takes the same box, so the title starts above the
        // page's first card and not off to its left.
        ownsScrolling ? cn(PAGE_X, "shrink-0") : SETTINGS_BOX,
      )}
    />
  );

  return (
    <div className="h-full flex overflow-hidden bg-surface text-on-surface">
      {/* ── 240px Left Navigation Rail on desktop ── */}
      <div className="hidden lg:block h-full shrink-0">
        <SettingsRail />
      </div>

      {/* ── Content Area (Header + Outlet) ── */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {ownsScrolling && header}

        <main
          id="main-content"
          className={cn(
            "flex-1 min-h-0",
            ownsScrolling ? "overflow-hidden" : "overflow-y-auto",
          )}
        >
          {!ownsScrolling && header}
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
