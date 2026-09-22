/**
 * MailView — the Outgoing mail admin page at /settings/admin/mail.
 *
 * Configures the SMTP server that sends invitations, password resets,
 * and magic links.
 */
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Mail,
  Send,
  Server,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  useMailConfig,
  useUpdateMailConfig,
  useDeleteMailConfig,
  useSendTestMail,
} from "../../../api/admin";
import { useAuth } from "../../../components/auth/AuthGate";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { CARD, SECTION_HEADING } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import { NAMES } from "../../../lib/names";
import { SETTINGS_PAGE } from "../layout";

/** A field in the SMTP form. */
const FIELD =
  "w-full px-3 py-2 rounded-xl min-h-[44px] bg-surface-container-high text-on-surface text-sm";

/** Shown in place of the form when reading mail configuration failed. */
const ReadFailed = ({ onRetry }: { onRetry: () => void }) => (
  <div className={cn(CARD, "space-y-3")}>
    <p className="flex items-start gap-2 text-sm text-on-surface text-pretty">
      <TriangleAlert className="w-4 h-4 text-warning shrink-0 mt-0.5" />
      Mail settings could not be loaded. Nothing has changed.
    </p>
    <button type="button" onClick={onRetry} className="btn-secondary">
      Try again
    </button>
  </div>
);

