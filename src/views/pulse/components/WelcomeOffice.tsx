import React from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Sparkles,
  Upload,
  PenLine,
  Bot,
  Calendar,
  ChevronRight,
} from "lucide-react";
import { CARD } from "../../../lib/styles";
import { useAuth } from "../../../components/auth/AuthGate";
import { SETTINGS_PAGES } from "../../settings/registry";
import { openQuickNote } from "../../../lib/appEvents";

export const WelcomeOffice = () => {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();

  const hasConnectorsPage = SETTINGS_PAGES.some(
    (p) => p.id === "connectors" || p.path === "/settings/connectors",
  );

  const aiSettingsPath = isAdmin
    ? "/settings/admin/ai"
    : "/settings/privacy#ai-assist";

  return (
    <div className={CARD}>
      <div className="p-6 sm:p-8 space-y-6">
        <div>
          <div className="flex items-center gap-2 text-primary font-bold text-xs uppercase tracking-wider mb-2">
            <Sparkles className="w-4 h-4" />
            <span>Welcome to Pulse</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold font-headline text-on-surface">
            Set up your office
          </h2>
          <p className="text-sm text-on-surface-variant mt-1">
            Get your network into Contrack to start seeing follow-ups,
            intelligence, and the people you keep up with.
          </p>
        </div>

        <div className="space-y-3">
          {/* Step 1: Import contacts */}
          <button
            onClick={() => navigate("/?import=1")}
            className="w-full flex items-center justify-between p-4 rounded-xl bg-surface-container-lowest hover:bg-surface-container border border-outline/10 transition-colors text-left group cursor-pointer"
          >
            <div className="flex items-start gap-3.5">
              <div className="p-2 rounded-lg bg-primary/10 text-primary mt-0.5 shrink-0">
                <Upload className="w-5 h-5" />
              </div>
              <div>
                <span className="text-sm font-bold text-on-surface group-hover:text-primary transition-colors block">
                  Import contacts
                </span>
                <span className="text-xs text-on-surface-variant mt-0.5 block">
                  Bring in contacts from a CSV or vCard file.
                </span>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-on-surface-variant group-hover:text-primary shrink-0 transition-transform group-hover:translate-x-0.5" />
          </button>

          {/* Step 2: Log your first note */}
          <button
            onClick={() => openQuickNote()}
            className="w-full flex items-center justify-between p-4 rounded-xl bg-surface-container-lowest hover:bg-surface-container border border-outline/10 transition-colors text-left group cursor-pointer"
          >
            <div className="flex items-start gap-3.5">
              <div className="p-2 rounded-lg bg-primary/10 text-primary mt-0.5 shrink-0">
                <PenLine className="w-5 h-5" />
              </div>
              <div>
                <span className="text-sm font-bold text-on-surface group-hover:text-primary transition-colors block">
                  Log your first note
                </span>
                <span className="text-xs text-on-surface-variant mt-0.5 block">
                  Record a recent interaction or set a follow-up date (press{" "}
                  <kbd className="px-1 py-0.5 rounded bg-surface-container font-mono text-[11px]">
                    ⌘⇧I
                  </kbd>
                  ).
                </span>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-on-surface-variant group-hover:text-primary shrink-0 transition-transform group-hover:translate-x-0.5" />
          </button>

          {/* Step 3: Connect AI */}
          <Link
            to={aiSettingsPath}
            className="flex items-center justify-between p-4 rounded-xl bg-surface-container-lowest hover:bg-surface-container border border-outline/10 transition-colors text-left group cursor-pointer"
          >
            <div className="flex items-start gap-3.5">
              <div className="p-2 rounded-lg bg-primary/10 text-primary mt-0.5 shrink-0">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <span className="text-sm font-bold text-on-surface group-hover:text-primary transition-colors block">
                  Connect AI
                </span>
                <span className="text-xs text-on-surface-variant mt-0.5 block">
                  Enable relationship analysis, smart parsing, and daily
                  insights.
                </span>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-on-surface-variant group-hover:text-primary shrink-0 transition-transform group-hover:translate-x-0.5" />
          </Link>

          {/* Step 4: Connect a calendar (hidden without connectors page) */}
          {hasConnectorsPage && (
            <Link
              to="/settings/connectors"
              className="flex items-center justify-between p-4 rounded-xl bg-surface-container-lowest hover:bg-surface-container border border-outline/10 transition-colors text-left group cursor-pointer"
            >
              <div className="flex items-start gap-3.5">
                <div className="p-2 rounded-lg bg-primary/10 text-primary mt-0.5 shrink-0">
                  <Calendar className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-sm font-bold text-on-surface group-hover:text-primary transition-colors block">
                    Connect a calendar
                  </span>
                  <span className="text-xs text-on-surface-variant mt-0.5 block">
                    Sync meetings and automatically track upcoming interactions.
                  </span>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-on-surface-variant group-hover:text-primary shrink-0 transition-transform group-hover:translate-x-0.5" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
};
