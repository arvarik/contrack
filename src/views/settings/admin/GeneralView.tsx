/**
 * GeneralView — the settings that belong to the instance, not to a person.
 *
 * Cards in order:
 *   1. Name
 *   2. Who can join (registration and magic-link sign in)
 *   3. Session length
 *   4. Trash (retention window)
 *   5. Backups (interval and keep count)
 *   6. Integrations (SearXNG search URL and Google OAuth client)
 */
import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  Check,
  Copy,
  DoorOpen,
  Eye,
  EyeOff,
  Globe,
  Key,
  Mail,
  TriangleAlert,
} from "lucide-react";
import {
  useInstanceSettings,
  useUpdateInstanceSettings,
  useIntegrations,
  useUpdateIntegrations,
} from "../../../api/admin";
import { SELECTED_ROW, SELECTED_TINT, TONE_WASH } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import { radioKeys, radioTabIndex } from "../../../lib/a11y";
import { copyToClipboard, CLIPBOARD_DENIED } from "../../../lib/clipboard";
import { Switch } from "../../../components/ui/Switch";
import { RadioDot } from "../../../components/ui/RadioDot";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { SettingRow, useHashTarget } from "../SettingRow";
import {
  SETTINGS_CARD,
  SETTINGS_INPUT,
  SETTINGS_LABEL,
  SETTINGS_PAGE,
  SETTINGS_SECTION_HEADING,
} from "../layout";

/** The card each setting sits on, with this page's padding. */
const PANEL = SETTINGS_CARD;

/**
 * A card a search result links to (`#name`, `#trash`): scrolled to, focused
 * for a screen reader, and flashed with the selected tint.
 */
function useCardTarget<T extends HTMLElement = HTMLDivElement>(id: string) {
  const { ref, flashing } = useHashTarget<T>(id);
  return {
    id,
    ref,
    tabIndex: -1,
    flash: cn(
      "scroll-mt-20 outline-none transition-colors duration-(--dur-slow)",
      flashing && SELECTED_ROW,
    ),
  };
}

/**
 * One preset in a radio group: the selected tint on the current value, the
 * hover layer on the others, and a `RadioDot` on each, which says "chosen"
 * by shape as well as by hue. `locked` is a value the environment sets.
 */
const presetClass = (active: boolean, locked = false) =>
  cn(
    "flex items-start gap-3 text-left px-4 py-3 rounded-xl transition-colors disabled:cursor-not-allowed",
    locked && "opacity-75 cursor-not-allowed",
    active ? SELECTED_TINT : "state-layer bg-surface-container-highest",
  );

/** A preset's name. On the current value it keeps the selected ink. */
const presetLabel = (active: boolean) =>
  cn("block text-sm font-bold", !active && "text-on-surface");

/** A key or a URL in the Integrations card. */
const KEY_INPUT = cn(SETTINGS_INPUT, "font-mono");

/** The "Configured" chip beside an integration's name. */
const CONFIGURED_CHIP = cn(
  "inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md",
  TONE_WASH.success,
);

/** Shown in place of a card whose value could not be read. */
const ReadFailed = ({ onRetry }: { onRetry: () => void }) => (
  <div className={cn(PANEL, "space-y-3")}>
    <p className="flex items-start gap-2 text-sm text-on-surface text-pretty">
      <TriangleAlert className="w-4 h-4 text-warning shrink-0 mt-0.5" />
      This setting did not load, so its current value is unknown. Nothing has
      changed.
    </p>
    <button type="button" onClick={onRetry} className="btn-secondary">
      Try again
    </button>
  </div>
);

// ─── 1. Instance Name ────────────────────────────────────────────────────────