export const MailView = () => {
  const { data, isLoading, isError, refetch } = useMailConfig();
  const updateMail = useUpdateMailConfig();
  const deleteMail = useDeleteMailConfig();
  const sendTest = useSendTestMail();
  const { user } = useAuth();

  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [secure, setSecure] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  useEffect(() => {
    if (data) {
      setHost(data.host ?? "");
      setPort(data.port ? String(data.port) : "587");
      setSecure(Boolean(data.secure));
      setUsername(data.user ?? "");
      setPassword("");
      setFromAddress(data.from ?? "");
      setReplyTo(data.replyTo ?? "");
    }
  }, [data]);

  if (isError) {
    return (
      <div className={cn(SETTINGS_PAGE, "space-y-8")}>
        <ReadFailed onRetry={() => void refetch()} />
      </div>
    );
  }

  const isEnv = data?.source === "env";
  const isSettings = data?.source === "settings";
  const isConfigured = data?.source === "env" || data?.source === "settings";
  const adminEmail = user?.email;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isEnv) return;

    const parsedPort = parseInt(port, 10);
    if (isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      toast.error("Please enter a valid port between 1 and 65535.");
      return;
    }

    updateMail.mutate(
      {
        host: host.trim(),
        port: parsedPort,
        secure,
        user: username.trim(),
        password: password || undefined,
        from: fromAddress.trim(),
        replyTo: replyTo.trim(),
      },
      {
        onSuccess: () => {
          toast.success("Mail settings saved");
          setPassword("");
        },
        onError: (err: Error) => {
          toast.error(err.message || "Failed to save mail settings");
        },
      },
    );
  };

  const handleSendTest = () => {
    sendTest.mutate(adminEmail ? { to: adminEmail } : {}, {
      onSuccess: (res) => toast.success(`Test message sent to ${res.to}`),
      onError: (err: Error) =>
        toast.error(err.message || "Failed to send test message"),
    });
  };

  const handleClear = () => {
    deleteMail.mutate(undefined, {
      onSuccess: () => {
        toast.success("Mail settings cleared");
        setShowClearConfirm(false);
        setHost("");
        setPort("587");
        setSecure(false);
        setUsername("");
        setPassword("");
        setFromAddress("");
        setReplyTo("");
      },
      onError: (err: Error) => {
        toast.error(err.message || "Failed to clear mail settings");
      },
    });
  };

  const statusText = isEnv
    ? "Configured by the environment (SMTP_URL). Edit the environment to change it."
    : isSettings
      ? "Configured here"
      : "Not configured";

  return (
    <div className={cn(SETTINGS_PAGE, "space-y-8")}>
      <section className="space-y-4">
        <h2 className={cn(SECTION_HEADING, "px-1 mb-2")}>
          <span className="inline-flex items-center gap-1.5">
            <Server className="w-3.5 h-3.5" />
            SMTP server
          </span>
        </h2>

        <div className={cn(CARD, "space-y-4")}>
          <div className="space-y-1">
            <p className="text-sm text-on-surface-variant">
              {NAMES.outgoingMail.description}
            </p>
            <p
              className={cn(
                "text-xs font-medium",
                isConfigured ? "text-primary" : "text-on-surface-variant",
              )}
            >
              Status: {statusText}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2 space-y-1">
                <label
                  htmlFor="mail-host"
                  className="block text-xs font-bold text-on-surface"
                >
                  Host
                </label>
                <input
                  id="mail-host"
                  type="text"
                  required
                  disabled={isEnv || isLoading}
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="smtp.example.com"
                  className={cn(
                    FIELD,
                    isEnv && "opacity-60 cursor-not-allowed",
                  )}
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="mail-port"
                  className="block text-xs font-bold text-on-surface"
                >
                  Port
                </label>
                <input
                  id="mail-port"
                  type="text"
                  required
                  disabled={isEnv || isLoading}
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="587"
                  className={cn(
                    FIELD,
                    isEnv && "opacity-60 cursor-not-allowed",
                  )}
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <input
                id="mail-tls"
                type="checkbox"
                disabled={isEnv || isLoading}
                checked={secure}
                onChange={(e) => setSecure(e.target.checked)}
                className={cn(
                  "w-4 h-4 rounded text-primary",
                  isEnv && "opacity-60 cursor-not-allowed",
                )}
              />
              <label
                htmlFor="mail-tls"
                className={cn(
                  "text-sm font-medium text-on-surface cursor-pointer",
                  isEnv && "opacity-60 cursor-not-allowed",
                )}
              >
                Use TLS (secure)
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label
                  htmlFor="mail-user"
                  className="block text-xs font-bold text-on-surface"
                >
                  Username
                </label>
                <input
                  id="mail-user"
                  type="text"
                  disabled={isEnv || isLoading}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="off"
                  className={cn(
                    FIELD,
                    isEnv && "opacity-60 cursor-not-allowed",
                  )}
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="mail-pass"
                  className="block text-xs font-bold text-on-surface"
                >
                  Password
                </label>
                <input
                  id="mail-pass"
                  type="password"
                  disabled={isEnv || isLoading}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={
                    data?.hasPassword
                      ? "Leave blank to keep the current one"
                      : "Enter password"
                  }
                  autoComplete="new-password"
                  className={cn(
                    FIELD,
                    isEnv && "opacity-60 cursor-not-allowed",
                  )}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label
                  htmlFor="mail-from"
                  className="block text-xs font-bold text-on-surface"
                >
                  From address
                </label>
                <input
                  id="mail-from"
                  type="email"
                  required
                  disabled={isEnv || isLoading}
                  value={fromAddress}
                  onChange={(e) => setFromAddress(e.target.value)}
                  placeholder="noreply@example.com"
                  className={cn(
                    FIELD,
                    isEnv && "opacity-60 cursor-not-allowed",
                  )}
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="mail-reply"
                  className="block text-xs font-bold text-on-surface"
                >
                  Reply-to
                </label>
                <input
                  id="mail-reply"
                  type="email"
                  disabled={isEnv || isLoading}
                  value={replyTo}
                  onChange={(e) => setReplyTo(e.target.value)}
                  placeholder="support@example.com"
                  className={cn(
                    FIELD,
                    isEnv && "opacity-60 cursor-not-allowed",
                  )}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              {!isEnv && (
                <button
                  type="submit"
                  disabled={isLoading || updateMail.isPending}
                  className="btn-primary"
                >
                  {updateMail.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Mail className="w-4 h-4" />
                  )}
                  Save
                </button>
              )}
              <button
                type="button"
                onClick={handleSendTest}
                disabled={!isConfigured || sendTest.isPending}
                className="btn-secondary"
              >
                {sendTest.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                {adminEmail
                  ? `Send a test message to ${adminEmail}`
                  : "Send a test message"}
              </button>
              {isSettings && (
                <button
                  type="button"
                  onClick={() => setShowClearConfirm(true)}
                  disabled={deleteMail.isPending}
                  className="btn-secondary text-error ml-auto"
                >
                  <Trash2 className="w-4 h-4" />
                  Clear configuration
                </button>
              )}
            </div>
          </form>
        </div>
      </section>

      <ConfirmDialog
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={handleClear}
        title="Clear mail configuration?"
        description="Outgoing mail will be disabled until configured again. Unsent invitations and password resets will not be sent by email."
        confirmLabel="Clear configuration"
        tone="danger"
        busy={deleteMail.isPending}
      />
    </div>
  );
};

export default MailView;
