/**
 * The settings that belong to the instance, not to a person: Instance,
 * Sign-in, Data and Integrations. Every row is a `SettingRow`, so a search
 * result can land on it by id and flash it. A value the environment sets
 * shows as a locked group with one line that names the variable.
 */
import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  Check,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  TriangleAlert,
} from "lucide-react";
import {
  useInstanceSettings,
  useUpdateInstanceSettings,
  useIntegrations,
  useUpdateIntegrations,
  type InstanceSettings,
} from "../../../api/admin";
import { useAddressLookups, useSetAddressLookups } from "../../../api/geo";
import { TEXT_LINK, TONE_WASH } from "../../../lib/styles";
import { cn, errorText } from "../../../lib/utils";
import { NO_AUTOCORRECT } from "../../../components/ui/SearchField";
import { copyToClipboard, CLIPBOARD_DENIED } from "../../../lib/clipboard";
import { Switch } from "../../../components/ui/Switch";
import { ChoiceGroup, type Choice } from "../../../components/ui/ChoiceGroup";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { RowsUnderHeading, SettingRow } from "../SettingRow";
import {
  SETTINGS_CARD,
  SETTINGS_INPUT,
  SETTINGS_LABEL,
  SETTINGS_PAGE,
  SETTINGS_SECTION_HEADING,
  TOUCH_LINK,
} from "../layout";
import { LoadFailed } from "../../../components/ui/LoadFailed";
import { useAuth } from "../../../components/auth/AuthGate";

const KEY_INPUT = cn(SETTINGS_INPUT, "font-mono");

/** A note under a row: the environment's lock, a warning, a way to fix it. */
const NOTE =
  "flex items-start gap-2 rounded-xl bg-surface-container-low p-3 text-xs text-on-surface-variant text-pretty";

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
      onError: (error: Error) =>
        toast.error(`Could not save setting: ${errorText(error)}`),
    });
  return { run, pending: save.isPending };
}

/** "1 day", "30 days". */
const days = (count: number) => `${count} ${count === 1 ? "day" : "days"}`;

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
      <RowsUnderHeading>{children}</RowsUnderHeading>
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

// Instance

