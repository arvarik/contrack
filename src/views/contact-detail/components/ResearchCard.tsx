/**
 * ResearchCard — what enrichment read about a contact, and what it added.
 *
 * The last card of the dossier. The research used to sit in the middle of
 * the tab as "Research notes and sources": a closed disclosure with its own
 * 320 px scroll, holding a copy of the about, career and education cards and
 * its sources as "Source 1" links to Google redirects. Here the fields stay
 * in their own cards above, and this card holds what only it can say:
 *
 *   - each enrichment, when, at which depth, with which model, and what it
 *     added
 *   - the facts the latest one reported, each beside the page it came from
 *   - every page the research cited, by site and address
 *
 * Enrich again opens the two research depths (`EnrichMenu`). Each run in
 * the history has a menu with "Not {name}", for a search that found
 * someone else with the same name: it takes back what the run added and
 * leaves its pages out of later runs (`rejectResearchRun`). When the latest
 * research found no page, found little, or was taken back, the card says
 * what it searched with and offers the details that would help it, a
 * school and a former name typed right here (`ResearchNextSteps`).
 * It reads `contact.aiResearch` (shared/researchRecord.ts), which only the
 * enrichment merge and "Not this person" write.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  ExternalLink,
  Globe,
  GraduationCap,
  Link as LinkIcon,
  Loader2,
  Mail,
  MapPin,
  MoreHorizontal,
  Search,
  SearchX,
  Sparkles,
  UserRound,
  UserSearch,
  UserX,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

import type { Contact } from "../../../types";
import { cn, safeHref } from "../../../lib/utils";
import {
  CARD,
  FIELD_LABEL,
  FORM_INPUT,
  FORM_LABEL,
  SECTION_HEADING_SPACED,
} from "../../../lib/styles";
import { ActionMenu } from "../../../components/ui/ActionMenu";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { useRejectResearchRun, useUpdateContact } from "../../../api/contacts";
import {
  isEnriching,
  useOptionalAISearch,
} from "../../../contexts/AISearchContext";
import { FORMER_NAME_ATTRIBUTE } from "../../../../shared/researchIdentity";
import { DEPTH_WORDS } from "../../../lib/researchDepth";
import { EnrichMenu, useCanEnrich } from "./EnrichMenu";
import { AiSetupNote } from "../../../components/AiSetupNote";
import { useBlockedAi } from "../../../hooks/useAiSetup";
import {
  parseResearchRecord,
  sourceForSite,
  type ResearchRun,
  type ResearchSource,
} from "../../../../shared/researchRecord";
import {
  addedInWords,
  listInWords,
  missingAnchors,
  modelName,
  nextStepReason,
  researchedWith,
  runSummary,
  sourceDisplay,
  type NextStepReason,
  type ResearchAnchor,
} from "../../../lib/research";

/** Findings shown before "Show all". */
const FINDINGS_SHOWN = 8;
/** Sources shown before "Show all". */
const SOURCES_SHOWN = 8;

/**
 * "Sep 26, 3:21 PM" in the reader's own format, with the year when it is
 * not this one, or the raw value when it is no date.
 */
function when(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(date.getFullYear() !== new Date().getFullYear() && {
      year: "numeric",
    }),
  });
}

