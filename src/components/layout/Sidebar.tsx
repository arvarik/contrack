/**
 * The vertical icon rail. Each icon has a `RailTooltip` and, because the
 * tooltip is hover-only, an `aria-label` with the same name from
 * `lib/names`.
 */
import { Link, useLocation } from "react-router-dom";
import {
  Users,
  Map,
  Settings as SettingsIcon,
  Sparkles,
  Activity,
  Keyboard,
  Command,
} from "lucide-react";
import { useCallback } from "react";
import { navLink, SECTION_BG } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { useUrgentActionItemCount } from "../../api";
import { useRecent } from "../../contexts/SessionContext";
import { openCommandPalette, openKeyboardShortcuts } from "../../lib/appEvents";
import { chordLabel, MOD_KEY } from "../../lib/platform";
import { SidebarIdentity } from "../auth/AccountIdentity";
import { CorvidMark } from "../brand/CorvidMark";
import { perchProps } from "../brand/CorvidFlight";
import { useCorvidControls } from "../../hooks/useCorvidLife";
import { useCorvidLevel } from "../../hooks/useCorvidLevel";
import { flyCorvid } from "../../lib/corvid";
import { NAMES } from "../../lib/names";
import { warmSettingsShell } from "../../views/settings/warm";
import { usePageLinkWarm } from "../../views/pages";
import { markPendingNavOnClick, usePendingNav } from "../../lib/pendingNav";
import { RailTooltip } from "../ui/RailTooltip";
import { NAV_SHORTCUTS } from "../../hooks/useGlobalNavShortcuts";

/**
 * The corvid's perch, the one button that navigates nowhere. The bird lives
 * here (`useCorvidLife`). Hover or focus readies it, and a press calls
 * `flyCorvid()`, which flies, flutters or does nothing by the motion level.
 */
const CorvidPerch = () => {
  const level = useCorvidLevel();
  const bird = useCorvidControls();

  // Enter and Space reach this through the button's own click.
  const onClick = useCallback(() => {
    if (level === "off") return;
    flyCorvid({ kind: "loop" });
  }, [level]);

  return (
    <button
      type="button"
      onClick={onClick}
      onPointerEnter={() => bird.hover(true)}
      onPointerLeave={() => bird.hover(false)}
      onFocus={() => bird.hover(true)}
      onBlur={() => bird.hover(false)}
      /*
        No hover layer: with the bird away, a gray box round the empty ring
        reads as loading. The mark is 40 px against the glyphs' 24, so the
        padding is `p-2`, not `p-3`, and the button stays 56 px.
      */
      className="mb-1 p-2 rounded-xl text-primary"
      aria-label="Contrack"
      title="Let the corvid fly"
    >
      {/*
        The perch attribute is on this wrapper, not the svg: the overlay hides
        only the bird while it is out, so the sidebar never shifts.
      */}
      <span {...perchProps} className="flex">
        <CorvidMark size={40} idPrefix="corvid" alive primary controls={bird} />
      </span>
    </button>
  );
};

