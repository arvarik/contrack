/**
 * MapInsightsPane — who is in view, and what they have in common.
 *
 * From `lg` it is the page's `SidePanel`: an Insights button in the map's
 * top-right corner, level with the toolbar, and a 320 px panel that slides
 * in under it from the window's edge. The panel carries
 * `data-covers-map="right"` while it is open, so the map keeps its pins, its
 * toolbar and its controls in the part it leaves (`insets.ts`). Below `lg`
 * the same content opens in a bottom sheet from the toolbar's Insights
 * button. The `mapPaneOpen` preference and the I key open and close it on a
 * wide screen.
 *
 * Two views: a summary of the people in view (their top industries,
 * companies and tags, each a filter to press, and their time zones) and the
 * people themselves, a virtualised list where a press flies to the pin.
 *
 * @module views/map/MapInsightsPane
 */
import { useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  BarChart3,
  Briefcase,
  Building,
  Clock,
  Tag,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { MapContact } from "../../../shared/geo";
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
import { SECTION_HEADING, TONE_WASH } from "../../lib/styles";
import { cn } from "../../lib/utils";
import type { MapStats, TopBucket } from "./mapStats";

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

export interface MapInsightsPaneProps {
  isOpen: boolean;
  onToggle: (open: boolean) => void;
  stats: MapStats;
  inViewContacts: MapContact[];
  onApplyFacet: (facetQuery: string) => void;
  onSelectContact: (contact: MapContact) => void;
}

export const MapInsightsPane = ({
  isOpen,
  onToggle,
  stats,
  inViewContacts,
  onApplyFacet,
  onSelectContact,
}: MapInsightsPaneProps) => {
  const isWide = useMediaQuery(WIDE_QUERY);
  const [view, setView] = useState<View>("summary");
  // The switch between the two views. In the side panel it sits in the
  // heading row, where the Insights button beside it names the panel, so
  // the row holds the switch and not the title a second time. In the sheet
  // it heads the content, under the sheet's own title.
  const viewSwitch = (
    <Segmented<View>
      options={VIEWS}
      value={view}
      onChange={setView}
      label="Insights view"
      className="shrink-0 self-start"
    />
  );
  const content = (
    <InsightsContent
      view={view}
      stats={stats}
      inViewContacts={inViewContacts}
      onApplyFacet={onApplyFacet}
      onSelectContact={onSelectContact}
    />
  );

  return (
    <>
      <SidePanel
        id="map-insights"
        title={INSIGHTS_TITLE}
        icon={BarChart3}
        label="Insights"
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

interface InsightsContentProps {
  view: View;
  stats: MapStats;
  inViewContacts: MapContact[];
  onApplyFacet: (facetQuery: string) => void;
  onSelectContact: (contact: MapContact) => void;
}

const InsightsContent = ({
  view,
  stats,
  inViewContacts,
  onApplyFacet,
  onSelectContact,
}: InsightsContentProps) => {
  return (
    <div className="flex flex-1 min-h-0 flex-col gap-4">
      {stats.inView === 0 ? (
        <EmptyState
          icon={Users}
          level={3}
          title="No one in view"
          body="Zoom out or clear the filters to see who is here."
        />
      ) : view === "summary" ? (
        <Summary stats={stats} onApplyFacet={onApplyFacet} />
      ) : (
        <People contacts={inViewContacts} onSelect={onSelectContact} />
      )}
    </div>
  );
};

/** A group's facet as a query token, quoted when it has a space. */
const facet = (field: string, value: string) => {
  const clean = value.trim();
  return `${field}:${clean.includes(" ") ? `"${clean}"` : clean}`;
};

const Summary = ({
  stats,
  onApplyFacet,
}: {
  stats: MapStats;
  onApplyFacet: (facetQuery: string) => void;
}) => (
  <div className={cn(SCROLLER, "space-y-5")}>
    <Bars
      title="Top industries"
      icon={Briefcase}
      field="industry"
      items={stats.topIndustries}
      onApplyFacet={onApplyFacet}
    />
    <Bars
      title="Top companies"
      icon={Building}
      field="company"
      items={stats.topCompanies}
      onApplyFacet={onApplyFacet}
    />
    <Bars
      title="Top tags"
      icon={Tag}
      field="tag"
      items={stats.topTags}
      onApplyFacet={onApplyFacet}
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

/** One group: a bar per value, each a filter to press. */
const Bars = ({
  title,
  icon: Icon,
  field,
  items,
  onApplyFacet,
}: {
  title: string;
  icon: LucideIcon;
  field: string;
  items: TopBucket[];
  onApplyFacet: (facetQuery: string) => void;
}) => {
  if (items.length === 0) return null;
  const most = Math.max(...items.map((item) => item.count), 1);
  return (
    <section>
      <h3 className={GROUP_HEADING}>
        <Icon className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
        {title}
      </h3>
      <ul>
        {items.map((item) => (
          <li key={item.name}>
            <button
              type="button"
              onClick={() => onApplyFacet(facet(field, item.name))}
              aria-label={`Filter by ${field}: ${item.name} (${item.count})`}
              className="hit-area state-layer w-full rounded-lg px-2 py-1.5 text-left cursor-pointer"
            >
              <span className="flex items-center justify-between gap-2 text-xs font-medium mb-1">
                <span className="text-on-surface truncate">{item.name}</span>
                <span className="text-on-surface-variant font-bold tabular-nums shrink-0">
                  {item.count}
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
        ))}
      </ul>
    </section>
  );
};

const ROW_HEIGHT = 56;

/** The people in view, virtualised: a network can put thousands in view. */
const People = ({
  contacts,
  onSelect,
}: {
  contacts: MapContact[];
  onSelect: (contact: MapContact) => void;
}) => {
  const scroller = useRef<HTMLDivElement>(null);
  const rows = useVirtualizer({
    count: contacts.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5,
  });

  return (
    <div ref={scroller} className={SCROLLER}>
      <ul className="relative" style={{ height: rows.getTotalSize() }}>
        {rows.getVirtualItems().map((row) => {
          const contact = contacts[row.index];
          if (!contact) return null;
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
                aria-label={
                  contact.company
                    ? `${contact.name}, ${contact.company}`
                    : contact.name
                }
                className="state-layer w-full h-full flex items-center gap-2.5 px-2 rounded-lg text-left cursor-pointer"
              >
                <ScoreRingAvatar contact={contact} size={36} decorative />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-on-surface truncate">
                    {contact.name}
                  </span>
                  <span className="block text-xs text-on-surface-variant truncate">
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
