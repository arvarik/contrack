/**
 * DuplicateComparison: the contacts of one possible duplicate side by side,
 * the choice of the one to keep, and what the merge will do.
 *
 * ```
 *  CONTACT TO KEEP   (●) Ada Quill          ( ) A. Quill
 *  Name • ............ Ada Quill            A̶.̶ ̶Q̶u̶i̶l̶l̶
 *    ⚠ First names differ: Ada and Ben
 *  Company ........... Northwind            —
 *  Notes ............. 3 notes              1 note
 *  Same: email, phone                               [ Show all fields ]
 *
 *  AFTER THE MERGE
 *  → Moves to Ada Quill: 1 note
 *  ⊘ Not kept: name "A. Quill"
 *  ↺ Undo brings everything back for 90 days
 * ```
 *
 * One column for each contact, so a value is read across the row it shares
 * with the others. Only the rows that differ show at first, because a
 * person decides on the differences: the rows every contact agrees on fold
 * into one "Same:" line, and Show all fields opens them. A row whose values
 * differ carries the warning dot, the engine's caveat sits under the row it
 * is about, and a value the merge drops is struck through, with "not kept"
 * for a screen reader. The kept contact's column wears the selected tint.
 * A narrow container, or a group of more than three, stacks the contacts
 * as cards with the same rows.
 *
 * The heading of each column is a radio: the contact to keep is chosen
 * where it is read. The parent holds the choice, so a key press that merges
 * uses the contact chosen here.
 *
 * @module views/dedupe/components/DuplicateComparison
 */
import { Fragment, useId, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  CircleSlash,
  Undo2,
  UserX,
} from "lucide-react";
import { cn } from "../../../lib/utils";
import {
  BTN_QUIET,
  FIELD_LABEL,
  LABEL,
  SELECTED_TINT,
  TAG_PILL,
  TONE_DOT,
} from "../../../lib/styles";
import { radioKeys, radioTabIndex } from "../../../lib/a11y";
import { fallbackAvatarUrl } from "../../../lib/avatar";
import { RadioDot } from "../../../components/ui/RadioDot";
import { useElementWidthAtLeast } from "../../../hooks/useElementWidth";
import {
  mergeOutcome,
  movesSentence,
  type ReviewContact,
  type SingleField,
} from "../utils/mergeOutcome";

/** The narrowest a comparison may be and still show columns, by how many it holds. */
const TABLE_MIN_WIDTH: Record<number, number> = { 2: 500, 3: 600 };

/** The first rows of a list a cell shows before "+2 more". */
const LIST_LIMIT = 3;

interface DuplicateComparisonProps {
  contacts: ReviewContact[];
  keeperId: string;
  onKeeperChange: (id: string) => void;
  /**
   * In a group of three or more: take one contact out, because it is a
   * different person. The group then merges without it.
   */
  onRemove?: (contact: ReviewContact) => void;
  /** The engine's caveats, each shown under the row it is about. */
  caveats?: string[];
  /** Ids for the caveats, so the Merge button can point at them. */
  caveatIdPrefix?: string;
  /**
   * The caveats are in words just above, on the contact page's banner, so
   * the rows only carry their mark.
   */
  caveatsAbove?: boolean;
}

/** A row of the comparison: its name, and what each contact shows in it. */
interface Row {
  key: string;
  label: string;
  /** The single-value field, so the merge can strike a value through. */
  field?: SingleField;
  /** A count, not a value: shown whenever any contact has one. */
  count?: boolean;
  render: (contact: ReviewContact) => ReactNode | null;
  /** What two contacts compare equal on. */
  compare: (contact: ReviewContact) => string;
}