/** The site's icon from the logo proxy, or a globe when it has none. */
function SiteIcon({ site }: { site: string }) {
  const [failed, setFailed] = useState(false);
  if (failed || !/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(site))
    return (
      <span className="w-6 h-6 rounded-md bg-surface-container-low flex items-center justify-center shrink-0">
        <Globe
          aria-hidden="true"
          className="w-3.5 h-3.5 text-on-surface-variant"
        />
      </span>
    );
  return (
    <img
      src={`/api/logos/${site}`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="w-6 h-6 rounded-md bg-surface-container-low object-contain p-0.5 shrink-0"
    />
  );
}

/**
 * One cited page: its icon, its title or address, and where it lives.
 *
 * The record only keeps http and https addresses (shared/researchRecord.ts),
 * and `safeHref` checks again here, like every other external link in the
 * app: the address came from a provider, not from the person.
 */
function SourceLink({ source }: { source: ResearchSource }) {
  const { title, site, trail } = sourceDisplay(source);
  return (
    <a
      href={safeHref(source.url)}
      target="_blank"
      rel="noopener noreferrer"
      className="hit-area state-layer -mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors"
    >
      <SiteIcon site={site} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-on-surface">
          {title}
        </span>
        {title !== trail && (
          <span className="block truncate text-xs text-on-surface-variant">
            {trail}
          </span>
        )}
      </span>
      <ExternalLink
        aria-hidden="true"
        className="w-3.5 h-3.5 shrink-0 text-on-surface-variant"
      />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** "Show all 23" and back, for a list cut to its first entries. */
function ShowAll({
  expanded,
  total,
  onToggle,
  controls,
}: {
  expanded: boolean;
  total: number;
  onToggle: () => void;
  controls: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
      className="hit-area state-layer mt-2 -mx-1.5 rounded-lg px-1.5 py-0.5 text-sm font-semibold text-primary transition-colors"
    >
      {expanded ? "Show fewer" : `Show all ${total}`}
    </button>
  );
}

/** Each detail's button: its words and its glyph. */
const ANCHOR_BUTTONS: Record<
  ResearchAnchor,
  { label: string; another?: string; icon: LucideIcon }
> = {
  school: { label: "Add a school", icon: GraduationCap },
  city: { label: "Add a city", icon: MapPin },
  formerName: { label: "Add a former name", icon: UserRound },
  workEmail: { label: "Add a work email", icon: Mail },
  link: { label: "Add a link", another: "Add another link", icon: LinkIcon },
};

/**
 * The details the card takes itself, because the page has no field for
 * them, and their field's words. The rest open their field on the page.
 */
const INLINE_FIELDS = {
  school: {
    label: "School",
    placeholder: "University of Example",
    hint: "A school they went to, as pages would name it",
  },
  formerName: {
    label: "Former name",
    placeholder: "Rowan Ellis",
    hint: "A name they went by before, such as a maiden name",
  },
} as const;

type InlineAnchor = keyof typeof INLINE_FIELDS;

const isInline = (anchor: ResearchAnchor): anchor is InlineAnchor =>
  anchor in INLINE_FIELDS;

/**
 * Detail buttons shown at once: one row in the dossier's column. The next
 * one shows as one is filled.
 */
const ANCHORS_SHOWN = 3;

/** Each reason's heading and glyph. */
const REASONS: Record<
  NextStepReason,
  { title: (first: string) => string; icon: LucideIcon }
> = {
  "no-page": {
    title: (first) => `No web page matched ${first}`,
    icon: SearchX,
  },
  thin: {
    title: (first) => `Research found little about ${first}`,
    icon: Search,
  },
  rejected: {
    title: (first) => `Help research find the right ${first}`,
    icon: UserSearch,
  },
};

/**
 * One detail, typed in the card: a school or a former name. Enter saves,
 * and Escape closes the field and gives focus back to its button.
 */
function DetailForm({
  anchor,
  busy,
  searches,
  onSave,
  onCancel,
}: {
  anchor: InlineAnchor;
  busy: boolean;
  /** Saving starts a search too, and the button says so. */
  searches: boolean;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const inputId = useId();
  const hintId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const field = INLINE_FIELDS[anchor];
  const text = value.trim();
  useEffect(() => input.current?.focus(), []);
  return (
    <form
      className="mt-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (text && !busy) onSave(text);
      }}
    >
      <label htmlFor={inputId} className={FORM_LABEL}>
        {field.label}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="sm:flex-1">
          <input
            ref={input}
            id={inputId}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || busy) return;
              event.preventDefault();
              event.stopPropagation();
              onCancel();
            }}
            maxLength={100}
            autoComplete="off"
            placeholder={field.placeholder}
            aria-describedby={hintId}
            disabled={busy}
            className={FORM_INPUT}
          />
          <p id={hintId} className="mt-1.5 text-xs text-on-surface-variant">
            {field.hint}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={!text || busy}
            className="btn-primary flex-1 sm:flex-none"
          >
            {busy && (
              <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />
            )}
            {searches ? "Save and search" : "Save"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn-secondary"
          >
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}

/**
 * What to do when the latest research came back empty, came back thin, or
 * found someone else (`nextStepReason`): what it searched with, and the
 * details that would help it, each a button.
 *
 * A page counts only when it names the person with a detail the records
 * have, so one more detail is what a retry needs. A school and a former
 * name are typed here, and saving one searches again at once, at the depth
 * the last search ran. A city, a work email and a link open their field on
 * the page (`onAddDetail`), and once one is added, Search again appears
 * here. After "Not this person", Search again is offered at once: later
 * searches leave out the pages it took back.
 *
 * While research runs for the contact, the panel says so instead.
 */
function ResearchNextSteps({
  contact,
  lastRun,
  reason,
  focusHeading,
  onAddDetail,
}: {
  contact: Contact;
  lastRun: ResearchRun;
  reason: NextStepReason;
  /** Take focus on arrival: the run whose menu had it was just taken back. */
  focusHeading: boolean;
  onAddDetail?: (anchor: ResearchAnchor) => void;
}) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const chips = useRef<Partial<Record<ResearchAnchor, HTMLButtonElement>>>({});
  const first = contact.firstName || contact.name.split(" ")[0];
  const used = researchedWith(contact);
  const missing = missingAnchors(contact).filter(
    (anchor) => isInline(anchor) || !!onAddDetail,
  );
  // What was missing when this run's panel first showed: a detail added
  // since is one the next search has and this one did not. The card keys
  // the panel by run, so a new run starts over.
  const [missingAtFirst] = useState(missing);
  const added = missingAtFirst.some((anchor) => !missing.includes(anchor));
  const search = useOptionalAISearch();
  const canEnrich = useCanEnrich(contact);
  const enriching = !!search && isEnriching(search, contact.id);
  const update = useUpdateContact();
  const [form, setForm] = useState<InlineAnchor | null>(null);
  const deepNext = lastRun.depth !== "deep";
  const hasLink = (contact.socialLinks?.length ?? 0) > 0;
  const { title, icon: Icon } = REASONS[reason];

  useEffect(() => {
    if (focusHeading) heading.current?.focus();
  }, [focusHeading]);

  const searchAgain = () =>
    search?.startSearch([contact.id], {
      limitAs: "toast",
      depth: lastRun.depth ?? "standard",
    });
  const closeForm = (anchor: InlineAnchor) => {
    setForm(null);
    // Back to the button that opened the field, after it renders again.
    requestAnimationFrame(() => chips.current[anchor]?.focus());
  };
  const save = (anchor: InlineAnchor, text: string) =>
    update.mutate(
      {
        id: contact.id,
        data:
          anchor === "school"
            ? {
                education: [
                  ...(contact.education ?? []).map(
                    ({
                      school,
                      degree,
                      fieldOfStudy,
                      startDate,
                      endDate,
                      description,
                    }) => ({
                      school,
                      degree,
                      fieldOfStudy,
                      startDate,
                      endDate,
                      description,
                    }),
                  ),
                  { school: text },
                ],
              }
            : {
                attributes: [
                  ...(contact.attributes ?? []).map(({ name, value }) => ({
                    name,
                    value,
                  })),
                  { name: FORMER_NAME_ATTRIBUTE, value: text },
                ],
              },
      },
      {
        onSuccess: () => {
          setForm(null);
          if (canEnrich) searchAgain();
          else
            toast.success(
              anchor === "school"
                ? "Added the school"
                : "Added the former name",
            );
        },
      },
    );

  // With nothing to add, a no-match still says what would help.
  const closing =
    reason === "no-page" && missing.length === 0
      ? deepNext && canEnrich
        ? "Choose Enrich again, then Deep, for a longer search"
        : "A page about them may not exist yet"
      : null;
  const offerSearch = canEnrich && !form && (reason === "rejected" || added);

  return (
    <section
      aria-labelledby={headingId}
      className="mt-5 rounded-xl bg-surface-container-low p-4"
    >
      <h3
        ref={heading}
        id={headingId}
        tabIndex={-1}
        className="flex items-center gap-2 text-sm font-bold text-on-surface"
      >
        <Icon
          aria-hidden="true"
          className="w-4 h-4 shrink-0 text-on-surface-variant"
        />
        {title(first)}
      </h3>
      <p className="mt-1 text-sm text-on-surface-variant text-pretty">
        {reason === "rejected"
          ? "Later searches leave out the pages of the search you took back"
          : used.length > 0
            ? `Research searched with ${listInWords([`${first}’s name`, ...used])}`
            : `Research searched with ${first}’s name alone`}
      </p>

      {enriching ? (
        <p
          role="status"
          className="mt-3 flex items-center gap-2 text-sm font-medium text-on-surface"
        >
          <Loader2
            aria-hidden="true"
            className="w-4 h-4 shrink-0 animate-spin text-primary"
          />
          Searching again
        </p>
      ) : (
        <>
          {offerSearch && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <button
                type="button"
                onClick={searchAgain}
                className="btn-primary btn-sm"
              >
                <Sparkles aria-hidden="true" className="w-3.5 h-3.5" />
                Search again
              </button>
              <span className="text-xs text-on-surface-variant text-pretty">
                {added
                  ? "With the details you added"
                  : "Without the pages you took back"}
              </span>
            </div>
          )}
          {form ? (
            <DetailForm
              anchor={form}
              busy={update.isPending}
              searches={canEnrich}
              onSave={(text) => save(form, text)}
              onCancel={() => closeForm(form)}
            />
          ) : (
            missing.length > 0 && (
              <>
                <p className="mt-3 text-sm text-on-surface text-pretty">
                  One more detail helps it find the right person
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {missing.slice(0, ANCHORS_SHOWN).map((anchor) => {
                    const {
                      label,
                      another,
                      icon: AnchorIcon,
                    } = ANCHOR_BUTTONS[anchor];
                    return (
                      <button
                        key={anchor}
                        ref={(element) => {
                          if (element) chips.current[anchor] = element;
                        }}
                        type="button"
                        onClick={() =>
                          isInline(anchor)
                            ? setForm(anchor)
                            : onAddDetail?.(anchor)
                        }
                        className="btn-secondary btn-sm"
                      >
                        <AnchorIcon
                          aria-hidden="true"
                          className="w-3.5 h-3.5"
                        />
                        {another && hasLink ? another : label}
                      </button>
                    );
                  })}
                </div>
              </>
            )
          )}
        </>
      )}
      {closing && (
        <p className="mt-3 text-xs text-on-surface-variant text-pretty">
          {closing}
        </p>
      )}
    </section>
  );
}

