/**
 * ImapFormModal — modal form for adding or editing a Mailbox (IMAP) connector.
 *
 * Captures host, port, credentials, folder list, self aliases, sync interval,
 * lookback days, rollup option, and AI summaries opt-in.
 *
 * @module views/settings/connectors/ImapFormModal
 */

import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Modal } from "../../../components/ui/Modal";
import { Segmented } from "../../../components/ui/Segmented";
import { Switch } from "../../../components/ui/Switch";
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
import { cn } from "../../../lib/utils";

interface ImapFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  connector?: ConnectorDetail | ConnectorSummary | null;
  reconnectOnly?: boolean;
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

  const handleTest = async () => {
    setFormError(null);
    if (!host.trim()) {
      setFormError("Enter an IMAP server host before testing.");
      return;
    }
    if (!username.trim()) {
      setFormError("Enter your username or email address before testing.");
      return;
    }
    if (!isEditing && !password) {
      setFormError("Enter your app password before testing.");
      return;
    }

    try {
      const res = await testConnector.mutateAsync({
        kind: "imap",
        config: {
          host: host.trim(),
          port,
          secure: port === 993,
          username: username.trim(),
          folders: parsedFolders.length ? parsedFolders : ["INBOX"],
          aliases: parsedAliases,
          lookbackDays,
          rollup,
          ghostThreshold,
          summaries,
          maxMessagesPerRun: 5000,
        },
        secret: password ? { password } : undefined,
      });
      setTestResult({ ok: true, message: res.detail });
      toast.success(res.detail);
    } catch (err) {
      const msg = (err as Error).message || "Connection test failed";
      setTestResult({ ok: false, message: msg });
      toast.error(msg);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = name.trim();
    const trimmedHost = host.trim();
    const trimmedUsername = username.trim();

    if (!trimmedName) {
      setFormError("Please enter a name for this connector.");
      return;
    }
    if (!trimmedHost) {
      setFormError("Please enter an IMAP server host.");
      return;
    }
    if (!trimmedUsername) {
      setFormError("Please enter your IMAP username or email.");
      return;
    }
    if (!isEditing && !password) {
      setFormError("Please enter your app password.");
      return;
    }

    const config = {
      host: trimmedHost,
      port,
      secure: port === 993,
      username: trimmedUsername,
      folders: parsedFolders.length ? parsedFolders : ["INBOX"],
      aliases: parsedAliases,
      lookbackDays,
      rollup,
      ghostThreshold,
      summaries,
      maxMessagesPerRun: 5000,
    };

    try {
      if (isEditing && connector) {
        await updateConnector.mutateAsync({
          id: connector.id,
          name: trimmedName,
          config,
          secret: password ? { password } : undefined,
          intervalMinutes,
        });
        toast.success(`Updated ${trimmedName}`);
      } else {
        await createConnector.mutateAsync({
          kind: "imap",
          name: trimmedName,
          config,
          secret: { password },
          intervalMinutes,
        });
        toast.success(`Connected ${trimmedName}`);
      }
      onClose();
    } catch (err) {
      const msg = (err as Error).message || "Failed to save connector";
      setFormError(msg);
      toast.error(msg);
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
      <form onSubmit={handleSubmit} className="space-y-4 pt-2">
        {/* Privacy line */}
        <div className="rounded-lg bg-surface-container p-3 text-xs text-on-surface-variant leading-relaxed">
          <p>
            <strong>Privacy:</strong> Headers only by default (From, To, Cc,
            Date, Subject). Bodies are read only to generate summaries for
            messages that match a contact.
          </p>
        </div>

        {/* Error message */}
        {formError && (
          <div
            role="alert"
            className={cn("rounded-lg p-3 text-xs", TONE_WASH.error)}
          >
            {formError}
          </div>
        )}

        {/* Name */}
        <div>
          <label
            htmlFor="imap-connector-name"
            className="block text-xs font-semibold text-on-surface mb-1"
          >
            Connector name
          </label>
          <input
            id="imap-connector-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Fastmail personal, Gmail archive"
            className={FORM_INPUT}
          />
        </div>

        {/* Host and Port */}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label
              htmlFor="imap-host"
              className="block text-xs font-semibold text-on-surface mb-1"
            >
              IMAP host
            </label>
            <input
              id="imap-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="imap.fastmail.com"
              className={cn(FORM_INPUT, "font-mono")}
            />
          </div>
          <div>
            <label
              htmlFor="imap-port"
              className="block text-xs font-semibold text-on-surface mb-1"
            >
              Port
            </label>
            <input
              id="imap-port"
              type="number"
              value={port}
              onChange={(e) => setPort(Number(e.target.value) || 993)}
              className={cn(FORM_INPUT, "font-mono")}
            />
          </div>
        </div>

        {/* Username */}
        <div>
          <label
            htmlFor="imap-username"
            className="block text-xs font-semibold text-on-surface mb-1"
          >
            Username / email
          </label>
          <input
            id="imap-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="you@example.com"
            className={FORM_INPUT}
          />
        </div>

        {/* App password */}
        <div>
          <label
            htmlFor="imap-password"
            className="block text-xs font-semibold text-on-surface mb-1"
          >
            {isEditing
              ? "New password (leave blank to keep current)"
              : "App password"}
          </label>
          <div className="relative">
            <input
              id="imap-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={
                isEditing ? "••••••••••••••••" : "Paste your app password"
              }
              className={cn(FORM_INPUT, "pr-10 font-mono")}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="state-layer absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md text-on-surface-variant hover:text-on-surface p-1 transition-colors"
              title={showPassword ? "Hide password" : "Show password"}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          </div>
          <p className="text-xs text-on-surface-variant mt-1">
            Generate an app-specific password in your mail provider settings
            (Gmail, iCloud, Fastmail, etc.).
          </p>
        </div>

        {/* Folders */}
        <div>
          <label
            htmlFor="imap-folders"
            className="block text-xs font-semibold text-on-surface mb-1"
          >
            Folders to sync
          </label>
          <input
            id="imap-folders"
            type="text"
            value={folders}
            onChange={(e) => setFolders(e.target.value)}
            placeholder="INBOX, Sent"
            className={FORM_INPUT}
          />
          <p className="text-xs text-on-surface-variant mt-1">
            Comma-separated list of mailboxes to scan (e.g. INBOX, Sent).
          </p>
        </div>

        {/* Aliases */}
        <div>
          <label
            htmlFor="imap-aliases"
            className="block text-xs font-semibold text-on-surface mb-1"
          >
            Also treat these addresses as mine
          </label>
          <input
            id="imap-aliases"
            type="text"
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
            placeholder="alias@company.com, old@example.org"
            className={FORM_INPUT}
          />
          <p className="text-xs text-on-surface-variant mt-1">
            Outgoing mail from these aliases will be counted as sent by you.
          </p>
        </div>

        {/* Sync schedule */}
        <div>
          <span className="block text-xs font-semibold text-on-surface mb-1">
            Sync schedule
          </span>
          <Segmented<number>
            label="Sync schedule"
            value={intervalMinutes}
            onChange={setIntervalMinutes}
            options={[
              { label: "15 min", value: 15 },
              { label: "30 min", value: 30 },
              { label: "Hourly", value: 60 },
              { label: "Daily", value: 1440 },
            ]}
          />
        </div>

        {/* Lookback period */}
        <div>
          <span className="block text-xs font-semibold text-on-surface mb-1">
            First sync goes back
          </span>
          <Segmented<number>
            label="First sync goes back"
            value={lookbackDays}
            onChange={setLookbackDays}
            options={[
              { label: "30 days", value: 30 },
              { label: "90 days", value: 90 },
              { label: "1 year", value: 365 },
            ]}
          />
        </div>

        {/* Rollup toggle */}
        <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-surface-container">
          <div>
            <span className="text-xs font-semibold text-on-surface block">
              Roll up emails per contact per day
            </span>
            <span className="text-xs text-on-surface-variant block mt-0.5">
              Consolidates multiple daily emails with the same person into one
              timeline entry.
            </span>
          </div>
          <Switch
            checked={rollup}
            onChange={setRollup}
            label="Roll up emails per contact per day"
          />
        </div>

        {/* AI summaries */}
        <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-surface-container">
          <div>
            <span className="text-xs font-semibold text-on-surface block">
              Generate AI summaries
            </span>
            <span className="text-xs text-on-surface-variant block mt-0.5">
              Fetches email bodies for matched contacts to generate concise
              interaction notes.
            </span>
          </div>
          <Switch
            checked={summaries}
            onChange={setSummaries}
            label="Generate AI summaries"
          />
        </div>

        {/* Ghost threshold */}
        <div>
          <label
            htmlFor="imap-ghost-threshold"
            className="block text-xs font-semibold text-on-surface mb-1"
          >
            Suggest a new person after
          </label>
          <div className="flex items-center gap-3">
            <input
              id="imap-ghost-threshold"
              type="number"
              min={1}
              max={10}
              value={ghostThreshold}
              onChange={(e) =>
                setGhostThreshold(
                  Math.max(1, Math.min(10, Number(e.target.value) || 3)),
                )
              }
              className={cn(FORM_INPUT, "w-20")}
            />
            <span className="text-xs text-on-surface-variant">messages</span>
          </div>
        </div>

        {/* Test Result feedback */}
        {testResult && (
          <div
            className={cn(
              "rounded-xl p-3 text-xs",
              TONE_WASH[testResult.ok ? "success" : "error"],
            )}
          >
            {testResult.message}
          </div>
        )}

        {/* Actions */}
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
            <button type="submit" disabled={isSaving} className="btn-primary">
              {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{isEditing ? "Save changes" : "Connect"}</span>
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
};
