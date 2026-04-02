import { BrowserRouter as Router, Routes, Route, Link, useMatch, useLocation } from "react-router-dom";
import { LayoutDashboard, Map, Settings as SettingsIcon, Search, Sparkles } from "lucide-react";
import { LayoutGroup } from "motion/react";
import { Toaster } from "sonner";

import { ContactList } from "./views/ContactList";
import { ContactDetail } from "./views/ContactDetail";
import { CommandPalette } from "./components/CommandPalette";
import { MapView } from "./views/MapView";
import { SettingsView } from "./views/SettingsView";
import { SearchView } from "./views/SearchView";
import { navLink, SECTION_BG } from "./lib/styles";
import { cn } from "./lib/utils";

const Sidebar = () => {
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

const EmptyState = () => (
  <div className="flex-1 flex flex-col items-center justify-center h-full text-on-surface-variant bg-surface relative z-10">
    <Search className="w-12 h-12 mb-4 opacity-50 text-primary" />
    <h2 className="text-xl font-headline font-semibold mb-2 text-on-surface">No Contact Selected</h2>
    <p>Select a contact from the list to view details.</p>
  </div>
);

const ResponsiveLayout = () => {
  const location = useLocation();
  const matchContact = useMatch("/contact/:id");
  const matchMapContact = useMatch("/map/contact/:id");
  const isContactSelected = matchContact || matchMapContact;
  const isMapActive = location.pathname.startsWith('/map');
  const isCleanup = location.pathname.startsWith('/settings');
  const isSearch = location.pathname.startsWith('/search');

  // Full-page views (cleanup, search) take the full main area
  if (isCleanup || isSearch) {
    return (
      <div className="h-screen w-full flex overflow-hidden bg-surface text-on-surface font-body font-medium">
        <div className="hidden md:flex">
          <Sidebar />
        </div>
        <main className="flex-1 h-full overflow-hidden">
          <Routes>
            <Route path="/settings/*" element={<SettingsView />} />
            <Route path="/search" element={<SearchView />} />
          </Routes>
        </main>
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex overflow-hidden bg-surface text-on-surface font-body font-medium">
      <div className={`${isContactSelected && !isMapActive ? 'hidden lg:flex' : 'hidden md:flex'}`}>
        <Sidebar />
      </div>
      
      {/* Dynamic Middle/Main Panel mapping to either the List or the Map */}
      <section className={`
        ${isContactSelected && !isMapActive ? 'hidden lg:flex' : 'flex'}
        ${isMapActive ? 'flex-1 z-0' : 'w-full lg:w-[350px] shrink-0 bg-surface-container-lowest z-10'}
        h-full flex-col relative
      `}>
        <Routes>
          <Route path="/map" element={<MapView />} />
          <Route path="/map/contact/:id" element={<MapView />} />
          <Route path="*" element={<ContactList />} />
        </Routes>
      </section>

      {/* Right Pane: Detail View */}
      <main className={`
        ${isContactSelected ? 'flex' : (isMapActive ? 'hidden' : 'hidden lg:flex')}
        ${isMapActive && isContactSelected ? 'absolute right-0 top-0 bottom-0 w-full md:w-[760px] lg:w-[860px] z-50 shadow-2xl bg-surface' : 'flex-1 bg-surface z-10'}
        h-full overflow-hidden relative flex-col
      `}>
        <Routes>
          <Route path="/" element={<EmptyState />} />
          <Route path="/map" element={null} />
          <Route path="/contact/:id" element={<ContactDetail />} />
          <Route path="/map/contact/:id" element={<ContactDetail />} />
        </Routes>
      </main>

      {/* Mobile Nav */}
      {!isContactSelected && (
        <nav className="md:hidden fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-6 pb-6 pt-3 glass-panel rounded-t-xl shadow-[0_-4px_16px_rgba(0,0,0,0.05)]">
          <Link to="/" className={`p-3 ${!isMapActive ? 'text-primary' : 'text-on-surface-variant'}`}>
             <LayoutDashboard className="w-6 h-6" />
          </Link>
          <Link to="/map" className={`p-3 ${isMapActive ? 'text-primary' : 'text-on-surface-variant'}`}>
            <Map className="w-6 h-6" />
          </Link>
          <Link to="/search" className="text-on-surface-variant p-3"><Sparkles className="w-6 h-6" /></Link>
          <Link to="/settings" className="text-on-surface-variant p-3"><SettingsIcon className="w-6 h-6" /></Link>
        </nav>
      )}
    </div>
  );
};

export default function App() {
  return (
    <Router>
      <LayoutGroup>
        <ResponsiveLayout />
        <CommandPalette />
        <Toaster theme="dark" position="bottom-right" className="font-body" toastOptions={{
          style: {
            background: 'var(--color-surface-container-high)',
            border: '1px solid var(--color-surface-container-highest)',
            color: 'var(--color-on-surface)'
          }
        }} />
      </LayoutGroup>
    </Router>
  );
}
