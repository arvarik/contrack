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
 * Enrich again opens the two research depths (`EnrichMenu`). It reads
 * `contact.aiResearch` (shared/researchRecord.ts), which only the
 * enrichment merge writes.
 */
import { useId, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ExternalLink, Globe } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

import type { Contact } from "../../../types";
import { cn } from "../../../lib/utils";
import { CARD, FIELD_LABEL, SECTION_HEADING_SPACED } from "../../../lib/styles";
import { DEPTH_WORDS } from "../../../lib/researchDepth";
import { EnrichMenu } from "./EnrichMenu";
import {
  isLegacyDossier,
  parseResearchRecord,
  sourceForSite,
  type ResearchSource,
} from "../../../../shared/researchRecord";
import { modelName, runSummary, sourceDisplay } from "../../../lib/research";

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

/** One cited page: its icon, its title or address, and where it lives. */
function SourceLink({ source }: { source: ResearchSource }) {
  const { title, site, trail } = sourceDisplay(source);
  return (
    <a
      href={source.url}
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

export function ResearchCard({ contact }: { contact: Contact }) {
  const headingId = useId();
  const findingsId = useId();
  const sourcesId = useId();
  const [allFindings, setAllFindings] = useState(false);
  const [allSources, setAllSources] = useState(false);

  const record = useMemo(
    () => parseResearchRecord(contact.aiResearch),
    [contact.aiResearch],
  );
  const legacy = isLegacyDossier(contact.aiBackground);
  // Notes that came from somewhere other than the old merge: an import, or
  // the API. They are the reader's own, so they are shown as written.
  const notes = !legacy && contact.aiBackground ? contact.aiBackground : null;
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
  const researched = runs.length > 0 || legacy || !!contact.aiHydratedAt;

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
          <p className="mt-1 text-sm text-on-surface-variant text-pretty">
            Check a detail against its page before you rely on it
          </p>
        </div>
        <EnrichMenu
          contact={contact}
          label="Enrich again"
          variant="secondary"
          className="shrink-0"
        />
      </div>

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
                            href={source.url}
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

      {legacy && (
        <p className="mt-5 text-sm text-on-surface-variant text-pretty">
          The earlier enrichment
          {contact.aiHydratedAt ? ` on ${when(contact.aiHydratedAt)}` : ""} kept
          no list of the pages it read. Enrich again to record them
        </p>
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
