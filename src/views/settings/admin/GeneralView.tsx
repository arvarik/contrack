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
import { normalizeIssuer } from "../../../../shared/contracts/admin";

const KEY_INPUT = cn(SETTINGS_INPUT, "font-mono");

/** A note under a row: the environment's lock, a warning, a way to fix it. */
const NOTE =
  "flex items-start gap-2 rounded-xl bg-surface-container-low p-3 text-xs text-on-surface-variant text-pretty";

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

const CHIP =
  "inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md";

/** An integration's chip, Configured or Not set up, and what follows it. */
const StatusLine = ({
  configured,
  children,
}: {
  configured: boolean;
  children?: React.ReactNode;
}) => (
  <div className="flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
    {configured ? (
      <span className={cn(CHIP, TONE_WASH.success)}>
        <Check className="w-3.5 h-3.5" aria-hidden="true" />
        Configured
      </span>
    ) : (
      <span className={cn(CHIP, TONE_WASH.warning)}>
        <TriangleAlert className="w-3.5 h-3.5" aria-hidden="true" />
        Not set up
      </span>
    )}
    {children}
  </div>
);

/**
 * The steps an admin follows at the provider. They stay open under `title`
 * until the integration is configured, and fold away under `foldedTitle`
 * after.
 */
const SetupSteps = ({
  configured,
  title,
  foldedTitle,
  children,
}: {
  configured: boolean;
  title: string;
  foldedTitle: string;
  children: React.ReactNode;
}) => {
  const steps = (
    <ol className="list-decimal pl-5 marker:font-semibold marker:text-on-surface-variant space-y-3 text-xs text-on-surface-variant text-pretty max-w-2xl">
      {children}
    </ol>
  );
  return configured ? (
    <details className="group rounded-xl bg-surface-container-low px-3 py-1 text-xs">
      <summary className="state-layer cursor-pointer list-none rounded-lg -mx-1.5 px-1.5 min-h-11 flex items-center gap-1.5 font-semibold text-on-surface">
        <ChevronRight
          className="w-4 h-4 shrink-0 transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        {foldedTitle}
      </summary>
      <div className="mt-1 mb-2">{steps}</div>
    </details>
  ) : (
    <div className="rounded-xl bg-surface-container-low p-3 space-y-3 text-xs">
      <p className="font-semibold text-on-surface">{title}</p>
      {steps}
    </div>
  );
};

/** A warning beside the step or the setting it is about. */
const WarningNote = ({ children }: { children: React.ReactNode }) => (
  <p role="note" className={NOTE}>
    <TriangleAlert
      className="w-3.5 h-3.5 shrink-0 mt-0.5 text-warning"
      aria-hidden="true"
    />
    <span>{children}</span>
  </p>
);

/** The saved values a row shows but does not edit. */
const SAVED_VALUES =
  "text-xs text-on-surface-variant bg-surface-container-low p-3 rounded-xl space-y-1";

