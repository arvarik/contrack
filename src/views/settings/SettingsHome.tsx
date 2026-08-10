/**
 * SettingsHome — the Settings landing page.
 *
 * Information architecture
 * ------------------------
 * The page used to be one flat stack of eight cards in no particular order:
 * three navigation links, then a preferences panel, then three more links,
 * with an unrelated dedupe slider grafted onto the bottom of the first card.
 * Finding anything meant reading every card title.
 *
 * It is now split by *what the user is doing*:
 *
 *   Preferences — settings you change here, in place. No navigation.
 *   Intelligence / Organize / Data — places you go.
 *
 * Everything in the second kind is a `SettingsLink`, so all destinations look
 * and behave identically and the groups do the explaining.
 *
 * Layout is mobile-first: one column by default, two from `sm`. Rows are tall
 * enough to be comfortable thumb targets before they are pointer targets.
 */
import React from "react";
import { Link } from "react-router-dom";
import {
  Archive,
  Brain,
  ChevronRight,
  Copy,
  Gauge,
  List,
  Search,
  Sparkles,
  HardDrive,
  Trash2,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "../../components/auth/AuthGate";
import { CARD, SECTION_HEADING } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { tileDelay } from "../../lib/motion";
import {
  useRecentContactsLimit,
  MIN_RECENT_LIMIT,
  MAX_RECENT_LIMIT,
} from "../../hooks/useRecentContacts";
import { useDedupeSettings } from "../../hooks/useDedupeSettings";
import { useListDensity } from "../../hooks/useListDensity";
import { emitSettingsChanged } from "../../lib/appEvents";

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/** Small-caps heading that names a group of settings. */
const GroupHeading = ({ children }: { children: React.ReactNode }) => (
  <h2 className={cn(SECTION_HEADING, "px-1 mb-2")}>{children}</h2>
);

/**
 * One destination row. Icon tint is per-item so the destructive and
 * archival areas stay visually distinct from the rest.
 */
const SettingsLink = ({
  to,
  icon: Icon,
  title,
  description,
  tone = "primary",
  show = true,
}: {
  to: string;
  icon: LucideIcon;
  title: string;
  description: string;
  tone?: "primary" | "amber" | "danger";
  /** False when the active filter excludes this row. */
  show?: boolean;
}) => {
  if (!show) return null;
  const tones = {
    primary: "bg-primary/10 text-primary",
    amber: "bg-amber-500/10 text-warning",
    danger: "bg-red-500/10 text-error",
  } as const;

  return (
    <Link
      to={to}
      className={cn(
        CARD,
        "flex items-start gap-3.5 p-4 sm:p-5 group",
        "hover:bg-surface-container-high focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        "transition-colors",
      )}
    >
      <span
        className={cn(
          "shrink-0 w-9 h-9 rounded-xl flex items-center justify-center",
          tones[tone],
        )}
      >
        <Icon className="w-[18px] h-[18px]" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-bold text-sm text-on-surface group-hover:text-primary transition-colors">
          {title}
        </span>
        <span className="block text-xs sm:text-sm text-on-surface-variant mt-0.5 text-pretty">
          {description}
        </span>
      </span>
      <ChevronRight className="w-4 h-4 text-on-surface-variant shrink-0 mt-1 group-hover:text-primary group-hover:translate-x-0.5 transition-[color,transform]" />
    </Link>
  );
};

/**
 * A preference row: label + description on the left, control on the right.
 * Stacks under `sm` so the control never gets squeezed into a sliver.
 */
const PreferenceRow = ({
  title,
  description,
  children,
  show = true,
}: {
  title: string;
  /** Rich content allowed: some settings need more than one sentence. */
  description: React.ReactNode;
  children: React.ReactNode;
  /** False when the active filter excludes this row. */
  show?: boolean;
}) =>
  !show ? null : (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <h3 className="font-bold text-sm text-on-surface">{title}</h3>
        <p className="text-xs sm:text-sm text-on-surface-variant mt-0.5 text-pretty">
          {description}
        </p>
      </div>
      <div className="shrink-0 sm:ml-4">{children}</div>
    </div>
  );

/** Segmented control — the app's standard pill-in-a-trough toggle. */
const Segmented = <T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}) => (
  <div
    role="radiogroup"
    aria-label={label}
    className="flex bg-surface-container rounded-full p-1 shadow-inner h-9 w-full sm:w-auto"
  >
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        role="radio"
        aria-checked={value === option.value}
        onClick={() => onChange(option.value)}
        className={cn(
          "flex-1 sm:flex-none px-3 sm:px-4 h-full rounded-full text-xs font-bold",
          "flex items-center justify-center whitespace-nowrap transition-colors",
          value === option.value
            ? "bg-surface shadow-sm text-primary"
            : "text-on-surface-variant hover:text-on-surface",
        )}
      >
        {option.label}
      </button>
    ))}
  </div>
);

