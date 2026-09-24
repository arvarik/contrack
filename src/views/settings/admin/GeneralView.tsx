/**
 * GeneralView — the settings that belong to the instance, not to a person.
 *
 * Four sections, each a heading over a card of rows:
 *
 *   1. Instance: its name.
 *   2. Sign-in: whether anyone can create an account, sign in by emailed
 *      link, and how long a sign-in lasts.
 *   3. Data: how long Trash keeps a contact, and the backup schedule.
 *   4. Integrations: self-hosted search and the Google OAuth client.
 *
 * Every row is a `SettingRow`, so each one is a search result's target
 * (`#name`, `#registration`, `#session-length`, `#trash`, `#backups`) and
 * flashes when one lands on it. A choice among a few values is a
 * `ChoiceGroup`: the four sets of tiles here were four copies of one
 * radio group. A value the environment sets shows as a locked group with
 * one line naming the variable. The page used to repeat each section's
 * heading as the card's first sentence, and to close most cards with a
 * paragraph of its own.
 */
import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Check, Copy, Eye, EyeOff, TriangleAlert } from "lucide-react";
import {
  useInstanceSettings,
  useUpdateInstanceSettings,
  useIntegrations,
  useUpdateIntegrations,
  type InstanceSettings,
} from "../../../api/admin";
import { TONE_WASH } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import { copyToClipboard, CLIPBOARD_DENIED } from "../../../lib/clipboard";
import { Switch } from "../../../components/ui/Switch";
import { ChoiceGroup, type Choice } from "../../../components/ui/ChoiceGroup";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { SettingRow } from "../SettingRow";
import {
  SETTINGS_CARD,
  SETTINGS_INPUT,
  SETTINGS_LABEL,
  SETTINGS_PAGE,
  SETTINGS_SECTION_HEADING,
} from "../layout";

/** A key or a URL in the Integrations card. */
const KEY_INPUT = cn(SETTINGS_INPUT, "font-mono");

/** A note under a row: the environment's lock, a warning, a way to fix it. */
const NOTE =
  "flex items-start gap-2 rounded-xl bg-surface-container-low p-3 text-xs text-on-surface-variant text-pretty";

/** The "Configured" chip beside an integration's name. */
const CONFIGURED_CHIP = cn(
  "inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md",
  TONE_WASH.success,
);

type InstancePatch = Parameters<
  ReturnType<typeof useUpdateInstanceSettings>["mutate"]
>[0];

/** One save of the instance's settings, with its toast. */
function useSaveInstance() {
  const save = useUpdateInstanceSettings();
  const run = (
    patch: InstancePatch,
    message: (settings: InstanceSettings) => string,
  ) =>
    save.mutate(patch, {
      onSuccess: (settings) => toast.success(message(settings)),
      onError: (error: Error) => toast.error(error.message),
    });
  return { run, pending: save.isPending };
}

/** "1 day", "30 days". */
const days = (count: number) => `${count} ${count === 1 ? "day" : "days"}`;

/** One section: a heading over its card. */
const Section = ({
  title,
  id,
  children,
}: {
  title: string;
  id?: string;
  children: React.ReactNode;
}) => (
  <section aria-label={title}>
    <h2 className={SETTINGS_SECTION_HEADING}>{title}</h2>
    <div id={id} className={SETTINGS_CARD}>
      {children}
    </div>
  </section>
);

/**
 * A choice among a few values, under its title: the tiles, and a line when
 * the environment sets the value or the value matches no tile.
 */
function ChoiceRow({
  id,
  title,
  description,
  value,
  options,
  onChange,
  pending,
  envVariable,
  columns = "sm:grid-cols-2",
  footnote,
  format,
}: {
  id: string;
  title: string;
  description: string;
  value: number | undefined;
  options: readonly Choice<number | undefined>[];
  onChange: (value: number) => void;
  pending: boolean;
  /** The variable that sets the value, when the environment does. */
  envVariable?: string;
  columns?: string;
  footnote?: string;
  /** The value in words, for one that matches no tile: "45 days". */
  format: (value: number) => string;
}) {
  const custom =
    value !== undefined && !options.some((option) => option.value === value);
  return (
    <SettingRow id={id} title={title} description={description} below>
      <div className="space-y-2">
        {envVariable && (
          <p className={NOTE}>Set by {envVariable} in the environment</p>
        )}
        <ChoiceGroup
          label={title}
          value={value}
          options={options}
          onChange={(next) => next !== undefined && onChange(next)}
          pending={pending}
          locked={Boolean(envVariable)}
          className={columns}
        />
        {custom && (
          <p className="text-xs text-on-surface-variant">
            It is set to {format(value)} now. Choosing one above replaces it
          </p>
        )}
        {footnote && (
          <p className="text-xs text-on-surface-variant text-pretty">
            {footnote}
          </p>
        )}
      </div>
    </SettingRow>
  );
}

