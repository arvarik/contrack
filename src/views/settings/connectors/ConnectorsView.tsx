/**
 * ConnectorsView — Settings view for managing data connectors.
 *
 * Provides a gallery for adding new sources (Calendar, IMAP, Google, etc.),
 * lists active connectors with status and next sync schedules, and exposes
 * run history inspection and manual sync triggers.
 *
 * @module views/settings/connectors/ConnectorsView
 */

import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AlertCircle, Calendar, Loader2, Plus, Users } from "lucide-react";
import {
  useConnectors,
  useConnectorKinds,
  useCorrespondents,
} from "../../../api/connectors";
import { ConnectorCard } from "./ConnectorCard";
import { AddConnectorSheet, KIND_ICONS } from "./AddConnectorSheet";
import { CalendarFormModal } from "./CalendarFormModal";
import { ImapFormModal } from "./ImapFormModal";
import { GoogleFormModal } from "./GoogleFormModal";
import { RunHistoryDrawer } from "./RunHistoryDrawer";
import { SettingsHeaderActions } from "../SettingsHeader";
import { EmptyState } from "../../../components/ui/EmptyState";
import {
  SETTINGS_CARD,
  SETTINGS_PAGE,
  SETTINGS_SECTION_HEADING,
} from "../layout";
import { TONE_WASH } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import type {
  ConnectorKind,
  ConnectorSummary,
} from "../../../../shared/connectors";