export const Sidebar = () => {
  const location = useLocation();
  // A narrow context, so a keystroke in Ask's search does not redraw this.
  const { lastContactId } = useRecent();
  // The page a person pressed is marked at once, before it can draw: the
  // location changes only when the new page is on screen (`pendingNav`).
  const path = usePendingNav() ?? location.pathname;
  const isMap = path.startsWith("/map");
  const isCleanup = path.startsWith("/settings");
  const isSearch = path.startsWith("/search");
  const isPulse = path.startsWith("/pulse");
  const isHome =
    !isMap &&
    !isCleanup &&
    !isSearch &&
    !isPulse &&
    (path === "/" || path.startsWith("/contact/"));

  // Pointing at, focusing or pressing a link starts its page's code, and
  // Pulse's data, so they are here when the click lands (`views/pages`).
  const warmPulse = usePageLinkWarm("/pulse");
  const warmMap = usePageLinkWarm("/map");
  const warmAsk = usePageLinkWarm("/search");

  const { data: badge } = useUrgentActionItemCount();
  const urgentCount = badge?.count || 0;

  /**
   * The dot is `aria-hidden`, so the link's name says it too. A comma reads
   * as a short pause.
   */
  const urgent =
    urgentCount > 0 &&
    `${urgentCount} urgent follow-up${urgentCount === 1 ? "" : "s"}`;
  const pulseLabel = urgent
    ? `${NAMES.pulse.label}, ${urgent}`
    : NAMES.pulse.label;
  const pulseTooltip = urgent
    ? `${NAMES.pulse.label} · ${urgent}`
    : NAMES.pulse.label;

  const networkTo =
    lastContactId && !isHome ? `/contact/${lastContactId}` : "/";

  return (
    <aside
      className={cn(
        SECTION_BG,
        // A scroll of its own only on a short touch screen (a phone on its
        // side): a scroll box clips the labels that stand out to its right.
        // A short window packs the rail tight, so Settings stays on screen.
        "w-16 h-full min-h-0 [@media(max-height:40rem)_and_(pointer:coarse)]:overflow-y-auto [@media(max-height:30rem)]:gap-1 [@media(max-height:30rem)]:pt-2 [@media(max-height:30rem)]:pb-1 scrollbar-hide hidden md:flex flex-col items-center pt-6 pb-3 gap-6 shrink-0 relative z-20",
      )}
    >
      {/*
        The corvid, a real button named "Contrack" (the drawing is
        `aria-hidden`). It adds one Tab stop, counted in `keyboard.spec.ts`.
        Its title says what it does. It is the one mark the flight overlay
        measures, hides and gives back.
      */}
      <CorvidPerch />

      <RailTooltip
        label={NAMES.network.label}
        shortcut={NAV_SHORTCUTS["/"].keys}
      >
        <Link
          to={networkTo}
          onClick={markPendingNavOnClick(networkTo)}
          className={navLink(isHome)}
          aria-label={NAMES.network.label}
        >
          <Users className="w-6 h-6" />
        </Link>
      </RailTooltip>

      <div className="relative">
        <RailTooltip
          label={pulseTooltip}
          shortcut={NAV_SHORTCUTS["/pulse"].keys}
        >
          <Link
            to="/pulse"
            {...warmPulse}
            onClick={markPendingNavOnClick("/pulse")}
            className={navLink(isPulse, "relative")}
            aria-label={pulseLabel}
          >
            <Activity className="w-6 h-6" />

            {/*
              Urgent follow-ups get a dot, not a count: any number above zero
              needs attention today. Duplicates show their count where they
              are decided: Pulse's inbox, Settings and the palette.
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
        </RailTooltip>
      </div>

      <RailTooltip
        label={NAMES.map.label}
        shortcut={NAV_SHORTCUTS["/map"].keys}
      >
        <Link
          to="/map"
          {...warmMap}
          onClick={markPendingNavOnClick("/map")}
          className={navLink(isMap)}
          aria-label={NAMES.map.label}
        >
          <Map className="w-6 h-6" />
        </Link>
      </RailTooltip>

      <RailTooltip
        label={NAMES.ask.label}
        shortcut={NAV_SHORTCUTS["/search"].keys}
      >
        <Link
          to="/search"
          {...warmAsk}
          onClick={markPendingNavOnClick("/search")}
          className={navLink(isSearch)}
          aria-label={NAMES.ask.label}
        >
          <Sparkles className="w-6 h-6" />
        </Link>
      </RailTooltip>

      {/* spacer to push the utility group to the bottom */}
      <div className="flex-1" />

      {/*
        The utility group at the rail's foot: the palette, the keyboard
        shortcuts, Settings and who is signed in. Its place and tighter
        spacing set it apart, not a box.
      */}
      <div className="flex flex-col items-center gap-2 w-full">
        {/* Not on a device with no mouse or trackpad, such as a tablet on its
            own: there is no keyboard to use the shortcuts with. */}
        <div className="[@media(not_(any-pointer:fine))]:hidden flex flex-col items-center gap-2">
          {/* The palette for a mouse. A touch screen has it in each page's
              header (`PaletteButton`). */}
          <RailTooltip
            label="Command palette"
            shortcut={chordLabel([MOD_KEY, "K"])}
          >
            <button
              type="button"
              onClick={openCommandPalette}
              className={navLink(false)}
              aria-label="Command palette"
            >
              <Command className="w-6 h-6" />
            </button>
          </RailTooltip>
          <RailTooltip label="Keyboard shortcuts" shortcut="?">
            <button
              type="button"
              onClick={openKeyboardShortcuts}
              className={navLink(false)}
              aria-label="Keyboard shortcuts"
            >
              <Keyboard className="w-6 h-6" />
            </button>
          </RailTooltip>
        </div>

        <RailTooltip
          label={NAMES.settings.label}
          shortcut={NAV_SHORTCUTS["/settings"].keys}
        >
          <Link
            to="/settings"
            // Pointing at the link starts Settings' code (`warm.ts`), so it
            // is here when the click lands.
            onPointerEnter={warmSettingsShell}
            onFocus={warmSettingsShell}
            onClick={markPendingNavOnClick("/settings")}
            className={navLink(isCleanup)}
            aria-label={NAMES.settings.label}
          >
            <SettingsIcon className="w-6 h-6" />
          </Link>
        </RailTooltip>

        {/* Who is signed in, last. Nothing on an un-gated instance. */}
        <SidebarIdentity />
      </div>
    </aside>
  );
};
