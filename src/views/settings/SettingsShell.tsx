/**
 * SettingsShell — Two-pane settings shell on desktop, single-pane on mobile.
 *
 * Driven by registry.ts. From lg width, renders the rail (search and the
 * navigation groups, the left pane's width, which a person can drag) beside
 * the page. Below lg, renders the landing list and pages, with a link on
 * each page back to the list.
 *
 * The page's header is `PageHeader`: the page's title, its one-line
 * description from the registry, and the page's own actions at the right
 * (`SettingsHeaderActions`).
 *
 * The back link. From lg there is none: the rail and the app's sidebar are
 * both on screen, and a link above the title would only push every settings
 * title 20 px below every other page's. Below lg a page has "Settings",
 * back to the list, its parent, the way a phone's settings app does, and the
 * list has none. The move between the list and a page slides (`slide.tsx`).
 *
 * Scrolling. A page that scrolls carries its header with it, the way Pulse
 * does, in the page's one scroller. A page that owns its scrolling (the
 * Lists manager, Tracked contacts) keeps the header fixed above it. A page
 * opens at its top, and the list comes back where it was left.
 *
 * The end of a page. Under the page, in its box, the shell draws "Reset to
 * defaults" while a preference on the page is off its default
 * (`ResetToDefaults`), and the room for the phone's tab bar.
 */
import React, {
  Suspense,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { PageHeader } from "../../components/layout/PageHeader";
import {
  SETTINGS_LIST_PATH,
  SETTINGS_PAGES,
  REDIRECTS,
  findSettingsPage,
  settingsBackLink,
  type SettingsPage,
  type RedirectTarget,
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

/**
 * A page on its way, in the page's own box, so its content lands in place.
 * While it shows, a slide waits for the page (`holdSlide`).
 */
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

/**
 * One page. A page that owns its scrolling fills the pane and scrolls
 * itself; every other page is a block in the shell's one scroller.
 */
const PageRoute = ({
  ownsScrolling = false,
  children,
}: {
  ownsScrolling?: boolean;
  children: React.ReactNode;
}) => {
  const page = <Suspense fallback={<PageFallback />}>{children}</Suspense>;
  return ownsScrolling ? (
    <div className="h-full overflow-hidden">{page}</div>
  ) : (
    page
  );
};

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
  const slide = useSlideNavigate();
  const scrollerRef = useRef<HTMLDivElement>(null);

  const currentSubpage = findSettingsPage(location.pathname);
  const isSubpage = !!currentSubpage;
  const title = currentSubpage?.title ?? NAMES.settings.title;
  const ownsScrolling = currentSubpage?.ownsScrolling ?? false;

  usePageTitle(title);

  // The preferences the page's rows hold, for its Reset to defaults.
  const { scope: resetScope, entries: resetEntries } = useResetScope();

  // The page's actions, drawn in the header (`SettingsHeaderActions`).
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

  // A page opens at its top, and the list comes back where it was left.
  // The list's place is kept as it scrolls: by the time a page is in the
  // DOM the browser has already clamped `scrollTop` to the shorter page.
  // Then a slide that waits for this route can take its picture.
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

  // Below lg a page links back to the list, its parent. From lg the rail is
  // on screen, and a back link would say nothing it does not.
  const back = settingsBackLink(location.pathname, isWide);

  /**
   * The back link slides the page away. `PageHeader` draws the link, so the
   * stage catches its click on the way down, before the link navigates
   * without the slide.
   */
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
        // A page that owns its scrolling is a full-width tool, and its
        // header spans the column, unless it is `boxed`. Every other page is
        // a centred box, and the header takes the same box, so the title
        // starts above the page's first card and not off to its left.
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
          {/* The rail, from lg. A child of this row itself: the handle on
            its edge measures the room beside it from the row. */}
          <SettingsRail />

          {/* ── The stage: header and page. Below lg it is what slides, so it
            has its own opaque surface for the picture. ── */}
          <div
            className="settings-stage flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-surface"
            onClickCapture={onStageClickCapture}
          >
            {/* Every page centres its header and its body in the same width:
              the stage less a scrollbar's lane, kept whether or not the page
              scrolls. Without it a title sat 5.5 px further left on a page
              long enough to scroll. A page that owns its scrolling keeps
              the lane in its own scroller, so its header keeps one here. */}
            {ownsScrolling && (
              <div className="shrink-0 overflow-hidden [scrollbar-gutter:stable]">
                {header}
              </div>
            )}

            {/* The page's one scroller. Not a second `main`: the app's layout
              already draws the main landmark (and its `main-content` id)
              around the whole shell. */}
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
              <Routes>
                <Route path="/" element={<SettingsHome />} />

                {/* Special route for new user in Accounts */}
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

                {/* Registry driven pages */}
                {SETTINGS_PAGES.map((page: SettingsPage) => {
                  const Component = getLazyComponent(page);
                  const relativePath = page.path.replace(/^\/settings\/?/, "");
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
                <Route
                  path="*"
                  element={<Navigate to={SETTINGS_LIST_PATH} replace />}
                />
              </Routes>
              {/* The page's end, in its box: Reset to defaults when a value
                on the page is changed, and the room for the phone's tab
                bar. A page that owns its scrolling has its own end. */}
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

export default SettingsShell;
