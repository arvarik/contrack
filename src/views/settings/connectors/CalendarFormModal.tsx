/**
 * CalendarFormModal — modal form for adding or editing an ICS calendar connector.
 *
 * Captures private ICS URL (masked like a capability), sync interval, lookback period,
 * attendee filter, and description opt-in.
 *
 * @module views/settings/connectors/CalendarFormModal
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

interface CalendarFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  connector?: ConnectorDetail | ConnectorSummary | null;
  reconnectOnly?: boolean;
}

export const CalendarFormModal: React.FC<CalendarFormModalProps> = ({
  isOpen,
  onClose,
  connector,
}) => {
  const isEditing = Boolean(connector);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [showUrl, setShowUrl] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState<number>(30);
  const [lookbackDays, setLookbackDays] = useState<number>(90);
  const [maxAttendees, setMaxAttendees] = useState<number>(25);
  const [includeDescription, setIncludeDescription] = useState(false);
  const [ghostThreshold, setGhostThreshold] = useState<number>(3);

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
      setUrl(typeof cfg.url === "string" ? cfg.url : "");
      setLookbackDays(
        typeof cfg.lookbackDays === "number" ? cfg.lookbackDays : 90,
      );
      setMaxAttendees(
        typeof cfg.maxAttendees === "number" ? cfg.maxAttendees : 25,
      );
      setIncludeDescription(Boolean(cfg.includeDescription));
      setGhostThreshold(
        typeof cfg.ghostThreshold === "number" ? cfg.ghostThreshold : 3,
      );
    } else {
      setName("Personal Calendar");
      setUrl("");
      setShowUrl(false);
      setIntervalMinutes(30);
      setLookbackDays(90);
      setMaxAttendees(25);
      setIncludeDescription(false);
      setGhostThreshold(3);
    }
    setTestResult(null);
    setFormError(null);
  }, [connector, isOpen]);

  const handleTest = async () => {
    setFormError(null);
    if (!url.trim()) {
      setFormError("Enter an ICS calendar URL before testing.");
      return;
    }
    try {
      const res = await testConnector.mutateAsync({
        kind: "ics",
        config: {
          url: url.trim(),
          lookbackDays,
          maxAttendees,
          includeDescription,
        },
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
    const trimmedUrl = url.trim();

    if (!trimmedName) {
      setFormError("Please enter a name for this connector.");
      return;
    }
    if (!trimmedUrl) {
      setFormError("Please enter a private ICS calendar URL.");
      return;
    }

    const config = {
      url: trimmedUrl,
      lookbackDays,
      maxAttendees,
      includeDescription,
      ghostThreshold,
    };

    try {
      if (isEditing && connector) {
        await updateConnector.mutateAsync({
          id: connector.id,
          name: trimmedName,
          config,
          intervalMinutes,
        });
        toast.success(`Updated ${trimmedName}`);
      } else {
        await createConnector.mutateAsync({
          kind: "ics",
          name: trimmedName,
          config,
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
      title={isEditing ? `Edit ${connector?.name}` : "Connect Calendar"}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4 pt-2">
        {/* Privacy line */}
        <div className="rounded-lg bg-surface-container p-3 text-xs text-on-surface-variant border border-surface-container-high/40 leading-relaxed">
          <p>
            <strong>Privacy:</strong> Only event times, titles, and participant
            email addresses are imported. Event notes and descriptions remain on
            your device unless you opt in below.
          </p>
        </div>

        {/* Error message */}
        {formError && (
          <div
            role="alert"
            className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-xs text-error"
          >
            {formError}
          </div>
        )}

        {/* Name */}
        <div>
          <label
            htmlFor="connector-name"
            className="block text-xs font-semibold text-on-surface mb-1"
          >
            Connector name
          </label>
          <input
            id="connector-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Work Calendar, Personal iCloud"
            className="w-full rounded-xl bg-surface-container px-3 py-2 text-sm text-on-surface border border-surface-container-high/60 focus:outline-none focus:ring-2 focus:ring-primary min-h-[44px]"
          />
        </div>

        {/* ICS URL */}
        <div>
          <label
            htmlFor="connector-ics-url"
            className="block text-xs font-semibold text-on-surface mb-1"
          >
            Private ICS Calendar URL
          </label>
          <div className="relative">
            <input
              id="connector-ics-url"
              type={showUrl ? "text" : "password"}
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
              className="w-full rounded-xl bg-surface-container pl-3 pr-11 py-2 text-sm text-on-surface border border-surface-container-high/60 focus:outline-none focus:ring-2 focus:ring-primary min-h-[44px] font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => setShowUrl(!showUrl)}
              aria-label={showUrl ? "Hide URL" : "Show URL"}
              className="hit-area absolute right-1 top-1/2 -translate-y-1/2 p-2 text-on-surface-variant hover:text-on-surface focus:outline-none"
            >
              {showUrl ? (
                <EyeOff className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Eye className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          </div>
          <p className="mt-1 text-[11px] text-on-surface-variant">
            From Google, Apple iCloud, Fastmail, or Outlook. Look for
            &quot;Secret address in iCal format&quot; in your calendar settings.
          </p>
        </div>

        {/* Schedule */}
        <div>
          <span className="block text-xs font-semibold text-on-surface mb-1">
            Sync schedule
          </span>
          <Segmented<number>
            label="Sync schedule"
            value={intervalMinutes}
            onChange={setIntervalMinutes}
            options={[
              { value: 15, label: "15 min" },
              { value: 30, label: "30 min" },
              { value: 60, label: "Hourly" },
              { value: 1440, label: "Daily" },
            ]}
          />
        </div>

        {/* Initial lookback (for first run or backfill) */}
        <div>
          <span className="block text-xs font-semibold text-on-surface mb-1">
            Initial history lookback
          </span>
          <Segmented<number>
            label="Initial lookback"
            value={lookbackDays}
            onChange={setLookbackDays}
            options={[
              { value: 30, label: "30 days" },
              { value: 90, label: "90 days" },
              { value: 365, label: "1 year" },
            ]}
          />
        </div>

        {/* Max Attendees */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="connector-max-attendees"
              className="block text-xs font-semibold text-on-surface mb-1"
            >
              Skip events with more than
            </label>
            <div className="flex items-center gap-2">
              <input
                id="connector-max-attendees"
                type="number"
                min={1}
                max={500}
                value={maxAttendees}
                onChange={(e) =>
                  setMaxAttendees(
                    Math.max(1, parseInt(e.target.value, 10) || 25),
                  )
                }
                className="w-24 rounded-xl bg-surface-container px-3 py-2 text-sm text-on-surface border border-surface-container-high/60 focus:outline-none focus:ring-2 focus:ring-primary min-h-[44px]"
              />
              <span className="text-xs text-on-surface-variant">attendees</span>
            </div>
          </div>

          <div>
            <label
              htmlFor="connector-ghost-threshold"
              className="block text-xs font-semibold text-on-surface mb-1"
            >
              Ghost contact threshold
            </label>
            <div className="flex items-center gap-2">
              <input
                id="connector-ghost-threshold"
                type="number"
                min={1}
                max={10}
                value={ghostThreshold}
                onChange={(e) =>
                  setGhostThreshold(
                    Math.min(
                      10,
                      Math.max(1, parseInt(e.target.value, 10) || 3),
                    ),
                  )
                }
                className="w-24 rounded-xl bg-surface-container px-3 py-2 text-sm text-on-surface border border-surface-container-high/60 focus:outline-none focus:ring-2 focus:ring-primary min-h-[44px]"
              />
              <span className="text-xs text-on-surface-variant">
                interactions
              </span>
            </div>
          </div>
        </div>

        {/* Include description switch */}
        <div className="flex items-center justify-between gap-3 pt-2">
          <div>
            <span className="block text-xs font-semibold text-on-surface">
              Include event descriptions
            </span>
            <span className="block text-[11px] text-on-surface-variant">
              Imports agenda and notes text into interaction bodies.
            </span>
          </div>
          <Switch
            label="Include event descriptions"
            checked={includeDescription}
            onChange={setIncludeDescription}
          />
        </div>

        {/* Test Result Indicator */}
        {testResult && (
          <div
            role="status"
            className={`rounded-lg p-3 text-xs border ${
              testResult.ok
                ? "bg-emerald-500/10 border-emerald-500/20 text-success"
                : "bg-red-500/10 border-red-500/20 text-error"
            }`}
          >
            {testResult.message}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between gap-3 pt-4 border-t border-surface-container-high/40">
          <button
            type="button"
            onClick={handleTest}
            disabled={testConnector.isPending || isSaving}
            className="hit-area inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium bg-surface-container hover:bg-surface-container-high text-on-surface border border-surface-container-high transition-colors focus:outline-none focus:ring-2 focus:ring-primary min-h-[44px] disabled:opacity-50"
          >
            {testConnector.isPending ? (
              <>
                <Loader2
                  className="w-3.5 h-3.5 animate-spin"
                  aria-hidden="true"
                />
                <span>Testing…</span>
              </>
            ) : (
              <span>Test connection</span>
            )}
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="hit-area px-4 py-2 rounded-xl text-xs font-medium text-on-surface-variant hover:text-on-surface transition-colors min-h-[44px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="hit-area inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium bg-primary text-on-primary hover:bg-primary/90 transition-colors focus:outline-none focus:ring-2 focus:ring-primary min-h-[44px] disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <Loader2
                    className="w-3.5 h-3.5 animate-spin"
                    aria-hidden="true"
                  />
                  <span>Saving…</span>
                </>
              ) : (
                <span>{isEditing ? "Save changes" : "Connect"}</span>
              )}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
};
