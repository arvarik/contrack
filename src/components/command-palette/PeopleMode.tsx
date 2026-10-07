/**
 * The palette's search for people, pages and new contacts, once words or
 * pills are typed. The rows keep one order between keys: a page named
 * exactly, the people, "Show all in Network", the matching pages, "Create
 * contact" (not for a question) and "Ask AI".
 *
 * It renders `notes` above the list and `rows` inside it. The → mark at a
 * row's end is a tap target for the → key, hidden from a screen reader.
 */
import { Command } from "cmdk";
import { ChevronsRight, List, Sparkles, UserPlus } from "lucide-react";
import type { ReactNode } from "react";
import { fallbackAvatarUrl } from "../../lib/avatar";
import { NAMES } from "../../lib/names";
import { cn } from "../../lib/utils";
import type { SlimSearchContact } from "../../api/contacts";
import type { Contact } from "../../types";
import { ContactRowBody } from "./ContactMetaBadges";
import { GoToGroup } from "./ZeroStateView";
import {
  GROUP_HEADING_DEFAULT,
  GROUP_HEADING_PRIMARY,
  ITEM_CURRENT,
} from "./utils";

type Person = Contact | SlimSearchContact;

const ROW =
  "flex items-center gap-3 px-3 py-2 min-h-[44px] pointer-fine:min-h-0 rounded-xl cursor-default select-none transition-colors text-sm text-on-surface";

const IconTile = ({ children }: { children: ReactNode }) => (
  <div className="w-8 h-8 flex items-center justify-center bg-surface-container-highest rounded-full shrink-0">
    {children}
  </div>
);

export interface PeopleModeProps {
  part: "notes" | "rows";
  results: Person[];
  loading: boolean;
  /** The facet values are open: what to pick, not a search that failed. */
  facetMenuOpen: boolean;
  /** A pill narrows the people. A `near:` pill does not, in the palette. */
  hasFilters: boolean;
  /** The words, without the pills. */
  words: string;
  /** The pills and the words, as the Network list reads them. */
  query: string;
  /** The words are a destination's whole name. */
  exactPage: boolean;
  canCreate: boolean;
  onOpen: (id: string) => void;
  onActions: (person: Person) => void;
  onCreate: () => void;
  onAsk: () => void;
  onNavigate: (path: string) => void;
}

export const PeopleMode = (props: PeopleModeProps) => {
  const { results, words } = props;
  const typed = words.trim();

  if (props.part === "notes") {
    if (results.length > 0 || props.facetMenuOpen) return null;
    return (
      <p className="pt-6 pb-2 text-center text-sm text-on-surface-variant">
        {props.loading ? "Searching…" : "No people found"}
      </p>
    );
  }

  const pages = typed && (
    <GoToGroup query={typed} onNavigate={props.onNavigate} />
  );
  // Not for a name somebody already has: that person is the answer.
  const exactName = results.some(
    (person) => person.name?.trim().toLowerCase() === typed.toLowerCase(),
  );
  const askRow = typed.length >= 3 && !exactName && (
    <Command.Group heading="Ask AI" className={GROUP_HEADING_PRIMARY}>
      <Command.Item
        value={`askai_${typed}`}
        onSelect={props.onAsk}
        className={cn(ROW, ITEM_CURRENT)}
      >
        <IconTile>
          <Sparkles className="w-4 h-4 text-primary" />
        </IconTile>
        <span className="truncate">
          Ask AI: <span className="font-bold">"{typed}"</span>
        </span>
      </Command.Item>
    </Command.Group>
  );

  return (
    <>
      {props.exactPage && pages}

      {results.length > 0 && (
        <Command.Group
          heading={props.hasFilters ? "Contacts · filtered" : "Contacts"}
          className={GROUP_HEADING_DEFAULT}
        >
          {results.map((person) => (
            <Command.Item
              key={person.id}
              value={person.id + person.name}
              onSelect={() => props.onOpen(person.id)}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-xl cursor-default select-none aria-selected:text-on-primary-wash transition-colors text-on-surface group/result",
                ITEM_CURRENT,
              )}
            >
              <img
                src={person.avatarUrl || fallbackAvatarUrl(person.name)}
                alt=""
                className="w-8 h-8 shrink-0 rounded-full bg-surface-container-highest object-cover"
              />
              <ContactRowBody contact={person} />
              {/* The row's actions, for a pointer or a finger. Not a button:
                  an option holds no second control. */}
              <span
                aria-hidden="true"
                title="Actions"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onActions(person);
                }}
                className="hit-area shrink-0 p-1.5 -mr-1 rounded-lg text-on-surface-variant opacity-40 pointer-fine:opacity-0 pointer-fine:group-hover/result:opacity-50 pointer-fine:group-aria-selected/result:opacity-50 pointer-coarse:opacity-60 active:opacity-80 transition-opacity"
              >
                <ChevronsRight className="w-4 h-4 pointer-fine:w-3.5 pointer-fine:h-3.5" />
              </span>
            </Command.Item>
          ))}
          <Command.Item
            value="showall_network"
            onSelect={() =>
              props.onNavigate(`/?q=${encodeURIComponent(props.query)}`)
            }
            className={cn(ROW, "text-on-surface-variant", ITEM_CURRENT)}
          >
            <IconTile>
              <List className="w-4 h-4" />
            </IconTile>
            <span className="truncate">Show all in {NAMES.network.label}</span>
          </Command.Item>
        </Command.Group>
      )}

      {!props.exactPage && pages}

      {/* Last, and only when nobody has the exact name, even beside an
          approximate match. Never with pills, which it would not keep. */}
      {props.canCreate && (
        <Command.Group heading="Create" className={GROUP_HEADING_DEFAULT}>
          <Command.Item
            value={`create_${typed}`}
            onSelect={props.onCreate}
            className={cn(ROW, ITEM_CURRENT)}
          >
            <IconTile>
              <UserPlus className="w-4 h-4 text-primary" />
            </IconTile>
            <span className="truncate">
              Create contact <span className="font-bold">"{typed}"</span>
            </span>
          </Command.Item>
        </Command.Group>
      )}

      {askRow}
    </>
  );
};
