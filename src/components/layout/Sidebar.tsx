/**
 * Sidebar — Vertical icon nav with styled tooltips.
 *
 * Each nav item wraps with a custom Tooltip that appears to the right
 * of the icon after a 250ms hover delay — replacing the ugly native
 * browser `title` tooltip with a polished in-app version.
 *
 * That tooltip is a hover-rendered <div>, so it is worth nothing to a screen
 * reader or to a keyboard user tabbing through: every link here is an icon
 * with no text. Each one therefore carries its own `aria-label`, duplicating
 * the tooltip's label. Both read the destination's name from `lib/names`, so
 * the sidebar says what the tab bar, the palette and the page heading say.
 */
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Map,
  Settings as SettingsIcon,
  Sparkles,
  Activity,
  Keyboard,
} from "lucide-react";
import React, { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { navLink, SECTION_BG } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { useUrgentActionItemCount, useDedupeCount } from "../../api";
import { useRecent } from "../../contexts/SessionContext";
import { openKeyboardShortcuts } from "../../lib/appEvents";
import { SidebarIdentity } from "../auth/AccountIdentity";
import { CorvidMark } from "../brand/CorvidMark";
import { perchProps } from "../brand/CorvidFlight";
import { HOP_CLASS, HOP_MS, playCorvidBeat } from "../../hooks/useCorvidIdle";
import { flyCorvid, motionLevel } from "../../lib/corvid";
import { usePreferences } from "../../contexts/PreferencesContext";
import { useReducedMotion } from "motion/react";
import { NAMES } from "../../lib/names";

// ---------------------------------------------------------------------------
// SidebarTooltip — styled right-side tooltip with delay
// ---------------------------------------------------------------------------

const SidebarTooltip = ({
  label,
  shortcut,
  children,
  className,
}: {
  label: string;
  shortcut?: string;
  children: React.ReactNode;
  className?: string;
}) => {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), 250);
  }, []);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  return (
    <div
      className={cn("relative flex items-center", className)}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0, x: -6, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -4, scale: 0.95 }}
            transition={{ duration: 0.12 }}
            className="absolute left-full ml-3 z-50 pointer-events-none"
          >
            <div className="bg-surface-container-highest text-on-surface text-xs font-bold px-2.5 py-1.5 rounded-lg shadow-lg whitespace-nowrap ring-1 ring-black/5">
              {label}
              {shortcut && (
                <span className="block text-[11px] font-mono font-normal text-on-surface-variant mt-0.5">
                  {shortcut}
                </span>
              )}
            </div>
            {/* Caret */}
            <div className="absolute top-1/2 -translate-y-1/2 -left-1 w-0 h-0 border-t-4 border-b-4 border-r-4 border-t-transparent border-b-transparent border-r-surface-container-highest" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ---------------------------------------------------------------------------
// CorvidPerch — the mark, as the one button that navigates nowhere
// ---------------------------------------------------------------------------

/**
 * The corvid's perch.
 *
 * Level "full" hops and then flies, "subtle" hops and stays, "off" does
 * neither, and either reduced-motion input forces "off" whatever the account
 * chose. The hop is played here rather than in the overlay so that "subtle"
 * needs no overlay at all.
 */
