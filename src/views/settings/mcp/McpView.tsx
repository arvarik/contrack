/**
 * McpView.tsx — The MCP and API settings page.
 *
 * One card walks a person through connecting an assistant, in the order they
 * do it:
 * 1. The server address, with a note when only this computer can reach it.
 * 2. Where they use the assistant: Claude Code, Cursor, VS Code, and so on.
 * 3. Access, when the instance asks for sign-in: create a token for that
 *    client here, or paste one. The token stays on this page and is never
 *    saved by it.
 * 4. The command, the config or the one-press install link, with the address
 *    and the token already in it.
 * A second card lists the tools a client can call.
 *
 * A Copy is an action, so it is a `.btn-secondary`. The code wraps rather
 * than scrolling sideways, so nothing is cut off at a card's edge, and a copy
 * takes the exact text whatever the wrap.
 *
 * @module views/settings/mcp/McpView
 */

import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  Check,
  CircleCheck,
  ExternalLink,
  Info,
  KeyRound,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { copyToClipboard, CLIPBOARD_DENIED } from "../../../lib/clipboard";
import { Badge } from "../../../components/ui/Badge";
import {
  Segmented,
  type SegmentedOption,
} from "../../../components/ui/Segmented";
import { useAuth } from "../../../components/auth/AuthGate";
import { createApiToken } from "../../../api/auth";
import { MCP_TOOLS } from "../../../../shared/mcpTools";
import { radioKeys, radioTabIndex } from "../../../lib/a11y";
import { filterPill, SECTION_HEADING } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import {
  SETTINGS_CARD,
  SETTINGS_INPUT,
  SETTINGS_LABEL,
  SETTINGS_PAGE,
  SETTINGS_SECTION_HEADING,
} from "../layout";
import {
  MCP_CLIENTS,
  isLoopbackHost,
  type McpClient,
  type McpClientId,
} from "./clients";

/** A value or a snippet, on the card's wash, in the code face. */
const CODE_BOX =
  "rounded-xl bg-surface-container-highest px-3 py-2.5 font-mono text-xs text-on-surface whitespace-pre-wrap break-all";

/** A step's heading inside the card. */
const STEP_HEADING = "text-sm font-bold text-on-surface";

/** How long a token made here lasts. Account settings offers the others. */
const TOKEN_DAYS = 90;

/** Copy, and "Copied" for two seconds after. */
const CopyButton = ({
  text,
  label,
  what,
}: {
  text: string;
  /** The accessible name: "Copy Claude Code command". */
  label: string;
  /** What the toast says was copied. */
  what: string;
}) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await copyToClipboard(text);
      setCopied(true);
      toast.success(`${what} copied`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(CLIPBOARD_DENIED);
    }
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={label}
      className="btn-secondary btn-sm shrink-0"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-success" aria-hidden="true" />
      ) : (
        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
      )}
      {copied ? "Copied" : "Copy"}
    </button>
  );
};

/** The client the person uses: one pill each, one choice. */
const ClientPicker = ({
  value,
  onChange,
}: {
  value: McpClientId;
  onChange: (id: McpClientId) => void;
}) => (
  <div
    role="radiogroup"
    aria-labelledby="mcp-client-heading"
    className="flex flex-wrap gap-2"
  >
    {MCP_CLIENTS.map((client, index) => {
      const checked = client.id === value;
      return (
        <button
          key={client.id}
          type="button"
          role="radio"
          aria-checked={checked}
          tabIndex={radioTabIndex(checked, index, true)}
          onKeyDown={radioKeys}
          onClick={() => onChange(client.id)}
          className={cn(filterPill(checked), "hit-area")}
        >
          {client.label}
        </button>
      );
    })}
  </div>
);

type TokenAccess = "write" | "read";

const ACCESS_OPTIONS: readonly SegmentedOption<TokenAccess>[] = [
  { value: "write", label: "Read and write" },
  { value: "read", label: "Read only" },
];

/**
 * Access, on an instance that asks for sign-in. A token made here is named
 * after the client, lasts 90 days, and is shown on this page only, inside
 * the setup below. A person who has a token pastes it instead.
 */
