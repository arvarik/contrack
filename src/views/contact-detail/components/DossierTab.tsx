/**
 * DossierTab — The "Dossier" tab content: the briefing, the about section,
 * custom attributes, work experience and education, and last the research
 * that filled them in.
 *
 * The briefing card sits at the top. A briefing is a read-before-you-meet
 * summary of the profile and the past notes, which is the same kind of
 * reading as the dossier under it. The research card sits at the bottom: it
 * says where the details above came from, which a reader wants after the
 * details, not before them.
 *
 * Extracted from ContactProfile to keep each section focused and readable.
 */
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Briefcase,
  ChevronDown,
  FileText,
  RefreshCw,
  Sparkles,
  UserRound,
} from "lucide-react";
import { motion } from "motion/react";
import { formatDistanceToNow } from "date-fns";

import type {
  Contact,
  ContactExperience,
  ContactEducation,
} from "../../../types";
import { cn } from "../../../lib/utils";
import {
  CARD,
  LABEL,
  SECTION_HEADING_SPACED,
  STATUS_BADGE_SUCCESS,
} from "../../../lib/styles";
import { parseBriefingPoints } from "../../../lib/safeParse";
import { SkeletonText } from "../../../components/ui/AnimatedSkeleton";
import { CorvidThinking } from "../../../components/brand/CorvidThinking";
import { useAiAllowed } from "../../../hooks/useAiAllowed";
import { ResearchCard } from "./ResearchCard";
import { EnrichMenu } from "./EnrichMenu";
import { AiSetupNote } from "../../../components/AiSetupNote";
import { useBlockedAi } from "../../../hooks/useAiSetup";
import type { ResearchAnchor } from "../../../lib/research";

// ═══════════════════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════════════════

/** The `useGenerateBriefing()` mutation, or anything shaped like it. */
export interface BriefingMutation {
  mutate: (
    id: string,
    options?: { onSuccess?: () => void; onError?: () => void },
  ) => void;
  isPending: boolean;
}

interface DossierTabProps {
  contact: Contact;
  generateBriefing?: BriefingMutation;
  /**
   * Opens the field for a detail that helps research, when research found
   * no page: the Research card's "Add a city" and the rest.
   */
  onAddDetail?: (anchor: ResearchAnchor) => void;
  /**
   * A "Catch me up" request from the palette, a new number each time. The
   * Briefing card answers it once, then calls `onBriefHandled`.
   */
  briefRequest?: number | null;
  onBriefHandled?: () => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Empty state: a contact with no bio, no work history, no education, and no
 * notes to pull a dossier from.
 *
 * An empty state has to answer "what is missing and how do I get it". The
 * answer is here, not on another page: Enrich contact researches this
 * person at the depth chosen from its menu, and the progress panel opens.
 * It linked to the Enrichment settings page when that page was the only
 * place research could start. The hand-made path it names is the one the
 * page has: a city and an email in Details, and a link in the header. It
 * used to offer "paste a bio into a note", and a note fills no field.
 */
const EmptyDossier = ({ contact }: { contact: Contact }) => {
  const aiAllowed = useAiAllowed();
  const canEnrich = aiAllowed && !contact.isGhost;
  const research = useBlockedAi("research");
  const first = contact.firstName || contact.name.split(" ")[0];
  return (
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
          {canEnrich
            ? `Enrichment searches the web for ${first}\u2019s work, schools and profiles, and links each fact to its page`
            : "The dossier fills in from enrichment and imports. You can add a city, an email or a link by hand"}
        </p>
      </div>
      <EnrichMenu
        contact={contact}
        label="Enrich contact"
        variant="primaryLarge"
      />
      {canEnrich && research && <AiSetupNote setup={research} />}
      {canEnrich && (
        <p className="text-xs text-on-surface-variant max-w-sm text-pretty">
          Or add a city, an email or a link by hand
        </p>
      )}
    </motion.div>
  );
};

/** A briefing older than this is stale: the notes have likely moved on. */
const BRIEFING_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * The briefing: three points to read before a conversation.
 *
 * It was a sparkle button beside the company name that opened a modal. The
 * button had no label, and the modal covered the page the points were about.
 * Here it is a card at the top of the dossier. It has a labeled button, and
 * the points stay on screen while the person scrolls.
 */
function BriefingCard({
  contact,
  generateBriefing,
  briefRequest,
  onBriefHandled,
}: {
  contact: Contact;
  generateBriefing?: BriefingMutation;
  briefRequest?: number | null;
  onBriefHandled?: () => void;
}) {
  const headingId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  /** The request answered last. StrictMode runs a mount effect twice. */
  const answeredRef = useRef<number | null>(null);
  const aiAllowed = useAiAllowed();
  // No model to write it: the button waits and says why, where it looked
  // ready and then failed.
  const blocked = useBlockedAi("briefings");
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
    if (!generateBriefing || pending || !aiAllowed || blocked) return;
    setFailed(false);
    generateBriefing.mutate(contact.id, {
      onSuccess: () => setFailed(false),
      onError: () => setFailed(true),
    });
  };