const CorvidPerch = () => {
  const { preferences } = usePreferences();
  const prefersReducedMotion = useReducedMotion();
  const markRef = useRef<HTMLSpanElement>(null);

  const level = motionLevel(
    preferences.mascotMotion,
    Boolean(prefersReducedMotion),
    preferences.motion,
  );

  // Enter and Space already reach this through the button's own click, so
  // there is no key handler here to get out of step with the pointer.
  const onClick = useCallback(() => {
    if (level === "off") return;
    if (level === "subtle") {
      playCorvidBeat(markRef.current, HOP_CLASS, HOP_MS);
      return;
    }
    flyCorvid({ kind: "loop" });
  }, [level]);

  return (
    <button
      type="button"
      onClick={onClick}
      /*
        The nav link's padding, so the hit box is 48 px like every other stop,
        and the focus ring every control gets from `index.css`. Not its hover
        wash: while the bird is away this button is empty, and a filled grey
        box where the mark used to be reads as something still loading.
      */
      className={navLink(
        false,
        "mb-1 text-primary hover:text-primary hover:bg-transparent",
      )}
      aria-label="Contrack"
      title="Let the corvid fly"
    >
      {/*
        The perch attribute sits on this wrapper, not on the svg. The overlay
        hides the perch while the bird is out, and hiding a wrapper leaves the
        button's own box alone, so the sidebar does not shift by a pixel.
      */}
      <span ref={markRef} {...perchProps} className="flex">
        <CorvidMark size={32} idPrefix="corvid" idle={level !== "off"} />
      </span>
    </button>
  );
};

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

