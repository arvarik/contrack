import React from 'react';
import {
  Mail, Phone, Building, Briefcase, MapPin, Globe,
  Shield, FileText, Tag, MessageSquare,
} from 'lucide-react';
import type { Contact } from '../../../../types';
import {
  CARD_COMPACT, SECTION_HEADING, SOURCE_BADGE, TAG_PILL,
} from '../../../../lib/styles';
import { cn } from '../../../../lib/utils';
import { FieldRow } from './FieldRow';

// =============================================================================
// ContactCard — Full side-by-side comparison card
// =============================================================================

export interface ContactCardProps {
  contact: Contact;
  label: string;
  labelColor: string;
  other?: Contact;
  isPrimary?: boolean;
  onSetPrimary?: () => void;
}

export const ContactCard = ({ contact, label, labelColor, other, isPrimary, onSetPrimary }: ContactCardProps) => {
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
              via {contact.sources.map((s: any) => s.platform).join(', ')}
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
