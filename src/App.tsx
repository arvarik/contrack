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

// Route-level code splitting: secondary views load on demand so the initial
// bundle only carries the ContactList/ContactDetail critical path. Each lazy
// page renders at once when its code is here, and the app warms that code in
// idle moments and when a link to it is pointed at (`views/pages.ts`).
const MapView = mapPage.Component;
const PulseView = pulsePage.Component;
const SearchView = askPage.Component;
/**
 * Settings renders at once when its code is here (`settingsShell` in
 * `views/settings/warm.ts`), and the app warms that code in idle moments.
 */
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
 * A click on blank space focuses the scroller under it.
 *
 * The page's landmarks take focus by script, for the skip link, so a click
 * on blank space inside one gave it focus. A landmark does not scroll: the
 * scroller inside it does. So Space, PageDown and the arrows scrolled
 * nothing on a contact, Settings, Pulse or Ask, and on a contact ↑ and ↓
 * opened other contacts instead. Such a click now moves focus on to the
 * scroller between the click and the landmark, and the keys scroll what the
 * person clicked. The scroller takes no ring: a pointer put it there.
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
          el.tabIndex = -1;
          el.style.outline = "none";
          el.focus({ preventScroll: true });
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
  // Narrow context read — see SessionContext for the split rationale. This
  // component no longer re-renders on every AI-search keystroke.
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

  /**
   * Warm the lazy pages' code while the reader is elsewhere: the map first,
   * the largest chunk in the build, then Pulse and Ask Contrack. The first
   * visit to each then draws at once instead of starting with a download
   * and a skeleton. A browser told to save data is left alone (see
   * `lib/idle.ts`).
   */
  useWarmPages();

  /**
   * Fetch Ask's "Try asking" questions the same way, so the page opens with
   * them. The server keeps them ready, so this is one small read.
   */
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

  // The sidebar and the tab bar mark the page a person pressed at once,
  // before it can draw. This clears the mark once it is on screen
  // (`lib/pendingNav`).
  useSettlePendingNav();

  /**
   * Whether the contact list and the open contact sit side by side.
   *
   * Landmarks are the map a screen reader user navigates by, and on this
   * layout the map changes with the width. Side by side, the list is a
   * complementary "Contacts" landmark beside the contact's main. Below `lg`
   * the two take turns on screen, so whichever is showing is the page's main.
   */
  const isWide = useMediaQuery(WIDE_QUERY);

  // Full-page views (cleanup, search, pulse) take the full main area
  const isFullPage = isCleanup || isSearch || isPulse;
  /**
   * An address that names no page. The list is the catch-all, so it used to
   * show with an empty pane beside it. The pane says "Page not found", and
   * on a phone it shows in place of the list, as a contact does.
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
   * What the page area shows while the first page's code downloads: the
   * skeleton of the page the address names. After that first load it is
   * not shown again (see the boundary below).
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
    // The safe areas: the status bar and the camera's cutout, when the page
    // fills the screen (`viewport-fit=cover`). On its side, a phone's cutout
    // is at the left or the right, and the sidebar sat under it.
    <div className="h-dvh w-full flex flex-col overflow-hidden bg-surface text-on-surface font-body font-medium pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <ConnectionBanner />
      <div className="flex-1 min-h-0 flex">
        {/*
        The sidebar used to be suppressed (`hidden lg:flex`) whenever a contact
        was open, which meant that between 768 and 1023 px — an iPad in
        portrait — opening a contact left the screen with no global navigation
        at all: no sidebar, and no tab bar either, since that is `md:hidden`.
        The only way out was the in-page Back link. Navigation chrome is not
        something to reclaim space from; it stays mounted at every width.
      */}
        <SkipLink />
        <div className="hidden md:flex shrink-0">
          <Sidebar />
        </div>

        {/*
        One page boundary for every route, and it stays mounted.

        Each lazy page used to sit in a Suspense of its own, new on each
        switch. React shows a new boundary's fallback even inside a
        transition, and then holds it for 300 ms, so the first visit to
        Pulse, Ask Contrack or the map flashed a skeleton even when the code
        took 5 ms. Navigations are transitions (React Router starts one for
        each), and a transition keeps a boundary's content on screen while
        the next page suspends. So with one boundary here, the page on screen
        stays until the next one can draw, and they swap in one frame. The
        fallback shows only on the first load, when there is no page yet.
        The sidebar and the tab bar are outside it, and mark the page a
        person pressed at once (`lib/pendingNav`).
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
        Dynamic Middle/Main Panel mapping to either the List or the Map.

        On the map this pane is the main landmark. On the list it is the main
        landmark below `lg`, where it has the screen to itself, and a
        "Contacts" complementary landmark beside the open contact above it.
        The role changes rather than the element, because swapping <main> for
        <aside> would remount the list and lose its search, scroll and
        selection. The skip link picks its own target per route (SkipLink).

        Below `lg` the list fills the row beside the sidebar rail (`flex-1`).
        It was `w-full`, the whole row, so from 768 px it ran 64 px past the
        window and cut off Import, New and the sort menu. From `lg` its width
        is `--pane-width`, which the handle after it sets before the first
        paint and on each frame of a drag (`LEFT_PANE` has the bounds, and
        the Settings list shares them).
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

                {/* The list's right edge, from `lg`, where the list and the contact
            sit side by side. Below it the list fills the row. Inside the
            list's landmark, on its edge. From `lg` the list sits a layer
            over the contact (15 over 10), so the grip past the seam paints
            and takes the pointer, and under the sidebar (20), whose Account
            menu opens across the list. */}
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
                      // The map reads this to centre a pin beside the contact, not
                      // under it (`insets.ts`). The panel sits flush with the map's
                      // right edge, so its width is what it covers.
                      data-covers-map="right"
                      initial={{ x: "100%", opacity: 0.5 }}
                      animate={{ x: 0, opacity: 1 }}
                      exit={{ x: "100%", opacity: 0 }}
                      transition={{ type: "spring", bounce: 0, duration: 0.4 }}
                      // z 40 on a phone, under the tab bar's 50, so the bar stays on
                      // top and tappable over the contact, as it does over
                      // /contact/:id. The map page is z 0, so 40 still covers every
                      // pin and bar on it. From md there is no tab bar.
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

        {/*
        Mobile Nav — always mounted. It used to unmount on the detail view, so
        on a phone the screen users spend the most time on was also the one
        with no way to reach Pulse, Map, Ask Contrack, or Settings. The detail view
        already reserves `pb-32` at this width, so the bar has room to sit.
      */}
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
  const centredDialogs = useMediaQuery("(min-width: 640px)");
  const sheetOpen = dialogOpen && !centredDialogs;
  return (
    <Toaster
      // The app's own palette, not the system's: a dark page drew dark
      // grey descriptions on the dark glass of a light-theme toast.
      theme={mode}
      position={sheetOpen ? "top-center" : "bottom-right"}
      // The mobile tab bar is fixed to the bottom of the viewport, so a
      // default-offset toast lands underneath it and the user never sees
      // the confirmation they just triggered.
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
        {/*
          The corvid's flight layer. One overlay for the whole app, beside the
          toasts for the same reason they are here: both are owned by nobody
          in particular and both have to outlive whatever route asked for
          them. It renders nothing until somebody calls `flyCorvid()`.
        */}
        <CorvidFlight />
        <AppToaster />
      </SessionProvider>
    </Router>
  );
}
