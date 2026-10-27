/**
 * CorrespondentsView: people that connectors saw in mail or meetings who are
 * not contacts yet, each with "Add as contact" and "Ignore".
 *
 * "Add as contact" uses the name the mail or meeting gave. With only an
 * address it asks for a name first, filled in from the address, so no
 * contact is named by its email address.
 */

import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { EyeOff, Loader2, UserCheck, UserPlus, UserRound } from "lucide-react";
import {
  useCorrespondents,
  useIgnoreCorrespondent,
} from "../../../api/connectors";
import { useCreateContact } from "../../../api/contacts";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Modal } from "../../../components/ui/Modal";
import {
  NO_AUTOCORRECT,
  SearchField,
} from "../../../components/ui/SearchField";
import type { Correspondent } from "../../../../shared/connectors";
import { SETTINGS_PAGE } from "../layout";
import { formatRelative } from "../../../lib/datetime";
import {
  BTN_QUIET,
  CARD,
  DIALOG_ACTIONS,
  FORM_INPUT,
  FORM_LABEL,
  SECTION_HEADING,
  TONE_WASH,
} from "../../../lib/styles";
import { cn, errorText, plural } from "../../../lib/utils";
import { LoadFailed } from "../../../components/ui/LoadFailed";

/**
 * A name to start from, out of an address's local part: "rowan.vale" and
 * "rowan_vale+news" give "Rowan Vale". The person can change it.
 */
function nameFromAddress(email: string): string {
  return email
    .split("@")[0]
    .replace(/\+.*$/, "")
    .split(/[._-]+/)
    .filter((part) => /[a-z]/i.test(part))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

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
  const [searchQuery, setSearchQuery] = useState("");
  // A correspondent with only an address, and the name typed for them.
  const [naming, setNaming] = useState<Correspondent | null>(null);
  const [draftName, setDraftName] = useState("");

  const showFilter = (correspondents?.length ?? 0) > 5;
  const activeQuery = showFilter ? searchQuery.trim().toLowerCase() : "";

  const filteredCorrespondents = useMemo(() => {
    if (!correspondents) return [];
    if (!activeQuery) return correspondents;
    return correspondents.filter(
      (c) =>
        c.name?.toLowerCase().includes(activeQuery) ||
        c.email?.toLowerCase().includes(activeQuery) ||
        c.phone?.toLowerCase().includes(activeQuery) ||
        c.connectorName?.toLowerCase().includes(activeQuery),
    );
  }, [correspondents, activeQuery]);

  const askForName = (c: Correspondent) => {
    setNaming(c);
    setDraftName(c.email ? nameFromAddress(c.email) : "");
  };

  const handleAddContact = async (c: Correspondent, displayName: string) => {
    const key = `${c.connectorId}:${c.externalId}`;
    setProcessingId(key);

    try {
      await createContact.mutateAsync({
        name: displayName.trim(),
        emails: c.email ? [{ email: c.email.trim(), label: "work" }] : [],
        phones: c.phone ? [{ phone: c.phone.trim(), label: "mobile" }] : [],
      });
      // Mark the correspondent handled, so it leaves the list.
      await ignoreCorrespondent.mutateAsync({
        connectorId: c.connectorId,
        externalId: c.externalId,
      });
      toast.success(`Added ${displayName.trim()} as a contact`);
      void refetch();
    } catch (err) {
      toast.error(`Could not add ${displayName.trim()}: ${errorText(err)}`);
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
      toast.error(`Could not ignore ${displayName}: ${errorText(err)}`);
    } finally {
      setProcessingId(null);
    }
  };

  const hasCorrespondents = correspondents && correspondents.length > 0;
  const isAnyBusy = processingId !== null;

  return (
    <div className={cn(SETTINGS_PAGE, "space-y-4")}>
      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2
            aria-label="Loading correspondents"
            className="w-6 h-6 animate-spin text-primary"
          />
        </div>
      )}

      {isError && (
        <LoadFailed what="correspondents" onRetry={() => void refetch()} />
      )}

      {/* One card: a strip that counts them, then a row for each. */}
      {!isLoading && !isError && hasCorrespondents && (
        <>
          {showFilter && (
            <SearchField
              className="max-w-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter correspondents"
              aria-label="Filter correspondents"
              onClear={() => setSearchQuery("")}
              clearLabel="Clear filter text"
            />
          )}

          <div className={cn(CARD, "p-0")}>
            <p
              className={cn(
                SECTION_HEADING,
                "px-4 sm:px-6 py-3 bg-surface-container-low rounded-t-2xl",
              )}
            >
              {plural(correspondents.length, "person", "people")} to review
            </p>
            <div className="py-2 divide-y divide-surface-container/60">
              {filteredCorrespondents.length === 0 && activeQuery && (
                <p className="px-4 sm:px-6 py-4 text-sm text-on-surface-variant">
                  No correspondent matches &ldquo;{searchQuery.trim()}&rdquo;
                </p>
              )}
              {filteredCorrespondents.map((c) => {
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
                          Seen {plural(c.seenCount, "time", "times")}
                          {c.lastSeenAt &&
                            `, most recently ${formatRelative(c.lastSeenAt, "at an unknown time")}`}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                      <button
                        type="button"
                        disabled={isAnyBusy}
                        onClick={() => handleIgnore(c)}
                        className={BTN_QUIET}
                        aria-label={`Ignore ${primaryLabel}`}
                      >
                        <EyeOff aria-hidden="true" className="w-3.5 h-3.5" />
                        Ignore
                      </button>

                      <button
                        type="button"
                        disabled={isAnyBusy}
                        onClick={() =>
                          c.name ? handleAddContact(c, c.name) : askForName(c)
                        }
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
        </>
      )}

      <Modal
        isOpen={naming !== null}
        onClose={() => setNaming(null)}
        title="Add as contact"
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const name = draftName.trim();
            if (!naming || !name) return;
            setNaming(null);
            void handleAddContact(naming, name);
          }}
        >
          <div>
            <label htmlFor="correspondent-name" className={FORM_LABEL}>
              Name
            </label>
            <input
              id="correspondent-name"
              required
              {...NO_AUTOCORRECT}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              className={FORM_INPUT}
            />
            <p className="mt-1.5 text-xs text-on-surface-variant">
              {naming?.email ?? naming?.phone}
            </p>
          </div>
          <div className={DIALOG_ACTIONS}>
            <button
              type="button"
              onClick={() => setNaming(null)}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!draftName.trim()}
              className="btn-primary"
            >
              Add contact
            </button>
          </div>
        </form>
      </Modal>

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
