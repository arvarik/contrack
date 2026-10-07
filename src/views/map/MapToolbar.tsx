/**
 * The map's filter toolbar at the top left, and its sheet below `lg`: the
 * filter box with facet pills and suggestions, "Go to" place search, Fit
 * all, the layer switch, Views and Select.
 *
 * Box and lasso select need a pointer, so a touch screen gets only All in
 * view. Focus follows the field that shows: "Go to" puts it in the place
 * box, and Enter or Escape there puts it back in the filter box.
 */
import React, {
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
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
import { ViewsMenu, type ViewsMenuProps } from "./ViewsMenu";
import type { MapFilter } from "./useMapFilter";
import { prefersReducedMotion } from "../../lib/motion";
import { MIN_OPEN_PX, measureInsets, paddingFor } from "./insets";
import { cn, errorText } from "../../lib/utils";
import { SELECTED_TINT, TONE_WASH } from "../../lib/styles";
import { useMediaQuery, WIDE_QUERY } from "../../hooks/useMediaQuery";
import { PaletteButton } from "../../components/command-palette/PaletteButton";
import { NO_AUTOCORRECT } from "../../components/ui/SearchField";
import { ClearButton } from "../../components/ui/SearchField";

const LAYER_OPTIONS: readonly SegmentedOption<MapLayer>[] = [
  { value: "pins", label: "Pins" },
  { value: "heat", label: "Heat" },
];

/** What the page asks of the toolbar: "/" puts the focus in the filter. */
export interface MapToolbarHandle {
  focusFilter: () => void;
}

// A selected toggle keeps a transparent border, so it keeps its size.
const TOGGLE_ON = cn(SELECTED_TINT, "border-transparent");
const TOGGLE_OFF =
  "state-layer bg-surface-container-high/60 text-on-surface border-outline-variant/30";

interface MapToolbarProps {
  map: MapLibreMap | null;
  filter: MapFilter;
  layer: MapLayer;
  onLayerChange: (nextLayer: MapLayer) => void;
  views?: MapView[];
  activeViewId?: string | null;
  onSelectView?: (view: MapView) => void;
  onOpenSaveModal?: () => void;
  onStartRename?: (view: MapView) => void;
  onDeleteView?: (view: MapView) => void;
  /** Update and move, for the Views menu. */
  viewEdits?: Pick<ViewsMenuProps, "lastView" | "onUpdateView" | "onMoveView">;
  /** The page's handle on the toolbar, for the "/" key. */
  handleRef?: React.Ref<MapToolbarHandle>;
  /**
   * How much map an open contact leaves at the toolbar's left, in px, or
   * null for the whole page. Under `MIN_OPEN_PX` the toolbar steps aside.
   */
  room?: number | null;
  onFitAll: () => void;
  onToggleInsights?: () => void;
  onSelectInView?: () => void;
  onStartLasso?: () => void;
  isLassoActive?: boolean;
}

export const MapToolbar: React.FC<MapToolbarProps> = ({
  map,
  filter,
  layer,
  onLayerChange,
  views = [],
  activeViewId = null,
  onSelectView,
  onOpenSaveModal,
  onStartRename,
  onDeleteView,
  viewEdits,
  handleRef,
  room = null,
  onFitAll,
  onToggleInsights,
  onSelectInView,
  onStartLasso,
  isLassoActive = false,
}) => {
  const barInput = useRef<HTMLInputElement | null>(null);

  const [mode, setMode] = useState<"filter" | "goto">("filter");
  const [gotoQuery, setGotoQuery] = useState("");
  const [gotoLoading, setGotoLoading] = useState(false);
  const [gotoError, setGotoError] = useState<string | null>(null);
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false);
  // A fine pointer gets the "/" hint, Shift+drag and the lasso. A touch
  // screen gets none of them.
  const keyHint = useMediaQuery("(pointer: fine)");
  const isWide = useMediaQuery(WIDE_QUERY);
  // Asks the filter box that mounts next to take the focus (back from Go to,
  // or in the sheet "/" opened). The sheet's box mounts a render late.
  const [focusFilter, setFocusFilter] = useState(false);
  // The facet suggestions show only under the focused box: under a box that
  // lost the focus, they take Enter from a pin.
  const [suggestIn, setSuggestIn] = useState<"bar" | "sheet" | null>(null);

  // Mirrors the Select `ActionMenu`'s open state for the trigger's look.
  const [selectMenuOpen, setSelectMenuOpen] = useState(false);

  const selectItems: ActionMenuItem[] = [
    {
      id: "in-view",
      label: "All in view",
      onSelect: () => onSelectInView?.(),
    },
    ...(keyHint
      ? [
          {
            id: "box",
            label: "Box select",
            hint: "Shift+drag",
            onSelect: () =>
              toast.info("Hold Shift and drag over the pins", {
                description: "Or move the map to them and choose All in view",
              }),
          },
          {
            id: "lasso",
            label: "Lasso select",
            hint: "L",
            onSelect: () => onStartLasso?.(),
          },
        ]
      : []),
  ];

  /** Back to the filter box, with the focus in it. */
  const leaveGoto = useCallback(() => {
    setMode("filter");
    setGotoError(null);
    setFocusFilter(true);
  }, []);

  // With a contact open, the toolbar keeps to the map the contact leaves.
  const cramped = room !== null && room < MIN_OPEN_PX;
  const roomWidth = room !== null ? room - 32 : null;
  // Below `lg`, or beside an open contact, the filter box is in the sheet.
  const barShows = isWide && !cramped;

  useImperativeHandle(
    handleRef,
    () => ({
      focusFilter: () => {
        if (mode === "filter" && barShows) {
          barInput.current?.focus();
          return;
        }
        leaveGoto();
        if (!barShows) setIsMobileSheetOpen(true);
      },
    }),
    [barShows, leaveGoto, mode],
  );

  const handleGoTo = useCallback(async () => {
    // The place search needs two characters, as the pin dialog's Find does.
    if (!map || gotoQuery.trim().length < 2) return;
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
      if (res.displayName) toast(`Showing ${res.displayName}`);
      setGotoQuery("");
      leaveGoto();
      setIsMobileSheetOpen(false);
    } catch (error) {
      // The server says which: nothing found, a busy geocoder, no server.
      setGotoError(errorText(error) || "Nothing found for that place");
    } finally {
      setGotoLoading(false);
    }
  }, [map, gotoQuery, leaveGoto]);

  const renderToolbarContent = (isMobile = false) => (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center gap-1.5 w-full">
        {/* Opaque while it has focus, so the map's labels do not show
            through the words being typed. */}
        <div className="focus-frame relative flex-1 flex items-center bg-surface-container-high/60 focus-within:bg-surface-container-high rounded-xl border border-outline-variant/30">
          {mode === "filter" ? (
            <>
              <Search className="absolute left-3 w-4 h-4 text-on-surface-variant pointer-events-none" />
              {/* Keyed: the two boxes share a place in the tree, and a
                  shared input would never mount, so it would take no focus. */}
              <input
                key="filter"
                ref={isMobile ? undefined : barInput}
                type="text"
                {...NO_AUTOCORRECT}
                // Only when asked: back from Go to, or "/" in the sheet.
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus={focusFilter}
                value={filter.rawInput}
                onChange={(e) => {
                  filter.setRawInput(e.target.value);
                  setSuggestIn(isMobile ? "sheet" : "bar");
                }}
                onFocus={() => {
                  setSuggestIn(isMobile ? "sheet" : "bar");
                  setFocusFilter(false);
                }}
                onBlur={() => setSuggestIn(null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    filter.commit();
                  } else if (e.key === "Escape" && filter.rawInput) {
                    // Escape clears the box, as every search box does, and
                    // leaves an open contact open.
                    e.preventDefault();
                    filter.setRawInput("");
                  }
                }}
                placeholder={
                  keyHint ? "Filter contacts… (/)" : "Filter contacts…"
                }
                aria-label="Filter contacts"
                className="w-full bg-transparent text-sm text-on-surface placeholder:text-on-surface-variant/70 py-2 pl-9 pr-8"
              />
              {filter.rawInput && (
                <ClearButton
                  label="Clear filter text"
                  onClick={() => filter.setRawInput("")}
                />
              )}
            </>
          ) : (
            <>
              <MapPin className="absolute left-3 w-4 h-4 text-primary pointer-events-none" />
              <input
                key="goto"
                type="text"
                {...NO_AUTOCORRECT}
                // It mounts on request, so it takes the focus from the toggle.
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
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
                    e.preventDefault();
                    leaveGoto();
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
                  <ClearButton
                    label="Clear place search"
                    onClick={() => {
                      setGotoQuery("");
                      setGotoError(null);
                    }}
                  />
                )
              )}
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            if (mode === "goto") leaveGoto();
            else setMode("goto");
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

        <button
          type="button"
          onClick={onFitAll}
          aria-label="Fit all"
          title="Fit all contacts in view (F)"
          className={cn(
            "hit-area p-2 rounded-xl text-xs font-semibold border cursor-pointer transition-colors shrink-0",
            TOGGLE_OFF,
          )}
        >
          <Maximize2 className="w-4 h-4" />
        </button>

        {/* The map has no page header: a touch screen opens the palette
            here, or from the phone's top bar, as the sheet is a dialog. */}
        {!isMobile && <PaletteButton className="shrink-0" />}
      </div>

      {mode === "goto" && gotoError && (
        <div
          role="alert"
          className="text-xs text-error font-medium px-3 py-1 bg-error/10 rounded-lg border border-error/20"
        >
          {gotoError}
        </div>
      )}

      {/* Clear all shows for any filter, the bottom line's overdue one too. */}
      {mode === "filter" && filter.hasActiveFilter && (
        <div className="flex items-end gap-2 w-full">
          <div className="flex-1 min-w-0">
            <FacetPills
              filters={filter.effectiveFilters}
              onRemove={filter.removeFacet}
            />
            {filter.people && (
              <button
                type="button"
                onClick={filter.clearPeople}
                aria-label="Remove filter: the people from Ask"
                className={cn(
                  "hit-area state-layer group mx-4 mt-2 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold cursor-pointer",
                  TONE_WASH.primary,
                )}
              >
                {filter.people.size} people from Ask
                <X className="w-3 h-3 opacity-40 group-hover:opacity-100" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={filter.clearFilters}
            aria-label="Clear all filters"
            className="hit-area shrink-0 px-1 py-0.5 text-xs font-semibold text-primary hover:underline cursor-pointer"
          >
            Clear all
          </button>
        </div>
      )}

      {mode === "filter" &&
        filter.parsed.activePrefix &&
        suggestIn === (isMobile ? "sheet" : "bar") && (
          <div className="relative w-full z-20">
            <FacetAutocomplete
              field={filter.parsed.activePrefix.field}
              partial={filter.parsed.activePrefix.partial}
              onSelect={filter.addFacet}
              onDismiss={() => setSuggestIn(null)}
            />
          </div>
        )}

      {filter.hasActiveFilter && filter.matchCount === 0 && (
        <div className="text-xs px-3 py-1.5 text-on-surface-variant bg-surface-container-highest/80 rounded-xl border border-outline-variant/30">
          0 of {filter.totalCount} match
        </div>
      )}

      {/* Views and Select wrap under the layers in a narrow toolbar. */}
      {!isMobile && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
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
                {...viewEdits}
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
            {...viewEdits}
          />
        </div>
      )}

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
      {!cramped && (
        <div
          data-map-chrome="top"
          className="absolute top-4 left-4 z-10 w-[calc(100%-2rem)] max-w-[520px] hidden lg:flex flex-col gap-2 p-2 rounded-2xl glass-panel shadow-xl border border-outline-variant/20"
          style={
            roomWidth !== null
              ? { maxWidth: Math.min(520, roomWidth) }
              : undefined
          }
        >
          {renderToolbarContent(false)}
        </div>
      )}

      {!cramped && (
        <div
          data-map-chrome="top"
          className="absolute top-4 left-4 z-10 flex items-center gap-2 lg:hidden"
        >
          <button
            type="button"
            onClick={() => setIsMobileSheetOpen(true)}
            aria-label="Filters"
            className="hit-area state-layer glass-panel shadow-lg rounded-xl px-3 py-2 text-sm font-medium text-on-surface flex items-center gap-2 cursor-pointer border border-outline-variant/30"
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span>Filters</span>
            {filter.hasActiveFilter && (
              <span className="inline-flex items-center justify-center bg-primary text-on-primary rounded-full text-xs font-semibold px-1.5 min-w-[18px] h-[18px]">
                {filter.effectiveFilters.length || 1}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={onFitAll}
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
          <PaletteButton className="glass-panel shadow-lg rounded-xl border border-outline-variant/30" />
        </div>
      )}

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
