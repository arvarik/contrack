/**
 * "Filter by": the facets as rows, for a person who does not know them.
 *
 * The Filter chip and the "Filter by tag, role or company" row show it.
 * Picking a field types `tag:` in the box, and its values open under it.
 * The facets used to be in the docs only: no row, chip or hint named them,
 * and a phone, with no footer, had no way to learn them.
 *
 * @module components/command-palette/FilterFields
 */
import { Command } from "cmdk";
import { ListFilter } from "lucide-react";
import type { FacetField } from "../../hooks/useQueryTokenizer";
import { cn } from "../../lib/utils";
import { GROUP_HEADING_DEFAULT, ITEM_CURRENT } from "./utils";

/** The fields, the ones people use most first. `near:` needs a map. */
const FIELDS: readonly { field: FacetField; does: string }[] = [
  { field: "tag", does: "Has a tag" },
  { field: "role", does: "Role holds a word" },
  { field: "company", does: "Company holds a word" },
  { field: "location", does: "Lives or works in a place" },
  { field: "industry", does: "Industry holds a word" },
  { field: "list", does: "Is on a list" },
  { field: "tracked", does: "Tracked or not" },
  { field: "contacted", does: "Last in touch before or after" },
  { field: "score", does: "Relationship score above or below" },
  { field: "updated", does: "Last edited before or after" },
  { field: "missing", does: "Has no email, phone, company or location" },
];

export const FilterFields = ({
  onPick,
}: {
  onPick: (field: FacetField) => void;
}) => (
  <Command.Group heading="Filter by" className={GROUP_HEADING_DEFAULT}>
    {FIELDS.map(({ field, does }) => (
      <Command.Item
        key={field}
        value={`filter_${field}`}
        onSelect={() => onPick(field)}
        className={cn(
          "flex items-center gap-3 px-3 py-2 min-h-[44px] pointer-fine:min-h-0 rounded-xl cursor-default select-none transition-colors text-sm text-on-surface",
          ITEM_CURRENT,
        )}
      >
        <ListFilter className="w-4 h-4 shrink-0 text-on-surface-variant" />
        <code className="w-24 shrink-0 font-bold">{field}:</code>
        <span className="truncate text-on-surface-variant">{does}</span>
      </Command.Item>
    ))}
  </Command.Group>
);
