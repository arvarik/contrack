/**
 * QuickInteractionModal — Global quick-note modal for logging interactions
 * without navigating away from the current page (Feature 14).
 *
 * Keyboard: Cmd+Shift+I to open, Escape to close, Cmd+Enter to submit.
 *
 * @module components/QuickInteractionModal
 */
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { X, Search, FileText, Phone, Calendar, Mail, Loader2 } from 'lucide-react';
import { useContactNames, useAddInteraction } from '../api';
import type { ContactSlim } from '../api/contacts';
import { fallbackAvatarUrl } from '../lib/avatar';

// ─── Types ────────────────────────────────────────────────────────────────────

type InteractionType = 'note' | 'call' | 'meeting' | 'email';

interface QuickInteractionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const INTERACTION_TYPES: { type: InteractionType; label: string; icon: React.ReactNode }[] = [
  { type: 'note',    label: 'Note',    icon: <FileText className="w-3.5 h-3.5" /> },
  { type: 'call',    label: 'Call',    icon: <Phone className="w-3.5 h-3.5" /> },
  { type: 'meeting', label: 'Meeting', icon: <Calendar className="w-3.5 h-3.5" /> },
  { type: 'email',   label: 'Email',   icon: <Mail className="w-3.5 h-3.5" /> },
];

const TYPE_TITLES: Record<InteractionType, string> = {
  note: 'Quick Note',
  call: 'Phone Call',
  meeting: 'Meeting',
  email: 'Email',
};

// ─── Component ────────────────────────────────────────────────────────────────

