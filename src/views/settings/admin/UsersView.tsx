/**
 * UsersView — the accounts on this instance.
 *
 * What an admin can see here is deliberately limited to facts *about* an
 * account: its name, its role, whether it is usable, how much it holds, when
 * it was last used. Not one contact, not one note. The single exception is
 * the export, which exists for the day somebody leaves and writes an audit
 * row naming the account it read.
 *
 * Three refusals are worth expecting rather than treating as errors, because
 * each one is the system working:
 *
 *   409 LAST_ADMIN           an instance nobody can administer is a locked-out
 *                            instance, so the last admin cannot be removed.
 *   400 CANNOT_TARGET_SELF   an admin cannot lock themselves out either.
 *   409 LOCAL_OWNER_PROTECTED  while sign-in is off, this device's account is
 *                            what owns the data, and deleting it deletes
 *                            everything.
 *
 * They arrive as the server's own sentences and are shown as they are.
 */
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Download,
  KeyRound,
  MailPlus,
  MoreVertical,
  Pencil,
  ShieldCheck,
  Trash2,
  UserPlus,
  UserRoundCheck,
  UserRoundX,
} from "lucide-react";
import {
  downloadUserExport,
  useAdminUsers,
  useCreateUser,
  useDeleteUser,
  useResetPassword,
  useSetUserEnabled,
  useUpdateUser,
  type AdminUser,
  type OwnedCounts,
  type UserRole,
} from "../../../api/admin";
import { ApiError } from "../../../api/client";
import { useAuth } from "../../../components/auth/AuthGate";
import {
  AccountAvatar,
  RoleBadge,
} from "../../../components/auth/AccountIdentity";
import { Badge } from "../../../components/ui/Badge";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { Modal } from "../../../components/ui/Modal";
import { SecretReveal } from "../../../components/ui/SecretReveal";
import { useDismissable } from "../../../hooks/useDismissable";
import { formatRelative, formatWhen } from "../../../lib/datetime";
import { DROPDOWN_ITEM, DROPDOWN_MENU } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import {
  AdminButton,
  AdminCell,
  AdminList,
  AdminPage,
  AdminRow,
} from "./AdminShell";

/** Name, role, holdings, last seen, and the row menu. */
const COLUMNS =
  "sm:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_88px_minmax(0,1.1fr)_44px]";

// ---------------------------------------------------------------------------
// Row menu
// ---------------------------------------------------------------------------

interface RowActions {
  onEdit: () => void;
  onReset: () => void;
  onToggleEnabled: () => void;
  onExport: () => void;
  onDelete: () => void;
}