const TokenStep = ({
  client,
  token,
  onToken,
}: {
  client: McpClient;
  token: string;
  onToken: (token: string) => void;
}) => {
  const queryClient = useQueryClient();
  const [access, setAccess] = useState<TokenAccess>("write");
  const [madeFor, setMadeFor] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);

  const create = useMutation({
    mutationFn: () =>
      createApiToken({
        name: client.label,
        expiresInDays: TOKEN_DAYS,
        readOnly: access === "read",
      }),
    onSuccess: (created) => {
      onToken(created.token);
      setMadeFor(client.label);
      void queryClient.invalidateQueries({ queryKey: ["auth", "tokens"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reset = () => {
    onToken("");
    setMadeFor(null);
    setPasting(false);
  };

  if (madeFor) {
    return (
      <div className="flex flex-wrap items-start gap-3 rounded-xl bg-success/10 p-3">
        <CircleCheck
          className="w-4 h-4 text-success shrink-0 mt-0.5"
          aria-hidden="true"
        />
        <p className="flex-1 min-w-48 text-sm text-on-surface text-pretty">
          A token named “{madeFor}” is in the setup below. This page shows it
          once. Revoke it any time in{" "}
          <Link
            to="/settings/account#tokens"
            className="font-semibold text-primary hover:underline"
          >
            Account
          </Link>
        </p>
        <div className="flex gap-2">
          <CopyButton text={token} label="Copy the token" what="Token" />
          <button
            type="button"
            onClick={reset}
            className="btn-secondary btn-sm"
          >
            Start over
          </button>
        </div>
      </div>
    );
  }

  if (pasting) {
    return (
      <div className="space-y-2">
        <label htmlFor="mcp-token-input" className={SETTINGS_LABEL}>
          Your token
        </label>
        <div className="flex gap-2">
          <input
            id="mcp-token-input"
            type="password"
            autoComplete="off"
            spellCheck="false"
            value={token}
            onChange={(e) => onToken(e.target.value.trim())}
            placeholder="ctk_…"
            aria-describedby="mcp-token-hint"
            // The person pressed "Use a token I have" to type here.
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            className={cn(SETTINGS_INPUT, "flex-1 font-mono")}
          />
          <button type="button" onClick={reset} className="btn-secondary">
            Cancel
          </button>
        </div>
        <p
          id="mcp-token-hint"
          className="text-xs text-on-surface-variant text-pretty"
        >
          It stays on this page and goes only into the setup below
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-on-surface-variant text-pretty">
        {client.label} signs in with a token that acts as your account and
        reaches only your data. It lasts {TOKEN_DAYS} days
      </p>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <Segmented
          label="Access"
          className="sm:w-fit"
          value={access}
          options={ACCESS_OPTIONS}
          onChange={setAccess}
        />
        <button
          type="button"
          onClick={() => create.mutate()}
          disabled={create.isPending}
          className="btn-primary sm:w-fit"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          {create.isPending
            ? "Creating…"
            : `Create a token for ${client.label}`}
        </button>
      </div>
      <p className="text-xs text-on-surface-variant text-pretty">
        {access === "read"
          ? "Read only: it can search and read, and sees no tool that changes anything. "
          : "Read and write: it can also add contacts, notes, follow-ups and lists. "}
        <button
          type="button"
          onClick={() => setPasting(true)}
          className="font-semibold text-primary hover:underline"
        >
          Use a token I have
        </button>
      </p>
    </div>
  );
};

export const McpView: React.FC = () => {
  const { authRequired, publicUrl } = useAuth();
  const [clientId, setClientId] = useState<McpClientId>("claude-code");
  const [token, setToken] = useState("");

  const origin =
    publicUrl ?? (typeof window !== "undefined" ? window.location.origin : "");
  const endpointUrl = `${origin}/api/mcp`;
  const onlyHere = !publicUrl && isLoopbackHost(new URL(origin).hostname);

  const client = MCP_CLIENTS.find((c) => c.id === clientId) ?? MCP_CLIENTS[0];
  const missingToken = authRequired && !token;
  const setup = client.setup(
    endpointUrl,
    authRequired ? token || "<your-token>" : null,
  );
  const codeName = `${client.label} ${setup.codeKind}`;

  return (
    <div className={cn(SETTINGS_PAGE, "space-y-8")}>
      <section aria-labelledby="mcp-connect-heading">
        <h2 id="mcp-connect-heading" className={SETTINGS_SECTION_HEADING}>
          Connect an assistant
        </h2>
        <div className={cn(SETTINGS_CARD, "space-y-6")}>
          <div id="endpoint" className="space-y-2 scroll-mt-20">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h3 className={STEP_HEADING}>Server address</h3>
                <p className="text-xs sm:text-sm text-on-surface-variant text-pretty">
                  The one address every MCP client and script uses
                </p>
              </div>
              <CopyButton
                text={endpointUrl}
                label="Copy MCP endpoint URL"
                what="Endpoint URL"
              />
            </div>
            <p id="mcp-endpoint" className={cn(CODE_BOX, "select-all")}>
              {endpointUrl}
            </p>
            {onlyHere && (
              <p className="flex items-start gap-1.5 text-xs text-on-surface-variant text-pretty">
                <Info
                  className="w-3.5 h-3.5 shrink-0 mt-px"
                  aria-hidden="true"
                />
                Only an assistant on this computer can reach this address. For
                one on another device, open Contrack by its network name, or set
                PUBLIC_URL
              </p>
            )}
          </div>

          <div className="space-y-2">
            <h3 id="mcp-client-heading" className={STEP_HEADING}>
              Where do you use it?
            </h3>
            <ClientPicker value={clientId} onChange={setClientId} />
          </div>

          {authRequired && (
            <div id="token" className="space-y-2 scroll-mt-20">
              <h3 className={cn(STEP_HEADING, "flex items-center gap-1.5")}>
                <KeyRound className="w-4 h-4 text-primary" aria-hidden="true" />
                Give it access
              </h3>
              <TokenStep client={client} token={token} onToken={setToken} />
            </div>
          )}

          <div id="setup" className="space-y-3 scroll-mt-20">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className={STEP_HEADING}>Add it to {client.label}</h3>
                <p className="text-xs sm:text-sm text-on-surface-variant text-pretty">
                  {setup.steps}
                  {missingToken && ". Create a token above to fill it in"}
                </p>
              </div>
              <CopyButton
                text={setup.code}
                label={`Copy ${codeName}`}
                what={codeName}
              />
            </div>
            {setup.install &&
              (missingToken ? (
                <button type="button" disabled className="btn-primary w-fit">
                  <ExternalLink className="w-4 h-4" aria-hidden="true" />
                  {setup.install.label}
                </button>
              ) : (
                <a href={setup.install.href} className="btn-primary w-fit">
                  <ExternalLink className="w-4 h-4" aria-hidden="true" />
                  {setup.install.label}
                </a>
              ))}
            <pre id={`snippet-${client.id}`} className={CODE_BOX}>
              <code>{setup.code}</code>
            </pre>
            {!authRequired && (
              <p className="text-xs text-on-surface-variant text-pretty">
                This Contrack asks nobody to sign in, so a client needs no
                token. Anyone who can reach the address can use it
              </p>
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="mcp-tools-heading" id="tools">
        <h2 id="mcp-tools-heading" className={SETTINGS_SECTION_HEADING}>
          Tools
        </h2>
        <div className={cn(SETTINGS_CARD, "space-y-4")}>
          <p className="text-sm text-on-surface-variant text-pretty">
            {MCP_TOOLS.length} tools a client can call. A read-only token sees
            only the read-only ones
          </p>
          {/* A table with no lines: the columns and the space between rows
              hold it. On a phone the access badge moves under the tool's
              name, so the two columns left fit with no sideways scroll. */}
          <table className="w-full text-left">
            <thead>
              <tr className={SECTION_HEADING}>
                <th scope="col" className="pb-2 pr-4 font-bold">
                  Tool
                </th>
                <th scope="col" className="pb-2 pr-4 font-bold">
                  What it does
                </th>
                <th
                  scope="col"
                  className="pb-2 font-bold text-right hidden sm:table-cell"
                >
                  Access
                </th>
              </tr>
            </thead>
            <tbody>
              {MCP_TOOLS.map((tool) => {
                const reads = tool.effect === "read";
                const access = (
                  <Badge tone={reads ? "primary" : "neutral"}>
                    {reads ? "Read-only" : "Read and write"}
                  </Badge>
                );
                return (
                  <tr key={tool.name} className="align-top">
                    <td className="py-2 pr-4 w-2/5 sm:w-56">
                      <span className="block text-sm font-semibold text-on-surface">
                        {tool.title}
                      </span>
                      <span className="font-mono text-xs text-on-primary-wash break-all">
                        {tool.name}
                      </span>
                      <span className="block mt-1 sm:hidden">{access}</span>
                    </td>
                    <td className="py-2 pr-4 text-sm text-on-surface text-pretty">
                      {/* The server writes each description for an AI
                          client, in sentences. On this page it is a
                          statement, so its last period goes. */}
                      {tool.description.replace(/\.$/, "")}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap hidden sm:table-cell">
                      {access}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default McpView;
