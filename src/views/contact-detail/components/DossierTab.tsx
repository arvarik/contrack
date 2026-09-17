/**
 * DossierTab — The "Dossier" tab content showing AI-generated background
 * research, custom attributes, about section, work experience, and education.
 *
 * The briefing card sits at the top. A briefing is a read-before-you-meet
 * summary of the profile and the past notes, which is the same kind of
 * reading as the dossier under it.
 *
 * Extracted from ContactProfile to keep each section focused and readable.
 */
import React, { useId, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Briefcase,
  ChevronDown,
  FileText,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { motion } from "motion/react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";

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
import { parseBriefingPoints } from "../../../lib/safeParse";
import { SkeletonText } from "../../../components/ui/AnimatedSkeleton";

// ═══════════════════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════════════════

/** The `useGenerateBriefing()` mutation, or anything shaped like it. */
export interface BriefingMutation {
  mutate: (
    id: string,
    opts?: { onSuccess?: () => void; onError?: (err: Error) => void },
  ) => void;
  isPending: boolean;
}

export interface DossierTabProps {
  contact: Contact;
  /**
   * Writes a new briefing. Optional so the dossier can render on its own.
   * Without it the briefing card shows the saved points and no button.
   */
  generateBriefing?: BriefingMutation;
}

// ═══════════════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Shown when a contact has no dossier content at all.
 *
 * The tab previously rendered an empty container: every section is
 * conditional, so a contact nobody has researched produced a blank panel with
 * no indication of whether the feature was broken, still loading, or simply
 * had nothing to say. An empty state has to answer "what is missing and how do
 * I get it", and here the answer is a specific place to go.
 */
const EmptyDossier = ({ name }: { name: string }) => (
  <motion.div
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    className={cn(CARD, "flex flex-col items-center text-center gap-4 py-10")}
  >
    <span className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
      <FileText className="w-7 h-7" />
    </span>
    <div className="space-y-1.5 max-w-sm">
      <h3 className="font-bold text-on-surface">No dossier yet</h3>
      <p className="text-sm text-on-surface-variant text-pretty">
        The dossier collects background on {name}: what they do, where they have
        worked and studied, and anything else worth remembering. Contact
        enrichment researches that from the web and fills it in.
      </p>
    </div>
    <Link to="/settings/ai-search" className="btn-primary">
      <Sparkles className="w-4 h-4" />
      Enrich contacts
    </Link>
    <p className="text-xs text-on-surface-variant max-w-sm text-pretty">
      You can also fill any of this in by hand from the contact&rsquo;s details,
      or paste a bio into a note and let Contrack pull it apart.
    </p>
  </motion.div>
);

/** A briefing older than this is stale: the notes have likely moved on. */
const BRIEFING_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * The briefing: three points to read before a conversation.
 *
 * It was a sparkle button beside the company name that opened a modal. The
 * button had no label, and the modal covered the page the points were about.
 * Here it is a card at the top of the dossier. It has a labelled button, and
 * the points stay on screen while the person scrolls.
 */
function BriefingCard({
  contact,
  generateBriefing,
}: {
  contact: Contact;
  generateBriefing?: BriefingMutation;
}) {
  const headingId = useId();
  const [failed, setFailed] = useState(false);
  const pending = generateBriefing?.isPending ?? false;

  // The points of a briefing written in the last three days. An older one
  // counts as no briefing, so the card offers to write a new one.
  const points = useMemo(() => {
    if (!contact.aiBriefing || !contact.aiBriefingAt) return [];
    const age = Date.now() - new Date(contact.aiBriefingAt).getTime();
    if (age >= BRIEFING_MAX_AGE_MS) return [];
    return parseBriefingPoints(contact.aiBriefing);
  }, [contact.aiBriefing, contact.aiBriefingAt]);
  const hasBriefing = points.length > 0;

  const generate = () => {
    if (!generateBriefing || pending) return;
    setFailed(false);
    generateBriefing.mutate(contact.id, {
      onSuccess: () => setFailed(false),
      onError: () => setFailed(true),
    });
  };

  return (
    <section aria-labelledby={headingId} className={cn(CARD, "min-w-0")}>
      <h2 id={headingId} className={SECTION_HEADING_SPACED}>
        <Sparkles aria-hidden="true" className="w-4 h-4" /> Briefing
      </h2>
      <p className="text-sm text-on-surface-variant text-pretty">
        Three points to read before you talk: what you last discussed, what is
        still open, and something to open with.
      </p>

      {pending ? (
        <div className="mt-4">
          <SkeletonText lines={3} />
        </div>
      ) : (
        hasBriefing && (
          <ul className="mt-4 space-y-3">
            {points.map((point, index) => (
              <li key={index} className="flex gap-3">
                <span aria-hidden="true" className="text-primary font-bold">
                  •
                </span>
                <span className="text-sm leading-relaxed text-on-surface">
                  {point}
                </span>
              </li>
            ))}
          </ul>
        )
      )}

      {/* Always in the page, so a screen reader announces the text when it
          arrives. Empty, it takes no space. */}
      <p
        role="status"
        className="mt-3 empty:mt-0 text-sm font-medium text-on-surface-variant"
      >
        {pending ? "Writing the briefing…" : ""}
      </p>

      {failed && !pending && (
        <p role="alert" className="mt-3 text-sm font-medium text-error">
          Could not write the briefing. Check that AI is set up in Settings,
          then try again.
        </p>
      )}

      {(generateBriefing || (hasBriefing && !pending)) && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {hasBriefing && !pending && contact.aiBriefingAt && (
            <p className="text-xs text-on-surface-variant">
              Generated{" "}
              {formatDistanceToNow(new Date(contact.aiBriefingAt), {
                addSuffix: true,
              })}
            </p>
          )}
          {generateBriefing && (
            <button
              type="button"
              onClick={generate}
              disabled={pending}
              aria-busy={pending}
              className={cn(
                hasBriefing ? "btn-secondary" : "btn-primary",
                "ml-auto",
              )}
            >
              {hasBriefing ? (
                <>
                  <RefreshCw aria-hidden="true" className="w-4 h-4" />
                  Regenerate briefing
                </>
              ) : (
                <>
                  <Sparkles aria-hidden="true" className="w-4 h-4" />
                  Generate briefing
                </>
              )}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

const DossierTabInner: React.FC<DossierTabProps> = ({
  contact,
  generateBriefing,
}) => {
  // Every section below is conditional, so "nothing to show" needs answering
  // once, here, rather than as a blank space.
  const hasContent =
    !!contact.aiBackground ||
    !!contact.about ||
    (contact.attributes?.length ?? 0) > 0 ||
    (contact.experience?.length ?? 0) > 0 ||
    (contact.education?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-6">
      {/* First, and shown whether or not there is a dossier yet. */}
      <BriefingCard contact={contact} generateBriefing={generateBriefing} />
      {hasContent ? (
        <DossierContent contact={contact} />
      ) : (
        <EmptyDossier name={contact.name} />
      )}
    </div>
  );
};

/** Every dossier section that has something to show. */
const DossierContent = ({ contact }: { contact: Contact }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-6"
    >
      {contact.about && <AboutSection about={contact.about} />}
      {contact.aiBackground && (
        <details className={cn(CARD, "min-w-0")}>
          <summary className="hit-area cursor-pointer font-semibold text-sm text-primary">
            Research notes and sources
          </summary>
          <div className="mt-3 max-h-80 overflow-y-auto prose prose-sm max-w-none break-words text-on-surface-variant">
            <p className="text-xs not-prose mb-3">
              Review the source dates and contact identity before you use these
              details.
            </p>
            <ReactMarkdown
              skipHtml
              urlTransform={(url) => (/^https?:\/\//i.test(url) ? url : "")}
              components={{
                a: ({ children, href }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    {children}
                  </a>
                ),
                img: () => null,
              }}
            >
              {contact.aiBackground}
            </ReactMarkdown>
          </div>
        </details>
      )}

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
                  <span className="text-[11px] font-bold uppercase tracking-widest text-primary block mb-1">
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
          className="hit-area mt-2 text-[11px] uppercase font-bold text-primary flex items-center gap-1 hover:underline transition-colors"
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
