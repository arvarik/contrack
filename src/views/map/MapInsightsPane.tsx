/**
 * MapInsightsPane — who is in view, and what they have in common.
 *
 * From `lg` it is the page's `SidePanel`: a square button with the
 * insights glyph in the map's top-right corner, level with the toolbar, and
 * a 320 px panel that slides in under it from the window's edge. The panel carries
 * `data-covers-map="right"` while it is open, so the map keeps its pins, its
 * toolbar and its controls in the part it leaves (`insets.ts`). Below `lg`
 * the same content opens in a bottom sheet from the toolbar's Insights
 * button. The `mapPaneOpen` preference and the I key open and close it on a
 * wide screen.
 *
 * Two views: a summary of the people in view (their top industries,
 * companies and tags, each a filter to press on and off, and their time
 * zones) and the people themselves, the overdue first. Pointing at a person
 * marks their pin, and a press flies to it and shows their card.
 *
 * @module views/map/MapInsightsPane
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertTriangle,
  BarChart3,
  Briefcase,
  Building,
  Clock,
  Tag,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { isPastDay } from "../../../shared/dates";
import type { MapContact } from "../../../shared/geo";
import { formatFacet } from "../../../shared/facetQuery";
import type { FacetField, FacetFilter } from "../../../shared/searchFacets";
import { describeScore, scoreView } from "../../../shared/scoreBand";
import {
  SIDE_PANEL_SCROLLER,
  SidePanel,
} from "../../components/layout/SidePanel";
import { ScoreRingAvatar } from "../../components/ScoreRingAvatar";
import { EmptyState } from "../../components/ui/EmptyState";
import { Modal } from "../../components/ui/Modal";
import { Segmented, type SegmentedOption } from "../../components/ui/Segmented";
import { useMediaQuery, WIDE_QUERY } from "../../hooks/useMediaQuery";
import {
  SECTION_HEADING,
  SELECTED_TINT,
  TONE_TEXT,
  TONE_WASH,
  type Tone,
} from "../../lib/styles";
import { cn } from "../../lib/utils";
import type { MapEmpty, MapStats, TopBucket } from "./mapStats";
import { facetKey } from "./useMapFilter";

const INSIGHTS_TITLE = "Map insights";

type View = "summary" | "people";

const VIEWS: readonly SegmentedOption<View>[] = [
  { value: "summary", label: "Summary" },
  { value: "people", label: "People" },
];

/** A scroller that reaches the panel's edges, so its bar sits on the edge. */
const SCROLLER = SIDE_PANEL_SCROLLER;

/** The small caps heading over each group. */
const GROUP_HEADING = cn(SECTION_HEADING, "flex items-center gap-1.5 mb-1");

/** What the panel says with no one in view, by the reason. */
const EMPTY: Record<
  MapEmpty | "view",
  { title: string; body?: string; icon?: LucideIcon; tone?: Tone }
> = {
  loading: { title: "Loading contacts…" },
  failed: {
    title: "Could not load contacts",
    icon: AlertTriangle,
    tone: "error",
  },
  none: {
    title: "No one is on the map yet",
    body: "Add a location to a contact",
  },
  view: {
    title: "No one in view",
    body: "Zoom out or clear the filters to see who is here",
  },
};

/** What a summary bar needs to add its filter, or to remove it. */
interface FacetProps {
  /** The filter's pills. A bar whose pill is there shows it is on. */
  activeFilters?: readonly FacetFilter[];
  onApplyFacet: (facetQuery: string) => void;
  onRemoveFacet?: (index: number) => void;
}

interface MapInsightsPaneProps extends FacetProps {
  isOpen: boolean;
  onToggle: (open: boolean) => void;
  stats: MapStats;
  /** Why nobody is on the map, when nobody is. */
  empty?: MapEmpty;
  inViewContacts: MapContact[];
  onSelectContact: (contact: MapContact) => void;
  /** A People row points at its contact's pin, or at none. */
  onHighlightContact?: (id: string | null) => void;
}

