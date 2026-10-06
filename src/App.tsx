import {
  BrowserRouter as Router,
  Routes,
  Route,
  useMatch,
  useLocation,
} from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { isScroller, isTypingTarget } from "./lib/keyboard";
import { navChordKey } from "./lib/platform";
import { whenIdle } from "./lib/idle";
import { useSettlePendingNav } from "./lib/pendingNav";
import { settingsShell, useWarmSettingsFromApp } from "./views/settings/warm";
import { useGlobalNavShortcuts } from "./hooks/useGlobalNavShortcuts";
import { Toaster } from "sonner";
import { CorvidFlight } from "./components/brand/CorvidFlight";
import { useState, useEffect, Suspense } from "react";

import { ContactList } from "./views/contact-list";
import { ContactDetail } from "./views/contact-detail";
import { CommandPalette } from "./components/command-palette";
import { KeyboardShortcutsModal } from "./components/KeyboardShortcutsModal";
import { QuickInteractionModal } from "./components/QuickInteractionModal";
import {
  OPEN_SHORTCUTS_EVENT,
  OPEN_QUICK_NOTE_EVENT,
  closeCommandPalette,
  type OpenQuickNoteDetail,
} from "./lib/appEvents";
import { NAMES } from "./lib/names";
import { useToastFocusReturn } from "./lib/undoToast";
import { usePreferences } from "./contexts/PreferencesContext";
import { useMediaQuery, WIDE_QUERY } from "./hooks/useMediaQuery";
import { useDialogOpen } from "./components/ui/Modal";

// Secondary pages load on demand, so the first bundle carries only the list
// and the contact. The app warms their code in idle moments and when a link
// is pointed at (`views/pages.ts`).
const MapView = mapPage.Component;
const PulseView = pulsePage.Component;
const SearchView = askPage.Component;
/** Warmed in idle moments too (`views/settings/warm.ts`). */
const SettingsShell = settingsShell.Component;

import { Sidebar } from "./components/layout/Sidebar";
import { MobileNav } from "./components/layout/MobileNav";
import { ResizeHandle } from "./components/layout/ResizeHandle";
import { LEFT_PANE } from "./components/layout/paneWidth";
import { SkipLink, MAIN_CONTENT_ID } from "./components/layout/SkipLink";
import {
  RouteFallback,
  type RouteFallbackVariant,
} from "./components/layout/RouteFallback";
import { askPage, mapPage, pulsePage, useWarmPages } from "./views/pages";
import { ConnectionBanner } from "./components/layout/ConnectionBanner";
import { StartRedirect } from "./components/layout/StartRedirect";
import { NotFoundPanel } from "./components/layout/StartPanel";
import { RouteErrorBoundary } from "./components/layout/RouteErrorBoundary";
import { starterQuestionsQuery } from "./api";
import { useQueryClient } from "@tanstack/react-query";
import { AISearchProvider } from "./contexts/AISearchContext";
import { DedupeProvider } from "./contexts/DedupeContext";
import { SessionProvider, useRecent } from "./contexts/SessionContext";
import { useSoftKeyboard } from "./hooks/useSoftKeyboard";

/** A control that keeps the focus a click gives it. */
const CONTROL =
  'a[href], button, input, textarea, select, [contenteditable="true"]';

/**
 * A click on blank space focuses the scroller under it. The landmarks take
 * focus by script, for the skip link, but a landmark does not scroll, so
 * Space, PageDown and the arrows would scroll nothing (and on a contact ↑ and
 * ↓ would open other contacts). The scroller takes no ring: a pointer put
 * it there.
 */
