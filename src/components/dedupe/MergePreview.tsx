import React, { useMemo } from 'react';
import {
  Mail, Phone, Tag, Briefcase, Building, MapPin, Globe,
  MessageSquare, Shield, FileText, ArrowRight,
} from 'lucide-react';
import { motion } from 'motion/react';
import type { Contact } from '../../types';
import { cn } from '../../lib/utils';
import { CARD, TAG_PILL } from '../../lib/styles';

// =============================================================================
// MergePreview — Shows what the merged contact will look like
// =============================================================================

interface MergePreviewProps {
  primary: Contact;
  duplicates: Contact[];
}

/**
 * Simulates the server-side merge logic client-side to show a preview.
 * Follows the same scalar fill-forward + child record dedup strategy.
 */
export const MergePreview = ({ primary, duplicates }: MergePreviewProps) => {
  const preview = useMemo(() => {
    // Scalar fields: primary wins, duplicates fill empty slots
    const scalarFields = [
      'firstName', 'lastName', 'headline', 'role', 'company', 'location',
      'birthday', 'preferences', 'avatarUrl', 'about', 'pronouns',
      'industry', 'website',
    ] as const;

    const merged: Record<string, any> = { ...primary };
    for (const dup of duplicates) {
      for (const field of scalarFields) {
        if (!merged[field] && dup[field]) {
          merged[field] = dup[field];
        }
      }
    }

    // Merge child records (dedup by value)
    const seenEmails = new Set(primary.emails?.map(e => e.email.toLowerCase().trim()) ?? []);
    const allEmails = [...(primary.emails ?? [])];
    for (const dup of duplicates) {
      for (const e of dup.emails ?? []) {
        const norm = e.email.toLowerCase().trim();
        if (!seenEmails.has(norm)) {
          seenEmails.add(norm);
          allEmails.push({ ...e, _from: dup.name } as any);
        }
      }
    }

    const seenPhones = new Set(primary.phones?.map(p => p.phone.replace(/\D/g, '').slice(-10)) ?? []);
    const allPhones = [...(primary.phones ?? [])];
    for (const dup of duplicates) {
      for (const p of dup.phones ?? []) {
        const norm = p.phone.replace(/\D/g, '').slice(-10);
        if (!seenPhones.has(norm)) {
          seenPhones.add(norm);
          allPhones.push({ ...p, _from: dup.name } as any);
        }
      }
    }

    const seenTags = new Set(primary.tags?.map(t => t.tag.toLowerCase().trim()) ?? []);
    const allTags = [...(primary.tags ?? [])];
    for (const dup of duplicates) {
      for (const t of dup.tags ?? []) {
        const norm = t.tag.toLowerCase().trim();
        if (!seenTags.has(norm)) {
          seenTags.add(norm);
          allTags.push(t);
        }
      }
    }

    // Interaction count sum
    const totalInteractions = (primary.interactionCount ?? 0) +
      duplicates.reduce((acc, d) => acc + (d.interactionCount ?? 0), 0);

    return {
      ...merged,
      emails: allEmails,
      phones: allPhones,
      tags: allTags,
      interactionCount: totalInteractions,
    } as Contact & { interactionCount: number };
  }, [primary, duplicates]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Merge diagram */}
      <div className="flex items-center justify-center gap-3 flex-wrap">
        {duplicates.map((dup, i) => (
          <div key={dup.id} className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container-low rounded-full">
              <img
                src={dup.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(dup.name)}&mouth=default,smile,serious`}
                alt={dup.name}
                className="w-5 h-5 rounded-full object-cover"
              />
              <span className="text-xs font-bold text-on-surface-variant">{dup.name}</span>
            </div>
            <ArrowRight className="w-4 h-4 text-on-surface-variant/40" />
          </div>
        ))}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 rounded-full ring-2 ring-emerald-500/30">
          <img
            src={primary.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(primary.name)}&mouth=default,smile,serious`}
            alt={primary.name}
            className="w-5 h-5 rounded-full object-cover"
          />
          <span className="text-xs font-bold text-emerald-600">{primary.name}</span>
          <Shield className="w-3.5 h-3.5 text-emerald-500" />
        </div>
      </div>

      {/* Preview card */}
      <div className={cn(CARD, "space-y-5 ring-2 ring-primary/20")}>
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-primary">
          <Shield className="w-3.5 h-3.5" />
          Merge Preview — Final Result
        </div>

        {/* Avatar + Name */}
        <div className="flex items-center gap-4">
          <img
            src={preview.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(preview.name)}&mouth=default,smile,serious`}
            alt={preview.name}
            className="w-14 h-14 rounded-full object-cover bg-surface-container-high ring-2 ring-emerald-500/30"
          />
          <div>
            <div className="text-lg font-bold">{preview.name}</div>
            {preview.headline && (
              <div className="text-sm text-on-surface-variant italic">{preview.headline}</div>
            )}
          </div>
        </div>

        {/* Merged fields grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {preview.role && (
            <PreviewField icon={<Briefcase className="w-4 h-4" />} label="Role" value={preview.role} />
          )}
          {preview.company && (
            <PreviewField icon={<Building className="w-4 h-4" />} label="Company" value={preview.company} />
          )}
          {preview.location && (
            <PreviewField icon={<MapPin className="w-4 h-4" />} label="Location" value={preview.location} />
          )}
          {preview.industry && (
            <PreviewField icon={<Globe className="w-4 h-4" />} label="Industry" value={preview.industry} />
          )}
        </div>

        {/* Combined emails */}
        {preview.emails?.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              <Mail className="w-3.5 h-3.5" />
              Emails ({preview.emails.length})
            </div>
            <div className="space-y-1">
              {preview.emails.map((e: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-xs text-on-surface">{e.email}</span>
                  {e._from && (
                    <span className="text-[9px] bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded font-bold">
                      from {e._from}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Combined phones */}
        {preview.phones?.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              <Phone className="w-3.5 h-3.5" />
              Phones ({preview.phones.length})
            </div>
            <div className="space-y-1">
              {preview.phones.map((p: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-xs text-on-surface">{p.phone}</span>
                  {p._from && (
                    <span className="text-[9px] bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded font-bold">
                      from {p._from}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Combined tags */}
        {preview.tags?.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              <Tag className="w-3.5 h-3.5" />
              Tags ({preview.tags.length})
            </div>
            <div className="flex flex-wrap gap-1">
              {preview.tags.map((t, i) => (
                <span key={i} className={TAG_PILL}>{t.tag}</span>
              ))}
            </div>
          </div>
        )}

        {/* Interaction count */}
        {preview.interactionCount > 0 && (
          <div className="flex items-center gap-2 text-sm text-on-surface-variant">
            <MessageSquare className="w-4 h-4" />
            <span className="font-bold">{preview.interactionCount}</span> timeline entries will be merged
          </div>
        )}

        {/* About */}
        {preview.about && (
          <div className="text-xs text-on-surface-variant leading-relaxed p-3 bg-surface-container-low rounded-xl">
            <FileText className="w-3.5 h-3.5 inline mr-1 opacity-50" />
            {preview.about}
          </div>
        )}
      </div>
    </motion.div>
  );
};

const PreviewField = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) => (
  <div className="flex items-center gap-2.5">
    <span className="text-on-surface-variant/60 shrink-0">{icon}</span>
    <span className="text-on-surface-variant text-xs font-bold uppercase tracking-wider w-16 shrink-0">{label}</span>
    <span className="text-on-surface text-sm">{value}</span>
  </div>
);
