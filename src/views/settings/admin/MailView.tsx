/**
 * MailView — the Outgoing mail admin page at /settings/admin/mail.
 *
 * Configures the SMTP server that sends invitations, password resets,
 * and magic links.
 */
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Loader2, Send, Trash2 } from "lucide-react";
import {
  useMailConfig,
  useUpdateMailConfig,
  useDeleteMailConfig,
  useSendTestMail,
} from "../../../api/admin";
import { useAuth } from "../../../components/auth/AuthGate";
import { Badge, type BadgeTone } from "../../../components/ui/Badge";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Switch } from "../../../components/ui/Switch";
import { cn } from "../../../lib/utils";
import {
  SETTINGS_CARD,
  SETTINGS_INPUT,
  SETTINGS_LABEL,
  SETTINGS_PAGE,
  SETTINGS_SECTION_HEADING,
} from "../layout";

/** One field of the form: its name over it. */
const Field = ({
  id,
  label,
  className,
  ...props
}: {
  id: string;
  label: string;
} & React.InputHTMLAttributes<HTMLInputElement>) => (
  <div className={cn("space-y-1.5", className)}>
    <label htmlFor={id} className={SETTINGS_LABEL}>
      {label}
    </label>
    <input id={id} className={SETTINGS_INPUT} {...props} />
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
      <div className={SETTINGS_PAGE}>
        <EmptyState
          icon={AlertCircle}
          tone="error"
          title="Mail settings did not load"
          body="Nothing has changed. Try again in a moment."
          action={{ label: "Try again", onClick: () => void refetch() }}
        />
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

  const status: { tone: BadgeTone; label: string } = isEnv
    ? { tone: "primary", label: "Set by the environment" }
    : isSettings
      ? { tone: "success", label: "Set up here" }
      : { tone: "neutral", label: "Not set up" };
  const locked = isEnv || isLoading;

  return (
    <div className={SETTINGS_PAGE}>
      <section aria-labelledby="smtp-heading">
        <h2 id="smtp-heading" className={SETTINGS_SECTION_HEADING}>
          SMTP server
        </h2>

        <form
          onSubmit={handleSubmit}
          className={cn(SETTINGS_CARD, "space-y-5")}
        >
          <div className="flex flex-wrap items-center gap-2 text-sm text-on-surface-variant">
            <span className="font-bold text-on-surface">Status</span>
            <Badge tone={status.tone}>{status.label}</Badge>
            {isEnv && (
              <span className="text-pretty">
                SMTP_URL in the environment sets it. Change it there.
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field
              id="mail-host"
              label="Host"
              className="sm:col-span-2"
              type="text"
              required
              disabled={locked}
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="smtp.example.com"
            />
            <Field
              id="mail-port"
              label="Port"
              type="text"
              inputMode="numeric"
              required
              disabled={locked}
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="587"
            />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-bold text-on-surface">Use TLS</p>
              <p className="text-xs sm:text-sm text-on-surface-variant text-pretty">
                Connects over TLS from the start. Port 465 usually needs it.
                Port 587 usually does not.
              </p>
            </div>
            <Switch
              id="mail-tls"
              label="Use TLS"
              checked={secure}
              disabled={locked}
              onChange={setSecure}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              id="mail-user"
              label="Username"
              type="text"
              disabled={locked}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
            />
            <Field
              id="mail-pass"
              label="Password"
              type="password"
              disabled={locked}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={
                data?.hasPassword
                  ? "Leave it empty to keep the current one"
                  : undefined
              }
              autoComplete="new-password"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              id="mail-from"
              label="From address"
              type="email"
              required
              disabled={locked}
              value={fromAddress}
              onChange={(e) => setFromAddress(e.target.value)}
              placeholder="noreply@example.com"
            />
            <Field
              id="mail-reply"
              label="Reply-to"
              type="email"
              disabled={locked}
              value={replyTo}
              onChange={(e) => setReplyTo(e.target.value)}
              placeholder="support@example.com"
            />
          </div>

          {/* The destructive act on the left, apart from the others. Save,
              the form's one call to action, ends the row. */}
          <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
            {isSettings && (
              <button
                type="button"
                onClick={() => setShowClearConfirm(true)}
                disabled={deleteMail.isPending}
                className="btn-secondary text-error sm:mr-auto"
              >
                <Trash2 className="w-4 h-4" />
                Clear settings
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
              {adminEmail ? `Send a test to ${adminEmail}` : "Send a test"}
            </button>
            {!isEnv && (
              <button
                type="submit"
                disabled={isLoading || updateMail.isPending}
                className="btn-primary"
              >
                {updateMail.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                Save
              </button>
            )}
          </div>
        </form>
      </section>

      <ConfirmDialog
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={handleClear}
        title="Clear the mail settings?"
        description="Contrack stops sending mail until someone sets it up again. Invitations and password resets are then not sent by email."
        confirmLabel="Clear settings"
        tone="danger"
        busy={deleteMail.isPending}
      />
    </div>
  );
};

export default MailView;