export const QuickInteractionModal: React.FC<QuickInteractionModalProps> = ({
  isOpen,
  onClose,
}) => {
  // ─── State ──────────────────────────────────────────────────────────────
  const [selectedContact, setSelectedContact] = useState<ContactSlim | null>(null);
  const [contactQuery, setContactQuery] = useState('');
  const [interactionType, setInteractionType] = useState<InteractionType>('note');
  const [content, setContent] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);

  const contactInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  const { data: contacts } = useContactNames();
  const addInteraction = useAddInteraction();

  // ─── Fuzzy contact filter ───────────────────────────────────────────────
  const filteredContacts = useMemo(() => {
    if (!contacts || !contactQuery.trim()) return [];
    const q = contactQuery.toLowerCase();
    return contacts
      .filter(c => !c.isGhost && c.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [contacts, contactQuery]);

  // ─── Reset on close ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) {
      // Defer reset so exit animation completes
      const timer = setTimeout(() => {
        setSelectedContact(null);
        setContactQuery('');
        setInteractionType('note');
        setContent('');
        setDropdownOpen(false);
        setHighlightIndex(0);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // ─── Focus contact input on open ────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      // Small delay for animation
      const timer = setTimeout(() => contactInputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // ─── Update dropdown visibility ─────────────────────────────────────────
  useEffect(() => {
    setDropdownOpen(filteredContacts.length > 0 && contactQuery.length > 0 && !selectedContact);
    setHighlightIndex(0);
  }, [filteredContacts, contactQuery, selectedContact]);

  // ─── Handlers ───────────────────────────────────────────────────────────

  const selectContact = useCallback((contact: ContactSlim) => {
    setSelectedContact(contact);
    setContactQuery('');
    setDropdownOpen(false);
    // Focus content area after selection
    setTimeout(() => contentRef.current?.focus(), 50);
  }, []);

  const clearContact = useCallback(() => {
    setSelectedContact(null);
    setContactQuery('');
    setTimeout(() => contactInputRef.current?.focus(), 50);
  }, []);

  const handleContactKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!dropdownOpen) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex(prev => Math.min(prev + 1, filteredContacts.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredContacts[highlightIndex]) {
        selectContact(filteredContacts[highlightIndex]);
      }
    } else if (e.key === 'Escape') {
      setDropdownOpen(false);
    }
  }, [dropdownOpen, filteredContacts, highlightIndex, selectContact]);

  const handleSubmit = useCallback(async () => {
    if (!selectedContact || !content.trim()) return;

    try {
      await addInteraction.mutateAsync({
        contactId: selectedContact.id,
        data: {
          type: interactionType,
          title: TYPE_TITLES[interactionType],
          content: content.trim(),
          date: new Date().toISOString(),
        },
      });

      toast.success(`${TYPE_TITLES[interactionType]} logged for ${selectedContact.name}`);
      onClose();
    } catch {
      toast.error('Failed to log interaction');
    }
  }, [selectedContact, content, interactionType, addInteraction, onClose]);

  // ─── Global keydown (Cmd+Enter to submit, Escape to close) ─────────
  useEffect(() => {
    if (!isOpen) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose, handleSubmit]);

  const canSubmit = !!selectedContact && content.trim().length > 0 && !addInteraction.isPending;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Scrim */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] bg-black/30"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
            className="fixed inset-0 z-[101] flex items-center justify-center pointer-events-none"
          >
            <div
              className="glass-panel rounded-2xl shadow-2xl w-full max-w-[480px] mx-4 pointer-events-auto overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              {/* ── Header ── */}
              <div className="flex items-center justify-between px-5 py-4 bg-surface-container-low">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 bg-primary/10 rounded-lg">
                    <FileText className="w-4 h-4 text-primary" />
                  </div>
                  <h2 className="font-headline font-bold text-on-surface">Quick Interaction</h2>
                </div>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg hover:bg-surface-container-high transition-colors text-on-surface-variant"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* ── Body ── */}
              <div className="px-5 py-4 space-y-4">
                {/* Contact Picker */}
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1.5 block">
                    Who?
                  </label>

                  {selectedContact ? (
                    <div className="flex items-center gap-2 bg-surface-container-low rounded-xl px-3 py-2.5">
                      <img
                        src={selectedContact.avatarUrl || fallbackAvatarUrl(selectedContact.name)}
                        alt=""
                        className="w-6 h-6 rounded-full object-cover"
                      />
                      <span className="font-bold text-sm text-on-surface flex-1">{selectedContact.name}</span>
                      <button
                        onClick={clearContact}
                        className="p-1 rounded-md hover:bg-surface-container-high transition-colors text-on-surface-variant"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <div className="flex items-center gap-2 bg-surface-container-low rounded-xl px-3 py-2.5 focus-within:ring-2 focus-within:ring-primary/30 transition-all">
                        <Search className="w-4 h-4 text-on-surface-variant/50 shrink-0" />
                        <input
                          ref={contactInputRef}
                          value={contactQuery}
                          onChange={e => setContactQuery(e.target.value)}
                          onKeyDown={handleContactKeyDown}
                          placeholder="Search for a contact…"
                          className="flex-1 bg-transparent border-none focus:ring-0 focus:outline-none text-sm text-on-surface placeholder:text-on-surface-variant/40"
                          autoComplete="off"
                        />
                      </div>

                      {/* Dropdown */}
                      <AnimatePresence>
                        {dropdownOpen && (
                          <motion.div
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.12 }}
                            className="absolute top-full left-0 right-0 mt-1 bg-surface-container-lowest rounded-xl shadow-lg z-10 overflow-hidden max-h-[200px] overflow-y-auto"
                          >
                            {filteredContacts.map((contact, i) => (
                              <button
                                key={contact.id}
                                onClick={() => selectContact(contact)}
                                onMouseEnter={() => setHighlightIndex(i)}
                                className={`
                                  w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors
                                  ${i === highlightIndex ? 'bg-primary/10 text-primary' : 'text-on-surface hover:bg-surface-container-low'}
                                `}
                              >
                                <img
                                  src={contact.avatarUrl || fallbackAvatarUrl(contact.name)}
                                  alt=""
                                  className="w-6 h-6 rounded-full object-cover"
                                />
                                <span className="text-sm font-medium truncate">{contact.name}</span>
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}
                </div>

                {/* Type Selector */}
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1.5 block">
                    Type
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {INTERACTION_TYPES.map(({ type, label, icon }) => (
                      <button
                        key={type}
                        onClick={() => setInteractionType(type)}
                        className={`
                          flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all
                          ${interactionType === type
                            ? 'bg-primary text-on-primary shadow-sm'
                            : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'
                          }
                        `}
                      >
                        {icon}
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Content Area */}
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1.5 block">
                    What happened?
                  </label>
                  <textarea
                    ref={contentRef}
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    placeholder="Discussed Q3 targets and Series B timeline…"
                    className="w-full bg-surface-container-low rounded-xl px-3 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/40 border-none focus:ring-2 focus:ring-primary/30 focus:outline-none resize-none transition-all"
                    style={{ fieldSizing: 'content' as any, minHeight: '80px', maxHeight: '200px' }}
                  />
                </div>
              </div>

              {/* ── Footer ── */}
              <div className="px-5 py-3.5 bg-surface-container-low flex items-center justify-between">
                <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-on-surface-variant/50">
                  <kbd className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-md bg-surface-container-high text-[10px] font-bold">⌘</kbd>
                  {' + '}
                  <kbd className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-md bg-surface-container-high text-[10px] font-bold">⏎</kbd>
                  {' to save'}
                </span>
                <button
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary font-bold text-sm rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {addInteraction.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FileText className="w-4 h-4" />
                  )}
                  Save Interaction
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