/** Shown in place of settings whose values could not be read. */
const ReadFailed = ({ onRetry }: { onRetry: () => void }) => (
  <div className="space-y-3">
    <p className="flex items-start gap-2 text-sm text-on-surface text-pretty">
      <TriangleAlert className="w-4 h-4 text-warning shrink-0 mt-0.5" />
      These settings did not load, so their values are unknown. Nothing has
      changed
    </p>
    <button type="button" onClick={onRetry} className="btn-secondary">
      Try again
    </button>
  </div>
);

// ─── 1. Instance ─────────────────────────────────────────────────────────────

const InstanceName = ({ data }: { data: InstanceSettings | undefined }) => {
  const save = useUpdateInstanceSettings();
  const [draft, setDraft] = useState<string | null>(null);
  const stored = data?.instanceName ?? "";
  const max = data?.instanceNameMax ?? 60;
  const value = draft ?? stored;
  const dirty = value.trim() !== stored;

  return (
    <SettingRow
      id="name"
      title="Instance name"
      description="Shown in the browser tab, the account menu and on the sign-in screen, which anyone who can reach this instance sees"
      below
    >
      <form
        className="flex flex-col sm:flex-row gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!dirty) return;
          save.mutate(
            { instanceName: value.trim() },
            {
              onSuccess: (settings) => {
                setDraft(null);
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
        <input
          id="instance-name"
          type="text"
          aria-label="Instance name"
          value={value}
          maxLength={max}
          disabled={!data || save.isPending}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Contrack"
          autoComplete="off"
          className={cn(SETTINGS_INPUT, "flex-1 min-w-0")}
        />
        <button
          type="submit"
          disabled={!dirty || save.isPending}
          className="btn-primary shrink-0"
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </form>
      {/* The count shows near the limit, where it helps. */}
      {value.length > max - 10 && (
        <p className="mt-2 text-xs text-on-surface-variant tabular-nums">
          {value.length} of {max}
        </p>
      )}
    </SettingRow>
  );
};

// ─── 2. Sign-in ──────────────────────────────────────────────────────────────

const TTL_PRESETS: readonly Choice<number | undefined>[] = [
  { value: 1, label: "1 day", hint: "Exposed to the internet" },
  { value: 7, label: "1 week", hint: "A shared or portable machine" },
  { value: 30, label: "30 days", hint: "Default" },
  { value: 365, label: "1 year", hint: "A private machine only" },
];

const SignIn = ({ data }: { data: InstanceSettings | undefined }) => {
  const { run, pending } = useSaveInstance();
  const open = data?.registrationOpen === true;
  const magicLink = data?.magicLinkSignIn === true;
  const mailReady = data?.mailConfigured === true;

  return (
    <>
      <SettingRow
        id="registration"
        title="Anyone can create an account"
        description={
          <>
            Adds a Create one link to the sign-in screen. A new account is a
            member and starts empty
            {open && (
              <span className={cn(NOTE, "mt-2 bg-warning/10 text-on-surface")}>
                <TriangleAlert className="w-4 h-4 text-warning shrink-0" />
                Anyone who can reach this instance can make an account on it. On
                a server open to the internet, send invitations instead
              </span>
            )}
          </>
        }
        inline
      >
        <Switch
          checked={open}
          label="Anyone can create an account"
          disabled={!data || pending}
          onChange={() =>
            run({ registrationOpen: !open }, (settings) =>
              settings.registrationOpen
                ? "Anyone who reaches the sign-in screen can now create an account"
                : "Only an invitation creates an account now",
            )
          }
        />
      </SettingRow>

      <SettingRow
        id="magic-link"
        title="Sign in by emailed link"
        description={
          <>
            Members can sign in with a link, sent to their email, that works
            once
            {data && !mailReady && (
              <span className={cn(NOTE, "mt-2")}>
                <span>
                  The link goes by email, so set up{" "}
                  <Link
                    to="/settings/admin/mail"
                    className="font-semibold text-primary underline underline-offset-2"
                  >
                    outgoing mail
                  </Link>{" "}
                  first
                </span>
              </span>
            )}
          </>
        }
        inline
      >
        <Switch
          checked={magicLink}
          label="Sign in by emailed link"
          disabled={!data || pending || !mailReady}
          onChange={() =>
            run({ magicLinkSignIn: !magicLink }, (settings) =>
              settings.magicLinkSignIn
                ? "Sign in by emailed link is on"
                : "Sign in by emailed link is off",
            )
          }
        />
      </SettingRow>

      <ChoiceRow
        id="session-length"
        title="Session length"
        description="How long a sign-in lasts before Contrack asks for the password again, on every account"
        value={data?.sessionTtlDays}
        options={TTL_PRESETS}
        pending={!data || pending}
        onChange={(next) =>
          run(
            { sessionTtlDays: next },
            (settings) => `New sign-ins last ${days(settings.sessionTtlDays)}`,
          )
        }
        footnote="A change applies to new sign-ins. To end a session now, disable the account or reset its password"
        format={days}
      />
    </>
  );
};

// ─── 3. Data ─────────────────────────────────────────────────────────────────

const TRASH_PRESETS: readonly Choice<number | undefined>[] = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days", hint: "Default" },
  { value: 90, label: "90 days" },
  { value: 365, label: "1 year" },
];

const BACKUP_INTERVAL_PRESETS: readonly Choice<number | undefined>[] = [
  { value: 0, label: "Off", hint: "Only when you take one" },
  { value: 6, label: "6 hours" },
  { value: 12, label: "12 hours" },
  { value: 24, label: "24 hours", hint: "Default" },
  { value: 168, label: "7 days" },
];

const BACKUP_KEEP_PRESETS: readonly Choice<number | undefined>[] = [
  { value: 3, label: "3 snapshots" },
  { value: 7, label: "7 snapshots", hint: "Default" },
  { value: 14, label: "14 snapshots" },
  { value: 30, label: "30 snapshots" },
];

const Data = ({ data }: { data: InstanceSettings | undefined }) => {
  const { run, pending } = useSaveInstance();
  const waiting = !data || pending;
  return (
    <>
      <ChoiceRow
        id="trash"
        title="Trash"
        description="How long a deleted contact stays in Trash, where it can be restored"
        value={data?.trashRetentionDays}
        options={TRASH_PRESETS}
        columns="sm:grid-cols-2 xl:grid-cols-4"
        pending={waiting}
        envVariable={
          data?.trashRetentionDaysSource === "env"
            ? "TRASH_RETENTION_DAYS"
            : undefined
        }
        onChange={(next) =>
          run(
            { trashRetentionDays: next },
            (settings) =>
              `Trash keeps a contact for ${days(settings.trashRetentionDays ?? next)}`,
          )
        }
        footnote="A shorter time deletes the older contacts in Trash at the next daily cleanup"
        format={days}
      />
      <ChoiceRow
        id="backups"
        title="Backups"
        description="How often Contrack takes a snapshot of the whole database"
        value={data?.backupIntervalHours}
        options={BACKUP_INTERVAL_PRESETS}
        columns="sm:grid-cols-3"
        pending={waiting}
        envVariable={
          data?.backupIntervalHoursSource === "env"
            ? "BACKUP_INTERVAL_HOURS"
            : undefined
        }
        onChange={(next) =>
          run({ backupIntervalHours: next }, (settings) =>
            settings.backupIntervalHours === 0
              ? "Scheduled backups are off"
              : `A snapshot every ${settings.backupIntervalHours} hours`,
          )
        }
        format={(hours) => `every ${hours} hours`}
      />
      <ChoiceRow
        id="backup-keep"
        title="Snapshots to keep"
        description="Past this many, Contrack deletes the oldest"
        value={data?.backupKeep}
        options={BACKUP_KEEP_PRESETS}
        columns="sm:grid-cols-2 xl:grid-cols-4"
        pending={waiting}
        envVariable={
          data?.backupKeepSource === "env" ? "BACKUP_KEEP" : undefined
        }
        onChange={(next) =>
          run(
            { backupKeep: next },
            (settings) => `Keeping up to ${settings.backupKeep} snapshots`,
          )
        }
        format={(count) => `${count} snapshots`}
      />
    </>
  );
};

// ─── 4. Integrations ─────────────────────────────────────────────────────────

const SearxngRow = () => {
  const { data, isLoading } = useIntegrations();
  const update = useUpdateIntegrations();
  const [input, setInput] = useState<string | null>(null);
  const searxng = data?.searxng;
  const value = input ?? searxng?.url ?? "";

  const save = (url: string, message: string) =>
    update.mutate(
      { searxngUrl: url },
      {
        onSuccess: () => {
          setInput(null);
          toast.success(message);
        },
        onError: (error: Error) => toast.error(error.message),
      },
    );

  return (
    <SettingRow
      id="searxng"
      title="Self-hosted search (SearXNG)"
      description="Web research uses your own SearXNG when no AI provider offers web search"
      below
    >
      {searxng?.source === "env" ? (
        <p className={NOTE}>Set by SEARXNG_URL in the environment</p>
      ) : (
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            id="searxng-url"
            type="url"
            aria-label="SearXNG base URL"
            value={value}
            disabled={isLoading || update.isPending}
            onChange={(event) => setInput(event.target.value)}
            placeholder="http://searxng.local:8080"
            className={cn(KEY_INPUT, "flex-1 min-w-0")}
          />
          <button
            type="button"
            disabled={input === null || update.isPending}
            onClick={() => save(value.trim(), "SearXNG endpoint saved")}
            className="btn-primary shrink-0"
          >
            Save
          </button>
          {searxng?.url && (
            <button
              type="button"
              disabled={update.isPending}
              onClick={() => save("", "SearXNG endpoint removed")}
              className="btn-secondary shrink-0 text-error"
            >
              Remove
            </button>
          )}
        </div>
      )}
    </SettingRow>
  );
};

const GoogleRow = () => {
  const { data, isLoading } = useIntegrations();
  const update = useUpdateIntegrations();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const clientIdInput = useRef<HTMLInputElement>(null);

  const google = data?.googleOAuth;
  const configured = google?.configured === true;

  // Removing the client takes its Remove button away, and with it the
  // focus the dialog handed back. The keyboard lands on the empty client
  // ID field instead, where a new client starts.
  const wasConfigured = useRef(configured);
  useEffect(() => {
    if (
      wasConfigured.current &&
      !configured &&
      document.activeElement === document.body
    ) {
      clientIdInput.current?.focus();
    }
    wasConfigured.current = configured;
  }, [configured]);

  const redirectUri = `${window.location.origin}/api/connectors/google/callback`;

  return (
    <>
      <SettingRow
        id="google-oauth"
        title="Google OAuth client"
        description="Lets members connect a Google account to sync contacts, mail and calendar events"
        below
      >
        <div className="space-y-3">
          {configured && (
            <span className={CONFIGURED_CHIP}>
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              Configured
            </span>
          )}

          <div className="space-y-1.5">
            <span className={SETTINGS_LABEL}>Authorized redirect URI</span>
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-surface-container-highest font-mono text-xs text-on-surface break-all select-all">
              <span className="flex-1 min-w-0">{redirectUri}</span>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await copyToClipboard(redirectUri);
                    setCopied(true);
                    toast.success("Redirect URI copied");
                    setTimeout(() => setCopied(false), 2000);
                  } catch {
                    toast.error(CLIPBOARD_DENIED);
                  }
                }}
                className="hit-area state-layer p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface transition-colors shrink-0"
                title="Copy redirect URI"
                aria-label="Copy redirect URI"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-success" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
            <p className="text-xs text-on-surface-variant text-pretty">
              Paste it into the client in Google Cloud Console, under Authorized
              redirect URIs
            </p>
          </div>

          {google?.source === "env" ? (
            <p className={NOTE}>
              Set by GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in
              the environment
            </p>
          ) : (
            <div className="space-y-2">
              {configured && (
                <div className="text-xs text-on-surface-variant bg-surface-container-low p-3 rounded-xl space-y-1">
                  <p>
                    Client ID{" "}
                    <span className="font-mono text-on-surface">
                      {google?.clientId}
                    </span>
                  </p>
                  <p>
                    Client secret{" "}
                    <span className="font-mono text-on-surface">
                      {google?.clientSecretPreview}
                    </span>
                  </p>
                </div>
              )}
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
                  value={clientId}
                  disabled={isLoading || update.isPending}
                  onChange={(event) => setClientId(event.target.value)}
                  placeholder={
                    configured
                      ? "A new client ID replaces the current one"
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
                    type={showSecret ? "text" : "password"}
                    value={clientSecret}
                    disabled={isLoading || update.isPending}
                    onChange={(event) => setClientSecret(event.target.value)}
                    placeholder={
                      configured
                        ? "A new secret replaces the current one"
                        : "GOCSPX-..."
                    }
                    className={cn(KEY_INPUT, "pr-10")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret(!showSecret)}
                    className="state-layer absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md text-on-surface-variant hover:text-on-surface p-1 transition-colors"
                    title={showSecret ? "Hide secret" : "Show secret"}
                    aria-label={showSecret ? "Hide secret" : "Show secret"}
                  >
                    {showSecret ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2 pt-1">
                {configured && (
                  <button
                    type="button"
                    disabled={update.isPending}
                    onClick={() => setConfirmRemove(true)}
                    className="btn-secondary shrink-0 text-error mr-auto"
                  >
                    Remove
                  </button>
                )}
                <button
                  type="button"
                  disabled={
                    !clientId.trim() || !clientSecret.trim() || update.isPending
                  }
                  onClick={() =>
                    update.mutate(
                      {
                        googleOAuth: {
                          clientId: clientId.trim(),
                          clientSecret: clientSecret.trim(),
                        },
                      },
                      {
                        onSuccess: () => {
                          setClientId("");
                          setClientSecret("");
                          toast.success("Google OAuth client saved");
                        },
                        onError: (error: Error) => toast.error(error.message),
                      },
                    )
                  }
                  className="btn-primary shrink-0"
                >
                  Save
                </button>
              </div>
            </div>
          )}

          <div className="rounded-xl bg-surface-container-low p-3 text-xs text-on-surface-variant space-y-1.5 text-pretty">
            <p className="font-semibold text-on-surface">
              Which kind of app to create in Google Cloud
            </p>
            <p>
              For a Google Workspace domain, an Internal app. Google does not
              need to verify it
            </p>
            <p>
              For personal Gmail, an External app set to In production. It takes
              up to 100 users, and Google warns that the app is unverified at
              sign-in, which is normal for a self-hosted server
            </p>
          </div>
        </div>
      </SettingRow>

      {/* Every member's Google connectors stop with the client, so the
          removal asks first, with the red button and the verb repeated. */}
      <ConfirmDialog
        isOpen={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={() =>
          update.mutate(
            { googleOAuth: null },
            {
              onSuccess: () => {
                setConfirmRemove(false);
                setClientId("");
                setClientSecret("");
                toast.success("Google OAuth client removed");
              },
              onError: (error: Error) => toast.error(error.message),
            },
          )
        }
        title="Remove the Google OAuth client?"
        description="Every Google Workspace connector on this instance stops syncing until someone adds a client again"
        confirmLabel="Remove client"
        tone="danger"
        busy={update.isPending}
      />
    </>
  );
};

const Integrations = () => {
  const { isError, refetch } = useIntegrations();
  if (isError) return <ReadFailed onRetry={() => void refetch()} />;
  return (
    <>
      <SearxngRow />
      <GoogleRow />
    </>
  );
};

// ─── Main View ───────────────────────────────────────────────────────────────

export const GeneralView = () => {
  const { data, isError, refetch } = useInstanceSettings();
  return (
    <div className={cn(SETTINGS_PAGE, "space-y-8")}>
      {isError ? (
        <div className={SETTINGS_CARD}>
          <ReadFailed onRetry={() => void refetch()} />
        </div>
      ) : (
        <>
          <Section title="Instance">
            <InstanceName data={data} />
          </Section>
          <Section title="Sign-in">
            <SignIn data={data} />
          </Section>
          <Section title="Data">
            <Data data={data} />
          </Section>
        </>
      )}
      <Section title="Integrations" id="integrations">
        <Integrations />
      </Section>
    </div>
  );
};

export default GeneralView;
