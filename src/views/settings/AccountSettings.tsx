/**
 * AccountSettings — the signed-in account: profile, password, devices.
 *
 * Three cards in the order people actually need them: who you are (changed
 * most often), your password (changed rarely but urgently), and where you are
 * signed in (read when something feels wrong).
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
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  KeyRound,
  Loader2,
  LogOut,
  Monitor,
  ShieldOff,
  UserRound,
} from "lucide-react";
import {
  changePassword,
  fetchSessions,
  revokeOtherSessions,
  updateProfile,
  fetchSessionPolicy,
  updateSessionPolicy,
  type SessionSummary,
} from "../../api/auth";
import { useAuth } from "../../components/auth/AuthGate";
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

const Field = ({
  id,
  label,
  hint,
  ...props
}: {
  id: string;
  label: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) => (
  <div className="space-y-1.5">
    <label htmlFor={id} className="block text-xs font-bold text-on-surface">
      {label}
    </label>
    <input
      id={id}
      aria-describedby={hint ? `${id}-hint` : undefined}
      className={cn(
        "w-full px-4 py-3 rounded-xl bg-surface-container-highest",
        "text-base sm:text-sm",
        "outline-none focus-visible:ring-2 focus-visible:ring-primary",
      )}
      {...props}
    />
    {hint && (
      <p id={`${id}-hint`} className="text-xs text-on-surface-variant">
        {hint}
      </p>
    )}
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
      "px-5 py-2.5 rounded-xl bg-primary text-on-primary font-bold text-sm",
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
        hint={
          tooShort
            ? `Use at least ${MIN_PASSWORD_LENGTH} characters.`
            : `At least ${MIN_PASSWORD_LENGTH} characters.`
        }
        autoComplete="new-password"
      />
      <Field
        id="account-confirm-password"
        label="Confirm new password"
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        hint={mismatch ? "These don't match." : undefined}
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

/**
 * How long a sign-in lasts.
 *
 * Offered as presets rather than a free number field: the meaningful choice is
 * "this machine is mine" versus "this thing is on the internet", and asking
 * someone to pick between 44 and 46 days is a question with no right answer.
 * The server still accepts any value in range, so a custom setting made
 * elsewhere is shown rather than silently snapped to a preset.
 */
const TTL_PRESETS = [
  { days: 1, label: "1 day", hint: "Exposed to the internet" },
  { days: 7, label: "1 week", hint: "Shared or portable machine" },
  { days: 30, label: "30 days", hint: "Default" },
  { days: 365, label: "1 year", hint: "Private machine only" },
] as const;

const SessionLengthCard = () => {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["auth", "session-policy"],
    queryFn: fetchSessionPolicy,
    staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: updateSessionPolicy,
    onSuccess: ({ sessionTtlDays }) => {
      queryClient.invalidateQueries({ queryKey: ["auth", "session-policy"] });
      toast.success(
        `New sign-ins will last ${sessionTtlDays === 1 ? "1 day" : `${sessionTtlDays} days`}`,
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const current = data?.sessionTtlDays ?? 30;
  const isCustom = !TTL_PRESETS.some((p) => p.days === current);

  return (
    <div className={cn(CARD, "p-4 sm:p-6 space-y-4")}>
      <p className="text-sm text-on-surface-variant text-pretty">
        How long a sign-in lasts before Contrack asks for your password again.
      </p>

      {isLoading ? (
        <p className="text-sm text-on-surface-variant">Loading…</p>
      ) : (
        <div
          role="radiogroup"
          aria-label="Session length"
          className="grid grid-cols-1 sm:grid-cols-2 gap-2"
        >
          {TTL_PRESETS.map((preset) => {
            const active = preset.days === current;
            return (
              <button
                key={preset.days}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={save.isPending}
                onClick={() => !active && save.mutate(preset.days)}
                className={cn(
                  "text-left px-4 py-3 rounded-xl transition-colors",
                  "disabled:cursor-not-allowed",
                  active
                    ? "bg-primary/10 ring-2 ring-inset ring-primary"
                    : "bg-surface-container-highest hover:bg-surface-container-high",
                )}
              >
                <span
                  className={cn(
                    "block text-sm font-bold",
                    active ? "text-primary" : "text-on-surface",
                  )}
                >
                  {preset.label}
                </span>
                <span className="block text-xs text-on-surface-variant mt-0.5">
                  {preset.hint}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {isCustom && !isLoading && (
        <p className="text-xs text-on-surface-variant">
          Currently set to {current} days, which isn't one of the presets.
          Choosing one above will replace it.
        </p>
      )}

      {/*
        Said plainly because the opposite assumption is the dangerous one:
        someone shortening this to lock out a device they lost will otherwise
        believe they have done it.
      */}
      <p className="text-xs text-on-surface-variant text-pretty">
        This applies to sign-ins from now on. Sessions that already exist keep
        the length they were created with — use{" "}
        <strong className="text-on-surface">Sign out other devices</strong> to
        end those now.
      </p>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const AccountSettings = () => {
  const { user, authRequired, signOut } = useAuth();

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
        <GroupHeading>Session length</GroupHeading>
        <SessionLengthCard />
      </section>

      <section className="tile-enter" style={{ animationDelay: tileDelay(4) }}>
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
              "shrink-0 px-5 py-2.5 rounded-xl font-bold text-sm",
              "bg-surface-container-high text-on-surface",
              "flex items-center gap-2 hover:bg-surface-container-highest transition-colors",
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
