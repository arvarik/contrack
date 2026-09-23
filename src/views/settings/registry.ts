/**
 * registry.ts — One registry for all settings pages, rows, redirects and search.
 *
 * Drives the two-pane shell on wide screens, the mobile landing list,
 * row-level search with deep links, palette navigation and URL redirects.
 *
 * @module views/settings/registry
 */
import React from "react";
import { Navigate } from "react-router-dom";
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
  Radar,
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
import type { Tone } from "../../lib/styles";

export type SettingsGroup = "you" | "tools" | "data" | "connect" | "admin";

export interface SettingsGroupMeta {
  id: SettingsGroup;
  title: string;
}

export const SETTINGS_GROUPS: SettingsGroupMeta[] = [
  { id: "you", title: "You" },
  { id: "tools", title: "Tools" },
  { id: "data", title: "Your data" },
  { id: "connect", title: "Connect" },
  { id: "admin", title: "Administration" },
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
  /** The colour of the page's tile on the landing list. Primary by default. */
  tone?: Tone;
  admin?: boolean;
  needsAccount?: boolean;
  keywords: string[];
  rows?: SettingsRow[];
  load: () => Promise<{ default: React.ComponentType }>;
  ownsScrolling?: boolean;
  /**
   * A page that owns its scrolling but sits in the centred settings box, as
   * every page that does not own it: the shell's header takes the box too,
   * so the title starts at the same place as on every other settings page.
   */
  boxed?: boolean;
  /**
   * A door to a page outside Settings: its route steps over to that page.
   * A link to it navigates at once, with no slide.
   */
  door?: boolean;
  /**
   * An admin reaches the same page under Administration, where it covers
   * every account, so the rail, the list and the search leave this one out
   * for an admin.
   */
  memberOnly?: boolean;
}

export interface SettingsSearchHit {
  page: SettingsPage;
  row?: SettingsRow;
  id: string;
  label: string;
  path: string;
}

/** Settings, Data lists the Tracked contacts page and steps over to it. */
const TrackedRedirect = () =>
  React.createElement(Navigate, { to: "/tracked", replace: true });

