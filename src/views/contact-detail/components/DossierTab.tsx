/**
 * DossierTab — The "Dossier" tab content showing AI-generated background
 * research, custom attributes, about section, work experience, and education.
 *
 * Extracted from ContactProfile to keep each section focused and readable.
 */
import React, { useState } from "react";
import { Briefcase, FileText, Sparkles, Edit2 } from "lucide-react";
import ReactMarkdown from 'react-markdown';
import { motion } from "motion/react";

import type { Contact } from "../../../types";
import { cn } from "../../../lib/utils";
import {
  CARD, SECTION_HEADING_SPACED, STATUS_BADGE_SUCCESS,
} from "../../../lib/styles";

// ═══════════════════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════════════════

export interface DossierTabProps {
  contact: Contact;
  contactId: string;
  updateContact: { mutate: (args: { id: string; data: any }) => void };
}

// ═══════════════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════════════

export const DossierTab: React.FC<DossierTabProps> = ({
  contact,
  contactId,
  updateContact,
}) => {
  const [isEditingDossier, setIsEditingDossier] = useState(false);
  const [dossierText, setDossierText] = useState('');

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6">
      {/* AI Dossier */}
      {(contact.aiBackground || isEditingDossier) && (
        <div className={cn(CARD, "bg-surface-container-lowest border-primary/20 relative overflow-hidden group")}>
          <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
          <div className="flex justify-between items-center mb-4">
            <h3 className={cn(SECTION_HEADING_SPACED, "text-primary flex items-center gap-2")}><Sparkles className="w-4 h-4" /> AI Dossier</h3>
            {!isEditingDossier && (
              <button onClick={() => { setDossierText(contact.aiBackground || ''); setIsEditingDossier(true); }} className="opacity-0 group-hover:opacity-100 text-on-surface-variant hover:text-primary transition-opacity p-1 bg-surface-container-low rounded-md shadow-sm border border-surface-container-highest">
                <Edit2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {isEditingDossier ? (
            <div className="flex flex-col gap-3">
              <textarea 
                value={dossierText} 
                onChange={e => setDossierText(e.target.value)} 
                className="w-full min-h-[300px] p-4 bg-surface-container-low rounded-xl border border-surface-container-highest focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm font-mono text-on-surface resize-y"
                autoFocus
              />
              <div className="flex justify-end gap-2 mt-1">
                <button onClick={() => setIsEditingDossier(false)} className="px-4 py-1.5 rounded-full text-xs font-bold text-on-surface-variant hover:bg-surface-container transition-colors">Cancel</button>
                <button onClick={() => { updateContact.mutate({ id: contactId, data: { aiBackground: dossierText } as any }); setIsEditingDossier(false); }} className="px-4 py-1.5 rounded-full text-xs font-bold bg-primary text-on-primary shadow shadow-primary/20 hover:shadow-md hover:shadow-primary/30 transition-all">Save Dossier</button>
              </div>
            </div>
          ) : (
            <div 
              onDoubleClick={() => { setDossierText(contact.aiBackground || ''); setIsEditingDossier(true); }}
              className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-a:text-primary cursor-text"
              title="Double click to edit"
            >
              <ReactMarkdown>{contact.aiBackground!}</ReactMarkdown>
            </div>
          )}
          {!isEditingDossier && contact.aiHydratedAt && (
             <p className="text-[10px] text-on-surface-variant mt-4 opacity-70">
               Sourced via web hydration on {new Date(contact.aiHydratedAt).toLocaleDateString()}
             </p>
          )}
        </div>
      )}
  
      {/* AI Custom Attributes */}
      {contact.attributes && contact.attributes.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {contact.attributes.map((attr: any) => (
            <div key={attr.id} className="bg-surface-container-lowest rounded-xl p-4 border border-surface-container-highest shadow-sm">
              <span className="text-[10px] font-bold uppercase tracking-widest text-primary block mb-1">{attr.name}</span>
              <span className="text-sm text-on-surface leading-relaxed font-medium block">{attr.value}</span>
            </div>
          ))}
        </div>
      )}
      
      {/* About */}
      {contact.about && (
        <div className={cn(CARD, "relative overflow-hidden group")}>
          <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
          <h3 className={SECTION_HEADING_SPACED}><Sparkles className="w-4 h-4 text-primary" /> About</h3>
          <p className="whitespace-pre-wrap text-on-surface-variant text-sm leading-relaxed max-h-32 overflow-hidden relative after:absolute after:bottom-0 after:left-0 after:w-full after:h-12 after:bg-gradient-to-t after:from-surface-container-lowest hover:max-h-full hover:after:opacity-0 transition-all">
            {contact.about}
          </p>
          <div className="text-center opacity-100 group-hover:opacity-0 text-[10px] uppercase font-bold text-primary mt-1 transition-opacity">Hover to expand</div>
        </div>
      )}

      {/* Experience & Education */}
      {((contact.experience?.length ?? 0) > 0 || (contact.education?.length ?? 0) > 0) && (
        <div className="bg-surface-container-lowest rounded-2xl shadow-sm overflow-hidden">
          {contact.experience && contact.experience.length > 0 && (
            <div className="p-6 last:border-0 bg-surface-container-lowest">
              <h3 className={cn(SECTION_HEADING_SPACED, "mb-5")}><Briefcase className="w-4 h-4" /> Experience Overview</h3>
              <div className="space-y-5">
                {contact.experience.map((exp: any) => (
                  <div key={exp.id} className="flex gap-4">
                    <div className="icon-container">
                       <Briefcase className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-bold text-on-surface flex items-center gap-2">
                        {exp.role}
                        {exp.isCurrent && (
                          <span className={STATUS_BADGE_SUCCESS}>Current</span>
                        )}
                      </p>
                      <p className="text-sm text-primary font-bold">{exp.company}</p>
                      <p className="text-xs text-on-surface-variant mb-1 font-medium">
                        {exp.startDate}{exp.endDate ? ` – ${exp.endDate}` : exp.isCurrent ? ' – Present' : ''}
                        {exp.location && <span className="ml-2 opacity-60">· {exp.location}</span>}
                      </p>
                      {exp.description && <p className="text-xs text-on-surface-variant leading-relaxed line-clamp-2 hover:line-clamp-none mt-1">{exp.description}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {contact.education && contact.education.length > 0 && (
            <div className="p-6">
              <h3 className={cn(SECTION_HEADING_SPACED, "mb-5")}><FileText className="w-4 h-4" /> Education</h3>
              <div className="space-y-4">
                {contact.education.map((edu: any) => (
                  <div key={edu.id} className="flex gap-4">
                    <div className="w-2 h-2 rounded-full ring-4 ring-primary/20 bg-primary mt-1.5 shrink-0" />
                    <div>
                      <p className="font-bold text-on-surface">{edu.school}</p>
                      <p className="text-sm text-on-surface-variant font-medium">
                        {edu.degree}
                        {edu.fieldOfStudy && <span className="opacity-70"> · {edu.fieldOfStudy}</span>}
                      </p>
                      {(edu.startDate || edu.endDate) && (
                        <p className="text-xs text-on-surface-variant opacity-70 mt-0.5">
                          {edu.startDate}{edu.endDate ? ` – ${edu.endDate}` : ''}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
};
