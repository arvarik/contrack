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
  Pencil,
  ShieldCheck,
  Trash2,
  UserPlus,
  UserRoundCheck,
  UserRoundX,
  Users,
} from "lucide-react";
import {
  downloadUserExport,
  useAdminUsers,
  useCreateUser,
  useDeleteUser,
  useResetPassword,
  useSendResetLink,
  useInstanceSettings,
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
import {
  ActionMenu,
  type ActionMenuItem,
} from "../../../components/ui/ActionMenu";
import { Badge } from "../../../components/ui/Badge";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { Modal } from "../../../components/ui/Modal";
import { SecretReveal } from "../../../components/ui/SecretReveal";
import { formatRelative, formatWhen } from "../../../lib/datetime";
import { ChoiceGroup } from "../../../components/ui/ChoiceGroup";
import { cn } from "../../../lib/utils";
import { SETTINGS_INPUT, SETTINGS_LABEL } from "../layout";
import {
  AdminButton,
  AdminCell,
  AdminList,
  AdminPage,
  AdminRow,
  RolePicker,
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

/**
 * The ⋮ menu on a row. `ActionMenu` owns the keys, the outside click and
 * the focus return to the button, so this only decides which items a row
 * offers.
 */
const RowMenu = ({
  user,
  actions,
}: {
  user: AdminUser;
  actions: RowActions;
}) => {
  const items: ActionMenuItem[] = [
    { id: "edit", label: "Edit", icon: Pencil, onSelect: actions.onEdit },
  ];
  // Not the local owner, which has no password to reset, and not your own
  // account. A reset deletes every session of its target, so an admin
  // resetting themselves is signed out by their own click, with the only
  // copy of the new password inside the dialog that unmounts with them.
  // Your own password is changed in Account settings, which keeps the
  // session it is made on. The server refuses this too.
  if (!user.isLocalOwner && !user.isSelf) {
    items.push({
      id: "reset",
      label: "Reset password",
      icon: KeyRound,
      onSelect: actions.onReset,
    });
  }
  items.push({
    id: "export",
    label: "Export data",
    icon: Download,
    onSelect: actions.onExport,
  });
  if (!user.isSelf) {
    items.push(
      user.status === "disabled"
        ? {
            id: "enable",
            label: "Enable",
            icon: UserRoundCheck,
            onSelect: actions.onToggleEnabled,
          }
        : {
            id: "disable",
            label: "Disable",
            icon: UserRoundX,
            onSelect: actions.onToggleEnabled,
          },
      {
        id: "delete",
        label: "Delete",
        icon: Trash2,
        onSelect: actions.onDelete,
        danger: true,
      },
    );
  }

  return (
    // On a phone the row is a stacked card, and its menu sits in the card's
    // top right corner, beside the name, not under the last cell.
    <ActionMenu
      label={`Actions for ${user.username}`}
      items={items}
      className="absolute top-2 right-2 sm:static sm:justify-self-end"
      triggerClassName="min-w-[44px] min-h-[44px]"
    />
  );
};

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

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
    <label htmlFor={id} className={SETTINGS_LABEL}>
      {label}
    </label>
    <input
      id={id}
      aria-describedby={hint ? `${id}-hint` : undefined}
      className={SETTINGS_INPUT}
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

  // Cleared when the dialog closes, however it closes.
  //
  // `createOpen` comes from the route, and a route can change without this
  // component's own close handler ever running: a link, the back button, a
  // redirect. Resetting from the handler left the previous account's
  // temporary password in state, so reopening the dialog showed it again,
  // under the next person's name.
  React.useEffect(() => {
    if (isOpen) return;
    const timer = window.setTimeout(() => {
      setEmail("");
      setUsername("");
      setDisplayName("");
      setRole("member");
      setCreated(null);
      create.reset();
      // After the closing animation, so the secret does not flash back into
      // view on its way out.
    }, 200);
    return () => window.clearTimeout(timer);
    // `create` is a stable mutation object; depending on it would re-run this
    // on every render of the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const close = () => onClose();

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
            nothing else works for them until they do
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
            hint="Used to sign in"
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
            hint="Lowercase letters, numbers, dots, dashes, underscores"
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
            hint="Optional. Shown in the app"
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
  const nameChanged = displayName !== (user.displayName ?? "");
  const roleChanged = role !== user.role;
  const dirty = nameChanged || roleChanged;

  return (
    <Modal isOpen onClose={onClose} title={`Edit ${user.username}`} size="md">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!dirty) return;
          // Only the fields actually touched. The `user` object is a
          // snapshot taken when the menu opened, so sending an untouched role
          // turns somebody else's concurrent change into a silent revert and
          // writes a `user.role.changed` audit row nobody asked for.
          update.mutate(
            {
              id: user.id,
              ...(nameChanged
                ? { displayName: displayName.trim() || null }
                : {}),
              ...(roleChanged ? { role } : {}),
            },
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
        {/*
          No role picker on your own row. Demoting yourself takes the
          administration area away mid-edit and needs another admin to undo,
          which is the same reason disable and delete refuse a self-target.
          Somebody stepping down asks a colleague, as they would to be
          removed.
        */}
        {!user.isSelf && <RolePicker value={role} onChange={setRole} />}
        {/*
          The email and the username belong to the account holder, who changes
          them in their own settings. An admin who could rewrite the identifier
          somebody signs in with could lock them out silently.
        */}
        <p className="text-xs text-on-surface-variant text-pretty">
          The email and username are {user.username}&rsquo;s own to change,
          under their account settings
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
            recovered from inside Contrack
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
        {/* The label is the tap box for the 20 px checkbox, so it holds 44 px. */}
        <label className="flex items-center gap-2.5 min-h-[44px] cursor-pointer">
          <input
            type="checkbox"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
            className="w-5 h-5 shrink-0 rounded accent-[var(--color-error)]"
          />
          <span className="text-sm text-on-surface text-pretty">
            I understand this cannot be undone
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
  const { data: users, isLoading, isError, refetch } = useAdminUsers();
  const setEnabled = useSetUserEnabled();
  const reset = useResetPassword();
  const sendResetLink = useSendResetLink();
  const { data: instanceSettings } = useInstanceSettings();
  const mailConfigured = instanceSettings?.mailConfigured === true;
  const remove = useDeleteUser();

  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [resetMethod, setResetMethod] = useState<"email" | "temporary">(
    "email",
  );
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
            Create account
          </AdminButton>
        </>
      }
    >
      <AdminList
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        isEmpty={!isLoading && !isError && (users?.length ?? 0) === 0}
        empty={{
          icon: Users,
          title: "No accounts yet",
          body: "Create one, or send an invitation",
        }}
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
          <AdminRow key={user.id} columns={COLUMNS} className="relative">
            <div className="flex items-center gap-3 min-w-0 pr-12 sm:pr-0">
              <AccountAvatar user={user} size={36} />
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                  <span className="text-sm font-bold text-on-surface truncate max-w-full">
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
                onReset: () => {
                  setResetMethod("email");
                  setResetting(user);
                },
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
          You cannot disable or delete your own account, or remove the last
          admin
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

      {!mailConfigured ? (
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
              must replace it before anything works for them
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
      ) : (
        <Modal
          isOpen={resetting !== null}
          onClose={() => setResetting(null)}
          title={`Reset ${resetting?.username}'s password?`}
          size="sm"
        >
          <div className="space-y-4">
            <p className="text-sm text-on-surface-variant text-pretty">
              They are signed out everywhere and every token they made stops
              working. Choose how to deliver the new password
            </p>

            <ChoiceGroup
              label="How to deliver the new password"
              value={resetMethod}
              options={[
                {
                  value: "email",
                  label: "Email a reset link",
                  hint: `Sends a one-time link to ${resetting?.email ?? "their email"}. It works for 24 hours`,
                },
                {
                  value: "temporary",
                  label: "Show a temporary password",
                  hint: "Shows a password once, for you to hand over",
                },
              ]}
              onChange={setResetMethod}
            />

            <div className="flex items-center justify-end gap-2 pt-2">
              <AdminButton
                tone="secondary"
                onClick={() => setResetting(null)}
                disabled={reset.isPending || sendResetLink.isPending}
              >
                Cancel
              </AdminButton>
              <AdminButton
                busy={reset.isPending || sendResetLink.isPending}
                onClick={() => {
                  if (!resetting) return;
                  if (resetMethod === "email") {
                    sendResetLink.mutate(resetting.id, {
                      onSuccess: (res) => {
                        setResetting(null);
                        toast.success(
                          `Sent to ${res.sentTo}. The link works for 24 hours`,
                        );
                      },
                      onError: (error: Error) => toast.error(error.message),
                    });
                  } else {
                    reset.mutate(resetting.id, {
                      onSuccess: ({ temporaryPassword: password }) => {
                        setResetting(null);
                        setTemporaryPassword(password);
                      },
                      onError: (error: Error) => toast.error(error.message),
                    });
                  }
                }}
              >
                {resetMethod === "email"
                  ? "Email a reset link"
                  : "Show a temporary password"}
              </AdminButton>
            </div>
          </div>
        </Modal>
      )}

      <Modal
        isOpen={temporaryPassword !== null}
        onClose={() => setTemporaryPassword(null)}
        title="Temporary password"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-on-surface-variant text-pretty">
            Hand this over however you already talk to them. Contrack cannot
            show it again
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
