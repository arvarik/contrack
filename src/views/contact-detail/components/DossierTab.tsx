/**
 * DossierTab — The "Dossier" tab content showing AI-generated background
 * research, custom attributes, about section, work experience, and education.
 *
 * Extracted from ContactProfile to keep each section focused and readable.
 */
import React, { useState } from "react";
import { Briefcase, ChevronDown, FileText, Sparkles } from "lucide-react";
import { motion } from "motion/react";

import type {
  Contact,
  ContactExperience,
  ContactEducation,
} from "../../../types";
import { cn } from "../../../lib/utils";
import {
  CARD,
  SECTION_HEADING_SPACED,
  STATUS_BADGE_SUCCESS,
} from "../../../lib/styles";

// ═══════════════════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════════════════

export interface DossierTabProps {
  contact: Contact;
}

// ═══════════════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════════════

const DossierTabInner: React.FC<DossierTabProps> = ({ contact }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-6"
    >
      {contact.about && <AboutSection about={contact.about} />}

      {/* AI Custom Attributes */}
      {contact.attributes && contact.attributes.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {contact.attributes.map(
            (attr: { id: string; name: string; value: string }) => {
              // Format attribute names: replace underscores/hyphens with spaces, title-case
              const displayName = attr.name
                .replace(/[_-]/g, " ")
                .replace(/\b\w/g, (c) => c.toUpperCase());
              return (
                <div
                  key={attr.id}
                  className="bg-surface-container-lowest rounded-xl p-4 shadow-sm"
                >
                  <span className="text-[10px] font-bold uppercase tracking-widest text-primary block mb-1">
                    {displayName}
                  </span>
                  <span className="text-sm text-on-surface leading-relaxed font-medium block">
                    {attr.value}
                  </span>
                </div>
              );
            },
          )}
        </div>
      )}

      {/* Experience & Education */}
      {((contact.experience?.length ?? 0) > 0 ||
        (contact.education?.length ?? 0) > 0) && (
        <div className="bg-surface-container-lowest rounded-2xl shadow-sm overflow-hidden">
          {contact.experience && contact.experience.length > 0 && (
            <div className="p-6 last:border-0 bg-surface-container-lowest">
              <h3 className={cn(SECTION_HEADING_SPACED, "mb-5")}>
                <Briefcase className="w-4 h-4" /> Experience Overview
              </h3>
              <div className="space-y-5">
                {contact.experience.map((exp: ContactExperience) => (
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
                      <p className="text-sm text-primary font-bold">
                        {exp.company}
                      </p>
                      <p className="text-xs text-on-surface-variant mb-1 font-medium">
                        {exp.startDate && exp.startDate !== "null"
                          ? exp.startDate
                          : ""}
                        {exp.endDate && exp.endDate !== "null"
                          ? ` – ${exp.endDate}`
                          : exp.isCurrent
                            ? " – Present"
                            : ""}
                        {exp.location && (
                          <span className="ml-2 opacity-60">
                            · {exp.location}
                          </span>
                        )}
                      </p>
                      {exp.description && (
                        <p className="text-xs text-on-surface-variant leading-relaxed line-clamp-2 hover:line-clamp-none mt-1">
                          {exp.description}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {contact.education && contact.education.length > 0 && (
            <div className="p-6">
              <h3 className={cn(SECTION_HEADING_SPACED, "mb-5")}>
                <FileText className="w-4 h-4" /> Education
              </h3>
              <div className="space-y-4">
                {contact.education.map((edu: ContactEducation) => (
                  <div key={edu.id} className="flex gap-4">
                    <div className="w-2 h-2 rounded-full ring-4 ring-primary/20 bg-primary mt-1.5 shrink-0" />
                    <div>
                      <p className="font-bold text-on-surface">{edu.school}</p>
                      <p className="text-sm text-on-surface-variant font-medium">
                        {edu.degree}
                        {edu.fieldOfStudy && (
                          <span className="opacity-70">
                            {" "}
                            · {edu.fieldOfStudy}
                          </span>
                        )}
                      </p>
                      {((edu.startDate && edu.startDate !== "null") ||
                        (edu.endDate && edu.endDate !== "null")) && (
                        <p className="text-xs text-on-surface-variant opacity-70 mt-0.5">
                          {edu.startDate && edu.startDate !== "null"
                            ? edu.startDate
                            : ""}
                          {edu.endDate && edu.endDate !== "null"
                            ? ` – ${edu.endDate}`
                            : ""}
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

export const DossierTab = React.memo(DossierTabInner);

// ─── AboutSection — click-to-expand replaces hover pattern ───────────────────

function AboutSection({ about }: { about: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsTruncation = about.length > 500;

  return (
    <div className={cn(CARD, "relative overflow-hidden")}>
      <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
      <h3 className={SECTION_HEADING_SPACED}>
        <Sparkles className="w-4 h-4 text-primary" /> About
      </h3>
      <div className="relative">
        <p
          className={cn(
            "whitespace-pre-wrap text-on-surface-variant text-sm leading-relaxed transition-all duration-300",
            !expanded && needsTruncation && "max-h-64 overflow-hidden",
          )}
        >
          {about}
        </p>
        {!expanded && needsTruncation && (
          <div className="absolute bottom-0 left-0 w-full h-12 bg-gradient-to-t from-surface-container-lowest to-transparent pointer-events-none" />
        )}
      </div>
      {needsTruncation && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2 text-[11px] uppercase font-bold text-primary flex items-center gap-1 hover:underline transition-colors"
        >
          {expanded ? "Show less" : "Show more"}
          <ChevronDown
            className={cn(
              "w-3.5 h-3.5 transition-transform duration-300",
              expanded && "rotate-180",
            )}
          />
        </button>
      )}
    </div>
  );
}
