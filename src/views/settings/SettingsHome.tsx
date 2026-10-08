/**
 * The Settings landing page, built from the registry. Below `lg` it is the
 * list every page opens from, and a page slides in over it.
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, HardDrive, type LucideIcon } from "lucide-react";
import { useAuth } from "../../components/auth/AuthGate";
import { SettingsIdentityRow } from "../../components/auth/AccountIdentity";
import { SettingsSearch } from "./SettingsSearch";
import { NeedsAttention } from "./NeedsAttention";
import {
  SETTINGS_GROUPS,
  SETTINGS_PAGES,
  isSettingsPageVisible,
} from "./registry";
import { SETTINGS_PAGE, SETTINGS_SECTION_HEADING } from "./layout";
import { SlideLink } from "./slide";
import { CARD_INTERACTIVE, TONE_WASH, type Tone } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { tileDelay } from "../../lib/motion";
import { CorvidMark } from "../../components/brand/CorvidMark";
import { perchProps } from "../../components/brand/CorvidFlight";
import { useCorvidLevel } from "../../hooks/useCorvidLevel";
import { flyCorvid } from "../../lib/corvid";

/**
 * A card that is itself the link. The lift is its only hover. On a phone the
 * group is the one card and each link a row in it, tinted on press.
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
}) => {
  return (
    <SlideLink
      to={to}
      className={cn(
        CARD_INTERACTIVE,
        "flex items-start gap-3.5 p-4 sm:p-5",
        // A row of the phone's group card, tinted on press.
        "max-sm:p-3 max-sm:rounded-xl max-sm:bg-transparent max-sm:shadow-none max-sm:active:bg-on-surface/10",
      )}
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
    </SlideLink>
  );
};

/**
 * The corvid's perch below `md`, where there is no sidebar perch. It acts
 * like the sidebar perch. `md:hidden` keeps two birds out of the air.
 */
const PhonePerch = () => {
  const level = useCorvidLevel();

  const onClick = useCallback(() => {
    if (level === "off") return;
    flyCorvid({ kind: "loop" });
  }, [level]);

  return (
    <button
      type="button"
      onClick={onClick}
      // `hit-area`, not padding: a 44 px box in the 12 px line would push
      // the sentence off its baseline.
      className="hit-area state-layer md:hidden ml-auto shrink-0 rounded-lg text-primary transition-colors"
      aria-label="Contrack"
      title="Let the corvid fly"
    >
      <span {...perchProps} className="flex">
        {/* Too small to live, but it answers: the flutter at "subtle". */}
        <CorvidMark size={20} alive />
      </span>
    </button>
  );
};

/**
 * The groups animate in on the first visit only, so a back slide's picture
 * of the list is never blank.
 */
let listHasArrived = false;

export const SettingsHome = () => {
  const { user, authRequired, isAdmin } = useAuth();
  const [query, setQuery] = useState("");
  const [arriving] = useState(() => !listHasArrived);
  useEffect(() => {
    listHasArrived = true;
  }, []);

  const isSearching = query.trim().length > 0;

  return (
    <div className={cn(SETTINGS_PAGE, "space-y-8")}>
      <SettingsIdentityRow />

      {/* Below lg the list is long, so the field stays at the top while it
        scrolls. Not while it shows results: they are the page then. */}
      <div
        className={cn(
          "lg:hidden",
          !isSearching && "sticky top-0 z-10 -mt-2 py-2 bg-surface",
        )}
      >
        <SettingsSearch value={query} onChange={setQuery} variant="landing" />
      </div>

      {!isSearching && (
        <div className="space-y-8">
          <NeedsAttention />

          {/* From lg the rail lists every page, so this list does not. */}
          <p className="hidden lg:block text-sm text-on-surface-variant">
            Choose a page in the list to see its settings
          </p>

          <div className="space-y-8 lg:hidden">
            {SETTINGS_GROUPS.map((group, groupIdx) => {
              const pages = SETTINGS_PAGES.filter(
                (page) =>
                  page.group === group.id &&
                  isSettingsPageVisible(page, { isAdmin, authRequired }),
              );

              if (pages.length === 0) return null;

              return (
                <section
                  key={group.id}
                  className={arriving ? "tile-enter" : undefined}
                  style={
                    arriving
                      ? { animationDelay: tileDelay(groupIdx) }
                      : undefined
                  }
                >
                  <h2 className={SETTINGS_SECTION_HEADING}>{group.title}</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-sm:gap-0 max-sm:p-1 max-sm:rounded-2xl max-sm:bg-surface-container-lowest max-sm:shadow-sm">
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
        </div>
      )}

      <p className="flex items-center gap-1.5 text-xs text-on-surface-variant px-1">
        <HardDrive className="w-3.5 h-3.5" />
        Everything here is stored on the server
        <PhonePerch />
      </p>
    </div>
  );
};