const SavedValue = ({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) => (
  <p>
    {label} <span className={cn("text-on-surface", className)}>{children}</span>
  </p>
);

/** A labelled field for a key. A `secret` one hides its value until shown. */
const Field = ({
  label,
  onChange,
  secret = false,
  mono = true,
  ...input
}: Omit<React.ComponentProps<"input">, "onChange" | "type"> & {
  id: string;
  label: string;
  onChange: (value: string) => void;
  secret?: boolean;
  mono?: boolean;
}) => {
  const [shown, setShown] = useState(false);
  const field = (
    <input
      {...input}
      type={secret && !shown ? "password" : "text"}
      onChange={(event) => onChange(event.target.value)}
      className={cn(mono ? KEY_INPUT : SETTINGS_INPUT, secret && "pr-10")}
      {...NO_AUTOCORRECT}
    />
  );
  return (
    <div>
      <label htmlFor={input.id} className={cn(SETTINGS_LABEL, "mb-1.5")}>
        {label}
      </label>
      {secret ? (
        <div className="relative">
          {field}
          <button
            type="button"
            onClick={() => setShown(!shown)}
            className="hit-area state-layer absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md text-on-surface-variant hover:text-on-surface p-1 transition-colors"
            title={shown ? "Hide secret" : "Show secret"}
            aria-label={shown ? "Hide secret" : "Show secret"}
          >
            {shown ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
          </button>
        </div>
      ) : (
        field
      )}
    </div>
  );
};

/** Remove, while there is something to remove, and Save. */
const FormActions = ({
  onRemove,
  onSave,
  canSave,
  pending,
}: {
  onRemove: (() => void) | null;
  onSave: () => void;
  canSave: boolean;
  pending: boolean;
}) => (
  <div className="flex flex-wrap justify-end gap-2 pt-1">
    {onRemove && (
      <button
        type="button"
        disabled={pending}
        onClick={onRemove}
        className="btn-secondary shrink-0 text-error mr-auto"
      >
        Remove
      </button>
    )}
    <button
      type="button"
      disabled={!canSave || pending}
      onClick={onSave}
      className="btn-primary shrink-0"
    >
      Save
    </button>
  </div>
);

/**
 * The origin the server sends a provider in `redirectUri`, and whether the
 * browser opened Contrack at another one. Then the provider sends people back
 * to an address they did not start from.
 */
function origins(redirectUri: string | undefined) {
  const browser = window.location.origin;
  const server = redirectUri ? new URL(redirectUri).origin : browser;
  return { browser, server, mismatch: server !== browser };
}

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
  const [confirmRemove, setConfirmRemove] = useState(false);
  const clientIdInput = useRef<HTMLInputElement>(null);

  const { publicUrl } = useAuth();
  const google = data?.googleOAuth;
  const configured = google?.configured === true;
  const fromEnv = google?.source === "env";
  const busy = isLoading || update.isPending;

  // The address the server sends Google, which is PUBLIC_URL, or the host
  // and scheme it sees. Behind a proxy that hides its https, that can differ
  // from the browser's, and Google would refuse the sign-in as a mismatch.
  const redirectUri =
    google?.redirectUri ??
    `${window.location.origin}/api/connectors/google/callback`;
  const origin = origins(google?.redirectUri);

  return (
    <>
      <SettingRow
        id="google-oauth"
        title="Google OAuth client"
        description="Lets members connect Google accounts to sync contacts, mail and calendar. Created once in Google Cloud"
        below
      >
        <div className="space-y-3">
          <StatusLine configured={configured}>
            {configured && (
              <span>
                Members connect their accounts under{" "}
                <Link
                  to="/settings/connectors"
                  className={cn(TEXT_LINK, TOUCH_LINK)}
                >
                  Connectors
                </Link>
              </span>
            )}
          </StatusLine>

          {/* The five steps an admin follows in Google Cloud, in the order the
              console presents them. The redirect address sits in the step
              that uses it. */}
          <SetupSteps
            configured={configured}
            title="Create the client in Google Cloud"
            foldedTitle="How to create a client in Google Cloud"
          >
            <li>
              Open the{" "}
              <ConsoleLink href={CONSOLE.home}>
                Google Cloud Console
              </ConsoleLink>{" "}
              and create or pick a project
            </li>
            <li>
              In the{" "}
              <ConsoleLink href={CONSOLE.library}>API Library</ConsoleLink>,
              turn on People API, Gmail API and Google Calendar API
            </li>
            <li className="space-y-1">
              <p>
                Under{" "}
                <ConsoleLink href={CONSOLE.audience}>
                  Google Auth platform
                </ConsoleLink>
                , set the audience. For Google Workspace choose Internal. For
                personal Gmail choose External, then Publish app, or sign-ins
                expire after 7 days
              </p>
              <p>
                At sign-in Google warns that the app is unverified. Choose
                Continue (up to 100 accounts)
              </p>
            </li>
            <li className="space-y-1.5">
              <p>
                Under{" "}
                <ConsoleLink href={CONSOLE.credentials}>
                  Credentials
                </ConsoleLink>
                , create a Web application OAuth client ID and add this
                Authorized redirect URI
              </p>
              <RedirectUriBox uri={redirectUri} />
              <p>
                Google accepts localhost or an https domain, not a LAN IP.{" "}
                {publicUrl
                  ? "This address comes from PUBLIC_URL"
                  : "Set PUBLIC_URL when people reach Contrack through a reverse proxy"}
              </p>
              {origin.mismatch && (
                <WarningNote>
                  {publicUrl
                    ? `Google sends people back to ${origin.server}, from PUBLIC_URL. Open Contrack there to connect Google`
                    : `Your browser opened Contrack at ${origin.browser}, but the server sends Google ${origin.server}. Set PUBLIC_URL to the address people open`}
                </WarningNote>
              )}
            </li>
            <li>
              {fromEnv
                ? "Put the client ID and the client secret Google shows in GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET, where this server reads them"
                : "Paste the Client ID and Client secret below, then save"}
            </li>
          </SetupSteps>

          {fromEnv ? (
            <p className={NOTE}>
              Set by GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in
              the environment
            </p>
          ) : (
            <div className="space-y-2">
              {configured && (
                <div className={SAVED_VALUES}>
                  <SavedValue label="Client ID" className="font-mono">
                    {google?.clientId}
                  </SavedValue>
                  <SavedValue label="Client secret" className="font-mono">
                    {google?.clientSecretPreview}
                  </SavedValue>
                </div>
              )}
              <Field
                id="google-client-id"
                label="Client ID"
                ref={clientIdInput}
                value={clientId}
                disabled={busy}
                onChange={setClientId}
                placeholder={
                  configured
                    ? "A new client ID replaces the current one"
                    : "123456789-...apps.googleusercontent.com"
                }
              />
              <Field
                id="google-client-secret"
                label="Client secret"
                secret
                value={clientSecret}
                disabled={busy}
                onChange={setClientSecret}
                placeholder={
                  configured
                    ? "A new secret replaces the current one"
                    : "GOCSPX-..."
                }
              />
              <FormActions
                onRemove={configured ? () => setConfirmRemove(true) : null}
                canSave={clientId.trim() !== "" && clientSecret.trim() !== ""}
                pending={update.isPending}
                onSave={() =>
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
              />
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
        returnFocusRef={configured ? undefined : clientIdInput}
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
  // three credentials. Later, an empty secret keeps the saved one, as the
  // server does, only while the issuer and client ID name the same client.
  const changed =
    issuer.trim() !== (oidc?.issuer ?? "") ||
    clientId.trim() !== (oidc?.clientId ?? "") ||
    clientSecret.trim() !== "" ||
    name.trim() !== (oidc?.name ?? "") ||
    matchByEmail !== (oidc?.matchByEmail ?? false);
  const keepsSecret =
    configured &&
    normalizeIssuer(issuer) === normalizeIssuer(oidc?.issuer ?? "") &&
    clientId.trim() === (oidc?.clientId ?? "");
  const canSave =
    changed &&
    issuer.trim() !== "" &&
    clientId.trim() !== "" &&
    (keepsSecret || clientSecret.trim() !== "");

  // The provider sends the browser back to the address the server sends it,
  // and the flow cookie belongs to the host that started the flow.
  const { publicUrl } = useAuth();
  const origin = origins(oidc?.redirectUri);

  /** An edit clears the refusal of the last save. */
  const edit =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      setSaveError(null);
      set(value);
    };

  return (
    <>
      <SettingRow
        id="oidc"
        title="OpenID Connect (single sign-on)"
        description="Lets members sign in with your identity provider"
        below
      >
        <div className="space-y-3">
          <StatusLine configured={configured} />

          <SetupSteps
            configured={configured}
            title="Add the client in your identity provider"
            foldedTitle="How to add the provider"
          >
            <li>
              In your identity provider (Authentik, Keycloak, Pocket ID,
              Authelia…), create an OpenID Connect client of the confidential
              type
            </li>
            <li className="space-y-1.5">
              <p>Add this redirect URI</p>
              <RedirectUriBox uri={oidc?.redirectUri ?? ""} />
              {origin.mismatch && (
                <WarningNote>
                  {publicUrl
                    ? `The provider sends people back to ${origin.server}, from PUBLIC_URL. Signing in from another address fails. Open Contrack there`
                    : `Your browser opened Contrack at ${origin.browser}, but the server sends the provider ${origin.server}. Set PUBLIC_URL to the address people open`}
                </WarningNote>
              )}
            </li>
            <li>
              {fromEnv
                ? "Put the issuer, client ID and secret in OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET"
                : "Paste the issuer URL, client ID and secret below, then save"}
            </li>
          </SetupSteps>

          {fromEnv ? (
            <div className="space-y-2">
              {oidc?.envIssuerInvalid ? (
                <WarningNote>
                  OIDC_ISSUER must start with https:// (http only for
                  localhost), so single sign-on is off
                </WarningNote>
              ) : (
                <div className={SAVED_VALUES}>
                  <SavedValue label="Issuer" className="font-mono break-all">
                    {oidc?.issuer}
                  </SavedValue>
                  <SavedValue label="Client ID" className="font-mono">
                    {oidc?.clientId}
                  </SavedValue>
                  <SavedValue label="Client secret" className="font-mono">
                    {oidc?.clientSecretPreview}
                  </SavedValue>
                  <SavedValue label="Button name">{oidc?.name}</SavedValue>
                  <SavedValue label="Email matching">
                    {oidc?.matchByEmail ? "On" : "Off"}
                  </SavedValue>
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
                <div className={SAVED_VALUES}>
                  <SavedValue label="Client secret" className="font-mono">
                    {oidc?.clientSecretPreview}
                  </SavedValue>
                </div>
              )}
              <Field
                id="oidc-issuer"
                label="Issuer"
                ref={issuerInput}
                value={issuer}
                disabled={busy}
                onChange={edit(setIssuer)}
                placeholder="https://id.example.com"
              />
              <Field
                id="oidc-client-id"
                label="Client ID"
                value={clientId}
                disabled={busy}
                onChange={edit(setClientId)}
              />
              <Field
                id="oidc-client-secret"
                label="Client secret"
                secret
                value={clientSecret}
                disabled={busy}
                onChange={edit(setClientSecret)}
                placeholder={
                  keepsSecret ? "Leave empty to keep the current secret" : ""
                }
              />
              <Field
                id="oidc-name"
                label="Button name"
                mono={false}
                maxLength={40}
                value={name}
                disabled={busy}
                onChange={edit(setName)}
                placeholder="OpenID Connect"
              />
              <div className="flex items-start justify-between gap-3 min-h-11">
                <label
                  htmlFor="oidc-match-by-email"
                  className="text-sm text-on-surface"
                >
                  Accounts with the same verified email can sign in
                  <span className="block text-xs text-on-surface-variant">
                    Off: members link the provider under Account → Sign-in
                    methods first. On: a sign-in reaches only an account whose
                    email Contrack trusts, from setup, an admin, an invitation
                    to that address or a mailed link. A member who changes their
                    own email loses that trust. Turn this on only when the
                    provider verifies addresses that people cannot choose
                    themselves
                  </span>
                </label>
                <Switch
                  id="oidc-match-by-email"
                  checked={matchByEmail}
                  onChange={edit(setMatchByEmail)}
                  label="Accounts with the same verified email can sign in"
                  disabled={busy}
                />
              </div>
              {saveError && (
                <p role="alert" className="text-xs text-error text-pretty">
                  {saveError}
                </p>
              )}
              <FormActions
                onRemove={configured ? () => setConfirmRemove(true) : null}
                canSave={canSave}
                pending={update.isPending}
                onSave={() => {
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
                      onError: (error: Error) => setSaveError(errorText(error)),
                    },
                  );
                }}
              />
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
                setSaveError(null);
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
        returnFocusRef={configured ? undefined : issuerInput}
        tone="danger"
        busy={update.isPending}
      />
    </>
  );
};

/** A row that reads the integrations, or says that they did not load. */
const IntegrationRow = ({ children }: { children: React.ReactNode }) => {
  const { isError, refetch } = useIntegrations();
  if (isError)
    return (
      <LoadFailed
        what="these settings"
        onRetry={() => void refetch()}
        level={3}
      />
    );
  return <>{children}</>;
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
            <IntegrationRow>
              <OidcRow />
            </IntegrationRow>
          </Section>
          <Section title="Data">
            <Data data={data} />
          </Section>
        </>
      )}
      <Section title="Integrations" id="integrations">
        <AddressLookups />
        <IntegrationRow>
          <GoogleRow />
        </IntegrationRow>
      </Section>
    </div>
  );
};

export default GeneralView;
