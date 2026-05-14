/**
 * Sidebar — Vertical icon nav with styled tooltips.
 *
 * Each nav item wraps with a custom Tooltip that appears to the right
 * of the icon after a 250ms hover delay — replacing the ugly native
 * browser `title` tooltip with a polished in-app version.
 */
import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Map, Settings as SettingsIcon, Sparkles, Activity } from "lucide-react";
import React, { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { navLink, SECTION_BG } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { useUrgentActionItemCount, useDedupeCount } from "../../api";
import { useRecent } from "../../contexts/SessionContext";

// ---------------------------------------------------------------------------
// SidebarTooltip — styled right-side tooltip with delay
// ---------------------------------------------------------------------------

const SidebarTooltip = ({ label, shortcut, children, className }: { label: string; shortcut?: string; children: React.ReactNode; className?: string }) => {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), 250);
  }, []);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  return (
    <div className={cn("relative flex items-center", className)} onMouseEnter={show} onMouseLeave={hide}>
      {children}
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0, x: -6, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -4, scale: 0.95 }}
            transition={{ duration: 0.12 }}
            className="absolute left-full ml-3 z-50 pointer-events-none"
          >
            <div className="bg-surface-container-highest text-on-surface text-xs font-bold px-2.5 py-1.5 rounded-lg shadow-lg whitespace-nowrap ring-1 ring-black/5">
              {label}
              {shortcut && (
                <span className="block text-[9px] font-mono font-normal text-on-surface-variant/60 mt-0.5">{shortcut}</span>
              )}
            </div>
            {/* Caret */}
            <div className="absolute top-1/2 -translate-y-1/2 -left-1 w-0 h-0 border-t-4 border-b-4 border-r-4 border-t-transparent border-b-transparent border-r-surface-container-highest" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

export const Sidebar = () => {
  const location = useLocation();
  // Narrow context read: this hook is now isolated from AI-search keystroke
  // updates, so the sidebar no longer re-renders when the user types in the
  // global search bar.
  const { lastContactId } = useRecent();
  const isMap = location.pathname.startsWith('/map');
  const isCleanup = location.pathname.startsWith('/settings');
  const isSearch = location.pathname.startsWith('/search');
  const isPulse = location.pathname.startsWith('/pulse');
  const isHome = !isMap && !isCleanup && !isSearch && !isPulse && (location.pathname === '/' || location.pathname.startsWith('/contact/'));

  const { data: badge } = useUrgentActionItemCount();
  const urgentCount = badge?.count || 0;

  const { data: dedupeCount } = useDedupeCount();
  const pendingSuggestions = dedupeCount?.count || 0;

  return (
    <aside className={cn(SECTION_BG, "w-16 h-screen hidden md:flex flex-col items-center py-6 gap-6 shrink-0 relative z-20")}>
      {/* Contrack wordmark — rotated vertical */}
      <div className="flex items-center justify-center mb-1" title="Contrack">
        <span
          className="text-[9px] font-black uppercase tracking-[0.22em] signature-gradient bg-clip-text text-transparent select-none"
          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', letterSpacing: '0.18em' }}
        >
          Contrack
        </span>
      </div>

      <SidebarTooltip label="Network" shortcut="⌘⇧H">
        <Link to={lastContactId && !isHome ? `/contact/${lastContactId}` : "/"} className={navLink(isHome)}>
          <LayoutDashboard className="w-6 h-6" />
        </Link>
      </SidebarTooltip>

      <SidebarTooltip label="Relationship Pulse" shortcut="⌘⇧P">
        <Link to="/pulse" className={navLink(isPulse, "relative")}>
          <Activity className="w-6 h-6" />
          {/* Urgent action items — red dot (top-right) */}
          {urgentCount > 0 && (
            <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-error opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-error"></span>
            </span>
          )}
          {/* Pending suggestions — blue dot (top-right, offset left of urgent dot) */}
          {pendingSuggestions > 0 && (
            <span className={cn("absolute top-1.5 flex h-2 w-2", urgentCount > 0 ? "right-4" : "right-1.5")}>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
          )}
        </Link>
      </SidebarTooltip>

      <SidebarTooltip label="Map" shortcut="⌘⇧M">
        <Link to="/map" className={navLink(isMap)}>
          <Map className="w-6 h-6" />
        </Link>
      </SidebarTooltip>

      <SidebarTooltip label="AI Search" shortcut="⌘⇧S">
        <Link to="/search" className={navLink(isSearch)}>
          <Sparkles className="w-6 h-6" />
        </Link>
      </SidebarTooltip>

      {/* spacer to push following items down */}
      <div className="flex-1" />

      <SidebarTooltip label="Settings" shortcut="⌘⇧,">
        <Link to="/settings" className={navLink(isCleanup)}>
          <SettingsIcon className="w-6 h-6" />
        </Link>
      </SidebarTooltip>
    </aside>
  );
};
