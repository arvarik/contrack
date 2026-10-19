/** ImapFormModal: adds or edits a mailbox (IMAP) connector. */

import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Modal } from "../../../components/ui/Modal";
import { NO_AUTOCORRECT } from "../../../components/ui/SearchField";
import {
  useCreateConnector,
  useTestConnector,
  useUpdateConnector,
} from "../../../api/connectors";
import type {
  ConnectorDetail,
  ConnectorSummary,
} from "../../../../shared/connectors";
import { FORM_INPUT, TONE_WASH } from "../../../lib/styles";
import { cn, errorText } from "../../../lib/utils";
import {
  FIELD_HEADING,
  FormError,
  GhostThresholdField,
  LookbackField,
  SwitchTile,
  SyncScheduleField,
} from "./ConnectorFormFields";

/** Strips accidental `imap://` or `imaps://` scheme and trailing slashes. */
function normalizeImapHost(raw: string): string {
  return raw
    .trim()
    .replace(/^imaps?:\/\//i, "")
    .replace(/\/+$/, "");
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

interface ImapFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  connector?: ConnectorDetail | ConnectorSummary | null;
}

export const ImapFormModal: React.FC<ImapFormModalProps> = ({
  isOpen,
  onClose,
  connector,
}) => {
  const isEditing = Boolean(connector);

  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState<number>(993);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [folders, setFolders] = useState("INBOX");
  const [aliases, setAliases] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState<number>(30);
  const [lookbackDays, setLookbackDays] = useState<number>(90);
  const [rollup, setRollup] = useState(true);
  const [ghostThreshold, setGhostThreshold] = useState<number>(3);
  const [summaries, setSummaries] = useState(false);

  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const createConnector = useCreateConnector();
  const updateConnector = useUpdateConnector();
  const testConnector = useTestConnector();

  useEffect(() => {
    if (connector) {
      setName(connector.name);
      setIntervalMinutes(connector.intervalMinutes ?? 30);
      const cfg = (connector.config ?? {}) as Record<string, unknown>;
      setHost(typeof cfg.host === "string" ? cfg.host : "");
      setPort(typeof cfg.port === "number" ? cfg.port : 993);
      setUsername(typeof cfg.username === "string" ? cfg.username : "");
      setPassword("");
      setShowPassword(false);
      if (Array.isArray(cfg.folders)) {
        setFolders(cfg.folders.join(", "));
      } else {
        setFolders("INBOX");
      }
      if (Array.isArray(cfg.aliases)) {
        setAliases(cfg.aliases.join(", "));
      } else {
        setAliases("");
      }
      setLookbackDays(
        typeof cfg.lookbackDays === "number" ? cfg.lookbackDays : 90,
      );
      setRollup(cfg.rollup !== false);
      setGhostThreshold(
        typeof cfg.ghostThreshold === "number" ? cfg.ghostThreshold : 3,
      );
      setSummaries(Boolean(cfg.summaries));
    } else {
      setName("Personal Mail");
      setHost("");
      setPort(993);
      setUsername("");
      setPassword("");
      setShowPassword(false);
      setFolders("INBOX");
      setAliases("");
      setIntervalMinutes(30);
      setLookbackDays(90);
      setRollup(true);
      setGhostThreshold(3);
      setSummaries(false);
    }
    setTestResult(null);
    setFormError(null);
  }, [connector, isOpen]);

  const parsedFolders = folders
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const parsedAliases = aliases
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  /**
   * The settings the server stores. The test sends the same, because a test
   * that keeps the saved password must name the saved server and username.
   */
  const formConfig = () => ({
    host: normalizeImapHost(host),
    port,
    secure: port === 993,
    username: username.trim(),
    folders: parsedFolders.length ? parsedFolders : ["INBOX"],
    aliases: parsedAliases,
    lookbackDays,
    rollup,
    ghostThreshold,
    summaries,
  });

  const handleTest = async () => {
    setFormError(null);
    const cleanHost = normalizeImapHost(host);
    const trimmedUsername = username.trim();
    const hasPassword = password.trim().length > 0;

    if (!cleanHost) {
      setFormError("Enter an IMAP server host before testing");
      return;
    }
    if (!isValidPort(port)) {
      setFormError("Enter a valid port between 1 and 65535");
      return;
    }
    if (!trimmedUsername) {
      setFormError("Enter your username or email address before testing");
      return;
    }
    if (!isEditing && !hasPassword) {
      setFormError("Enter your app password before testing");
      return;
    }

    try {
      const res = await testConnector.mutateAsync({
        kind: "imap",
        config: formConfig(),
        // Editing with the field empty keeps the saved password, so the
        // test uses the saved one too.
        secret: hasPassword ? { password } : undefined,
        connectorId: !hasPassword && isEditing ? connector?.id : undefined,
      });
      setTestResult({ ok: true, message: res.detail });
      toast.success(res.detail);
    } catch (err) {
      const msg = errorText(err) || "Could not test the connection";
      setTestResult({ ok: false, message: msg });
      toast.error(`Could not test connection: ${errorText(err)}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = name.trim();
    const cleanHost = normalizeImapHost(host);
    const trimmedUsername = username.trim();
    const hasPassword = password.trim().length > 0;

    if (!trimmedName) {
      setFormError("Enter a name for this connector");
      return;
    }
    if (!cleanHost) {
      setFormError("Enter the IMAP server's host");
      return;
    }
    if (!isValidPort(port)) {
      setFormError("Enter a valid port between 1 and 65535");
      return;
    }
    if (!trimmedUsername) {
      setFormError("Enter your IMAP username or email");
      return;
    }
    if (!isEditing && !hasPassword) {
      setFormError("Enter your app password");
      return;
    }

    const config = formConfig();

    try {
      if (isEditing && connector) {
        await updateConnector.mutateAsync({
          id: connector.id,
          name: trimmedName,
          config,
          secret: hasPassword ? { password } : undefined,
          intervalMinutes,
        });
        toast.success(`Updated ${trimmedName}`);
      } else {
        const created = await createConnector.mutateAsync({
          kind: "imap",
          name: trimmedName,
          config,
          secret: { password },
          intervalMinutes,
        });
        // The server was busy or down for maintenance: the mailbox is saved,
        // and the scheduler tries again later.
        if (created.status === "error") {
          toast.warning(`Saved ${trimmedName}. Contrack tries again later`, {
            description: created.lastError,
          });
        } else {
          toast.success(`Connected ${trimmedName}`);
        }
      }
      onClose();
    } catch (err) {
      const msg = errorText(err) || "Could not save the connector";
      setFormError(msg);
      toast.error(`Could not save connector: ${errorText(err)}`);
    }
  };

  const isSaving = createConnector.isPending || updateConnector.isPending;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? `Edit ${connector?.name}` : "Connect mailbox (IMAP)"}
      size="md"
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4 pt-2">
        <div className="rounded-lg bg-surface-container p-3 text-xs text-on-surface-variant leading-relaxed">
          <p>
            <strong>Privacy:</strong> Syncs message headers only (From, To, Cc,
            Date, Subject). Message bodies are read only when AI summaries are
            on
          </p>
        </div>

        <FormError message={formError} />

        <div>
          <label htmlFor="imap-connector-name" className={FIELD_HEADING}>
            Connector name
          </label>
          <input
            id="imap-connector-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setFormError(null);
            }}
            placeholder="e.g. Fastmail personal, Gmail archive"
            className={FORM_INPUT}
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label htmlFor="imap-host" className={FIELD_HEADING}>
              IMAP host
            </label>
            <input
              id="imap-host"
              type="text"
              {...NO_AUTOCORRECT}
              value={host}
              onChange={(e) => {
                setHost(e.target.value);
                setTestResult(null);
                setFormError(null);
              }}
              placeholder="imap.fastmail.com"
              className={cn(FORM_INPUT, "font-mono")}
            />
          </div>
          <div>
            <label htmlFor="imap-port" className={FIELD_HEADING}>
              Port
            </label>
            <input
              id="imap-port"
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => {
                setPort(Number(e.target.value) || 0);
                setTestResult(null);
                setFormError(null);
              }}
              className={cn(FORM_INPUT, "font-mono")}
            />
          </div>
        </div>

        <div>
          <label htmlFor="imap-username" className={FIELD_HEADING}>
            Username / email
          </label>
          <input
            id="imap-username"
            type="text"
            {...NO_AUTOCORRECT}
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setTestResult(null);
              setFormError(null);
            }}
            placeholder="you@example.com"
            className={FORM_INPUT}
          />
        </div>

        <div>
          <label htmlFor="imap-password" className={FIELD_HEADING}>
            {isEditing
              ? "New password (leave blank to keep current)"
              : "App password"}
          </label>
          <div className="relative">
            <input
              id="imap-password"
              type={showPassword ? "text" : "password"}
              autoComplete="off"
              {...NO_AUTOCORRECT}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setTestResult(null);
                setFormError(null);
              }}
              placeholder={
                isEditing ? "••••••••••••••••" : "Paste your app password"
              }
              className={cn(FORM_INPUT, "pr-11 font-mono")}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="hit-area state-layer absolute right-1 top-1/2 -translate-y-1/2 p-2 rounded-lg text-on-surface-variant hover:text-on-surface transition-colors"
              title={showPassword ? "Hide password" : "Show password"}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <EyeOff className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Eye className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          </div>
          <p className="text-xs text-on-surface-variant mt-1">
            Most mail providers require an app-specific password instead of your
            main account password
          </p>
        </div>

        <div>
          <label htmlFor="imap-folders" className={FIELD_HEADING}>
            Folders to sync
          </label>
          <input
            id="imap-folders"
            type="text"
            {...NO_AUTOCORRECT}
            value={folders}
            onChange={(e) => setFolders(e.target.value)}
            placeholder="INBOX, Sent"
            className={FORM_INPUT}
          />
          <p className="text-xs text-on-surface-variant mt-1">
            Comma-separated mailbox names, such as INBOX, Sent
          </p>
        </div>

        <div>
          <label htmlFor="imap-aliases" className={FIELD_HEADING}>
            Also treat these addresses as mine
          </label>
          <input
            id="imap-aliases"
            type="text"
            {...NO_AUTOCORRECT}
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
            placeholder="alias@company.com, old@example.org"
            className={FORM_INPUT}
          />
          <p className="text-xs text-on-surface-variant mt-1">
            Mail sent from these addresses counts as sent by you
          </p>
        </div>

        <SyncScheduleField
          value={intervalMinutes}
          onChange={setIntervalMinutes}
        />
        <LookbackField value={lookbackDays} onChange={setLookbackDays} />

        <SwitchTile
          title="Roll up emails per contact per day"
          description="Consolidates multiple daily emails with the same person into one timeline entry"
          checked={rollup}
          onChange={setRollup}
        />

        <SwitchTile
          title="Generate AI summaries"
          description="Fetches email bodies for matched contacts to generate concise interaction notes"
          checked={summaries}
          onChange={setSummaries}
        />

        <GhostThresholdField
          id="imap-ghost-threshold"
          unit="messages"
          value={ghostThreshold}
          onChange={setGhostThreshold}
        />

        {testResult && (
          <div
            role="status"
            className={cn(
              "rounded-xl p-3 text-xs",
              TONE_WASH[testResult.ok ? "success" : "error"],
            )}
          >
            {testResult.message}
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={handleTest}
            disabled={testConnector.isPending || isSaving}
            className="btn-secondary"
          >
            {testConnector.isPending && (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            )}
            <span>Test connection</span>
          </button>

          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || testConnector.isPending}
              className="btn-primary"
            >
              {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{isEditing ? "Save changes" : "Connect"}</span>
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
};