export const MapInsightsPane = ({
  isOpen,
  onToggle,
  ...insights
}: MapInsightsPaneProps) => {
  const isWide = useMediaQuery(WIDE_QUERY);
  const [view, setView] = useState<View>("summary");
  // The switch between the two views. In the side panel it sits in the
  // heading row, where its two words and the content under it say what the
  // panel is, so the row holds the switch and the title stays for a screen
  // reader. In the sheet it heads the content, under the sheet's own
  // title.
  const viewSwitch = (
    <Segmented<View>
      options={VIEWS}
      value={view}
      onChange={setView}
      label="Insights view"
      className="shrink-0 self-start"
    />
  );
  const content = <InsightsContent view={view} {...insights} />;

  return (
    <>
      <SidePanel
        id="map-insights"
        title={INSIGHTS_TITLE}
        icon={BarChart3}
        inset="overlay"
        open={isWide && isOpen}
        onOpenChange={onToggle}
        shortcut="I"
        titleHidden
        lead={isWide && viewSwitch}
        panelProps={{
          "data-covers-map": isWide && isOpen ? "right" : undefined,
        }}
      >
        {isWide && content}
      </SidePanel>
      {!isWide && (
        <Modal
          isOpen={isOpen}
          onClose={() => onToggle(false)}
          title={INSIGHTS_TITLE}
          size="md"
        >
          <div className="flex flex-col gap-4 h-[70vh] max-h-[500px]">
            {viewSwitch}
            {content}
          </div>
        </Modal>
      )}
    </>
  );
};

type InsightsContentProps = Omit<
  MapInsightsPaneProps,
  "isOpen" | "onToggle"
> & {
  view: View;
};

const InsightsContent = ({
  view,
  stats,
  empty,
  inViewContacts,
  onSelectContact,
  onHighlightContact,
  ...facets
}: InsightsContentProps) => {
  return (
    <div className="flex flex-1 min-h-0 flex-col gap-4">
      {stats.inView === 0 ? (
        <EmptyState icon={Users} level={3} {...EMPTY[empty ?? "view"]} />
      ) : view === "summary" ? (
        <Summary stats={stats} {...facets} />
      ) : (
        <People
          contacts={inViewContacts}
          onSelect={onSelectContact}
          onHighlight={onHighlightContact}
        />
      )}
    </div>
  );
};

const Summary = ({ stats, ...facets }: { stats: MapStats } & FacetProps) => (
  <div className={cn(SCROLLER, "space-y-5")}>
    <Bars
      title="Top industries"
      icon={Briefcase}
      field="industry"
      items={stats.topIndustries}
      {...facets}
    />
    <Bars
      title="Top companies"
      icon={Building}
      field="company"
      items={stats.topCompanies}
      {...facets}
    />
    <Bars
      title="Top tags"
      icon={Tag}
      field="tag"
      items={stats.topTags}
      {...facets}
    />
    {stats.timeZones.length > 0 && (
      <section>
        <h3 className={GROUP_HEADING}>
          <Clock className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
          Time zones
        </h3>
        <ul>
          {stats.timeZones.map((zone) => (
            <li
              key={zone.label}
              className="flex items-center justify-between px-2 py-1.5 text-xs"
            >
              <span className="font-medium text-on-surface">{zone.label}</span>
              <span className="tabular-nums text-on-surface-variant">
                {zone.count} {zone.count === 1 ? "person" : "people"}
              </span>
            </li>
          ))}
        </ul>
      </section>
    )}
  </div>
);

