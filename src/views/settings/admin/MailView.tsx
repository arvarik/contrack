/**
 * MailView — the Outgoing mail admin page at /settings/admin/mail.
 *
 * Configures the SMTP server that sends invitations, password resets,
 * and magic links.
 */
import React, { useState } from "react";
import { Mail, Send, Server } from "lucide-react";
import { CARD, SECTION_HEADING } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import { NAMES } from "../../../lib/names";

export const MailView = () => {
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [secure, setSecure] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [replyTo, setReplyTo] = useState("");

  return (
    <div className="p-4 sm:p-6 md:p-10 max-w-4xl mx-auto space-y-8 pb-28 md:pb-10">
      <section className="space-y-4">
        <h2 className={cn(SECTION_HEADING, "px-1 mb-2")}>
          <span className="inline-flex items-center gap-1.5">
            <Server className="w-3.5 h-3.5" />
            SMTP Server
          </span>
        </h2>

        <div className={cn(CARD, "space-y-4")}>
          <div className="space-y-1">
            <p className="text-sm text-on-surface-variant">
              {NAMES.outgoingMail.description}
            </p>
            <p className="text-xs text-on-surface-variant font-medium">
              Status: Not configured
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
            }}
            className="space-y-4"
          >
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
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="smtp.example.com"
                  className="w-full px-3 py-2 rounded-xl min-h-[44px] bg-surface-container-high text-on-surface text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="587"
                  className="w-full px-3 py-2 rounded-xl min-h-[44px] bg-surface-container-high text-on-surface text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <input
                id="mail-tls"
                type="checkbox"
                checked={secure}
                onChange={(e) => setSecure(e.target.checked)}
                className="w-4 h-4 rounded text-primary focus:ring-primary"
              />
              <label
                htmlFor="mail-tls"
                className="text-sm font-medium text-on-surface cursor-pointer"
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
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="off"
                  className="w-full px-3 py-2 rounded-xl min-h-[44px] bg-surface-container-high text-on-surface text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Leave blank to keep the current one"
                  autoComplete="new-password"
                  className="w-full px-3 py-2 rounded-xl min-h-[44px] bg-surface-container-high text-on-surface text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
                  value={fromAddress}
                  onChange={(e) => setFromAddress(e.target.value)}
                  placeholder="noreply@example.com"
                  className="w-full px-3 py-2 rounded-xl min-h-[44px] bg-surface-container-high text-on-surface text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
                  value={replyTo}
                  onChange={(e) => setReplyTo(e.target.value)}
                  placeholder="support@example.com"
                  className="w-full px-3 py-2 rounded-xl min-h-[44px] bg-surface-container-high text-on-surface text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button type="submit" className="btn-primary">
                <Mail className="w-4 h-4" />
                Save
              </button>
              <button type="button" className="btn-secondary">
                <Send className="w-4 h-4" />
                Send a test message
              </button>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
};

export default MailView;