export function ResearchCard({
  contact,
  onAddDetail,
}: {
  contact: Contact;
  /** Opens the field for a detail that helps research: see `NoPageNextSteps`. */
  onAddDetail?: (anchor: ResearchAnchor) => void;
}) {
  const headingId = useId();
  // Enrich again waits without a model or web search, and says why here, as
  // the empty dossier's Enrich contact does.
  const blocked = useBlockedAi("research");
  const canEnrich = useCanEnrich(contact);
  const findingsId = useId();
  const sourcesId = useId();
  const [allFindings, setAllFindings] = useState(false);
  const [allSources, setAllSources] = useState(false);
  const [rejecting, setRejecting] = useState<ResearchRun | null>(null);
  // The run just taken back, for focus: its menu is gone.
  const [takenBack, setTakenBack] = useState<string | null>(null);
  const historyHeading = useRef<HTMLHeadingElement>(null);
  const reject = useRejectResearchRun();
  const first = contact.firstName || contact.name.split(" ")[0];

  const record = useMemo(
    () => parseResearchRecord(contact.aiResearch),
    [contact.aiResearch],
  );
  // Notes that came from somewhere other than an enrichment: an import, or
  // the API. They are the reader's own, so they are shown as written.
  const notes = contact.aiBackground || null;
  const runs = record?.runs ?? [];
  const sources = record?.sources ?? [];
  // The facts of every run that kept them (the latest two), newest first,
  // each once. A second run that found one new fact still shows the first
  // run's facts under it.
  const findings = useMemo(() => {
    const seen = new Set<string>();
    return [...(record?.runs ?? [])].reverse().flatMap((run) =>
      run.findings.filter((finding) => {
        const key = `${finding.topic}|${finding.text}`.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    );
  }, [record]);
  const researched = runs.length > 0 || !!contact.aiHydratedAt;
  /** What a run added that the record ties to it, and the pages it found. */
  const addedBy = (run: ResearchRun) =>
    (record?.addedEntries ?? []).filter((entry) => entry.at === run.at).length;
  const pagesOf = (run: ResearchRun) =>
    sources.filter((source) => source.firstSeenAt === run.at).length;
  // A run from before research tied what it added to the run cannot take
  // it back, so it is not offered. A run that added nothing can still have
  // its pages left out. Archived contacts and ghosts are not researched.
  const canReject = (run: ResearchRun) =>
    !run.rejected &&
    run.models.length > 0 &&
    !contact.isArchived &&
    !contact.isGhost &&
    (addedBy(run) > 0 || (run.added.length === 0 && pagesOf(run) > 0));
  const reason = nextStepReason(runs);
  const lastRun = runs.at(-1);
  const showNextSteps =
    !!lastRun &&
    !!reason &&
    (reason !== "thin" ||
      missingAnchors(contact).some(
        (anchor) =>
          anchor === "school" || anchor === "formerName" || !!onAddDetail,
      ));

  if (!researched && !notes) return null;

  const last = runs[runs.length - 1]?.at ?? contact.aiHydratedAt ?? null;
  const count = Math.max(runs.length, researched ? 1 : 0);
  // "Enriched 2 times · last 7 minutes ago · 6 web pages", as a meta line.
  const summary = [
    researched ? `Enriched ${count === 1 ? "once" : `${count} times`}` : null,
    researched && last
      ? `last ${formatDistanceToNow(new Date(last), { addSuffix: true })}`
      : null,
    sources.length > 0
      ? `${sources.length} web page${sources.length === 1 ? "" : "s"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section aria-labelledby={headingId} className={cn(CARD, "min-w-0")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className={SECTION_HEADING_SPACED}>
            <Globe aria-hidden="true" className="w-4 h-4" /> Research
          </h2>
          {summary && (
            <p className="text-sm text-on-surface text-pretty">{summary}</p>
          )}
          {/* Only when there is a page to check a detail against. */}
          {(findings.length > 0 || sources.length > 0) && (
            <p className="mt-1 text-sm text-on-surface-variant text-pretty">
              Check a detail against its page before you rely on it
            </p>
          )}
        </div>
        <EnrichMenu
          contact={contact}
          label="Enrich again"
          variant="secondary"
          className="shrink-0"
        />
      </div>
      {canEnrich && blocked && <AiSetupNote setup={blocked} className="mt-2" />}

      {showNextSteps && (
        <ResearchNextSteps
          key={lastRun.at}
          contact={contact}
          lastRun={lastRun}
          reason={reason}
          focusHeading={takenBack === lastRun.at}
          onAddDetail={onAddDetail}
        />
      )}

      {runs.length > 0 && (
        <div className="mt-5">
          <h3 ref={historyHeading} tabIndex={-1} className={FIELD_LABEL}>
            History
          </h3>
          <ol className="mt-2 space-y-2">
            {[...runs].reverse().map((run, index) => (
              <li
                key={`${run.at}-${index}`}
                className="flex items-start gap-2 text-sm"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:gap-4">
                  {/* When, how deep and with what, in one column; what it
                    did beside. */}
                  <span className="shrink-0 sm:w-48">
                    <time
                      dateTime={run.at}
                      className="block tabular-nums text-on-surface-variant"
                    >
                      {when(run.at)}
                    </time>
                    {(run.depth || run.models[0]) && (
                      <span className="block text-xs text-on-surface-variant">
                        {[
                          run.depth && DEPTH_WORDS[run.depth].name,
                          run.models[0] && modelName(run.models[0]),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "min-w-0",
                      run.rejected
                        ? "text-on-surface-variant"
                        : "text-on-surface",
                    )}
                  >
                    {run.rejected && (
                      <UserX
                        aria-hidden="true"
                        className="mr-1.5 -mt-0.5 inline w-3.5 h-3.5"
                      />
                    )}
                    {runSummary(run)}
                  </span>
                </div>
                {canReject(run) && (
                  <ActionMenu
                    label={`Search of ${when(run.at)}, actions`}
                    icon={MoreHorizontal}
                    iconClassName="w-4 h-4"
                    className="-my-1.5 -mr-2 shrink-0"
                    items={[
                      {
                        id: "reject",
                        label: `Not ${first}`,
                        icon: UserX,
                        onSelect: () => setRejecting(run),
                      },
                    ]}
                  />
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {findings.length > 0 && (
        <div className="mt-6">
          <h3 className={FIELD_LABEL}>What the research found</h3>
          <ul
            id={findingsId}
            className="mt-2 divide-y divide-surface-container-high"
          >
            {(allFindings ? findings : findings.slice(0, FINDINGS_SHOWN)).map(
              (finding, index) => {
                // The page the provider matched to the fact, else the site
                // the fact names.
                const source =
                  (finding.url &&
                    (sources.find((entry) => entry.url === finding.url) ?? {
                      url: finding.url,
                      title: "",
                      firstSeenAt: "",
                    })) ||
                  sourceForSite(finding.site, sources);
                return (
                  <li
                    key={index}
                    className="grid grid-cols-1 gap-x-4 gap-y-0.5 py-2 text-sm sm:grid-cols-[8rem_1fr]"
                  >
                    <span className="text-on-surface-variant">
                      {finding.topic}
                    </span>
                    <span className="min-w-0 text-on-surface break-words">
                      {finding.text}
                      {source ? (
                        <>
                          {" "}
                          <a
                            href={safeHref(source.url)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                          >
                            {sourceDisplay(source).site}
                            <span className="sr-only">
                              {" "}
                              (opens in a new tab)
                            </span>
                          </a>
                        </>
                      ) : (
                        finding.site && (
                          <span className="text-xs text-on-surface-variant">
                            {" "}
                            {finding.site}
                          </span>
                        )
                      )}
                    </span>
                  </li>
                );
              },
            )}
          </ul>
          {findings.length > FINDINGS_SHOWN && (
            <ShowAll
              expanded={allFindings}
              total={findings.length}
              onToggle={() => setAllFindings((open) => !open)}
              controls={findingsId}
            />
          )}
        </div>
      )}

      {sources.length > 0 && (
        <div className="mt-6">
          <h3 className={FIELD_LABEL}>
            Sources <span className="tabular-nums">({sources.length})</span>
          </h3>
          <ul id={sourcesId} className="mt-1">
            {(allSources ? sources : sources.slice(0, SOURCES_SHOWN)).map(
              (source) => (
                <li key={source.url}>
                  <SourceLink source={source} />
                </li>
              ),
            )}
          </ul>
          {sources.length > SOURCES_SHOWN && (
            <ShowAll
              expanded={allSources}
              total={sources.length}
              onToggle={() => setAllSources((open) => !open)}
              controls={sourcesId}
            />
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!rejecting}
        onClose={() => {
          if (!reject.isPending) setRejecting(null);
        }}
        busy={reject.isPending}
        title="Take back this search?"
        confirmLabel={
          rejecting && addedBy(rejecting) > 0
            ? `Take back ${addedBy(rejecting)} detail${addedBy(rejecting) === 1 ? "" : "s"}`
            : "Take back search"
        }
        onConfirm={() => {
          if (!rejecting) return;
          reject.mutate(
            { id: contact.id, runAt: rejecting.at },
            {
              onSuccess: ({ removed }) => {
                setRejecting(null);
                setTakenBack(rejecting.at);
                // The latest run's panel takes focus. An earlier run's menu
                // is gone, so focus goes to the history it was in.
                if (rejecting.at !== lastRun?.at)
                  requestAnimationFrame(() => historyHeading.current?.focus());
                toast.success(
                  removed > 0
                    ? `Took back ${removed} detail${removed === 1 ? "" : "s"}`
                    : "Took back the search",
                );
              },
            },
          );
        }}
        description={
          rejecting && (
            <>
              <p>
                Do this when the search of {when(rejecting.at)} found someone
                else named {contact.name}
                {addedBy(rejecting) > 0 &&
                  `. What it added goes: ${addedInWords(rejecting)}. A detail you changed since stays`}
              </p>
              {pagesOf(rejecting) > 0 && (
                <p>
                  Its {pagesOf(rejecting)} page
                  {pagesOf(rejecting) === 1 ? " stays" : "s stay"} out of later
                  searches, and what it found is not added again
                </p>
              )}
            </>
          )
        }
      />

      {notes && (
        <details className="mt-5">
          <summary className="hit-area state-layer w-fit -mx-1.5 rounded-lg px-1.5 py-0.5 cursor-pointer text-sm font-semibold text-primary transition-colors">
            Research notes
          </summary>
          <div className="mt-3 prose prose-sm max-w-none break-words text-on-surface-variant">
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
              {notes}
            </ReactMarkdown>
          </div>
        </details>
      )}
    </section>
  );
}