const RowMenu = ({
  user,
  actions,
}: {
  user: AdminUser;
  actions: RowActions;
}) => {
  const [open, setOpen] = useState(false);
  const close = React.useCallback(() => setOpen(false), []);
  const ref = useDismissable<HTMLDivElement>(open, close);
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div ref={ref} className="relative sm:justify-self-end">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${user.username}`}
        className={cn(
          "inline-flex items-center justify-center min-w-[44px] min-h-[44px]",
          "rounded-full transition-colors outline-none",
          "focus-visible:ring-2 focus-visible:ring-primary",
          open
            ? "bg-surface-container-high text-on-surface"
            : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
        )}
      >
        <MoreVertical className="w-5 h-5" />
      </button>
      {open && (
        <ul role="menu" className={cn(DROPDOWN_MENU, "right-0 w-56 mt-1 p-1")}>
          <li>
            <button
              type="button"
              role="menuitem"
              onClick={run(actions.onEdit)}
              className={cn(DROPDOWN_ITEM, "w-full gap-2.5 rounded-lg")}
            >
              <Pencil className="w-4 h-4" />
              Edit
            </button>
          </li>
          {/*
            The local owner has no password to reset. It is the account an
            un-secured instance runs as and nobody signs in to it.
          */}
          {!user.isLocalOwner && (
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={run(actions.onReset)}
                className={cn(DROPDOWN_ITEM, "w-full gap-2.5 rounded-lg")}
              >
                <KeyRound className="w-4 h-4" />
                Reset password
              </button>
            </li>
          )}
          <li>
            <button
              type="button"
              role="menuitem"
              onClick={run(actions.onExport)}
              className={cn(DROPDOWN_ITEM, "w-full gap-2.5 rounded-lg")}
            >
              <Download className="w-4 h-4" />
              Export data
            </button>
          </li>
          {!user.isSelf && (
            <>
              <li>
                <button
                  type="button"
                  role="menuitem"
                  onClick={run(actions.onToggleEnabled)}
                  className={cn(DROPDOWN_ITEM, "w-full gap-2.5 rounded-lg")}
                >
                  {user.status === "disabled" ? (
                    <>
                      <UserRoundCheck className="w-4 h-4" />
                      Enable
                    </>
                  ) : (
                    <>
                      <UserRoundX className="w-4 h-4" />
                      Disable
                    </>
                  )}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  role="menuitem"
                  onClick={run(actions.onDelete)}
                  className={cn(
                    DROPDOWN_ITEM,
                    "w-full gap-2.5 rounded-lg text-error hover:bg-error/10 hover:text-error",
                  )}
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              </li>
            </>
          )}
        </ul>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

const ROLE_OPTIONS: { value: UserRole; label: string; hint: string }[] = [
  {
    value: "member",
    label: "Member",
    hint: "Their own contacts, and nothing else.",
  },
  {
    value: "admin",
    label: "Admin",
    hint: "Also manages accounts, instance settings and AI configuration.",
  },
];

const RolePicker = ({
  value,
  onChange,
}: {
  value: UserRole;
  onChange: (next: UserRole) => void;
}) => (
  <div className="space-y-1.5">
    <span className="block text-xs font-bold text-on-surface">Role</span>
    <div role="radiogroup" aria-label="Role" className="grid gap-2">
      {ROLE_OPTIONS.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "text-left px-4 py-3 rounded-xl transition-colors",
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
              {option.label}
            </span>
            <span className="block text-xs text-on-surface-variant mt-0.5">
              {option.hint}
            </span>
          </button>
        );
      })}
    </div>
  </div>
);

const AdminField = ({
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

/**
 * Create an account, and show its temporary password once.
 *
 * The server generates the password. An admin who types one they thought of
 * is how an instance ends up with three accounts sharing it, and the new
 * account has to change it on first use anyway.
 */
const CreateUserModal = ({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) => {
  const create = useCreateUser();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<UserRole>("member");
  const [created, setCreated] = useState<{
    user: AdminUser;
    temporaryPassword: string;
  } | null>(null);

  const close = () => {
    onClose();
    window.setTimeout(() => {
      setEmail("");
      setUsername("");
      setDisplayName("");
      setRole("member");
      setCreated(null);
      create.reset();
    }, 200);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !username.trim()) return;
    create.mutate(
      {
        email: email.trim(),
        username: username.trim(),
        displayName: displayName.trim() || undefined,
        role,
      },
      {
        onSuccess: setCreated,
        onError: (error: Error) => toast.error(error.message),
      },
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={created ? "Account created" : "Create an account"}
      size="md"
    >
      {created ? (
        <div className="space-y-4">
          <p className="text-sm text-on-surface-variant text-pretty">
            Give this password to{" "}
            <strong className="text-on-surface">
              {created.user.displayName || created.user.username}
            </strong>
            . They will have to replace it before they can use anything, and
            nothing else works for them until they do.
          </p>
          <SecretReveal
            value={created.temporaryPassword}
            label="Temporary password"
            grouped
          />
          <div className="flex justify-end">
            <AdminButton onClick={close}>I&rsquo;ve copied it</AdminButton>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <AdminField
            id="new-user-email"
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            hint="Used to sign in. Contrack never sends mail."
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            // The dialog opens on this field with nothing else to do.
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
          <AdminField
            id="new-user-username"
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            hint="Lowercase letters, numbers, dots, dashes, underscores."
            maxLength={32}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
          />
          <AdminField
            id="new-user-display"
            label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            hint="Optional. Shown in the app."
            // The server stores 100 characters and accepts 200, so a longer
            // name is taken and then silently cut in half.
            maxLength={100}
            autoComplete="off"
          />
          <RolePicker value={role} onChange={setRole} />
          <div className="flex justify-end">
            <AdminButton
              type="submit"
              busy={create.isPending}
              icon={<UserPlus className="w-4 h-4" />}
              disabled={!email.trim() || !username.trim() || create.isPending}
            >
              Create account
            </AdminButton>
          </div>
        </form>
      )}
    </Modal>
  );
};

const EditUserModal = ({
  user,
  onClose,
}: {
  user: AdminUser | null;
  onClose: () => void;
}) => {
  const update = useUpdateUser();
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<UserRole>("member");

  React.useEffect(() => {
    if (!user) return;
    setDisplayName(user.displayName ?? "");
    setRole(user.role === "admin" ? "admin" : "member");
  }, [user]);

  if (!user) return null;
  const dirty = displayName !== (user.displayName ?? "") || role !== user.role;

  return (
    <Modal isOpen onClose={onClose} title={`Edit ${user.username}`} size="md">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!dirty) return;
          update.mutate(
            { id: user.id, displayName: displayName.trim() || null, role },
            {
              onSuccess: () => {
                toast.success("Account updated");
                onClose();
              },
              onError: (error: Error) => toast.error(error.message),
            },
          );
        }}
        className="space-y-4"
      >
        <AdminField
          id="edit-user-display"
          label="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={100}
        />
        <RolePicker value={role} onChange={setRole} />
        {/*
          The email and the username belong to the account holder, who changes
          them in their own settings. An admin who could rewrite the identifier
          somebody signs in with could lock them out silently.
        */}
        <p className="text-xs text-on-surface-variant text-pretty">
          The email and username are {user.username}&rsquo;s own to change,
          under their account settings.
        </p>
        <div className="flex justify-end">
          <AdminButton
            type="submit"
            busy={update.isPending}
            disabled={!dirty || update.isPending}
          >
            Save changes
          </AdminButton>
        </div>
      </form>
    </Modal>
  );
};

/**
 * Delete an account and everything it owns.
 *
 * Opened by a `409 USER_HAS_DATA`, which is what the first click produces:
 * that refusal is where the four numbers come from, and it also proves the
 * guards passed. Asking `GET /admin/users/:id` for the counts instead would
 * cheerfully open this dialog for an account that cannot be deleted at all.
 */
const DeleteUserDialog = ({
  user,
  counts,
  onClose,
}: {
  user: AdminUser | null;
  counts: OwnedCounts | null;
  onClose: () => void;
}) => {
  const remove = useDeleteUser();
  const [understood, setUnderstood] = useState(false);
  const [exporting, setExporting] = useState(false);

  React.useEffect(() => {
    if (user) setUnderstood(false);
  }, [user]);

  if (!user || !counts) return null;

  const holdings = [
    [counts.contacts, "contact"],
    [counts.interactions, "interaction"],
    [counts.lists, "list"],
    [counts.files, "file"],
  ] as const;

  return (
    <ConfirmDialog
      isOpen
      onClose={onClose}
      onConfirm={() =>
        remove.mutate(
          { id: user.id, purge: true },
          {
            onSuccess: () => {
              toast.success(`Deleted ${user.username}`);
              onClose();
            },
            onError: (error: Error) => toast.error(error.message),
          },
        )
      }
      busy={remove.isPending}
      disabled={!understood}
      title={`Delete ${user.username}?`}
      confirmLabel="Delete account and data"
      description={
        <>
          <p>
            Everything this account owns goes with it, and none of it can be
            recovered from inside Contrack.
          </p>
          <ul className="grid grid-cols-2 gap-2 not-italic">
            {holdings.map(([count, noun]) => (
              <li
                key={noun}
                className="rounded-xl bg-surface-container-high px-3 py-2"
              >
                <span className="block text-lg font-bold text-on-surface tabular-nums">
                  {count.toLocaleString()}
                </span>
                <span className="block text-xs text-on-surface-variant">
                  {count === 1 ? noun : `${noun}s`}
                </span>
              </li>
            ))}
          </ul>
        </>
      }
    >
      <div className="space-y-3">
        <AdminButton
          tone="secondary"
          busy={exporting}
          icon={<Download className="w-4 h-4" />}
          className="w-full"
          onClick={() => {
            setExporting(true);
            downloadUserExport(user.id, user.username)
              .then(() => toast.success("Export downloaded"))
              .catch((error: Error) => toast.error(error.message))
              .finally(() => setExporting(false));
          }}
        >
          Export their data first
        </AdminButton>
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
            className="mt-0.5 w-5 h-5 shrink-0 rounded accent-[var(--color-error)]"
          />
          <span className="text-sm text-on-surface text-pretty">
            I understand this cannot be undone.
          </span>
        </label>
      </div>
    </ConfirmDialog>
  );
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const UsersView = ({ createOpen = false }: { createOpen?: boolean }) => {
  const navigate = useNavigate();
  const { user: me } = useAuth();
  const { data: users, isLoading } = useAdminUsers();
  const setEnabled = useSetUserEnabled();
  const reset = useResetPassword();
  const remove = useDeleteUser();

  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(
    null,
  );
  const [deleting, setDeleting] = useState<{
    user: AdminUser;
    counts: OwnedCounts;
  } | null>(null);

  /** The first click. It is meant to be refused; the refusal carries the counts. */
  const askToDelete = (user: AdminUser) =>
    remove.mutate(
      { id: user.id, purge: false },
      {
        onError: (error: Error) => {
          const counts =
            error instanceof ApiError && error.code === "USER_HAS_DATA"
              ? (error.details as { counts?: OwnedCounts } | undefined)?.counts
              : undefined;
          if (counts) setDeleting({ user, counts });
          // LAST_ADMIN, CANNOT_TARGET_SELF and LOCAL_OWNER_PROTECTED all land
          // here. Each is the system working, and each says so in a sentence
          // better than anything this file could compose.
          else toast.error(error.message);
        },
        onSuccess: () => {
          // Unreachable: the server refuses every delete without a decision.
          // Kept so a change on that side does not silently do nothing here.
          toast.success(`Deleted ${user.username}`);
        },
      },
    );

  return (
    <AdminPage
      lead="Everyone with an account on this Contrack. Each account holds its own contacts; nobody sees anybody else's."
      actions={
        <>
          <AdminButton
            tone="secondary"
            icon={<MailPlus className="w-4 h-4" />}
            onClick={() => navigate("/settings/admin/invitations")}
          >
            Invite
          </AdminButton>
          <AdminButton
            icon={<UserPlus className="w-4 h-4" />}
            onClick={() => navigate("/settings/admin/users/new")}
          >
            Create user
          </AdminButton>
        </>
      }
    >
      <AdminList
        isLoading={isLoading}
        isEmpty={!isLoading && (users?.length ?? 0) === 0}
        empty="No accounts yet."
        header={
          <div className={cn("grid gap-4", COLUMNS)}>
            <span>Account</span>
            <span>Role</span>
            <span className="text-right">Contacts</span>
            <span>Last sign-in</span>
            <span className="sr-only">Actions</span>
          </div>
        }
      >
        {users?.map((user) => (
          <AdminRow key={user.id} columns={COLUMNS}>
            <div className="flex items-center gap-3 min-w-0">
              <AccountAvatar user={user} size={36} />
              <div className="min-w-0">
                <p className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-bold text-on-surface truncate">
                    {user.displayName || user.username}
                  </span>
                  {user.isSelf && <Badge tone="primary">You</Badge>}
                  {/*
                    The account an un-secured instance runs as. Its data is
                    this device's data, which is why it cannot be removed
                    while sign-in is off.
                  */}
                  {user.isLocalOwner && <Badge>This device</Badge>}
                </p>
                <p className="text-xs text-on-surface-variant truncate">
                  {user.username} · {user.email}
                </p>
              </div>
            </div>

            <AdminCell label="Role">
              <span className="flex flex-wrap items-center gap-1.5">
                <RoleBadge role={user.role} />
                {user.status === "disabled" && (
                  <Badge tone="danger">Disabled</Badge>
                )}
                {user.mustChangePassword && (
                  <Badge tone="warning">Must reset</Badge>
                )}
              </span>
            </AdminCell>

            <AdminCell label="Contacts" className="sm:text-right">
              <span className="text-sm tabular-nums text-on-surface">
                {user.contactCount.toLocaleString()}
              </span>
            </AdminCell>

            <AdminCell label="Last sign-in">
              <span
                className="text-xs text-on-surface-variant"
                title={formatWhen(user.lastLoginAt, "Never signed in")}
              >
                {formatRelative(user.lastLoginAt, "Never")}
              </span>
            </AdminCell>

            <RowMenu
              user={user}
              actions={{
                onEdit: () => setEditing(user),
                onReset: () => setResetting(user),
                onExport: () =>
                  downloadUserExport(user.id, user.username)
                    .then(() => toast.success("Export downloaded"))
                    .catch((error: Error) => toast.error(error.message)),
                onToggleEnabled: () =>
                  setEnabled.mutate(
                    { id: user.id, enabled: user.status === "disabled" },
                    {
                      onSuccess: ({ user: next }) =>
                        toast.success(
                          next.status === "disabled"
                            ? `${next.username} is disabled and signed out everywhere`
                            : `${next.username} can sign in again`,
                        ),
                      onError: (error: Error) => toast.error(error.message),
                    },
                  ),
                onDelete: () => askToDelete(user),
              }}
            />
          </AdminRow>
        ))}
      </AdminList>

      {me && (
        <p className="text-xs text-on-surface-variant px-1 text-pretty">
          You cannot disable or delete your own account, and the last remaining
          admin cannot be removed. An instance nobody can administer is an
          instance nobody can fix.
        </p>
      )}

      <CreateUserModal
        isOpen={createOpen}
        onClose={() => navigate("/settings/admin/users", { replace: true })}
      />
      <EditUserModal user={editing} onClose={() => setEditing(null)} />
      <DeleteUserDialog
        user={deleting?.user ?? null}
        counts={deleting?.counts ?? null}
        onClose={() => setDeleting(null)}
      />

      <ConfirmDialog
        isOpen={resetting !== null}
        onClose={() => setResetting(null)}
        busy={reset.isPending}
        tone="primary"
        title={`Reset ${resetting?.username}'s password?`}
        confirmLabel="Reset password"
        description={
          <p>
            They are signed out everywhere and every token they made stops
            working. You will get a temporary password to hand over, and they
            must replace it before anything works for them.
          </p>
        }
        onConfirm={() =>
          resetting &&
          reset.mutate(resetting.id, {
            onSuccess: ({ temporaryPassword: password }) => {
              setResetting(null);
              setTemporaryPassword(password);
            },
            onError: (error: Error) => toast.error(error.message),
          })
        }
      />

      <Modal
        isOpen={temporaryPassword !== null}
        onClose={() => setTemporaryPassword(null)}
        title="Temporary password"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-on-surface-variant text-pretty">
            Hand this over however you already talk to them. Contrack cannot
            show it again.
          </p>
          {temporaryPassword && (
            <SecretReveal
              value={temporaryPassword}
              label="Temporary password"
              grouped
            />
          )}
          <div className="flex justify-end">
            <AdminButton
              icon={<ShieldCheck className="w-4 h-4" />}
              onClick={() => setTemporaryPassword(null)}
            >
              I&rsquo;ve copied it
            </AdminButton>
          </div>
        </div>
      </Modal>
    </AdminPage>
  );
};
