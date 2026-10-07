/**
 * Row-level search for Settings, in the rail and on the landing page.
 * Results group by page and link to `path#rowId`. Enter opens the first
 * match, and Escape clears.
 */
import React, { useMemo } from "react";
import { Search } from "lucide-react";
import { findRows, type SettingsSearchHit } from "./registry";
import { useAuth } from "../../components/auth/AuthGate";
import { SECTION_HEADING } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { SlideLink, useSlideNavigate } from "./slide";
import { NO_AUTOCORRECT } from "../../components/ui/SearchField";
import { ClearButton } from "../../components/ui/SearchField";

interface SettingsSearchProps {
  value: string;
  onChange: (val: string) => void;
  onSelect?: () => void;
  variant: "rail" | "landing";
}

export const SettingsSearch = ({
  value: query,
  onChange: setQuery,
  onSelect,
  variant,
}: SettingsSearchProps) => {
  const slide = useSlideNavigate();
  const { isAdmin, authRequired } = useAuth();

  const results = useMemo(() => {
    return findRows(query, { isAdmin, authRequired });
  }, [query, isAdmin, authRequired]);

  const groupedResults = useMemo(() => {
    const map = new Map<
      string,
      { page: SettingsSearchHit["page"]; hits: SettingsSearchHit[] }
    >();
    for (const hit of results) {
      if (!map.has(hit.page.id)) {
        map.set(hit.page.id, { page: hit.page, hits: [] });
      }
      map.get(hit.page.id)!.hits.push(hit);
    }
    return Array.from(map.values());
  }, [results]);

  const isRail = variant === "rail";

  /**
   * Only the rail clears, since it stays beside the page it opened. The
   * landing list slides away, and a cleared search would flash the full list
   * into the slide's picture.
   */
  const picked = () => {
    if (!isRail) return;
    setQuery("");
    onSelect?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && results.length > 0) {
      e.preventDefault();
      slide(results[0].path, "forward");
      picked();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setQuery("");
    }
  };

  return (
    <div className="flex flex-col">
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant pointer-events-none" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search settings"
          aria-label="Search settings"
          {...NO_AUTOCORRECT}
          className={cn(
            "w-full pl-10 pr-9 py-2.5 rounded-xl min-h-[44px] bg-surface-container-highest text-on-surface placeholder:text-on-surface-variant",
            isRail ? "text-sm" : "text-base sm:text-sm",
          )}
        />
        {query && (
          <ClearButton label="Clear search" onClick={() => setQuery("")} />
        )}
      </div>

      {query.trim().length > 0 && (
        <div
          role="region"
          aria-label="Search results"
          className={cn("mt-3 space-y-4", isRail ? "text-xs" : "text-sm")}
        >
          {results.length === 0 ? (
            <p className="text-xs sm:text-sm text-on-surface-variant text-center py-6">
              Nothing in Settings matches “{query.trim()}”
            </p>
          ) : (
            groupedResults.map(({ page, hits }) => {
              const Icon = page.icon;
              return (
                <div key={page.id} className="space-y-1">
                  <div
                    className={cn(
                      SECTION_HEADING,
                      "px-2 py-1 flex items-center gap-2",
                    )}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{page.title}</span>
                  </div>
                  <div className="space-y-0.5">
                    {hits.map((hit) => (
                      <SlideLink
                        key={hit.path}
                        to={hit.path}
                        onClick={picked}
                        className="state-layer flex items-center px-3 py-2 rounded-xl text-on-surface font-semibold transition-colors min-h-[44px] sm:pointer-fine:min-h-0"
                      >
                        <span className="truncate">{hit.label}</span>
                      </SlideLink>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
