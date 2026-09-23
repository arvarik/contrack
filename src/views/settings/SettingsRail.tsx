/**
 * SettingsRail — The left navigation rail for wide screens (lg and up).
 *
 * Fixed at 240px wide. Contains the search box at top, group headings in
 * SECTION_HEADING, and rows with icon, label and optional count pill.
 * The active row has aria-current="page" and wears the selected row's
 * tint.
 */
import React, { useState, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { SETTINGS_GROUPS, SETTINGS_PAGES, type SettingsPage } from "./registry";
import { SettingsSearch } from "./SettingsSearch";
import { useAuth } from "../../components/auth/AuthGate";
import { useDedupeCount, useContacts } from "../../api";
import { useImports } from "../../api/imports";
import { SECTION_HEADING, SELECTED_ROW } from "../../lib/styles";
import { cn } from "../../lib/utils";

export const SettingsRail = () => {
  const location = useLocation();
  const { isAdmin, authRequired } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");

  const { data: dedupeData } = useDedupeCount();
  const dedupeCount =
    typeof dedupeData === "number" ? dedupeData : (dedupeData?.count ?? 0);
  const { data: contacts = [] } = useContacts();
  const { data: imports = [] } = useImports();

  const failedImportCount = useMemo(() => {
    const thirtyDaysAgo = Date.now() - 30 * 86400 * 1000;
    return imports.filter(
      (imp) =>
        new Date(imp.createdAt).getTime() >= thirtyDaysAgo &&
        (imp.status === "failed" || imp.failed > 0),
    ).length;
  }, [imports]);

  const neverEnrichedCount = useMemo(
    () =>
      contacts.filter((c) => !c.aiHydratedAt && !c.isArchived && !c.isGhost)
        .length,
    [contacts],
  );

  const getBadgeCount = (pageId: string): number | null => {
    switch (pageId) {
      case "duplicates":
        return dedupeCount > 0 ? dedupeCount : null;
      case "enrichment":
        return neverEnrichedCount > 0 ? neverEnrichedCount : null;
      case "import":
        return failedImportCount > 0 ? failedImportCount : null;
      default:
        return null;
    }
  };

  const isSearching = searchQuery.trim().length > 0;

  const currentPath = location.pathname;

  return (
    <aside className="w-[240px] shrink-0 bg-surface-container-low flex flex-col h-full overflow-hidden border-r border-surface-container/50">
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
          // 8 px sides, so the longest name beside its count ("Contact
          // enrichment", 30) fits the 240 px rail without an ellipsis.
          className="flex-1 overflow-y-auto px-2 py-2 space-y-4"
        >
          {SETTINGS_GROUPS.map((group) => {
            const pages = SETTINGS_PAGES.filter((page) => {
              if (page.group !== group.id) return false;
              if (page.admin && !isAdmin) return false;
              if (page.needsAccount && !authRequired) return false;
              return true;
            });

            if (pages.length === 0) return null;

            return (
              <div key={group.id} className="space-y-1">
                <h2 className={cn(SECTION_HEADING, "px-2 py-1")}>
                  {group.title}
                </h2>
                <div className="space-y-0.5">
                  {pages.map((page: SettingsPage) => {
                    const isActive =
                      currentPath === page.path ||
                      (page.path !== "/settings" &&
                        currentPath.startsWith(`${page.path}/`));
                    const badgeCount =
                      getBadgeCount(page.id) ??
                      (page.badge ? page.badge() : null);
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
                          "state-layer flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors",
                          isActive
                            ? cn(SELECTED_ROW, "text-on-primary-wash font-bold")
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
                        {badgeCount !== null &&
                          badgeCount !== undefined &&
                          badgeCount > 0 && (
                            <span
                              aria-hidden="true"
                              className="px-1.5 py-0.5 rounded-md text-xs font-bold bg-primary/20 text-on-primary-wash"
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
