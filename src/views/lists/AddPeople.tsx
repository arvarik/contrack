/**
 * AddPeople — find contacts by name and add them to the open list.
 *
 * The Lists page said "choose who is on each", and an empty list said "Add
 * contacts from the Network page": the page itself had no way to add anyone.
 * This is a combobox: type a name, and ↓, ↑ and Enter or a tap add the person.
 * The field keeps the focus, so the next name can follow at once.
 *
 * @module views/lists/AddPeople
 */
import { useDeferredValue, useId, useMemo, useState } from "react";

import { toast } from "sonner";
import { useAddToList, useContacts } from "../../api";
import { MENU_ITEM, MENU_ITEM_SELECTED, MENU_PANEL } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { SearchField } from "../../components/ui/SearchField";

/** The most people the suggestions show. A longer name narrows them. */
const MAX_SHOWN = 6;

interface AddPeopleProps {
  list: { id: string; name: string };
  /** Who is in the list already, so they are not offered. */
  memberIds: ReadonlySet<string>;
}

export const AddPeople = ({ list, memberIds }: AddPeopleProps) => {
  const { data: contacts = [] } = useContacts();
  const add = useAddToList();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listboxId = useId();
  const needle = useDeferredValue(query.trim().toLowerCase());

  const matches = useMemo(
    () =>
      needle
        ? contacts
            .filter(
              (c) =>
                !c.isGhost &&
                !c.isArchived &&
                !memberIds.has(c.id) &&
                c.name.toLowerCase().includes(needle),
            )
            .slice(0, MAX_SHOWN)
        : [],
    [contacts, memberIds, needle],
  );
  const current = matches[Math.min(active, matches.length - 1)];

  const choose = (person: { id: string; name: string }) => {
    setQuery("");
    setActive(0);
    add
      .mutateAsync({ listId: list.id, contactId: person.id })
      .then(() => toast.success(`${person.name} added to ${list.name}`))
      .catch(() => toast.error(`Could not add ${person.name}`));
  };

  return (
    <SearchField
      type="text"
      role="combobox"
      aria-label="Add people"
      aria-autocomplete="list"
      aria-expanded={matches.length > 0}
      aria-controls={listboxId}
      aria-activedescendant={current ? `${listboxId}-${current.id}` : undefined}
      placeholder="Add people…"
      value={query}
      onChange={(e) => {
        setQuery(e.target.value);
        setActive(0);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          if (matches.length === 0) return;
          e.preventDefault();
          const step = e.key === "ArrowDown" ? 1 : -1;
          setActive((i) => (i + step + matches.length) % matches.length);
        } else if (e.key === "Enter" && current) {
          e.preventDefault();
          choose(current);
        } else if (e.key === "Escape" && query) {
          e.preventDefault();
          setQuery("");
        }
      }}
    >
      {matches.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="People to add"
          className={cn(MENU_PANEL, "absolute z-20 inset-x-0 top-full mt-1")}
        >
          {matches.map((person) => (
            // The field keeps the focus, so the option is chosen by the
            // field's keys or a tap, and a press must not take the focus.
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events
            <li
              key={person.id}
              id={`${listboxId}-${person.id}`}
              role="option"
              aria-selected={person === current}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(person)}
              className={cn(
                MENU_ITEM,
                "cursor-pointer",
                person === current && MENU_ITEM_SELECTED,
              )}
            >
              <span className="truncate">
                <span className="font-semibold">{person.name}</span>
                {person.company && (
                  <span className="text-on-surface-variant">
                    {" "}
                    · {person.company}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SearchField>
  );
};