  // "Catch me up" from the palette: bring the card into view and give it
  // focus, so a screen reader reads the briefing next. With no recent
  // briefing, and AI on, write one: that is what the person asked for.
  useEffect(() => {
    if (!briefRequest || answeredRef.current === briefRequest) return;
    answeredRef.current = briefRequest;
    const card = sectionRef.current;
    card?.scrollIntoView?.({ block: "nearest" });
    card?.focus({ preventScroll: true });
    if (!hasBriefing) generate();
    onBriefHandled?.();
    // Once per request: `generate` and `hasBriefing` are read as they are now.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briefRequest]);

  return (
    // `tabIndex={-1}` lets focus land here for "Catch me up" without adding
    // a Tab stop. No ring: it is a place, not a control.
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-labelledby={headingId}
      className={cn(CARD, "min-w-0 outline-none")}
    >
      <h2 id={headingId} className={SECTION_HEADING_SPACED}>
        <Sparkles aria-hidden="true" className="w-4 h-4" /> Briefing
      </h2>
      <p className="text-sm text-on-surface-variant text-pretty">
        Three points to read before you talk: what you last discussed, what is
        still open, and something to open with
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
                {/* A model wrote the points, so the bullet is the AI color. */}
                <span aria-hidden="true" className="text-ai font-bold">
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
          arrives. The margin is conditional rather than `empty:mt-0`: the
          row always holds the `<p>` element, so `:empty` never matches it
          and the gap would never collapse.

          The bird sits beside the live region rather than inside it: a named
          image within a `role="status"` would be read out as part of every
          announcement. It is decorative here, because the sentence next to it
          already says what is happening. */}
      <div className={cn("flex items-center gap-2", pending && "mt-3")}>
        {pending && (
          <CorvidThinking decorative size={20} className="shrink-0" />
        )}
        <p
          role="status"
          className="text-sm font-medium text-on-surface-variant"
        >
          {pending ? "Writing the briefing…" : ""}
        </p>
      </div>

      {failed && !pending && (
        <p role="alert" className="mt-3 text-sm font-medium text-error">
          Could not write the briefing. Try again
        </p>
      )}

      {((generateBriefing && aiAllowed) || (hasBriefing && !pending)) && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {hasBriefing && !pending && contact.aiBriefingAt && (
            <p className="text-xs text-on-surface-variant">
              Generated{" "}
              {formatDistanceToNow(new Date(contact.aiBriefingAt), {
                addSuffix: true,
              })}
            </p>
          )}
          {generateBriefing && aiAllowed && (
            <button
              type="button"
              onClick={generate}
              disabled={pending || !!blocked}
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
      {generateBriefing && aiAllowed && blocked && (
        <div className="mt-2 flex justify-end">
          <AiSetupNote setup={blocked} />
        </div>
      )}
    </section>
  );
}

const DossierTabInner: React.FC<DossierTabProps> = ({
  contact,
  generateBriefing,
  onAddDetail,
  briefRequest,
  onBriefHandled,
}) => {
  // Every section below is conditional, so "nothing to show" needs answering
  // once, here, rather than as a blank space.
  const hasContent =
    !!contact.aiBackground ||
    !!contact.aiResearch ||
    !!contact.aiHydratedAt ||
    !!contact.about ||
    (contact.attributes?.length ?? 0) > 0 ||
    (contact.experience?.length ?? 0) > 0 ||
    (contact.education?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-6">
      {/* First, and shown whether or not there is a dossier yet. */}
      <BriefingCard
        contact={contact}
        generateBriefing={generateBriefing}
        briefRequest={briefRequest}
        onBriefHandled={onBriefHandled}
      />
      {hasContent ? (
        <DossierContent contact={contact} onAddDetail={onAddDetail} />
      ) : (
        <EmptyDossier contact={contact} />
      )}
    </div>
  );
};

/** The known parts, joined: "BSc · Physics". */
const metaLine = (
  first: string | null,
  second: string | null,
  separator = " · ",
): string => [first, second].filter(Boolean).join(separator);

/**
 * "Dec 2024" for an ISO month or day. An import keeps a date as it found
 * it, so other text shows as written, and the "null" some imports wrote is
 * nothing. The raw "2024-12-07" read as a database field.
 */
function monthOf(value: string | null | undefined): string | null {
  if (!value || value === "null") return null;
  const iso = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(value);
  return iso
    ? new Date(Number(iso[1]), Number(iso[2]) - 1).toLocaleDateString(
        undefined,
        { month: "short", year: "numeric" },
      )
    : value;
}

/**
 * "Dec 2024 – Present", or whichever end is known. An end alone is "Until
 * Dec 2024": printed bare, it read as the start.
 */
const dateSpan = (
  start: string | null,
  end: string | null,
  current = false,
): string => {
  const from = monthOf(start);
  const to = monthOf(end);
  if (!from && to) return `Until ${to}`;
  return metaLine(from, to ?? (current ? "Present" : null), " – ");
};

/** Every dossier section that has something to show. */
const DossierContent = ({
  contact,
  onAddDetail,
}: {
  contact: Contact;
  onAddDetail?: (anchor: ResearchAnchor) => void;
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-6"
    >
      {contact.about && <AboutSection about={contact.about} />}

      {/* AI custom attributes. Enrichment writes them, so each name wears
          the AI color. */}
      {contact.attributes && contact.attributes.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {contact.attributes.map(
            (attr: { id: string; name: string; value: string }) => {
              // "favorite_coffee" reads "Favorite coffee": spaces for the
              // underscores and hyphens, and sentence case.
              const displayName = attr.name
                .replace(/[_-]/g, " ")
                .replace(/^\w/, (c) => c.toUpperCase());
              return (
                <div key={attr.id} className={cn(CARD, "p-4")}>
                  <span className={cn(LABEL, "text-ai block mb-1")}>
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
        <div className={cn(CARD, "p-0 overflow-hidden")}>
          {contact.experience && contact.experience.length > 0 && (
            <div className="p-6">
              <h3 className={cn(SECTION_HEADING_SPACED, "mb-5")}>
                <Briefcase className="w-4 h-4" /> Experience overview
              </h3>
              <div className="space-y-5">
                {contact.experience.map((exp: ContactExperience) => (
                  <div key={exp.id} className="flex gap-4">
                    <div className="w-10 h-10 rounded-xl bg-surface-container-low flex items-center justify-center shrink-0 shadow-xs">
                      <Briefcase className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-bold text-on-surface flex items-center gap-2">
                        {exp.role}
                        {exp.isCurrent && (
                          <span className={STATUS_BADGE_SUCCESS}>Current</span>
                        )}
                      </p>
                      {/* The ink, not the primary: the name is no link. */}
                      <p className="text-sm text-on-surface">{exp.company}</p>
                      <p className="text-xs text-on-surface-variant mb-1 font-medium">
                        {metaLine(
                          dateSpan(exp.startDate, exp.endDate, exp.isCurrent),
                          exp.location,
                        )}
                      </p>
                      {/* All of it. Two lines that opened on hover could
                          not be read with a finger. */}
                      {exp.description && (
                        <p className="text-xs text-on-surface-variant leading-relaxed mt-1">
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
                        {metaLine(edu.degree, edu.fieldOfStudy)}
                      </p>
                      {dateSpan(edu.startDate, edu.endDate) && (
                        <p className="text-xs text-on-surface-variant mt-0.5">
                          {dateSpan(edu.startDate, edu.endDate)}
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

      {/* Last: where the details above came from. */}
      <ResearchCard contact={contact} onAddDetail={onAddDetail} />
    </motion.div>
  );
};

export const DossierTab = React.memo(DossierTabInner);

// ─── AboutSection ────────────────────────────────────────────────────────────

/**
 * The contact's bio, as a card like Briefing, Experience and Education.
 *
 * It had a 4 px primary bar down its left edge and a sparkle in its heading.
 * No other card wears a bar, and in this design the sparkle means "a model
 * wrote this", which a bio need not be. So the card is plain: a heading with
 * a neutral icon, the text at a readable measure, and Show more when the
 * text runs past about ten lines.
 */
function AboutSection({ about }: { about: string }) {
  const headingId = useId();
  const [expanded, setExpanded] = useState(false);
  const needsTruncation = about.length > 500;
  const collapsed = needsTruncation && !expanded;

  return (
    <section aria-labelledby={headingId} className={cn(CARD, "min-w-0")}>
      <h3 id={headingId} className={SECTION_HEADING_SPACED}>
        <UserRound aria-hidden="true" className="w-4 h-4" /> About
      </h3>
      <div className="relative">
        <p
          className={cn(
            "max-w-prose text-sm leading-relaxed text-on-surface whitespace-pre-wrap",
            // Ten lines, in the paragraph's own line height.
            collapsed && "max-h-[10lh] overflow-hidden",
          )}
        >
          {about}
        </p>
        {/* The fade is the card's own surface, so the cut reads as the
            text running on, not as a box drawn over it. */}
        {collapsed && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-surface-container-lowest to-transparent"
          />
        )}
      </div>
      {needsTruncation && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className="hit-area state-layer mt-3 -mx-1.5 inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-sm font-semibold text-primary transition-colors"
        >
          {expanded ? "Show less" : "Show more"}
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "w-4 h-4 transition-transform duration-(--dur-slow)",
              expanded && "rotate-180",
            )}
          />
        </button>
      )}
    </section>
  );
}
