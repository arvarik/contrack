/**
 * SettingsSearch — Row-level search for Settings.
 *
 * Used in both the left rail and the landing page.
 * Results are grouped by page. Enter opens the first match, Escape clears.
 * Row results link directly to path#rowId.
 */
import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
import { findRows, type SettingsSearchHit } from "./registry";
import { useAuth } from "../../components/auth/AuthGate";
import { cn } from "../../lib/utils";

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

  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  const results = useMemo(() => {
    return findRows(query, { isAdmin });
  }, [query, isAdmin]);

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && results.length > 0) {
      e.preventDefault();
      const first = results[0];
      navigate(first.path);
      setQuery("");
      onSelect?.();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setQuery("");
    }
  };

  const handleClear = () => {
    setQuery("");
  };

  const isRail = variant === "rail";

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
            "w-full pl-10 pr-9 py-2.5 rounded-xl min-h-[44px]",
            isRail
              ? "bg-surface-container-highest text-on-surface text-sm placeholder:text-on-surface-variant"
              : "bg-surface-container-highest text-on-surface text-base sm:text-sm placeholder:text-on-surface-variant",
          )}
        />
        {query && (
          <button
            type="button"
            onClick={handleClear}
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
              Nothing in Settings matches “{query.trim()}”.
            </p>
          ) : (
            groupedResults.map(({ page, hits }) => {
              const Icon = page.icon;
              return (
                <div key={page.id} className="space-y-1">
                  <div className="px-2 py-1 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-on-surface-variant">
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{page.title}</span>
                  </div>
                  <div className="space-y-0.5">
                    {hits.map((hit) => (
                      <Link
                        key={hit.path}
                        to={hit.path}
                        onClick={() => {
                          setQuery("");
                          onSelect?.();
                        }}
                        className="state-layer flex items-center justify-between px-3 py-2 rounded-xl text-on-surface transition-colors min-h-[44px] sm:min-h-0"
                      >
                        <span className="font-semibold truncate">
                          {hit.label}
                        </span>
                        {hit.row && (
                          <span className="text-[11px] text-on-surface-variant ml-2 shrink-0">
                            #{hit.row.id}
                          </span>
                        )}
                      </Link>
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
