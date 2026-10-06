/**
 * Who is signed in, which decides whose contacts are on screen. Shown in the
 * sidebar, and at the top of Settings on a phone, where there is no sidebar.
 * Hidden when `authRequired` is false: nobody signs in as the local owner.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LogOut, ShieldCheck, UserRound } from "lucide-react";
import { useDismissable } from "../../hooks/useDismissable";
import { Badge } from "../ui/Badge";
import { accountAvatarUrl } from "../../lib/avatar";
import {
  CARD,
  LABEL_PRIMARY,
  MENU_ITEM,
  MENU_ITEM_DANGER,
  MENU_SEPARATOR,
  SELECTED_TINT,
} from "../../lib/styles";
import { cn } from "../../lib/utils";
import { useAuth } from "./AuthGate";
import type { AccountUser } from "../../api/auth";
import { usePreferences } from "../../contexts/PreferencesContext";

/** The account's role, as a pill. Only "admin" takes the primary tint. */
export const RoleBadge = ({
  role,
  className,
}: {
  role: string;
  className?: string;
}) =>
  role === "admin" ? (
    <Badge
      tone="primary"
      icon={<ShieldCheck className="w-3 h-3" />}
      className={className}
    >
      Admin
    </Badge>
  ) : (
    <Badge className={className}>Member</Badge>
  );

/** The account's avatar. Renders the profile photo when available, falling back to initials monogram. */
export const AccountAvatar = ({
  user,
  size = 32,
}: {
  user: Pick<AccountUser, "username" | "displayName" | "avatarUrl">;
  size?: number;
}) => {
  // The monogram is a served image, so a chosen theme travels in its URL.
  // The default `system` theme it reads from `prefers-color-scheme`.
  const { preferences, mode } = usePreferences();
  const theme = preferences.theme === "system" ? undefined : mode;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  useEffect(() => {
    setFailedUrl(null);
  }, [user.avatarUrl]);

  const photoAvailable = Boolean(
    user.avatarUrl && user.avatarUrl !== failedUrl,
  );
  const src = photoAvailable
    ? user.avatarUrl!
    : accountAvatarUrl(user.username, theme);

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      // Decorative: the name is always in text or a label beside it.
      aria-hidden="true"
      onError={() => {
        if (user.avatarUrl && user.avatarUrl !== failedUrl) {
          setFailedUrl(user.avatarUrl);
        }
      }}
      className="rounded-full bg-surface-container-high shrink-0 object-cover"
      style={{ width: size, height: size }}
    />
  );
};

/** The name to show, falling back through what the account actually has. */
function accountLabel(user: AccountUser): string {
  return user.displayName?.trim() || user.username;
}

// Desktop: the sidebar avatar and its menu

/**
 * The account at the foot of the sidebar. Nothing on an un-gated instance or
 * before `/status` answers: a gap that fills beats a placeholder that changes.
 */
export const SidebarIdentity = () => {
  const { user, authRequired, isAdmin, instanceName, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // Closing puts focus back on the avatar, or it falls to <body>.
  const close = useCallback(() => {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }, []);
  const ref = useDismissable<HTMLDivElement>(open, close);

  if (!authRequired || !user) return null;
  const label = accountLabel(user);

  return (
    <div ref={ref} className="relative flex justify-center w-full">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Signed in as ${label}. Account menu.`}
        className={cn(
          "inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-full transition-colors",
          open ? SELECTED_TINT : "state-layer",
        )}
      >
        <AccountAvatar user={user} size={32} />
      </button>

      {/*
          A disclosure, not a menu: `role="menu"` promises arrow keys and
          forbids the name, email and role this panel shows.
        */}
      {open && (
        <div
          aria-label="Account"
          // The panel sits up and to the right of the avatar, so the
          // entrance grows from its bottom left corner.
          style={{ "--menu-origin": "bottom left" } as React.CSSProperties}
          className={cn(
            "absolute left-full bottom-0 ml-3 z-50 w-60 p-2",
            "menu-panel menu-enter",
          )}
        >
          <div className="px-3 py-2">
            {/* Which instance, above who: one account can be on two Contracks. */}
            {instanceName && (
              <p className={cn(LABEL_PRIMARY, "truncate mb-1")}>
                {instanceName}
              </p>
            )}
            <p className="font-bold text-sm text-on-surface truncate">
              {label}
            </p>
            <p className="text-xs text-on-surface-variant truncate">
              {user.email}
            </p>
            <RoleBadge role={isAdmin ? "admin" : "member"} className="mt-2" />
          </div>
          <div className={MENU_SEPARATOR} />
          <Link
            to="/settings/account"
            onClick={() => setOpen(false)}
            className={MENU_ITEM}
          >
            <UserRound className="w-4 h-4" />
            Account settings
          </Link>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
            className={cn(MENU_ITEM, MENU_ITEM_DANGER)}
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
};

// Mobile: the row at the top of Settings

/**
 * The identity where the sidebar is hidden. `md:hidden` mirrors the
 * sidebar's `hidden md:flex`, so the account shows once at every width.
 */
export const SettingsIdentityRow = () => {
  const { user, authRequired, isAdmin, signOut } = useAuth();
  if (!authRequired || !user) return null;
  const label = accountLabel(user);

  return (
    <section className="md:hidden">
      <div className={cn(CARD, "flex items-center gap-3 p-3")}>
        <Link
          to="/settings/account"
          className="state-layer flex items-center gap-3 flex-1 min-w-0 rounded-xl py-1 -my-1 transition-colors"
        >
          <AccountAvatar user={user} size={40} />
          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-2 min-w-0">
              <span className="font-bold text-sm text-on-surface truncate">
                {label}
              </span>
              <RoleBadge role={isAdmin ? "admin" : "member"} />
            </span>
            <span className="block text-xs text-on-surface-variant truncate">
              {user.email}
            </span>
          </span>
        </Link>
        <button
          type="button"
          onClick={() => void signOut()}
          aria-label="Sign out"
          className={cn(
            "shrink-0 inline-flex items-center justify-center",
            "min-w-[44px] min-h-[44px] rounded-full",
            "state-layer text-on-surface-variant hover:text-error transition-colors",
          )}
        >
          <LogOut className="w-5 h-5" />
        </button>
      </div>
    </section>
  );
};
