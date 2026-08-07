/**
 * SettingsView — the Settings shell.
 *
 * Owns the page chrome (header, back affordance, document title) and the
 * nested routes. The landing page's own content lives in
 * `views/settings/SettingsHome` — this file is deliberately just the frame,
 * because it previously held both and the routing was buried under 300 lines
 * of card markup.
 *
 * Each subpage declares itself in SUBPAGES, once, and the header, icon, and
 * document title all read from that single entry.
 */
import React from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  Archive,
  Brain,
  ChevronLeft,
  Copy,
  Gauge,
  List,
  Settings as SettingsIcon,
  Sparkles,
  Trash2,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { DedupeView } from "./dedupe";
import { ArchivedContactsView } from "./ArchivedContactsView";
import { TrashView } from "./TrashView";
import { AISettingsView } from "./ai-settings";
import { ListManagerView } from "./lists";
import { AISearchView } from "./ai-search";
import { AIStatsView } from "./ai-stats";
import { SettingsHome } from "./settings/SettingsHome";
import { AccountSettings } from "./settings/AccountSettings";
import { ICON_BTN, PAGE_TITLE } from "../lib/styles";
import { cn } from "../lib/utils";
import { usePageTitle } from "../hooks/usePageTitle";

// ---------------------------------------------------------------------------
// Subpage registry
// ---------------------------------------------------------------------------

interface SubpageMeta {
  /** Trailing path segment under /settings. */
  segment: string;
  title: string;
  icon: LucideIcon;
  /** Icon tint — matches the tone used on the landing page row. */
  tone: string;
}

const SUBPAGES: SubpageMeta[] = [
  {
    segment: "account",
    title: "Account",
    icon: UserRound,
    tone: "text-primary",
  },
  {
    segment: "ai-config",
    title: "AI Configuration",
    icon: Brain,
    tone: "text-primary",
  },
  {
    segment: "ai-search",
    title: "Contact Enrichment",
    icon: Sparkles,
    tone: "text-primary",
  },
  { segment: "ai-stats", title: "AI Usage", icon: Gauge, tone: "text-primary" },
  { segment: "lists", title: "Lists", icon: List, tone: "text-primary" },
  { segment: "dedupe", title: "Duplicates", icon: Copy, tone: "text-primary" },
  {
    segment: "archived",
    title: "Archived Contacts",
    icon: Archive,
    tone: "text-warning",
  },
  { segment: "trash", title: "Trash", icon: Trash2, tone: "text-error" },
];

// ---------------------------------------------------------------------------

export const SettingsView = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const segment = location.pathname.split("/")[2] ?? "";
  const subpage = SUBPAGES.find((page) => page.segment === segment);

  const title = subpage?.title ?? "Settings";
  const Icon = subpage?.icon ?? SettingsIcon;

  // The tab title tracks the subpage, so a settings tab left open is
  // identifiable without switching to it.
  usePageTitle(title);

  // Dedupe and Lists manage their own scrolling panes; everything else
  // scrolls in this container.
  const ownsScrolling = segment === "dedupe" || segment === "lists";

  return (
    <div className="h-full flex flex-col overflow-hidden bg-surface text-on-surface">
      <header className="px-4 sm:px-6 py-4 sm:py-5 bg-surface-container-low shrink-0">
        <div className="flex items-center gap-3 sm:gap-4">
          <button
            onClick={() => navigate(subpage ? "/settings" : "/")}
            className={ICON_BTN}
            aria-label={subpage ? "Back to Settings" : "Back to Network"}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className={cn(PAGE_TITLE, "flex items-center gap-3 min-w-0")}>
            <span className="p-2 bg-primary/10 rounded-xl shrink-0">
              <Icon
                className={cn(
                  "w-5 h-5 sm:w-6 sm:h-6",
                  subpage?.tone ?? "text-primary",
                )}
              />
            </span>
            <span className="truncate">{title}</span>
          </h1>
        </div>
      </header>

      <div
        className={cn(
          "flex-1",
          ownsScrolling ? "overflow-hidden" : "overflow-y-auto",
        )}
      >
        <Routes>
          <Route path="/" element={<SettingsHome />} />

          <Route
            path="/account"
            element={
              <div className="overflow-y-auto h-full">
                <AccountSettings />
              </div>
            }
          />

          <Route
            path="/dedupe"
            element={
              <div className="absolute inset-0 z-50 bg-surface">
                <DedupeView embedded />
              </div>
            }
          />

          <Route
            path="/lists"
            element={
              <div className="h-full overflow-hidden">
                <ListManagerView />
              </div>
            }
          />

          <Route
            path="/archived"
            element={
              <div className="overflow-y-auto h-full">
                <ArchivedContactsView />
              </div>
            }
          />

          <Route
            path="/ai-config"
            element={
              <div className="overflow-y-auto h-full">
                <AISettingsView />
              </div>
            }
          />

          <Route
            path="/trash"
            element={
              <div className="overflow-y-auto h-full">
                <TrashView />
              </div>
            }
          />

          <Route
            path="/ai-search"
            element={
              <div className="overflow-y-auto h-full">
                <AISearchView />
              </div>
            }
          />

          <Route
            path="/ai-stats"
            element={
              <div className="overflow-y-auto h-full">
                <AIStatsView />
              </div>
            }
          />
        </Routes>
      </div>
    </div>
  );
};
