/**
 * MapInsightsPane — Right sidebar (desktop) and bottom sheet (mobile) for MapView.
 *
 * Provides:
 * - Tab "Stats": Top industries, companies, tags as clickable progress bars, plus time zone spread.
 * - Tab "People": Virtualised list of in-view contacts using `@tanstack/react-virtual`; click flies to pin.
 * - Carries `data-covers-map="right"` on desktop (320px from lg) so MapLibre padding adjusts.
 * - Controlled by the `mapPaneOpen` preference and toggleable via "i" keyboard shortcut.
 *
 * @module views/map/MapInsightsPane
 */
import React, { useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  X,
  BarChart3,
  Users,
  Clock,
  Building,
  Tag,
  Briefcase,
} from "lucide-react";
import type { MapContact } from "../../../shared/geo";
import type { MapStats, TopBucket, TimeZoneBucket } from "./mapStats";
import { ScoreRingAvatar } from "../../components/ScoreRingAvatar";
import { Modal } from "../../components/ui/Modal";
import { useMediaQuery, WIDE_QUERY } from "../../hooks/useMediaQuery";
import { cn } from "../../lib/utils";
import { SECTION_HEADING, TONE_WASH } from "../../lib/styles";
import { describeScore, scoreView } from "../../../shared/scoreBand";

/** The small caps heading over each group of bars. */
const GROUP_HEADING = cn(SECTION_HEADING, "flex items-center gap-1.5");

export interface MapInsightsPaneProps {
  isOpen: boolean;
  onToggle: (open: boolean) => void;
  stats: MapStats;
  inViewContacts: MapContact[];
  onApplyFacet: (facetQuery: string) => void;
  onSelectContact: (contact: MapContact) => void;
}

type TabType = "stats" | "people";

