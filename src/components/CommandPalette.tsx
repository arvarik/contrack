import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { Command } from 'cmdk';
import { useNavigate } from 'react-router-dom';
import { useSearchContacts, useCreateContact, useContacts, useAddInteraction, useSemanticSearch } from '../api';
import { useDebounce } from '../hooks/useDebounce';
import { Search, UserPlus, Briefcase, Building, Zap, MessageSquare, Phone, Calendar, Mail, Sparkles, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { KBD, KBD_SM, SECTION_BG } from '../lib/styles';
import type { SemanticMatch } from '../types';

// ─── Mode detection helpers ───────────────────────────────────────────────────

function getMode(search: string): 'normal' | 'action' | 'ai' {
  const trimmed = search.trim();
  if (trimmed.startsWith('?')) return 'ai';
  if (trimmed.startsWith('>')) return 'action';
  return 'normal';
}

// ─── AI shimmer skeleton ──────────────────────────────────────────────────────

const AIShimmerRow = ({ delay = 0 }: { delay?: number }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ delay, duration: 0.2 }}
    className="flex items-center gap-3 px-3 py-3 rounded-xl"
  >
    <div className="w-8 h-8 rounded-full bg-primary/10 animate-pulse shrink-0" />
    <div className="flex-1 space-y-2">
      <div className="h-3 bg-primary/10 rounded-full animate-pulse w-2/5" />
      <div className="h-2.5 bg-surface-container-high rounded-full animate-pulse w-3/5" />
      <div className="h-2 bg-surface-container rounded-full animate-pulse w-4/5" />
    </div>
  </motion.div>
);

// ─── AI result card ───────────────────────────────────────────────────────────

interface AIResultCardProps {
  match: SemanticMatch;
  index: number;
  onSelect: () => void;
  isFallback: boolean;
}

