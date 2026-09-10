/**
 * AccountSettings — the signed-in account: profile, password, devices, tokens.
 *
 * Cards in the order people actually need them: who you are (changed most
 * often), your password (changed rarely but urgently), where you are signed
 * in (read when something feels wrong), and the tokens your scripts carry
 * (created once and then forgotten about, which is why they are listed).
 *
 * Each card saves independently. A single page-wide Save would mean typing a
 * new password and a new display name are the same commit, which is both
 * surprising and a worse failure — a rejected password should not discard a
 * name change.
 *
 * On an un-gated instance this page explains why there is nothing to manage
 * rather than hiding, because arriving at a blank page you were linked to is
 * more confusing than being told the link does not apply yet.
 */
import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  KeyRound,
  Loader2,
  LogOut,
  Monitor,
  Plus,
  ServerCog,
  ShieldOff,
  Terminal,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import {
  changePassword,
  createApiToken,
  fetchApiTokens,
  fetchSessions,
  revokeApiToken,
  revokeOtherSessions,
  updateProfile,
  type ApiTokenSummary,
  type CreatedApiToken,
  type SessionSummary,
} from "../../api/auth";
import { useAuth } from "../../components/auth/AuthGate";
import { Modal } from "../../components/ui/Modal";
import { Badge, type BadgeTone } from "../../components/ui/Badge";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { SecretReveal } from "../../components/ui/SecretReveal";
import { CARD, SECTION_HEADING, DANGER_BTN } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { tileDelay } from "../../lib/motion";

const MIN_PASSWORD_LENGTH = 8;

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

const GroupHeading = ({ children }: { children: React.ReactNode }) => (
  <h2 className={cn(SECTION_HEADING, "px-1 mb-2")}>{children}</h2>
);

/**
 * A labelled input that can also be wrong.
 *
 * The `error` half matches `AuthField` on the sign-in screens deliberately.
 * This component used to route validation messages through `hint`, so "These
 * don't match." rendered in the same muted grey as "At least 8 characters" —
 * indistinguishable from ordinary help, with no `aria-invalid` for anybody
 * not reading the colour. The identical sentence on the forced-password
 * screen was red and announced.
 */
const Field = ({
  id,
  label,
  hint,
  error,
  ...props
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
} & React.InputHTMLAttributes<HTMLInputElement>) => (
  <div className="space-y-1.5">
    <label htmlFor={id} className="block text-xs font-bold text-on-surface">
      {label}
    </label>
    <input
      id={id}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
      className={cn(
        "w-full px-4 py-3 rounded-xl bg-surface-container-highest",
        "text-base sm:text-sm",
        "outline-none focus-visible:ring-2 focus-visible:ring-primary",
        error && "ring-2 ring-error",
      )}
      {...props}
    />
    {error ? (
      <p id={`${id}-error`} className="text-xs text-error">
        {error}
      </p>
    ) : hint ? (
      <p id={`${id}-hint`} className="text-xs text-on-surface-variant">
        {hint}
      </p>
    ) : null}
  </div>
);

const SaveButton = ({
  busy,
  disabled,
  children,
}: {
  busy: boolean;
  disabled: boolean;
  children: React.ReactNode;
}) => (
  <button
    type="submit"
    disabled={disabled || busy}
    className={cn(
      "px-5 rounded-xl bg-primary text-on-primary font-bold text-sm",
      // 44 px on a phone, 40 from sm. `py-2.5` alone computes to exactly 40,
      // which is under the floor STYLE.md marks REQUIRED.
      "min-h-[44px] sm:min-h-0 py-3 sm:py-2.5",
      "flex items-center justify-center gap-2 transition-opacity hover:opacity-90",
      "disabled:bg-surface-container-high disabled:text-on-surface-variant",
      "disabled:cursor-not-allowed disabled:hover:opacity-100",
    )}
  >
    {busy && <Loader2 className="w-4 h-4 animate-spin" />}
    {children}
  </button>
);

/** Turn a User-Agent into something a person can recognise their laptop in. */
function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const browser = /Firefox\//.test(userAgent)
    ? "Firefox"
    : /Edg\//.test(userAgent)
      ? "Edge"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Browser";
  const platform = /iPhone|iPad/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Mac OS X/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "";
  return platform ? `${browser} on ${platform}` : browser;
}

