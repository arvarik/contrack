/**
 * InvitationsView — links that create an account.
 *
 * Contrack sends no mail, so an invitation is a link the admin copies and
 * hands over however they already talk to the person. The database holds only
 * the SHA-256 of the secret inside it, which is why the link is shown once,
 * at the moment it is made, and never again. A lost link is replaced, not
 * recovered.
 *
 * The accepted and expired ones stay in the list below the live ones. They
 * are the record of how everybody got here, which is the question somebody
 * asks six months later.
 */
import React, { useState } from "react";
import { toast } from "sonner";
import { Link2, MailPlus, Send } from "lucide-react";
import {
  invitationState,
  useCreateInvitation,
  useInvitations,
  useRevokeInvitation,
  type Invitation,
  type UserRole,
} from "../../../api/admin";
import { Badge, type BadgeTone } from "../../../components/ui/Badge";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { Modal } from "../../../components/ui/Modal";
import { SecretReveal } from "../../../components/ui/SecretReveal";
import { formatDay, formatWhen } from "../../../lib/datetime";
import { cn } from "../../../lib/utils";
import {
  AdminButton,
  AdminCell,
  AdminList,
  AdminPage,
  AdminRow,
} from "./AdminShell";

const COLUMNS = "sm:grid-cols-[minmax(0,2fr)_120px_minmax(0,1fr)_auto]";

const STATE_TONES: Record<
  ReturnType<typeof invitationState>,
  { tone: BadgeTone; label: string }
> = {
  pending: { tone: "primary", label: "Pending" },
  accepted: { tone: "success", label: "Accepted" },
  revoked: { tone: "danger", label: "Revoked" },
  expired: { tone: "neutral", label: "Expired" },
};

