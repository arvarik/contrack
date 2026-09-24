/**
 * PasskeysCard — view, add, rename, and remove WebAuthn passkeys in Account settings.
 *
 * @module views/settings/account/PasskeysCard
 */
import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Check,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  listPasskeys,
  renamePasskey,
  removePasskey,
  registerPasskey,
  passkeysSupported,
  type PasskeySummary,
} from "../../../api/passkeys";
import { Badge } from "../../../components/ui/Badge";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { EmptyState } from "../../../components/ui/EmptyState";
import { ICON_BTN, TONE_WASH } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import { SETTINGS_CARD, SETTINGS_INPUT } from "../layout";

function formatWhen(iso: string): string {
  const date = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export const PasskeysCard = () => {
  const queryClient = useQueryClient();
  const isSupported = passkeysSupported();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<PasskeySummary | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["auth", "passkeys"],
    queryFn: listPasskeys,
    enabled: isSupported,
    staleTime: 30_000,
  });

  const passkeys = data?.passkeys ?? [];

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      renamePasskey(id, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth", "passkeys"] });
      setEditingId(null);
      toast.success("Passkey renamed");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => removePasskey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth", "passkeys"] });
      setDeleteTarget(null);
      toast.success("Passkey removed");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const handleAddPasskey = async () => {
    setIsAdding(true);
    try {
      await registerPasskey();
      queryClient.invalidateQueries({ queryKey: ["auth", "passkeys"] });
      toast.success("Passkey added");
    } catch (err: unknown) {
      const errName = (err as { name?: string })?.name;
      if (errName !== "AbortError" && errName !== "NotAllowedError") {
        toast.error(
          err instanceof Error ? err.message : "Failed to add passkey",
        );
      }
    } finally {
      setIsAdding(false);
    }
  };

  const startEditing = (passkey: PasskeySummary) => {
    setEditingId(passkey.id);
    setEditingName(passkey.name);
  };

  const submitRename = (id: string) => {
    const trimmed = editingName.trim();
    if (!trimmed) return;
    renameMutation.mutate({ id, name: trimmed });
  };

  if (!isSupported) {
    const currentOrigin =
      typeof window !== "undefined" ? window.location.origin : "";
    return (
      <div className={cn(SETTINGS_CARD, "space-y-1")}>
        <h3 className="text-sm font-bold text-on-surface">Passkeys</h3>
        <p className="text-sm text-on-surface-variant text-pretty">
          Passkeys need HTTPS or localhost. This page is open at{" "}
          <code>{currentOrigin}</code>
        </p>
      </div>
    );
  }

  return (
    <div className={cn(SETTINGS_CARD, "space-y-4")}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-on-surface">Passkeys</h3>
          <p className="text-xs sm:text-sm text-on-surface-variant text-pretty">
            Sign in to this Contrack with Face ID, Touch ID, or a security key
          </p>
        </div>
        {passkeys.length > 0 && (
          <button
            type="button"
            onClick={handleAddPasskey}
            disabled={isAdding}
            className="btn-secondary btn-sm shrink-0"
          >
            {isAdding ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            Add a passkey
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-on-surface-variant">Loading passkeys…</p>
      ) : passkeys.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No passkeys yet"
          body="No passkeys yet. Add one to sign in without typing a password"
          action={{
            label: isAdding ? "Waiting for device…" : "Add a passkey",
            onClick: handleAddPasskey,
            icon: isAdding ? Loader2 : Plus,
          }}
          level={3}
        />
      ) : (
        <ul className="space-y-4">
          {passkeys.map((passkey) => (
            <li
              key={passkey.id}
              className="flex items-center justify-between gap-3"
            >
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <span
                  className={cn(
                    "shrink-0 w-9 h-9 rounded-xl flex items-center justify-center mt-0.5",
                    TONE_WASH.primary,
                  )}
                >
                  <KeyRound className="w-[18px] h-[18px]" />
                </span>
                <div className="flex-1 min-w-0">
                  {editingId === passkey.id ? (
                    <div className="flex items-center gap-2 max-w-sm">
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitRename(passkey.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        aria-label={`Rename passkey ${passkey.name}`}
                        // eslint-disable-next-line jsx-a11y/no-autofocus
                        autoFocus
                        className={cn(SETTINGS_INPUT, "flex-1 min-w-0")}
                      />
                      <button
                        type="button"
                        onClick={() => submitRename(passkey.id)}
                        disabled={renameMutation.isPending}
                        className="btn-primary btn-sm btn-icon"
                        aria-label="Save name"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="btn-secondary btn-sm btn-icon"
                        aria-label="Cancel rename"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-on-surface truncate">
                        {passkey.name}
                      </p>
                      <Badge tone="neutral">
                        {passkey.backedUp ||
                        passkey.deviceType === "multiDevice"
                          ? "Synced"
                          : "This device only"}
                      </Badge>
                    </div>
                  )}
                  <p className="text-xs text-on-surface-variant">
                    Added {formatWhen(passkey.createdAt)} ·{" "}
                    {passkey.lastUsedAt
                      ? `Last used ${formatWhen(passkey.lastUsedAt)}`
                      : "Never used"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => startEditing(passkey)}
                  className={ICON_BTN}
                  aria-label={`Rename ${passkey.name}`}
                  title="Rename"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(passkey)}
                  className={cn(ICON_BTN, "hover:text-error")}
                  aria-label={`Remove ${passkey.name}`}
                  title="Remove"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) removeMutation.mutate(deleteTarget.id);
        }}
        title="Remove passkey"
        description={`You can no longer sign in with ${deleteTarget?.name ?? "it"}`}
        confirmLabel="Remove passkey"
        tone="danger"
        busy={removeMutation.isPending}
      />
    </div>
  );
};
