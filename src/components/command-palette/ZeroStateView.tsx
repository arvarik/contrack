/**
 * ZeroStateView — Intelligent zero-state for the Cmd+K command palette.
 *
 * Rendered when the search input is empty and mode is 'normal'. Shows:
 *   1. Recently viewed contacts (from useRecentContacts hook)
 *   2. Search history (from useSearchHistory hook)
 *   3. CRM intelligence insights (from useZeroState API hook)
 *   4. Navigation shortcuts (static list)
 *
 * All items are Command.Item elements — fully keyboard-navigable with ↑/↓/Enter.
 */
import React from "react";
import { Command } from "cmdk";
import {
  Clock,
  Search,
  Sparkles,
  Zap,
  ClipboardList,
  Radar,
  Ghost,
  LayoutDashboard,
  Activity,
  Map,
  Settings,
  ArrowRight,
  Satellite,
  RefreshCw,
  FileText,
  type LucideIcon,
} from "lucide-react";
import {
  GROUP_HEADING_DEFAULT,
  GROUP_HEADING_PRIMARY,
  ITEM_CURRENT,
  stripModePrefix,
} from "./utils";
import { fallbackAvatarUrl } from "../../lib/avatar";
import { KBD_SM, TONE_WASH, type Tone } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { NAV_SHORTCUTS } from "../../hooks/useGlobalNavShortcuts";
import { NAMES } from "../../lib/names";
import { SETTINGS_PAGES } from "../../views/settings/registry";
import { useAuth } from "../auth/AuthGate";
import type { SearchHistoryEntry } from "../../hooks/useSearchHistory";
import type { ZeroStateInsight } from "../../types";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ZeroStateViewProps {
  recentContacts: { id: string; name: string; avatarUrl: string | null }[];
  historyEntries: SearchHistoryEntry[];
  insights: ZeroStateInsight[];
  onSelectContact: (id: string) => void;
  onSelectHistory: (query: string, mode?: string) => void;
  onSelectInsight: (insight: ZeroStateInsight) => void;
  onNavigate: (path: string) => void;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

const modeIcon = (mode: string) => {
  switch (mode) {
    case "ai":
    case "people":
      return <Sparkles className="w-3 h-3 text-primary" />;
    case "action":
      return <Zap className="w-3 h-3 text-success" />;
    case "notes":
      return <FileText className="w-3 h-3 text-primary" />;
    default:
      return <Search className="w-3 h-3 text-on-surface-variant" />;
  }
};

/**
 * An insight's glyph and tone. The tones come from the one map
 * (`.agent/STYLE.md`, "Tones") and match Pulse's rows: follow-ups due are an
 * action to take, a catch-up is past due, a possible duplicate is the
 * warning, and a ghost or stale data is neutral. The server finds these by
 * rule, not with a model, so none of them wears the AI colour.
 *
 * The tone sits on the glyph's tile and the row stays plain. The rows used to
 * rest on five raw washes, and a primary one would look like the current row.
 */
const insightLook = (type: string): { icon: LucideIcon; tone: Tone } => {
  switch (type) {
    case "action_items":
      return { icon: ClipboardList, tone: "primary" };
    case "catch_up":
      return { icon: Radar, tone: "error" };
    case "ghost":
      return { icon: Ghost, tone: "neutral" };
    case "stale_data":
      return { icon: Satellite, tone: "neutral" };
    case "dedupe":
      return { icon: RefreshCw, tone: "warning" };
    default:
      return { icon: Activity, tone: "neutral" };
  }
};

/** A row in the palette's vertical lists. */
const ROW =
  "flex items-center gap-3 px-3 min-h-[44px] sm:min-h-0 rounded-xl cursor-default select-none transition-colors";

/** A destination row: the variant ink, and the wash's ink when current. */
const NAV_ROW =
  "py-2 text-on-surface-variant aria-selected:text-on-primary-wash";

/**
 * The "Go to" group. Labels come from `lib/names` so a destination reads the
 * same here as in the sidebar and on the page. Exported for the unit test that
 * holds those surfaces to one name.
 */
export const NAV_ITEMS = [
  {
    label: NAMES.network.label,
    icon: LayoutDashboard,
    path: "/",
    shortcut: NAV_SHORTCUTS["/"]?.keys,
  },
  {
    label: NAMES.pulse.label,
    icon: Activity,
    path: "/pulse",
    shortcut: NAV_SHORTCUTS["/pulse"]?.keys,
  },
  {
    label: NAMES.map.label,
    icon: Map,
    path: "/map",
    shortcut: NAV_SHORTCUTS["/map"]?.keys,
  },
  {
    label: NAMES.ask.label,
    icon: Sparkles,
    path: "/search",
    shortcut: NAV_SHORTCUTS["/search"]?.keys,
  },
  {
    label: NAMES.settings.label,
    icon: Settings,
    path: "/settings",
    shortcut: NAV_SHORTCUTS["/settings"]?.keys,
  },
] as const;

// ─── Main Component ──────────────────────────────────────────────────────────

export const ZeroStateView = ({
  recentContacts,
  historyEntries,
  insights,
  onSelectContact,
  onSelectHistory,
  onSelectInsight,
  onNavigate,
}: ZeroStateViewProps) => {
  const { isAdmin, authRequired } = useAuth();
  const hasRecent = recentContacts.length > 0;
  const hasHistory = historyEntries.length > 0;
  const hasInsights = insights.length > 0;

  const settingsNavItems = SETTINGS_PAGES.filter((page) => {
    if (page.admin && !isAdmin) return false;
    if (page.needsAccount && !authRequired) return false;
    if (page.id === "ai-usage" && isAdmin) return false;
    return true;
  });

  return (
    <>
      {/* ── Recently Viewed ── */}
      {hasRecent && (
        <Command.Group
          heading="Recently viewed"
          className={GROUP_HEADING_DEFAULT}
        >
          <div className="flex gap-2 px-3 py-1">
            {recentContacts.map((c) => (
              <Command.Item
                key={`recent_${c.id}`}
                value={`recent_${c.id}_${c.name}`}
                onSelect={() => onSelectContact(c.id)}
                // A chip in a row, not a row in a list, so the current one
                // takes the selected tint (`SELECTED_TINT`) without the bar.
                className="flex items-center gap-2 px-3 py-2 min-h-[44px] sm:min-h-0 rounded-xl cursor-default select-none aria-selected:bg-primary/10 aria-selected:text-on-primary-wash transition-colors text-on-surface shrink-0"
              >
                <img
                  src={c.avatarUrl || fallbackAvatarUrl(c.name)}
                  alt=""
                  className="w-6 h-6 rounded-full bg-surface-container-highest object-cover"
                />
                <span className="text-xs font-bold truncate max-w-[100px]">
                  {c.name}
                </span>
              </Command.Item>
            ))}
          </div>
        </Command.Group>
      )}

      {/* ── Search History ── */}
      {hasHistory && (
        <Command.Group
          heading="Recent searches"
          className={GROUP_HEADING_DEFAULT}
        >
          {historyEntries.map((entry, i) => (
            <Command.Item
              key={`history_${i}_${entry.timestamp}`}
              value={`history_${entry.query}`}
              onSelect={() => onSelectHistory(entry.query, entry.mode)}
              className={cn(ROW, "py-2 text-on-surface", ITEM_CURRENT)}
            >
              <div className="w-6 h-6 flex items-center justify-center rounded-full bg-surface-container-high shrink-0">
                {modeIcon(entry.mode)}
              </div>
              <span className="text-sm truncate flex-1">
                {stripModePrefix(entry.query)}
              </span>
              <Clock className="w-3 h-3 text-on-surface-variant shrink-0" />
            </Command.Item>
          ))}
        </Command.Group>
      )}

      {/* ── CRM Insights ── */}
      {hasInsights && (
        <Command.Group heading="Insights" className={GROUP_HEADING_PRIMARY}>
          {insights.map((insight, i) => {
            const { icon: Icon, tone } = insightLook(insight.type);
            return (
              <Command.Item
                key={`insight_${insight.type}_${i}`}
                value={`insight_${insight.label}`}
                onSelect={() => onSelectInsight(insight)}
                className={cn(ROW, "py-2.5 text-on-surface", ITEM_CURRENT)}
              >
                <div
                  className={cn(
                    "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
                    TONE_WASH[tone],
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <span className="text-sm flex-1 truncate">{insight.label}</span>
                <ArrowRight className="w-3 h-3 text-on-surface-variant/30 shrink-0" />
              </Command.Item>
            );
          })}
        </Command.Group>
      )}

      {/* ── Navigation ── */}
      <Command.Group heading="Go to" className={GROUP_HEADING_DEFAULT}>
        {NAV_ITEMS.map((item) => (
          <Command.Item
            key={`nav_${item.path}`}
            value={`nav_${item.label}`}
            onSelect={() => onNavigate(item.path)}
            className={cn(ROW, NAV_ROW, ITEM_CURRENT)}
          >
            <item.icon className="w-4 h-4 shrink-0" />
            <span className="text-sm flex-1">{item.label}</span>
            {item.shortcut && (
              <kbd
                className={cn(
                  KBD_SM,
                  "text-on-surface-variant hidden sm:inline-flex",
                )}
              >
                {item.shortcut}
              </kbd>
            )}
          </Command.Item>
        ))}
        {settingsNavItems.map((page) => {
          const Icon = page.icon;
          return (
            <Command.Item
              key={`nav_${page.path}`}
              value={`Settings: ${page.title}`}
              keywords={page.keywords}
              onSelect={() => onNavigate(page.path)}
              className={cn(ROW, NAV_ROW, ITEM_CURRENT)}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="text-sm flex-1">Settings: {page.title}</span>
            </Command.Item>
          );
        })}
      </Command.Group>
    </>
  );
};