const EXPIRY_PRESETS = [
  { days: 3, label: "3 days" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
] as const;

const NewInvitationModal = ({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) => {
  const create = useCreateInvitation();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("member");
  const [expiresInDays, setExpiresInDays] = useState<number>(7);
  const [link, setLink] = useState<string | null>(null);

  const close = () => {
    onClose();
    window.setTimeout(() => {
      setEmail("");
      setRole("member");
      setExpiresInDays(7);
      setLink(null);
      create.reset();
    }, 200);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={link ? "Send this link" : "New invitation"}
      size="md"
    >
      {link ? (
        <div className="space-y-4">
          <p className="text-sm text-on-surface-variant text-pretty">
            Anyone who opens this link can create one account with it, once.
            Send it the way you would send a password.
          </p>
          <SecretReveal value={link} label="Invitation link" />
          <div className="flex justify-end">
            <AdminButton onClick={close}>I&rsquo;ve copied it</AdminButton>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate(
              {
                email: email.trim() || null,
                role,
                expiresInDays,
              },
              {
                onSuccess: (result) => setLink(result.link),
                onError: (error: Error) => toast.error(error.message),
              },
            );
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <label
              htmlFor="invite-email"
              className="block text-xs font-bold text-on-surface"
            >
              Email
            </label>
            <input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-describedby="invite-email-hint"
              className={cn(
                "w-full px-4 py-3 rounded-xl bg-surface-container-highest",
                "text-base sm:text-sm",
                "outline-none focus-visible:ring-2 focus-visible:ring-primary",
              )}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              // The dialog opens on this field.
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
            {/*
              A note to the admin, not a rule. The person accepting chooses
              their own email, and the server does not check it against this
              one — which is deliberate: an invitation forwarded to the right
              colleague with a different address should still work.
            */}
            <p
              id="invite-email-hint"
              className="text-xs text-on-surface-variant"
            >
              Optional, and only a reminder of who this was for. Whoever opens
              the link picks their own email.
            </p>
          </div>

          <div className="space-y-1.5">
            <span className="block text-xs font-bold text-on-surface">
              Role
            </span>
            <div role="radiogroup" aria-label="Role" className="flex gap-2">
              {(["member", "admin"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={role === option}
                  onClick={() => setRole(option)}
                  className={cn(
                    "flex-1 px-4 py-3 rounded-xl text-sm font-bold capitalize transition-colors",
                    role === option
                      ? "bg-primary/10 text-primary ring-2 ring-inset ring-primary"
                      : "bg-surface-container-highest text-on-surface hover:bg-surface-container-high",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="block text-xs font-bold text-on-surface">
              Expires
            </span>
            <div
              role="radiogroup"
              aria-label="Expires"
              className="grid grid-cols-3 gap-2"
            >
              {EXPIRY_PRESETS.map((preset) => (
                <button
                  key={preset.days}
                  type="button"
                  role="radio"
                  aria-checked={expiresInDays === preset.days}
                  onClick={() => setExpiresInDays(preset.days)}
                  className={cn(
                    "px-3 py-3 rounded-xl text-sm font-bold transition-colors",
                    expiresInDays === preset.days
                      ? "bg-primary/10 text-primary ring-2 ring-inset ring-primary"
                      : "bg-surface-container-highest text-on-surface hover:bg-surface-container-high",
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <AdminButton
              type="submit"
              busy={create.isPending}
              icon={<Send className="w-4 h-4" />}
              disabled={create.isPending}
            >
              Create invitation
            </AdminButton>
          </div>
        </form>
      )}
    </Modal>
  );
};

export const InvitationsView = () => {
  const { data: invitations, isLoading } = useInvitations();
  const revoke = useRevokeInvitation();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<Invitation | null>(null);

  // Live ones first, then the record. Both in the same frame, because two
  // lists with two headings suggests two different kinds of thing.
  const sorted = React.useMemo(() => {
    if (!invitations) return [];
    const rank = (invitation: Invitation) =>
      invitationState(invitation) === "pending" ? 0 : 1;
    return [...invitations].sort(
      (a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt),
    );
  }, [invitations]);

  return (
    <AdminPage
      lead="An invitation is a link you send. Contrack has no mail, so the link travels however you already talk to the person, and it works exactly once."
      actions={
        <AdminButton
          icon={<MailPlus className="w-4 h-4" />}
          onClick={() => setCreating(true)}
        >
          New invitation
        </AdminButton>
      }
    >
      <AdminList
        isLoading={isLoading}
        isEmpty={!isLoading && sorted.length === 0}
        empty="No invitations yet. Create one to add somebody without setting their password yourself."
        header={
          <div className={cn("grid gap-4", COLUMNS)}>
            <span>For</span>
            <span>Status</span>
            <span>Expires</span>
            <span className="sr-only">Actions</span>
          </div>
        }
      >
        {sorted.map((invitation) => {
          const state = invitationState(invitation);
          const badge = STATE_TONES[state];
          return (
            <AdminRow key={invitation.id} columns={COLUMNS}>
              <div className="min-w-0">
                <p className="text-sm font-bold text-on-surface truncate">
                  {invitation.email || "Anyone with the link"}
                </p>
                <p className="text-xs text-on-surface-variant">
                  {invitation.role === "admin" ? "Admin" : "Member"} · created{" "}
                  {formatDay(invitation.createdAt)}
                </p>
              </div>

              <AdminCell label="Status">
                <Badge tone={badge.tone}>{badge.label}</Badge>
              </AdminCell>

              <AdminCell label="Expires">
                <span
                  className="text-xs text-on-surface-variant"
                  title={formatWhen(invitation.expiresAt)}
                >
                  {state === "accepted"
                    ? `Used ${formatDay(invitation.acceptedAt)}`
                    : formatDay(invitation.expiresAt)}
                </span>
              </AdminCell>

              <div className="sm:justify-self-end">
                {state === "pending" && (
                  <AdminButton
                    tone="danger"
                    onClick={() => setRevoking(invitation)}
                  >
                    Revoke
                  </AdminButton>
                )}
              </div>
            </AdminRow>
          );
        })}
      </AdminList>

      {/*
        Worth saying where it will be read. `invitations.invitedBy` is NOT
        NULL with ON DELETE CASCADE, so removing an admin removes the
        invitations they issued — including ones already sent and not yet
        opened. Somebody who deletes a departing colleague and then hears that
        a new starter's link no longer works deserves to have been told.
      */}
      <p className="flex items-start gap-2 text-xs text-on-surface-variant px-1 text-pretty">
        <Link2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        Deleting the admin who created a pending invitation revokes it. Issue
        replacements from an account that is staying.
      </p>

      <NewInvitationModal
        isOpen={creating}
        onClose={() => setCreating(false)}
      />

      <ConfirmDialog
        isOpen={revoking !== null}
        onClose={() => setRevoking(null)}
        busy={revoke.isPending}
        title="Revoke this invitation?"
        confirmLabel="Revoke invitation"
        description={
          <p>
            The link stops working immediately. Anyone who still has it sees
            that it is no longer valid, and nothing tells them why.
          </p>
        }
        onConfirm={() =>
          revoking &&
          revoke.mutate(revoking.id, {
            onSuccess: () => {
              setRevoking(null);
              toast.success("Invitation revoked");
            },
            onError: (error: Error) => toast.error(error.message),
          })
        }
      />
    </AdminPage>
  );
};
