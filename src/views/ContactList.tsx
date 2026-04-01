import { useState, useEffect, useMemo } from "react";
import { motion } from "motion/react";
import { Link } from "react-router-dom";
import { Mail, MapPin, UserPlus, Search, Filter, Download } from "lucide-react";
import { Contact } from "../types";
import { api } from "../api";
import { Modal } from "../components/Modal";
import { ImportModal } from "../components/ImportModal";

export const ContactList = () => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterPremium, setFilterPremium] = useState(false);

  const fetchContacts = () => {
    api.contacts.list().then(data => {
      setContacts(data);
      setLoading(false);
    });
  };

  useEffect(() => {
    fetchContacts();
  }, []);

  const handleCreateContact = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries());
    
    await api.contacts.create({
      name: data.name as string,
      role: data.role as string,
      company: data.company as string,
      email: data.email as string,
      location: data.location as string,
      avatarUrl: (data.avatarUrl as string) || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(data.name as string)}`,
      isPremium: data.isPremium === 'on'
    });
    
    setIsModalOpen(false);
    fetchContacts();
  };

  const filteredContacts = useMemo(() => {
    return contacts.filter(contact => {
      const matchesSearch = contact.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            (contact.company && contact.company.toLowerCase().includes(searchQuery.toLowerCase())) ||
                            (contact.role && contact.role.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesPremium = filterPremium ? contact.isPremium : true;
      return matchesSearch && matchesPremium;
    });
  }, [contacts, searchQuery, filterPremium]);

  if (loading) return <div className="p-12 text-center font-headline text-2xl animate-pulse">Curating your network...</div>;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-8 md:p-12 max-w-7xl mx-auto w-full"
    >
      <header className="mb-12 flex flex-col md:flex-row md:justify-between md:items-end gap-6">
        <div>
          <h2 className="text-5xl font-extrabold font-headline tracking-tighter mb-4">Your <span className="text-primary">Network</span></h2>
          <p className="text-on-surface-variant max-w-xl text-lg">A refined collection of executive partners and creative collaborators.</p>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={() => setIsImportModalOpen(true)}
            className="hidden md:flex items-center gap-2 bg-surface-container-high text-on-surface px-6 py-3 rounded-full font-bold shadow-sm hover:bg-surface-container-highest transition-colors"
          >
            <Download className="w-5 h-5" />
            Import
          </button>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="hidden md:flex items-center gap-2 signature-gradient text-on-primary px-6 py-3 rounded-full font-bold shadow-lg hover:scale-105 transition-transform"
          >
            <UserPlus className="w-5 h-5" />
            Add Contact
          </button>
        </div>
      </header>

      <div className="mb-8 flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-on-surface-variant" />
          <input 
            type="text" 
            placeholder="Search by name, role, or company..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-surface-container-low border-none rounded-2xl pl-12 pr-4 py-4 focus:ring-2 focus:ring-primary focus:bg-surface-container-lowest transition-all text-on-surface placeholder:text-on-surface-variant shadow-sm"
          />
        </div>
        <button 
          onClick={() => setFilterPremium(!filterPremium)}
          className={`flex items-center gap-2 px-6 py-4 rounded-2xl font-bold transition-all shadow-sm ${filterPremium ? 'bg-primary-container text-on-primary-container ring-2 ring-primary' : 'bg-surface-container-low text-on-surface hover:bg-surface-container-high'}`}
        >
          <Filter className="w-5 h-5" />
          Premium Only
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {filteredContacts.map(contact => (
          <Link key={contact.id} to={`/contact/${contact.id}`}>
            <motion.div 
              whileHover={{ y: -8 }}
              className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm border border-surface-container-high group transition-all hover:shadow-xl h-full flex flex-col"
            >
              <div className="flex items-center gap-4 mb-6">
                <img src={contact.avatarUrl} alt={contact.name} className="w-16 h-16 rounded-full object-cover ring-4 ring-surface-container-low" />
                <div>
                  <h3 className="text-xl font-bold group-hover:text-primary transition-colors">{contact.name}</h3>
                  <p className="text-on-surface-variant text-sm">{contact.role}</p>
                </div>
              </div>
              <div className="space-y-3 text-sm text-on-surface-variant mt-auto">
                {contact.email && (
                  <div className="flex items-center gap-3">
                    <Mail className="w-4 h-4 text-primary" />
                    <span>{contact.email}</span>
                  </div>
                )}
                {contact.location && (
                  <div className="flex items-center gap-3">
                    <MapPin className="w-4 h-4 text-primary" />
                    <span>{contact.location}</span>
                  </div>
                )}
              </div>
            </motion.div>
          </Link>
        ))}
        
        <div 
          onClick={() => setIsModalOpen(true)}
          className="border-2 border-dashed border-surface-container-highest rounded-2xl p-6 flex flex-col items-center justify-center text-on-surface-variant hover:bg-surface-container-low transition-all cursor-pointer min-h-[200px]"
        >
          <div className="bg-surface-container-high p-4 rounded-full mb-4">
            <UserPlus className="w-6 h-6 text-primary" />
          </div>
          <span className="font-semibold">Add New Contact</span>
        </div>
      </div>

      {filteredContacts.length === 0 && (
        <div className="text-center py-24 text-on-surface-variant">
          <p className="text-xl font-headline mb-2">No contacts found.</p>
          <p>Try adjusting your search or filters.</p>
        </div>
      )}

      <ImportModal 
        isOpen={isImportModalOpen} 
        onClose={() => setIsImportModalOpen(false)} 
        onSuccess={() => fetchContacts()} 
      />

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Add New Contact">
        <form onSubmit={handleCreateContact} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">Full Name *</label>
            <input required name="name" type="text" className="w-full bg-surface-container-low border-none rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary focus:bg-surface-container-lowest transition-all" placeholder="Jane Doe" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">Role</label>
              <input name="role" type="text" className="w-full bg-surface-container-low border-none rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary focus:bg-surface-container-lowest transition-all" placeholder="CEO" />
            </div>
            <div>
              <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">Company</label>
              <input name="company" type="text" className="w-full bg-surface-container-low border-none rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary focus:bg-surface-container-lowest transition-all" placeholder="Acme Corp" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">Email</label>
            <input name="email" type="email" className="w-full bg-surface-container-low border-none rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary focus:bg-surface-container-lowest transition-all" placeholder="jane@example.com" />
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">Location</label>
            <input name="location" type="text" className="w-full bg-surface-container-low border-none rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary focus:bg-surface-container-lowest transition-all" placeholder="New York, NY" />
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">Avatar URL (Optional)</label>
            <input name="avatarUrl" type="url" className="w-full bg-surface-container-low border-none rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary focus:bg-surface-container-lowest transition-all" placeholder="https://..." />
          </div>
          <div className="flex items-center gap-3 pt-2">
            <input name="isPremium" type="checkbox" id="isPremium" className="w-5 h-5 rounded border-surface-container-highest text-primary focus:ring-primary" />
            <label htmlFor="isPremium" className="text-sm font-medium text-on-surface">Mark as Premium Client</label>
          </div>
          <div className="pt-6">
            <button type="submit" className="w-full signature-gradient text-on-primary font-bold py-4 rounded-xl shadow-lg hover:opacity-90 transition-opacity">
              Create Contact
            </button>
          </div>
        </form>
      </Modal>
    </motion.div>
  );
};
