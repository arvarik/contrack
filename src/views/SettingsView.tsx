/**
 * SettingsView — the Settings shell.
 *
 * Owns the page chrome (header, back affordance, document title) and the
 * nested routes. The landing page's own content lives in
 * `views/settings/SettingsHome` — this file is deliberately just the frame,
 * because it previously held both and the routing was buried under 300 lines
 * of card markup.
 *
 * Each subpage declares itself in SUBPAGES, once, and the header, icon, and
 * document title all read from that single entry.
 */
import React, { Suspense } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  Archive,
  Brain,
  ChevronLeft,
  Copy,
  DatabaseBackup,
  Gauge,
  List,
  Loader2,
  MailPlus,
  ScrollText,
  ServerCog,
  Settings as SettingsIcon,
  Sparkles,
  Trash2,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { DedupeView } from "./dedupe";
import { ArchivedContactsView } from "./ArchivedContactsView";
import { TrashView } from "./TrashView";
import { ListManagerView } from "./lists";
import { AISearchView } from "./ai-search";
import { AIStatsView } from "./ai-stats";
import { SettingsHome } from "./settings/SettingsHome";
import { AccountSettings } from "./settings/AccountSettings";
import { RequireAdmin } from "../components/auth/RequireAdmin";
import { useAuth } from "../components/auth/AuthGate";
import { ICON_BTN, PAGE_TITLE } from "../lib/styles";
import { cn } from "../lib/utils";
import { usePageTitle } from "../hooks/usePageTitle";

// ---------------------------------------------------------------------------
// The administration area, loaded only for the people who can open it
// ---------------------------------------------------------------------------
// Every other subpage here is a static import, so all eight share the one
// Settings chunk. These five are not, and the reason is not size: a member
// can never open any of them, and a member should not download five pages of
// account management to be told they may not. The split shows up in the build
// output as chunks of their own, which is the check.

const lazyAdmin = <T extends object>(
  load: () => Promise<Record<string, React.ComponentType<T>>>,
  name: string,
) =>
  React.lazy(() =>
    load().then((module) => ({
      default: module[name] as React.ComponentType<T>,
    })),
  );

const UsersView = lazyAdmin<{ createOpen?: boolean }>(
  () => import("./settings/admin/UsersView"),
  "UsersView",
);
const InvitationsView = lazyAdmin(
  () => import("./settings/admin/InvitationsView"),
  "InvitationsView",
);
const InstanceView = lazyAdmin(
  () => import("./settings/admin/InstanceView"),
  "InstanceView",
);
const BackupsView = lazyAdmin(
  () => import("./settings/admin/BackupsView"),
  "BackupsView",
);
const AuditView = lazyAdmin(
  () => import("./settings/admin/AuditView"),
  "AuditView",
);

// ---------------------------------------------------------------------------
// Subpage registry
// ---------------------------------------------------------------------------

interface SubpageMeta {
  /**
   * The path under /settings.
   *
   * It used to be one segment. The administration pages are two deep, so the
   * lookup matches on the whole remainder of the path and takes the longest
   * entry that fits — which is also what lets `/settings/admin/users/new`
   * borrow the title of `/settings/admin/users` without its own entry.
   */
  segment: string;
  title: string;
  icon: LucideIcon;
  /** Icon tint — matches the tone used on the landing page row. */
  tone: string;
}

const SUBPAGES: SubpageMeta[] = [
  {
    segment: "account",
    title: "Account",
    icon: UserRound,
    tone: "text-primary",
  },
  {
    segment: "ai-config",
    title: "AI Configuration",
    icon: Brain,
    tone: "text-primary",
  },
  {
    segment: "ai-search",
    title: "Contact Enrichment",
    icon: Sparkles,
    tone: "text-primary",
  },
  { segment: "ai-stats", title: "AI Usage", icon: Gauge, tone: "text-primary" },
  { segment: "lists", title: "Lists", icon: List, tone: "text-primary" },
  { segment: "dedupe", title: "Duplicates", icon: Copy, tone: "text-primary" },
  {
    segment: "archived",
    title: "Archived Contacts",
    icon: Archive,
    tone: "text-warning",
  },
  { segment: "trash", title: "Trash", icon: Trash2, tone: "text-error" },
  {
    segment: "admin/users",
    title: "Accounts",
    icon: Users,
    tone: "text-primary",
  },
  {
    segment: "admin/invitations",
    title: "Invitations",
    icon: MailPlus,
    tone: "text-primary",
  },
  {
    segment: "admin/instance",
    title: "Instance",
    icon: ServerCog,
    tone: "text-primary",
  },
  {
    segment: "admin/backups",
    title: "Backups",
    icon: DatabaseBackup,
    tone: "text-primary",
  },
  {
    segment: "admin/audit",
    title: "Audit log",
    icon: ScrollText,
    tone: "text-primary",
  },
];

/**
 * The AI configuration page moved under Administration in 2.0, because one
 * set of provider keys pays one bill for the whole instance. The old route
 * stays and redirects, so a bookmark and every link written before now still
 * arrive somewhere useful. A member has nowhere to be sent, so they go back
 * to Settings rather than to a page that would refuse them.
 */
const AiConfigRedirect = () => {
  const { isAdmin } = useAuth();
  return (
    <Navigate to={isAdmin ? "/settings/admin/instance" : "/settings"} replace />
  );
};

