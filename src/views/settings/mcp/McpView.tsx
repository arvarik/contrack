/**
 * McpView.tsx — The MCP and API settings page.
 *
 * Exposes:
 * - Server endpoint URL with copy action
 * - Token input for previewing host configurations (never stored)
 * - Copyable setup snippets for Claude Code, Claude Desktop, Cursor, and curl
 * - Live tools table reflecting the canonical MCP registry
 *
 * Three sections, each a heading over a card, as on every settings page. A
 * Copy is an action, so it is a `.btn-secondary`. The code wraps rather than
 * scrolling sideways, so nothing is cut off at a card's edge, and a copy
 * takes the exact text whatever the wrap.
 *
 * @module views/settings/mcp/McpView
 */

import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Copy, Check, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { copyToClipboard, CLIPBOARD_DENIED } from "../../../lib/clipboard";
import { Badge } from "../../../components/ui/Badge";
import { useAuth } from "../../../components/auth/AuthGate";
import { MCP_TOOLS } from "../../../../shared/mcpTools";
import { SECTION_HEADING } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import {
  SETTINGS_CARD,
  SETTINGS_INPUT,
  SETTINGS_PAGE,
  SETTINGS_SECTION_HEADING,
} from "../layout";

/** A value or a snippet, on the card's wash, in the code face. */
const CODE_BOX =
  "rounded-xl bg-surface-container-highest px-3 py-2.5 font-mono text-xs text-on-surface whitespace-pre-wrap break-all";

/** Copy, and "Copied" for two seconds after. */
const CopyButton = ({
  text,
  label,
  what,
}: {
  text: string;
  /** The accessible name: "Copy Claude Code snippet". */
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

interface SnippetBlockProps {
  id: string;
  title: string;
  description: string;
  code: string;
}

const SnippetBlock: React.FC<SnippetBlockProps> = ({
  id,
  title,
  description,
  code,
}) => (
  <div className="space-y-2 scroll-mt-20" id={id}>
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-on-surface">{title}</h3>
        <p className="text-xs sm:text-sm text-on-surface-variant text-pretty">
          {description}
        </p>
      </div>
      <CopyButton
        text={code}
        label={`Copy ${title} snippet`}
        what={`${title} snippet`}
      />
    </div>
    <pre className={CODE_BOX}>
      <code>{code}</code>
    </pre>
  </div>
);

export const McpView: React.FC = () => {
  const { authRequired } = useAuth();
  const [token, setToken] = useState("");

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const endpointUrl = `${origin}/api/mcp`;
  const displayToken = token.trim() || "<your-token>";

  const claudeCodeSnippet = `claude mcp add --transport http contrack ${endpointUrl} --header "Authorization: Bearer ${displayToken}"`;

  const desktopSnippet = JSON.stringify(
    {
      mcpServers: {
        contrack: {
          command: "npx",
          args: [
            "-y",
            "mcp-remote",
            endpointUrl,
            "--header",
            `Authorization: Bearer ${displayToken}`,
          ],
        },
      },
    },
    null,
    2,
  );

  const curlSnippet = `curl -X POST ${endpointUrl} \\
  -H "Authorization: Bearer ${displayToken}" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'`;

  return (
    <div className={cn(SETTINGS_PAGE, "space-y-8")}>
      {/* Endpoint and token */}
      <section aria-labelledby="mcp-endpoint-heading">
        <h2 id="mcp-endpoint-heading" className={SETTINGS_SECTION_HEADING}>
          Endpoint
        </h2>
        <div className={cn(SETTINGS_CARD, "space-y-6")}>
          <div id="endpoint" className="space-y-2 scroll-mt-20">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-on-surface">
                  MCP endpoint URL
                </h3>
                <p className="text-xs sm:text-sm text-on-surface-variant text-pretty">
                  The one address every MCP client and script uses, over
                  streamable HTTP.
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
          </div>

          <div id="token" className="space-y-2 scroll-mt-20">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <label
                htmlFor="mcp-token-input"
                className="flex items-center gap-1.5 text-sm font-bold text-on-surface"
              >
                <KeyRound className="w-4 h-4 text-primary" aria-hidden="true" />
                Personal API token
              </label>
              {authRequired && (
                <Link
                  to="/settings/account#tokens"
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  Create a token in Account
                </Link>
              )}
            </div>

            <input
              id="mcp-token-input"
              type="password"
              autoComplete="off"
              spellCheck="false"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste a token"
              aria-describedby="mcp-token-hint"
              className={cn(SETTINGS_INPUT, "font-mono placeholder:font-body")}
            />
            <p
              id="mcp-token-hint"
              className="text-xs text-on-surface-variant text-pretty"
            >
              {authRequired
                ? "The token stays on this page. It is never saved or sent anywhere, only put into the snippets below."
                : "This Contrack does not ask anyone to sign in, so a client connects without a token. A token pasted here only fills in the snippets."}
            </p>
          </div>
        </div>
      </section>

      {/* Host snippets */}
      <section aria-labelledby="mcp-snippets-heading">
        <h2 id="mcp-snippets-heading" className={SETTINGS_SECTION_HEADING}>
          Connect a client
        </h2>
        <div className={cn(SETTINGS_CARD, "space-y-8")} id="snippets">
          <SnippetBlock
            id="claude-code"
            title="Claude Code"
            description="Adds Contrack to the Claude Code command line."
            code={claudeCodeSnippet}
          />
          <SnippetBlock
            id="claude-desktop"
            title="Claude Desktop and Cursor"
            description="Goes in the mcpServers part of the client's config, through the mcp-remote bridge."
            code={desktopSnippet}
          />
          <SnippetBlock
            id="curl"
            title="curl"
            description="Sends one request, to check that the endpoint answers."
            code={curlSnippet}
          />
        </div>
      </section>

      {/* Tools */}
      <section aria-labelledby="mcp-tools-heading" id="tools">
        <h2 id="mcp-tools-heading" className={SETTINGS_SECTION_HEADING}>
          Tools
        </h2>
        <div className={cn(SETTINGS_CARD, "space-y-4")}>
          <p className="text-sm text-on-surface-variant text-pretty">
            {MCP_TOOLS.length} tools a client can call. A read-only tool changes
            nothing.
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
                const access = (
                  <Badge tone={tool.readOnly ? "primary" : "neutral"}>
                    {tool.readOnly ? "Read-only" : "Read and write"}
                  </Badge>
                );
                return (
                  <tr key={tool.name} className="align-top">
                    <td className="py-2 pr-4 w-2/5 sm:w-56">
                      <span className="font-mono text-xs font-semibold text-on-primary-wash break-all">
                        {tool.name}
                      </span>
                      <span className="block mt-1 sm:hidden">{access}</span>
                    </td>
                    <td className="py-2 pr-4 text-sm text-on-surface text-pretty">
                      {tool.description}
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
