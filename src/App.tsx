import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import { 
  ArrowLeft, 
  CloudUpload, 
  LayoutDashboard, 
  Star, 
  ListFilter, 
  Settings
} from "lucide-react";

import { ContactList } from "./views/ContactList";
import { ContactDetail } from "./views/ContactDetail";

// --- Layout Components ---

const TopAppBar = () => (
  <header className="bg-surface sticky top-0 z-40 w-full border-b border-surface-container-high">
    <div className="flex justify-between items-center px-6 md:px-12 py-4 w-full">
      <div className="flex items-center gap-6">
        <Link to="/" className="hover:bg-surface-container-low transition-colors p-2 rounded-full">
          <ArrowLeft className="w-6 h-6 text-primary" />
        </Link>
        <h1 className="text-xl font-extrabold tracking-widest text-on-surface font-headline uppercase">
          Contrack
        </h1>
      </div>
      <div className="flex items-center gap-8">
        <nav className="hidden md:flex gap-8">
          <Link to="/" className="text-on-surface-variant hover:text-on-surface transition-colors font-label font-medium">Contacts</Link>
          <span className="text-primary font-semibold font-label">Detail View</span>
          <span className="text-on-surface-variant hover:text-on-surface transition-colors font-label font-medium">Insights</span>
        </nav>
        <div className="flex items-center gap-4">
          <CloudUpload className="w-6 h-6 text-primary cursor-pointer" />
          <img 
            alt="User profile" 
            className="w-10 h-10 rounded-full object-cover shadow-sm ring-2 ring-surface-container-high" 
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuAYkSkRQOImyuy09hnQvhM4vhsFeuhlPeIri9Oqbm3mCox0yhmYh2PbJDh6xmzm-NgmdCFIGxanBiJxHAIiJedwzHCfk24vJaTZOxqBnAZF3RyCKliD_BsNfZiJw1CULWyEARykU_NMeK2F0Fb_Hzqrhwe0d2MzYFDn3MECwoaQEktbaUjbyVfzCMs_HqlazUlEkYwRbbSRG8cOC5HvE3gsZ6nDJSfgdIQdOZqeG3TeBlzH2lMX7mn64ReONWJ8Dc2tJfuCN3lnF9k" 
          />
        </div>
      </div>
    </div>
  </header>
);

const Sidebar = () => (
  <aside className="hidden lg:flex flex-col gap-2 p-6 bg-surface-container-low h-screen w-72 sticky top-0 border-r border-surface-container-high">
    <div className="mb-8 px-4">
      <span className="text-xs uppercase tracking-widest text-on-surface-variant font-bold">Collections</span>
    </div>
    <nav className="flex flex-col gap-2">
      <Link to="/" className="text-on-surface-variant px-4 py-3 hover:bg-surface-container-high rounded-xl transition-all flex items-center gap-3">
        <LayoutDashboard className="w-5 h-5" />
        <span className="font-medium">All Contacts</span>
      </Link>
      <div className="bg-primary-container text-on-primary-container rounded-xl px-4 py-3 font-semibold flex items-center gap-3">
        <Star className="w-5 h-5" />
        <span>Recent Curations</span>
      </div>
      <div className="text-on-surface-variant px-4 py-3 hover:bg-surface-container-high rounded-xl transition-all flex items-center gap-3">
        <ListFilter className="w-5 h-5" />
        <span>Custom Lists</span>
      </div>
      <div className="text-on-surface-variant px-4 py-3 hover:bg-surface-container-high rounded-xl transition-all flex items-center gap-3">
        <Settings className="w-5 h-5" />
        <span>AI Insights</span>
      </div>
    </nav>
  </aside>
);

const MobileNav = () => (
  <nav className="fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-6 pb-8 pt-4 md:hidden glass-panel border-t border-surface-container-high rounded-t-xl">
    <Link to="/" className="text-on-surface-variant p-3">
      <LayoutDashboard className="w-6 h-6" />
    </Link>
    <div className="bg-primary-container text-primary rounded-2xl p-3">
      <Star className="w-6 h-6 fill-current" />
    </div>
    <div className="text-on-surface-variant p-3">
      <ListFilter className="w-6 h-6" />
    </div>
    <div className="text-on-surface-variant p-3">
      <Settings className="w-6 h-6" />
    </div>
  </nav>
);

export default function App() {
  return (
    <Router>
      <div className="min-h-screen flex flex-col lg:flex-row">
        <Sidebar />
        <div className="flex-1 flex flex-col">
          <TopAppBar />
          <main className="flex-1 pb-24 md:pb-12">
            <Routes>
              <Route path="/" element={<ContactList />} />
              <Route path="/contact/:id" element={<ContactDetail />} />
            </Routes>
          </main>
          <MobileNav />
        </div>
      </div>
    </Router>
  );
}