function formatWhen(iso: string): string {
  const date = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

const ProfileCard = () => {
  const { user, refresh } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [username, setUsername] = useState(user?.username ?? "");
  const [email, setEmail] = useState(user?.email ?? "");

  const dirty =
    displayName !== (user?.displayName ?? "") ||
    username !== (user?.username ?? "") ||
    email !== (user?.email ?? "");

  const save = useMutation({
    mutationFn: () => updateProfile({ displayName, username, email }),
    onSuccess: async () => {
      await refresh();
      toast.success("Profile updated");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty) save.mutate();
      }}
      className={cn(CARD, "p-4 sm:p-6 space-y-4")}
    >
      <Field
        id="account-displayName"
        label="Display name"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        autoComplete="name"
      />
      <Field
        id="account-username"
        label="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        hint="You can sign in with this or your email."
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <Field
        id="account-email"
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <div className="flex justify-end">
        <SaveButton busy={save.isPending} disabled={!dirty}>
          Save changes
        </SaveButton>
      </div>
    </form>
  );
};

const PasswordCard = () => {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const mismatch = confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < MIN_PASSWORD_LENGTH;
  const ready =
    current.length > 0 &&
    next.length >= MIN_PASSWORD_LENGTH &&
    next === confirm;

  const save = useMutation({
    mutationFn: () =>
      changePassword({ currentPassword: current, newPassword: next }),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setConfirm("");
      // Worth saying out loud: the server ends every other session on a
      // password change, and someone who does not know that will wonder why
      // their phone signed out.
      toast.success("Password changed — other devices have been signed out");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) save.mutate();
      }}
      className={cn(CARD, "p-4 sm:p-6 space-y-4")}
    >
      <Field
        id="account-current-password"
        label="Current password"
        type="password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        autoComplete="current-password"
      />
      <Field
        id="account-new-password"
        label="New password"
        type="password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        error={
          tooShort
            ? `Use at least ${MIN_PASSWORD_LENGTH} characters.`
            : undefined
        }
        autoComplete="new-password"
      />
      <Field
        id="account-confirm-password"
        label="Confirm new password"
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={mismatch ? "These don't match." : undefined}
        autoComplete="new-password"
      />
      <div className="flex justify-end">
        <SaveButton busy={save.isPending} disabled={!ready}>
          <KeyRound className="w-4 h-4" />
          Change password
        </SaveButton>
      </div>
    </form>
  );
};

const SessionRow = ({ session }: { session: SessionSummary }) => (
  <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
    <span className="shrink-0 w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
      <Monitor className="w-[18px] h-[18px]" />
    </span>
    <div className="flex-1 min-w-0">
      <p className="text-sm font-bold text-on-surface">
        {describeDevice(session.userAgent)}
        {session.current && (
          <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-primary">
            This device
          </span>
        )}
      </p>
      <p className="text-xs text-on-surface-variant">
        Last used {formatWhen(session.lastSeenAt)}
      </p>
    </div>
  </li>
);

