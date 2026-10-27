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
  isValidHttpUrl,
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

function hasSameOrigin(urlA: string, urlB: string): boolean {
  try {
    return new URL(urlA.trim()).origin === new URL(urlB.trim()).origin;
  } catch {
    return false;
  }
}

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

  const existingCfg = (connector?.config ?? {}) as Record<string, unknown>;
  const formConfig = () => ({
    ...(typeof existingCfg.pushExistingContacts === "boolean"
      ? { pushExistingContacts: existingCfg.pushExistingContacts }
      : {}),
    url: url.trim(),
    username: username.trim(),
    syncDirection,
    ...(addressBookUrl.trim() ? { addressBookUrl: addressBookUrl.trim() } : {}),
  });

  const handleTest = async () => {
    setFormError(null);
    const trimmedUrl = url.trim();
    const trimmedUsername = username.trim();
    const hasPassword = password.trim().length > 0;

    if (!trimmedUrl) {
      setFormError("Enter a CardDAV server URL before testing");
      return;
    }
    if (!isValidHttpUrl(trimmedUrl)) {
      setFormError("Enter a valid https:// or http:// server URL");
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
        kind: "carddav",
        config: formConfig(),
        secret: hasPassword ? { password } : undefined,
        connectorId: !hasPassword && isEditing ? connector?.id : undefined,
      });
      if (Array.isArray(res.addressBooks) && res.addressBooks.length > 0) {
        setAddressBooks(res.addressBooks);
        const stillValid = res.addressBooks.some(
          (b) => b.url === addressBookUrl,
        );
        if ((!addressBookUrl || !stillValid) && res.addressBooks[0]?.url) {
          setAddressBookUrl(res.addressBooks[0].url);
        }
      }
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
    const trimmedUrl = url.trim();
    const trimmedUsername = username.trim();
    const hasPassword = password.trim().length > 0;

    if (!trimmedName) {
      setFormError("Enter a name for this connector");
      return;
    }
    if (!trimmedUrl) {
      setFormError("Enter the CardDAV server or address book URL");
      return;
    }
    if (!isValidHttpUrl(trimmedUrl)) {
      setFormError("Enter a valid https:// or http:// server URL");
      return;
    }
    if (!trimmedUsername) {
      setFormError("Enter your CardDAV username or email");
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
      toast.error(`Could not save connector: ${errorText(err)}`);
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
            <strong>Safe sync:</strong> Auto-discovers your address book and
            never deletes contacts on your server when you move someone to Trash
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
            onChange={(e) => {
              setName(e.target.value);
              setFormError(null);
            }}
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
            onChange={(e) => {
              const nextUrl = e.target.value;
              if (
                addressBookUrl &&
                (!hasSameOrigin(nextUrl, addressBookUrl) ||
                  url.trim() === addressBookUrl.trim())
              ) {
                setAddressBookUrl("");
              }
              setUrl(nextUrl);
              setAddressBooks([]);
              setTestResult(null);
              setFormError(null);
            }}
            placeholder="https://cloud.example.com or https://contacts.icloud.com"
            className={cn(FORM_INPUT, "font-mono")}
          />
          <p className="text-xs text-on-surface-variant mt-1">
            Server root or direct address book URL (Nextcloud, iCloud, Fastmail,
            Radicale or Baïkal)
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
            onChange={(e) => {
              setUsername(e.target.value);
              setAddressBooks([]);
              setTestResult(null);
              setFormError(null);
            }}
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
            If your account uses 2FA, generate an app-specific password in your
            provider&apos;s security settings
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