/** The fallback while an administration chunk is fetched. */
const AdminFallback = () => (
  <div className="p-6 flex items-center gap-2 text-sm text-on-surface-variant">
    <Loader2 className="w-4 h-4 animate-spin" />
    Loading…
  </div>
);

/** An administration route: admins only, lazy, and scrolled by this shell. */
const AdminRoute = ({ children }: { children: React.ReactNode }) => (
  <RequireAdmin>
    <div className="overflow-y-auto h-full">
      {/*
        The Suspense boundary is INSIDE the routed area, below the header. The
        nearest one otherwise is in App.tsx, outside this component, so
        suspending would replace the whole Settings shell — header, back
        button and all — on every navigation into an administration page.
      */}
      <Suspense fallback={<AdminFallback />}>{children}</Suspense>
    </div>
  </RequireAdmin>
);

// ---------------------------------------------------------------------------

export const SettingsView = () => {
  const location = useLocation();
  const navigate = useNavigate();

  // Everything after "/settings/", so a two-level administration path is
  // matched whole. Longest first, because "admin/users" must beat nothing and
  // "admin/users/new" must fall back to it.
  const path = location.pathname.replace(/^\/settings\/?/, "");
  const subpage = [...SUBPAGES]
    .sort((a, b) => b.segment.length - a.segment.length)
    .find(
      (page) => path === page.segment || path.startsWith(`${page.segment}/`),
    );
  const segment = subpage?.segment ?? "";

  const title = subpage?.title ?? "Settings";
  const Icon = subpage?.icon ?? SettingsIcon;

  // The tab title tracks the subpage, so a settings tab left open is
  // identifiable without switching to it.
  usePageTitle(title);

  // Dedupe and Lists manage their own scrolling panes; everything else
  // scrolls in this container.
  const ownsScrolling = segment === "dedupe" || segment === "lists";

  return (
    <div className="h-full flex flex-col overflow-hidden bg-surface text-on-surface">
      <header className="px-4 sm:px-6 py-4 sm:py-5 bg-surface-container-low shrink-0">
        <div className="flex items-center gap-3 sm:gap-4">
          <button
            onClick={() => navigate(subpage ? "/settings" : "/")}
            // `ICON_BTN` alone is `p-2`, which is 36 px with a 20 px icon —
            // under the 44 px floor, on the one control every page in this
            // area shares. The floor is added here rather than to `ICON_BTN`
            // itself, which the dense toolbars it was written for still want.
            className={cn(
              ICON_BTN,
              "inline-flex items-center justify-center min-w-[44px] min-h-[44px]",
            )}
            aria-label={subpage ? "Back to Settings" : "Back to Network"}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className={cn(PAGE_TITLE, "flex items-center gap-3 min-w-0")}>
            <span className="p-2 bg-primary/10 rounded-xl shrink-0">
              <Icon
                className={cn(
                  "w-5 h-5 sm:w-6 sm:h-6",
                  subpage?.tone ?? "text-primary",
                )}
              />
            </span>
            <span className="truncate">{title}</span>
          </h1>
        </div>
      </header>

      <div
        className={cn(
          "flex-1",
          ownsScrolling ? "overflow-hidden" : "overflow-y-auto",
        )}
      >
        <Routes>
          <Route path="/" element={<SettingsHome />} />

          <Route
            path="/account"
            element={
              <div className="overflow-y-auto h-full">
                <AccountSettings />
              </div>
            }
          />

          <Route
            path="/dedupe"
            element={
              <div className="absolute inset-0 z-50 bg-surface">
                <DedupeView embedded />
              </div>
            }
          />

          <Route
            path="/lists"
            element={
              <div className="h-full overflow-hidden">
                <ListManagerView />
              </div>
            }
          />

          <Route
            path="/archived"
            element={
              <div className="overflow-y-auto h-full">
                <ArchivedContactsView />
              </div>
            }
          />

          <Route path="/ai-config" element={<AiConfigRedirect />} />

          <Route
            path="/admin/users"
            element={
              <AdminRoute>
                <UsersView />
              </AdminRoute>
            }
          />
          <Route
            path="/admin/users/new"
            element={
              <AdminRoute>
                <UsersView createOpen />
              </AdminRoute>
            }
          />
          <Route
            path="/admin/invitations"
            element={
              <AdminRoute>
                <InvitationsView />
              </AdminRoute>
            }
          />
          <Route
            path="/admin/instance"
            element={
              <AdminRoute>
                <InstanceView />
              </AdminRoute>
            }
          />
          <Route
            path="/admin/backups"
            element={
              <AdminRoute>
                <BackupsView />
              </AdminRoute>
            }
          />
          <Route
            path="/admin/audit"
            element={
              <AdminRoute>
                <AuditView />
              </AdminRoute>
            }
          />

          {/*
            Anything else under /settings. `/settings/admin` is now a
            plausible URL to type or to have in a history, and it matched no
            route: the frame rendered with an empty body, the header fell back
            to "Settings", and the back button offered to leave Settings
            altogether.
          */}
          <Route path="*" element={<Navigate to="/settings" replace />} />

          <Route
            path="/trash"
            element={
              <div className="overflow-y-auto h-full">
                <TrashView />
              </div>
            }
          />

          <Route
            path="/ai-search"
            element={
              <div className="overflow-y-auto h-full">
                <AISearchView />
              </div>
            }
          />

          <Route
            path="/ai-stats"
            element={
              <div className="overflow-y-auto h-full">
                <AIStatsView />
              </div>
            }
          />
        </Routes>
      </div>
    </div>
  );
};