export const InstanceNameCard = () => {
  const { data, isLoading, isError, refetch } = useInstanceSettings();
  const save = useUpdateInstanceSettings();
  const [draft, setDraft] = useState<string | null>(null);
  const stored = data?.instanceName ?? "";
  const max = data?.instanceNameMax ?? 60;
  const value = draft ?? stored;

  useEffect(() => {
    if (draft === null && data) setDraft(data.instanceName);
  }, [data, draft]);

  const target = useCardTarget<HTMLFormElement>("name");

  if (isError) return <ReadFailed onRetry={() => void refetch()} />;

  const dirty = value.trim() !== stored;

  return (
    <form
      id={target.id}
      ref={target.ref}
      tabIndex={target.tabIndex}
      className={cn(PANEL, "space-y-4", target.flash)}
      onSubmit={(event) => {
        event.preventDefault();
        if (!dirty) return;
        save.mutate(
          { instanceName: value.trim() },
          {
            onSuccess: (settings) => {
              setDraft(settings.instanceName);
              toast.success(
                settings.instanceName
                  ? `This instance is now "${settings.instanceName}"`
                  : "The instance name was cleared",
              );
            },
            onError: (error: Error) => toast.error(error.message),
          },
        );
      }}
    >
      <div className="space-y-0.5">
        <label
          htmlFor="instance-name"
          className="block text-sm font-bold text-on-surface"
        >
          Instance name
        </label>
        <p className="text-xs sm:text-sm text-on-surface-variant text-pretty">
          Shown on the sign-in and join screens, in the account menu, and in the
          browser tab. Leave it empty to show the product name.
        </p>
      </div>

      <input
        id="instance-name"
        type="text"
        value={value}
        maxLength={max}
        disabled={isLoading || save.isPending}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Contrack"
        autoComplete="off"
        className={SETTINGS_INPUT}
      />

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-on-surface-variant">
          {value.length} of {max}
        </p>
        <button
          type="submit"
          disabled={!dirty || save.isPending}
          className="btn-primary"
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>

      <p className="flex items-start gap-2 text-xs text-on-surface-variant text-pretty">
        <DoorOpen className="w-4 h-4 shrink-0 mt-0.5" />
        The sign-in screen has no credential behind it, so this name is visible
        to anybody who can reach this instance.
      </p>
    </form>
  );
};

// ─── 2. Who Can Join ─────────────────────────────────────────────────────────

export const RegistrationCard = () => {
  const { data, isLoading, isError, refetch } = useInstanceSettings();
  const save = useUpdateInstanceSettings();
  const open = data?.registrationOpen === true;
  const magicLink = data?.magicLinkSignIn === true;
  const mailReady = data?.mailConfigured === true;

  const target = useCardTarget("registration");

  if (isError) return <ReadFailed onRetry={() => void refetch()} />;

  return (
    <div
      id={target.id}
      ref={target.ref}
      tabIndex={target.tabIndex}
      className={cn(PANEL, target.flash)}
    >
      <SettingRow
        id="open-registration"
        title="Anyone can create an account"
        description={
          <>
            Adds a &ldquo;Create one&rdquo; link to the sign-in screen. New
            accounts are always members and start empty.
          </>
        }
        inline
      >
        <Switch
          checked={open}
          label="Anyone can create an account"
          disabled={isLoading || save.isPending || !data}
          onChange={() =>
            save.mutate(
              { registrationOpen: !open },
              {
                onSuccess: (settings) =>
                  toast.success(
                    settings.registrationOpen
                      ? "Anyone who reaches the sign-in page can now create an account"
                      : "Registration is closed",
                  ),
                onError: (error: Error) => toast.error(error.message),
              },
            )
          }
        />
      </SettingRow>

      {open && (
        <p className="flex items-start gap-2 rounded-xl bg-warning/10 p-3 text-xs text-on-surface text-pretty">
          <DoorOpen className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          While this is on, anybody who can reach this instance can make an
          account on it. On something exposed to the internet, invitations do
          the same job without the door being open.
        </p>
      )}

      <SettingRow
        id="magic-link"
        title="Sign in by emailed link"
        description="Members can sign in with a link, sent to their email, that works once."
        inline
      >
        <Switch
          checked={magicLink}
          label="Sign in by emailed link"
          disabled={isLoading || save.isPending || !data || !mailReady}
          onChange={() =>
            save.mutate(
              { magicLinkSignIn: !magicLink },
              {
                onSuccess: (settings) =>
                  toast.success(
                    settings.magicLinkSignIn
                      ? "Sign in by emailed link is on"
                      : "Sign in by emailed link is off",
                  ),
                onError: (error: Error) => toast.error(error.message),
              },
            )
          }
        />
      </SettingRow>

      {!mailReady && (
        <p className="flex items-start gap-2 rounded-xl bg-surface-container-low p-3 text-xs text-on-surface-variant text-pretty">
          <Mail className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            The link goes by email, so set up{" "}
            <Link
              to="/settings/admin/mail"
              className="font-semibold text-primary underline underline-offset-2"
            >
              outgoing mail
            </Link>{" "}
            first.
          </span>
        </p>
      )}
    </div>
  );
};

