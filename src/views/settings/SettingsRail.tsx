/**
 * SettingsRail — The left navigation rail for wide screens (lg and up).
 *
 * Fixed at 240px wide. Contains the search box at top, group headings in
 * SECTION_HEADING, and rows with icon, label and optional count pill.
 * The active row has aria-current="page" and wears the selected row's
 * tint, with its label in the tint's ink. One row is active: the page the
 * path belongs to (`findSettingsPage`), so Correspondents, under the
 * Connectors path, does not light Connectors too.
 *
 * The rail's own surface sets it apart from the page, with no line between
 * them. The label keeps one weight in both states, so the selected row's
 * label is as wide as it was and "Contact enrichment" still fits beside its
 * count.
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
    <aside className="w-[240px] shrink-0 bg-surface-container-low flex flex-col h-full overflow-hidden">
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
          // 8 px sides and 10 px inside a row, so the longest name beside
          // its count ("Contact enrichment", 30) fits the 240 px rail
          // without an ellipsis. A row the keyboard reaches scrolls into
          // view with 12 px to spare, not flush with the rail's edge.
          className="flex-1 overflow-y-auto px-2 py-2 space-y-4 scroll-py-3"
        >
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
        </nav>
      )}
    </aside>
  );
};

export default SettingsRail;
