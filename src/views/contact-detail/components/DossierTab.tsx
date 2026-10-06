/**
 * The Dossier tab: the briefing, about, custom attributes, experience and
 * education, and last the research card, which says where the details above
 * came from.
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
  /** Opens the field for a detail that helps research ("Add a city"). */
  onAddDetail?: (anchor: ResearchAnchor) => void;
  /**
   * A "Catch me up" request from the palette, a new number each time. The
   * Briefing card answers it once, then calls `onBriefHandled`.
   */
  briefRequest?: number | null;
  onBriefHandled?: () => void;
}

/**
 * Empty state: no bio, work history, education or notes. It says how to
 * fill the dossier on this page: Enrich contact, or a city and an email in
 * Details and a link in the header. A note fills no field, so it does not
 * offer one.
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
 * The briefing: three points to read before a conversation. It is a card,
 * not a modal, so the points stay on screen beside the page they are about.
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
  // No model to write it: the button is disabled and says why.
  const blocked = useBlockedAi("briefings");
  const [failed, setFailed] = useState(false);
  const pending = generateBriefing?.isPending ?? false;

  // A stale briefing counts as none, so the card offers a new one.
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

  // "Catch me up": focus the card so a screen reader reads the briefing
  // next, and write one if there is none.
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
    // `tabIndex={-1}`: focus target for "Catch me up", not a Tab stop.
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

      {/* The live region is always in the page, so a screen reader announces
          new text. `empty:mt-0` would never match: the row always holds the
          `<p>`. The bird sits outside the `role="status"`, so it is not read
          in every announcement. */}
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
 * "Dec 2024" for an ISO month or day. Other text shows as written, and the
 * string "null" that some imports write is nothing.
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
 * Dec 2024", because a bare date reads as the start.
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

      {/* Enrichment writes these, so each name wears the AI color. */}
      {contact.attributes && contact.attributes.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {contact.attributes.map(
            (attr: { id: string; name: string; value: string }) => {
              // "favorite_coffee" reads "Favorite coffee".
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
                      {/* In full: a hover-to-expand clamp fails on touch. */}
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

/**
 * The contact's bio. The icon is neutral, not a sparkle: the sparkle means
 * "a model wrote this", and a bio need not be. Show more past ten lines.
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
        {/* The fade uses the card's surface, so the text reads as running on. */}
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