const norm = (value: string | null | undefined) =>
  (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** "LinkedIn" for "linkedin". */
const platformName = (platform: string) =>
  platform === "linkedin"
    ? "LinkedIn"
    : platform === "github"
      ? "GitHub"
      : platform.charAt(0).toUpperCase() + platform.slice(1);

/** A cell's list, or nothing for an empty one, so the row knows it is empty. */
const listCell = (items: string[]) =>
  items.length === 0 ? null : <ListCell items={items} />;

/** A cell's list: the first few, then how many more. */
function ListCell({ items }: { items: string[] }) {
  const shown = items.slice(0, LIST_LIMIT);
  return (
    <span className="flex flex-col gap-0.5 min-w-0">
      {shown.map((item) => (
        <span key={item} className="break-words">
          {item}
        </span>
      ))}
      {items.length > LIST_LIMIT && (
        <span className="text-xs text-on-surface-variant">
          +{items.length - LIST_LIMIT} more
        </span>
      )}
    </span>
  );
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

const listKey = (items: string[]) =>
  items.map(norm).filter(Boolean).sort().join("|");

/** The rows, in the order a person checks identity: who, where, how to reach. */
const single = (key: SingleField, label: string): Row => ({
  key,
  label,
  field: key,
  render: (c) => {
    const value = c[key]?.trim();
    if (!value) return null;
    return key === "about" ? (
      <span className="line-clamp-3">{value}</span>
    ) : (
      value
    );
  },
  compare: (c) => norm(c[key]),
});

const ROWS: Row[] = [
  single("name", "Name"),
  single("company", "Company"),
  single("role", "Role"),
  single("location", "City"),
  {
    key: "emails",
    label: "Email",
    render: (c) => listCell((c.emails ?? []).map((e) => e.email)),
    compare: (c) => listKey((c.emails ?? []).map((e) => e.email)),
  },
  {
    key: "phones",
    label: "Phone",
    render: (c) => listCell((c.phones ?? []).map((p) => p.phone)),
    compare: (c) =>
      listKey(
        (c.phones ?? []).map((p) => p.phone.replace(/\D/g, "").slice(-10)),
      ),
  },
  {
    key: "links",
    label: "Profile",
    render: (c) =>
      listCell(
        (c.socialLinks ?? []).map(
          (l) => `${platformName(l.platform)} ${l.handle ?? l.url}`,
        ),
      ),
    compare: (c) =>
      listKey((c.socialLinks ?? []).map((l) => l.handle ?? l.url)),
  },
  single("birthday", "Birthday"),
  single("website", "Website"),
  {
    key: "tags",
    label: "Tags",
    render: (c) =>
      (c.tags ?? []).length === 0 ? null : (
        <span className="flex flex-wrap gap-1">
          {c.tags.map((t) => (
            <span key={t.id} className={TAG_PILL}>
              {t.tag}
            </span>
          ))}
        </span>
      ),
    compare: (c) => listKey((c.tags ?? []).map((t) => t.tag)),
  },
  {
    key: "lists",
    label: "Lists",
    render: (c) =>
      (c.lists ?? []).length === 0
        ? null
        : c.lists.map((l) => l.name).join(", "),
    compare: (c) => listKey((c.lists ?? []).map((l) => l.name)),
  },
  {
    key: "notes",
    label: "Notes",
    count: true,
    render: (c) =>
      (c.interactionCount ?? 0) === 0
        ? null
        : plural(c.interactionCount, "note", "notes"),
    compare: (c) => String(c.interactionCount ?? 0),
  },
  {
    key: "followUps",
    label: "Follow-ups",
    count: true,
    render: (c) =>
      (c.openFollowUpCount ?? 0) === 0 ? null : `${c.openFollowUpCount} open`,
    compare: (c) => String(c.openFollowUpCount ?? 0),
  },
  {
    key: "sources",
    label: "From",
    render: (c) =>
      (c.sources ?? []).length === 0
        ? null
        : [...new Set(c.sources.map((s) => platformName(s.platform)))].join(
            ", ",
          ),
    compare: (c) => listKey((c.sources ?? []).map((s) => s.platform)),
  },
  single("about", "About"),
];

/** The rows a caveat is about, from the words the server writes. */
function caveatRows(caveat: string): string[] {
  const rows: string[] = [];
  if (/first names|\bjr\b|\bsr\b|one is /i.test(caveat)) rows.push("name");
  if (/compan/i.test(caveat)) rows.push("company");
  if (/\bcit(y|ies)\b/i.test(caveat)) rows.push("location");
  if (/phone/i.test(caveat)) rows.push("phones");
  if (/email|inbox/i.test(caveat)) rows.push("emails");
  if (/profile/i.test(caveat)) rows.push("links");
  return rows;
}

/** The header of one contact: the radio that keeps it, its face and name. */
function KeepChoice({
  contact,
  index,
  checked,
  anyChecked,
  onChoose,
  onRemove,
}: {
  contact: ReviewContact;
  index: number;
  checked: boolean;
  anyChecked: boolean;
  onChoose: () => void;
  onRemove?: () => void;
}) {
  const where = [contact.role, contact.company].filter(Boolean).join(" at ");
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <button
        type="button"
        role="radio"
        aria-checked={checked}
        tabIndex={radioTabIndex(checked, index, anyChecked)}
        onKeyDown={radioKeys}
        onClick={onChoose}
        className={cn(
          "flex items-center gap-2.5 w-full min-w-0 text-left rounded-xl px-3 py-2.5 min-h-[44px] transition-colors",
          checked ? SELECTED_TINT : "state-layer bg-surface-container-low",
        )}
      >
        <RadioDot checked={checked} />
        <img
          src={contact.avatarUrl || fallbackAvatarUrl(contact.name)}
          alt=""
          className="w-8 h-8 rounded-full object-cover bg-surface-container-high shrink-0"
        />
        <span className="min-w-0">
          <span
            className={cn(
              "block text-sm font-bold break-words",
              !checked && "text-on-surface",
            )}
          >
            {contact.name}
          </span>
          {where && (
            <span className="block text-xs text-on-surface-variant break-words">
              {where}
            </span>
          )}
        </span>
      </button>
      {onRemove && !checked && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`${contact.name} is a different person`}
          className={cn(BTN_QUIET, "self-start")}
        >
          <UserX className="w-3.5 h-3.5" aria-hidden="true" />
          Different person
        </button>
      )}
    </div>
  );
}

