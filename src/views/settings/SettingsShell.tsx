/**
 * The settings shell, built from `registry.ts`: the rail beside the page from
 * `lg`, and the landing list and its pages below `lg`. The shell draws each
 * page's header and its end (Reset to defaults and tab bar room).
 *
 * Below `lg` a page links back to the list, as a phone's settings app does.
 * From `lg` the rail is on screen, so there is no back link to push the
 * title 20 px down. A page scrolls with its header in one scroller, and a
 * page that owns its scrolling (Lists, Tracked contacts) keeps the header
 * fixed above it.
 */
import React, {
  Suspense,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { PageHeader } from "../../components/layout/PageHeader";
import { SETTINGS_CONTENT_ID } from "../../components/layout/SkipLink";
import {
  SETTINGS_LIST_PATH,
  SETTINGS_PAGES,
  findSettingsPage,
  settingsBackLink,
  type SettingsPage,
} from "./registry";
import { SettingsRail } from "./SettingsRail";
import { SettingsHome } from "./SettingsHome";
import { SettingsHeaderContext } from "./SettingsHeader";
import {
  ResetScopeProvider,
  ResetToDefaults,
  useResetScope,
} from "./ResetToDefaults";
import {
  holdSlide,
  isPlainClick,
  settleSlide,
  useSlideNavigate,
} from "./slide";
import {
  RequireAdmin,
  SettingsRedirect,
} from "../../components/auth/RequireAdmin";
import { useAuth } from "../../components/auth/AuthGate";
import { useMediaQuery, WIDE_QUERY } from "../../hooks/useMediaQuery";
import { usePageTitle } from "../../hooks/usePageTitle";
import { PAGE_TOP, PAGE_X } from "../../lib/styles";
import { NAMES } from "../../lib/names";
import { cn } from "../../lib/utils";
import { SETTINGS_BOX, SETTINGS_PAGE } from "./layout";
import { settingsPagePreload, useWarmSettingsPages } from "./warm";

const UsersView = React.lazy(() =>
  import("./admin/UsersView").then((m) => ({ default: m.UsersView })),
);

/** In the page's own box, so the content lands in place. Holds the slide. */
const PageFallback = () => {
  useLayoutEffect(() => holdSlide(), []);
  return (
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
};

const PageRoute = ({
  ownsScrolling = false,
  children,
}: {
  ownsScrolling?: boolean;
  children: React.ReactNode;
}) =>
  ownsScrolling ? (
    <div className="h-full overflow-hidden">{children}</div>
  ) : (
    <>{children}</>
  );

export const SettingsShell = () => {
  const location = useLocation();
  const isWide = useMediaQuery(WIDE_QUERY);
  const slide = useSlideNavigate();
  const scrollerRef = useRef<HTMLDivElement>(null);

  const currentSubpage = findSettingsPage(location.pathname);
  const isSubpage = !!currentSubpage;
  const title = currentSubpage?.title ?? NAMES.settings.title;
  const ownsScrolling = currentSubpage?.ownsScrolling ?? false;
  const { isAdmin, authRequired } = useAuth();

  usePageTitle(title);
  useWarmSettingsPages({ isAdmin, authRequired });

  const { scope: resetScope, entries: resetEntries } = useResetScope();

  const [actionsTarget, setActionsTarget] = useState<HTMLDivElement | null>(
    null,
  );
  const [actionClaims, setActionClaims] = useState(0);
  const claimActions = useCallback(() => {
    setActionClaims((count) => count + 1);
    return () => setActionClaims((count) => count - 1);
  }, []);
  const headerSlot = useMemo(
    () => ({ target: actionsTarget, claim: claimActions }),
    [actionsTarget, claimActions],
  );

  // A page opens at its top, and the list comes back where it was left. The
  // list's place is saved on scroll, because by the time a page renders the
  // browser has clamped `scrollTop` to the shorter page.
  const listScroll = useRef(0);
  const onScrollerScroll = () => {
    if (!isSubpage && scrollerRef.current) {
      listScroll.current = scrollerRef.current.scrollTop;
    }
  };
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollTop = isSubpage ? 0 : listScroll.current;
    settleSlide(location.pathname);
    // The path, not the hash: a hash scrolls to its row on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const back = settingsBackLink(location.pathname, isWide);

  /** The stage catches the back link's click from `PageHeader` to slide. */
  const onStageClickCapture = (event: React.MouseEvent) => {
    if (!back || !isPlainClick(event)) return;
    const link = (event.target as Element).closest?.("a");
    if (link?.getAttribute("href") !== SETTINGS_LIST_PATH) return;
    event.preventDefault();
    event.stopPropagation();
    slide(SETTINGS_LIST_PATH, "back");
  };

  const header = (
    <PageHeader
      back={back}
      title={title}
      description={currentSubpage?.description}
      actions={
        actionClaims > 0 ? (
          <div ref={setActionsTarget} className="contents" />
        ) : undefined
      }
      className={cn(
        PAGE_TOP,
        // A full-width tool's header spans the column unless `boxed`. Other
        // headers take the page's box, in line with its first card.
        ownsScrolling
          ? cn(currentSubpage?.boxed ? SETTINGS_BOX : PAGE_X, "shrink-0")
          : SETTINGS_BOX,
      )}
    />
  );

  return (
    <SettingsHeaderContext.Provider value={headerSlot}>
      <ResetScopeProvider value={resetScope}>
        <div className="h-full flex overflow-hidden bg-surface text-on-surface">
          {/* A direct child: its handle measures the room from this row. */}
          <SettingsRail />

          {/* The stage slides below lg, so it has an opaque surface. */}
          <div
            id={SETTINGS_CONTENT_ID}
            tabIndex={-1}
            className="settings-stage flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-surface outline-none"
            onClickCapture={onStageClickCapture}
          >
            {/* A stable scrollbar lane keeps header and body centered in one
              width whether or not the page scrolls. */}
            {ownsScrolling && (
              <div className="shrink-0 overflow-hidden [scrollbar-gutter:stable]">
                {header}
              </div>
            )}

            {/* Not a second `main`: the app's layout draws the landmark. */}
            <div
              ref={scrollerRef}
              onScroll={onScrollerScroll}
              className={cn(
                "flex-1 min-h-0",
                ownsScrolling
                  ? "overflow-hidden"
                  : "overflow-y-auto [scrollbar-gutter:stable]",
              )}
            >
              {!ownsScrolling && header}
              {/* One boundary that stays mounted: a move in a transition keeps
                the last page up while new code loads. A new boundary shows
                "Loading…" at once and React holds it for 300 ms. */}
              <Suspense fallback={<PageFallback />}>
                <Routes>
                  <Route path="/" element={<SettingsHome />} />

                  <Route
                    path="admin/users/new"
                    element={
                      <RequireAdmin>
                        <PageRoute>
                          <UsersView createOpen />
                        </PageRoute>
                      </RequireAdmin>
                    }
                  />

                  {SETTINGS_PAGES.map((page: SettingsPage) => {
                    const Component = settingsPagePreload(page).Component;
                    const relativePath = page.path.replace(
                      /^\/settings\/?/,
                      "",
                    );
                    const element = (
                      <PageRoute ownsScrolling={page.ownsScrolling}>
                        <Component />
                      </PageRoute>
                    );
                    return (
                      <Route
                        key={page.id}
                        path={relativePath}
                        element={
                          page.admin ? (
                            <RequireAdmin>{element}</RequireAdmin>
                          ) : (
                            element
                          )
                        }
                      />
                    );
                  })}

                  <Route
                    path="*"
                    element={
                      <SettingsRedirect notice="Settings has no page at that address" />
                    }
                  />
                </Routes>
              </Suspense>
              {/* A page that owns its scrolling draws its own end. */}
              {!ownsScrolling && (
                <div className={cn(SETTINGS_BOX, "pb-28 md:pb-10")}>
                  <ResetToDefaults entries={resetEntries} />
                </div>
              )}
            </div>
          </div>
        </div>
      </ResetScopeProvider>
    </SettingsHeaderContext.Provider>
  );
};
