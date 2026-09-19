import React, { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  CheckSquare,
  Clock,
  UserPlus,
  Upload,
  FileText,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { CorvidMark } from "../brand/CorvidMark";
import { ScoreRingAvatar } from "../ScoreRingAvatar";
import { EmptyState } from "../ui/EmptyState";
import { ActionRow } from "../../views/pulse/cards/ActionRow";
import {
  buildUpNextQueue,
  type UpNextItem,
} from "../../views/pulse/lib/upNext";
import { getUpcomingBirthdays } from "../../views/pulse/lib/birthdays";
import { useDashboard, useContacts, useCompleteActionItem } from "../../api";
import { useRecentContacts } from "../../hooks/useRecentContacts";
import {
  openImportModal,
  openNewContactModal,
  openSmartPasteModal,
  openQuickNote,
} from "../../lib/appEvents";
import type { Contact } from "../../types";

export interface AddPersonAction {
  label: string;
  description?: string;
  onClick: () => void;
  icon: LucideIcon;
}

export interface StartPanelProps {
  upNextItems?: UpNextItem[];
  recentContacts?: Contact[];
  addPeopleActions?: AddPersonAction[];
  onCompleteUpNext?: (id: string) => void;
  onLogUpNext?: (contactId: string) => void;
  onOpenContact?: (contactId: string) => void;
}

export const StartPanel: React.FC<StartPanelProps> = ({
  upNextItems: propUpNextItems,
  recentContacts: propRecentContacts,
  addPeopleActions: propAddPeopleActions,
  onCompleteUpNext,
  onLogUpNext,
  onOpenContact,
}) => {
  const navigate = useNavigate();
  const { data: dashboard } = useDashboard();
  const { data: contacts = [] } = useContacts();
  const { recentIds } = useRecentContacts();
  const completeAction = useCompleteActionItem();

  // ── Up Next ─────────────────────────────────────────────────────────────
  const upcomingBirthdays = useMemo(() => {
    return getUpcomingBirthdays(contacts, new Date(), 14);
  }, [contacts]);

  const computedUpNext = useMemo(() => {
    if (!dashboard) return buildUpNextQueue({});
    return buildUpNextQueue({
      overdue: dashboard.overdue,
      dueToday: dashboard.dueToday,
      upcoming: dashboard.upcoming,
      birthdays: upcomingBirthdays,
      slipping: dashboard.atRisk,
    });
  }, [dashboard, upcomingBirthdays]);

  const displayedUpNext = useMemo(() => {
    if (propUpNextItems !== undefined) {
      return propUpNextItems.slice(0, 3);
    }
    return computedUpNext.items.slice(0, 3);
  }, [propUpNextItems, computedUpNext.items]);

  const handleComplete = (id: string) => {
    if (onCompleteUpNext) {
      onCompleteUpNext(id);
    } else {
      completeAction.mutate(id);
    }
  };

  const handleLog = (contactId: string) => {
    if (onLogUpNext) {
      onLogUpNext(contactId);
    } else {
      openQuickNote(contactId);
    }
  };

  const handleOpenContact = (contactId: string) => {
    if (onOpenContact) {
      onOpenContact(contactId);
    } else {
      navigate(`/contact/${contactId}`);
    }
  };

  // ── Recently viewed ─────────────────────────────────────────────────────
  const displayedRecentContacts = useMemo(() => {
    if (propRecentContacts !== undefined) {
      return propRecentContacts;
    }
    return recentIds
      .map((rid) => contacts.find((c) => c.id === rid && !c.isArchived))
      .filter((c): c is Contact => Boolean(c))
      .slice(0, 5);
  }, [propRecentContacts, recentIds, contacts]);

  // ── Add people ──────────────────────────────────────────────────────────
  const defaultAddActions: AddPersonAction[] = useMemo(
    () => [
      {
        label: "Import",
        description: "Bring in a CSV, vCard, or contacts from another service.",
        icon: Upload,
        onClick: () => openImportModal(),
      },
      {
        label: "New contact",
        description: "Add a single person with details, notes, and tags.",
        icon: UserPlus,
        onClick: () => openNewContactModal(),
      },
      {
        label: "Add from text",
        description: "Paste an email, signature, bio, or text snippet.",
        icon: FileText,
        onClick: () => openSmartPasteModal(),
      },
    ],
    [],
  );

  const displayedAddActions =
    propAddPeopleActions !== undefined
      ? propAddPeopleActions
      : defaultAddActions;

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto text-on-surface-variant bg-surface relative z-10 p-6 md:p-8">
      {/* Header */}
      <header className="flex flex-col items-center justify-center pt-4 pb-8 text-center shrink-0">
        <CorvidMark size={64} className="mb-3 text-primary/60" />
        <h2 className="text-xl font-headline font-semibold text-on-surface">
          No Contact Selected
        </h2>
        <p className="text-xs text-on-surface-variant mt-1">
          Select a person from the list or pick a starting action
        </p>
      </header>

      {/* Three columns */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 max-w-6xl w-full mx-auto pb-12">
        {/* Region 1: Up next */}
        <section
          aria-label="Up next"
          className="flex flex-col rounded-2xl bg-surface-container-low/40 border border-outline/10 p-4.5"
        >
          <h2 className="text-sm font-bold uppercase tracking-wider text-on-surface mb-3 flex items-center gap-2">
            <CheckSquare className="w-4 h-4 text-primary" />
            Up next
          </h2>

          {displayedUpNext.length > 0 ? (
            <div role="list" aria-label="Up next items" className="space-y-2">
              {displayedUpNext.map((item) => (
                <ActionRow
                  key={item.id}
                  item={item}
                  onComplete={handleComplete}
                  onLog={handleLog}
                  onOpenContact={handleOpenContact}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              level={3}
              icon={CheckSquare}
              title="Nothing due"
              body="Follow-ups you add from a note or a contact land here."
              action={{
                label: "Log an interaction",
                onClick: () => openQuickNote(),
                icon: Plus,
              }}
            />
          )}
        </section>

        {/* Region 2: Recently viewed */}
        <section
          aria-label="Recently viewed"
          className="flex flex-col rounded-2xl bg-surface-container-low/40 border border-outline/10 p-4.5"
        >
          <h2 className="text-sm font-bold uppercase tracking-wider text-on-surface mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            Recently viewed
          </h2>

          {displayedRecentContacts.length > 0 ? (
            <div
              role="list"
              aria-label="Recently viewed contacts"
              className="space-y-2"
            >
              {displayedRecentContacts.map((contact) => (
                <div role="listitem" key={contact.id}>
                  <Link
                    to={`/contact/${contact.id}`}
                    onClick={() => handleOpenContact(contact.id)}
                    className="w-full rounded-xl border border-outline/15 p-2.5 sm:p-3 flex items-center gap-3 transition-colors bg-surface-container-lowest hover:bg-surface-container-low cursor-pointer group"
                  >
                    <ScoreRingAvatar contact={contact} size={36} decorative />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-on-surface truncate group-hover:text-primary transition-colors">
                        {contact.name}
                      </div>
                      {(contact.role || contact.company) && (
                        <div className="text-xs text-on-surface-variant truncate">
                          {[contact.role, contact.company]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      )}
                    </div>
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              level={3}
              icon={Clock}
              title="No recently viewed contacts"
              body="Contacts you open appear here for quick access."
            />
          )}
        </section>

        {/* Region 3: Add people */}
        <section
          aria-label="Add people"
          className="flex flex-col rounded-2xl bg-surface-container-low/40 border border-outline/10 p-4.5"
        >
          <h2 className="text-sm font-bold uppercase tracking-wider text-on-surface mb-3 flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-primary" />
            Add people
          </h2>

          {displayedAddActions.length > 0 ? (
            <div
              role="list"
              aria-label="Add people actions"
              className="space-y-2"
            >
              {displayedAddActions.map((action) => (
                <div role="listitem" key={action.label}>
                  <button
                    type="button"
                    onClick={action.onClick}
                    className="w-full text-left p-3 rounded-xl border border-outline/15 bg-surface-container-lowest hover:bg-surface-container-low transition-colors group flex items-center gap-3 cursor-pointer"
                  >
                    <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 group-hover:bg-primary group-hover:text-on-primary transition-colors">
                      <action.icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-on-surface group-hover:text-primary transition-colors">
                        {action.label}
                      </div>
                      {action.description && (
                        <div className="text-xs text-on-surface-variant truncate">
                          {action.description}
                        </div>
                      )}
                    </div>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              level={3}
              icon={UserPlus}
              title="No actions available"
              body="Add contact actions will appear here."
            />
          )}
        </section>
      </div>
    </div>
  );
};