/** A value, struck through when the merge drops it. */
function Value({
  children,
  dropped,
}: {
  children: ReactNode;
  dropped: boolean;
}) {
  if (children === null) {
    return (
      <span className="text-on-surface-variant">
        <span aria-hidden="true">—</span>
        <span className="sr-only">none</span>
      </span>
    );
  }
  return dropped ? (
    <span className="text-on-surface-variant line-through decoration-on-surface-variant/60">
      {children}
      <span className="sr-only">, not kept</span>
    </span>
  ) : (
    <span className="text-on-surface">{children}</span>
  );
}

/** The name of a row, with the dot when its values differ. */
function RowLabel({
  label,
  differs,
  flagged,
}: {
  label: string;
  differs: boolean;
  flagged: boolean;
}) {
  return (
    <span className={cn(FIELD_LABEL, "flex items-center gap-1.5")}>
      {label}
      {flagged ? (
        <AlertTriangle
          aria-hidden="true"
          className="w-3.5 h-3.5 shrink-0 text-warning"
        />
      ) : (
        differs && (
          <span
            aria-hidden="true"
            className={cn("w-1.5 h-1.5 rounded-full", TONE_DOT.warning)}
          />
        )
      )}
      {differs && <span className="sr-only">, differs</span>}
    </span>
  );
}

/** One caveat, in the warning ink with its glyph. */
function Caveat({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p
      id={id}
      className="flex items-start gap-1.5 text-sm font-semibold text-warning"
    >
      <AlertTriangle
        aria-hidden="true"
        className="w-3.5 h-3.5 mt-0.5 shrink-0"
      />
      {children}
    </p>
  );
}

