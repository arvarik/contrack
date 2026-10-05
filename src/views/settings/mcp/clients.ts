/**
 * clients.ts — The MCP clients the settings page sets up, and what each one
 * needs: the steps, the text to copy, and a one-click install link where the
 * client has one.
 *
 * `token` is null when the instance asks nobody to sign in. Then a client
 * sends no header at all.
 *
 * @module views/settings/mcp/clients
 */

export type McpClientId =
  | "claude-code"
  | "claude-desktop"
  | "cursor"
  | "vscode"
  | "codex"
  | "gemini"
  | "other";

interface McpClientSetup {
  /** What to do, in one or two sentences. */
  steps: string;
  /** The text to copy: a command, or a part of a config file. */
  code: string;
  /** Names the copy button and the toast: "command", "config". */
  codeKind: "command" | "config" | "check";
  /** A link that adds the server in one press. */
  install?: { href: string; label: string };
}

export interface McpClient {
  id: McpClientId;
  label: string;
  setup: (endpoint: string, token: string | null) => McpClientSetup;
}

/** The server's name in every client's config. */
const NAME = "contrack";

const headers = (token: string | null) =>
  token ? { Authorization: `Bearer ${token}` } : undefined;

const json = (value: unknown) => JSON.stringify(value, null, 2);

/** Base64 of the UTF-8 text, which `btoa` alone refuses past Latin-1. */
const base64 = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)));

export const MCP_CLIENTS: readonly McpClient[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    setup: (url, token) => ({
      steps:
        "Run this in a terminal. Every project on this computer then has Contrack, and /mcp lists it",
      codeKind: "command",
      code:
        `claude mcp add --transport http --scope user ${NAME} ${url}` +
        (token ? ` --header "Authorization: Bearer ${token}"` : ""),
    }),
  },
  {
    id: "claude-desktop",
    label: "Claude Desktop",
    setup: (url, token) => ({
      steps:
        "In Claude Desktop, open Settings, then Developer, then Edit Config. In claude_desktop_config.json, add the contrack entry inside mcpServers, then restart Claude. It starts the mcp-remote bridge, which needs Node.js",
      codeKind: "config",
      code: json({
        mcpServers: {
          [NAME]: {
            command: "npx",
            args: [
              "-y",
              "mcp-remote",
              url,
              // mcp-remote refuses plain http unless the host is this
              // computer, or this flag says the address is meant.
              ...(isPlainHttpElsewhere(url) ? ["--allow-http"] : []),
              // No space in an argument: Claude Desktop on Windows passes
              // args to npx unquoted. The space goes in the variable.
              ...(token ? ["--header", "Authorization:${AUTH_HEADER}"] : []),
            ],
            ...(token ? { env: { AUTH_HEADER: `Bearer ${token}` } } : {}),
          },
        },
      }),
    }),
  },
  {
    id: "cursor",
    label: "Cursor",
    setup: (url, token) => {
      const server = { url, headers: headers(token) };
      return {
        steps:
          "Press Add to Cursor. Or, for every project, add the contrack entry inside mcpServers in ~/.cursor/mcp.json",
        codeKind: "config",
        code: json({ mcpServers: { [NAME]: server } }),
        install: {
          label: "Add to Cursor",
          href: `cursor://anysphere.cursor-deeplink/mcp/install?name=${NAME}&config=${encodeURIComponent(base64(JSON.stringify(server)))}`,
        },
      };
    },
  },
  {
    id: "vscode",
    label: "VS Code",
    setup: (url, token) => {
      const server = { type: "http", url, headers: headers(token) };
      return {
        steps:
          "Press Add to VS Code. Or run MCP: Open User Configuration, and add the contrack entry inside servers. Keep the token out of a project's .vscode folder, which is often shared",
        codeKind: "config",
        code: json({ servers: { [NAME]: server } }),
        install: {
          label: "Add to VS Code",
          href: `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: NAME, ...server }))}`,
        },
      };
    },
  },
  {
    id: "codex",
    label: "Codex",
    setup: (url, token) => ({
      steps: token
        ? "Run this in a terminal. Codex reads the token from CONTRACK_TOKEN, so put the export line in your shell profile too"
        : "Run this in a terminal",
      codeKind: "command",
      code: token
        ? `export CONTRACK_TOKEN=${token}\ncodex mcp add ${NAME} --url ${url} --bearer-token-env-var CONTRACK_TOKEN`
        : `codex mcp add ${NAME} --url ${url}`,
    }),
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    setup: (url, token) => ({
      steps:
        "Run this in a terminal. Every project on this computer then has Contrack",
      codeKind: "command",
      code:
        `gemini mcp add --transport http --scope user` +
        (token ? ` --header "Authorization: Bearer ${token}"` : "") +
        ` ${NAME} ${url}`,
    }),
  },
  {
    id: "other",
    label: "Other",
    setup: (url, token) => ({
      steps: token
        ? "Any MCP client that speaks Streamable HTTP connects to the address above, with the token as Authorization: Bearer. This call checks that the server answers"
        : "Any MCP client that speaks Streamable HTTP connects to the address above. This call checks that the server answers",
      codeKind: "check",
      code:
        `curl -X POST ${url} \\\n` +
        (token ? `  -H "Authorization: Bearer ${token}" \\\n` : "") +
        `  -H "Content-Type: application/json" \\\n` +
        `  -H "Accept: application/json, text/event-stream" \\\n` +
        `  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'`,
    }),
  },
];

/**
 * An http address that mcp-remote needs `--allow-http` for. It takes plain
 * http without the flag only for these two names.
 */
function isPlainHttpElsewhere(url: string): boolean {
  const parsed = new URL(url);
  return (
    parsed.protocol === "http:" &&
    parsed.hostname !== "localhost" &&
    parsed.hostname !== "127.0.0.1"
  );
}

/** True when only this computer can reach the address. */
export function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    hostname.startsWith("127.")
  );
}
