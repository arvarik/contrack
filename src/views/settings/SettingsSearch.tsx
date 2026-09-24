/**
 * SettingsSearch — Row-level search for Settings.
 *
 * Used in both the left rail and the landing page.
 * Results are grouped by page. Enter opens the first match, Escape clears.
 * Row results link directly to path#rowId, and on a phone the page slides
 * in over the list (`useSlideNavigate`).
 */
import React, { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { findRows, type SettingsSearchHit } from "./registry";
import { useAuth } from "../../components/auth/AuthGate";
import { SECTION_HEADING } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { SlideLink, useSlideNavigate } from "./slide";

export interface SettingsSearchProps {
  value?: string;
  onChange?: (val: string) => void;
  onSelect?: () => void;
  variant?: "rail" | "landing";
  className?: string;
}

export const SettingsSearch = ({
  value: controlledValue,
  onChange: controlledOnChange,
  onSelect,
  variant = "landing",
  className,
}: SettingsSearchProps) => {
  const [internalQuery, setInternalQuery] = useState("");
  const isControlled = controlledValue !== undefined;
  const query = isControlled ? controlledValue : internalQuery;
  const setQuery = isControlled ? controlledOnChange! : setInternalQuery;

  const slide = useSlideNavigate();
  const { isAdmin, authRequired } = useAuth();

  const results = useMemo(() => {
    return findRows(query, { isAdmin, authRequired });
  }, [query, isAdmin, authRequired]);

  // Group hits by page
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
   * The rail stays on screen beside the page it opened, so its search
   * clears. The list slides away with its results still showing, and a
   * cleared search would flash the whole list in the picture first.
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
    <div className={cn("flex flex-col", className)}>
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant pointer-events-none" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search settings"
          aria-label="Search settings"
          className={cn(
            "w-full pl-10 pr-9 py-2.5 rounded-xl min-h-[44px] bg-surface-container-highest text-on-surface placeholder:text-on-surface-variant",
            // The clear button below is the one clear control; the
            // browser's own would draw a second one beside it.
            "[&::-webkit-search-cancel-button]:appearance-none",
            isRail ? "text-sm" : "text-base sm:text-sm",
          )}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="hit-area state-layer absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
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
                        className="state-layer flex items-center px-3 py-2 rounded-xl text-on-surface font-semibold transition-colors min-h-[44px] sm:min-h-0"
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

export default SettingsSearch;
