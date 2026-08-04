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
  Search,
  Sparkles,
  Activity,
} from "lucide-react";
import { LayoutGroup, AnimatePresence, motion } from "motion/react";
import { isTypingTarget } from "./lib/keyboard";
import { useGlobalNavShortcuts } from "./hooks/useGlobalNavShortcuts";
import { Toaster } from "sonner";
import React, { useState, useEffect, Suspense } from "react";

import { ContactList } from "./views/contact-list";
import { ContactDetail } from "./views/contact-detail";
import { CommandPalette } from "./components/command-palette";
import { KeyboardShortcutsModal } from "./components/KeyboardShortcutsModal";
import { QuickInteractionModal } from "./components/QuickInteractionModal";
import { navLink, SECTION_BG } from "./lib/styles";
import { cn } from "./lib/utils";

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

/** Minimal centered fallback shown while a lazy route chunk loads. */
const RouteFallback = () => (
  <div className="w-full h-full flex items-center justify-center">
    <span className="text-on-surface-variant font-bold animate-pulse">
      Loading...
    </span>
  </div>
);

import { Sidebar } from "./components/layout/Sidebar";
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

  const mobileNav = (
    <nav className="md:hidden fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-2 pb-6 pt-2 glass-panel rounded-t-xl shadow-[0_-4px_16px_rgba(0,0,0,0.05)]">
      <Link
        to={
          lastContactId && !isContactSelected
            ? `/contact/${lastContactId}`
            : "/"
        }
        className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-colors ${!isMapActive && !isPulse && !isCleanup && !isSearch ? "text-primary" : "text-on-surface-variant"}`}
      >
        <LayoutDashboard className="w-5 h-5" />
        <span className="text-[9px] font-bold tracking-wide">Network</span>
      </Link>
      <Link
        to="/pulse"
        className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-colors relative ${isPulse ? "text-primary" : "text-on-surface-variant"}`}
      >
        <Activity className="w-5 h-5" />
        <span className="text-[9px] font-bold tracking-wide">Pulse</span>
        {urgentCount > 0 && (
          <span className="absolute top-1 right-2.5 flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-error opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-error"></span>
          </span>
        )}
      </Link>
      <Link
        to="/map"
        className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-colors ${isMapActive ? "text-primary" : "text-on-surface-variant"}`}
      >
        <Map className="w-5 h-5" />
        <span className="text-[9px] font-bold tracking-wide">Map</span>
      </Link>
      <Link
        to="/search"
        className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-colors ${isSearch ? "text-primary" : "text-on-surface-variant"}`}
      >
        <Sparkles className="w-5 h-5" />
        <span className="text-[9px] font-bold tracking-wide">AI Search</span>
      </Link>
      <Link
        to="/settings"
        className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-colors ${isCleanup ? "text-primary" : "text-on-surface-variant"}`}
      >
        <SettingsIcon className="w-5 h-5" />
        <span className="text-[9px] font-bold tracking-wide">Settings</span>
      </Link>
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
                    <Suspense fallback={<RouteFallback />}>
                      <SettingsView />
                    </Suspense>
                  </RouteErrorBoundary>
                }
              />
              <Route
                path="/search"
                element={
                  <RouteErrorBoundary viewName="Search">
                    <Suspense fallback={<RouteFallback />}>
                      <SearchView />
                    </Suspense>
                  </RouteErrorBoundary>
                }
              />
              <Route
                path="/pulse"
                element={
                  <RouteErrorBoundary viewName="Dashboard">
                    <Suspense fallback={<RouteFallback />}>
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
      <div
        className={`${isContactSelected && !isMapActive ? "hidden lg:flex" : "hidden md:flex"}`}
      >
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
                <Suspense fallback={<RouteFallback />}>
                  <MapView />
                </Suspense>
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/map/contact/:id"
            element={
              <RouteErrorBoundary viewName="Map">
                <Suspense fallback={<RouteFallback />}>
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

      {/* Mobile Nav */}
      {!isContactSelected && mobileNav}
    </div>
  );
};

export default function App() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [quickNoteOpen, setQuickNoteOpen] = useState(false);

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
        <LayoutGroup>
          <AISearchProvider>
            <DedupeProvider>
              <ResponsiveLayout />
            </DedupeProvider>
          </AISearchProvider>
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
            className="font-body"
            toastOptions={{
              className: "glass-panel shadow-lg !border-none",
              style: {
                color: "var(--color-on-surface)",
              },
            }}
          />
        </LayoutGroup>
      </SessionProvider>
    </Router>
  );
}
