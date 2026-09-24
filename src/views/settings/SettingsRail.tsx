/**
 * SettingsRail — The left navigation rail for wide screens (lg and up).
 *
 * The left pane, the way the Network list is: the same width, the same
 * edge to drag between 300 and 480 px, and one stored width for both
 * (`LEFT_PANE`), so moving between Network and Settings leaves the page
 * beside the pane where it was. It holds the search box at the top, group
 * headings in SECTION_HEADING, and rows with an icon, a label and an
 * optional count pill. The active row has aria-current="page" and wears the
 * selected row's tint, with its label in the tint's ink. One row is active:
 * the page the path belongs to (`findSettingsPage`), so Correspondents,
 * under the Connectors path, does not light Connectors too.
 *
 * The rows scroll with their bar on the left edge, as the Network list's
 * do (`dir="rtl"` on the scroller, `ltr` inside it), so the bar sits on the
 * sidebar's side and away from the page. The bar shows only while the
 * pointer is over the rail or the keyboard is in it (`scrollbar-on-hover`).
 *
 * The rail's own surface sets it apart from the page, with no line between
 * them. The label keeps one weight in both states, so the selected row's
 * label is as wide as it was.
 */
import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
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

export const SettingsRail = () => {
  const location = useLocation();
  const { isAdmin, authRequired } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");

  const counts = useAttentionCounts();

  /** The count pill beside a page's name: what is waiting there. */
  const badgeFor = (pageId: string): number => {
    switch (pageId) {
      case "duplicates":
        return counts.duplicates;
      case "enrichment":
        return counts.neverEnriched;
      case "import":
        return counts.failedImports;
      default:
        return 0;
    }
  };

  const isSearching = searchQuery.trim().length > 0;

  const activeId = findSettingsPage(location.pathname)?.id;

  return (
    // Not `overflow-hidden`: the handle's grip reaches past the rail's edge,
    // over the page, and a clip would cut it off. The rail paints over the
    // page (z 10) for the same reason.
    <aside className="relative z-10 hidden lg:flex flex-col w-(--pane-width) shrink-0 h-full bg-surface-container-low">
      {/* The same 8 px sides as the rows below, so the box and a selected
          row share one width. */}
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
          // 8 px sides and 10 px inside a row. A row the keyboard reaches
          // scrolls into view with 12 px to spare, not flush with the
          // rail's edge.
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
                            // face: its own tint over the row's measured
                            // 4.2 to 1.
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

export default SettingsRail;
