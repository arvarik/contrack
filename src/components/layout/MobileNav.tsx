/**
 * MobileNav: the phone's tab bar, below `md`.
 *
 * Two things it did not do before: reserve room for the iOS home indicator
 * (the last row of pixels sat under it, so the labels were clipped on any
 * notched phone), and give each tab a real 44pt target — the taps landed on
 * a `px-3 py-1.5` box roughly 32pt tall. Both are fixed by `min-h-[3rem]`
 * plus `env(safe-area-inset-bottom)` padding.
 *
 * It marks the page a person pressed at once, before that page can draw
 * (`lib/pendingNav`). It is its own component, as the sidebar is, so the
 * mark re-renders the bar and not the page under it.
 *
 * @module components/layout/MobileNav
 */
import { useContext } from "react";
import { Link, useLocation, useMatch } from "react-router-dom";
import { QueryClientContext } from "@tanstack/react-query";
import {
  Activity,
  LayoutDashboard,
  Map,
  Settings as SettingsIcon,
  Sparkles,
} from "lucide-react";
import { useUrgentActionItemCount } from "../../api";
import { useRecent } from "../../contexts/SessionContext";
import { NAMES } from "../../lib/names";
import { markPendingNavOnClick, usePendingNav } from "../../lib/pendingNav";
import { SELECTED_TINT } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { pageLinkWarm } from "../../views/pages";
import { warmSettingsShell } from "../../views/settings/warm";

export const MobileNav = () => {
  const location = useLocation();
  const { lastContactId } = useRecent();
  const matchContact = useMatch("/contact/:id");
  const matchMapContact = useMatch("/map/contact/:id");
  const isContactSelected = matchContact || matchMapContact;
  const { data: badge } = useUrgentActionItemCount();
  const urgentCount = badge?.count || 0;
  const queryClient = useContext(QueryClientContext);

  const path = usePendingNav() ?? location.pathname;
  const isMap = path.startsWith("/map");
  const isSettings = path.startsWith("/settings");
  const isSearch = path.startsWith("/search");
  const isPulse = path.startsWith("/pulse");
  const isNetwork = !isMap && !isPulse && !isSettings && !isSearch;

  return (
    <nav
      aria-label="Primary"
      // The map reads this to keep its centre above the bar (`insets.ts`).
      data-covers-map="bottom"
      className="md:hidden fixed bottom-0 left-0 w-full z-50 flex justify-around items-stretch px-1 pt-1.5 glass-panel rounded-t-2xl shadow-[0_-4px_16px_rgba(0,0,0,0.05)]"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      {[
        {
          to:
            lastContactId && !isContactSelected
              ? `/contact/${lastContactId}`
              : "/",
          icon: LayoutDashboard,
          label: NAMES.network.label,
          active: isNetwork,
          badge: 0,
        },
        {
          to: "/pulse",
          icon: Activity,
          label: NAMES.pulse.label,
          active: isPulse,
          badge: urgentCount,
        },
        {
          to: "/map",
          icon: Map,
          label: NAMES.map.label,
          active: isMap,
          badge: 0,
        },
        {
          to: "/search",
          icon: Sparkles,
          label: NAMES.ask.label,
          active: isSearch,
          badge: 0,
        },
        {
          to: "/settings",
          icon: SettingsIcon,
          label: NAMES.settings.label,
          active: isSettings,
          badge: 0,
        },
      ].map(({ to, icon: Icon, label, active, badge }) => (
        <Link
          key={label}
          to={to}
          // A touch on a tab starts its page's code, and Pulse's data, a
          // moment before the tap lands (`views/pages.ts`, `warm.ts`).
          {...(to === "/settings"
            ? { onPointerDown: warmSettingsShell }
            : pageLinkWarm(to, queryClient))}
          onClick={markPendingNavOnClick(to)}
          aria-current={active ? "page" : undefined}
          className={cn(
            "relative flex flex-1 flex-col items-center justify-center gap-0.5",
            "min-h-[3rem] px-0.5 py-1 rounded-xl transition-colors",
            // A press on another tab draws the hover layer's press step.
            active ? "text-primary" : "state-layer text-on-surface-variant",
          )}
        >
          {/* Active pill sits behind the icon rather than recolouring the
              whole tab, so the current tab is legible at a glance. It is the
              selected tint, the same as the sidebar's current link. */}
          <span
            className={cn(
              "flex items-center justify-center w-10 h-6 rounded-lg transition-colors",
              active && SELECTED_TINT,
            )}
          >
            <Icon className="w-5 h-5" />
          </span>
          {/* 11 px bold, tight. "Ask Contrack" is about 69 px wide at this
              tracking, and a 390 px phone gives each of the five tabs 72 px
              inside its padding, so the label stays on one line. */}
          <span className="text-[11px] font-bold tracking-tight whitespace-nowrap">
            {label}
          </span>
          {badge > 0 && (
            <span className="absolute top-0.5 right-[22%] flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-error opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-error" />
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
};
