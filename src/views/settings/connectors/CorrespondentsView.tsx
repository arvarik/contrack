/**
 * CorrespondentsView — Review unconfirmed correspondents discovered by connectors.
 *
 * Displays people seen in incoming/outgoing messages or calendar meetings who
 * are not yet contacts in Contrack. Provides 1-click "Add as contact" and "Ignore".
 *
 * @module views/settings/connectors/CorrespondentsView
 */

import React, { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  EyeOff,
  Loader2,
  UserCheck,
  UserPlus,
  UserRound,
} from "lucide-react";
import {
  useCorrespondents,
  useIgnoreCorrespondent,
} from "../../../api/connectors";
import { useCreateContact } from "../../../api/contacts";
import { Badge } from "../../../components/ui/Badge";
import type { Correspondent } from "../../../../shared/connectors";

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export const CorrespondentsView: React.FC = () => {
  const {
    data: correspondents,
    isLoading,
    isError,
    refetch,
  } = useCorrespondents(200);

  const createContact = useCreateContact();
  const ignoreCorrespondent = useIgnoreCorrespondent();

  const [processingId, setProcessingId] = useState<string | null>(null);

  const handleAddContact = async (c: Correspondent) => {
    const key = `${c.connectorId}:${c.externalId}`;
    setProcessingId(key);
    const displayName = c.name || c.email || c.phone || "Unknown Correspondent";

    try {
      await createContact.mutateAsync({
        name: displayName,
        emails: c.email ? [{ email: c.email, label: "work" }] : [],
        phones: c.phone ? [{ phone: c.phone, label: "mobile" }] : [],
      });
      // Also automatically mark as ignored/linked in the correspondents link so it vanishes
      await ignoreCorrespondent.mutateAsync({
        connectorId: c.connectorId,
        externalId: c.externalId,
      });
      toast.success(`Added ${displayName} as a contact`);
      void refetch();
    } catch (err) {
      toast.error((err as Error).message || "Failed to add contact");
    } finally {
      setProcessingId(null);
    }
  };

  const handleIgnore = async (c: Correspondent) => {
    const key = `${c.connectorId}:${c.externalId}`;
    setProcessingId(key);
    const displayName = c.name || c.email || c.phone || "Correspondent";

    try {
      await ignoreCorrespondent.mutateAsync({
        connectorId: c.connectorId,
        externalId: c.externalId,
      });
      toast.success(`Ignored ${displayName}`);
      void refetch();
    } catch (err) {
      toast.error((err as Error).message || "Failed to ignore correspondent");
    } finally {
      setProcessingId(null);
    }
  };

  const hasCorrespondents = correspondents && correspondents.length > 0;

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-16">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Link
            to="/settings/connectors"
            className="hit-area inline-flex items-center gap-1 text-xs font-medium text-on-surface-variant hover:text-on-surface transition-colors min-h-[44px]"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Connectors</span>
          </Link>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-on-surface-variant">
              People you talk to who are not in Contrack yet. Add them as
              contacts or ignore them.
            </p>
          </div>
          {hasCorrespondents && (
            <Badge tone="primary">
              {correspondents.length}{" "}
              {correspondents.length === 1 ? "person" : "people"}
            </Badge>
          )}
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-16 text-on-surface-variant">
          <Loader2 className="w-6 h-6 animate-spin mr-2" aria-hidden="true" />
          <span className="text-sm">Loading correspondents…</span>
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div
          role="alert"
          className="rounded-2xl bg-red-500/10 border border-red-500/20 p-6 text-center space-y-3"
        >
          <p className="text-sm font-semibold text-error">
            Failed to load correspondents
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="hit-area px-4 py-2 rounded-xl text-xs font-medium bg-surface-container text-on-surface hover:bg-surface-container-high transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Populated list */}
      {!isLoading && !isError && hasCorrespondents && (
        <div className="space-y-3">
          {correspondents.map((c) => {
            const key = `${c.connectorId}:${c.externalId}`;
            const isBusy = processingId === key;
            const primaryLabel = c.name || c.email || c.phone || "Unknown";
            const secondaryLabel = c.name ? c.email || c.phone : null;

            return (
              <div
                key={key}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-surface-container-lowest border border-outline/10 hover:border-outline/20 transition-all shadow-sm"
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
                    <UserRound className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-on-surface truncate">
                        {primaryLabel}
                      </span>
                      {c.connectorName && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant font-medium">
                          {c.connectorName}
                        </span>
                      )}
                    </div>

                    {secondaryLabel && (
                      <p className="text-xs text-on-surface-variant truncate mt-0.5">
                        {secondaryLabel}
                      </p>
                    )}

                    <div className="flex items-center gap-3 text-[11px] text-on-surface-variant/80 mt-1 flex-wrap">
                      <span>
                        Seen {c.seenCount}{" "}
                        {c.seenCount === 1 ? "time" : "times"}
                      </span>
                      <span>•</span>
                      <span>Last seen {formatRelativeTime(c.lastSeenAt)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center shrink-0 pt-2 sm:pt-0">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleIgnore(c)}
                    className="hit-area inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-on-surface-variant hover:text-danger hover:bg-danger/10 transition-colors focus:outline-none focus:ring-2 focus:ring-danger min-h-[44px]"
                    title="Ignore this correspondent"
                  >
                    <EyeOff className="w-3.5 h-3.5" />
                    <span>Ignore</span>
                  </button>

                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleAddContact(c)}
                    className="hit-area inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium bg-primary text-on-primary hover:bg-primary/90 transition-colors focus:outline-none focus:ring-2 focus:ring-primary min-h-[44px]"
                  >
                    {isBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <UserPlus className="w-3.5 h-3.5" />
                    )}
                    <span>Add as contact</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && !hasCorrespondents && (
        <div className="rounded-2xl bg-surface-container border border-surface-container-high/60 p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto">
            <UserCheck className="w-6 h-6" aria-hidden="true" />
          </div>
          <div className="space-y-1 max-w-sm mx-auto">
            <h2 className="text-base font-semibold text-on-surface">
              No unreviewed correspondents
            </h2>
            <p className="text-xs text-on-surface-variant">
              When your connectors sync emails or meetings with people not in
              your contacts, they will appear here for you to review and add.
            </p>
          </div>
          <div className="pt-2">
            <Link
              to="/settings/connectors"
              className="hit-area inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-surface-container-high hover:bg-surface-container-highest text-on-surface transition-colors min-h-[44px]"
            >
              <span>View connected accounts</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
};
