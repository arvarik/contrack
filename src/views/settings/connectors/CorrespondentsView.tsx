/**
 * CorrespondentsView — Review unconfirmed correspondents discovered by connectors.
 *
 * Displays people seen in incoming/outgoing messages or calendar meetings who
 * are not yet contacts in Contrack. Provides 1-click "Add as contact" and "Ignore".
 *
 * @module views/settings/connectors/CorrespondentsView
 */

import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertCircle,
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
import { EmptyState } from "../../../components/ui/EmptyState";
import type { Correspondent } from "../../../../shared/connectors";
import { SETTINGS_PAGE } from "../layout";
import { formatRelative } from "../../../lib/datetime";
import {
  BTN_QUIET,
  CARD,
  SECTION_HEADING,
  TONE_WASH,
} from "../../../lib/styles";
import { cn } from "../../../lib/utils";

export const CorrespondentsView: React.FC = () => {
  const navigate = useNavigate();
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
    const displayName = c.name || c.email || c.phone || "Unknown correspondent";

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
    <div className={SETTINGS_PAGE}>
      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2
            aria-label="Loading correspondents"
            className="w-6 h-6 animate-spin text-primary"
          />
        </div>
      )}

      {isError && (
        <EmptyState
          icon={AlertCircle}
          tone="error"
          title="Correspondents did not load"
          body="Nothing has changed. Try again in a moment"
          action={{ label: "Try again", onClick: () => void refetch() }}
        />
      )}

      {/* One card: a strip that counts them, then a row for each. */}
      {!isLoading && !isError && hasCorrespondents && (
        <div className={cn(CARD, "p-0")}>
          <p
            className={cn(
              SECTION_HEADING,
              "px-4 sm:px-6 py-3 bg-surface-container-low rounded-t-2xl",
            )}
          >
            {correspondents.length}{" "}
            {correspondents.length === 1 ? "person" : "people"} to review
          </p>
          <div className="py-2">
            {correspondents.map((c) => {
              const key = `${c.connectorId}:${c.externalId}`;
              const isBusy = processingId === key;
              const primaryLabel = c.name || c.email || c.phone || "Unknown";
              const secondaryLabel = c.name ? c.email || c.phone : null;

              return (
                <div
                  key={key}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 sm:px-6 py-3"
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div
                      className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                        TONE_WASH.primary,
                      )}
                    >
                      <UserRound className="w-5 h-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-on-surface truncate">
                          {primaryLabel}
                        </span>
                        {c.connectorName && (
                          <span className="text-[11px] px-2 py-0.5 rounded-md bg-surface-container text-on-surface-variant font-medium">
                            {c.connectorName}
                          </span>
                        )}
                      </div>

                      {secondaryLabel && (
                        <p className="text-xs text-on-surface-variant truncate mt-0.5">
                          {secondaryLabel}
                        </p>
                      )}

                      {/* "Most recently yesterday" and "most recently last
                          week" read as English. "Last yesterday" did not. */}
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        Seen {c.seenCount}{" "}
                        {c.seenCount === 1 ? "time" : "times"}
                        {c.lastSeenAt &&
                          `, most recently ${formatRelative(c.lastSeenAt, "at an unknown time")}`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleIgnore(c)}
                      className={BTN_QUIET}
                      aria-label={`Ignore ${primaryLabel}`}
                    >
                      <EyeOff aria-hidden="true" className="w-3.5 h-3.5" />
                      Ignore
                    </button>

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleAddContact(c)}
                      className="btn-primary btn-sm"
                    >
                      {isBusy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <UserPlus className="w-3.5 h-3.5" />
                      )}
                      Add as contact
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!isLoading && !isError && !hasCorrespondents && (
        <EmptyState
          icon={UserCheck}
          title="No one to review"
          body="When a connector syncs mail or meetings with someone who is not a contact yet, they show up here"
          action={{
            label: "Open connectors",
            onClick: () => navigate("/settings/connectors"),
          }}
        />
      )}
    </div>
  );
};