/** Stepper for a small bounded integer. */
const Stepper = ({
  value,
  onChange,
  min,
  max,
  label,
}: {
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  label: string;
}) => {
  const button =
    "w-9 h-9 rounded-xl flex items-center justify-center text-base font-bold transition-colors bg-surface-container hover:bg-surface-container-high disabled:text-on-surface-variant disabled:cursor-not-allowed";
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={value <= min}
        aria-label={`Decrease ${label}`}
        className={button}
      >
        −
      </button>
      <span
        aria-live="polite"
        className="w-7 text-center font-extrabold text-on-surface tabular-nums"
      >
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        aria-label={`Increase ${label}`}
        className={button}
      >
        +
      </button>
    </div>
  );
};

/**
 * Filter box for the settings page.
 *
 * Five groups and a dozen destinations is past the point where scanning
 * headings beats typing. People remember *what* they want to change — "trash",
 * "password", "celsius" — not which group a curator filed it under.
 *
 * Items match on synonyms as well as their visible label (below), so "logout"
 * finds Account and "dedupe" finds Duplicates.
 */
const SettingsFilter = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) => (
  <div className="relative">
    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant pointer-events-none" />
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Search settings"
      aria-label="Search settings"
      className={cn(
        "w-full pl-10 pr-4 py-3 rounded-xl bg-surface-container-highest",
        // 16px on mobile keeps iOS Safari from zooming the viewport on focus.
        "text-base sm:text-sm",
        "outline-none focus-visible:ring-2 focus-visible:ring-primary",
      )}
    />
  </div>
);

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const TEMP_UNIT_KEY = "contrack_temp_unit";

/**
 * What each sensitivity actually does, in the terms that matter: the
 * confidence a pair needs before Contrack merges it without asking.
 *
 * Each line carries exactly one number and one trade-off. The shared facts
 * (runs only during a scan you start, always undoable) live once, in the
 * sentence under the control — an earlier draft repeated them per preset and
 * read as a paragraph.
 */
const DEDUPE_PRESET_COPY = {
  conservative:
    "Auto-merges only pairs at 97%+ confidence. Fewest merges; most left for review.",
  default: "Auto-merges pairs at 93%+ confidence.",
  aggressive:
    "Auto-merges pairs at 88%+ confidence. Fewer to review; more misfires to undo.",
} as const;

