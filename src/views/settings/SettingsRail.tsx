/**
 * The settings rail from `lg`. It shares the Network list's resizable width
 * (`LEFT_PANE`), so the page stays put between the two. Only the page that
 * owns the path is active (`findSettingsPage`), so Correspondents, under the
 * Connectors path, does not light Connectors too.
 *
 * `dir="rtl"` on the scroller puts its bar on the sidebar's side, as in the
 * Network list. The label keeps one weight, so a selected label keeps its
 * width.
 */
import { useContext, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { QueryClientContext } from "@tanstack/react-query";
import {
  SETTINGS_GROUPS,
  SETTINGS_PAGES,
  findSettingsPage,
  isSettingsPageVisible,
  type SettingsPage,
} from "./registry";
import { SettingsSearch } from "./SettingsSearch";
import { useAuth } from "../../components/auth/AuthGate";
import { useAttentionCounts } from "./NeedsAttention";
import { ResizeHandle } from "../../components/layout/ResizeHandle";
import { LEFT_PANE } from "../../components/layout/paneWidth";
import { SECTION_HEADING, SELECTED_ROW } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { warmSettingsPage } from "./warm";

export const SettingsRail = () => {
  const location = useLocation();
  const { isAdmin, authRequired } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const queryClient = useContext(QueryClientContext);

  const counts = useAttentionCounts();

  const badgeFor = (pageId: string): number => {
    switch (pageId) {
      case "duplicates":
        return counts.duplicates;
      case "import":
        return counts.failedImports;
      default:
        return 0;
    }
  };

  const isSearching = searchQuery.trim().length > 0;

  const activeId = findSettingsPage(location.pathname)?.id;

  return (
    // No `overflow-hidden` and z 10: the handle's grip reaches over the page.
    <aside className="relative z-10 hidden lg:flex flex-col w-(--pane-width) shrink-0 h-full bg-surface-container-low">
      <div className="px-2 pt-3 pb-2 shrink-0">
        <SettingsSearch
          value={searchQuery}
          onChange={setSearchQuery}
          variant="rail"
          onSelect={() => setSearchQuery("")}
        />
      </div>

      {!isSearching && (
        <nav
          aria-label="Settings"
          dir="rtl"
          // A row the keyboard reaches scrolls in with 12 px to spare.
          className="flex-1 min-h-0 overflow-y-auto scrollbar-on-hover px-2 py-2 scroll-py-3"
        >
          <div dir="ltr" className="space-y-4">
            {SETTINGS_GROUPS.map((group) => {
              const pages = SETTINGS_PAGES.filter(
                (page) =>
                  page.group === group.id &&
                  isSettingsPageVisible(page, { isAdmin, authRequired }),
              );

              if (pages.length === 0) return null;

              return (
                <div key={group.id} className="space-y-1">
                  <h2 className={cn(SECTION_HEADING, "px-2 py-1")}>
                    {group.title}
                  </h2>
                  <div className="space-y-0.5">
                    {pages.map((page: SettingsPage) => {
                      const isActive = page.id === activeId;
                      const badgeCount = badgeFor(page.id);
                      const Icon = page.icon;

                      return (
                        <Link
                          key={page.id}
                          to={page.path}
                          onPointerEnter={() =>
                            warmSettingsPage(page, queryClient)
                          }
                          onFocus={() => warmSettingsPage(page, queryClient)}
                          aria-current={isActive ? "page" : undefined}
                          aria-label={
                            badgeCount
                              ? `${page.title}, ${badgeCount} waiting`
                              : page.title
                          }
                          className={cn(
                            "state-layer flex items-center gap-2 px-2.5 py-2 rounded-xl text-sm font-medium transition-colors",
                            isActive
                              ? cn(SELECTED_ROW, "text-on-primary-wash")
                              : "text-on-surface",
                          )}
                        >
                          <Icon
                            className={cn(
                              "w-4 h-4 shrink-0",
                              !isActive && "text-on-surface-variant",
                            )}
                          />
                          <span className="truncate flex-1">{page.title}</span>
                          {badgeCount > 0 && (
                            // On the selected row the pill takes the card
                            // face: its tint over the row's measured 4.2:1.
                            <span
                              aria-hidden="true"
                              className={cn(
                                "shrink-0 px-1 py-0.5 rounded-md text-xs font-bold text-on-primary-wash tabular-nums",
                                isActive
                                  ? "bg-surface-container-lowest"
                                  : "bg-primary/20",
                              )}
                            >
                              {badgeCount}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </nav>
      )}

      <ResizeHandle
        {...LEFT_PANE}
        label="Resize the settings list"
        className="absolute inset-y-0 right-0"
      />
    </aside>
  );
};
