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
import { Plus, Cable, Loader2, Users } from "lucide-react";
import {
  useConnectors,
  useConnectorKinds,
  useCorrespondents,
} from "../../../api/connectors";
import { ConnectorCard } from "./ConnectorCard";
import { AddConnectorSheet } from "./AddConnectorSheet";
import { CalendarFormModal } from "./CalendarFormModal";
import { ImapFormModal } from "./ImapFormModal";
import { GoogleFormModal } from "./GoogleFormModal";
import { RunHistoryDrawer } from "./RunHistoryDrawer";
import { SETTINGS_PAGE } from "../layout";
import { CARD, TONE_WASH } from "../../../lib/styles";
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
      toast.success("Google Workspace connected successfully!");
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
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-sm text-on-surface-variant text-pretty">
            Calendar, mailbox, Google, messages. Sync who you talk to.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Link to="/settings/connectors/people" className="btn-secondary">
            <Users
              className="w-4 h-4 text-on-surface-variant"
              aria-hidden="true"
            />
            <span>Correspondents</span>
            {correspondentCount > 0 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-xs font-bold bg-primary text-on-primary">
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
              <span>Add connector</span>
            </button>
          )}
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-16 text-on-surface-variant">
          <Loader2 className="w-6 h-6 animate-spin mr-2" aria-hidden="true" />
          <span className="text-sm">Loading connectors…</span>
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div
          role="alert"
          className={cn(
            "rounded-2xl p-6 text-center space-y-3",
            TONE_WASH.error,
          )}
        >
          <p className="text-sm font-semibold text-error">
            Failed to load connectors
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="btn-secondary btn-sm"
          >
            Retry
          </button>
        </div>
      )}

      {/* Populated list */}
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

      {/* Empty state: show gallery directly with intro */}
      {!isLoading && !isError && !hasConnectors && (
        <div className={cn(CARD, "space-y-6")}>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                  TONE_WASH.primary,
                )}
              >
                <Cable className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-on-surface">
                  Get started with connectors
                </h2>
                <p className="text-xs text-on-surface-variant">
                  Contrack learns who you talk to from your calendar and email.
                  Nothing leaves this server unless you turn on AI summaries.
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 pt-2">
            {(kinds ?? []).map((k) => (
              <div
                key={k.kind}
                className="flex items-start justify-between gap-4 p-4 rounded-xl bg-surface-container-low"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-on-surface">
                      {k.label}
                    </h3>
                  </div>
                  <p className="text-xs text-on-surface-variant mt-1">
                    {k.description}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleSelectKind(k.kind)}
                  className="btn-primary btn-sm shrink-0"
                >
                  Connect
                </button>
              </div>
            ))}
          </div>
        </div>
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
