/**
 * SettingsHome — the Settings landing page.
 *
 * Driven directly by the settings registry. Renders the identity row at top,
 * the search box, the registry groups and destination cards, and the storage footer.
 */
import React, { useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, HardDrive, type LucideIcon } from "lucide-react";
import { useAuth } from "../../components/auth/AuthGate";
import { SettingsIdentityRow } from "../../components/auth/AccountIdentity";
import { SettingsSearch } from "./SettingsSearch";
import { NeedsAttention } from "./NeedsAttention";
import { SETTINGS_GROUPS, SETTINGS_PAGES } from "./registry";
import { SETTINGS_PAGE } from "./layout";
import {
  CARD_INTERACTIVE,
  SECTION_HEADING,
  TONE_WASH,
  type Tone,
} from "../../lib/styles";
import { cn } from "../../lib/utils";
import { tileDelay } from "../../lib/motion";
import { CorvidMark } from "../../components/brand/CorvidMark";
import { perchProps } from "../../components/brand/CorvidFlight";
import { HOP_CLASS, HOP_MS, playCorvidBeat } from "../../hooks/useCorvidIdle";
import { useCorvidLevel } from "../../hooks/useCorvidLevel";
import { flyCorvid } from "../../lib/corvid";

const GroupHeading = ({ children }: { children: React.ReactNode }) => (
  <h2 className={cn(SECTION_HEADING, "px-1 mb-2")}>{children}</h2>
);

/**
 * One destination: a card that is itself the link. It rises on hover
 * (`CARD_INTERACTIVE`), and that lift is its only hover.
 */
const SettingsLink = ({
  to,
  icon: Icon,
  title,
  description,
  tone = "primary",
}: {
  to: string;
  icon: LucideIcon;
  title: string;
  description: string;
  tone?: Tone;
}) => (
  <Link
    to={to}
    className={cn(CARD_INTERACTIVE, "flex items-start gap-3.5 p-4 sm:p-5")}
  >
    <span
      className={cn(
        "shrink-0 w-9 h-9 rounded-xl flex items-center justify-center",
        TONE_WASH[tone],
      )}
    >
      <Icon className="w-[18px] h-[18px]" />
    </span>
    <span className="flex-1 min-w-0">
      <span className="block font-bold text-sm text-on-surface">{title}</span>
      <span className="block text-xs sm:text-sm text-on-surface-variant mt-0.5 text-pretty">
        {description}
      </span>
    </span>
    <ChevronRight className="w-4 h-4 text-on-surface-variant shrink-0 mt-1" />
  </Link>
);

/**
 * The corvid's perch on a phone.
 *
 * There is no sidebar below `md`, so the one mark a person can press lives
 * here, at the end of the line that closes the page. It behaves exactly like
 * the sidebar perch: the same name, the same tooltip, the same three levels,
 * and the same flight, which leaves from this rectangle instead of that one.
 *
 * `md:hidden`, because above the breakpoint the sidebar perch is on screen
 * and two birds that both fly would be two birds in the air.
 */
const PhonePerch = () => {
  const markRef = useRef<HTMLSpanElement>(null);
  const level = useCorvidLevel();

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
      // `hit-area` rather than padding: the line is 12 px tall and a 44 px
      // box drawn in the layout would push the sentence off its baseline.
      className="hit-area state-layer md:hidden ml-auto shrink-0 rounded-lg text-primary transition-colors"
      aria-label="Contrack"
      title="Let the corvid fly"
    >
      <span ref={markRef} {...perchProps} className="flex">
        <CorvidMark size={20} />
      </span>
    </button>
  );
};

export const SettingsHome = () => {
  const { user, authRequired, isAdmin } = useAuth();
  const [query, setQuery] = useState("");

  const isSearching = query.trim().length > 0;

  return (
    <div className={cn(SETTINGS_PAGE, "space-y-8")}>
      <SettingsIdentityRow />

      <div className="lg:hidden">
        <SettingsSearch
          value={query}
          onChange={setQuery}
          variant="landing"
          onSelect={() => setQuery("")}
        />
      </div>

      {!isSearching && (
        <div className="space-y-8">
          <NeedsAttention />

          {SETTINGS_GROUPS.map((group, groupIdx) => {
            const pages = SETTINGS_PAGES.filter((page) => {
              if (page.group !== group.id) return false;
              if (page.admin && !isAdmin) return false;
              if (page.needsAccount && !authRequired) return false;
              if (page.id === "ai-usage" && isAdmin) return false;
              return true;
            });

            if (pages.length === 0) return null;

            return (
              <section
                key={group.id}
                className="tile-enter"
                style={{ animationDelay: tileDelay(groupIdx) }}
              >
                <GroupHeading>{group.title}</GroupHeading>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {pages.map((page) => (
                    <SettingsLink
                      key={page.id}
                      to={page.path}
                      icon={page.icon}
                      title={
                        page.id === "account"
                          ? user?.displayName || user?.username || page.title
                          : page.title
                      }
                      description={page.description}
                      tone={page.tone ?? "primary"}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <p className="flex items-center gap-1.5 text-xs text-on-surface-variant px-1">
        <HardDrive className="w-3.5 h-3.5" />
        Everything here is stored on this machine.
        <PhonePerch />
      </p>
    </div>
  );
};

export default SettingsHome;
