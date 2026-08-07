import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
  useMatch,
  useLocation,
} from "react-router-dom";
import {
  LayoutDashboard,
  Map,
  Settings as SettingsIcon,
  Sparkles,
  Activity,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { isTypingTarget } from "./lib/keyboard";
import { useGlobalNavShortcuts } from "./hooks/useGlobalNavShortcuts";
import { Toaster } from "sonner";
import React, { useState, useEffect, Suspense } from "react";

import { ContactList } from "./views/contact-list";
import { ContactDetail } from "./views/contact-detail";
import { CommandPalette } from "./components/command-palette";
import { KeyboardShortcutsModal } from "./components/KeyboardShortcutsModal";
import { QuickInteractionModal } from "./components/QuickInteractionModal";
import { cn } from "./lib/utils";
import { OPEN_SHORTCUTS_EVENT } from "./lib/appEvents";

// Route-level code splitting: secondary views load on demand so the initial
// bundle only carries the ContactList/ContactDetail critical path.
const MapView = React.lazy(() =>
  import("./views/MapView").then((m) => ({ default: m.MapView })),
);
const SettingsView = React.lazy(() =>
  import("./views/SettingsView").then((m) => ({ default: m.SettingsView })),
);
const SearchView = React.lazy(() =>
  import("./views/SearchView").then((m) => ({ default: m.SearchView })),
);
const DashboardView = React.lazy(() =>
  import("./views/DashboardView").then((m) => ({ default: m.DashboardView })),
);

import { Sidebar } from "./components/layout/Sidebar";
import { RouteFallback } from "./components/layout/RouteFallback";
import { ConnectionBanner } from "./components/layout/ConnectionBanner";
import { EmptyState } from "./components/layout/EmptyState";
import { RouteErrorBoundary } from "./components/layout/RouteErrorBoundary";
import { useUrgentActionItemCount } from "./api";
import { AISearchProvider } from "./contexts/AISearchContext";
import { DedupeProvider } from "./contexts/DedupeContext";
import { SessionProvider, useRecent } from "./contexts/SessionContext";

// Dev-only: lazy import so the showcase is not in the prod bundle
const ComponentShowcase = import.meta.env.DEV
  ? React.lazy(() =>
      import("./views/dev/ComponentShowcase").then((m) => ({
        default: m.ComponentShowcase,
      })),
    )
  : null;

const ResponsiveLayout = () => {
  const location = useLocation();
  // Narrow context read — see SessionContext for the split rationale. This
  // component no longer re-renders on every AI-search keystroke.
  const { lastContactId, setLastContactId } = useRecent();
  useGlobalNavShortcuts();
  const matchContact = useMatch("/contact/:id");
  const matchMapContact = useMatch("/map/contact/:id");
  const isContactSelected = matchContact || matchMapContact;

  // Track the most recently visited contact to restore it when clicking "Network"
  useEffect(() => {
    if (matchContact?.params.id) {
      setLastContactId(matchContact.params.id);
    }
  }, [matchContact?.params.id, setLastContactId]);

  const isMapActive = location.pathname.startsWith("/map");
  const isCleanup = location.pathname.startsWith("/settings");
  const isSearch = location.pathname.startsWith("/search");
  const isPulse = location.pathname.startsWith("/pulse");

  const { data: badge } = useUrgentActionItemCount();
  const urgentCount = badge?.count || 0;

  const isNetwork = !isMapActive && !isPulse && !isCleanup && !isSearch;

  /**
   * Mobile tab bar.
   *
   * Two things it did not do before: reserve room for the iOS home indicator
   * (the last row of pixels sat under it, so the labels were clipped on any
   * notched phone), and give each tab a real 44pt target — the taps landed on
   * a `px-3 py-1.5` box roughly 32pt tall. Both are fixed by `min-h-[3rem]`
   * plus `env(safe-area-inset-bottom)` padding.
   */
  const mobileNav = (
    <nav
      aria-label="Primary"
      className="md:hidden fixed bottom-0 left-0 w-full z-50 flex justify-around items-stretch px-1 pt-1.5 glass-panel rounded-t-2xl shadow-[0_-4px_16px_rgba(0,0,0,0.05)]"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      {[
        {
          to:
            lastContactId && !isContactSelected
              ? `/contact/${lastContactId}`
              : "/",
          icon: LayoutDashboard,
          label: "Network",
          active: isNetwork,
          badge: 0,
        },
        {
          to: "/pulse",
          icon: Activity,
          label: "Pulse",
          active: isPulse,
          badge: urgentCount,
        },
        { to: "/map", icon: Map, label: "Map", active: isMapActive, badge: 0 },
        {
          to: "/search",
          icon: Sparkles,
          label: "Ask AI",
          active: isSearch,
          badge: 0,
        },
        {
          to: "/settings",
          icon: SettingsIcon,
          label: "Settings",
          active: isCleanup,
          badge: 0,
        },
      ].map(({ to, icon: Icon, label, active, badge }) => (
        <Link
          key={label}
          to={to}
          aria-current={active ? "page" : undefined}
          className={cn(
            "relative flex flex-1 flex-col items-center justify-center gap-0.5",
            "min-h-[3rem] px-1 py-1 rounded-xl transition-colors",
            active
              ? "text-primary"
              : "text-on-surface-variant active:bg-surface-container",
          )}
        >
          {/* Active pill sits behind the icon rather than recolouring the
              whole tab, so the current tab is legible at a glance. */}
          <span
            className={cn(
              "flex items-center justify-center w-10 h-6 rounded-full transition-colors",
              active && "bg-primary/15",
            )}
          >
            <Icon className="w-5 h-5" />
          </span>
          <span className="text-[9px] font-bold tracking-wide">{label}</span>
          {badge > 0 && (
            <span className="absolute top-0.5 right-[22%] flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-error opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-error" />
            </span>
          )}
        </Link>
      ))}
    </nav>
  );

  const isDev = import.meta.env.DEV && location.pathname.startsWith("/dev");

  // Full-page views (cleanup, search, pulse, dev) take the full main area
  if (isCleanup || isSearch || isPulse || isDev) {
    return (
      <div className="h-screen w-full flex overflow-hidden bg-surface text-on-surface font-body font-medium">
        <div className="hidden md:flex shrink-0">
          <Sidebar />
        </div>
        <main className="flex-1 h-full overflow-hidden relative flex">
          <div className="flex-1 h-full overflow-hidden">
            <Routes>
              <Route
                path="/settings/*"
                element={
                  <RouteErrorBoundary viewName="Settings">
                    <Suspense fallback={<RouteFallback variant="settings" />}>
                      <SettingsView />
                    </Suspense>
                  </RouteErrorBoundary>
                }
              />
              <Route
                path="/search"
                element={
                  <RouteErrorBoundary viewName="Search">
                    <Suspense fallback={<RouteFallback variant="search" />}>
                      <SearchView />
                    </Suspense>
                  </RouteErrorBoundary>
                }
              />
              <Route
                path="/pulse"
                element={
                  <RouteErrorBoundary viewName="Dashboard">
                    <Suspense fallback={<RouteFallback variant="pulse" />}>
                      <DashboardView />
                    </Suspense>
                  </RouteErrorBoundary>
                }
              />
              {ComponentShowcase && (
                <Route
                  path="/dev"
                  element={
                    <Suspense
                      fallback={
                        <div className="p-12 text-center text-on-surface-variant animate-pulse">
                          Loading showcase...
                        </div>
                      }
                    >
                      <ComponentShowcase />
                    </Suspense>
                  }
                />
              )}
            </Routes>
          </div>
        </main>
        {mobileNav}
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex overflow-hidden bg-surface text-on-surface font-body font-medium">
      {/*
        The sidebar used to be suppressed (`hidden lg:flex`) whenever a contact
        was open, which meant that between 768 and 1023 px — an iPad in
        portrait — opening a contact left the screen with no global navigation
        at all: no sidebar, and no tab bar either, since that is `md:hidden`.
        The only way out was the in-page Back link. Navigation chrome is not
        something to reclaim space from; it stays mounted at every width.
      */}
      <div className="hidden md:flex shrink-0">
        <Sidebar />
      </div>

      {/* Dynamic Middle/Main Panel mapping to either the List or the Map */}
      <section
        className={`
        ${isContactSelected && !isMapActive ? "hidden lg:flex" : "flex"}
        ${isMapActive ? "flex-1 z-0" : "w-full lg:w-[350px] shrink-0 bg-surface-container-lowest z-10"}
        h-full flex-col relative
      `}
      >
        <Routes>
          <Route
            path="/map"
            element={
              <RouteErrorBoundary viewName="Map">
                <Suspense fallback={<RouteFallback variant="map" />}>
                  <MapView />
                </Suspense>
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/map/contact/:id"
            element={
              <RouteErrorBoundary viewName="Map">
                <Suspense fallback={<RouteFallback variant="map" />}>
                  <MapView />
                </Suspense>
              </RouteErrorBoundary>
            }
          />
          <Route
            path="*"
            element={
              <RouteErrorBoundary viewName="ContactList">
                <ContactList />
              </RouteErrorBoundary>
            }
          />
        </Routes>
      </section>

      {/* Right Pane: Standard Detail View */}
      {!isMapActive && (
        <main
          className={`
          ${isContactSelected ? "flex" : "hidden lg:flex"}
          flex-1 bg-surface z-10 h-full overflow-hidden relative flex-col
        `}
        >
          <Routes location={location}>
            <Route path="/" element={<EmptyState />} />
            <Route
              path="/contact/:id"
              element={
                <RouteErrorBoundary viewName="ContactDetail">
                  <ContactDetail />
                </RouteErrorBoundary>
              }
            />
          </Routes>
        </main>
      )}

      {/* Map Overlay Detail View */}
      {isMapActive && (
        <AnimatePresence>
          {isContactSelected && (
            <motion.main
              initial={{ x: "100%", opacity: 0.5 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: "100%", opacity: 0 }}
              transition={{ type: "spring", bounce: 0, duration: 0.4 }}
              className="absolute right-0 top-0 bottom-0 w-full md:w-[760px] lg:w-[860px] md:max-w-[calc(100vw-64px)] z-[100] shadow-2xl bg-surface overflow-hidden flex flex-col h-full"
            >
              <Routes location={location}>
                <Route
                  path="/map/contact/:id"
                  element={
                    <RouteErrorBoundary viewName="ContactDetail">
                      <ContactDetail />
                    </RouteErrorBoundary>
                  }
                />
              </Routes>
            </motion.main>
          )}
        </AnimatePresence>
      )}

      {/*
        Mobile Nav — always mounted. It used to unmount on the detail view, so
        on a phone the screen users spend the most time on was also the one
        with no way to reach Pulse, Map, Ask AI, or Settings. The detail view
        already reserves `pb-32` at this width, so the bar has room to sit.
      */}
      {mobileNav}
    </div>
  );
};

export default function App() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [quickNoteOpen, setQuickNoteOpen] = useState(false);

  // The sidebar's shortcuts button opens the same overlay `?` does.
  useEffect(() => {
    const open = () => setShortcutsOpen(true);
    window.addEventListener(OPEN_SHORTCUTS_EVENT, open);
    return () => window.removeEventListener(OPEN_SHORTCUTS_EVENT, open);
  }, []);

  // Global keyboard shortcuts: '?' for shortcuts modal, 'Cmd+Shift+I' for quick note
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // ? → keyboard shortcuts modal
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !isTypingTarget(e)) {
        e.preventDefault();
        setShortcutsOpen((prev) => !prev);
        return;
      }

      // Cmd+Shift+I → quick interaction modal
      // Conflict guard: close Cmd+K if open
      if (e.key === "i" && e.metaKey && e.shiftKey) {
        e.preventDefault();
        // If Cmd+K is open, close it first
        const cmdkDialog = document.querySelector("[cmdk-dialog]");
        if (cmdkDialog) {
          cmdkDialog.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          );
        }
        setQuickNoteOpen((prev) => !prev);
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <Router>
      <SessionProvider>
        {/*
          No app-wide <LayoutGroup>. It used to wrap this entire tree, which
          put every `layout` motion component in the app — the trash list, the
          list-detail panel, the dedupe picker, the pulse swimlanes — into one
          shared projection group. Any of them changing forced a measure/
          project pass across all of them, in views that were not even mounted
          together. Each of those four keeps its own local `layout` behavior;
          none of them ever needed to be coordinated with the others.
        */}
        <AISearchProvider>
          <DedupeProvider>
            <ResponsiveLayout />
          </DedupeProvider>
        </AISearchProvider>
        <ConnectionBanner />
        <CommandPalette />
        <KeyboardShortcutsModal
          isOpen={shortcutsOpen}
          onClose={() => setShortcutsOpen(false)}
        />
        <QuickInteractionModal
          isOpen={quickNoteOpen}
          onClose={() => setQuickNoteOpen(false)}
        />
        <Toaster
          theme="light"
          position="bottom-right"
          // The mobile tab bar is fixed to the bottom of the viewport, so a
          // default-offset toast lands underneath it and the user never sees
          // the confirmation they just triggered.
          mobileOffset={{ bottom: "96px", left: "12px", right: "12px" }}
          className="font-body"
          toastOptions={{
            className: "glass-panel shadow-lg !border-none",
            style: {
              color: "var(--color-on-surface)",
            },
          }}
        />
      </SessionProvider>
    </Router>
  );
}
