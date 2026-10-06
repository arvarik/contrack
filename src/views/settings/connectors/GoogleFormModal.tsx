/**
 * GoogleFormModal: connects, reconnects or edits a Google Workspace
 * connector. A new connection starts the OAuth redirect. AI summaries ask
 * for the scope that reads message bodies.
 */

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AlertCircle, ArrowRight, Globe, Loader2 } from "lucide-react";
import { Modal } from "../../../components/ui/Modal";
import { Switch } from "../../../components/ui/Switch";
import { useAuth } from "../../../components/auth/AuthGate";
import { useConnectorKinds, useUpdateConnector } from "../../../api/connectors";
import type {
  ConnectorDetail,
  ConnectorSummary,
} from "../../../../shared/connectors";
import { FORM_INPUT } from "../../../lib/styles";
import { errorText } from "../../../lib/utils";
import {
  FIELD_HEADING,
  FormError,
  GhostThresholdField,
  LookbackField,
  SwitchTile,
  SyncScheduleField,
} from "./ConnectorFormFields";

interface GoogleFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  connector?: ConnectorDetail | ConnectorSummary | null;
}

export const GoogleFormModal: React.FC<GoogleFormModalProps> = ({
  isOpen,
  onClose,
  connector,
}) => {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { data: kinds, isLoading: isLoadingKinds } = useConnectorKinds();

  const isEditing = Boolean(connector);
  const isNeedsReauth = connector?.status === "needs_reauth";

  const googleKindInfo = kinds?.find((k) => k.kind === "google");
  const isConfiguredOnInstance = googleKindInfo?.configured === true;

  const [name, setName] = useState("");
  const [syncContacts, setSyncContacts] = useState(true);
  const [syncEmail, setSyncEmail] = useState(true);
  const [syncCalendar, setSyncCalendar] = useState(true);
  const [summaries, setSummaries] = useState(false);
  const [lookbackDays, setLookbackDays] = useState<number>(90);
  const [rollup, setRollup] = useState(true);
  const [ghostThreshold, setGhostThreshold] = useState<number>(3);
  const [intervalMinutes, setIntervalMinutes] = useState<number>(30);

  const [formError, setFormError] = useState<string | null>(null);

  const updateConnector = useUpdateConnector();

  useEffect(() => {
    if (connector) {
      setName(connector.name);
      setIntervalMinutes(connector.intervalMinutes ?? 30);
      const cfg = (connector.config ?? {}) as Record<string, unknown>;
      setSyncContacts(cfg.syncContacts !== false);
      setSyncEmail(cfg.syncEmail !== false);
      setSyncCalendar(cfg.syncCalendar !== false);
      setSummaries(Boolean(cfg.summaries));
      setLookbackDays(
        typeof cfg.lookbackDays === "number" ? cfg.lookbackDays : 90,
      );
      setRollup(cfg.rollup !== false);
      setGhostThreshold(
        typeof cfg.ghostThreshold === "number" ? cfg.ghostThreshold : 3,
      );
    } else {
      setName("Google Workspace");
      setSyncContacts(true);
      setSyncEmail(true);
      setSyncCalendar(true);
      setSummaries(false);
      setLookbackDays(90);
      setRollup(true);
      setGhostThreshold(3);
      setIntervalMinutes(30);
    }
    setFormError(null);
  }, [connector, isOpen]);

  const handleConnectRedirect = () => {
    const params = new URLSearchParams();
    if (summaries) {
      params.set("summaries", "true");
    }
    window.location.href = `/api/connectors/google/start?${params.toString()}`;
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connector) return;
    setFormError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError("Enter a name for this connector");
      return;
    }

    try {
      await updateConnector.mutateAsync({
        id: connector.id,
        name: trimmedName,
        config: {
          ...(connector.config as Record<string, unknown>),
          syncContacts,
          syncEmail,
          syncCalendar,
          summaries,
          lookbackDays,
          rollup,
          ghostThreshold,
        },
        intervalMinutes,
      });
      toast.success(`Updated ${trimmedName}`);
      onClose();
    } catch (err) {
      const msg = errorText(err) || "Could not save the connector";
      setFormError(msg);
      toast.error(msg);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        isEditing
          ? `Google Workspace (${connector?.name})`
          : "Connect Google Workspace"
      }
      size="md"
    >
      <div className="space-y-4 pt-2">
        <div className="rounded-lg bg-surface-container p-3 text-xs text-on-surface-variant leading-relaxed">
          <p>
            <strong>Privacy:</strong> Contrack connects directly to Google
            Workspace to sync contacts, email headers, and calendar events.
            Nothing leaves the server unless you turn on AI summaries
          </p>
        </div>

        <FormError message={formError} />

        {/* State 1: Instance OAuth not configured */}
        {!isLoadingKinds && !isConfiguredOnInstance && !isEditing && (
          <div className="rounded-xl bg-warning/10 p-4 space-y-3">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs font-semibold text-on-surface">
                  Google sign-in is not set up yet
                </p>
                <p className="text-xs text-on-surface-variant">
                  {isAdmin
                    ? "Add a Google OAuth client ID and secret in Settings → General, under Integrations, first"
                    : "Ask an administrator to add a Google OAuth client in Settings → General, under Integrations"}
                </p>
              </div>
            </div>

            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  navigate("/settings/admin/general#integrations");
                }}
                className="hit-area state-layer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-warning/20 text-on-surface transition-colors"
              >
                <span>Open Settings → General</span>
                <ArrowRight aria-hidden="true" className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* State 2: Needs reauth banner */}
        {isNeedsReauth && (
          <div className="rounded-xl bg-error/10 p-4 space-y-2">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-error shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-error">
                  Sign-in expired
                </p>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  {connector?.lastError ||
                    "Google no longer accepts this connection. Connect your account again"}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleConnectRedirect}
              className="btn-primary btn-sm shrink-0 mt-2"
            >
              Reconnect with Google
            </button>
          </div>
        )}

        {/* State 3: Creating new Google connector (OAuth redirect flow) */}
        {!isEditing && isConfiguredOnInstance && (
          <div className="space-y-4">
            <SwitchTile
              title="Generate AI summaries"
              description="Summaries require reading email message bodies (gmail.readonly scope). Without summaries, only message metadata headers are requested"
              checked={summaries}
              onChange={setSummaries}
            />

            <div className="pt-2">
              <button
                type="button"
                onClick={handleConnectRedirect}
                className="btn-primary w-full"
              >
                <Globe className="w-4 h-4" />
                <span>Connect Google Workspace</span>
              </button>
            </div>
          </div>
        )}

        {/* State 4: Editing existing Google connector */}
        {isEditing && (
          <form onSubmit={handleSaveConfig} className="space-y-4">
            <div>
              <label htmlFor="google-conn-name" className={FIELD_HEADING}>
                Connector name
              </label>
              <input
                id="google-conn-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={FORM_INPUT}
              />
            </div>

            <div className="space-y-2">
              <span className="block text-xs font-semibold text-on-surface">
                Synced data types
              </span>
              <div className="space-y-2">
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-surface-container">
                  <span className="text-xs text-on-surface font-medium">
                    Google Contacts (People API)
                  </span>
                  <Switch
                    checked={syncContacts}
                    onChange={setSyncContacts}
                    label="Sync Google Contacts"
                  />
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-surface-container">
                  <span className="text-xs text-on-surface font-medium">
                    Gmail messages
                  </span>
                  <Switch
                    checked={syncEmail}
                    onChange={setSyncEmail}
                    label="Sync Gmail messages"
                  />
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-surface-container">
                  <span className="text-xs text-on-surface font-medium">
                    Google Calendar events
                  </span>
                  <Switch
                    checked={syncCalendar}
                    onChange={setSyncCalendar}
                    label="Sync Google Calendar"
                  />
                </div>
              </div>
            </div>

            <SwitchTile
              title="AI message summaries"
              description="Extracts brief notes from messages exchanged with known contacts"
              checked={summaries}
              onChange={setSummaries}
            />

            <SyncScheduleField
              value={intervalMinutes}
              onChange={setIntervalMinutes}
            />
            <LookbackField value={lookbackDays} onChange={setLookbackDays} />

            <SwitchTile
              title="Roll up emails per contact per day"
              description="Consolidates daily emails with a contact into a single timeline row"
              checked={rollup}
              onChange={setRollup}
            />

            <GhostThresholdField
              id="google-ghost-threshold"
              unit="messages or meetings"
              value={ghostThreshold}
              onChange={setGhostThreshold}
            />

            <div className="flex items-center justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="btn-secondary">
                Cancel
              </button>
              <button
                type="submit"
                disabled={updateConnector.isPending}
                className="btn-primary"
              >
                {updateConnector.isPending && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                )}
                <span>Save changes</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
};