export const SETTINGS_PAGES: SettingsPage[] = [
  // ── YOU ──────────────────────────────────────────────────────────────────
  {
    id: "account",
    path: "/settings/account",
    title: "Account",
    description: "Your profile, how you sign in, your devices, and API tokens.",
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
      "corvid",
      "bird",
      "mascot",
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
        id: "mascot-motion",
        label: "Corvid motion",
        keywords: [
          "corvid",
          "bird",
          "mascot",
          "logo",
          "raven",
          "crow",
          "blink",
          "fly",
          "flight",
          "animations",
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
    description:
      "Where Contrack opens, the contact list, cadence, and weather.",
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
      "keep up",
      "track new contacts",
      "track",
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
        keywords: ["default sort", "list sort", "sort order", "name", "recent"],
      },
      {
        id: "recent-contacts",
        label: "Recent contacts",
        keywords: ["recent contacts", "recently visited", "history", "pinned"],
      },
      {
        id: "cadence",
        label: "Default cadence",
        keywords: [
          "cadence",
          "default cadence",
          "keep up",
          "cadence days",
          "score",
        ],
      },
      {
        id: "track-new",
        label: "Track new contacts",
        keywords: [
          "track new contacts",
          "track",
          "tracked",
          "keep up",
          "new contacts",
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
        label: "Weather",
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
    description: "Single-key shortcuts, and every shortcut in one list.",
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
    description:
      "Whether Contrack uses AI for you, and what stays on this machine.",
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
    title: "AI usage",
    description: "How much AI your account used, and what it cost.",
    icon: Gauge,
    group: "you",
    memberOnly: true,
    keywords: ["ai usage", "stats", "tokens", "cost", "cache", "invocations"],
    load: () => import("../ai-stats").then((m) => ({ default: m.AIStatsView })),
  },

  // ── TOOLS ────────────────────────────────────────────────────────────────
  {
    id: "import",
    path: "/settings/import",
    title: "Import",
    description: "Bring in contacts from Apple, LinkedIn, Google or Facebook.",
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
      "facebook",
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
    boxed: true,
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
        label: "Web searches today",
        keywords: [
          "web searches",
          "grounding",
          "grounding capacity",
          "quota",
          "used",
        ],
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
    boxed: true,
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
    // A door, not a page. The Tracked contacts page lives at /tracked,
    // beside the Network, so this entry puts it in the rail, the phone's
    // landing list, the settings search and the palette, and its route
    // steps over to the page. `REDIRECTS` cannot hold it: every target
    // there must be a settings page.
    id: "tracked",
    path: "/settings/tracked",
    title: NAMES.tracked.title,
    description: NAMES.tracked.description,
    icon: Radar,
    group: "data",
    door: true,
    keywords: [
      "tracked",
      "track",
      "keep up",
      "cadence",
      "score",
      "at risk",
      "fading",
      "strong",
    ],
    load: () => Promise.resolve({ default: TrackedRedirect }),
  },
  {
    id: "archived",
    path: "/settings/archived",
    title: "Archived contacts",
    description: "Hidden from your Network and Map. Restore them at any time.",
    icon: Archive,
    tone: "warning",
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
    description: "Deleted contacts, until they are removed for good.",
    icon: Trash2,
    tone: "error",
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
      "email",
      "gmail",
      "outlook",
    ],
    rows: [
      {
        id: "gallery",
        label: "Available connectors",
        keywords: ["calendar", "mail", "google", "imap", "email"],
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
      "Who can join, how long a sign-in lasts, Trash, backups, and integrations.",
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
        keywords: ["integrations", "searxng", "search", "admin"],
      },
    ],
    load: () => import("./admin/GeneralView"),
  },
  {
    id: "admin-users",
    path: "/settings/admin/users",
    title: "Accounts",
    description:
      "Everyone with an account here. Each account sees only its own contacts.",
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
    description: "Provider keys, and which model does each kind of work.",
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
    title: "AI usage",
    description: "How much AI each account used, and what it cost.",
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
    description:
      "Snapshots of the whole database, each one checked as it is taken.",
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
    description: "What this instance reports about itself, every 15 seconds.",
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

/** Who is looking: an admin, and whether this instance asks anyone to sign in. */
export interface SettingsViewer {
  isAdmin?: boolean;
  /** Undefined when the caller does not know, which shows the page. */
  authRequired?: boolean;
}

/**
 * Whether a page is offered to this person. The rail, the list, and the
 * search ask this one question, so the three never disagree.
 */
export function isSettingsPageVisible(
  page: SettingsPage,
  viewer: SettingsViewer = {},
): boolean {
  if (page.admin && !viewer.isAdmin) return false;
  if (page.memberOnly && viewer.isAdmin) return false;
  if (page.needsAccount && viewer.authRequired === false) return false;
  return true;
}

/**
 * The page a path belongs to: the page with the longest path that the path
 * is or sits under. `/settings/connectors/people` is Correspondents, not
 * Connectors.
 */
export function findSettingsPage(pathname: string): SettingsPage | undefined {
  let found: SettingsPage | undefined;
  for (const page of SETTINGS_PAGES) {
    const matches =
      pathname === page.path || pathname.startsWith(`${page.path}/`);
    if (matches && (!found || page.path.length > found.path.length)) {
      found = page;
    }
  }
  return found;
}

/** The settings list's own path, the parent of every settings page. */
export const SETTINGS_LIST_PATH = "/settings";

/**
 * The link above a settings page's title, or none.
 *
 * From `lg` there is none: the rail and the app's sidebar are both on
 * screen, so a back link would say nothing they do not, and it pushed every
 * settings title below every other page's. Below `lg` a page links back to
 * the settings list, its parent, and the list itself has none.
 */
export function settingsBackLink(
  pathname: string,
  isWide: boolean,
): { to: string; label: string } | undefined {
  if (isWide || !findSettingsPage(pathname)) return undefined;
  return { to: SETTINGS_LIST_PATH, label: NAMES.settings.label };
}

/**
 * Search the registry for settings rows matching the query.
 *
 * Matches against row labels and keywords, as well as page titles and keywords.
 * Returns row-level hits linked to path#rowId.
 */
export function findRows(
  query: string,
  opts?: SettingsViewer,
): SettingsSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const results: SettingsSearchHit[] = [];
  const seenPaths = new Set<string>();

  for (const page of SETTINGS_PAGES) {
    if (!isSettingsPageVisible(page, opts)) continue;

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
