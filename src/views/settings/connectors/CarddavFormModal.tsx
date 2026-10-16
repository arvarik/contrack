/** CarddavFormModal: adds or edits a CardDAV address book connector. */

import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Modal } from "../../../components/ui/Modal";
import {
  Segmented,
  type SegmentedOption,
} from "../../../components/ui/Segmented";
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
  SyncScheduleField,
} from "./ConnectorFormFields";

interface CarddavFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  connector?: ConnectorDetail | ConnectorSummary | null;
}

type SyncDirection = "two_way" | "pull_only";

const SYNC_DIRECTIONS: SegmentedOption<SyncDirection>[] = [
  { value: "two_way", label: "Two-way sync" },
  { value: "pull_only", label: "Pull only" },
];

export const CarddavFormModal: React.FC<CarddavFormModalProps> = ({
  isOpen,
  onClose,
  connector,
}) => {
  const isEditing = Boolean(connector);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [syncDirection, setSyncDirection] = useState<SyncDirection>("two_way");
  const [addressBookUrl, setAddressBookUrl] = useState<string>("");
  const [addressBooks, setAddressBooks] = useState<
    Array<{ url: string; displayName: string; readOnly?: boolean }>
  >([]);
  const [intervalMinutes, setIntervalMinutes] = useState<number>(30);

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
      setUsername(typeof cfg.username === "string" ? cfg.username : "");
      setPassword("");
      setShowPassword(false);
      setSyncDirection(
        cfg.syncDirection === "pull_only" ? "pull_only" : "two_way",
      );
      setAddressBookUrl(
        typeof cfg.addressBookUrl === "string" ? cfg.addressBookUrl : "",
      );
    } else {
      setName("Personal Contacts");
      setUrl("");
      setUsername("");
      setPassword("");
      setShowPassword(false);
      setSyncDirection("two_way");
      setAddressBookUrl("");
      setIntervalMinutes(30);
    }
    setAddressBooks([]);
    setTestResult(null);
    setFormError(null);
  }, [connector, isOpen]);

  const formConfig = () => ({
    url: url.trim(),
    username: username.trim(),
    syncDirection,
    ...(addressBookUrl.trim() ? { addressBookUrl: addressBookUrl.trim() } : {}),
  });

  const handleTest = async () => {
    setFormError(null);
    if (!url.trim()) {
      setFormError("Enter a CardDAV server URL before testing");
      return;
    }
    if (!username.trim()) {
      setFormError("Enter your username or email address before testing");
      return;
    }
    if (!isEditing && !password) {
      setFormError("Enter your app password before testing");
      return;
    }

    try {
      const res = await testConnector.mutateAsync({
        kind: "carddav",
        config: formConfig(),
        secret: password ? { password } : undefined,
        connectorId: !password && isEditing ? connector?.id : undefined,
      });
      if (Array.isArray(res.addressBooks) && res.addressBooks.length > 0) {
        setAddressBooks(res.addressBooks);
        if (!addressBookUrl && res.addressBooks[0]?.url) {
          setAddressBookUrl(res.addressBooks[0].url);
        }
      }
      setTestResult({ ok: true, message: res.detail });
      toast.success(res.detail);
    } catch (err) {
      const msg = errorText(err) || "Could not test the connection";
      setTestResult({ ok: false, message: msg });
      toast.error(msg);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    const trimmedUsername = username.trim();

    if (!trimmedName) {
      setFormError("Enter a name for this connector");
      return;
    }
    if (!trimmedUrl) {
      setFormError("Enter the CardDAV server or address book URL");
      return;
    }
    if (!trimmedUsername) {
      setFormError("Enter your CardDAV username or email");
      return;
    }
    if (!isEditing && !password) {
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
          secret: password ? { password } : undefined,
          intervalMinutes,
        });
        toast.success(`Updated ${trimmedName}`);
      } else {
        await createConnector.mutateAsync({
          kind: "carddav",
          name: trimmedName,
          config,
          secret: { password },
          intervalMinutes,
        });
        toast.success(`Connected ${trimmedName}`);
      }
      onClose();
    } catch (err) {
      const msg = errorText(err) || "Could not save the connector";
      setFormError(msg);
      toast.error(msg);
    }
  };

  const isSaving = createConnector.isPending || updateConnector.isPending;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? `Edit ${connector?.name}` : "Connect CardDAV"}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4 pt-2">
        <div className="rounded-lg bg-surface-container p-3 text-xs text-on-surface-variant leading-relaxed">
          <p>
            <strong>Safe sync:</strong> Contrack discovers your address book
            automatically and never deletes contacts on your CardDAV server when
            you move a contact to the Trash
          </p>
        </div>

        <FormError message={formError} />

        <div>
          <label htmlFor="carddav-connector-name" className={FIELD_HEADING}>
            Connector name
          </label>
          <input
            id="carddav-connector-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Nextcloud contacts, iCloud, Fastmail"
            className={FORM_INPUT}
          />
        </div>

        <div>
          <label htmlFor="carddav-url" className={FIELD_HEADING}>
            Server or address book URL
          </label>
          <input
            id="carddav-url"
            type="url"
            {...NO_AUTOCORRECT}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://cloud.example.com or https://contacts.icloud.com"
            className={cn(FORM_INPUT, "font-mono")}
          />
          <p className="text-xs text-on-surface-variant mt-1">
            Paste your server root or a direct address book URL from Nextcloud,
            iCloud, Fastmail, Radicale or Baïkal
          </p>
        </div>

        <div>
          <label htmlFor="carddav-username" className={FIELD_HEADING}>
            Username / email
          </label>
          <input
            id="carddav-username"
            type="text"
            {...NO_AUTOCORRECT}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="you@example.com"
            className={FORM_INPUT}
          />
        </div>

        <div>
          <label htmlFor="carddav-password" className={FIELD_HEADING}>
            {isEditing
              ? "New password (leave blank to keep current)"
              : "App password"}
          </label>
          <div className="relative">
            <input
              id="carddav-password"
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
            Generate an app-specific password in Nextcloud, Apple ID, Fastmail
            or your server settings
          </p>
        </div>

        {addressBooks.length > 1 && (
          <div>
            <label htmlFor="carddav-addressbook" className={FIELD_HEADING}>
              Address book
            </label>
            <select
              id="carddav-addressbook"
              value={addressBookUrl}
              onChange={(e) => setAddressBookUrl(e.target.value)}
              className={FORM_INPUT}
            >
              {addressBooks.map((book) => (
                <option key={book.url} value={book.url}>
                  {book.displayName}
                  {book.readOnly ? " (read-only)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <span className={FIELD_HEADING}>Sync direction</span>
          <Segmented<SyncDirection>
            label="Sync direction"
            className="sm:w-fit"
            value={syncDirection}
            onChange={setSyncDirection}
            options={SYNC_DIRECTIONS}
          />
          <p className="text-xs text-on-surface-variant mt-1">
            {syncDirection === "two_way"
              ? "Imports remote cards and writes contacts you add or edit back to the server"
              : "Imports remote cards into Contrack without writing back to the server"}
          </p>
        </div>

        <SyncScheduleField
          value={intervalMinutes}
          onChange={setIntervalMinutes}
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