export const Sidebar = () => {
  const location = useLocation();
  // Narrow context read: this hook is now isolated from AI-search keystroke
  // updates, so the sidebar no longer re-renders when the user types in the
  // global search bar.
  const { lastContactId } = useRecent();
  const isMap = location.pathname.startsWith("/map");
  const isCleanup = location.pathname.startsWith("/settings");
  const isSearch = location.pathname.startsWith("/search");
  const isPulse = location.pathname.startsWith("/pulse");
  const isHome =
    !isMap &&
    !isCleanup &&
    !isSearch &&
    !isPulse &&
    (location.pathname === "/" || location.pathname.startsWith("/contact/"));

  const { data: badge } = useUrgentActionItemCount();
  const urgentCount = badge?.count || 0;

  const { data: dedupeCount } = useDedupeCount();
  const pendingSuggestions = dedupeCount?.count || 0;

  /**
   * The badges are `aria-hidden` graphics, so whatever they convey has to be
   * said in the link's accessible name instead — otherwise a screen-reader
   * user gets "Pulse" and no hint that anything is waiting. The name and the
   * counts join with a comma, which a screen reader reads as a short pause.
   */
  const pulseBadges = [
    urgentCount > 0 &&
      `${urgentCount} urgent follow-up${urgentCount === 1 ? "" : "s"}`,
    pendingSuggestions > 0 &&
      `${pendingSuggestions} possible duplicate${pendingSuggestions === 1 ? "" : "s"}`,
  ].filter(Boolean) as string[];

  const pulseLabel = pulseBadges.length
    ? `${NAMES.pulse.label}, ${pulseBadges.join(", ")}`
    : NAMES.pulse.label;
  const pulseTooltip = pulseBadges.length
    ? `${NAMES.pulse.label} · ${pulseBadges.join(" · ")}`
    : NAMES.pulse.label;

  return (
    <aside
      className={cn(
        SECTION_BG,
        "w-16 h-screen hidden md:flex flex-col items-center pt-6 pb-3 gap-6 shrink-0 relative z-20",
      )}
    >
      {/*
        The corvid, on its perch, and the only control here that goes nowhere.

        It was a decorative span until the bird learned to fly. A click sends
        it round the window and back, so it is a real button with a real name:
        the drawing stays `aria-hidden`, and "Contrack" comes from the button
        instead. That adds one Tab stop in front of the content, which is why
        the budgets in `keyboard.spec.ts` went up by one.

        The title says what the button does rather than what it is. "Contrack"
        is already the accessible name, and a tooltip that repeats it would
        tell a mouse user nothing they cannot see.

        `idPrefix="corvid"` and the perch attribute make this the one mark the
        flight overlay measures, hides and gives back.
      */}
      <CorvidPerch />

      <SidebarTooltip label={NAMES.network.label} shortcut="⌘⇧H">
        <Link
          to={lastContactId && !isHome ? `/contact/${lastContactId}` : "/"}
          className={navLink(isHome)}
          aria-label={NAMES.network.label}
        >
          <LayoutDashboard className="w-6 h-6" />
        </Link>
      </SidebarTooltip>

      <div className="relative">
        <SidebarTooltip label={pulseTooltip} shortcut="⌘⇧P">
          <Link
            to="/pulse"
            className={navLink(isPulse, "relative")}
            aria-label={pulseLabel}
          >
            <Activity className="w-6 h-6" />

            {/*
              Two different signals, so two different treatments.

              Urgent follow-ups are about *time* — something is due — so they
              keep the pinging red dot. A count would invite comparison
              ("only 3") when the point is that any number above zero needs
              attention today.

              Pending duplicates are about *volume*: clearing 3 is a coffee
              break and clearing 180 is an afternoon, and a dot renders those
              identically. So that one carries the number.

              They sit on opposite corners rather than side by side, because a
              numeric pill next to a dot on a 24px icon reads as one smudge.
            */}
            {urgentCount > 0 && (
              <span
                className="absolute top-1.5 right-1.5 flex h-2 w-2"
                aria-hidden="true"
              >
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-error opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-error" />
              </span>
            )}
          </Link>
        </SidebarTooltip>

        {pendingSuggestions > 0 && (
          <Link
            to="/pulse/duplicates"
            className={cn(
              "absolute -top-0.5 -left-0.5 min-w-[18px] h-[18px] px-1 z-10",
              "flex items-center justify-center rounded-full",
              "bg-primary text-on-primary text-[11px] font-bold leading-none",
              "tabular-nums ring-2 ring-surface-container hover:scale-110 transition-transform",
            )}
            aria-label={`${pendingSuggestions} duplicate suggestions`}
          >
            {pendingSuggestions > 99 ? "99+" : pendingSuggestions}
          </Link>
        )}
      </div>

      <SidebarTooltip label={NAMES.map.label} shortcut="⌘⇧M">
        <Link to="/map" className={navLink(isMap)} aria-label={NAMES.map.label}>
          <Map className="w-6 h-6" />
        </Link>
      </SidebarTooltip>

      <SidebarTooltip label={NAMES.ask.label} shortcut="⌘⇧S">
        <Link
          to="/search"
          className={navLink(isSearch)}
          aria-label={NAMES.ask.label}
        >
          <Sparkles className="w-6 h-6" />
        </Link>
      </SidebarTooltip>

      {/* spacer to push the utility group to the bottom */}
      <div className="flex-1" />

      {/*
        Utility group. The bottom corner used to hold a lone gear with nothing
        marking it as a different kind of thing from the four destinations
        above it. It is now a labelled group, separated by a background shift
        rather than a rule (the design system's no-line rule), holding the two
        actions that are *about* the app rather than about your contacts.

        Keyboard shortcuts previously had no visible entry point at all — the
        overlay existed but you had to already know to press `?`. Discoverable
        shortcuts are the difference between a keyboard-first app and an app
        with keyboard shortcuts.
      */}
      <div className="flex flex-col items-center gap-2 w-full pt-3 pb-1 bg-surface-container/40 rounded-t-2xl">
        <SidebarTooltip label="Keyboard shortcuts" shortcut="?">
          <button
            type="button"
            onClick={openKeyboardShortcuts}
            className={navLink(false)}
            aria-label="Keyboard shortcuts"
          >
            <Keyboard className="w-6 h-6" />
          </button>
        </SidebarTooltip>

        <SidebarTooltip label={NAMES.settings.label} shortcut="⌘⇧,">
          <Link
            to="/settings"
            className={navLink(isCleanup)}
            aria-label={NAMES.settings.label}
          >
            <SettingsIcon className="w-6 h-6" />
          </Link>
        </SidebarTooltip>

        {/*
          Who is signed in, last, below the app's own controls. It is the one
          item here that is about the person rather than the app, and on an
          un-gated instance it renders nothing at all.
        */}
        <SidebarIdentity />
      </div>
    </aside>
  );
};
