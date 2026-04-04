import React from 'react';
import {
  Mail, Phone, Building, Briefcase, MapPin, Globe,
  Zap, Sparkles, Shield, FileText, Tag, MessageSquare,
} from 'lucide-react';
import type { Contact } from '../../types';
import {
  CARD_COMPACT, SECTION_HEADING, SOURCE_BADGE, TAG_PILL,
} from '../../lib/styles';
import { cn } from '../../lib/utils';

// =============================================================================
// ContactCard — Full side-by-side comparison card
// =============================================================================

export const ContactCard = ({ contact, label, labelColor, other, isPrimary, onSetPrimary }: {
  contact: Contact;
  label: string;
  labelColor: string;
  other?: Contact;
  isPrimary?: boolean;
  onSetPrimary?: () => void;
}) => {
  const isDiff = (field: keyof Contact) => {
    if (!other) return false;
    const a = contact[field];
    const b = other[field];
    if (!a && !b) return false;
    if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase().trim() !== b.toLowerCase().trim();
    return a !== b;
  };

  const primaryEmail = contact.emails?.[0]?.email;
  const primaryPhone = contact.phones?.[0]?.phone;

  return (
    <div className={cn(
      CARD_COMPACT, "space-y-4 relative transition-all",
      isPrimary && "ring-2 ring-emerald-500/50 shadow-md"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className={cn(SECTION_HEADING, `px-3 py-1 rounded-full ${labelColor}`)}>
          {label}
        </span>
        <div className="flex items-center gap-2">
          {(contact.interactionCount ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-on-surface-variant bg-surface-container-low px-2 py-0.5 rounded-full">
              <MessageSquare className="w-3 h-3" />
              {contact.interactionCount}
            </span>
          )}
          {contact.sources?.length > 0 && (
            <span className={SOURCE_BADGE}>
              via {contact.sources.map(s => s.platform).join(', ')}
            </span>
          )}
        </div>
      </div>

      {/* Primary selector button */}
      {onSetPrimary && (
        <button
          onClick={onSetPrimary}
          className={cn(
            "w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold transition-all",
            isPrimary
              ? "bg-emerald-500/10 text-emerald-600"
              : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
          )}
        >
          {isPrimary ? (
            <>
              <Shield className="w-3.5 h-3.5" />
              Primary Contact
            </>
          ) : (
            "Set as Primary"
          )}
        </button>
      )}

      {/* Avatar + Name */}
      <div className="flex items-center gap-3">
        <img
          src={contact.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(contact.name)}&mouth=default,smile,serious`}
          alt={contact.name}
          className="w-12 h-12 rounded-full object-cover bg-surface-container-high"
        />
        <div>
          <div className={`text-base font-bold ${isDiff('name') ? 'bg-amber-500/8 rounded-lg px-2 py-0.5 -mx-2' : ''}`}>
            {contact.name}
          </div>
          {contact.headline && (
            <div className={`text-xs text-on-surface-variant italic ${isDiff('headline') ? 'bg-amber-500/8 rounded-lg px-2 py-0.5 -mx-2' : ''}`}>
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

// =============================================================================
// ContactMiniCard — Compact contact card for the picker
// =============================================================================

export const ContactMiniCard = ({ contact, selected, onToggle, disabled }: {
  contact: Contact;
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) => (
  <button
    onClick={onToggle}
    disabled={disabled && !selected}
    className={cn(
      "w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left",
      selected
        ? "bg-primary/8 ring-2 ring-primary"
        : disabled
          ? "opacity-40 cursor-not-allowed"
          : "hover:bg-surface-container-low"
    )}
  >
    <img
      src={contact.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(contact.name)}&mouth=default,smile,serious`}
      alt={contact.name}
      className="w-10 h-10 rounded-full object-cover bg-surface-container-high shrink-0"
    />
    <div className="min-w-0 flex-1">
      <div className="text-sm font-bold truncate">{contact.name}</div>
      <div className="text-xs text-on-surface-variant truncate">
        {[contact.role, contact.company].filter(Boolean).join(' · ') || contact.emails?.[0]?.email || 'No details'}
      </div>
    </div>
    <div className={cn(
      "w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-all",
      selected ? "border-primary bg-primary" : "border-surface-container-high"
    )}>
      {selected && (
        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
    </div>
  </button>
);

// =============================================================================
// FieldRow — A single labeled field row with optional diff highlight
// =============================================================================

export const FieldRow = ({ icon, label, children, highlighted }: {
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

// =============================================================================
// MatchBadge — Match type indicator (email/phone/AI/manual)
// =============================================================================

export const MatchBadge = ({ type, confidence }: { type: string; confidence: number }) => {
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

// =============================================================================
// EngineInfoCard — Scan method description
// =============================================================================

export const EngineInfoCard = ({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) => (
  <div className="bg-surface-container-lowest rounded-xl p-4 flex items-start gap-3 shadow-sm">
    <div className="shrink-0 mt-0.5">{icon}</div>
    <div>
      <div className="text-sm font-bold text-on-surface">{title}</div>
      <div className="text-xs text-on-surface-variant">{desc}</div>
    </div>
  </div>
);
