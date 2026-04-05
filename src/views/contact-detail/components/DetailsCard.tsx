/**
 * DetailsCard — Left-column card displaying contact facts: location, email,
 * phone, birthday, industry, preferences, interests, and follow-up dates.
 *
 * Extracted from ContactProfile to keep each section focused and readable.
 */
import React, { useState } from "react";
import {
  MapPin, Mail, Phone, Cake, Globe, Coffee, Heart, Sparkles, X,
} from "lucide-react";

import type { Contact } from "../../../types";
import { cn } from "../../../lib/utils";
import { LABEL, LABEL_PRIMARY, CARD, SECTION_HEADING } from "../../../lib/styles";

import { EditableField } from "./EditableField";
import { IndustryField } from "./IndustryField";
import { BirthdayField } from "./BirthdayField";
import { MultiValueField, EMAIL_LABELS, PHONE_LABELS, ADDR_LABELS } from "./MultiValueField";

// ═══════════════════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════════════════

export interface DetailsCardProps {
  contact: Contact;
  contactId: string;
  onUpdate: (field: string, val: string) => void;
  updateContact: { mutate: (args: { id: string; data: any }) => void };
}

// ═══════════════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════════════

export const DetailsCard: React.FC<DetailsCardProps> = ({
  contact,
  contactId,
  onUpdate,
  updateContact,
}) => {
  const [newInterest, setNewInterest] = useState('');
  const [newPreference, setNewPreference] = useState('');

  const handleAddInterest = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && newInterest.trim()) {
      e.preventDefault();
      const updated = [...(contact.interests || []), { id: Math.random().toString(), interest: newInterest.trim(), isAiGenerated: false }];
      updateContact.mutate({ id: contactId, data: { interests: updated } as any });
      setNewInterest('');
    }
  };

  const handleRemoveInterest = (interestId: string) => {
    const updated = (contact.interests || []).filter((i: any) => i.id !== interestId);
    updateContact.mutate({ id: contactId, data: { interests: updated } as any });
  };

  return (
    <div className={cn(CARD, "space-y-4")}>
      <h3 className={cn(SECTION_HEADING, "pb-2 mb-4")}>Details</h3>
      
      {/* Location */}
      <div className="flex items-start gap-4 group">
        <MapPin className="w-5 h-5 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <span className={LABEL}>Location</span>
          <MultiValueField
            items={(contact.addresses && contact.addresses.length > 0) 
              ? contact.addresses.map((a: any) => ({ id: a.id, value: a.address, label: a.label || 'home' }))
              : contact.location ? [{ id: 'legacy-init', value: contact.location, label: 'home' }] : []
            }
            onSave={updated =>
              updateContact.mutate({ id: contactId, data: { addresses: updated.map((a, i) => ({ address: a.value, label: a.label || 'home', isPrimary: i === 0 })) } as any })
            }
            labelOptions={ADDR_LABELS}
            emptyPlaceholder="Add Location..."
            inputPlaceholder="San Francisco, CA"
          />
        </div>
      </div>

      {/* Email */}
      <div className="flex items-start gap-4 group">
        <Mail className="w-5 h-5 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <span className={LABEL}>Email</span>
          <MultiValueField
            items={(contact.emails ?? []).map(e => ({ id: e.id, value: e.email, label: e.label || 'personal' }))}
            onSave={updated =>
              updateContact.mutate({ id: contactId, data: { emails: updated.map((e, i) => ({ email: e.value, label: e.label, isPrimary: i === 0 })) } as any })
            }
            labelOptions={EMAIL_LABELS}
            emptyPlaceholder="Add Email..."
            inputPlaceholder="email@example.com"
          />
        </div>
      </div>

      {/* Phone */}
      <div className="flex items-start gap-4 group">
        <Phone className="w-5 h-5 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <span className={LABEL}>Phone</span>
          <MultiValueField
            items={(contact.phones ?? []).map(p => ({ id: p.id, value: p.phone, label: p.label || 'mobile' }))}
            onSave={updated =>
              updateContact.mutate({ id: contactId, data: { phones: updated.map((p, i) => ({ phone: p.value, label: p.label, isPrimary: i === 0 })) } as any })
            }
            labelOptions={PHONE_LABELS}
            emptyPlaceholder="Add Phone..."
            inputPlaceholder="+1 (555) 000-0000"
          />
        </div>
      </div>

      {/* Birthday */}
      <div className="flex items-start gap-4 group">
        <Cake className="w-5 h-5 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 flex flex-col">
          <span className={LABEL}>Birthday</span>
          <BirthdayField value={contact.birthday} onSave={(val) => onUpdate('birthday', val)} />
        </div>
      </div>

      {/* Industry */}
      <div className="flex items-start gap-4 group">
        <Globe className="w-5 h-5 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 flex flex-col">
          <span className={LABEL}>Industry</span>
          <IndustryField value={contact.industry} onSave={(val) => onUpdate('industry', val)} />
        </div>
      </div>

      {/* Preferences */}
      <div className="flex items-start gap-4 group">
        <Coffee className="w-5 h-5 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 flex flex-col">
          <span className={LABEL}>Preferences</span>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {contact.preferences && contact.preferences.trim() ? (
              contact.preferences.split(',').map((s: string) => s.trim()).filter(Boolean).map((pref: string, idx: number) => (
                <div key={idx} className="group/pill w-fit flex items-center gap-1.5 text-xs font-bold py-1 px-2.5 rounded-full bg-surface-container text-on-surface-variant transition-all overflow-hidden">
                  <span className="whitespace-normal break-words">{pref}</span>
                  <button 
                    onClick={() => {
                      const newPrefs = contact.preferences!.split(',').map((s: string) => s.trim()).filter(Boolean);
                      newPrefs.splice(idx, 1);
                      onUpdate('preferences', newPrefs.join(', '));
                    }}
                    className="w-4 h-4 rounded-full text-on-surface-variant/40 hover:text-red-500 hover:bg-red-500/10 flex items-center justify-center transition-colors shrink-0 -mr-1"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))
            ) : (
               <span className="text-sm font-medium text-on-surface-variant opacity-50 italic">No preferences logged</span>
            )}
          </div>
          <input
            type="text"
            value={newPreference}
            onChange={(e) => setNewPreference(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newPreference.trim()) {
                e.preventDefault();
                const current = contact.preferences ? contact.preferences.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
                current.push(newPreference.trim());
                onUpdate('preferences', current.join(', '));
                setNewPreference('');
              }
            }}
            placeholder="Add Preference"
            className="mt-2 text-xs bg-transparent border-b border-surface-container-highest focus:border-primary outline-none py-1 placeholder-on-surface-variant/50 text-on-surface w-full max-w-[200px] transition-colors"
          />
        </div>
      </div>

      {/* Interests */}
      <div className="flex items-start gap-4 group">
        <Heart className="w-5 h-5 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 flex flex-col">
          <span className={LABEL}>Interests</span>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {contact.interests && contact.interests.length > 0 ? (
              contact.interests.map((interest: any) => (
                <div key={interest.id} className={cn(
                  "group/pill w-fit flex items-center gap-1.5 text-xs font-bold py-1 px-2.5 rounded-full transition-all overflow-hidden",
                  interest.isAiGenerated ? "bg-primary/10 text-primary border border-primary/20" : "bg-surface-container text-on-surface-variant border border-transparent"
                )}>
                  {!!interest.isAiGenerated && <Sparkles className="w-3 h-3 opacity-70 shrink-0" />}
                  <span className="whitespace-normal break-words">{interest.interest}</span>
                  <button 
                    onClick={() => handleRemoveInterest(interest.id)}
                    className="w-4 h-4 rounded-full text-on-surface-variant/40 hover:text-red-500 hover:bg-red-500/10 flex items-center justify-center transition-colors shrink-0 -mr-1"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))
            ) : (
              <span className="text-sm font-medium text-on-surface-variant opacity-50 italic">No interests logged</span>
            )}
          </div>
          <input
            type="text"
            value={newInterest}
            onChange={(e) => setNewInterest(e.target.value)}
            onKeyDown={handleAddInterest}
            placeholder="Add Interest"
            className="mt-2 text-xs bg-transparent border-b border-surface-container-highest focus:border-primary outline-none py-1 placeholder-on-surface-variant/50 text-on-surface w-full max-w-[200px] transition-colors"
          />
        </div>
      </div>
      
      {/* Follow-Up */}
      {contact.nextFollowUpAt && (
         <div className="flex items-start gap-4 group mt-6 pt-4">
           <Sparkles className="w-5 h-5 text-primary mt-0.5 shrink-0" />
           <div className="flex-1 min-w-0 flex flex-col">
             <span className={LABEL_PRIMARY}>Next Follow Up</span>
             <span className="text-sm font-bold text-on-surface">{new Date(contact.nextFollowUpAt).toLocaleString()}</span>
           </div>
         </div>
      )}
    </div>
  );
};