const AIResultCard = ({ match, index, onSelect, isFallback }: AIResultCardProps) => (
  <Command.Item
    key={match.id}
    value={`ai_${match.id}_${match.name}`}
    onSelect={onSelect}
    className="flex items-start gap-3 px-3 py-3 rounded-xl cursor-default select-none aria-selected:bg-primary/8 aria-selected:ring-1 aria-selected:ring-primary/20 transition-all text-on-surface group"
  >
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.06, duration: 0.2 }}
      className="contents"
    >
      <img
        src={match.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(match.name)}`}
        alt=""
        className="w-8 h-8 rounded-full bg-surface-container-highest object-cover shrink-0 mt-0.5"
      />
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm truncate">{match.name}</span>
          {isFallback && (
            <span className="text-[9px] font-bold uppercase tracking-widest bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded shrink-0">
              Fallback
            </span>
          )}
        </div>
        {(match.role || match.company) && (
          <span className="text-xs text-on-surface-variant flex items-center gap-2 truncate">
            {match.role && <span className="flex items-center gap-1"><Briefcase className="w-3 h-3" />{match.role}</span>}
            {match.company && <span className="flex items-center gap-1"><Building className="w-3 h-3" />{match.company}</span>}
          </span>
        )}
        {match.aiReason && (
          <motion.span
            initial={{ opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.06 + 0.1 }}
            className="text-xs text-primary/70 italic flex items-center gap-1 mt-0.5"
          >
            <Sparkles className="w-3 h-3 text-primary/50 shrink-0" />
            {match.aiReason}
          </motion.span>
        )}
      </div>
    </motion.div>
  </Command.Item>
);

// ─── Example prompts ──────────────────────────────────────────────────────────

const EXAMPLE_QUERIES = [
  'Who do I know in London working in FinTech?',
  'Who likes espresso?',
  "Who haven't I contacted in over 3 months?",
  'Who works at a startup as a designer?',
];

// ─── Main component ───────────────────────────────────────────────────────────

export const CommandPalette = () => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  // Debounce: faster for FTS5 (200ms), slower for AI (600ms)
  const mode = getMode(search);
  const debouncedSearch = useDebounce(search, mode === 'ai' ? 600 : 200);

  // Hooks
  const { data: ftsResults = [], isLoading: ftsLoading } = useSearchContacts(
    mode === 'normal' ? debouncedSearch : ''
  );
  const { data: allContacts = [] } = useContacts();
  const createContact = useCreateContact();
  const addInteraction = useAddInteraction();
  const semanticSearch = useSemanticSearch();

  // Track last fired query to prevent duplicate calls
  const prevAiQueryRef = useRef<string>('');

  // Derive the raw NL query from the ? prefix
  const aiQuery = mode === 'ai' ? search.replace(/^\?+\s*/, '').trim() : '';

  // Derive AI results directly from mutation data (reactive, no extra useState)
  const aiResults: SemanticMatch[] = mode === 'ai' && semanticSearch.data ? semanticSearch.data.matches : [];
  const aiFallback: boolean = mode === 'ai' && !!semanticSearch.data?.fallback;

  // Fire semantic search when debounced AI query changes and is ≥3 chars
  useEffect(() => {
    if (mode !== 'ai' || aiQuery.length < 3) return;
    if (aiQuery === prevAiQueryRef.current) return; // same query, skip
    prevAiQueryRef.current = aiQuery;
    semanticSearch.mutate(aiQuery);
  }, [debouncedSearch, mode, aiQuery]);

  // Reset mutation state when mode changes away from AI
  useEffect(() => {
    if (mode !== 'ai') {
      semanticSearch.reset();
      prevAiQueryRef.current = '';
    }
  }, [mode]);

  // Action mode (> prefix)
  const isAction = mode === 'action';
  const actionMatch = useMemo(() => {
    if (!isAction) return null;
    const regex = /^>\s*(note|call|meeting|email)\s+([^:]+):\s*(.*)$/i;
    const match = search.match(regex);
    if (!match) return null;
    const [_, type, nameStr, content] = match;
    const typeLower = type.toLowerCase() as 'note' | 'call' | 'meeting' | 'email';
    const targetContact = allContacts.find(c => c.name?.toLowerCase().includes(nameStr.toLowerCase().trim()));
    if (targetContact && content.trim()) {
      return { type: typeLower, contact: targetContact, content: content.trim() };
    }
    return null;
  }, [search, allContacts, isAction]);

  // Global ⌘K / Ctrl+K listener
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    setSearch('');
    semanticSearch.reset();
    prevAiQueryRef.current = '';
  }, []);

  const handleCreateContact = async () => {
    if (!search.trim()) return;
    try {
      const newContact = await createContact.mutateAsync({ name: search.trim(), cadenceDays: 90 });
      navigate(`/contact/${newContact.id}`);
      handleClose();
      toast.success(`Created contact ${newContact.name}`);
    } catch (e: any) {
      toast.error(`Failed to create contact: ${e.message}`);
    }
  };

  const handleActionExecute = async () => {
    if (!actionMatch) return;
    try {
      const titleMap: Record<string, string> = {
        note: 'Quick Note', call: 'Phone Call logged', meeting: 'Meeting summary', email: 'Email sent',
      };
      await addInteraction.mutateAsync({
        contactId: actionMatch.contact.id,
        data: { type: actionMatch.type, title: titleMap[actionMatch.type], content: actionMatch.content, date: new Date().toISOString() },
      });
      handleClose();
      toast.success(`Logged ${actionMatch.type} for ${actionMatch.contact.name}`);
    } catch (e: any) {
      toast.error(`Failed to log interaction: ${e.message}`);
    }
  };

  const getLogIcon = (type: string) => {
    switch (type) {
      case 'note': return <MessageSquare className="w-4 h-4" />;
      case 'email': return <Mail className="w-4 h-4" />;
      case 'call': return <Phone className="w-4 h-4" />;
      case 'meeting': return <Calendar className="w-4 h-4" />;
      default: return <Zap className="w-4 h-4" />;
    }
  };

  // AI loading: mutation is pending AND query is long enough
  const isAiLoading = semanticSearch.isPending && aiQuery.length >= 3;

  return (
    <AnimatePresence>
      {open && (
        <Command.Dialog
          open={open}
          onOpenChange={(v) => { if (!v) handleClose(); else setOpen(true); }}
          label="Global Command Palette"
          shouldFilter={mode !== 'ai'}
          className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4 backdrop-blur-md bg-surface/40 transition-all duration-200"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ duration: 0.15 }}
            className="w-full max-w-2xl glass-panel shadow-2xl rounded-2xl overflow-hidden flex flex-col font-body"
          >
            {/* ── Search input row ── */}
            <div className="flex items-center px-4 py-4 bg-surface-container-low gap-3">
              <AnimatePresence mode="wait">
                {mode === 'ai' ? (
                  <motion.div key="ai-icon" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={{ duration: 0.15 }}>
                    <Sparkles className={`w-5 h-5 text-primary ${isAiLoading ? 'animate-pulse' : ''}`} />
                  </motion.div>
                ) : mode === 'action' ? (
                  <motion.div key="action-icon" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={{ duration: 0.15 }}>
                    <Zap className="w-5 h-5 text-emerald-500 animate-pulse" />
                  </motion.div>
                ) : (
                  <motion.div key="search-icon" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={{ duration: 0.15 }}>
                    <Search className="w-5 h-5 text-on-surface-variant" />
                  </motion.div>
                )}
              </AnimatePresence>

              <Command.Input
                value={search}
                onValueChange={setSearch}
                autoFocus
                placeholder="Search contacts, > for actions, ? to ask AI..."
                className="flex-1 bg-transparent border-none focus:ring-0 text-on-surface placeholder:text-on-surface-variant outline-none text-lg"
              />
              <div className="flex items-center gap-1.5 opacity-50">
                <kbd className={KBD}>ESC</kbd>
              </div>
            </div>

            {/* ── Result list ── */}
            <Command.List className="max-h-[380px] overflow-y-auto p-2 scrollbar-hide">

              {/* ═══════════════ AI MODE ═══════════════ */}
              {mode === 'ai' && (
                <>
                  {/* Empty / typing prompt */}
                  {aiQuery.length === 0 && (
                    <Command.Empty className="py-8 text-center text-sm text-on-surface-variant">
                      <Sparkles className="w-8 h-8 text-primary/30 mx-auto mb-3" />
                      <p className="font-bold text-on-surface mb-1">AI Query Mode</p>
                      <p className="text-xs mb-4">Ask anything about your network in plain English.</p>
                      <div className="space-y-1.5 text-left max-w-xs mx-auto">
                        {EXAMPLE_QUERIES.map(q => (
                          <button
                            key={q}
                            onMouseDown={(e) => { e.preventDefault(); setSearch(`? ${q}`); }}
                            className="w-full text-left text-xs px-3 py-2 rounded-lg bg-primary/5 hover:bg-primary/10 text-primary/70 hover:text-primary transition-colors"
                          >
                            ? {q}
                          </button>
                        ))}
                      </div>
                    </Command.Empty>
                  )}

                  {/* Short query — waiting for more input */}
                  {aiQuery.length > 0 && aiQuery.length < 3 && (
                    <Command.Empty className="py-10 text-center text-sm text-on-surface-variant">
                      <Sparkles className="w-6 h-6 text-primary/30 mx-auto mb-2" />
                      <p className="text-xs">Keep typing to search…</p>
                    </Command.Empty>
                  )}

                  {/* Loading shimmer */}
                  {aiQuery.length >= 3 && isAiLoading && (
                    <div className="px-1 py-2 space-y-1">
                      <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-primary/60 flex items-center gap-1.5">
                        <Sparkles className="w-3 h-3 animate-pulse" /> Asking Gemini…
                      </div>
                      <AIShimmerRow delay={0} />
                      <AIShimmerRow delay={0.08} />
                      <AIShimmerRow delay={0.16} />
                    </div>
                  )}

                  {/* AI results */}
                  {aiQuery.length >= 3 && !isAiLoading && aiResults.length > 0 && (
                    <Command.Group
                      heading={aiFallback ? 'Keyword Results (AI Fallback)' : 'AI Query Results'}
                      className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-primary"
                    >
                      {aiFallback && (
                        <div className="flex items-center gap-1.5 px-3 pb-1 text-xs text-amber-600">
                          <AlertTriangle className="w-3 h-3" />
                          <span>AI unavailable — showing keyword matches</span>
                        </div>
                      )}
                      {aiResults.map((match, i) => (
                        <AIResultCard
                          key={match.id}
                          match={match}
                          index={i}
                          isFallback={aiFallback}
                          onSelect={() => { navigate(`/contact/${match.id}`); handleClose(); }}
                        />
                      ))}
                    </Command.Group>
                  )}

                  {/* No AI matches */}
                  {aiQuery.length >= 3 && !isAiLoading && aiResults.length === 0 && !semanticSearch.isPending && semanticSearch.isSuccess && (
                    <Command.Empty className="py-10 text-center text-sm text-on-surface-variant">
                      <Sparkles className="w-8 h-8 text-on-surface-variant/20 mx-auto mb-3" />
                      <p className="font-bold text-on-surface mb-1">No matches found</p>
                      <p className="text-xs">Try rephrasing your query, or use the regular search.</p>
                    </Command.Empty>
                  )}
                </>
              )}

              {/* ═══════════════ ACTION MODE ═══════════════ */}
              {mode === 'action' && !actionMatch && (
                <Command.Empty className="py-10 text-center text-sm text-on-surface-variant">
                  <Zap className="w-8 h-8 text-on-surface-variant/30 mx-auto mb-3" />
                  <p className="font-bold text-on-surface">Action Mode Active</p>
                  <p className="mt-1">Syntax: <code className="text-primary bg-primary/10 px-1 rounded">&gt; [type] [name]: [content]</code></p>
                  <p className="mt-2 text-xs">Types: note, call, meeting, email</p>
                  <p className="mt-1 text-xs text-on-surface-variant">Example: <code>&gt; note Julian: Left a voicemail regarding Q3 targets</code></p>
                </Command.Empty>
              )}

              {mode === 'action' && actionMatch && (
                <Command.Group
                  heading="Action Engine"
                  className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-emerald-500 [&_[cmdk-group-heading]]:tracking-widest"
                >
                  <Command.Item
                    value={`action_${actionMatch.type}_${actionMatch.contact.id}`}
                    onSelect={handleActionExecute}
                    className="flex items-center gap-4 px-3 py-4 rounded-xl cursor-default select-none bg-emerald-500/10 aria-selected:bg-emerald-500/15 transition-colors text-on-surface"
                  >
                    <div className="w-10 h-10 flex items-center justify-center bg-emerald-500/20 text-emerald-500 rounded-full shrink-0 shadow-lg shadow-emerald-500/10">
                      {getLogIcon(actionMatch.type)}
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col">
                      <span className="font-bold text-sm block truncate">Log {actionMatch.type} for <span className="text-emerald-400">{actionMatch.contact.name}</span></span>
                      <span className="text-sm text-on-surface-variant truncate mt-0.5">"{actionMatch.content}"</span>
                    </div>
                    <div className="shrink-0 opacity-50 px-2 flex items-center justify-center space-x-1">
                      <span className="text-xs">Press</span>
                      <kbd className={KBD}>Enter</kbd>
                    </div>
                  </Command.Item>
                </Command.Group>
              )}

              {/* ═══════════════ NORMAL MODE ═══════════════ */}
              {mode === 'normal' && (
                <>
                  <Command.Empty className="py-10 text-center text-sm text-on-surface-variant">
                    {ftsLoading ? 'Searching...' : 'No results found.'}
                  </Command.Empty>

                  {ftsResults.length > 0 && (
                    <Command.Group
                      heading="Contacts"
                      className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-on-surface-variant [&_[cmdk-group-heading]]:tracking-widest"
                    >
                      {ftsResults.map((contact) => (
                        <Command.Item
                          key={contact.id}
                          value={contact.id + contact.name}
                          onSelect={() => { navigate(`/contact/${contact.id}`); handleClose(); }}
                          className="flex items-center gap-3 px-3 py-3 rounded-xl cursor-default select-none aria-selected:bg-primary/10 aria-selected:text-primary transition-colors text-on-surface"
                        >
                          <img
                            src={contact.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(contact.name)}`}
                            alt=""
                            className="w-8 h-8 rounded-full bg-surface-container-highest object-cover"
                          />
                          <div className="flex-1 min-w-0 flex flex-col">
                            <span className="font-bold text-sm block truncate">{contact.name}</span>
                            {(contact.role || contact.company) && (
                              <span className="text-xs text-on-surface-variant flex items-center gap-2 truncate mt-0.5">
                                {contact.role && <span className="flex items-center gap-1"><Briefcase className="w-3 h-3" />{contact.role}</span>}
                                {contact.company && <span className="flex items-center gap-1"><Building className="w-3 h-3" />{contact.company}</span>}
                              </span>
                            )}
                          </div>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  )}

                  {search.trim().length > 0 && ftsResults.length === 0 && (
                    <Command.Group
                      heading="Actions"
                      className="mt-2 text-on-surface-variant [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-on-surface-variant [&_[cmdk-group-heading]]:tracking-widest"
                    >
                      <Command.Item
                        value={`create_${search}`}
                        onSelect={handleCreateContact}
                        className="flex items-center gap-3 px-3 py-3 rounded-xl cursor-default select-none aria-selected:bg-surface-container-high transition-colors text-on-surface"
                      >
                        <div className="w-8 h-8 flex items-center justify-center bg-surface-container-highest rounded-full">
                          <UserPlus className="w-4 h-4 text-primary" />
                        </div>
                        <span className="text-sm">Create new contact <span className="font-bold whitespace-nowrap overflow-hidden text-ellipsis max-w-[200px] inline-block align-bottom">"{search}"</span></span>
                      </Command.Item>
                    </Command.Group>
                  )}
                </>
              )}
            </Command.List>

            {/* ── Footer ── */}
            <div className={`px-4 py-3 ${SECTION_BG} text-[11px] text-on-surface-variant flex items-center justify-between`}>
              <AnimatePresence mode="wait">
                {mode === 'ai' ? (
                  <motion.span
                    key="ai-footer"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="flex items-center gap-1.5 text-primary font-bold"
                  >
                    <Sparkles className="w-3 h-3" /> AI Query Mode — powered by Gemini
                  </motion.span>
                ) : (
                  <motion.span
                    key="normal-footer"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="flex items-center gap-2"
                  >
                    <Zap className="w-3 h-3 text-emerald-500" /> Action Engine Available
                  </motion.span>
                )}
              </AnimatePresence>
              <span className="flex items-center gap-2">Use <kbd className={KBD_SM}>↑</kbd> <kbd className={KBD_SM}>↓</kbd> to navigate</span>
            </div>
          </motion.div>
        </Command.Dialog>
      )}
    </AnimatePresence>
  );
};
