import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useParams, useNavigate } from "react-router-dom";
import { 
  Mail, MoreHorizontal, Sparkles, Cake, MapPin, Coffee, 
  Plus, Phone, FileText, Handshake, Verified, Trash2 
} from "lucide-react";
import { Contact, Note, Activity, AIInsight } from "../types";
import { api } from "../api";
import { generateContactInsights } from "../services/geminiService";
import { Modal } from "../components/Modal";

export const ContactDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  
  const [contact, setContact] = useState<Contact | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [insight, setInsight] = useState<AIInsight | null>(null);
  const [loading, setLoading] = useState(true);
  const [generatingInsight, setGeneratingInsight] = useState(false);

  // Modals state
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [isActivityModalOpen, setIsActivityModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isEditContactModalOpen, setIsEditContactModalOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);

  const fetchData = async () => {
    if (!id) return;
    try {
      const [contactRes, notesRes, activitiesRes] = await Promise.all([
        api.contacts.get(id),
        api.notes.list(id),
        api.activities.list(id)
      ]);
      setContact(contactRes);
      setNotes(notesRes);
      setActivities(activitiesRes);
      setLoading(false);
    } catch (err) {
      console.error(err);
      navigate('/');
    }
  };

  useEffect(() => {
    fetchData();
  }, [id]);

  const handleGenerateInsight = async () => {
    if (!contact || notes.length === 0) return;
    setGeneratingInsight(true);
    try {
      const res = await generateContactInsights(contact, notes);
      setInsight(res);
    } catch (err) {
      console.error(err);
    } finally {
      setGeneratingInsight(false);
    }
  };

  const handleEditContact = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!id) return;
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries());
    
    await api.contacts.update(id, {
      name: data.name as string,
      role: data.role as string,
      company: data.company as string,
      email: data.email as string,
      location: data.location as string,
      avatarUrl: data.avatarUrl as string,
      isPremium: data.isPremium === 'on',
      birthday: data.birthday as string,
      preferences: data.preferences as string,
    });
    
    setIsEditContactModalOpen(false);
    fetchData();
  };

  const handleCreateNote = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!id) return;
    const formData = new FormData(e.currentTarget);
    
    if (editingNote) {
      await api.notes.update(editingNote.id, {
        title: formData.get('title') as string,
        content: formData.get('content') as string
      });
    } else {
      await api.notes.create(id, {
        title: formData.get('title') as string,
        content: formData.get('content') as string
      });
    }
    
    setIsNoteModalOpen(false);
    setEditingNote(null);
    fetchData();
  };

  const handleCreateActivity = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!id) return;
    const formData = new FormData(e.currentTarget);
    
    if (editingActivity) {
      await api.activities.update(editingActivity.id, {
        type: formData.get('type') as any,
        title: formData.get('title') as string,
        duration: formData.get('duration') as string,
      });
    } else {
      await api.activities.create(id, {
        type: formData.get('type') as any,
        title: formData.get('title') as string,
        duration: formData.get('duration') as string,
        date: new Date().toISOString()
      });
    }
    
    setIsActivityModalOpen(false);
    setEditingActivity(null);
    fetchData();
  };

  const handleDeleteContact = async () => {
    if (!id) return;
    await api.contacts.delete(id);
    navigate('/');
  };

  const handleDeleteNote = async (noteId: string) => {
    await api.notes.delete(noteId);
    fetchData();
  };

  const handleDeleteActivity = async (activityId: string) => {
    await api.activities.delete(activityId);
    fetchData();
  };

  if (loading) return <div className="p-12 text-center font-headline text-2xl animate-pulse">Curating details...</div>;
  if (!contact) return <div className="p-12 text-center">Contact not found.</div>;

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="p-8 md:p-12 max-w-7xl mx-auto w-full"
    >
      {/* Hero */}
      <section className="relative mb-16">
        <div className="flex flex-col md:flex-row items-start md:items-end gap-8">
          <div className="relative">
            <div className="w-48 h-48 rounded-2xl overflow-hidden bg-surface-container-highest ring-8 ring-surface shadow-2xl">
              <img alt={contact.name} className="w-full h-full object-cover" src={contact.avatarUrl} />
            </div>
            {contact.isPremium && (
              <div className="absolute -bottom-4 -right-4 signature-gradient text-on-primary w-12 h-12 rounded-full flex items-center justify-center shadow-lg">
                <Verified className="w-6 h-6" />
              </div>
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <span className="px-3 py-1 rounded-full bg-secondary-container text-on-secondary-container text-xs font-bold uppercase tracking-widest">
                {contact.isPremium ? "Premium Client" : "Standard Client"}
              </span>
              <span className="text-on-surface-variant text-sm font-label">Added {new Date(contact.addedAt).toLocaleDateString()}</span>
            </div>
            <h2 className="text-6xl font-extrabold font-headline text-on-surface tracking-tighter mb-2">{contact.name}</h2>
            <p className="text-xl text-on-surface-variant font-light tracking-wide mb-4">{contact.role} {contact.company ? `at ${contact.company}` : ''}</p>
            
            {contact.sources && contact.sources !== '[]' && (
              <div className="flex gap-2 flex-wrap">
                {JSON.parse(contact.sources).map((source: string, idx: number) => (
                  <span key={idx} className="bg-surface-container-high text-on-surface-variant text-xs font-bold px-2 py-1 rounded-md uppercase tracking-wider">
                    Source: {source}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <button className="px-8 py-4 rounded-full signature-gradient text-on-primary font-bold flex items-center gap-2 shadow-xl hover:scale-105 transition-transform">
              <Mail className="w-5 h-5" />
              Message
            </button>
            <button 
              onClick={() => setIsEditContactModalOpen(true)}
              className="p-4 rounded-full bg-surface-container-low text-primary hover:bg-surface-container-high transition-colors shadow-sm"
            >
              <MoreHorizontal className="w-6 h-6" />
            </button>
            <button 
              onClick={() => setIsDeleteModalOpen(true)}
              className="p-4 rounded-full bg-surface-container-low text-red-500 hover:bg-red-50 transition-colors shadow-sm"
            >
              <Trash2 className="w-6 h-6" />
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
        {/* Left: AI & Facts */}
        <div className="lg:col-span-4 space-y-12">
          {/* AI Insight */}
          <div className="bg-primary-container/30 rounded-2xl p-8 border border-primary-container relative overflow-hidden">
            <div className="flex justify-between items-center mb-8">
              <div className="flex items-center gap-3">
                <Sparkles className="w-6 h-6 text-primary" />
                <h3 className="text-xl font-extrabold font-headline text-on-primary-container">AI Intelligence</h3>
              </div>
              {!insight && (
                <button 
                  onClick={handleGenerateInsight}
                  disabled={generatingInsight || notes.length === 0}
                  className="text-xs font-bold uppercase tracking-widest text-primary hover:underline disabled:opacity-50"
                >
                  {generatingInsight ? "Thinking..." : notes.length === 0 ? "Add notes first" : "Generate"}
                </button>
              )}
            </div>
            
            <AnimatePresence mode="wait">
              {insight ? (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6"
                >
                  <div className="bg-surface-container-lowest/80 backdrop-blur-md p-6 rounded-xl shadow-sm">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-primary mb-2">Next Recommended Contact</p>
                    <p className="text-2xl font-extrabold font-headline text-on-surface">{insight.nextRecommendedContact}</p>
                    <p className="text-xs text-on-surface-variant mt-1">Based on recent project velocity.</p>
                  </div>
                  <div className="bg-surface-container-lowest/80 backdrop-blur-md p-6 rounded-xl shadow-sm">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-primary mb-2">Summary Sentiment</p>
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles className="w-5 h-5 text-yellow-500 fill-current" />
                      <span className="font-bold text-on-surface text-lg">{insight.summarySentiment}</span>
                    </div>
                    <p className="text-sm text-on-surface-variant leading-relaxed">{insight.sentimentDescription}</p>
                  </div>
                </motion.div>
              ) : (
                <div className="text-center py-12 text-on-surface-variant/50 italic">
                  Run AI curation to unlock insights.
                </div>
              )}
            </AnimatePresence>
          </div>

          {/* Facts */}
          <div className="bg-surface-container-lowest rounded-2xl p-8 shadow-sm border border-surface-container-high relative group">
            <button 
              onClick={() => setIsEditContactModalOpen(true)}
              className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 text-primary hover:underline text-sm font-bold transition-opacity"
            >
              Edit
            </button>
            <h3 className="text-xl font-extrabold font-headline text-on-surface mb-8">Personal Facts</h3>
            <ul className="space-y-6">
              {contact.birthday && (
                <li className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-surface-container-low flex items-center justify-center text-primary">
                    <Cake className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-[10px] text-on-surface-variant uppercase font-bold tracking-widest">Birthday</p>
                    <p className="text-sm font-semibold">{contact.birthday}</p>
                  </div>
                </li>
              )}
              {contact.location && (
                <li className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-surface-container-low flex items-center justify-center text-primary">
                    <MapPin className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-[10px] text-on-surface-variant uppercase font-bold tracking-widest">Location</p>
                    <p className="text-sm font-semibold">{contact.location}</p>
                  </div>
                </li>
              )}
              {contact.preferences && (
                <li className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-surface-container-low flex items-center justify-center text-primary">
                    <Coffee className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-[10px] text-on-surface-variant uppercase font-bold tracking-widest">Preferences</p>
                    <p className="text-sm font-semibold">{contact.preferences}</p>
                  </div>
                </li>
              )}
              {!contact.birthday && !contact.location && !contact.preferences && (
                 <li className="text-on-surface-variant italic text-sm">No personal facts added yet.</li>
              )}
            </ul>
          </div>
        </div>

        {/* Right: Notes & Flow */}
        <div className="lg:col-span-8 space-y-12">
          {/* Notes */}
          <div className="bg-surface-container-lowest rounded-2xl p-8 shadow-sm border border-surface-container-high">
            <div className="flex justify-between items-center mb-10">
              <h3 className="text-2xl font-extrabold font-headline text-on-surface">Curated Notes</h3>
              <button 
                onClick={() => setIsNoteModalOpen(true)}
                className="text-primary font-bold text-sm flex items-center gap-1 hover:underline"
              >
                <Plus className="w-5 h-5" />
                Add Note
              </button>
            </div>
            <div className="space-y-8">
              {notes.length === 0 && (
                <p className="text-on-surface-variant italic">No notes yet. Add one to start curating.</p>
              )}
              {notes.map(note => (
                <div key={note.id} className="group relative bg-surface-container-low p-8 rounded-2xl transition-all hover:bg-surface-container-high">
                  <div className="absolute top-8 right-8 flex items-center gap-4">
                    <span className="text-xs text-on-surface-variant font-bold uppercase tracking-widest">
                      {new Date(note.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                    <button 
                      onClick={() => {
                        setEditingNote(note);
                        setIsNoteModalOpen(true);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-primary hover:underline text-sm font-bold transition-opacity"
                    >
                      Edit
                    </button>
                    <button 
                      onClick={() => handleDeleteNote(note.id)}
                      className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 transition-opacity"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <h4 className="font-extrabold text-xl text-on-surface mb-3">{note.title}</h4>
                  <p className="text-on-surface-variant leading-relaxed text-lg font-light">{note.content}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Activity Flow */}
          <div className="bg-surface-container-low rounded-2xl p-8">
            <div className="flex justify-between items-center mb-10">
              <h3 className="text-xl font-extrabold font-headline text-on-surface">Activity Flow</h3>
              <button 
                onClick={() => {
                  setEditingActivity(null);
                  setIsActivityModalOpen(true);
                }}
                className="text-primary font-bold text-sm flex items-center gap-1 hover:underline"
              >
                <Plus className="w-5 h-5" />
                Log Activity
              </button>
            </div>
            <div className="space-y-12 relative">
              {activities.length > 0 && (
                <div className="absolute left-[23px] top-2 bottom-2 w-[2px] bg-surface-container-highest"></div>
              )}
              {activities.length === 0 && (
                <p className="text-on-surface-variant italic">No activities logged.</p>
              )}
              {activities.map(activity => (
                <div key={activity.id} className="flex gap-8 relative z-10 group">
                  <div className="w-12 h-12 rounded-full signature-gradient flex items-center justify-center text-on-primary shadow-lg shrink-0">
                    {activity.type === 'call' && <Phone className="w-5 h-5" />}
                    {activity.type === 'proposal' && <FileText className="w-5 h-5" />}
                    {activity.type === 'meeting' && <Handshake className="w-5 h-5" />}
                    {activity.type === 'email' && <Mail className="w-5 h-5" />}
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between items-start">
                      <p className="text-lg font-extrabold text-on-surface">{activity.title}</p>
                      <div className="flex items-center gap-4">
                        <button 
                          onClick={() => {
                            setEditingActivity(activity);
                            setIsActivityModalOpen(true);
                          }}
                          className="opacity-0 group-hover:opacity-100 text-primary hover:underline text-sm font-bold transition-opacity"
                        >
                          Edit
                        </button>
                        <button 
                          onClick={() => handleDeleteActivity(activity.id)}
                          className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 transition-opacity"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <p className="text-sm text-on-surface-variant font-medium">
                      {new Date(activity.date).toLocaleDateString()} {activity.duration ? `• ${activity.duration}` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      <Modal isOpen={isNoteModalOpen} onClose={() => {
        setIsNoteModalOpen(false);
        setEditingNote(null);
      }} title={editingNote ? "Edit Note" : "Add Curated Note"}>
        <form onSubmit={handleCreateNote} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">Title</label>
            <input required name="title" defaultValue={editingNote?.title} type="text" className="w-full bg-surface-container-low border-none rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary focus:bg-surface-container-lowest transition-all" placeholder="Project Update" />
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">Content</label>
            <textarea required name="content" defaultValue={editingNote?.content} rows={4} className="w-full bg-surface-container-low border-none rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary focus:bg-surface-container-lowest transition-all" placeholder="Key takeaways from our discussion..."></textarea>
          </div>
          <div className="pt-6">
            <button type="submit" className="w-full signature-gradient text-on-primary font-bold py-4 rounded-xl shadow-lg hover:opacity-90 transition-opacity">
              {editingNote ? "Save Changes" : "Save Note"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={isActivityModalOpen} onClose={() => {
        setIsActivityModalOpen(false);
        setEditingActivity(null);
      }} title={editingActivity ? "Edit Activity" : "Log Activity"}>
        <form onSubmit={handleCreateActivity} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">Activity Type</label>
            <select name="type" defaultValue={editingActivity?.type || "call"} className="w-full bg-surface-container-low border-none rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary focus:bg-surface-container-lowest transition-all text-on-surface">
              <option value="call">Call</option>
              <option value="meeting">Meeting</option>
              <option value="proposal">Proposal</option>
              <option value="email">Email</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">Title</label>
            <input required name="title" defaultValue={editingActivity?.title} type="text" className="w-full bg-surface-container-low border-none rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary focus:bg-surface-container-lowest transition-all" placeholder="Q3 Planning Call" />
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">Duration (Optional)</label>
            <input name="duration" defaultValue={editingActivity?.duration} type="text" className="w-full bg-surface-container-low border-none rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary focus:bg-surface-container-lowest transition-all" placeholder="e.g. 45 mins" />
          </div>
          <div className="pt-6">
            <button type="submit" className="w-full signature-gradient text-on-primary font-bold py-4 rounded-xl shadow-lg hover:opacity-90 transition-opacity">
              {editingActivity ? "Save Changes" : "Log Activity"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} title="Delete Contact">
        <div className="space-y-6">
          <p className="text-on-surface-variant">Are you sure you want to delete <strong>{contact.name}</strong>? This will also permanently remove all associated notes and activities. This action cannot be undone.</p>
          <div className="flex gap-4">
            <button onClick={() => setIsDeleteModalOpen(false)} className="flex-1 bg-surface-container-high text-on-surface font-bold py-4 rounded-xl hover:bg-surface-container-highest transition-colors">
              Cancel
            </button>
            <button onClick={handleDeleteContact} className="flex-1 bg-red-500 text-white font-bold py-4 rounded-xl shadow-lg hover:bg-red-600 transition-colors">
              Delete Permanently
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isEditContactModalOpen} onClose={() => setIsEditContactModalOpen(false)} title="Edit Contact">
        <form onSubmit={handleEditContact} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">Full Name *</label>
            <input required name="name" defaultValue={contact.name} type="text" className="w-full bg-surface-container-low border-none rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary focus:bg-surface-container-lowest transition-all" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">Role</label>
              <input name="role" defaultValue={contact.role} type="text" className="w-full bg-surface-container-low border-none rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary focus:bg-surface-container-lowest transition-all" />
            </div>
            <div>
              <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">Company</label>
              <input name="company" defaultValue={contact.company} type="text" className="w-full bg-surface-container-low border-none rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary focus:bg-surface-container-lowest transition-all" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">Email</label>
            <input name="email" defaultValue={contact.email} type="email" className="w-full bg-surface-container-low border-none rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary focus:bg-surface-container-lowest transition-all" />
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">Location</label>
            <input name="location" defaultValue={contact.location} type="text" className="w-full bg-surface-container-low border-none rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary focus:bg-surface-container-lowest transition-all" />
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">Birthday</label>
            <input name="birthday" defaultValue={contact.birthday} type="text" className="w-full bg-surface-container-low border-none rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary focus:bg-surface-container-lowest transition-all" placeholder="e.g. October 12" />
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">Preferences</label>
            <input name="preferences" defaultValue={contact.preferences} type="text" className="w-full bg-surface-container-low border-none rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary focus:bg-surface-container-lowest transition-all" placeholder="e.g. Prefers morning meetings" />
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">Avatar URL</label>
            <input name="avatarUrl" defaultValue={contact.avatarUrl} type="url" className="w-full bg-surface-container-low border-none rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary focus:bg-surface-container-lowest transition-all" />
          </div>
          <div className="flex items-center gap-3 pt-2">
            <input name="isPremium" defaultChecked={contact.isPremium} type="checkbox" id="isPremiumEdit" className="w-5 h-5 rounded border-surface-container-highest text-primary focus:ring-primary" />
            <label htmlFor="isPremiumEdit" className="text-sm font-medium text-on-surface">Mark as Premium Client</label>
          </div>
          <div className="pt-6">
            <button type="submit" className="w-full signature-gradient text-on-primary font-bold py-4 rounded-xl shadow-lg hover:opacity-90 transition-opacity">
              Save Changes
            </button>
          </div>
        </form>
      </Modal>
    </motion.div>
  );
};
