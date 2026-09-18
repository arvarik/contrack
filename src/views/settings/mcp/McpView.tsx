/**
 * McpView.tsx — The MCP and API settings page.
 *
 * Exposes:
 * - Server endpoint URL with copy action
 * - Token input for previewing host configurations (never stored)
 * - Copyable setup snippets for Claude Code, Claude Desktop, Cursor, and curl
 * - Live tools table reflecting the canonical MCP registry
 *
 * @module views/settings/mcp/McpView
 */

import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Copy, Check, ExternalLink, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { copyToClipboard, CLIPBOARD_DENIED } from "../../../lib/clipboard";
import { Badge } from "../../../components/ui/Badge";
import { MCP_TOOLS } from "../../../../shared/mcpTools";
import { CARD, SECTION_HEADING } from "../../../lib/styles";
import { cn } from "../../../lib/utils";

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
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await copyToClipboard(code);
      setCopied(true);
      toast.success(`${title} snippet copied`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(CLIPBOARD_DENIED);
    }
  };

  return (
    <div className="space-y-2" id={id}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-on-surface">{title}</h3>
          <p className="text-xs text-on-surface-variant">{description}</p>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={`Copy ${title} snippet`}
          className="hit-area inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-container hover:bg-surface-container-high text-on-surface transition-colors focus:outline-none focus:ring-2 focus:ring-primary shrink-0 min-h-[44px] min-w-[44px]"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-success" aria-hidden="true" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy
                className="w-3.5 h-3.5 text-on-surface-variant"
                aria-hidden="true"
              />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <div
        tabIndex={0}
        role="region"
        aria-label={`${title} code snippet`}
        className="relative rounded-xl bg-surface-container p-3 font-mono text-xs text-on-surface overflow-x-auto border border-surface-container-high/40 focus:outline-none focus:ring-1 focus:ring-primary"
      >
        <pre className="whitespace-pre">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
};

export const McpView: React.FC = () => {
  const [token, setToken] = useState("");
  const [copiedUrl, setCopiedUrl] = useState(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const endpointUrl = `${origin}/api/mcp`;
  const displayToken = token.trim() || "<your-token>";

  const handleCopyUrl = async () => {
    try {
      await copyToClipboard(endpointUrl);
      setCopiedUrl(true);
      toast.success("Endpoint URL copied");
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      toast.error(CLIPBOARD_DENIED);
    }
  };

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
    <div className="p-4 sm:p-6 md:p-10 max-w-4xl mx-auto space-y-6 pb-28 md:pb-10">
      {/* Endpoint & Token Card */}
      <div className={cn(CARD, "space-y-6")} id="endpoint">
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className={cn(SECTION_HEADING, "mb-1")}>
                MCP Server Endpoint
              </h2>
              <p className="text-xs text-on-surface-variant">
                Streamable HTTP transport endpoint for all MCP hosts and
                scripts.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                id="mcp-endpoint"
                className="font-mono text-xs px-2.5 py-1.5 rounded-lg bg-surface-container text-on-surface border border-surface-container-high/50 select-all"
              >
                {endpointUrl}
              </span>
              <button
                type="button"
                onClick={handleCopyUrl}
                aria-label="Copy MCP endpoint URL"
                className="hit-area inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-container hover:bg-surface-container-high text-on-surface transition-colors shrink-0 min-h-[44px] min-w-[44px]"
              >
                {copiedUrl ? (
                  <>
                    <Check
                      className="w-3.5 h-3.5 text-success"
                      aria-hidden="true"
                    />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy
                      className="w-3.5 h-3.5 text-on-surface-variant"
                      aria-hidden="true"
                    />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div
            className="pt-4 border-t border-surface-container space-y-3"
            id="token"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <label
                htmlFor="mcp-token-input"
                className="text-sm font-semibold text-on-surface flex items-center gap-1.5"
              >
                <KeyRound className="w-4 h-4 text-primary" aria-hidden="true" />
                Personal API Token
              </label>
              <Link
                to="/settings/account"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <span>Create a token in Account</span>
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </Link>
            </div>

            <input
              id="mcp-token-input"
              type="password"
              autoComplete="off"
              spellCheck="false"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste your ctk_... token to preview snippets"
              className="w-full px-3 py-2.5 rounded-xl bg-surface-container border border-surface-container-high/60 text-on-surface text-sm placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary min-h-[44px]"
            />
            <p className="text-xs text-on-surface-variant">
              Your token is never saved or sent to the server. It is only used
              in memory to format the copyable snippets below.
            </p>
          </div>
        </div>
      </div>

      {/* Host Snippets Card */}
      <div className={cn(CARD, "space-y-6")} id="snippets">
        <div>
          <h2 className={cn(SECTION_HEADING, "mb-1")}>Host Configuration</h2>
          <p className="text-xs text-on-surface-variant">
            Copy the configuration or command for your preferred MCP client.
          </p>
        </div>

        <div className="space-y-6 divide-y divide-surface-container">
          <div className="pt-0">
            <SnippetBlock
              id="claude-code"
              title="Claude Code"
              description="Register the HTTP transport with the Claude Code CLI."
              code={claudeCodeSnippet}
            />
          </div>

          <div className="pt-6">
            <SnippetBlock
              id="claude-desktop"
              title="Claude Desktop and Cursor"
              description="Add to your mcpServers configuration using the standard mcp-remote bridge."
              code={desktopSnippet}
            />
          </div>

          <div className="pt-6">
            <SnippetBlock
              id="curl"
              title="curl (HTTP Test)"
              description="Send an initialize request directly to test connectivity."
              code={curlSnippet}
            />
          </div>
        </div>
      </div>

      {/* Tools Table Card */}
      <div className={cn(CARD, "space-y-4")} id="tools">
        <div>
          <h2 className={cn(SECTION_HEADING, "mb-1")}>Tools</h2>
          <p className="text-xs text-on-surface-variant">
            {MCP_TOOLS.length} tools exposed to MCP hosts. Read-only tools do
            not mutate data.
          </p>
        </div>

        <div
          tabIndex={0}
          role="region"
          aria-label="MCP tools list"
          className="overflow-x-auto -mx-6 sm:mx-0 focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-surface-container-high text-on-surface-variant font-medium">
                <th scope="col" className="py-2.5 px-4 sm:px-3 font-semibold">
                  Tool
                </th>
                <th scope="col" className="py-2.5 px-4 sm:px-3 font-semibold">
                  Description
                </th>
                <th
                  scope="col"
                  className="py-2.5 px-4 sm:px-3 font-semibold text-right"
                >
                  Access
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container">
              {MCP_TOOLS.map((tool) => (
                <tr
                  key={tool.name}
                  className="hover:bg-surface-container/50 transition-colors"
                >
                  <td className="py-3 px-4 sm:px-3 font-mono font-medium text-primary whitespace-nowrap">
                    {tool.name}
                  </td>
                  <td className="py-3 px-4 sm:px-3 text-on-surface max-w-md">
                    {tool.description}
                  </td>
                  <td className="py-3 px-4 sm:px-3 text-right whitespace-nowrap">
                    <Badge tone={tool.readOnly ? "primary" : "neutral"}>
                      {tool.readOnly ? "Read-only" : "Read / Write"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default McpView;
