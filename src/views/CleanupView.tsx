import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, CheckCircle2, Sparkles, Mail, Phone,
  Building, Briefcase, MapPin, Globe, Zap, Shield, ChevronLeft,
  ChevronRight, AlertCircle, Loader2, Merge, X,
  Brain, ScanSearch, FileText, Tag,
} from 'lucide-react';
import { useDedupeSuggestions, useMergeContacts } from '../api';
import type { Contact, DedupeSuggestion } from '../types';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import {
  ICON_BTN, PAGE_TITLE, CARD_COMPACT, SECTION_HEADING,
  SECTION_BG, TAG_PILL, SOURCE_BADGE, EMPTY_HERO,
} from '../lib/styles';
import { cn } from '../lib/utils';

// =============================================================================
// CleanupView — The Singularity De-Duplication Review Queue
// =============================================================================

export const CleanupView = () => {
  const [scanStarted, setScanStarted] = useState(false);
  const { data: suggestions, isLoading, error, refetch } = useDedupeSuggestions(scanStarted);
  const mergeContacts = useMergeContacts();
  const navigate = useNavigate();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [mergedIds, setMergedIds] = useState<Set<string>>(new Set());

  // Filter out dismissed and already-merged suggestions
  const activeSuggestions = useMemo(() => {
    return (suggestions ?? []).filter(s => !dismissed.has(s.id) && !mergedIds.has(s.id));
  }, [suggestions, dismissed, mergedIds]);

  const currentSuggestion = activeSuggestions[currentIndex] ?? null;
  const totalActive = activeSuggestions.length;

  // Clamp index when list shrinks
  useEffect(() => {
    if (currentIndex >= totalActive && totalActive > 0) {
      setCurrentIndex(totalActive - 1);
    }
  }, [totalActive, currentIndex]);

  // Handle dismiss (keep separate)
  const handleDismiss = useCallback(() => {
    if (!currentSuggestion) return;
    setDismissed(prev => new Set(prev).add(currentSuggestion.id));
    toast('Kept separate', { icon: <X className="w-4 h-4" /> });
  }, [currentSuggestion]);

  // Handle merge
  const handleMerge = useCallback(async () => {
    if (!currentSuggestion || mergeContacts.isPending) return;
    try {
      await mergeContacts.mutateAsync({
        primaryId: currentSuggestion.contactA.id,
        duplicateId: currentSuggestion.contactB.id,
      });
      setMergedIds(prev => new Set(prev).add(currentSuggestion.id));
      toast.success(`Merged "${currentSuggestion.contactB.name}" → "${currentSuggestion.contactA.name}"`);
    } catch (err: any) {
      toast.error(`Merge failed: ${err.message}`);
    }
  }, [currentSuggestion, mergeContacts]);

  // Navigate between suggestions
  const goNext = useCallback(() => {
    if (currentIndex < totalActive - 1) setCurrentIndex(i => i + 1);
  }, [currentIndex, totalActive]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) setCurrentIndex(i => i - 1);
  }, [currentIndex]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          handleDismiss();
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleMerge();
          break;
        case 'ArrowDown':
        case 'j':
          e.preventDefault();
          goNext();
          break;
        case 'ArrowUp':
        case 'k':
          e.preventDefault();
          goPrev();
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleDismiss, handleMerge, goNext, goPrev]);

  // Start scan
  const startScan = () => {
    setScanStarted(true);
    setCurrentIndex(0);
    setDismissed(new Set());
    setMergedIds(new Set());
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-surface">
      {/* Header — no border, background shift for separation */}
      <header className="p-6 bg-surface-container-low shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className={ICON_BTN}
            >
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className={cn(PAGE_TITLE, "flex items-center gap-3")}>
                <div className="p-2 bg-primary/10 rounded-xl">
                  <Zap className="w-6 h-6 text-primary" />
                </div>
                The Singularity
              </h1>
              <p className="text-sm text-on-surface-variant mt-0.5">
                Deterministic + AI de-duplication engine
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!scanStarted ? (
              <button
                onClick={startScan}
                className="btn-primary flex items-center gap-2"
              >
                <ScanSearch className="w-5 h-5" />
                Run Scan
              </button>
            ) : (
              <button
                onClick={() => {
                  refetch();
                  setCurrentIndex(0);
                  setDismissed(new Set());
                  setMergedIds(new Set());
                }}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-primary bg-primary/10 hover:bg-primary/15 rounded-full transition-colors"
              >
                <ScanSearch className="w-4 h-4" />
                Re-Scan
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Pre-scan state */}
        {!scanStarted && (
          <div className={EMPTY_HERO}>
            <div className="p-6 bg-primary/8 rounded-3xl mb-6">
              <Brain className="w-16 h-16 text-primary" />
            </div>
            <h2 className="text-xl font-headline font-bold mb-3">Ready to clean your network</h2>
            <p className="text-on-surface-variant text-sm leading-relaxed mb-6">
              The Singularity scans your contacts for duplicates using a two-pass engine:
              exact email & phone matching, then AI-powered fuzzy name analysis.
            </p>
            <div className="grid grid-cols-2 gap-3 w-full text-left mb-8">
              <EngineInfoCard
                icon={<Shield className="w-5 h-5 text-emerald-500" />}
                title="Pass 1: Deterministic"
                desc="Exact email & phone matches"
              />
              <EngineInfoCard
                icon={<Sparkles className="w-5 h-5 text-primary" />}
                title="Pass 2: AI Analysis"
                desc="Fuzzy names via Gemini"
              />
            </div>
            <button
              onClick={startScan}
              className="btn-primary flex items-center gap-2 px-8 py-3"
            >
              <ScanSearch className="w-5 h-5" />
              Begin Scan
            </button>
          </div>
        )}

        {/* Loading */}
        {scanStarted && isLoading && (
          <div className="flex flex-col items-center justify-center h-full">
            <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
            <p className="text-on-surface-variant font-bold">Scanning contacts for duplicates...</p>
            <p className="text-xs text-on-surface-variant/70 mt-1">This may take a moment if AI analysis is enabled</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex flex-col items-center justify-center h-full">
            <AlertCircle className="w-12 h-12 text-rose-500 mb-4" />
            <p className="text-rose-500 font-bold">Scan failed</p>
            <p className="text-sm text-on-surface-variant mt-1">{(error as Error).message}</p>
          </div>
        )}

        {/* All clean */}
        {scanStarted && !isLoading && !error && totalActive === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="p-6 bg-emerald-500/10 rounded-3xl mb-6">
              <CheckCircle2 className="w-16 h-16 text-emerald-500" />
            </div>
            <h2 className="text-xl font-headline font-bold mb-2">All clean!</h2>
            <p className="text-on-surface-variant text-sm">
              {mergedIds.size > 0
                ? `Merged ${mergedIds.size} duplicate${mergedIds.size > 1 ? 's' : ''}. Your network is pristine.`
                : 'No duplicate contacts detected. Your network is pristine.'}
            </p>
            <Link
              to="/"
              className="mt-6 px-6 py-2.5 bg-primary/10 text-primary font-bold rounded-full hover:bg-primary/15 transition-colors text-sm"
            >
              Back to Network
            </Link>
          </div>
        )}

        {/* Active suggestion */}
        {scanStarted && !isLoading && currentSuggestion && (
          <div className="max-w-5xl mx-auto">
            {/* Progress bar */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-on-surface">
                  Reviewing {currentIndex + 1} of {totalActive}
                </span>
                <MatchBadge type={currentSuggestion.matchType} confidence={currentSuggestion.confidence} />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={goPrev}
                  disabled={currentIndex === 0}
                  className="p-1.5 rounded-lg hover:bg-surface-container-high disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={goNext}
                  disabled={currentIndex >= totalActive - 1}
                  className="p-1.5 rounded-lg hover:bg-surface-container-high disabled:opacity-30 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Progress track */}
            <div className="h-1 bg-surface-container-high rounded-full mb-6 overflow-hidden">
              <motion.div
                className="h-full signature-gradient rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${((currentIndex + 1) / totalActive) * 100}%` }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              />
            </div>

            {/* Reasoning */}
            <div className="bg-surface-container-low rounded-xl p-4 mb-6 flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <p className="text-sm text-on-surface leading-relaxed">{currentSuggestion.reasoning}</p>
            </div>

            {/* Side-by-side cards */}
            <AnimatePresence mode="wait">
              <motion.div
                key={currentSuggestion.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.25 }}
                className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8"
              >
                <ContactCard
                  contact={currentSuggestion.contactA}
                  label="Primary"
                  labelColor="text-emerald-600 bg-emerald-500/10"
                  other={currentSuggestion.contactB}
                />
                <ContactCard
                  contact={currentSuggestion.contactB}
                  label="Duplicate"
                  labelColor="text-amber-600 bg-amber-500/10"
                  other={currentSuggestion.contactA}
                />
              </motion.div>
            </AnimatePresence>

            {/* Action buttons */}
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={handleDismiss}
                className="group flex items-center gap-3 px-8 py-3.5 bg-surface-container-low hover:bg-surface-container-high rounded-2xl transition-all text-on-surface-variant hover:text-on-surface"
              >
                <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                <div className="text-left">
                  <div className="text-sm font-bold">Keep Separate</div>
                  <div className="text-[10px] uppercase tracking-wider opacity-60">← Arrow</div>
                </div>
              </button>

              <button
                onClick={handleMerge}
                disabled={mergeContacts.isPending}
                className="group flex items-center gap-3 px-8 py-3.5 signature-gradient text-white rounded-2xl hover:shadow-lg hover:shadow-primary/20 transition-all disabled:opacity-50"
              >
                <div className="text-right">
                  <div className="text-sm font-bold">
                    {mergeContacts.isPending ? 'Merging...' : 'Merge'}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider opacity-70">Arrow →</div>
                </div>
                {mergeContacts.isPending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// =============================================================================
// Sub-Components
// =============================================================================

const EngineInfoCard = ({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) => (
  <div className="bg-surface-container-lowest rounded-xl p-4 flex items-start gap-3 shadow-sm">
    <div className="shrink-0 mt-0.5">{icon}</div>
    <div>
      <div className="text-sm font-bold text-on-surface">{title}</div>
      <div className="text-xs text-on-surface-variant">{desc}</div>
    </div>
  </div>
);

const MatchBadge = ({ type, confidence }: { type: string; confidence: number }) => {
  const pct = Math.round(confidence * 100);
  const config = {
    email: { icon: <Mail className="w-3.5 h-3.5" />, label: 'Email Match', color: 'text-emerald-600 bg-emerald-500/10' },
    phone: { icon: <Phone className="w-3.5 h-3.5" />, label: 'Phone Match', color: 'text-blue-600 bg-blue-500/10' },
    ai:    { icon: <Sparkles className="w-3.5 h-3.5" />, label: 'AI Match', color: 'text-primary bg-primary/10' },
  }[type] || { icon: <Zap className="w-3.5 h-3.5" />, label: 'Match', color: 'text-on-surface-variant bg-surface-container' };

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${config.color}`}>
      {config.icon}
      {config.label} · {pct}%
    </span>
  );
};

/** Side-by-side contact card with diff highlighting */
const ContactCard = ({ contact, label, labelColor, other }: {
  contact: Contact;
  label: string;
  labelColor: string;
  other: Contact;
}) => {
  const isDiff = (field: keyof Contact) => {
    const a = contact[field];
    const b = other[field];
    if (!a && !b) return false;
    if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase().trim() !== b.toLowerCase().trim();
    return a !== b;
  };

  const diffClass = (field: keyof Contact) =>
    isDiff(field) ? 'bg-amber-500/8 rounded-lg px-2 py-0.5 -mx-2' : '';

  const primaryEmail = contact.emails?.[0]?.email;
  const primaryPhone = contact.phones?.[0]?.phone;

  return (
    <div className={cn(CARD_COMPACT, "space-y-4")}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className={cn(SECTION_HEADING, `px-3 py-1 rounded-full ${labelColor}`)}>
          {label}
        </span>
        {contact.sources?.length > 0 && (
          <span className={SOURCE_BADGE}>
            via {contact.sources.map(s => s.platform).join(', ')}
          </span>
        )}
      </div>

      {/* Avatar + Name */}
      <div className="flex items-center gap-3">
        <img
          src={contact.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(contact.name)}`}
          alt={contact.name}
          className="w-12 h-12 rounded-full object-cover bg-surface-container-high"
        />
        <div>
          <div className={`text-base font-bold ${diffClass('name')}`}>{contact.name}</div>
          {contact.headline && (
            <div className={`text-xs text-on-surface-variant italic ${diffClass('headline')}`}>
              {contact.headline}
            </div>
          )}
        </div>
      </div>

      {/* Fields */}
      <div className="space-y-2.5 text-sm">
        {contact.role && (
          <FieldRow icon={<Briefcase className="w-4 h-4" />} label="Role" highlighted={isDiff('role')}>
            {contact.role}
          </FieldRow>
        )}
        {contact.company && (
          <FieldRow icon={<Building className="w-4 h-4" />} label="Company" highlighted={isDiff('company')}>
            {contact.company}
          </FieldRow>
        )}
        {contact.location && (
          <FieldRow icon={<MapPin className="w-4 h-4" />} label="Location" highlighted={isDiff('location')}>
            {contact.location}
          </FieldRow>
        )}
        {contact.industry && (
          <FieldRow icon={<Globe className="w-4 h-4" />} label="Industry" highlighted={isDiff('industry')}>
            {contact.industry}
          </FieldRow>
        )}
        {primaryEmail && (
          <FieldRow icon={<Mail className="w-4 h-4" />} label="Email">
            <span className="font-mono text-xs">{primaryEmail}</span>
            {contact.emails.length > 1 && (
              <span className="text-[10px] text-on-surface-variant ml-1">+{contact.emails.length - 1}</span>
            )}
          </FieldRow>
        )}
        {primaryPhone && (
          <FieldRow icon={<Phone className="w-4 h-4" />} label="Phone">
            <span className="font-mono text-xs">{primaryPhone}</span>
          </FieldRow>
        )}
        {contact.tags?.length > 0 && (
          <FieldRow icon={<Tag className="w-4 h-4" />} label="Tags">
            <div className="flex flex-wrap gap-1">
              {contact.tags.map(t => (
                <span key={t.id} className={TAG_PILL}>{t.tag}</span>
              ))}
            </div>
          </FieldRow>
        )}
      </div>

      {/* About */}
      {contact.about && (
        <div className={`text-xs text-on-surface-variant leading-relaxed p-3 bg-surface-container-low rounded-xl ${isDiff('about') ? 'ring-2 ring-amber-400/30' : ''}`}>
          <FileText className="w-3.5 h-3.5 inline mr-1 opacity-50" />
          {contact.about}
        </div>
      )}
    </div>
  );
};

/** A single labeled field row with optional diff highlight */
const FieldRow = ({ icon, label, children, highlighted }: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  highlighted?: boolean;
}) => (
  <div className={`flex items-center gap-2.5 ${highlighted ? 'bg-amber-500/8 rounded-lg px-2.5 py-1.5 -mx-1' : ''}`}>
    <span className="text-on-surface-variant/60 shrink-0">{icon}</span>
    <span className="text-on-surface-variant text-xs font-bold uppercase tracking-wider w-16 shrink-0">{label}</span>
    <span className="text-on-surface">{children}</span>
  </div>
);