export const SettingsHome = () => {
  const [tempUnit, setTempUnit] = React.useState<"celsius" | "fahrenheit">(
    "celsius",
  );
  const { limit: recentLimit, setLimit: setRecentLimit } =
    useRecentContactsLimit();
  const { preset, setPreset } = useDedupeSettings();
  const { density, setDensity } = useListDensity();
  const { user, authRequired } = useAuth();
  const [query, setQuery] = React.useState("");

  const q = query.trim().toLowerCase();
  /** True when no filter is active, or any of `terms` contains it. */
  const hit = (...terms: string[]) =>
    !q || terms.some((t) => t.toLowerCase().includes(q));

  // Synonyms live here rather than in each label, so the words people actually
  // type ("logout", "bin", "api key") find the right row.
  const show = {
    account:
      authRequired &&
      hit(
        "account",
        "profile",
        "password",
        "sign out",
        "logout",
        "devices",
        "session",
        "email",
        "username",
        "security",
      ),
    tempUnit: hit(
      "temperature unit",
      "celsius",
      "fahrenheit",
      "weather",
      "degrees",
    ),
    density: hit("list density", "compact", "comfortable", "rows", "spacing"),
    recent: hit("recent contacts", "recently visited", "history", "pinned"),
    sensitivity: hit(
      "auto-merge sensitivity",
      "duplicates",
      "dedupe",
      "merge",
      "threshold",
    ),
    aiConfig: hit(
      "ai configuration",
      "providers",
      "models",
      "gemini",
      "openai",
      "anthropic",
      "ollama",
      "api key",
      "capabilities",
    ),
    aiSearch: hit(
      "contact enrichment",
      "ai search",
      "research",
      "web",
      "hydrate",
    ),
    aiStats: hit("ai usage", "stats", "tokens", "cost", "cache", "invocations"),
    dedupe: hit("duplicates", "dedupe", "merge", "suggestions"),
    lists: hit("lists", "groups", "members", "reorder"),
    archived: hit("archived contacts", "archive", "hidden"),
    trash: hit("trash", "deleted", "restore", "bin", "recycle"),
  };

  const groupShown = {
    account: show.account,
    preferences:
      show.tempUnit || show.density || show.recent || show.sensitivity,
    intelligence: show.aiConfig || show.aiSearch || show.aiStats,
    organize: show.dedupe || show.lists,
    data: show.archived || show.trash,
  };
  const nothingMatches = !Object.values(groupShown).some(Boolean);

  React.useEffect(() => {
    const saved = localStorage.getItem(TEMP_UNIT_KEY);
    if (saved === "fahrenheit" || saved === "celsius") setTempUnit(saved);
  }, []);

  const handleUnitChange = (unit: "celsius" | "fahrenheit") => {
    setTempUnit(unit);
    localStorage.setItem(TEMP_UNIT_KEY, unit);
    emitSettingsChanged();
  };

  return (
    <div className="p-4 sm:p-6 md:p-10 max-w-4xl mx-auto space-y-8 pb-28 md:pb-10">
      <SettingsFilter value={query} onChange={setQuery} />

      {nothingMatches && (
        <p className="text-sm text-on-surface-variant text-center py-8">
          Nothing in Settings matches “{query.trim()}”.
        </p>
      )}

      {/*
        Account leads, but only on an instance that asks anyone to sign in.
        On the default local setup there is no account, and a link whose only
        content is "this does not apply to you" is worse than no link.
      */}
      {groupShown.account && (
        <section
          className="tile-enter"
          style={{ animationDelay: tileDelay(0) }}
        >
          <GroupHeading>Account</GroupHeading>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SettingsLink
              to="/settings/account"
              icon={UserRound}
              title={user?.displayName || user?.username || "Account"}
              description="Your profile, password, and the devices you're signed in on."
            />
          </div>
        </section>
      )}

      {/* ── Preferences — changed in place, so they lead ─────────────── */}
      {groupShown.preferences && (
        <section
          className="tile-enter"
          style={{ animationDelay: tileDelay(1) }}
        >
          <GroupHeading>Preferences</GroupHeading>
          <div
            className={cn(CARD, "p-4 sm:p-6 divide-y divide-surface-container")}
          >
            <PreferenceRow
              show={show.tempUnit}
              title="Temperature unit"
              description="How weather reads on a contact's local-time badge."
            >
              <Segmented
                label="Temperature unit"
                value={tempUnit}
                onChange={handleUnitChange}
                options={[
                  { value: "celsius", label: "°C" },
                  { value: "fahrenheit", label: "°F" },
                ]}
              />
            </PreferenceRow>

            <PreferenceRow
              show={show.density}
              title="List density"
              description={
                density === "compact"
                  ? "Compact — more contacts per screen, same details."
                  : "Comfortable — roomier rows, easier to scan."
              }
            >
              <Segmented
                label="List density"
                value={density}
                onChange={setDensity}
                options={[
                  { value: "comfortable", label: "Comfortable" },
                  { value: "compact", label: "Compact" },
                ]}
              />
            </PreferenceRow>

            <PreferenceRow
              show={show.recent}
              title="Recent contacts"
              description="How many recently visited contacts pin to the top of your Network. Set to 0 to hide the row."
            >
              <Stepper
                label="recent contacts"
                value={recentLimit}
                onChange={setRecentLimit}
                min={MIN_RECENT_LIMIT}
                max={MAX_RECENT_LIMIT}
              />
            </PreferenceRow>

            {/*
            This slider used to be bolted to the bottom of the Dedupe Engine
            navigation card, where it read as part of the link. It is a
            preference, so it lives with the preferences; the engine itself is
            a destination under Organize.
          */}
            <PreferenceRow
              show={show.sensitivity}
              title="Auto-merge sensitivity"
              description={
                <>
                  <span className="block">{DEDUPE_PRESET_COPY[preset]}</span>
                  <span className="block mt-1.5">
                    Runs only during scans you start from{" "}
                    <Link
                      to="/settings/dedupe"
                      className="font-bold text-primary hover:underline"
                    >
                      Duplicates
                    </Link>{" "}
                    — never in the background. Every auto-merge is undoable
                    there.
                  </span>
                </>
              }
            >
              <Segmented
                label="Auto-merge sensitivity"
                value={preset}
                onChange={setPreset}
                options={[
                  { value: "conservative", label: "Cautious" },
                  { value: "default", label: "Balanced" },
                  { value: "aggressive", label: "Eager" },
                ]}
              />
            </PreferenceRow>
          </div>
        </section>
      )}

      {/* ── Intelligence ─────────────────────────────────────────────── */}
      {groupShown.intelligence && (
        <section
          className="tile-enter"
          style={{ animationDelay: tileDelay(2) }}
        >
          <GroupHeading>Intelligence</GroupHeading>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SettingsLink
              show={show.aiConfig}
              to="/settings/ai-config"
              icon={Brain}
              title="AI Configuration"
              description="Connect providers and choose what powers each kind of AI work."
            />
            <SettingsLink
              show={show.aiSearch}
              to="/settings/ai-search"
              icon={Sparkles}
              title="Contact Enrichment"
              description="Research and fill in contact profiles from the live web."
            />
            <SettingsLink
              show={show.aiStats}
              to="/settings/ai-stats"
              icon={Gauge}
              title="AI Usage"
              description="Invocations, token spend, cache hit rate, and approximate cost."
            />
          </div>
        </section>
      )}

      {/* ── Organize ─────────────────────────────────────────────────── */}
      {groupShown.organize && (
        <section
          className="tile-enter"
          style={{ animationDelay: tileDelay(3) }}
        >
          <GroupHeading>Organize</GroupHeading>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/*
            Duplicates leads the group. It is the one destination here that
            has work queued behind it — the sidebar already carries a badge for
            pending suggestions — and a queue nobody sees is a queue nobody
            clears. Lists are browsed when you go looking for them; duplicates
            need to be offered.
          */}
            <SettingsLink
              show={show.dedupe}
              to="/settings/dedupe"
              icon={Copy}
              title="Duplicates"
              description="Find and merge duplicate contacts, automatically or by hand."
            />
            <SettingsLink
              show={show.lists}
              to="/settings/lists"
              icon={List}
              title="Lists"
              description="Reorder, rename, and delete lists, and manage who belongs to each."
            />
          </div>
        </section>
      )}

      {/* ── Data ─────────────────────────────────────────────────────── */}
      {groupShown.data && (
        <section
          className="tile-enter"
          style={{ animationDelay: tileDelay(4) }}
        >
          <GroupHeading>Data</GroupHeading>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SettingsLink
              show={show.archived}
              to="/settings/archived"
              icon={Archive}
              tone="amber"
              title="Archived contacts"
              description="Hidden from your Network and Map. Restore them at any time."
            />
            <SettingsLink
              show={show.trash}
              to="/settings/trash"
              icon={Trash2}
              tone="danger"
              title="Trash"
              description="Recently deleted contacts. Empties itself after 30 days."
            />
          </div>
        </section>
      )}

      {/* Quiet footer — orients without competing with the groups above. */}
      <p className="flex items-center gap-1.5 text-xs text-on-surface-variant px-1">
        <HardDrive className="w-3.5 h-3.5" />
        Everything here is stored on this machine.
      </p>
    </div>
  );
};
