import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Map, Settings as SettingsIcon, Sparkles, Activity } from "lucide-react";
import { navLink, SECTION_BG } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { useUrgentActionItemCount } from "../../api";

export const Sidebar = () => {
  const location = useLocation();
  const isMap = location.pathname.startsWith('/map');
  const isCleanup = location.pathname.startsWith('/settings');
  const isSearch = location.pathname.startsWith('/search');
  const isPulse = location.pathname.startsWith('/pulse');
  const isHome = !isMap && !isCleanup && !isSearch && !isPulse && (location.pathname === '/' || location.pathname.startsWith('/contact/'));

  const { data: badge } = useUrgentActionItemCount();
  const urgentCount = badge?.count || 0;

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
      <Link to="/" className={navLink(isHome)} title="Contacts">
        <LayoutDashboard className="w-6 h-6" />
      </Link>
      <Link to="/pulse" className={navLink(isPulse, "relative")} title="Relationship Pulse">
        <Activity className="w-6 h-6" />
        {urgentCount > 0 && (
          <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-error opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-error"></span>
          </span>
        )}
      </Link>
      <Link to="/map" className={navLink(isMap)} title="Map">
        <Map className="w-6 h-6" />
      </Link>
      <Link to="/search" className={navLink(isSearch)} title="Ask My CRM — AI Search">
        <Sparkles className="w-6 h-6" />
      </Link>
      <Link to="/settings" className={navLink(isCleanup, "mt-auto")} title="Settings">
        <SettingsIcon className="w-6 h-6" />
      </Link>
    </aside>
  );
};
