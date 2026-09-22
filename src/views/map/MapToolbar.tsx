/**
 * MapToolbar — Top-left filter toolbar and mobile sheet for MapView.
 *
 * Provides:
 * - Search & facet filter input powered by `useQueryTokenizer`
 * - Facet pills for locked filters (including `list:`, `near:`)
 * - Autocomplete dropdown for facet prefixes (including `list:` and `tag:`)
 * - "Go to" place search mode with `flyTo` zoom 10 and inline error
 * - "Fit all" button with bounds fitting and reduced motion support
 * - Mobile filter sheet via Modal below `lg` breakpoint
 * - "0 of N match" empty state with "Clear filters" button
 * - "Select" menu (box, lasso, all in view) as an `ActionMenu`, so it reads
 *   and behaves like every other menu in the app
 *
 * @module views/map/MapToolbar
 */
import React, { useCallback, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import {
  Search,
  MapPin,
  Maximize2,
  SlidersHorizontal,
  X,
  Loader2,
  BarChart3,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { searchPlace } from "../../api/geo";
import { FacetPills } from "../../components/command-palette/FacetPills";
import { FacetAutocomplete } from "../../components/command-palette/FacetAutocomplete";
import { Modal } from "../../components/ui/Modal";
import {
  ActionMenu,
  type ActionMenuItem,
} from "../../components/ui/ActionMenu";
import { Segmented, type SegmentedOption } from "../../components/ui/Segmented";
import type { MapLayer, MapView } from "../../api/mapViews";
import { ViewsMenu } from "./ViewsMenu";
import type { MapContact } from "../../../shared/geo";
import { isValidLatLng } from "../../../shared/geo";
import type { FacetFilter } from "../../../shared/searchFacets";
import type { useQueryTokenizer } from "../../hooks/useQueryTokenizer";
import { prefersReducedMotion } from "./flyTo";
import { measureInsets, paddingFor } from "./insets";
import { cn } from "../../lib/utils";
import { SELECTED_TINT } from "../../lib/styles";

const LAYER_OPTIONS: readonly SegmentedOption<MapLayer>[] = [
  { value: "pins", label: "Pins" },
  { value: "heat", label: "Heat" },
  { value: "health", label: "Health" },
];

/**
 * A toolbar toggle's resting and selected looks. Selected is the tint and its
 * ink. The border turns transparent rather than going away, so the toggle
 * keeps its size.
 */
const TOGGLE_ON = cn(SELECTED_TINT, "border-transparent");
const TOGGLE_OFF =
  "state-layer bg-surface-container-high/60 text-on-surface border-outline-variant/30";

export interface MapToolbarProps {
  contacts: MapContact[];
  map: MapLibreMap | null;
  rawInput: string;
  setRawInput: (v: string) => void;
  tokenizer: ReturnType<typeof useQueryTokenizer>;
  effectiveFilters: FacetFilter[];
  filteredContacts: MapContact[];
  totalCount: number;
  matchCount: number;
  hasActiveFilter: boolean;
  resolveNearFilters: () => Promise<void>;
  clearFilters: () => void;
  layer: MapLayer;
  onLayerChange: (nextLayer: MapLayer) => void;
  views?: MapView[];
  activeViewId?: string | null;
  onSelectView?: (view: MapView) => void;
  onOpenSaveModal?: () => void;
  onStartRename?: (view: MapView) => void;
  onDeleteView?: (view: MapView) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onFitAll?: () => void;
  onToggleInsights?: () => void;
  onSelectInView?: () => void;
  onStartLasso?: () => void;
  isLassoActive?: boolean;
}

export const MapToolbar: React.FC<MapToolbarProps> = ({
  contacts,
  map,
  rawInput,
  setRawInput,
  tokenizer,
  effectiveFilters,
  filteredContacts,
  totalCount,
  matchCount,
  hasActiveFilter,
  resolveNearFilters,
  clearFilters,
  layer,
  onLayerChange,
  views = [],
  activeViewId = null,
  onSelectView,
  onOpenSaveModal,
  onStartRename,
  onDeleteView,
  inputRef: externalInputRef,
  onFitAll: externalFitAll,
  onToggleInsights,
  onSelectInView,
  onStartLasso,
  isLassoActive = false,
}) => {
  const localInputRef = useRef<HTMLInputElement | null>(null);
  const inputRef = externalInputRef || localInputRef;

  const [mode, setMode] = useState<"filter" | "goto">("filter");
  const [gotoQuery, setGotoQuery] = useState("");
  const [gotoLoading, setGotoLoading] = useState(false);
  const [gotoError, setGotoError] = useState<string | null>(null);
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false);

  // `ActionMenu` owns the Select menu. This mirrors its open state so the
  // trigger keeps its active look while the menu is open.
  const [selectMenuOpen, setSelectMenuOpen] = useState(false);

  const selectItems: ActionMenuItem[] = [
    {
      id: "box",
      label: "Box select",
      hint: "Shift+drag",
      onSelect: () => toast.info("Hold Shift and drag on the map to select"),
    },
    {
      id: "lasso",
      label: "Lasso select",
      hint: "L",
      onSelect: () => onStartLasso?.(),
    },
    {
      id: "in-view",
      label: "All in view",
      onSelect: () => onSelectInView?.(),
    },
  ];

  // Fit all logic
  const handleFitAll = useCallback(() => {
    if (externalFitAll) {
      externalFitAll();
      return;
    }
    if (!map) return;
    const targetContacts = filteredContacts.some((c) =>
      isValidLatLng(c.lat, c.lng),
    )
      ? filteredContacts
      : contacts;
    const valid = targetContacts.filter((c) => isValidLatLng(c.lat, c.lng));

    if (valid.length === 0) {
      map.flyTo({ center: [0, 20], zoom: 1.5 });
      return;
    }

    const padding = paddingFor(
      measureInsets(map.getContainer(), { contactOpen: false }),
    );
    const reduced = prefersReducedMotion();

    if (valid.length === 1) {
      const target = valid[0];
      if (reduced) {
        map.jumpTo({ center: [target.lng!, target.lat!], zoom: 10, padding });
      } else {
        map.flyTo({
          center: [target.lng!, target.lat!],
          zoom: 10,
          duration: 800,
          padding,
        });
      }
      return;
    }

    let minLng = valid[0].lng!;
    let maxLng = valid[0].lng!;
    let minLat = valid[0].lat!;
    let maxLat = valid[0].lat!;
    for (const c of valid) {
      if (c.lng! < minLng) minLng = c.lng!;
      if (c.lng! > maxLng) maxLng = c.lng!;
      if (c.lat! < minLat) minLat = c.lat!;
      if (c.lat! > maxLat) maxLat = c.lat!;
    }

    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      {
        padding,
        maxZoom: 14,
        duration: reduced ? 0 : 800,
      },
    );
  }, [externalFitAll, map, filteredContacts, contacts]);

  // Go to place search
  const handleGoTo = useCallback(async () => {
    if (!map || !gotoQuery.trim()) return;
    setGotoLoading(true);
    setGotoError(null);
    try {
      const res = await searchPlace(gotoQuery.trim());
      const reduced = prefersReducedMotion();
      const padding = paddingFor(
        measureInsets(map.getContainer(), { contactOpen: false }),
      );
      if (reduced) {
        map.jumpTo({ center: [res.lng, res.lat], zoom: 10, padding });
      } else {
        map.flyTo({
          center: [res.lng, res.lat],
          zoom: 10,
          duration: 800,
          padding,
        });
      }
      setGotoQuery("");
      setGotoError(null);
      setMode("filter");
      setIsMobileSheetOpen(false);
    } catch {
      setGotoError("Nothing found for that place");
    } finally {
      setGotoLoading(false);
    }
  }, [map, gotoQuery]);

  const renderToolbarContent = (isMobile = false) => (
    <div className="flex flex-col gap-2 w-full">
      {/* Top Input Row */}
      <div className="flex items-center gap-1.5 w-full">
        {/* Opaque while it has focus, so the map's labels do not show
            through the words being typed. */}
        <div className="focus-frame relative flex-1 flex items-center bg-surface-container-high/60 focus-within:bg-surface-container-high rounded-xl border border-outline-variant/30">
          {mode === "filter" ? (
            <>
              <Search className="absolute left-3 w-4 h-4 text-on-surface-variant pointer-events-none" />
              <input
                ref={isMobile ? undefined : inputRef}
                type="text"
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    resolveNearFilters();
                  }
                }}
                placeholder="Filter contacts… (/)"
                aria-label="Filter contacts"
                className="w-full bg-transparent text-sm text-on-surface placeholder:text-on-surface-variant/70 py-2 pl-9 pr-8"
              />
              {rawInput && (
                <button
                  type="button"
                  onClick={() => setRawInput("")}
                  aria-label="Clear filter text"
                  className="state-layer absolute right-2.5 p-1 text-on-surface-variant hover:text-on-surface rounded-full cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          ) : (
            <>
              <MapPin className="absolute left-3 w-4 h-4 text-primary pointer-events-none" />
              <input
                type="text"
                value={gotoQuery}
                onChange={(e) => {
                  setGotoQuery(e.target.value);
                  setGotoError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleGoTo();
                  } else if (e.key === "Escape") {
                    setMode("filter");
                  }
                }}
                placeholder="Go to place… (e.g. London)"
                aria-label="Go to place"
                className="w-full bg-transparent text-sm text-on-surface placeholder:text-on-surface-variant/70 py-2 pl-9 pr-8"
              />
              {gotoLoading ? (
                <Loader2 className="absolute right-2.5 w-4 h-4 text-primary animate-spin" />
              ) : (
                gotoQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setGotoQuery("");
                      setGotoError(null);
                    }}
                    aria-label="Clear place search"
                    className="state-layer absolute right-2.5 p-1 text-on-surface-variant hover:text-on-surface rounded-full cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )
              )}
            </>
          )}
        </div>

        {/* Go to Button */}
        <button
          type="button"
          onClick={() => {
            if (mode === "goto") {
              setMode("filter");
              setGotoError(null);
            } else {
              setMode("goto");
            }
          }}
          aria-label={mode === "goto" ? "Back to filters" : "Go to place"}
          aria-pressed={mode === "goto"}
          className={cn(
            "hit-area px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-colors shrink-0 border",
            mode === "goto" ? TOGGLE_ON : TOGGLE_OFF,
          )}
        >
          {mode === "goto" ? "Filter" : "Go to"}
        </button>

        {/* Fit All Button */}
        <button
          type="button"
          onClick={handleFitAll}
          aria-label="Fit all"
          title="Fit all contacts in view (F)"
          className={cn(
            "hit-area p-2 rounded-xl text-xs font-semibold border cursor-pointer transition-colors shrink-0",
            TOGGLE_OFF,
          )}
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      {/* Place Not Found Error */}
      {mode === "goto" && gotoError && (
        <div
          role="alert"
          className="text-xs text-error font-medium px-3 py-1 bg-error/10 rounded-lg border border-error/20"
        >
          {gotoError}
        </div>
      )}

      {/* Facet Pills */}
      {mode === "filter" && effectiveFilters.length > 0 && (
        <div className="w-full">
          <FacetPills
            filters={effectiveFilters}
            onRemove={tokenizer.removeFilter}
          />
        </div>
      )}

      {/* Autocomplete Dropdown */}
      {mode === "filter" && tokenizer.parsed.activePrefix && (
        <div className="relative w-full z-20">
          <FacetAutocomplete
            field={tokenizer.parsed.activePrefix.field}
            partial={tokenizer.parsed.activePrefix.partial}
            onSelect={(f) => tokenizer.addFilter(f)}
            onDismiss={() => {}}
          />
        </div>
      )}

      {/* 0 of N match empty state */}
      {hasActiveFilter && matchCount === 0 && (
        <div className="flex items-center justify-between text-xs px-3 py-1.5 text-on-surface-variant bg-surface-container-highest/80 rounded-xl border border-outline-variant/30">
          <span>0 of {totalCount} match</span>
          <button
            type="button"
            onClick={clearFilters}
            className="text-primary hover:underline font-semibold cursor-pointer ml-2"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Desktop Row 2: Layer Segmented Control + Views Menu + Select Menu */}
      {!isMobile && (
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-outline-variant/20">
          <Segmented<MapLayer>
            options={LAYER_OPTIONS}
            value={layer}
            onChange={onLayerChange}
            label="Map layer"
          />

          <div className="flex items-center gap-1.5 shrink-0">
            {onOpenSaveModal && (
              <ViewsMenu
                views={views}
                activeViewId={activeViewId}
                onSelectView={onSelectView ?? (() => {})}
                onOpenSaveModal={onOpenSaveModal}
                onStartRename={onStartRename ?? (() => {})}
                onDeleteView={onDeleteView ?? (() => {})}
              />
            )}

            <ActionMenu
              label="Select contacts"
              align="end"
              className="shrink-0"
              items={selectItems}
              onOpenChange={setSelectMenuOpen}
              triggerContent={
                <>
                  <span>Select</span>
                  <ChevronDown aria-hidden="true" className="w-3.5 h-3.5" />
                </>
              }
              triggerClassName={cn(
                "hit-area px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors border",
                selectMenuOpen || isLassoActive ? TOGGLE_ON : TOGGLE_OFF,
              )}
            />
          </div>
        </div>
      )}

      {/* Mobile Layer Control */}
      {isMobile && (
        <div className="pt-2 border-t border-outline-variant/20 flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-on-surface">
            Map layer
          </span>
          <Segmented<MapLayer>
            options={LAYER_OPTIONS}
            value={layer}
            onChange={onLayerChange}
            label="Map layer"
          />
        </div>
      )}

      {/* Mobile Views Menu */}
      {isMobile && onOpenSaveModal && (
        <div className="pt-2 border-t border-outline-variant/20 flex items-center justify-between">
          <span className="text-xs font-semibold text-on-surface">
            Saved views
          </span>
          <ViewsMenu
            isMobile
            views={views}
            activeViewId={activeViewId}
            onSelectView={(v) => {
              onSelectView?.(v);
              setIsMobileSheetOpen(false);
            }}
            onOpenSaveModal={() => {
              setIsMobileSheetOpen(false);
              onOpenSaveModal();
            }}
            onStartRename={onStartRename ?? (() => {})}
            onDeleteView={onDeleteView ?? (() => {})}
          />
        </div>
      )}

      {/* Mobile Select all in view */}
      {isMobile && onSelectInView && (
        <div className="pt-2 border-t border-outline-variant/20">
          <button
            type="button"
            onClick={() => {
              onSelectInView();
              setIsMobileSheetOpen(false);
            }}
            className="btn-secondary w-full"
          >
            <span>Select all in view</span>
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop Toolbar */}
      <div className="absolute top-4 left-4 z-10 w-[calc(100%-2rem)] max-w-[520px] hidden lg:flex flex-col gap-2 p-2 rounded-2xl glass-panel shadow-xl border border-outline-variant/20">
        {renderToolbarContent(false)}
      </div>

      {/* Mobile Toolbar Button */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2 lg:hidden">
        <button
          type="button"
          onClick={() => setIsMobileSheetOpen(true)}
          aria-label="Filters"
          className="hit-area state-layer glass-panel shadow-lg rounded-xl px-3 py-2 text-sm font-medium text-on-surface flex items-center gap-2 cursor-pointer border border-outline-variant/30"
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span>Filters</span>
          {hasActiveFilter && (
            <span className="inline-flex items-center justify-center bg-primary text-on-primary rounded-full text-xs font-semibold px-1.5 min-w-[18px] h-[18px]">
              {effectiveFilters.length || 1}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={handleFitAll}
          aria-label="Fit all"
          className="hit-area state-layer glass-panel shadow-lg rounded-xl p-2 text-sm font-medium text-on-surface cursor-pointer border border-outline-variant/30"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        {onToggleInsights && (
          <button
            type="button"
            onClick={onToggleInsights}
            aria-label="Insights"
            className="hit-area state-layer glass-panel shadow-lg rounded-xl px-2.5 py-2 text-sm font-medium text-on-surface flex items-center gap-1.5 cursor-pointer border border-outline-variant/30"
          >
            <BarChart3 className="w-4 h-4" />
            <span>Insights</span>
          </button>
        )}
      </div>

      {/* Mobile Filter Sheet Modal */}
      <Modal
        isOpen={isMobileSheetOpen}
        onClose={() => setIsMobileSheetOpen(false)}
        title="Filters"
        ariaLabel="Filters"
        size="md"
      >
        <div className="p-4 flex flex-col gap-3">
          {renderToolbarContent(true)}
        </div>
      </Modal>
    </>
  );
};
