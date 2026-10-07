/**
 * EnrichMenu: one button that researches this contact on the web, at the
 * depth the person picks from its menu. The dossier shows it as Enrich
 * contact when empty, and as Enrich again on the Research card.
 *
 * A row starts the same background run as the Enrichment page
 * (`startSearch`). The heading names the engine when SearXNG runs. While
 * this contact's research runs, the button reads "Enriching…" and waits, so
 * a second press cannot queue the contact twice. With no model or no web
 * search set up, it waits too, and its tooltip and name say why
 * (`useBlockedAi`). The times show only on Gemini, where they were measured
 * (`depthFiguresApply`).
 */
import { ChevronDown, Sparkles } from "lucide-react";
import type { Contact } from "../../../types";
import {
  ActionMenu,
  type ActionMenuItem,
} from "../../../components/ui/ActionMenu";
import { useAiAllowed } from "../../../hooks/useAiAllowed";
import { aiSetupLine, useBlockedAi } from "../../../hooks/useAiSetup";
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
 * Whether the menu shows: research is on and the contact is not a ghost.
 * Text that points to Enrich again checks it too.
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
  const blocked = useBlockedAi("research");
  if (!search || !canEnrich) return null;
  const enriching = isEnriching(search, contact.id);
  const why = blocked && aiSetupLine(blocked);

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
      label={
        why
          ? `${label}, ${why}`
          : enriching
            ? words
            : `${label}, choose how deep`
      }
      title={why || undefined}
      heading={heading}
      items={items}
      align="end"
      variant={variant}
      disabled={enriching || !!blocked}
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
