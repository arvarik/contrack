import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Map, Settings as SettingsIcon, Sparkles } from "lucide-react";
import { navLink, SECTION_BG } from "../../lib/styles";
import { cn } from "../../lib/utils";

export const Sidebar = () => {
  const location = useLocation();
  const isMap = location.pathname.startsWith('/map');
  const isCleanup = location.pathname.startsWith('/settings');
  const isSearch = location.pathname.startsWith('/search');
  const isHome = !isMap && !isCleanup && !isSearch && (location.pathname === '/' || location.pathname.startsWith('/contact/'));

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
      <Link to="/" className={navLink(isHome)}>
        <LayoutDashboard className="w-6 h-6" />
      </Link>
      <Link to="/map" className={navLink(isMap)}>
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
