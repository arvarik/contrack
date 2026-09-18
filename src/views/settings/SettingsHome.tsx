/**
 * SettingsHome — the Settings landing page.
 *
 * Driven directly by the settings registry. Renders the identity row at top,
 * the search box, the registry groups and destination cards, and the storage footer.
 */
import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, HardDrive, type LucideIcon } from "lucide-react";
import { useAuth } from "../../components/auth/AuthGate";
import { SettingsIdentityRow } from "../../components/auth/AccountIdentity";
import { SettingsSearch } from "./SettingsSearch";
import { NeedsAttention } from "./NeedsAttention";
import { SETTINGS_GROUPS, SETTINGS_PAGES } from "./registry";
import { CARD, SECTION_HEADING } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { tileDelay } from "../../lib/motion";

const GroupHeading = ({ children }: { children: React.ReactNode }) => (
  <h2 className={cn(SECTION_HEADING, "px-1 mb-2")}>{children}</h2>
);

const SettingsLink = ({
  to,
  icon: Icon,
  title,
  description,
  tone = "primary",
}: {
  to: string;
  icon: LucideIcon;
  title: string;
  description: string;
  tone?: "primary" | "amber" | "danger";
}) => {
  const tones = {
    primary: "bg-primary/10 text-primary",
    amber: "bg-amber-500/10 text-warning",
    danger: "bg-red-500/10 text-error",
  } as const;

  return (
    <Link
      to={to}
      className={cn(
        CARD,
        "flex items-start gap-3.5 p-4 sm:p-5 group",
        "hover:bg-surface-container-high focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        "transition-colors",
      )}
    >
      <span
        className={cn(
          "shrink-0 w-9 h-9 rounded-xl flex items-center justify-center",
          tones[tone],
        )}
      >
        <Icon className="w-[18px] h-[18px]" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-bold text-sm text-on-surface group-hover:text-primary transition-colors">
          {title}
        </span>
        <span className="block text-xs sm:text-sm text-on-surface-variant mt-0.5 text-pretty">
          {description}
        </span>
      </span>
      <ChevronRight className="w-4 h-4 text-on-surface-variant shrink-0 mt-1 group-hover:text-primary group-hover:translate-x-0.5 transition-[color,transform]" />
    </Link>
  );
};

export const SettingsHome = () => {
  const { user, authRequired, isAdmin } = useAuth();
  const [query, setQuery] = useState("");

  const isSearching = query.trim().length > 0;

  return (
    <div className="p-4 sm:p-6 md:p-10 max-w-4xl mx-auto space-y-8 pb-28 md:pb-10">
      <SettingsIdentityRow />

      <div className="lg:hidden">
        <SettingsSearch
          value={query}
          onChange={setQuery}
          variant="landing"
          onSelect={() => setQuery("")}
        />
      </div>

      {!isSearching && (
        <div className="space-y-8">
          <NeedsAttention />

          {SETTINGS_GROUPS.map((group, groupIdx) => {
            const pages = SETTINGS_PAGES.filter((page) => {
              if (page.group !== group.id) return false;
              if (page.admin && !isAdmin) return false;
              if (page.needsAccount && !authRequired) return false;
              if (page.id === "ai-usage" && isAdmin) return false;
              return true;
            });

            if (pages.length === 0) return null;

            return (
              <section
                key={group.id}
                className="tile-enter"
                style={{ animationDelay: tileDelay(groupIdx) }}
              >
                <GroupHeading>{group.title}</GroupHeading>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {pages.map((page) => (
                    <SettingsLink
                      key={page.id}
                      to={page.path}
                      icon={page.icon}
                      title={
                        page.id === "account"
                          ? user?.displayName || user?.username || page.title
                          : page.title
                      }
                      description={page.description}
                      tone={page.tone ?? "primary"}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <p className="flex items-center gap-1.5 text-xs text-on-surface-variant px-1">
        <HardDrive className="w-3.5 h-3.5" />
        Everything here is stored on this machine.
      </p>
    </div>
  );
};

export default SettingsHome;
