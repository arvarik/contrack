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
 * Enrich again opens the two research depths (`EnrichMenu`). When the
 * latest research found no page about the person, the card says what it
 * searched with and offers the details that would help it (`NoPageNextSteps`).
 * It reads `contact.aiResearch` (shared/researchRecord.ts), which only the
 * enrichment merge writes.
 */
import { useId, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  ExternalLink,
  Globe,
  Link as LinkIcon,
  Mail,
  MapPin,
  SearchX,
  type LucideIcon,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

import type { Contact } from "../../../types";
import { cn, safeHref } from "../../../lib/utils";
import { CARD, FIELD_LABEL, SECTION_HEADING_SPACED } from "../../../lib/styles";
import { DEPTH_WORDS } from "../../../lib/researchDepth";
import { EnrichMenu, useCanEnrich } from "./EnrichMenu";
import {
  parseResearchRecord,
  sourceForSite,
  type ResearchRun,
  type ResearchSource,
} from "../../../../shared/researchRecord";
import {
  listInWords,
  missingAnchors,
  modelName,
  researchedWith,
  runSummary,
  sourceDisplay,
  type ResearchAnchor,
} from "../../../lib/research";

/** Findings shown before "Show all". */
const FINDINGS_SHOWN = 8;
/** Sources shown before "Show all". */
const SOURCES_SHOWN = 8;

/** "Sep 26, 3:21 PM", or the raw value when it is no date. */
function when(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : format(date, "MMM d, h:mm a");
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

/**
 * Each detail's button: its words and its glyph. A contact with a LinkedIn
 * profile only is offered another link, since it has one already.
 */
const ANCHOR_BUTTONS: Record<
  ResearchAnchor,
  { label: string; another?: string; icon: LucideIcon }
> = {
  city: { label: "Add a city", icon: MapPin },
  workEmail: { label: "Add a work email", icon: Mail },
  link: { label: "Add a link", another: "Add another link", icon: LinkIcon },
};

/**
 * The latest research found no page about the person: what it searched with,
 * and the details that would help it, each a button that opens the field
 * for it on this page (`onAddDetail`). A page counts only when it names the
 * person with a detail the records have, so one more detail is what a retry
 * needs. Deep is offered when the run was Standard.
 *
 * It offers only what the page can take. A city and a work email go in
 * Details, and a link in the header. Schools and past jobs would help as
 * much, but the page has no field for them, so they are not offered.
 */
function NoPageNextSteps({
  contact,
  lastRun,
  onAddDetail,
}: {
  contact: Contact;
  lastRun: ResearchRun;
  onAddDetail?: (anchor: ResearchAnchor) => void;
}) {
  const headingId = useId();
  const first = contact.firstName || contact.name.split(" ")[0];
  const used = researchedWith(contact);
  const missing = onAddDetail ? missingAnchors(contact) : [];
  const deepNext = lastRun.depth !== "deep";
  const hasLink = (contact.socialLinks?.length ?? 0) > 0;
  // With research off, or for a ghost, there is no Enrich again to name.
  const canEnrich = useCanEnrich(contact);
  const closing =
    missing.length > 0
      ? canEnrich
        ? `Then choose Enrich again${deepNext ? ". Deep runs a longer search" : ""}`
        : null
      : deepNext && canEnrich
        ? "Choose Enrich again, then Deep, for a longer search"
        : "A page about them may not exist yet";
  return (
    <section
      aria-labelledby={headingId}
      className="mt-5 rounded-xl bg-surface-container-low p-4"
    >
      <h3
        id={headingId}
        className="flex items-center gap-2 text-sm font-bold text-on-surface"
      >
        <SearchX
          aria-hidden="true"
          className="w-4 h-4 shrink-0 text-on-surface-variant"
        />
        No web page matched {first}
      </h3>
      <p className="mt-1 text-sm text-on-surface-variant text-pretty">
        {used.length > 0
          ? `Research searched with ${listInWords([`${first}’s name`, ...used])}`
          : `Research searched with ${first}’s name alone`}
      </p>
      {missing.length > 0 && (
        <>
          <p className="mt-3 text-sm text-on-surface text-pretty">
            One more detail helps it find the right person
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {missing.map((anchor) => {
              const { label, another, icon: Icon } = ANCHOR_BUTTONS[anchor];
              return (
                <button
                  key={anchor}
                  type="button"
                  onClick={() => onAddDetail?.(anchor)}
                  className="btn-secondary btn-sm"
                >
                  <Icon aria-hidden="true" className="w-3.5 h-3.5" />
                  {another && hasLink ? another : label}
                </button>
              );
            })}
          </div>
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
  const findingsId = useId();
  const sourcesId = useId();
  const [allFindings, setAllFindings] = useState(false);
  const [allSources, setAllSources] = useState(false);

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

      {runs.at(-1)?.outcome === "no-public-info" && (
        <NoPageNextSteps
          contact={contact}
          lastRun={runs.at(-1)!}
          onAddDetail={onAddDetail}
        />
      )}

      {runs.length > 0 && (
        <div className="mt-5">
          <h3 className={FIELD_LABEL}>History</h3>
          <ol className="mt-2 space-y-2">
            {[...runs].reverse().map((run, index) => (
              <li
                key={`${run.at}-${index}`}
                className="flex flex-col gap-0.5 sm:flex-row sm:gap-4 text-sm"
              >
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
                <span className="min-w-0 text-on-surface">
                  {runSummary(run)}
                </span>
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
