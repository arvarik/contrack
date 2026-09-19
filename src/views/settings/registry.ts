/**
 * registry.ts — One registry for all settings pages, rows, redirects and search.
 *
 * Drives the two-pane shell on wide screens, the mobile landing list,
 * row-level search with deep links, palette navigation and URL redirects.
 *
 * @module views/settings/registry
 */
import React from "react";
import {
  Activity,
  Archive,
  Brain,
  Cable,
  Copy,
  DatabaseBackup,
  Download,
  Gauge,
  Keyboard,
  List,
  Mail,
  MailPlus,
  Palette,
  ScrollText,
  ServerCog,
  Shield,
  Sparkles,
  Tag,
  Terminal,
  Trash2,
  UploadCloud,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { NAMES } from "../../lib/names";

export type SettingsGroup = "you" | "tools" | "data" | "connect" | "admin";

export interface SettingsGroupMeta {
  id: SettingsGroup;
  title: string;
  railHeading: string;
}

export const SETTINGS_GROUPS: SettingsGroupMeta[] = [
  { id: "you", title: "You", railHeading: "YOU" },
  { id: "tools", title: "Tools", railHeading: "TOOLS" },
  { id: "data", title: "Your data", railHeading: "YOUR DATA" },
  { id: "connect", title: "Connect", railHeading: "CONNECT" },
  { id: "admin", title: "Administration", railHeading: "ADMINISTRATION" },
];

export interface SettingsRow {
  id: string;
  label: string;
  keywords: string[];
}

export interface SettingsPage {
  id: string;
  path: string;
  title: string;
  description: string;
  icon: LucideIcon;
  group: SettingsGroup;
  tone?: "primary" | "amber" | "danger";
  admin?: boolean;
  needsAccount?: boolean;
  keywords: string[];
  rows?: SettingsRow[];
  load: () => Promise<{ default: React.ComponentType }>;
  ownsScrolling?: boolean;
  badge?: () => number | null;
}

export interface SettingsSearchHit {
  page: SettingsPage;
  row?: SettingsRow;
  id: string;
  label: string;
  path: string;
}

export const SETTINGS_PAGES: SettingsPage[] = [
  // ── YOU ──────────────────────────────────────────────────────────────────
  {
    id: "account",
    path: "/settings/account",
    title: "Account",
    description: "Your profile, password, and the devices you're signed in on.",
    icon: UserRound,
    group: "you",
    needsAccount: true,
    keywords: [
      "account",
      "profile",
      "password",
      "sign out",
      "logout",
      "devices",
      "session",
      "email",
      "username",
      "security",
    ],
    rows: [
      {
        id: "session",
        label: "Session",
        keywords: ["session", "logout", "sign out"],
      },
      {
        id: "profile",
        label: "Profile",
        keywords: ["profile", "name", "email", "username"],
      },
      {
        id: "password",
        label: "Password",
        keywords: ["password", "security"],
      },
      {
        id: "tokens",
        label: "API tokens",
        keywords: ["tokens", "api key", "developer"],
      },
      {
        id: "devices",
        label: "Devices",
        keywords: ["devices", "signed in"],
      },
    ],
    load: () =>
      import("./AccountSettings").then((m) => ({
        default: m.AccountSettings,
      })),
  },
  {
    id: "appearance",
    path: "/settings/appearance",
    title: "Appearance",
    description: "How Contrack looks on this account.",
    icon: Palette,
    group: "you",
    keywords: [
      "appearance",
      "theme",
      "dark mode",
      "light mode",
      "night",
      "colour scheme",
      "color scheme",
      "accent",
      "colour",
      "color",
      "brand",
      "primary",
      "palette",
      "text size",
      "font size",
      "large text",
      "motion",
      "reduced motion",
      "animations",
      "list density",
      "compact",
      "comfortable",
      "rows",
      "spacing",
    ],
    rows: [
      {
        id: "theme",
        label: "Theme",
        keywords: [
          "theme",
          "appearance",
          "dark mode",
          "light mode",
          "night",
          "colour scheme",
          "color scheme",
        ],
      },
      {
        id: "accent",
        label: "Accent colour",
        keywords: ["accent", "colour", "color", "brand", "primary", "palette"],
      },
      {
        id: "text-scale",
        label: "Text size",
        keywords: [
          "text size",
          "font size",
          "large text",
          "scale",
          "accessibility",
        ],
      },
      {
        id: "motion",
        label: "Motion",
        keywords: [
          "motion",
          "reduced motion",
          "animations",
          "transitions",
          "accessibility",
        ],
      },
      {
        id: "list-density",
        label: "List density",
        keywords: ["list density", "compact", "comfortable", "rows", "spacing"],
      },
    ],
    load: () => import("./pages/AppearancePage"),
  },
  {
    id: "network",
    path: "/settings/network",
    title: "Network and contacts",
    description: "Where Contrack opens, contacts list defaults, and weather.",
    icon: Users,
    group: "you",
    keywords: [
      "network",
      "contacts",
      "where contrack opens",
      "start page",
      "landing page",
      "home page",
      "pulse",
      "default sort",
      "list sort",
      "sort order",
      "recent contacts",
      "recently visited",
      "history",
      "pinned",
      "cadence",
      "default cadence",
      "follow-up cadence",
      "week start",
      "week starts on",
      "monday",
      "sunday",
      "temperature unit",
      "celsius",
      "fahrenheit",
      "weather",
      "degrees",
    ],
    rows: [
      {
        id: "start-page",
        label: "Where Contrack opens",
        keywords: [
          "where contrack opens",
          "start page",
          "landing page",
          "home page",
          "pulse",
          "network",
        ],
      },
      {
        id: "list-sort",
        label: "Default sort",
        keywords: [
          "default sort",
          "list sort",
          "sort order",
          "name",
          "recent",
          "score",
        ],
      },
      {
        id: "recent-contacts",
        label: "Recent contacts",
        keywords: ["recent contacts", "recently visited", "history", "pinned"],
      },
      {
        id: "cadence",
        label: "Default follow-up cadence",
        keywords: [
          "cadence",
          "default cadence",
          "follow-up",
          "cadence days",
          "score",
        ],
      },
      {
        id: "week-start",
        label: "Week starts on",
        keywords: [
          "week start",
          "week starts on",
          "monday",
          "sunday",
          "calendar",
          "timeline",
        ],
      },
      {
        id: "weather",
        label: "Local time and weather",
        keywords: [
          "weather",
          "local time",
          "open-meteo",
          "temperature",
          "forecast",
        ],
      },
      {
        id: "temp-unit",
        label: "Temperature unit",
        keywords: [
          "temperature unit",
          "celsius",
          "fahrenheit",
          "weather",
          "degrees",
        ],
      },
    ],
    load: () => import("./pages/NetworkPage"),
  },
  {
    id: "keyboard",
    path: "/settings/keyboard",
    title: "Keyboard",
    description: "Single-key shortcuts and keyboard reference table.",
    icon: Keyboard,
    group: "you",
    keywords: [
      "keyboard",
      "shortcuts",
      "hotkeys",
      "keybindings",
      "single-key shortcuts",
      "bare keys",
    ],
    rows: [
      {
        id: "single-key-shortcuts",
        label: "Single-key shortcuts",
        keywords: [
          "single-key shortcuts",
          "keyboard",
          "bare keys",
          "shortcuts",
          "hotkeys",
        ],
      },
    ],
    load: () => import("./pages/KeyboardPage"),
  },
  {
    id: "privacy",
    path: "/settings/privacy",
    title: "Privacy and AI",
    description: "AI opt-out, data handling, and available capabilities.",
    icon: Shield,
    group: "you",
    keywords: [
      "privacy",
      "ai",
      "opt out",
      "ai assist",
      "data",
      "local",
      "models",
      "providers",
      "capabilities",
      "history",
      "recent",
      "searches",
    ],
    rows: [
      {
        id: "ai-assist",
        label: "Use AI for this account",
        keywords: [
          "use ai",
          "ai assist",
          "privacy",
          "opt out",
          "disable ai",
          "models",
        ],
      },
      {
        id: "search-history",
        label: "Search history",
        keywords: ["history", "recent", "searches"],
      },
    ],
    load: () => import("./pages/PrivacyPage"),
  },
  {
    id: "ai-usage",
    path: "/settings/ai-usage",
    title: "AI Usage",
    description:
      "Invocations, token spend, cache hit rate, and approximate cost.",
    icon: Gauge,
    group: "you",
    admin: false,
    keywords: ["ai usage", "stats", "tokens", "cost", "cache", "invocations"],
    load: () => import("../ai-stats").then((m) => ({ default: m.AIStatsView })),
  },

  // ── TOOLS ────────────────────────────────────────────────────────────────
  {
    id: "import",
    path: "/settings/import",
    title: "Import",
    description:
      "Bring in contacts from vCard, CSV, Google, LinkedIn or Apple.",
    icon: UploadCloud,
    group: "tools",
    keywords: [
      "import",
      "vcard",
      "vcf",
      "csv",
      "google",
      "google contacts",
      "linkedin",
      "apple",
      "contacts",
      "upload",
    ],
    load: () => import("./pages/ImportPage"),
  },
  {
    id: "duplicates",
    path: "/settings/duplicates",
    title: NAMES.duplicates.title,
    description: NAMES.duplicates.description,
    icon: Copy,
    group: "tools",
    ownsScrolling: true,
    keywords: [
      "duplicates",
      "dedupe",
      "merge",
      "suggestions",
      "auto-merge sensitivity",
      "threshold",
      "dedupe on create",
      "dedupe on import",
    ],
    rows: [
      {
        id: "sensitivity",
        label: "Auto-merge sensitivity",
        keywords: [
          "auto-merge sensitivity",
          "duplicates",
          "dedupe",
          "merge",
          "threshold",
        ],
      },
      {
        id: "dedupe-on-create",
        label: "Check new contacts automatically",
        keywords: [
          "dedupe on create",
          "check new contacts",
          "automatic duplicate check",
          "duplicates",
        ],
      },
      {
        id: "dedupe-on-import",
        label: "Check imports automatically",
        keywords: [
          "dedupe on import",
          "check imports",
          "automatic import scan",
          "duplicates",
        ],
      },
    ],
    load: () => import("./pages/DuplicatesPage"),
  },
  {
    id: "enrichment",
    path: "/settings/enrichment",
    title: NAMES.enrichment.title,
    description: NAMES.enrichment.description,
    icon: Sparkles,
    group: "tools",
    keywords: [
      "contact enrichment",
      "ai search",
      "research",
      "web",
      "hydrate",
      "auto enrich",
      "grounding",
    ],
    rows: [
      {
        id: "auto-enrich",
        label: "Enrich new contacts automatically",
        keywords: [
          "auto enrich",
          "enrich new contacts",
          "research",
          "automatic enrichment",
        ],
      },
      {
        id: "grounding",
        label: "Grounding capacity",
        keywords: ["grounding", "grounding capacity", "quota", "used"],
      },
    ],
    load: () => import("./pages/EnrichmentPage"),
  },

  // ── DATA ─────────────────────────────────────────────────────────────────
  {
    id: "tags",
    path: "/settings/tags",
    title: "Tags",
    description: "Organise contacts with labels. Rename, merge, or delete.",
    icon: Tag,
    group: "data",
    keywords: [
      "tags",
      "tag",
      "labels",
      "organise",
      "organize",
      "rename tag",
      "merge tag",
      "delete tag",
    ],
    load: () => import("./pages/TagsPage"),
  },
  {
    id: "lists",
    path: "/settings/lists",
    title: "Lists",
    description:
      "Reorder, rename, and delete lists, and manage who belongs to each.",
    icon: List,
    group: "data",
    ownsScrolling: true,
    keywords: ["lists", "groups", "members", "reorder"],
    load: () =>
      import("../lists").then((m) => ({ default: m.ListManagerView })),
  },
  {
    id: "export",
    path: "/settings/export",
    title: "Export",
    description: "Take your contacts and interactions with you.",
    icon: Download,
    group: "data",
    keywords: [
      "export",
      "download",
      "backup my contacts",
      "vcard",
      "vcf",
      "csv",
      "json",
      "migrate",
      "take my data",
    ],
    rows: [
      {
        id: "export",
        label: "Export",
        keywords: [
          "export",
          "download",
          "backup my contacts",
          "vcard",
          "vcf",
          "csv",
          "json",
          "migrate",
          "take my data",
        ],
      },
    ],
    load: () => import("./pages/ExportPage"),
  },
  {
    id: "archived",
    path: "/settings/archived",
    title: "Archived Contacts",
    description: "Hidden from your Network and Map. Restore them at any time.",
    icon: Archive,
    tone: "amber",
    group: "data",
    keywords: ["archived contacts", "archive", "hidden"],
    load: () =>
      import("../ArchivedContactsView").then((m) => ({
        default: m.ArchivedContactsView,
      })),
  },
  {
    id: "trash",
    path: "/settings/trash",
    title: "Trash",
    description: "Recently deleted contacts. Empties itself after 30 days.",
    icon: Trash2,
    tone: "danger",
    group: "data",
    keywords: ["trash", "deleted", "restore", "bin", "recycle"],
    load: () => import("../TrashView").then((m) => ({ default: m.TrashView })),
  },

  // ── CONNECT ──────────────────────────────────────────────────────────────
  {
    id: "connectors",
    path: "/settings/connectors",
    title: NAMES.connectors.title,
    description: NAMES.connectors.description,
    icon: Cable,
    group: "connect",
    keywords: [
      "connectors",
      "calendar",
      "ics",
      "sync",
      "google",
      "mailbox",
      "imap",
      "messages",
      "imessage",
      "whatsapp",
    ],
    rows: [
      {
        id: "gallery",
        label: "Available connectors",
        keywords: ["calendar", "mail", "google", "imessage", "whatsapp"],
      },
    ],
    load: () =>
      import("./connectors/ConnectorsView").then((m) => ({
        default: m.ConnectorsView,
      })),
  },
  {
    id: "correspondents",
    path: "/settings/connectors/people",
    title: NAMES.correspondents.title,
    description: NAMES.correspondents.description,
    icon: Users,
    group: "connect",
    keywords: [
      "correspondents",
      "people",
      "connectors",
      "unmatched",
      "contacts",
      "review",
      "inbox",
    ],
    load: () =>
      import("./connectors/CorrespondentsView").then((m) => ({
        default: m.CorrespondentsView,
      })),
  },
  {
    id: "mcp",
    path: "/settings/mcp",
    title: NAMES.mcp.title,
    description: NAMES.mcp.description,
    icon: Terminal,
    group: "connect",
    keywords: [
      "mcp",
      "api",
      "claude",
      "cursor",
      "tokens",
      "tools",
      "streamable http",
      "model context protocol",
      "llm",
    ],
    rows: [
      {
        id: "endpoint",
        label: "MCP endpoint URL",
        keywords: ["endpoint", "url", "streamable", "api"],
      },
      {
        id: "token",
        label: "Personal API token",
        keywords: ["token", "bearer", "authorization", "auth", "ctk_"],
      },
      {
        id: "claude-code",
        label: "Claude Code",
        keywords: ["claude", "code", "cli", "terminal"],
      },
      {
        id: "claude-desktop",
        label: "Claude Desktop and Cursor",
        keywords: [
          "claude",
          "desktop",
          "cursor",
          "json",
          "config",
          "mcp-remote",
        ],
      },
      {
        id: "curl",
        label: "curl",
        keywords: ["curl", "initialize", "http", "bash"],
      },
      {
        id: "tools",
        label: "Tools",
        keywords: [
          "tools",
          "read-only",
          "search",
          "contacts",
          "pulse",
          "actions",
        ],
      },
    ],
    load: () => import("./mcp/McpView"),
  },

  // ── ADMINISTRATION ───────────────────────────────────────────────────────
  {
    id: "admin-general",
    path: "/settings/admin/general",
    title: "General",
    description:
      "Who can join, how long a sign-in lasts, and instance settings.",
    icon: ServerCog,
    group: "admin",
    admin: true,
    keywords: [
      "instance",
      "registration",
      "session length",
      "sign-in length",
      "trash",
      "backups",
      "integrations",
      "mapbox",
      "searxng",
      "general",
      "admin",
    ],
    rows: [
      {
        id: "name",
        label: "Instance name",
        keywords: ["name", "instance name", "admin"],
      },
      {
        id: "registration",
        label: "Who can join",
        keywords: [
          "registration",
          "join",
          "who can join",
          "magic link",
          "admin",
        ],
      },
      {
        id: "session-length",
        label: "Session length",
        keywords: ["session length", "sign-in length", "admin"],
      },
      {
        id: "trash",
        label: "Trash retention",
        keywords: ["trash", "retention", "purge", "deleted", "admin"],
      },
      {
        id: "backups",
        label: "Backup schedule",
        keywords: [
          "backup",
          "backups",
          "snapshot",
          "interval",
          "keep",
          "schedule",
          "admin",
        ],
      },
      {
        id: "integrations",
        label: "Integrations",
        keywords: [
          "integrations",
          "mapbox",
          "searxng",
          "maps",
          "geocoding",
          "search",
          "admin",
        ],
      },
    ],
    load: () => import("./admin/GeneralView"),
  },
  {
    id: "admin-users",
    path: "/settings/admin/users",
    title: "Accounts",
    description:
      "Everyone with an account here. Create, invite, disable, and remove.",
    icon: Users,
    group: "admin",
    admin: true,
    keywords: [
      "accounts",
      "users",
      "people",
      "roles",
      "admin",
      "disable",
      "delete user",
      "reset password",
    ],
    load: () =>
      import("./admin/UsersView").then((m) => ({ default: m.UsersView })),
  },
  {
    id: "admin-invitations",
    path: "/settings/admin/invitations",
    title: "Invitations",
    description: "Links that create an account. Each one works exactly once.",
    icon: MailPlus,
    group: "admin",
    admin: true,
    keywords: ["invitations", "invite", "join", "link", "admin"],
    load: () =>
      import("./admin/InvitationsView").then((m) => ({
        default: m.InvitationsView,
      })),
  },
  {
    id: "admin-mail",
    path: "/settings/admin/mail",
    title: NAMES.outgoingMail.title,
    description: NAMES.outgoingMail.description,
    icon: Mail,
    group: "admin",
    admin: true,
    keywords: ["outgoing mail", "mail", "smtp", "email", "server", "admin"],
    load: () => import("./admin/MailView"),
  },
  {
    id: "admin-ai",
    path: "/settings/admin/ai",
    title: "AI providers",
    description: "Connect provider API keys and configure AI capabilities.",
    icon: Brain,
    group: "admin",
    admin: true,
    keywords: [
      "ai configuration",
      "providers",
      "models",
      "gemini",
      "openai",
      "anthropic",
      "ollama",
      "api key",
      "capabilities",
      "admin",
    ],
    load: () => import("./admin/AiProvidersView"),
  },
  {
    id: "admin-ai-usage",
    path: "/settings/admin/ai-usage",
    title: "AI Usage",
    description:
      "Invocations, token spend, cache hit rate, and approximate cost.",
    icon: Gauge,
    group: "admin",
    admin: true,
    keywords: [
      "ai usage",
      "stats",
      "tokens",
      "cost",
      "cache",
      "invocations",
      "admin",
    ],
    load: () => import("../ai-stats").then((m) => ({ default: m.AIStatsView })),
  },
  {
    id: "admin-backups",
    path: "/settings/admin/backups",
    title: "Backups",
    description: "Snapshots of the whole database, and taking one now.",
    icon: DatabaseBackup,
    group: "admin",
    admin: true,
    keywords: ["backups", "snapshot", "database", "restore", "admin"],
    load: () =>
      import("./admin/BackupsView").then((m) => ({
        default: m.BackupsView,
      })),
  },
  {
    id: "admin-audit",
    path: "/settings/admin/audit",
    title: "Audit log",
    description: "Every administrative action and every sign-in, newest first.",
    icon: ScrollText,
    group: "admin",
    admin: true,
    keywords: ["audit", "log", "history", "who did", "admin"],
    load: () =>
      import("./admin/AuditView").then((m) => ({ default: m.AuditView })),
  },
  {
    id: "admin-health",
    path: "/settings/admin/health",
    title: "Instance health",
    description: "Schema, database, backups, queues, and the AI provider.",
    icon: Activity,
    group: "admin",
    admin: true,
    keywords: [
      "health",
      "instance",
      "status",
      "uptime",
      "diagnostics",
      "admin",
    ],
    load: () =>
      import("./admin/HealthView").then((m) => ({
        default: m.HealthView,
      })),
  },
];

export type RedirectTarget = string | ((ctx: { isAdmin: boolean }) => string);

export const REDIRECTS: Record<string, RedirectTarget> = {
  "/settings/dedupe": "/settings/duplicates",
  "/settings/ai-search": "/settings/enrichment",
  "/settings/ai-stats": ({ isAdmin }) =>
    isAdmin ? "/settings/admin/ai-usage" : "/settings/ai-usage",
  "/settings/ai-config": "/settings/admin/ai",
  "/settings/admin/instance": "/settings/admin/general",
};

/**
 * Search the registry for settings rows matching the query.
 *
 * Matches against row labels and keywords, as well as page titles and keywords.
 * Returns row-level hits linked to path#rowId.
 */
export function findRows(
  query: string,
  opts?: { isAdmin?: boolean },
): SettingsSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const results: SettingsSearchHit[] = [];
  const seenPaths = new Set<string>();

  for (const page of SETTINGS_PAGES) {
    if (!opts?.isAdmin && page.admin) continue;

    let matchedRowOnThisPage = false;

    if (page.rows && page.rows.length > 0) {
      for (const row of page.rows) {
        const matchesLabel = row.label.toLowerCase().includes(q);
        const matchesKeywords = row.keywords.some((k) =>
          k.toLowerCase().includes(q),
        );
        const matchesId = row.id.toLowerCase().includes(q);

        if (matchesLabel || matchesKeywords || matchesId) {
          const hitPath = `${page.path}#${row.id}`;
          if (!seenPaths.has(hitPath)) {
            seenPaths.add(hitPath);
            results.push({
              page,
              row,
              id: row.id,
              label: row.label,
              path: hitPath,
            });
            matchedRowOnThisPage = true;
          }
        }
      }
    }

    // If no individual row matched, check if the page itself matches
    if (!matchedRowOnThisPage) {
      const pageMatches =
        page.title.toLowerCase().includes(q) ||
        page.description.toLowerCase().includes(q) ||
        page.keywords.some((k) => k.toLowerCase().includes(q));

      if (pageMatches) {
        if (page.rows && page.rows.length > 0) {
          // If the page matched by keyword/title, include all of its rows
          for (const row of page.rows) {
            const hitPath = `${page.path}#${row.id}`;
            if (!seenPaths.has(hitPath)) {
              seenPaths.add(hitPath);
              results.push({
                page,
                row,
                id: row.id,
                label: row.label,
                path: hitPath,
              });
            }
          }
        } else {
          // Page has no sub-rows: return the page itself
          if (!seenPaths.has(page.path)) {
            seenPaths.add(page.path);
            results.push({
              page,
              row: undefined,
              id: page.id,
              label: page.title,
              path: page.path,
            });
          }
        }
      }
    }
  }

  return results;
}