export const DuplicateComparison = ({
  contacts,
  keeperId,
  onKeeperChange,
  onRemove,
  caveats = [],
  caveatIdPrefix,
  caveatsAbove = false,
}: DuplicateComparisonProps) => {
  const labelId = useId();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [showAll, setShowAll] = useState(false);
  const tableWidth = TABLE_MIN_WIDTH[contacts.length];
  const wide =
    useElementWidthAtLeast(root, tableWidth ?? Number.MAX_SAFE_INTEGER) ??
    false;
  const asTable = tableWidth !== undefined && wide;

  const keeper = contacts.find((c) => c.id === keeperId) ?? contacts[0];
  const others = useMemo(
    () => contacts.filter((c) => c.id !== keeper.id),
    [contacts, keeper.id],
  );
  const outcome = useMemo(() => mergeOutcome(keeper, others), [keeper, others]);

  // Each caveat marks every row it is about, and its words go under the
  // first of them. One with no row, such as a shared inbox seen only by
  // the engine, goes above the comparison ("").
  const flags = useMemo(() => {
    const byRow = new Map<string, string[]>();
    for (const caveat of caveats) {
      const rows = caveatRows(caveat);
      for (const row of rows.length > 0 ? rows : [""]) {
        byRow.set(row, [...(byRow.get(row) ?? []), caveat]);
      }
    }
    return byRow;
  }, [caveats]);
  /** The row a caveat's words go under: the first one it marks. */
  const wordsUnder = (rowKey: string) =>
    (flags.get(rowKey) ?? []).filter(
      (caveat) => (caveatRows(caveat)[0] ?? "") === rowKey,
    );

  // Rows nobody has a value in say nothing. The rest differ, or are the
  // same on every contact and fold into one line until asked for.
  const { shownRows, sameRows } = useMemo(() => {
    const filled = ROWS.filter((row) =>
      contacts.some((c) => row.render(c) !== null),
    );
    const same = filled.filter(
      (row) =>
        !row.count &&
        !flags.has(row.key) &&
        contacts.every((c) => row.render(c) !== null) &&
        new Set(contacts.map(row.compare)).size === 1,
    );
    return {
      shownRows: showAll ? filled : filled.filter((row) => !same.includes(row)),
      sameRows: same,
    };
  }, [contacts, flags, showAll]);

  // Only a field that holds one value can lose one, so only it differs in a
  // way that matters. Lists join, and counts add up.
  const differs = (row: Row) =>
    row.field !== undefined &&
    new Set(contacts.map(row.compare).filter(Boolean)).size > 1;
  const dropped = (contact: ReviewContact, field?: SingleField) =>
    field !== undefined &&
    outcome.notKept.some(
      (line) => line.field === field && line.fromId === contact.id,
    );
  const anyChecked = contacts.some((c) => c.id === keeperId);
  const choice = (contact: ReviewContact, index: number) => (
    <KeepChoice
      contact={contact}
      index={index}
      checked={contact.id === keeper.id}
      anyChecked={anyChecked}
      onChoose={() => onKeeperChange(contact.id)}
      onRemove={
        onRemove && contacts.length > 2 ? () => onRemove(contact) : undefined
      }
    />
  );
  const caveatId = (caveat: string) =>
    caveatIdPrefix ? `${caveatIdPrefix}-${caveats.indexOf(caveat)}` : undefined;
  // A caveat with no row, such as a shared inbox seen only by the engine,
  // goes above the comparison. So do all of them when the contacts stack.
  const loose = caveatsAbove ? [] : asTable ? (flags.get("") ?? []) : caveats;

  const sameLine = sameRows.length > 0 && (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-sm">
      {!showAll && (
        <span className="text-on-surface-variant">
          Same: {sameRows.map((row) => row.label.toLowerCase()).join(", ")}
        </span>
      )}
      <button
        type="button"
        onClick={() => setShowAll((v) => !v)}
        aria-expanded={showAll}
        className={BTN_QUIET}
      >
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "w-3.5 h-3.5 transition-transform duration-(--dur-fast)",
            showAll && "rotate-180",
          )}
        />
        {showAll ? "Show only differences" : "Show all fields"}
      </button>
    </div>
  );

  return (
    <div ref={setRoot} className="space-y-3">
      {loose.map((caveat) => (
        <Caveat key={caveat} id={caveatId(caveat)}>
          {caveat}
        </Caveat>
      ))}
      <p id={labelId} className={LABEL}>
        Contact to keep
      </p>
      {asTable ? (
        <div
          role="radiogroup"
          aria-labelledby={labelId}
          className="grid gap-x-2 gap-y-1 text-sm"
          style={{
            gridTemplateColumns: `6.5rem repeat(${contacts.length}, minmax(0, 1fr))`,
          }}
        >
          <span />
          {contacts.map((c, i) => (
            <div key={c.id} className="pb-1">
              {choice(c, i)}
            </div>
          ))}
          {shownRows.map((row) => (
            <Fragment key={row.key}>
              <div className="px-1 py-2">
                <RowLabel
                  label={row.label}
                  differs={differs(row)}
                  flagged={flags.has(row.key)}
                />
              </div>
              {contacts.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    "px-3 py-2 rounded-lg min-w-0 break-words",
                    c.id === keeper.id && "bg-primary/5",
                  )}
                >
                  <Value dropped={dropped(c, row.field)}>{row.render(c)}</Value>
                </div>
              ))}
              {(caveatsAbove ? [] : wordsUnder(row.key)).map((caveat) => (
                <div
                  key={caveat}
                  className="col-start-2 col-span-full px-3 pb-1"
                >
                  <Caveat id={caveatId(caveat)}>{caveat}</Caveat>
                </div>
              ))}
            </Fragment>
          ))}
        </div>
      ) : (
        <div
          role="radiogroup"
          aria-labelledby={labelId}
          className="grid gap-3"
          style={{
            gridTemplateColumns:
              contacts.length > 3
                ? "repeat(auto-fill, minmax(15rem, 1fr))"
                : undefined,
          }}
        >
          {contacts.map((c, i) => (
            <div
              key={c.id}
              className={cn(
                "rounded-2xl p-3 space-y-2 min-w-0",
                c.id === keeper.id
                  ? "bg-primary/5"
                  : "bg-surface-container-low/60",
              )}
            >
              {choice(c, i)}
              <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-sm px-1">
                {shownRows.map((row) => {
                  const shown = row.render(c);
                  if (shown === null) return null;
                  return (
                    <Fragment key={row.key}>
                      <dt>
                        <RowLabel
                          label={row.label}
                          differs={differs(row)}
                          flagged={flags.has(row.key)}
                        />
                      </dt>
                      <dd className="min-w-0 break-words">
                        <Value dropped={dropped(c, row.field)}>{shown}</Value>
                      </dd>
                    </Fragment>
                  );
                })}
              </dl>
            </div>
          ))}
        </div>
      )}
      {sameLine}
      <MergeOutcomeSummary keeper={keeper} others={others} />
    </div>
  );
};