const InstanceName = ({ data }: { data: InstanceSettings | undefined }) => {
  const save = useUpdateInstanceSettings();
  const [draft, setDraft] = useState<string | null>(null);
  const stored = data?.instanceName ?? "";
  const max = data?.instanceNameMax ?? 60;
  const value = draft ?? stored;
  const dirty = value.trim() !== stored;

  useEffect(() => {
    setDraft(null);
  }, [stored]);

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
              onError: (error: Error) =>
                toast.error(
                  `Could not save instance name: ${errorText(error)}`,
                ),
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
          {...NO_AUTOCORRECT}
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

// Sign-in

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
  // A mailed link points at PUBLIC_URL. Without it the sign-in page never
  // offers the link, so the switch cannot turn on.
  const linksReady = data?.mailLinksReady === true;

  return (
    <>
      <SettingRow
        id="registration"
        title="Anyone can create an account"
        description={
          <>
            Adds a “Create one” link to the sign-in screen. New accounts start
            empty as members
            {open && (
              <span className={cn(NOTE, "mt-2 bg-warning/10 text-on-surface")}>
                <TriangleAlert className="w-4 h-4 text-warning shrink-0" />
                Anyone who can reach this instance can create an account. On a
                public server, send invitations instead
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
            Members can sign in with a one-time link sent to their email
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
            {data && mailReady && !linksReady && (
              <span className={cn(NOTE, "mt-2")}>
                A link needs the address people open Contrack at. Set PUBLIC_URL
                on the server first
              </span>
            )}
          </>
        }
        inline
      >
        <Switch
          checked={magicLink}
          label="Sign in by emailed link"
          // Off stays possible, so a switch left on can still be turned off.
          disabled={!data || pending || (!magicLink && !linksReady)}
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
        description="How long a sign-in lasts before Contrack asks for a password again"
        value={data?.sessionTtlDays}
        options={TTL_PRESETS}
        pending={!data || pending}
        onChange={(next) =>
          run(
            { sessionTtlDays: next },
            (settings) => `New sign-ins last ${days(settings.sessionTtlDays)}`,
          )
        }
        footnote="Applies to new sign-ins. To end an active session now, disable the account or reset its password"
        format={days}
      />
    </>
  );
};

// Data

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
        footnote="A shorter time deletes older contacts in Trash at the next daily cleanup"
        format={days}
      />
      <ChoiceRow
        id="backups"
        title="Backups"
        description="How often Contrack takes a snapshot of the database"
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
        description="Past this limit, Contrack deletes the oldest snapshot"
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

// Integrations

/** The map's address lookups, which send each address to Nominatim. */
const AddressLookups = () => {
  const { data, isError, refetch } = useAddressLookups();
  const save = useSetAddressLookups();
  if (isError)
    return (
      <LoadFailed
        what="these settings"
        onRetry={() => void refetch()}
        level={3}
      />
    );
  const on = data ? !data.off : false;
  return (
    <SettingRow
      id="address-lookups"
      title="Look up addresses for the map"
      description={
        <>
          Sends each contact&apos;s address to{" "}
          {data?.host ?? "OpenStreetMap's Nominatim"} to place its pin. Off, no
          address leaves the server
          {data?.lockedByEnv && (
            <span className={cn(NOTE, "mt-2")}>
              Set by GEOCODING_DISABLED in the environment
            </span>
          )}
        </>
      }
      inline
    >
      <Switch
        checked={on}
        label="Look up addresses for the map"
        disabled={!data || save.isPending || data.lockedByEnv}
        onChange={() =>
          save.mutate(on, {
            onSuccess: (state) =>
              toast.success(
                state.off
                  ? "Address lookups are off. No address leaves the server"
                  : "Address lookups are on",
              ),
            onError: (error: Error) =>
              toast.error(
                `Could not update address lookups: ${errorText(error)}`,
              ),
          })
        }
      />
    </SettingRow>
  );
};

/** The Google Cloud Console pages the steps name. */
const CONSOLE = {
  home: "https://console.cloud.google.com/",
  library: "https://console.cloud.google.com/apis/library",
  audience: "https://console.cloud.google.com/auth/audience",
  credentials: "https://console.cloud.google.com/apis/credentials",
};

const ConsoleLink = ({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer"
    className={cn(TEXT_LINK, TOUCH_LINK)}
  >
    {children}
  </a>
);

const NOT_SET_UP_CHIP = cn(
  "inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md",
  TONE_WASH.warning,
);

/** A redirect URI the admin pastes into the provider, with a copy button. */
const RedirectUriBox = ({ uri }: { uri: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 p-2.5 rounded-xl bg-surface-container-highest font-mono text-xs text-on-surface break-all select-all">
      <span className="flex-1 min-w-0">{uri}</span>
      <button
        type="button"
        onClick={async () => {
          try {
            await copyToClipboard(uri);
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
  );
};

export const GoogleRow = () => {
  const { data, isLoading } = useIntegrations();
  const update = useUpdateIntegrations();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const clientIdInput = useRef<HTMLInputElement>(null);

  const { publicUrl } = useAuth();
  const google = data?.googleOAuth;
  const configured = google?.configured === true;
  const fromEnv = google?.source === "env";

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

  // The address the server sends Google, which is PUBLIC_URL, or the host
  // and scheme it sees. Behind a proxy that hides its https, that can differ
  // from the browser's, and Google would refuse the sign-in as a mismatch.
  const browserOrigin = window.location.origin;
  const redirectUri =
    google?.redirectUri ?? `${browserOrigin}/api/connectors/google/callback`;
  const serverOrigin = new URL(redirectUri).origin;
  const mismatch = serverOrigin !== browserOrigin;

  // The five steps an admin follows in Google Cloud, in the order the console
  // presents them. The redirect address sits in the step that uses it. They
  // stay open until a client is saved, and fold away after.
  const steps = (
    <ol className="list-decimal pl-5 marker:font-semibold marker:text-on-surface-variant space-y-3 text-xs text-on-surface-variant text-pretty max-w-2xl">
      <li>
        Open the{" "}
        <ConsoleLink href={CONSOLE.home}>Google Cloud Console</ConsoleLink> and
        create or pick a project
      </li>
      <li>
        In the <ConsoleLink href={CONSOLE.library}>API Library</ConsoleLink>,
        turn on People API, Gmail API and Google Calendar API
      </li>
      <li className="space-y-1">
        <p>
          Under{" "}
          <ConsoleLink href={CONSOLE.audience}>
            Google Auth platform
          </ConsoleLink>
          , set the audience. For Google Workspace choose Internal. For personal
          Gmail choose External, then Publish app, or sign-ins expire after 7
          days
        </p>
        <p>
          At sign-in Google warns that the app is unverified. Choose Continue
          (up to 100 accounts)
        </p>
      </li>
      <li className="space-y-1.5">
        <p>
          Under{" "}
          <ConsoleLink href={CONSOLE.credentials}>Credentials</ConsoleLink>,
          create a Web application OAuth client ID and add this Authorized
          redirect URI
        </p>
        <RedirectUriBox uri={redirectUri} />
        <p>
          Google accepts localhost or an https domain, not a LAN IP.{" "}
          {publicUrl
            ? "This address comes from PUBLIC_URL"
            : "Set PUBLIC_URL when people reach Contrack through a reverse proxy"}
        </p>
        {mismatch && (
          <p role="note" className={NOTE}>
            <TriangleAlert
              className="w-3.5 h-3.5 shrink-0 mt-0.5 text-warning"
              aria-hidden="true"
            />
            <span>
              {publicUrl
                ? `Google sends people back to ${serverOrigin}, from PUBLIC_URL. Open Contrack there to connect Google`
                : `Your browser opened Contrack at ${browserOrigin}, but the server sends Google ${serverOrigin}. Set PUBLIC_URL to the address people open`}
            </span>
          </p>
        )}
      </li>
      <li>
        {fromEnv
          ? "Put the client ID and the client secret Google shows in GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET, where this server reads them"
          : "Paste the Client ID and Client secret below, then save"}
      </li>
    </ol>
  );

  return (
    <>
      <SettingRow
        id="google-oauth"
        title="Google OAuth client"
        description="Lets members connect Google accounts to sync contacts, mail and calendar. Created once in Google Cloud"
        below
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
            {configured ? (
              <>
                <span className={CONFIGURED_CHIP}>
                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                  Configured
                </span>
                <span>
                  Members connect their accounts under{" "}
                  <Link
                    to="/settings/connectors"
                    className={cn(TEXT_LINK, TOUCH_LINK)}
                  >
                    Connectors
                  </Link>
                </span>
              </>
            ) : (
              <span className={NOT_SET_UP_CHIP}>
                <TriangleAlert className="w-3.5 h-3.5" aria-hidden="true" />
                Not set up
              </span>
            )}
          </div>

          {configured ? (
            <details className="group rounded-xl bg-surface-container-low px-3 py-1 text-xs">
              <summary className="state-layer cursor-pointer list-none rounded-lg -mx-1.5 px-1.5 min-h-11 flex items-center gap-1.5 font-semibold text-on-surface">
                <ChevronRight
                  className="w-4 h-4 shrink-0 transition-transform group-open:rotate-90"
                  aria-hidden="true"
                />
                How to create a client in Google Cloud
              </summary>
              <div className="mt-1 mb-2">{steps}</div>
            </details>
          ) : (
            <div className="rounded-xl bg-surface-container-low p-3 space-y-3 text-xs">
              <p className="font-semibold text-on-surface">
                Create the client in Google Cloud
              </p>
              {steps}
            </div>
          )}

          {fromEnv ? (
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
                  {...NO_AUTOCORRECT}
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
                    {...NO_AUTOCORRECT}
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret(!showSecret)}
                    className="hit-area state-layer absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md text-on-surface-variant hover:text-on-surface p-1 transition-colors"
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
                        onError: (error: Error) =>
                          toast.error(
                            `Could not save Google OAuth client: ${errorText(error)}`,
                          ),
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
              onError: (error: Error) =>
                toast.error(
                  `Could not remove Google OAuth client: ${errorText(error)}`,
                ),
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

export const OidcRow = () => {
  const { data, isLoading } = useIntegrations();
  const update = useUpdateIntegrations();
  const oidc = data?.oidc;
  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [name, setName] = useState(oidc?.name ?? "");
  const [matchByEmail, setMatchByEmail] = useState(oidc?.matchByEmail ?? false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const issuerInput = useRef<HTMLInputElement>(null);
  const configured = oidc?.configured === true;
  const fromEnv = oidc?.source === "env";
  const busy = isLoading || update.isPending;

  // The saved values arrive after the first render. Fill the fields from
  // them once, when they do, as the mail row does for SMTP.
  const loaded = useRef(false);
  useEffect(() => {
    if (oidc && !loaded.current) {
      loaded.current = true;
      setIssuer(oidc.issuer ?? "");
      setClientId(oidc.clientId ?? "");
      setName(oidc.name ?? "");
      setMatchByEmail(oidc.matchByEmail);
    }
  }, [oidc]);

  // Save is on for any change from what is saved. A first setup needs all
  // three credentials; later, an empty secret keeps the saved one.
  const changed =
    issuer.trim() !== (oidc?.issuer ?? "") ||
    clientId.trim() !== (oidc?.clientId ?? "") ||
    clientSecret.trim() !== "" ||
    name.trim() !== (oidc?.name ?? "") ||
    matchByEmail !== (oidc?.matchByEmail ?? false);
  const canSave =
    changed &&
    issuer.trim() !== "" &&
    clientId.trim() !== "" &&
    (configured || clientSecret.trim() !== "");

  // The provider sends the browser back to the address the server sends it,
  // and the flow cookie belongs to the host that started the flow.
  const { publicUrl } = useAuth();
  const browserOrigin = window.location.origin;
  const serverOrigin = oidc?.redirectUri
    ? new URL(oidc.redirectUri).origin
    : browserOrigin;
  const mismatch = serverOrigin !== browserOrigin;

  // As in GoogleRow: Remove takes the focus with it, so hand it to the first
  // field.
  const wasConfigured = useRef(configured);
  useEffect(() => {
    if (
      wasConfigured.current &&
      !configured &&
      document.activeElement === document.body
    ) {
      issuerInput.current?.focus();
    }
    wasConfigured.current = configured;
  }, [configured]);

  const steps = (
    <ol className="list-decimal pl-5 marker:font-semibold marker:text-on-surface-variant space-y-3 text-xs text-on-surface-variant text-pretty max-w-2xl">
      <li>
        In your identity provider (Authentik, Keycloak, Pocket ID, Authelia…),
        create an OpenID Connect client of the confidential type
      </li>
      <li className="space-y-1.5">
        <p>Add this redirect URI</p>
        <RedirectUriBox uri={oidc?.redirectUri ?? ""} />
        {mismatch && (
          <p role="note" className={NOTE}>
            <TriangleAlert
              className="w-3.5 h-3.5 shrink-0 mt-0.5 text-warning"
              aria-hidden="true"
            />
            <span>
              {publicUrl
                ? `The provider sends people back to ${serverOrigin}, from PUBLIC_URL. Signing in from another address fails. Open Contrack there`
                : `Your browser opened Contrack at ${browserOrigin}, but the server sends the provider ${serverOrigin}. Set PUBLIC_URL to the address people open`}
            </span>
          </p>
        )}
      </li>
      <li>
        {fromEnv
          ? "Put the issuer, client ID and secret in OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET"
          : "Paste the issuer URL, client ID and secret below, then save"}
      </li>
    </ol>
  );

  const field = (
    id: string,
    label: string,
    value: string,
    set: (value: string) => void,
    placeholder: string,
    mono = true,
    ref?: React.Ref<HTMLInputElement>,
    maxLength?: number,
  ) => (
    <div>
      <label htmlFor={id} className={cn(SETTINGS_LABEL, "mb-1.5")}>
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        type="text"
        value={value}
        disabled={busy}
        maxLength={maxLength}
        onChange={(event) => {
          setSaveError(null);
          set(event.target.value);
        }}
        placeholder={placeholder}
        className={mono ? KEY_INPUT : SETTINGS_INPUT}
        {...NO_AUTOCORRECT}
      />
    </div>
  );

  return (
    <>
      <SettingRow
        id="oidc"
        title="OpenID Connect (single sign-on)"
        description="Lets members sign in with your identity provider"
        below
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
            {configured ? (
              <span className={CONFIGURED_CHIP}>
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                Configured
              </span>
            ) : (
              <span className={NOT_SET_UP_CHIP}>
                <TriangleAlert className="w-3.5 h-3.5" aria-hidden="true" />
                Not set up
              </span>
            )}
          </div>

          {configured ? (
            <details className="group rounded-xl bg-surface-container-low px-3 py-1 text-xs">
              <summary className="state-layer cursor-pointer list-none rounded-lg -mx-1.5 px-1.5 min-h-11 flex items-center gap-1.5 font-semibold text-on-surface">
                <ChevronRight
                  className="w-4 h-4 shrink-0 transition-transform group-open:rotate-90"
                  aria-hidden="true"
                />
                How to add the provider
              </summary>
              <div className="mt-1 mb-2">{steps}</div>
            </details>
          ) : (
            <div className="rounded-xl bg-surface-container-low p-3 space-y-3 text-xs">
              <p className="font-semibold text-on-surface">
                Add the client in your identity provider
              </p>
              {steps}
            </div>
          )}

          {fromEnv ? (
            <div className="space-y-2">
              {oidc?.envIssuerInvalid ? (
                <p role="note" className={NOTE}>
                  <TriangleAlert
                    className="w-3.5 h-3.5 shrink-0 mt-0.5 text-warning"
                    aria-hidden="true"
                  />
                  <span>
                    OIDC_ISSUER must start with https:// (http only for
                    localhost), so single sign-on is off
                  </span>
                </p>
              ) : (
                <div className="text-xs text-on-surface-variant bg-surface-container-low p-3 rounded-xl space-y-1">
                  <p>
                    Issuer{" "}
                    <span className="font-mono text-on-surface break-all">
                      {oidc?.issuer}
                    </span>
                  </p>
                  <p>
                    Client ID{" "}
                    <span className="font-mono text-on-surface">
                      {oidc?.clientId}
                    </span>
                  </p>
                  <p>
                    Client secret{" "}
                    <span className="font-mono text-on-surface">
                      {oidc?.clientSecretPreview}
                    </span>
                  </p>
                  <p>
                    Button name{" "}
                    <span className="text-on-surface">{oidc?.name}</span>
                  </p>
                  <p>
                    Email matching{" "}
                    <span className="text-on-surface">
                      {oidc?.matchByEmail ? "On" : "Off"}
                    </span>
                  </p>
                </div>
              )}
              <p className={NOTE}>
                Set by OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET,
                OIDC_NAME and OIDC_MATCH_BY_EMAIL in the environment
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {configured && (
                <div className="text-xs text-on-surface-variant bg-surface-container-low p-3 rounded-xl">
                  <p>
                    Client secret{" "}
                    <span className="font-mono text-on-surface">
                      {oidc?.clientSecretPreview}
                    </span>
                  </p>
                </div>
              )}
              {field(
                "oidc-issuer",
                "Issuer",
                issuer,
                setIssuer,
                "https://id.example.com",
                true,
                issuerInput,
              )}
              {field("oidc-client-id", "Client ID", clientId, setClientId, "")}
              <div>
                <label
                  htmlFor="oidc-client-secret"
                  className={cn(SETTINGS_LABEL, "mb-1.5")}
                >
                  Client secret
                </label>
                <div className="relative">
                  <input
                    id="oidc-client-secret"
                    type={showSecret ? "text" : "password"}
                    value={clientSecret}
                    disabled={busy}
                    onChange={(event) => {
                      setSaveError(null);
                      setClientSecret(event.target.value);
                    }}
                    placeholder={
                      configured ? "Leave empty to keep the current secret" : ""
                    }
                    className={cn(KEY_INPUT, "pr-10")}
                    {...NO_AUTOCORRECT}
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret(!showSecret)}
                    className="hit-area state-layer absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md text-on-surface-variant hover:text-on-surface p-1 transition-colors"
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
              {field(
                "oidc-name",
                "Button name",
                name,
                setName,
                "OpenID Connect",
                false,
                undefined,
                40,
              )}
              <div className="flex items-start justify-between gap-3 min-h-11">
                <label
                  htmlFor="oidc-match-by-email"
                  className="text-sm text-on-surface"
                >
                  Accounts with the same verified email can sign in
                  <span className="block text-xs text-on-surface-variant">
                    Off: members link the provider under Account → Sign-in
                    methods first. Contrack does not verify the email on an
                    account, and members can change their own. Turn this on only
                    when every account&apos;s email is trusted, and the provider
                    verifies addresses that people cannot choose themselves
                  </span>
                </label>
                <Switch
                  id="oidc-match-by-email"
                  checked={matchByEmail}
                  onChange={(value) => {
                    setSaveError(null);
                    setMatchByEmail(value);
                  }}
                  label="Accounts with the same verified email can sign in"
                  disabled={busy}
                />
              </div>
              {saveError && (
                <p role="alert" className="text-xs text-error text-pretty">
                  {saveError}
                </p>
              )}
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
                  disabled={!canSave || update.isPending}
                  onClick={() => {
                    setSaveError(null);
                    update.mutate(
                      {
                        oidc: {
                          issuer: issuer.trim(),
                          clientId: clientId.trim(),
                          ...(clientSecret.trim() && {
                            clientSecret: clientSecret.trim(),
                          }),
                          name: name.trim() || "OpenID Connect",
                          matchByEmail,
                        },
                      },
                      {
                        onSuccess: (saved) => {
                          setClientSecret("");
                          setName(saved.oidc.name ?? "");
                          toast.success("OpenID Connect provider saved");
                        },
                        onError: (error: Error) =>
                          setSaveError(errorText(error)),
                      },
                    );
                  }}
                  className="btn-primary shrink-0"
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </div>
      </SettingRow>

      <ConfirmDialog
        isOpen={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={() =>
          update.mutate(
            { oidc: null },
            {
              onSuccess: () => {
                setConfirmRemove(false);
                setIssuer("");
                setClientId("");
                setClientSecret("");
                setName("");
                setMatchByEmail(false);
                toast.success("OpenID Connect provider removed");
              },
              onError: (error: Error) =>
                toast.error(
                  `Could not remove the provider: ${errorText(error)}`,
                ),
            },
          )
        }
        title="Remove the OpenID Connect provider?"
        description="Members can no longer sign in with it. Their linked sign-ins stay and work again when a provider with the same issuer is added"
        confirmLabel="Remove provider"
        tone="danger"
        busy={update.isPending}
      />
    </>
  );
};

const OidcIntegration = () => {
  const { isError, refetch } = useIntegrations();
  if (isError)
    return (
      <LoadFailed
        what="these settings"
        onRetry={() => void refetch()}
        level={3}
      />
    );
  return <OidcRow />;
};

const Integrations = () => {
  const { isError, refetch } = useIntegrations();
  if (isError)
    return (
      <LoadFailed
        what="these settings"
        onRetry={() => void refetch()}
        level={3}
      />
    );
  return <GoogleRow />;
};

export const GeneralView = () => {
  const { data, isError, refetch } = useInstanceSettings();
  return (
    <div className={cn(SETTINGS_PAGE, "space-y-8")}>
      {isError ? (
        <div className={SETTINGS_CARD}>
          <LoadFailed what="these settings" onRetry={() => void refetch()} />
        </div>
      ) : (
        <>
          <Section title="Instance">
            <InstanceName data={data} />
          </Section>
          <Section title="Sign-in">
            <SignIn data={data} />
            <OidcIntegration />
          </Section>
          <Section title="Data">
            <Data data={data} />
          </Section>
        </>
      )}
      <Section title="Integrations" id="integrations">
        <AddressLookups />
        <Integrations />
      </Section>
    </div>
  );
};

export default GeneralView;