function useClickFocusesScroller() {
  useEffect(() => {
    let pressed: Element | null = null;
    const onPointerDown = (event: PointerEvent) => {
      pressed = event.target as Element;
      // The focus a press gives comes in the same task.
      setTimeout(() => (pressed = null));
    };
    const onFocusIn = (event: FocusEvent) => {
      const box = event.target as HTMLElement;
      if (!pressed || !box.contains(pressed) || box.tabIndex !== -1) return;
      if (box.matches(CONTROL)) return;
      for (
        let el: Element | null = pressed;
        el !== box;
        el = el.parentElement
      ) {
        if (!el) return;
        if (isScroller(el)) {
          // Taken back on blur: Chrome's Tab skips a scroller with a
          // tabindex of -1.
          const scroller = el;
          scroller.tabIndex = -1;
          scroller.style.outline = "none";
          scroller.addEventListener(
            "blur",
            () => {
              scroller.removeAttribute("tabindex");
              scroller.style.outline = "";
            },
            { once: true },
          );
          scroller.focus({ preventScroll: true });
          return;
        }
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, []);
}

const ResponsiveLayout = () => {
  const location = useLocation();
  useClickFocusesScroller();
  // A narrow context, so an AI-search keystroke does not redraw the app
  // (see SessionContext).
  const { setLastContactId } = useRecent();
  useGlobalNavShortcuts();
  const matchContact = useMatch("/contact/:id");
  const matchMapContact = useMatch("/map/contact/:id");
  const isContactSelected = matchContact || matchMapContact;
  const isHome = useMatch("/");

  // Track the most recently visited contact to restore it when clicking "Network"
  useEffect(() => {
    if (matchContact?.params.id) {
      setLastContactId(matchContact.params.id);
    }
  }, [matchContact?.params.id, setLastContactId]);

  // Deep links / other routes opened directly mark the session as started so later navigating to "/" does not redirect to pulse
  useEffect(() => {
    if (location.pathname !== "/") {
      sessionStorage.setItem("contrack.started", "true");
    }
  }, [location.pathname]);

  const isMapActive = location.pathname.startsWith("/map");
  const isCleanup = location.pathname.startsWith("/settings");

  // Warms the lazy pages' code in idle time, the map (the largest chunk)
  // first. A browser told to save data is left alone (`lib/idle.ts`).
  useWarmPages();

  // Fetches Ask's "Try asking" questions the same way: one small read.
  const queryClient = useQueryClient();
  useEffect(
    () =>
      whenIdle(() => void queryClient.prefetchQuery(starterQuestionsQuery())),
    [queryClient],
  );

  // Warm Settings the same way: its shell, then its pages (`warm.ts`).
  useWarmSettingsFromApp();
  const isSearch = location.pathname.startsWith("/search");
  const isPulse = location.pathname.startsWith("/pulse");

  // Clears the pressed-page mark in the sidebar and tab bar once the page
  // is on screen (`lib/pendingNav`).
  useSettlePendingNav();

  /**
   * Whether the list and the open contact sit side by side. Then the list is
   * a complementary "Contacts" landmark beside the contact's main. Below `lg`
   * they take turns, so whichever shows is the main.
   */
  const isWide = useMediaQuery(WIDE_QUERY);

  // Full-page views (cleanup, search, pulse) take the full main area
  const isFullPage = isCleanup || isSearch || isPulse;
  /**
   * An address that names no page. The pane says "Page not found", and on a
   * phone it shows in place of the list, as a contact does.
   */
  const isUnknown =
    !isFullPage && !isMapActive && !isHome && !isContactSelected;
  const showsPane = isContactSelected || isUnknown;
  const pageName = isCleanup
    ? NAMES.settings.label
    : isSearch
      ? NAMES.ask.label
      : NAMES.pulse.label;
  const fullPage = isFullPage && (
    <main
      id={MAIN_CONTENT_ID}
      tabIndex={-1}
      aria-label={pageName}
      className="flex-1 min-w-0 h-full overflow-hidden relative flex outline-none"
    >
      <div className="flex-1 min-w-0 h-full overflow-hidden">
        <Routes>
          <Route
            path="/settings/*"
            element={
              <RouteErrorBoundary viewName="Settings">
                <SettingsShell />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/search"
            element={
              <RouteErrorBoundary viewName="Search">
                <SearchView />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/pulse/*"
            element={
              <RouteErrorBoundary viewName="Dashboard">
                <PulseView />
              </RouteErrorBoundary>
            }
          />
        </Routes>
      </div>
    </main>
  );

  /**
   * The skeleton of the addressed page, shown only while the first page's
   * code downloads (see the boundary below).
   */
  const fallbackVariant: RouteFallbackVariant | null = isCleanup
    ? "settings"
    : isSearch
      ? "search"
      : isPulse
        ? "pulse"
        : isMapActive
          ? "map"
          : null;

  return (
    // The safe areas, when the page fills the screen (`viewport-fit=cover`).
    // On its side, a phone's cutout is at the left or the right.
    <div className="h-dvh w-full flex flex-col overflow-hidden bg-surface text-on-surface font-body font-medium pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <ConnectionBanner />
      <div className="flex-1 min-h-0 flex">
        {/* The navigation stays mounted at every width, a contact open or not. */}
        <SkipLink />
        <div className="hidden md:flex shrink-0">
          <Sidebar />
        </div>

        {/*
        One page boundary for every route, and it stays mounted. React shows a
        new boundary's fallback even in a transition and holds it 300 ms, so a
        boundary per page flashed a skeleton. With one, a navigation (a
        transition) keeps the current page until the next can draw. The
        fallback shows only on the first load.
      */}
        <Suspense
          fallback={
            <div className="flex-1 min-w-0 h-full overflow-hidden">
              {fallbackVariant && <RouteFallback variant={fallbackVariant} />}
            </div>
          }
        >
          {fullPage || (
            <>
              {/*
        The middle pane: the list or the map. Its landmark role changes, not
        the element, because swapping <main> for <aside> would remount the
        list and lose its search, scroll and selection.

        Below `lg` the list fills the row beside the rail (`flex-1`, not
        `w-full`, which overflows by the rail's width). From `lg` its width is
        `--pane-width`, set by the handle after it (`LEFT_PANE` has the
        bounds).
      */}
              <section
                id={
                  isMapActive || (!isWide && !showsPane)
                    ? MAIN_CONTENT_ID
                    : undefined
                }
                data-pane="list"
                role={isMapActive || !isWide ? "main" : "complementary"}
                aria-label={
                  isMapActive
                    ? NAMES.map.label
                    : isWide
                      ? "Contacts"
                      : NAMES.network.label
                }
                tabIndex={-1}
                className={`
        ${showsPane && !isMapActive ? "hidden lg:flex" : "flex"}
        ${isMapActive ? "flex-1 z-0" : "flex-1 min-w-0 lg:flex-none lg:w-(--pane-width) bg-surface-container-lowest z-10 lg:z-[15]"}
        h-full flex-col relative outline-none
      `}
              >
                <Routes>
                  <Route
                    path="/map"
                    element={
                      <RouteErrorBoundary viewName="Map">
                        <MapView />
                      </RouteErrorBoundary>
                    }
                  />
                  <Route
                    path="/map/contact/:id"
                    element={
                      <RouteErrorBoundary viewName="Map">
                        <MapView />
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

                {/* The list's right edge, from `lg`. The list sits over the
            contact (15 over 10), so the grip past the seam takes the pointer,
            and under the sidebar (20), whose Account menu opens across it. */}
                {!isMapActive && (
                  <ResizeHandle
                    {...LEFT_PANE}
                    label="Resize the contact list"
                    className="hidden lg:block absolute inset-y-0 right-0"
                  />
                )}
              </section>

              {/* Right Pane: Standard Detail View */}
              {!isMapActive && (
                <main
                  id={isWide || showsPane ? MAIN_CONTENT_ID : undefined}
                  tabIndex={-1}
                  aria-label="Contact"
                  className={`
          ${showsPane ? "flex" : "hidden lg:flex"}
          flex-1 min-w-0 bg-surface z-10 h-full overflow-hidden relative flex-col outline-none
        `}
                >
                  <Routes location={location}>
                    <Route path="/" element={<StartRedirect />} />
                    <Route
                      path="/contact/:id"
                      element={
                        <RouteErrorBoundary viewName="ContactDetail">
                          <ContactDetail />
                        </RouteErrorBoundary>
                      }
                    />
                    <Route path="*" element={<NotFoundPanel />} />
                  </Routes>
                </main>
              )}

              {/* Map Overlay Detail View */}
              {isMapActive && (
                <AnimatePresence>
                  {isContactSelected && (
                    // A region inside the page rather than a second main: the map
                    // stays the page's main content while a contact is open over it.
                    <motion.section
                      aria-label="Contact"
                      // The map reads this to center a pin beside the contact, not
                      // under it (`insets.ts`). The panel sits flush with the map's
                      // right edge, so its width is what it covers.
                      data-covers-map="right"
                      initial={{ x: "100%", opacity: 0.5 }}
                      animate={{ x: 0, opacity: 1 }}
                      exit={{ x: "100%", opacity: 0 }}
                      transition={{ type: "spring", bounce: 0, duration: 0.4 }}
                      // z 40 on a phone: under the tab bar's 50, over the map's 0.
                      className="absolute right-0 top-0 bottom-0 w-full md:w-[760px] lg:w-[860px] md:max-w-[calc(100vw-64px)] z-40 md:z-[100] shadow-2xl bg-surface overflow-hidden flex flex-col h-full"
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
                    </motion.section>
                  )}
                </AnimatePresence>
              )}
            </>
          )}
        </Suspense>

        {/* Always mounted, the contact page included, which reserves `pb-32` for it. */}
        <MobileNav />
      </div>
    </div>
  );
};

/**
 * The toasts, in a component of their own: a dialog opening or a preference
 * changing redraws them, not the whole app under `App`.
 */
const AppToaster = () => {
  const { mode } = usePreferences();
  // A phone's dialog is a sheet from the bottom, with Save at its foot.
  const dialogOpen = useDialogOpen();
  const centeredDialogs = useMediaQuery("(min-width: 640px)");
  const sheetOpen = dialogOpen && !centeredDialogs;
  return (
    <Toaster
      // The app's palette, not the system's, or a dark page draws dark text
      // on a light-theme toast.
      theme={mode}
      position={sheetOpen ? "top-center" : "bottom-right"}
      // Clear of the mobile tab bar at the bottom of the viewport.
      mobileOffset={{
        top: "calc(env(safe-area-inset-top) + 12px)",
        bottom: "calc(var(--tabbar-space) + var(--keyboard-inset) + 12px)",
        left: "12px",
        right: "12px",
      }}
      className="font-body"
      toastOptions={{
        className: "glass-panel shadow-lg !border-none",
        style: {
          color: "var(--color-on-surface)",
        },
      }}
    />
  );
};

export default function App() {
  // `data-typing` and `--keyboard-inset` for the phone's CSS (index.css).
  useSoftKeyboard();
  useToastFocusReturn();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [quickNoteOpen, setQuickNoteOpen] = useState(false);
  const [quickNoteContactId, setQuickNoteContactId] = useState<
    string | undefined
  >(undefined);

  // The sidebar's shortcuts button opens the same overlay `?` does.
  useEffect(() => {
    const open = () => setShortcutsOpen(true);
    window.addEventListener(OPEN_SHORTCUTS_EVENT, open);
    return () => window.removeEventListener(OPEN_SHORTCUTS_EVENT, open);
  }, []);

  // Listen for open-quick-note events from anywhere in the app (e.g. Pulse office L key)
  useEffect(() => {
    const handleQuickNote = (e: Event) => {
      const customEvent = e as CustomEvent<OpenQuickNoteDetail>;
      setQuickNoteContactId(customEvent.detail?.contactId);
      setQuickNoteOpen(true);
    };
    window.addEventListener(OPEN_QUICK_NOTE_EVENT, handleQuickNote);
    return () =>
      window.removeEventListener(OPEN_QUICK_NOTE_EVENT, handleQuickNote);
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

      // Cmd+Shift+I on a Mac, Ctrl+Alt+I on Windows and Linux, where the
      // browser keeps Ctrl+Shift+I for its developer tools (`lib/platform`).
      if (navChordKey(e) === "i") {
        e.preventDefault();
        // If Cmd+K is open, close it first. Not with an Escape: that only
        // clears a palette that holds text.
        closeCommandPalette();
        // On a contact page the note is about that contact.
        setQuickNoteContactId(
          window.location.pathname.match(/^\/(?:map\/)?contact\/([^/]+)/)?.[1],
        );
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
          No app-wide <LayoutGroup>: one shared group makes any `layout`
          change measure every `layout` component in the app.
        */}
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
          initialContactId={quickNoteContactId}
          onClose={() => {
            setQuickNoteOpen(false);
            setQuickNoteContactId(undefined);
          }}
        />
        {/* The corvid's flight layer. Like the toasts, it outlives the route
          that asked for it. It renders nothing until `flyCorvid()`. */}
        <CorvidFlight />
        <AppToaster />
      </SessionProvider>
    </Router>
  );
}