// ─── 3. Session Length ───────────────────────────────────────────────────────

const TTL_PRESETS = [
  { days: 1, label: "1 day", hint: "Exposed to the internet" },
  { days: 7, label: "1 week", hint: "Shared or portable machine" },
  { days: 30, label: "30 days", hint: "Default" },
  { days: 365, label: "1 year", hint: "Private machine only" },
] as const;

export const SessionLengthCard = () => {
  const { data, isLoading, isError, refetch } = useInstanceSettings();
  const save = useUpdateInstanceSettings();
  const current = data?.sessionTtlDays ?? 30;
  const isCustom = !TTL_PRESETS.some((preset) => preset.days === current);

  const target = useCardTarget("session-length");

  if (isError) return <ReadFailed onRetry={() => void refetch()} />;

  return (
    <div
      id={target.id}
      ref={target.ref}
      tabIndex={target.tabIndex}
      className={cn(PANEL, "space-y-4", target.flash)}
    >
      <p className="text-sm text-on-surface-variant text-pretty">
        How long a sign-in lasts before Contrack asks for a password again. It
        applies to every account.
      </p>

      {isLoading ? (
        <p className="text-sm text-on-surface-variant">Loading…</p>
      ) : (
        <div
          role="radiogroup"
          aria-label="Session length"
          className="grid grid-cols-1 sm:grid-cols-2 gap-2"
        >
          {TTL_PRESETS.map((preset, index) => {
            const active = preset.days === current;
            return (
              <button
                key={preset.days}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={radioTabIndex(
                  active,
                  index,
                  TTL_PRESETS.some((p) => p.days === current),
                )}
                onKeyDown={radioKeys}
                disabled={save.isPending}
                onClick={() =>
                  !active &&
                  save.mutate(
                    { sessionTtlDays: preset.days },
                    {
                      onSuccess: ({ sessionTtlDays }) =>
                        toast.success(
                          `New sign-ins will last ${
                            sessionTtlDays === 1
                              ? "1 day"
                              : `${sessionTtlDays} days`
                          }`,
                        ),
                      onError: (error: Error) => toast.error(error.message),
                    },
                  )
                }
                className={presetClass(active)}
              >
                <RadioDot checked={active} className="mt-0.5" />
                <span className="min-w-0">
                  <span className={presetLabel(active)}>{preset.label}</span>
                  <span className="block text-xs text-on-surface-variant mt-0.5">
                    {preset.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {isCustom && !isLoading && (
        <p className="text-xs text-on-surface-variant">
          It is set to {current} days now. Choosing one above replaces it.
        </p>
      )}

      <p className="text-xs text-on-surface-variant text-pretty">
        This applies to sign-ins from now on. Sessions that already exist keep
        the length they were created with. To end those, disable the account or
        reset its password.
      </p>
    </div>
  );
};

// ─── 4. Trash Retention ──────────────────────────────────────────────────────

const TRASH_PRESETS = [
  { days: 7, label: "7 days", hint: "Empties every week" },
  { days: 30, label: "30 days", hint: "Default" },
  { days: 90, label: "90 days", hint: "About a season" },
  { days: 365, label: "1 year", hint: "The longest" },
] as const;

export const TrashCard = () => {
  const { data, isLoading, isError, refetch } = useInstanceSettings();
  const save = useUpdateInstanceSettings();
  const current = data?.trashRetentionDays ?? 30;
  const isEnv = data?.trashRetentionDaysSource === "env";
  const isCustom = !TRASH_PRESETS.some((preset) => preset.days === current);

  const target = useCardTarget("trash");

  if (isError) return <ReadFailed onRetry={() => void refetch()} />;

  return (
    <div
      id={target.id}
      ref={target.ref}
      tabIndex={target.tabIndex}
      className={cn(PANEL, "space-y-4", target.flash)}
    >
      <p className="text-sm text-on-surface-variant text-pretty">
        How long a deleted contact stays in Trash, where it can be restored,
        before it is deleted for good.
      </p>

      {isEnv && (
        <p className="text-xs rounded-xl bg-surface-container-low p-3 text-on-surface-variant">
          Set by TRASH_RETENTION_DAYS in the environment.
        </p>
      )}

      {isLoading ? (
        <p className="text-sm text-on-surface-variant">Loading…</p>
      ) : (
        <div
          role="radiogroup"
          aria-label="Trash retention"
          className="grid grid-cols-1 sm:grid-cols-2 gap-2"
        >
          {TRASH_PRESETS.map((preset, index) => {
            const active = preset.days === current;
            return (
              <button
                key={preset.days}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={radioTabIndex(
                  active,
                  index,
                  TRASH_PRESETS.some((p) => p.days === current),
                )}
                onKeyDown={radioKeys}
                disabled={isEnv || save.isPending}
                onClick={() =>
                  !active &&
                  !isEnv &&
                  save.mutate(
                    { trashRetentionDays: preset.days },
                    {
                      onSuccess: (settings) =>
                        toast.success(
                          `Trash retention set to ${settings.trashRetentionDays} days`,
                        ),
                      onError: (error: Error) => toast.error(error.message),
                    },
                  )
                }
                className={presetClass(active, isEnv)}
              >
                <RadioDot checked={active} className="mt-0.5" />
                <span className="min-w-0">
                  <span className={presetLabel(active)}>{preset.label}</span>
                  <span className="block text-xs text-on-surface-variant mt-0.5">
                    {preset.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {isCustom && !isLoading && (
        <p className="text-xs text-on-surface-variant">
          It is set to {current} days now. Choosing one above replaces it.
        </p>
      )}

      <p className="text-xs text-on-surface-variant text-pretty">
        A shorter time deletes the older contacts in Trash at the next daily
        cleanup.
      </p>
    </div>
  );
};

// ─── 5. Backup Schedule ──────────────────────────────────────────────────────

const BACKUP_INTERVAL_PRESETS = [
  { hours: 0, label: "Off", hint: "Only when you take one" },
  { hours: 6, label: "6 hours", hint: "Many changes each day" },
  { hours: 12, label: "12 hours", hint: "Twice a day" },
  { hours: 24, label: "24 hours", hint: "Default, once a day" },
  { hours: 168, label: "7 days", hint: "Once a week" },
] as const;

const BACKUP_KEEP_PRESETS = [
  { count: 3, label: "3 snapshots", hint: "The least space" },
  { count: 7, label: "7 snapshots", hint: "Default" },
  { count: 14, label: "14 snapshots", hint: "Two weeks of daily ones" },
  { count: 30, label: "30 snapshots", hint: "A month of daily ones" },
] as const;

export const BackupScheduleCard = () => {
  const { data, isLoading, isError, refetch } = useInstanceSettings();
  const save = useUpdateInstanceSettings();

  const intervalCurrent = data?.backupIntervalHours ?? 24;
  const isIntervalEnv = data?.backupIntervalHoursSource === "env";

  const keepCurrent = data?.backupKeep ?? 7;
  const isKeepEnv = data?.backupKeepSource === "env";

  const target = useCardTarget("backups");

  if (isError) return <ReadFailed onRetry={() => void refetch()} />;

  return (
    <div
      id={target.id}
      ref={target.ref}
      tabIndex={target.tabIndex}
      className={cn(PANEL, "space-y-8", target.flash)}
    >
      {/* Interval section */}
      <div className="space-y-3">
        <div className="space-y-0.5">
          <h3 className="text-sm font-bold text-on-surface">How often</h3>
          <p className="text-xs sm:text-sm text-on-surface-variant text-pretty">
            How often Contrack takes a snapshot of the database by itself.
          </p>
        </div>

        {isIntervalEnv && (
          <p className="text-xs rounded-xl bg-surface-container-low p-3 text-on-surface-variant">
            Set by BACKUP_INTERVAL_HOURS in the environment.
          </p>
        )}

        {isLoading ? (
          <p className="text-sm text-on-surface-variant">Loading…</p>
        ) : (
          <div
            role="radiogroup"
            aria-label="Backup interval"
            className="grid grid-cols-1 sm:grid-cols-3 gap-2"
          >
            {BACKUP_INTERVAL_PRESETS.map((preset, index) => {
              const active = preset.hours === intervalCurrent;
              return (
                <button
                  key={preset.hours}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  tabIndex={radioTabIndex(
                    active,
                    index,
                    BACKUP_INTERVAL_PRESETS.some(
                      (p) => p.hours === intervalCurrent,
                    ),
                  )}
                  onKeyDown={radioKeys}
                  disabled={isIntervalEnv || save.isPending}
                  onClick={() =>
                    !active &&
                    !isIntervalEnv &&
                    save.mutate(
                      { backupIntervalHours: preset.hours },
                      {
                        onSuccess: (settings) =>
                          toast.success(
                            settings.backupIntervalHours === 0
                              ? "Scheduled backups turned off"
                              : `Backup interval set to ${settings.backupIntervalHours} hours`,
                          ),
                        onError: (error: Error) => toast.error(error.message),
                      },
                    )
                  }
                  className={presetClass(active, isIntervalEnv)}
                >
                  <RadioDot checked={active} className="mt-0.5" />
                  <span className="min-w-0">
                    <span className={presetLabel(active)}>{preset.label}</span>
                    <span className="block text-xs text-on-surface-variant mt-0.5">
                      {preset.hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Keep count section. Space sets it apart, not a line. */}
      <div className="space-y-3">
        <div className="space-y-0.5">
          <h3 className="text-sm font-bold text-on-surface">
            How many to keep
          </h3>
          <p className="text-xs sm:text-sm text-on-surface-variant text-pretty">
            When there are more, Contrack deletes the oldest.
          </p>
        </div>

        {isKeepEnv && (
          <p className="text-xs rounded-xl bg-surface-container-low p-3 text-on-surface-variant">
            Set by BACKUP_KEEP in the environment.
          </p>
        )}

        {isLoading ? (
          <p className="text-sm text-on-surface-variant">Loading…</p>
        ) : (
          <div
            role="radiogroup"
            aria-label="Backup retention count"
            className="grid grid-cols-1 sm:grid-cols-2 gap-2"
          >
            {BACKUP_KEEP_PRESETS.map((preset, index) => {
              const active = preset.count === keepCurrent;
              return (
                <button
                  key={preset.count}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  tabIndex={radioTabIndex(
                    active,
                    index,
                    BACKUP_KEEP_PRESETS.some((p) => p.count === keepCurrent),
                  )}
                  onKeyDown={radioKeys}
                  disabled={isKeepEnv || save.isPending}
                  onClick={() =>
                    !active &&
                    !isKeepEnv &&
                    save.mutate(
                      { backupKeep: preset.count },
                      {
                        onSuccess: (settings) =>
                          toast.success(
                            `Keeping up to ${settings.backupKeep} snapshots`,
                          ),
                        onError: (error: Error) => toast.error(error.message),
                      },
                    )
                  }
                  className={presetClass(active, isKeepEnv)}
                >
                  <RadioDot checked={active} className="mt-0.5" />
                  <span className="min-w-0">
                    <span className={presetLabel(active)}>{preset.label}</span>
                    <span className="block text-xs text-on-surface-variant mt-0.5">
                      {preset.hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── 6. Integrations ─────────────────────────────────────────────────────────

export const IntegrationsCard = () => {
  const { data, isLoading, isError, refetch } = useIntegrations();
  const update = useUpdateIntegrations();

  const [searxngInput, setSearxngInput] = useState<string | null>(null);
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [showGoogleSecret, setShowGoogleSecret] = useState(false);
  const [copiedRedirect, setCopiedRedirect] = useState(false);
  const [confirmRemoveGoogle, setConfirmRemoveGoogle] = useState(false);
  const clientIdInput = useRef<HTMLInputElement>(null);

  // Removing the client takes its Remove button away, and with it the
  // focus the dialog handed back. The keyboard lands on the empty client
  // ID field instead, where a new client starts.
  const googleConfigured = data?.googleOAuth?.configured === true;
  const wasConfigured = useRef(googleConfigured);
  useEffect(() => {
    if (
      wasConfigured.current &&
      !googleConfigured &&
      document.activeElement === document.body
    ) {
      clientIdInput.current?.focus();
    }
    wasConfigured.current = googleConfigured;
  }, [googleConfigured]);

  const target = useCardTarget("integrations");

  if (isError) return <ReadFailed onRetry={() => void refetch()} />;

  const searxng = data?.searxng;
  const googleOAuth = data?.googleOAuth;

  const isSearxngEnv = searxng?.source === "env";
  const searxngVal = searxngInput ?? searxng?.url ?? "";

  const isGoogleEnv = googleOAuth?.source === "env";
  const isGoogleConfigured = googleOAuth?.configured === true;
  const redirectUri = `${typeof window !== "undefined" ? window.location.origin : ""}/api/connectors/google/callback`;

  return (
    <div
      id={target.id}
      ref={target.ref}
      tabIndex={target.tabIndex}
      className={cn(PANEL, "space-y-8", target.flash)}
    >
      {/* SearXNG */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Globe className="w-5 h-5 text-primary" />
          <h3 className="font-bold text-sm text-on-surface">
            Self-hosted search (SearXNG)
          </h3>
        </div>

        <p className="text-sm text-on-surface-variant text-pretty">
          A fallback for web research that needs no cloud provider. Point
          Contrack at your own SearXNG instance and it will be used
          automatically whenever no connected provider offers web search.
        </p>

        {isSearxngEnv ? (
          <p className="text-xs rounded-xl bg-surface-container-low p-3 text-on-surface-variant">
            Set by SEARXNG_URL in the environment.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-col sm:flex-row gap-2">
              <label htmlFor="searxng-url" className="flex-1 min-w-0">
                <span className="sr-only">SearXNG base URL</span>
                <input
                  id="searxng-url"
                  type="url"
                  aria-label="SearXNG base URL"
                  value={searxngVal}
                  disabled={isLoading || update.isPending}
                  onChange={(e) => setSearxngInput(e.target.value)}
                  placeholder="http://searxng.local:8080"
                  className={KEY_INPUT}
                />
              </label>

              <button
                type="button"
                disabled={searxngInput === null || update.isPending}
                onClick={() =>
                  update.mutate(
                    { searxngUrl: searxngVal.trim() },
                    {
                      onSuccess: () => {
                        setSearxngInput(null);
                        toast.success("SearXNG endpoint saved");
                      },
                      onError: (err: Error) => toast.error(err.message),
                    },
                  )
                }
                className="btn-primary shrink-0"
              >
                Save
              </button>

              {searxng?.url && (
                <button
                  type="button"
                  disabled={update.isPending}
                  onClick={() =>
                    update.mutate(
                      { searxngUrl: "" },
                      {
                        onSuccess: () => {
                          setSearxngInput(null);
                          toast.success("SearXNG endpoint removed");
                        },
                        onError: (err: Error) => toast.error(err.message),
                      },
                    )
                  }
                  className="btn-secondary shrink-0 text-error"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Google OAuth. Space sets it apart from SearXNG: a line between
          sections is a failure of hierarchy (STYLE.md). */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-primary" />
            <h3 className="font-bold text-sm text-on-surface">
              Google OAuth client
            </h3>
          </div>
          {isGoogleConfigured && (
            <span className={CONFIGURED_CHIP}>
              <Check className="w-3.5 h-3.5" />
              Configured
            </span>
          )}
        </div>

        <p className="text-sm text-on-surface-variant text-pretty">
          Enables members to connect Google Workspace accounts to sync contacts,
          mail, and calendar events.
        </p>

        {/* Redirect URI copy box */}
        <div className="space-y-1.5">
          <span className={SETTINGS_LABEL}>Authorized redirect URI</span>
          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-surface-container-highest font-mono text-xs text-on-surface break-all select-all">
            <span className="flex-1 min-w-0">{redirectUri}</span>
            <button
              type="button"
              onClick={async () => {
                try {
                  await copyToClipboard(redirectUri);
                  setCopiedRedirect(true);
                  toast.success("Redirect URI copied");
                  setTimeout(() => setCopiedRedirect(false), 2000);
                } catch {
                  toast.error(CLIPBOARD_DENIED);
                }
              }}
              className="hit-area state-layer p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface transition-colors shrink-0"
              title="Copy redirect URI"
              aria-label="Copy redirect URI"
            >
              {copiedRedirect ? (
                <Check className="w-4 h-4 text-success" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>
          <p className="text-xs text-on-surface-variant text-pretty">
            Paste this exact URI into Google Cloud Console, under Authorized
            redirect URIs.
          </p>
        </div>

        {isGoogleEnv ? (
          <p className="text-xs rounded-xl bg-surface-container-low p-3 text-on-surface-variant">
            Set by GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in the
            environment.
          </p>
        ) : (
          <div className="space-y-3">
            {isGoogleConfigured && (
              <div className="text-xs text-on-surface-variant bg-surface-container-low p-3 rounded-xl space-y-1">
                <p>
                  <strong>Client ID:</strong>{" "}
                  <span className="font-mono text-on-surface">
                    {googleOAuth?.clientId}
                  </span>
                </p>
                <p>
                  <strong>Client secret:</strong>{" "}
                  <span className="font-mono text-on-surface">
                    {googleOAuth?.clientSecretPreview}
                  </span>
                </p>
              </div>
            )}

            <div className="space-y-2">
              <div>
                <label
                  htmlFor="google-client-id"
                  className={cn(SETTINGS_LABEL, "mb-1.5")}
                >
                  Client ID
                </label>
                <input
                  ref={clientIdInput}
                  id="google-client-id"
                  type="text"
                  aria-label="Google OAuth client ID"
                  value={googleClientId}
                  disabled={isLoading || update.isPending}
                  onChange={(e) => setGoogleClientId(e.target.value)}
                  placeholder={
                    isGoogleConfigured
                      ? "Enter new client ID to replace…"
                      : "123456789-...apps.googleusercontent.com"
                  }
                  className={KEY_INPUT}
                />
              </div>

              <div>
                <label
                  htmlFor="google-client-secret"
                  className={cn(SETTINGS_LABEL, "mb-1.5")}
                >
                  Client secret
                </label>
                <div className="relative">
                  <input
                    id="google-client-secret"
                    type={showGoogleSecret ? "text" : "password"}
                    aria-label="Google OAuth client secret"
                    value={googleClientSecret}
                    disabled={isLoading || update.isPending}
                    onChange={(e) => setGoogleClientSecret(e.target.value)}
                    placeholder={
                      isGoogleConfigured
                        ? "Enter new client secret to replace…"
                        : "GOCSPX-..."
                    }
                    className={cn(KEY_INPUT, "pr-10")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowGoogleSecret(!showGoogleSecret)}
                    className="state-layer absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md text-on-surface-variant hover:text-on-surface p-1 transition-colors"
                    title={showGoogleSecret ? "Hide secret" : "Show secret"}
                    aria-label={
                      showGoogleSecret ? "Hide secret" : "Show secret"
                    }
                  >
                    {showGoogleSecret ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2 pt-1">
                {isGoogleConfigured && (
                  <button
                    type="button"
                    disabled={update.isPending}
                    onClick={() => setConfirmRemoveGoogle(true)}
                    className="btn-secondary shrink-0 text-error mr-auto"
                  >
                    Remove
                  </button>
                )}

                <button
                  type="button"
                  disabled={
                    !googleClientId.trim() ||
                    !googleClientSecret.trim() ||
                    update.isPending
                  }
                  onClick={() =>
                    update.mutate(
                      {
                        googleOAuth: {
                          clientId: googleClientId.trim(),
                          clientSecret: googleClientSecret.trim(),
                        },
                      },
                      {
                        onSuccess: () => {
                          setGoogleClientId("");
                          setGoogleClientSecret("");
                          toast.success("Google OAuth credentials saved");
                        },
                        onError: (err: Error) => toast.error(err.message),
                      },
                    )
                  }
                  className="btn-primary shrink-0"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-xl bg-surface-container-low p-3 text-xs text-on-surface-variant space-y-1">
          <p className="font-semibold text-on-surface">
            Publishing status in Google Cloud
          </p>
          <p>
            • <strong>Google Workspace domains:</strong> Create an{" "}
            <em>Internal</em> OAuth app. No Google verification needed.
          </p>
          <p>
            • <strong>Personal Gmail:</strong> Create an <em>External</em> app
            and set it to <em>In production</em> (supports up to 100 users).
            Google will show an unverified app warning when signing in, which is
            normal for self-hosted instances.
          </p>
        </div>
      </div>

      {/* Every member's Google connectors stop with the client, so the
          removal asks first, with the red button and the verb repeated. */}
      <ConfirmDialog
        isOpen={confirmRemoveGoogle}
        onClose={() => setConfirmRemoveGoogle(false)}
        onConfirm={() =>
          update.mutate(
            { googleOAuth: null },
            {
              onSuccess: () => {
                setConfirmRemoveGoogle(false);
                setGoogleClientId("");
                setGoogleClientSecret("");
                toast.success("Google OAuth client removed");
              },
              onError: (err: Error) => toast.error(err.message),
            },
          )
        }
        title="Remove the Google OAuth client?"
        description="Every Google Workspace connector on this instance stops syncing until someone adds a client again."
        confirmLabel="Remove client"
        tone="danger"
        busy={update.isPending}
      />
    </div>
  );
};

// ─── Main View ───────────────────────────────────────────────────────────────

/** One section: a heading over its card. */
const Section = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <section>
    <h2 className={SETTINGS_SECTION_HEADING}>{title}</h2>
    {children}
  </section>
);

export const GeneralView = () => (
  <div className={cn(SETTINGS_PAGE, "space-y-8")}>
    <Section title="Name">
      <InstanceNameCard />
    </Section>
    <Section title="Who can join">
      <RegistrationCard />
    </Section>
    <Section title="Session length">
      <SessionLengthCard />
    </Section>
    <Section title="Trash">
      <TrashCard />
    </Section>
    <Section title="Backups">
      <BackupScheduleCard />
    </Section>
    <Section title="Integrations">
      <IntegrationsCard />
    </Section>
  </div>
);

export default GeneralView;
