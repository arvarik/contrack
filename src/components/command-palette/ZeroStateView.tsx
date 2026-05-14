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
  AlertTriangle,
  Ghost,
  LayoutDashboard,
  Activity,
  Map,
  Settings,
  ArrowRight,
  Satellite,
  RefreshCw,
} from "lucide-react";
import {
  GROUP_HEADING_DEFAULT,
  GROUP_HEADING_PRIMARY,
  stripModePrefix,
} from "./utils";
import { fallbackAvatarUrl } from "../../lib/avatar";
import { KBD_SM } from "../../lib/styles";
import { NAV_SHORTCUTS } from "../../hooks/useGlobalNavShortcuts";
import type { SearchHistoryEntry } from "../../hooks/useSearchHistory";
import type { ZeroStateInsight } from "../../types";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ZeroStateViewProps {
  recentContacts: { id: string; name: string; avatarUrl: string | null }[];
  historyEntries: SearchHistoryEntry[];
  insights: ZeroStateInsight[];
  onSelectContact: (id: string) => void;
  onSelectHistory: (query: string) => void;
  onSelectInsight: (insight: ZeroStateInsight) => void;
  onNavigate: (path: string) => void;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

const modeIcon = (mode: string) => {
  switch (mode) {
    case "ai":
      return <Sparkles className="w-3 h-3 text-primary" />;
    case "action":
      return <Zap className="w-3 h-3 text-emerald-500" />;
    default:
      return <Search className="w-3 h-3 text-on-surface-variant" />;
  }
};

const insightIcon = (type: string) => {
  switch (type) {
    case "action_items":
      return <ClipboardList className="w-3.5 h-3.5 text-amber-500" />;
    case "at_risk":
      return <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />;
    case "ghost":
      return <Ghost className="w-3.5 h-3.5 text-purple-500" />;
    case "stale_data":
      return <Satellite className="w-3.5 h-3.5 text-sky-500" />;
    case "dedupe":
      return <RefreshCw className="w-3.5 h-3.5 text-teal-500" />;
    default:
      return <Activity className="w-3.5 h-3.5 text-on-surface-variant" />;
  }
};

const insightBg = (type: string) => {
  switch (type) {
    case "action_items":
      return "bg-amber-500/10 aria-selected:bg-amber-500/15";
    case "at_risk":
      return "bg-rose-500/8 aria-selected:bg-rose-500/12";
    case "ghost":
      return "bg-purple-500/8 aria-selected:bg-purple-500/12";
    case "stale_data":
      return "bg-sky-500/8 aria-selected:bg-sky-500/12";
    case "dedupe":
      return "bg-teal-500/8 aria-selected:bg-teal-500/12";
    default:
      return "bg-surface-container-low";
  }
};

const NAV_ITEMS = [
  {
    label: "Network",
    icon: LayoutDashboard,
    path: "/",
    shortcut: NAV_SHORTCUTS["/"]?.keys,
  },
  {
    label: "Relationship Pulse",
    icon: Activity,
    path: "/pulse",
    shortcut: NAV_SHORTCUTS["/pulse"]?.keys,
  },
  {
    label: "Map",
    icon: Map,
    path: "/map",
    shortcut: NAV_SHORTCUTS["/map"]?.keys,
  },
  {
    label: "AI Search",
    icon: Sparkles,
    path: "/search",
    shortcut: NAV_SHORTCUTS["/search"]?.keys,
  },
  {
    label: "Settings",
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
  const hasRecent = recentContacts.length > 0;
  const hasHistory = historyEntries.length > 0;
  const hasInsights = insights.length > 0;

  return (
    <>
      {/* ── Recently Viewed ── */}
      {hasRecent && (
        <Command.Group
          heading="Recently Viewed"
          className={GROUP_HEADING_DEFAULT}
        >
          <div className="flex gap-2 px-3 py-1">
            {recentContacts.map((c) => (
              <Command.Item
                key={`recent_${c.id}`}
                value={`recent_${c.id}_${c.name}`}
                onSelect={() => onSelectContact(c.id)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl cursor-default select-none aria-selected:bg-primary/10 aria-selected:text-primary transition-colors text-on-surface shrink-0"
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
          heading="Recent Searches"
          className={GROUP_HEADING_DEFAULT}
        >
          {historyEntries.map((entry, i) => (
            <Command.Item
              key={`history_${i}_${entry.timestamp}`}
              value={`history_${entry.query}`}
              onSelect={() => onSelectHistory(entry.query)}
              className="flex items-center gap-3 px-3 py-2 rounded-xl cursor-default select-none aria-selected:bg-primary/10 transition-colors text-on-surface"
            >
              <div className="w-6 h-6 flex items-center justify-center rounded-full bg-surface-container-high shrink-0">
                {modeIcon(entry.mode)}
              </div>
              <span className="text-sm truncate flex-1">
                {stripModePrefix(entry.query)}
              </span>
              <Clock className="w-3 h-3 text-on-surface-variant/40 shrink-0" />
            </Command.Item>
          ))}
        </Command.Group>
      )}

      {/* ── CRM Insights ── */}
      {hasInsights && (
        <Command.Group heading="Insights" className={GROUP_HEADING_PRIMARY}>
          {insights.map((insight, i) => (
            <Command.Item
              key={`insight_${insight.type}_${i}`}
              value={`insight_${insight.label}`}
              onSelect={() => onSelectInsight(insight)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-default select-none transition-colors text-on-surface ${insightBg(insight.type)}`}
            >
              <div className="w-7 h-7 flex items-center justify-center shrink-0">
                {insightIcon(insight.type)}
              </div>
              <span className="text-sm flex-1 truncate">{insight.label}</span>
              <ArrowRight className="w-3 h-3 text-on-surface-variant/30 shrink-0" />
            </Command.Item>
          ))}
        </Command.Group>
      )}

      {/* ── Navigation ── */}
      <Command.Group heading="Go To" className={GROUP_HEADING_DEFAULT}>
        {NAV_ITEMS.map((item) => (
          <Command.Item
            key={`nav_${item.path}`}
            value={`nav_${item.label}`}
            onSelect={() => onNavigate(item.path)}
            className="flex items-center gap-3 px-3 py-2 rounded-xl cursor-default select-none aria-selected:bg-primary/10 transition-colors text-on-surface-variant aria-selected:text-primary"
          >
            <item.icon className="w-4 h-4 shrink-0" />
            <span className="text-sm flex-1">{item.label}</span>
            {item.shortcut && (
              <kbd
                className={`${KBD_SM} text-on-surface-variant/40 hidden sm:inline-flex`}
              >
                {item.shortcut}
              </kbd>
            )}
          </Command.Item>
        ))}
      </Command.Group>
    </>
  );
};