export const ConnectorsView: React.FC = () => {
  const { data: connectors, isLoading, isError, refetch } = useConnectors();
  const { data: kinds } = useConnectorKinds();
  const { data: correspondents } = useCorrespondents(50) ?? {};

  const [searchParams, setSearchParams] = useSearchParams();

  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [calendarModalOpen, setCalendarModalOpen] = useState(false);
  const [imapModalOpen, setImapModalOpen] = useState(false);
  const [googleModalOpen, setGoogleModalOpen] = useState(false);
  const [editingConnector, setEditingConnector] =
    useState<ConnectorSummary | null>(null);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [historyConnector, setHistoryConnector] =
    useState<ConnectorSummary | null>(null);

  useEffect(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    if (connected === "google") {
      toast.success("Google Workspace connected");
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("connected");
          return next;
        },
        { replace: true },
      );
    } else if (error) {
      toast.error(`Google connection failed: ${error}`);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("error");
          return next;
        },
        { replace: true },
      );
    }
  }, [searchParams, setSearchParams]);

  const handleSelectKind = (kind: ConnectorKind) => {
    setAddSheetOpen(false);
    setEditingConnector(null);
    if (kind === "ics") {
      setCalendarModalOpen(true);
    } else if (kind === "imap") {
      setImapModalOpen(true);
    } else if (kind === "google") {
      setGoogleModalOpen(true);
    }
  };

  const handleEdit = (c: ConnectorSummary) => {
    setEditingConnector(c);
    if (c.kind === "ics") {
      setCalendarModalOpen(true);
    } else if (c.kind === "imap") {
      setImapModalOpen(true);
    } else if (c.kind === "google") {
      setGoogleModalOpen(true);
    }
  };

  const handleShowRuns = (c: ConnectorSummary) => {
    setHistoryConnector(c);
    setHistoryDrawerOpen(true);
  };

  const hasConnectors = connectors && connectors.length > 0;
  const correspondentCount = correspondents?.length ?? 0;

  return (
    <div className={cn(SETTINGS_PAGE, "space-y-6")}>
      <SettingsHeaderActions>
        {/* On a phone the word gives way to the glyph on a square face, so
            the title's description keeps the width of the screen. */}
        <Link
          to="/settings/connectors/people"
          aria-label={
            correspondentCount > 0
              ? `Correspondents, ${correspondentCount} to review`
              : "Correspondents"
          }
          className="btn-secondary btn-icon sm:hidden"
        >
          <Users className="w-4 h-4" aria-hidden="true" />
        </Link>
        <Link
          to="/settings/connectors/people"
          className="btn-secondary hidden sm:inline-flex"
        >
          <Users
            className="w-4 h-4 text-on-surface-variant"
            aria-hidden="true"
          />
          Correspondents
          {correspondentCount > 0 && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-xs font-bold bg-primary/10 text-on-primary-wash tabular-nums">
              {correspondentCount}
            </span>
          )}
        </Link>
        {hasConnectors && (
          <button
            type="button"
            onClick={() => setAddSheetOpen(true)}
            className="btn-primary"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span className="sm:hidden">Add</span>
            <span className="hidden sm:inline">Add connector</span>
          </button>
        )}
      </SettingsHeaderActions>

      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2
            aria-label="Loading connectors"
            className="w-6 h-6 animate-spin text-primary"
          />
        </div>
      )}

      {isError && (
        <EmptyState
          icon={AlertCircle}
          tone="error"
          title="Connectors did not load"
          body="Nothing has changed. Try again in a moment"
          action={{ label: "Try again", onClick: () => void refetch() }}
        />
      )}

      {!isLoading && !isError && hasConnectors && (
        <div className="grid gap-3">
          {connectors.map((connector) => (
            <ConnectorCard
              key={connector.id}
              connector={connector}
              onEdit={handleEdit}
              onShowRuns={handleShowRuns}
            />
          ))}
        </div>
      )}

      {/* Nothing connected yet: the choices, on the page. */}
      {!isLoading && !isError && !hasConnectors && (
        <section aria-labelledby="add-connector">
          <h2 id="add-connector" className={SETTINGS_SECTION_HEADING}>
            Add a connector
          </h2>
          <div className={cn(SETTINGS_CARD, "space-y-4")}>
            <p className="text-sm text-on-surface-variant text-pretty">
              Contrack learns who you talk to from your calendar and your mail.
              Nothing leaves this server unless you turn on AI summaries
            </p>
            {/* A row for each kind, with its own Connect: three equal
                choices, so none of them is the page's one primary. */}
            <ul className="grid gap-2">
              {(kinds ?? []).map((k) => {
                const Icon = KIND_ICONS[k.kind] ?? Calendar;
                return (
                  <li
                    key={k.kind}
                    className="flex items-center gap-3 p-3.5 rounded-xl bg-surface-container-low"
                  >
                    <span
                      className={cn(
                        "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                        TONE_WASH.primary,
                      )}
                    >
                      <Icon className="w-5 h-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-on-surface">
                        {k.label}
                      </h3>
                      <p className="text-xs text-on-surface-variant mt-0.5 text-pretty">
                        {k.description}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSelectKind(k.kind)}
                      aria-label={`Connect ${k.label}`}
                      className="btn-secondary btn-sm shrink-0"
                    >
                      Connect
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      {/* Add connector sheet */}
      <AddConnectorSheet
        isOpen={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        onSelectKind={handleSelectKind}
      />

      {/* Calendar form modal */}
      <CalendarFormModal
        isOpen={calendarModalOpen}
        onClose={() => {
          setCalendarModalOpen(false);
          setEditingConnector(null);
        }}
        connector={editingConnector?.kind === "ics" ? editingConnector : null}
      />

      {/* IMAP form modal */}
      <ImapFormModal
        isOpen={imapModalOpen}
        onClose={() => {
          setImapModalOpen(false);
          setEditingConnector(null);
        }}
        connector={editingConnector?.kind === "imap" ? editingConnector : null}
      />

      {/* Google form modal */}
      <GoogleFormModal
        isOpen={googleModalOpen}
        onClose={() => {
          setGoogleModalOpen(false);
          setEditingConnector(null);
        }}
        connector={
          editingConnector?.kind === "google" ? editingConnector : null
        }
      />

      {/* Run history drawer */}
      <RunHistoryDrawer
        isOpen={historyDrawerOpen}
        onClose={() => {
          setHistoryDrawerOpen(false);
          setHistoryConnector(null);
        }}
        connector={historyConnector}
      />
    </div>
  );
};