/** One group: a bar per value, each a filter to press on and off. */
const Bars = ({
  title,
  icon: Icon,
  field,
  items,
  activeFilters = [],
  onApplyFacet,
  onRemoveFacet,
}: {
  title: string;
  icon: LucideIcon;
  field: FacetField;
  items: TopBucket[];
} & FacetProps) => {
  if (items.length === 0) return null;
  const most = Math.max(...items.map((item) => item.count), 1);
  return (
    <section>
      <h3 className={GROUP_HEADING}>
        <Icon className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
        {title}
      </h3>
      <ul>
        {items.map((item) => {
          const facet = { field, value: item.name.trim() };
          // The bar's own pill, when it is there: a press removes it.
          const pill = activeFilters.findIndex(
            (f) => facetKey(f) === facetKey(facet),
          );
          const on = pill >= 0;
          return (
            <li key={item.name}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() =>
                  on ? onRemoveFacet?.(pill) : onApplyFacet(formatFacet(facet))
                }
                aria-label={`Filter by ${field}: ${item.name} (${item.count})`}
                className={cn(
                  "hit-area state-layer w-full rounded-lg px-2 py-1.5 text-left cursor-pointer",
                  on && SELECTED_TINT,
                )}
              >
                <span className="flex items-center justify-between gap-2 text-xs font-medium mb-1">
                  <span className={cn("truncate", !on && "text-on-surface")}>
                    {item.name}
                  </span>
                  <span className="flex items-center gap-1 text-on-surface-variant font-bold tabular-nums shrink-0">
                    {item.count}
                    {on && <X className="w-3 h-3" aria-hidden="true" />}
                  </span>
                </span>
                <span className="block h-1.5 rounded-sm bg-surface-container-highest overflow-hidden">
                  <span
                    className="block h-full rounded-sm bg-primary"
                    style={{
                      width: `${Math.max(4, Math.round((item.count / most) * 100))}%`,
                    }}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

const ROW_HEIGHT = 56;

/**
 * The people in view, the overdue first and then by name. Virtualised: a
 * network can put thousands in view.
 */
const People = ({
  contacts,
  onSelect,
  onHighlight,
}: {
  contacts: MapContact[];
  onSelect: (contact: MapContact) => void;
  onHighlight?: (id: string | null) => void;
}) => {
  const scroller = useRef<HTMLDivElement>(null);
  const { people, overdue } = useMemo(() => {
    const now = new Date();
    const late = new Set(
      contacts.filter((c) => isPastDay(c.nextFollowUpAt, now)).map((c) => c.id),
    );
    return {
      people: [...contacts].sort(
        (a, b) =>
          Number(late.has(b.id)) - Number(late.has(a.id)) ||
          a.name.localeCompare(b.name),
      ),
      overdue: late,
    };
  }, [contacts]);
  // A list that goes away leaves no pin marked.
  useEffect(() => () => onHighlight?.(null), [onHighlight]);
  const rows = useVirtualizer({
    count: people.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5,
  });

  return (
    <div ref={scroller} className={SCROLLER}>
      <ul
        aria-label="People in view"
        className="relative"
        style={{ height: rows.getTotalSize() }}
        onMouseLeave={() => onHighlight?.(null)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            onHighlight?.(null);
        }}
      >
        {rows.getVirtualItems().map((row) => {
          const contact = people[row.index];
          if (!contact) return null;
          const late = overdue.has(contact.id);
          // The chip reads the same view as the ring, and shows nothing for
          // a contact with no score.
          const score = scoreView(contact);
          return (
            <li
              key={contact.id}
              className="absolute inset-x-0 top-0"
              style={{
                height: row.size,
                transform: `translateY(${row.start}px)`,
              }}
            >
              <button
                type="button"
                onClick={() => onSelect(contact)}
                onMouseEnter={() => onHighlight?.(contact.id)}
                onFocus={() => onHighlight?.(contact.id)}
                aria-label={[contact.name, contact.company, late && "overdue"]
                  .filter(Boolean)
                  .join(", ")}
                className="state-layer w-full h-full flex items-center gap-2.5 px-2 rounded-lg text-left cursor-pointer"
              >
                <ScoreRingAvatar contact={contact} size={36} decorative />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-on-surface truncate">
                    {contact.name}
                  </span>
                  <span className="block text-xs text-on-surface-variant truncate">
                    {late && (
                      <span className={cn("font-semibold", TONE_TEXT.error)}>
                        Overdue ·{" "}
                      </span>
                    )}
                    {contact.company ||
                      contact.role ||
                      contact.location ||
                      "No details"}
                  </span>
                </span>
                {score.kind === "scored" && (
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded-md text-[11px] font-bold tabular-nums shrink-0",
                      TONE_WASH[score.band.token],
                    )}
                    title={describeScore(score.score)}
                  >
                    {score.score}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