export const MapInsightsPane: React.FC<MapInsightsPaneProps> = ({
  isOpen,
  onToggle,
  stats,
  inViewContacts,
  onApplyFacet,
  onSelectContact,
}) => {
  const isWide = useMediaQuery(WIDE_QUERY);
  const [activeTab, setActiveTab] = useState<TabType>("stats");
  const virtualListRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: inViewContacts.length,
    getScrollElement: () => virtualListRef.current,
    estimateSize: () => 64,
    overscan: 5,
  });

  const handleApplyFilter = (field: string, value: string) => {
    // If value contains spaces, quote it unless already quoted
    const cleanValue = value.trim();
    const formatted = cleanValue.includes(" ") ? `"${cleanValue}"` : cleanValue;
    onApplyFacet(`${field}:${formatted}`);
  };

  const renderBarSection = (
    title: string,
    icon: React.ReactNode,
    field: string,
    items: TopBucket[],
  ) => {
    if (items.length === 0) return null;
    const maxCount = Math.max(...items.map((i) => i.count), 1);

    return (
      <div className="space-y-2">
        <div className={GROUP_HEADING}>
          {icon}
          <span>{title}</span>
        </div>
        <div className="space-y-1.5">
          {items.map((item) => {
            const pct = Math.round((item.count / maxCount) * 100);
            return (
              <button
                key={item.name}
                type="button"
                onClick={() => handleApplyFilter(field, item.name)}
                aria-label={`Filter by ${field}: ${item.name} (${item.count})`}
                className="hit-area state-layer w-full text-left p-1.5 rounded-lg cursor-pointer"
              >
                <div className="flex items-center justify-between text-xs font-medium mb-1">
                  <span className="text-on-surface truncate pr-2">
                    {item.name}
                  </span>
                  <span className="text-on-surface-variant font-bold tabular-nums shrink-0">
                    {item.count}
                  </span>
                </div>
                <div
                  className="h-1.5 rounded-full bg-surface-container-highest overflow-hidden"
                  role="progressbar"
                  aria-valuenow={item.count}
                  aria-valuemin={0}
                  aria-valuemax={maxCount}
                  aria-label={`${item.name}: ${item.count}`}
                >
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-(--dur-slow)"
                    style={{ width: `${Math.max(4, pct)}%` }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderStatsTab = () => (
    <div className="p-4 space-y-6 overflow-y-auto flex-1 min-h-0">
      {/* Overview Cards */}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2.5 rounded-xl bg-surface-container/60 border border-outline-variant/30 flex flex-col">
          <span className="text-[11px] font-medium text-on-surface-variant">
            In view
          </span>
          <span className="text-lg font-extrabold text-on-surface tabular-nums">
            {stats.inView}
          </span>
        </div>
        <div className="p-2.5 rounded-xl bg-surface-container/60 border border-outline-variant/30 flex flex-col">
          <span className="text-[11px] font-medium text-on-surface-variant">
            Avg score
          </span>
          <span className="text-lg font-extrabold text-on-surface tabular-nums">
            {stats.avgScore !== null ? stats.avgScore : "—"}
          </span>
        </div>
        <div className="p-2.5 rounded-xl bg-surface-container/60 border border-outline-variant/30 flex flex-col">
          <span className="text-[11px] font-medium text-on-surface-variant">
            At risk
          </span>
          <span className="text-lg font-extrabold text-error tabular-nums">
            {stats.atRisk}
          </span>
        </div>
        <div className="p-2.5 rounded-xl bg-surface-container/60 border border-outline-variant/30 flex flex-col">
          <span className="text-[11px] font-medium text-on-surface-variant">
            Overdue
          </span>
          <span className="text-lg font-extrabold text-warning tabular-nums">
            {stats.overdue}
          </span>
        </div>
      </div>

      {/* Top industries */}
      {renderBarSection(
        "Top industries",
        <Briefcase className="w-3.5 h-3.5 text-primary" />,
        "industry",
        stats.topIndustries,
      )}

      {/* Top companies */}
      {renderBarSection(
        "Top companies",
        <Building className="w-3.5 h-3.5 text-primary" />,
        "company",
        stats.topCompanies,
      )}

      {/* Top tags */}
      {renderBarSection(
        "Top tags",
        <Tag className="w-3.5 h-3.5 text-primary" />,
        "tag",
        stats.topTags,
      )}

      {/* Time zone spread */}
      {stats.timeZones.length > 0 && (
        <div className="space-y-2">
          <div className={GROUP_HEADING}>
            <Clock className="w-3.5 h-3.5 text-primary" />
            <span>Time zones</span>
          </div>
          <div className="space-y-1.5">
            {stats.timeZones.map((tz: TimeZoneBucket) => (
              <div
                key={tz.label}
                className="flex items-center justify-between p-2 rounded-xl bg-surface-container/40 border border-outline-variant/20 text-xs"
              >
                <span className="font-medium text-on-surface">{tz.label}</span>
                <span className="font-bold tabular-nums text-on-surface-variant">
                  {tz.count} {tz.count === 1 ? "person" : "people"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {stats.inView === 0 && (
        <div className="text-center py-8 text-xs text-on-surface-variant">
          No contacts in view. Zoom out or clear filters to see insights.
        </div>
      )}
    </div>
  );

  const renderPeopleTab = () => (
    <div className="flex-1 flex flex-col min-h-0 p-2">
      {inViewContacts.length === 0 ? (
        <div className="text-center py-12 text-xs text-on-surface-variant">
          No contacts in view.
        </div>
      ) : (
        <div ref={virtualListRef} className="flex-1 overflow-y-auto min-h-0">
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const contact = inViewContacts[virtualRow.index];
              if (!contact) return null;
              // The chip used to print the stored column, so a contact
              // nobody had met showed "50". It reads the same view as the
              // ring now, and shows nothing for a contact with no score.
              const view = scoreView(contact);

              return (
                <div
                  key={contact.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className="p-1"
                >
                  <button
                    type="button"
                    onClick={() => onSelectContact(contact)}
                    aria-label={`${contact.name}${contact.company ? `, ${contact.company}` : ""}`}
                    className="state-layer w-full h-full flex items-center gap-2.5 p-2 rounded-xl text-left cursor-pointer"
                  >
                    <ScoreRingAvatar contact={contact} size={36} decorative />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-on-surface truncate">
                        {contact.name}
                      </div>
                      <div className="text-[11px] text-on-surface-variant truncate">
                        {contact.company ||
                          contact.role ||
                          contact.location ||
                          "No details"}
                      </div>
                    </div>
                    {view.kind === "scored" && (
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded-md text-[11px] font-bold tabular-nums shrink-0",
                          TONE_WASH[view.band.token],
                        )}
                        title={describeScore(view.score)}
                      >
                        {view.score}
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  const renderTabsHeader = () => (
    <div
      role="tablist"
      aria-label="Insights view options"
      className="flex border-b border-outline-variant/30 px-3 pt-2 shrink-0 bg-surface/50"
    >
      <button
        type="button"
        role="tab"
        id="tab-stats"
        aria-selected={activeTab === "stats"}
        aria-controls="panel-stats"
        onClick={() => setActiveTab("stats")}
        className={cn(
          "flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 cursor-pointer transition-colors -mb-[1px]",
          activeTab === "stats"
            ? "border-primary text-primary"
            : "border-transparent text-on-surface-variant hover:text-on-surface",
        )}
      >
        <BarChart3 className="w-3.5 h-3.5" />
        <span>Stats</span>
      </button>
      <button
        type="button"
        role="tab"
        id="tab-people"
        aria-selected={activeTab === "people"}
        aria-controls="panel-people"
        onClick={() => setActiveTab("people")}
        className={cn(
          "flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 cursor-pointer transition-colors -mb-[1px]",
          activeTab === "people"
            ? "border-primary text-primary"
            : "border-transparent text-on-surface-variant hover:text-on-surface",
        )}
      >
        <Users className="w-3.5 h-3.5" />
        <span>People ({inViewContacts.length})</span>
      </button>
    </div>
  );

  const paneContent = (
    <>
      {renderTabsHeader()}
      <div
        id={`panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`tab-${activeTab}`}
        className="flex-1 flex flex-col min-h-0 overflow-hidden"
      >
        {activeTab === "stats" ? renderStatsTab() : renderPeopleTab()}
      </div>
    </>
  );

  if (!isOpen) return null;

  if (isWide) {
    return (
      <aside
        aria-label="Map insights"
        data-covers-map="right"
        className="flex flex-col absolute right-0 top-0 bottom-0 w-80 z-20 glass-panel shadow-2xl border-l border-outline-variant/30 bg-surface/95 backdrop-blur-md overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/30 shrink-0">
          <h2 className="text-sm font-bold text-on-surface flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            <span>Map insights</span>
          </h2>
          <button
            type="button"
            onClick={() => onToggle(false)}
            aria-label="Close insights"
            className="hit-area state-layer p-1 rounded-lg text-on-surface-variant hover:text-on-surface cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {paneContent}
      </aside>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => onToggle(false)}
      title="Map insights"
      size="md"
    >
      <div className="flex flex-col h-[70vh] max-h-[500px] overflow-hidden">
        {paneContent}
      </div>
    </Modal>
  );
};