const SessionsCard = () => {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["auth", "sessions"],
    queryFn: fetchSessions,
    staleTime: 30_000,
  });

  const revoke = useMutation({
    mutationFn: revokeOtherSessions,
    onSuccess: ({ revoked }) => {
      queryClient.invalidateQueries({ queryKey: ["auth", "sessions"] });
      toast.success(
        revoked === 0
          ? "No other devices were signed in"
          : `Signed out ${revoked} other ${revoked === 1 ? "device" : "devices"}`,
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const sessions = data?.sessions ?? [];
  const others = sessions.filter((s) => !s.current).length;

  return (
    <div className={cn(CARD, "p-4 sm:p-6 space-y-4")}>
      {isLoading ? (
        <p className="text-sm text-on-surface-variant">Loading devices…</p>
      ) : (
        <ul className="divide-y divide-surface-container">
          {sessions.map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
        </ul>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => revoke.mutate()}
          disabled={others === 0 || revoke.isPending}
          className={cn(
            DANGER_BTN,
            "flex items-center gap-2 text-sm",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {revoke.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ShieldOff className="w-4 h-4" />
          )}
          Sign out other devices
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// API tokens
// ---------------------------------------------------------------------------

/**
 * How long a new token should last.
 *
 * Presets rather than a number field, and "Never" is not the default. A token
 * with no expiry is a credential that outlives the reason it was made, and
 * the script it was made for is usually still running long after the person
 * who wrote it stopped thinking about it.
 */
const TOKEN_EXPIRY_PRESETS = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
  { days: null, label: "Never" },
] as const;

type TokenState = "active" | "revoked" | "expired";

/** What a token is doing now, from the two timestamps that can end it. */
export function tokenState(
  token: Pick<ApiTokenSummary, "revokedAt" | "expiresAt">,
  now: number = Date.now(),
): TokenState {
  if (token.revokedAt) return "revoked";
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= now)
    return "expired";
  return "active";
}

const TOKEN_TONES: Record<TokenState, BadgeTone> = {
  active: "success",
  revoked: "danger",
  expired: "neutral",
};

const TokenStateBadge = ({ state }: { state: TokenState }) => (
  <Badge tone={TOKEN_TONES[state]}>{state}</Badge>
);

const TokenRow = ({
  token,
  onRevoke,
}: {
  token: ApiTokenSummary;
  onRevoke: () => void;
}) => {
  const state = tokenState(token);
  return (
    <li className="flex items-start gap-3 px-4 sm:px-6 py-3.5 hover:bg-surface-container-low transition-colors">
      <span className="shrink-0 w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
        <Terminal className="w-[18px] h-[18px]" />
      </span>
      <div className="flex-1 min-w-0">
        <p className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-bold text-on-surface truncate">
            {token.name}
          </span>
          <TokenStateBadge state={state} />
        </p>
        <p className="text-xs text-on-surface-variant font-mono truncate">
          {token.tokenPrefix}…
        </p>
        <p className="text-xs text-on-surface-variant mt-0.5">
          {token.lastUsedAt
            ? `Last used ${formatWhen(token.lastUsedAt)}`
            : "Never used"}
          {token.expiresAt && state !== "revoked" && (
            <>
              {" · "}
              {state === "expired" ? "Expired" : "Expires"}{" "}
              {formatWhen(token.expiresAt)}
            </>
          )}
        </p>
      </div>
      {state === "active" && (
        <button
          type="button"
          onClick={onRevoke}
          className={cn(
            "shrink-0 px-3 py-1.5 rounded-xl text-xs font-bold",
            "min-h-[44px] sm:min-h-0 sm:py-1.5",
            "text-error bg-red-500/10 hover:bg-red-500/20 transition-colors",
          )}
        >
          Revoke
        </button>
      )}
    </li>
  );
};

/**
 * Create a token, and show it once.
 *
 * The dialog does not close on success. The plaintext is in that response and
 * nowhere else — the server holds only its SHA-256 — so closing the dialog
 * for the user would throw away the only copy that will ever exist.
 */
const CreateTokenModal = ({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) => {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<number | null>(90);
  const [created, setCreated] = useState<CreatedApiToken | null>(null);

  const create = useMutation({
    mutationFn: () => createApiToken({ name: name.trim(), expiresInDays }),
    onSuccess: (token) => {
      setCreated(token);
      queryClient.invalidateQueries({ queryKey: ["auth", "tokens"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const close = () => {
    onClose();
    // Reset after the dialog is gone, so the secret does not flash back into
    // view during the closing animation.
    window.setTimeout(() => {
      setName("");
      setExpiresInDays(90);
      setCreated(null);
      create.reset();
    }, 200);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={created ? "Your new token" : "Create a token"}
      size="md"
    >
      {created ? (
        <div className="space-y-4">
          <p className="text-sm text-on-surface-variant text-pretty">
            Give this to the script or MCP client as{" "}
            <code className="font-mono text-on-surface">
              Authorization: Bearer …
            </code>
            . It acts as your account and reaches only your data.
          </p>
          <SecretReveal value={created.token} label="Token" />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={close}
              className={cn(
                "px-5 rounded-xl bg-primary text-on-primary font-bold text-sm",
                "min-h-[44px] sm:min-h-0 py-3 sm:py-2.5",
                "hover:opacity-90 transition-opacity",
              )}
            >
              I've copied it
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
          className="space-y-4"
        >
          <Field
            id="token-name"
            label="What is it for"
            hint="Shown in this list. Name the machine or the script, not the person."
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder="Claude Desktop on the laptop"
            // The dialog opens with one field to fill in.
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
          <div className="space-y-1.5">
            <span className="block text-xs font-bold text-on-surface">
              Expires
            </span>
            <div
              role="radiogroup"
              aria-label="Expires"
              className="grid grid-cols-2 sm:grid-cols-4 gap-2"
            >
              {TOKEN_EXPIRY_PRESETS.map((preset) => {
                const active = preset.days === expiresInDays;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setExpiresInDays(preset.days)}
                    className={cn(
                      "px-3 py-3 sm:py-2.5 rounded-xl text-sm font-bold transition-colors",
                      active
                        ? "bg-primary/10 text-primary ring-2 ring-inset ring-primary"
                        : "bg-surface-container-highest text-on-surface hover:bg-surface-container-high",
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            {expiresInDays === null && (
              <p className="text-xs text-warning text-pretty">
                A token that never expires outlives the reason it was made.
                Prefer a date you will remember to renew.
              </p>
            )}
          </div>
          <div className="flex justify-end">
            <SaveButton busy={create.isPending} disabled={!name.trim()}>
              <Plus className="w-4 h-4" />
              Create token
            </SaveButton>
          </div>
        </form>
      )}
    </Modal>
  );
};

const ApiTokensCard = () => {
  const queryClient = useQueryClient();
  const { legacyTokenConfigured } = useAuth();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ApiTokenSummary | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["auth", "tokens"],
    queryFn: fetchApiTokens,
    staleTime: 30_000,
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeApiToken(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth", "tokens"] });
      setRevoking(null);
      toast.success("Token revoked");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const tokens = data?.tokens ?? [];

  return (
    <div className={cn(CARD, "p-0 overflow-hidden")}>
      <div className="px-4 sm:px-6 py-4 bg-surface-container-low space-y-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-on-surface-variant text-pretty max-w-prose">
            A token lets a script or an MCP client act as you, and reach only
            your data. Sign-in cookies cannot be used that way, which is what
            these are for.
          </p>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className={cn(
              "shrink-0 px-4 rounded-xl bg-primary text-on-primary",
              "min-h-[44px] sm:min-h-0 py-3 sm:py-2.5",
              "font-bold text-sm flex items-center gap-2",
              "hover:opacity-90 transition-opacity",
            )}
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Create token</span>
            <span className="sm:hidden">New</span>
          </button>
        </div>

        {/*
          The instance-wide environment token is a single credential that acts
          as the first admin for anybody who has it, and it is on its way out.
          Saying so here, next to the thing that replaces it, is the only place
          the operator will read it.
        */}
        {legacyTokenConfigured && (
          <div className="flex items-start gap-2.5 rounded-xl bg-amber-500/10 p-3">
            <TriangleAlert className="w-4 h-4 text-warning shrink-0 mt-0.5" />
            <p className="text-xs text-on-surface text-pretty">
              This instance still uses the environment{" "}
              <code className="font-mono">API_TOKEN</code>, which acts as the
              first administrator for anyone who holds it. Create a personal
              token, point your scripts at it, and remove the variable.
            </p>
          </div>
        )}
      </div>

      {isLoading ? (
        <p className="px-4 sm:px-6 py-6 text-sm text-on-surface-variant">
          Loading tokens…
        </p>
      ) : tokens.length === 0 ? (
        <p className="px-4 sm:px-6 py-6 text-sm text-on-surface-variant text-pretty">
          No tokens yet. Create one when you connect an MCP client or a script.
        </p>
      ) : (
        <ul>
          {tokens.map((token) => (
            <TokenRow
              key={token.id}
              token={token}
              onRevoke={() => setRevoking(token)}
            />
          ))}
        </ul>
      )}

      <CreateTokenModal isOpen={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog
        isOpen={revoking !== null}
        onClose={() => setRevoking(null)}
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
        busy={revoke.isPending}
        title="Revoke this token?"
        confirmLabel="Revoke token"
        description={
          <>
            <p>
              <strong className="text-on-surface">{revoking?.name}</strong>{" "}
              stops working immediately. Anything using it — a script, an MCP
              client — starts failing on its next request.
            </p>
            <p>
              The entry stays in this list, marked revoked, so you can see what
              happened later.
            </p>
          </>
        }
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const AccountSettings = () => {
  const { user, authRequired, isAdmin, signOut } = useAuth();

  if (!authRequired || !user) {
    return (
      <div className="p-4 sm:p-6 md:p-10 max-w-4xl mx-auto pb-28 md:pb-10">
        <div className={cn(CARD, "p-6 space-y-2 text-center")}>
          <span className="w-12 h-12 rounded-2xl bg-surface-container-high text-on-surface-variant flex items-center justify-center mx-auto">
            <UserRound className="w-6 h-6" />
          </span>
          <h2 className="font-bold text-on-surface">No account needed</h2>
          <p className="text-sm text-on-surface-variant text-pretty max-w-prose mx-auto">
            This Contrack isn't asking anyone to sign in, so there's no account
            to manage. Set <code>AUTH_REQUIRED=true</code> on the server to
            require a sign-in — you'll be walked through creating an account,
            and everything already here comes with you.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 md:p-10 max-w-4xl mx-auto space-y-8 pb-28 md:pb-10">
      <section className="tile-enter" style={{ animationDelay: tileDelay(0) }}>
        <GroupHeading>Profile</GroupHeading>
        <ProfileCard />
      </section>

      <section className="tile-enter" style={{ animationDelay: tileDelay(1) }}>
        <GroupHeading>Password</GroupHeading>
        <PasswordCard />
      </section>

      <section className="tile-enter" style={{ animationDelay: tileDelay(2) }}>
        <GroupHeading>Signed in on</GroupHeading>
        <SessionsCard />
      </section>

      <section className="tile-enter" style={{ animationDelay: tileDelay(3) }}>
        <GroupHeading>API tokens</GroupHeading>
        <ApiTokensCard />
      </section>

      {/*
        Session length used to be a card here. It decides how long *everyone's*
        sign-in lasts, which stopped being a personal setting the moment an
        instance could have more than one account, so it lives with the other
        instance settings now. An admin gets a pointer rather than a silent
        disappearance; a member never had the ability and gets nothing.
      */}
      {isAdmin && (
        <section
          className="tile-enter"
          style={{ animationDelay: tileDelay(4) }}
        >
          <GroupHeading>Session length</GroupHeading>
          <div
            className={cn(
              CARD,
              "p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3",
            )}
          >
            <p className="text-sm text-on-surface-variant text-pretty">
              How long a sign-in lasts applies to every account on this
              instance, so it is set under Administration.
            </p>
            <Link
              to="/settings/admin/instance"
              className={cn(
                "shrink-0 inline-flex items-center justify-center gap-2",
                "px-5 min-h-[44px] sm:min-h-0 sm:py-2.5 rounded-xl font-bold text-sm",
                "bg-surface-container-high text-on-surface",
                "hover:bg-surface-container-highest transition-colors",
              )}
            >
              <ServerCog className="w-4 h-4" />
              Instance settings
            </Link>
          </div>
        </section>
      )}

      <section className="tile-enter" style={{ animationDelay: tileDelay(5) }}>
        <GroupHeading>Session</GroupHeading>
        <div
          className={cn(
            CARD,
            "p-4 sm:p-6 flex justify-between items-center gap-4",
          )}
        >
          <p className="text-sm text-on-surface-variant text-pretty">
            Sign out of Contrack on this device.
          </p>
          <button
            type="button"
            onClick={() => void signOut()}
            className={cn(
              "shrink-0 px-5 rounded-xl font-bold text-sm",
              "min-h-[44px] sm:min-h-0 py-3 sm:py-2.5",
              "bg-surface-container-high text-on-surface",
              "flex items-center justify-center gap-2 hover:bg-surface-container-highest transition-colors",
            )}
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </section>
    </div>
  );
};