/**
 * "role "Investor"" or, in a group, "role "Investor" (Elena Marchetti)". A
 * name names its own contact, so it goes without.
 */
const outcomePart = (
  line: { field: SingleField; label: string; value: string; from: string },
  named: boolean,
) => {
  const value =
    line.value.length > 40 ? `${line.value.slice(0, 40)}…` : line.value;
  const from = named && line.field !== "name" ? ` (${line.from})` : "";
  return `${line.label.toLowerCase()} "${value}"${from}`;
};

/**
 * What the merge does, in three lines: what moves to the contact kept,
 * what it drops, and that Undo brings it all back.
 */
function MergeOutcomeSummary({
  keeper,
  others,
}: {
  keeper: ReviewContact;
  others: ReviewContact[];
}) {
  const { notKept, filled, moves } = mergeOutcome(keeper, others);
  const named = others.length > 1;
  const moving = [
    movesSentence(moves),
    ...filled.map((line) => outcomePart(line, named)),
  ].filter(Boolean);
  return (
    <div className="rounded-xl bg-surface-container-low p-4 space-y-2 text-sm">
      <p className={LABEL}>After the merge</p>
      <ul className="space-y-1.5">
        <li className="flex items-start gap-2">
          <ArrowRight
            aria-hidden="true"
            className="w-4 h-4 mt-0.5 shrink-0 text-primary"
          />
          <span>
            {moving.length > 0 ? (
              <>
                Moves to <span className="font-bold">{keeper.name}</span>:{" "}
                {moving.join(", ")}
              </>
            ) : (
              <>
                <span className="font-bold">{keeper.name}</span> stays as it is
              </>
            )}
          </span>
        </li>
        {notKept.length > 0 && (
          <li className="flex items-start gap-2">
            <CircleSlash
              aria-hidden="true"
              className="w-4 h-4 mt-0.5 shrink-0 text-warning"
            />
            <span>
              Not kept:{" "}
              {notKept.map((line) => outcomePart(line, named)).join(", ")}
            </span>
          </li>
        )}
        <li className="flex items-start gap-2 text-on-surface-variant">
          <Undo2 aria-hidden="true" className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Undo brings everything back for 90 days</span>
        </li>
      </ul>
    </div>
  );
}
