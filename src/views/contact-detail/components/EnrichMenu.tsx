/**
 * EnrichMenu: one button that researches this contact on the web, at the
 * depth the person picks from its menu.
 *
 * ```
 *   ┌──────────────────┐
 *   │ ✦ Enrich again ▾ │
 *   └──────────────────┘
 *   DEPTH
 *     Standard     about 40 s
 *     Deep         about 1 min
 * ```
 *
 * The dossier has two: Enrich contact in the empty dossier, and Enrich
 * again on the Research card. It is one control with a chevron, not a split
 * button. The Track button beside the name was a split button, and the
 * owner asked for one control with single words (`TrackButton`). The
 * contact's actions menu lists the same two depths as rows of its own.
 *
 * A row starts the same background run as the Enrichment page
 * (`startSearch`), with the account's web search engine. When the engine
 * that runs is SearXNG or both, the heading says so: "Depth · with
 * SearXNG". While this contact's research runs, the button reads
 * "Enriching…" and waits, so a second press cannot queue the contact twice.
 * Without AI, outside the AI Search provider, or for a ghost, it is not
 * there. The times show only when research runs on Gemini, where they were
 * measured (`depthFiguresApply`).
 *
 * @module views/contact-detail/components/EnrichMenu
 */
import { ChevronDown, Sparkles } from "lucide-react";
import type { Contact } from "../../../types";
import {
  ActionMenu,
  type ActionMenuItem,
} from "../../../components/ui/ActionMenu";
import { useAiAllowed } from "../../../hooks/useAiAllowed";
import {
  isEnriching,
  useOptionalAISearch,
} from "../../../contexts/AISearchContext";
import {
  DEPTH_ORDER,
  DEPTH_WORDS,
  depthTime,
} from "../../../lib/researchDepth";
import { engineName } from "../../../lib/webSearchEngine";

interface EnrichMenuProps {
  contact: Pick<Contact, "id" | "isGhost">;
  /** The button's words: "Enrich contact", "Enrich again". */
  label: string;
  /** The empty dossier's call to action, or a card's own button. */
  variant: "primaryLarge" | "secondary";
  className?: string;
}

/**
 * Whether the menu shows for this contact: research is on for the account,
 * and the contact is not a ghost. Words that point to Enrich again ask it
 * too, so they never name a button that is not there.
 */
export function useCanEnrich(contact: Pick<Contact, "isGhost">): boolean {
  const search = useOptionalAISearch();
  const aiAllowed = useAiAllowed();
  return !!search && aiAllowed && !contact.isGhost;
}

export function EnrichMenu({
  contact,
  label,
  variant,
  className,
}: EnrichMenuProps) {
  const search = useOptionalAISearch();
  const canEnrich = useCanEnrich(contact);
  if (!search || !canEnrich) return null;
  const enriching = isEnriching(search, contact.id);

  const items: ActionMenuItem[] = DEPTH_ORDER.map((depth) => ({
    id: depth,
    label: DEPTH_WORDS[depth].name,
    hint: search.depthFiguresApply ? depthTime(depth) : undefined,
    speakHint: true,
    disabled: enriching,
    onSelect: () =>
      search.startSearch([contact.id], { limitAs: "toast", depth }),
  }));

  const words = enriching ? "Enriching…" : label;
  // The web search model's own search is the default, and goes unsaid.
  const heading =
    search.runsEngine && search.runsEngine !== "provider"
      ? `Depth · with ${engineName(search.runsEngine, search.webSearchProvider)}`
      : "Depth";
  return (
    <ActionMenu
      // The name starts with the words on the button, so a person who says
      // what they see reaches it (WCAG 2.5.3).
      label={enriching ? words : `${label}, choose how deep`}
      heading={heading}
      items={items}
      align="end"
      variant={variant}
      disabled={enriching}
      className={className}
      triggerContent={
        <>
          <Sparkles aria-hidden="true" className="w-4 h-4 shrink-0" />
          {words}
          <ChevronDown aria-hidden="true" className="w-3.5 h-3.5 shrink-0" />
        </>
      }
    />
  );
}
