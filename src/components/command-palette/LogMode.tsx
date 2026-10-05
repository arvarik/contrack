/**
 * The palette's `>` mode: log a note, a call, a meeting or an email in one
 * line, one step at a time (`actionMode.ts`).
 *
 * 1. `>`: the four kinds. Picking one types `> note `. Words that are no
 *    kind, as the `> Log` chip leaves them, are the name: `> nancy` offers
 *    each kind for Nancy.
 * 2. `> note Tyl`: the contacts whose names match. Picking one types
 *    `> note Tyler Jackson: `.
 * 3. `> note Tyler Jackson: Sent the deck`: the row that logs it, and the
 *    other people the name could mean.
 *
 * Each step is plain text in the box, so the whole line typed in one go
 * still works. It renders in two parts, as `AiMode` does: `notes` above
 * the list and `rows` inside it, which holds rows only.
 *
 * @module components/command-palette/LogMode
 */
import { Command } from "cmdk";
import {
  Calendar,
  Mail,
  MessageSquare,
  Phone,
  type LucideIcon,
} from "lucide-react";
import { fallbackAvatarUrl } from "../../lib/avatar";
import { KBD, KBD_SM } from "../../lib/styles";
import { cn } from "../../lib/utils";
import {
  findLogContact,
  LOG_KINDS,
  logContactSuggestions,
  parseLogInput,
  type LogKind,
} from "./actionMode";
import { GROUP_HEADING_EMERALD, ITEM_CURRENT } from "./utils";

interface LogContact {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

/** What one kind looks like, and how a sentence names it. */
const LOG_KIND_LOOK: Record<LogKind, { icon: LucideIcon; label: string }> = {
  note: { icon: MessageSquare, label: "Log a note" },
  call: { icon: Phone, label: "Log a call" },
  meeting: { icon: Calendar, label: "Log a meeting" },
  email: { icon: Mail, label: "Log an email" },
};

const ROW =
  "flex items-center gap-3 px-3 py-2 min-h-[44px] pointer-fine:min-h-0 rounded-xl cursor-default select-none transition-colors text-sm text-on-surface";

const Hint = ({ children }: { children: React.ReactNode }) => (
  <p className="px-3 pt-3 pb-1 text-xs text-on-surface-variant">{children}</p>
);

export const LogMode = ({
  part,
  input,
  contacts,
  recentContacts,
  discardArmed,
  onFill,
  onLog,
  onCompose,
}: {
  part: "notes" | "rows";
  /** The whole input, `>` and all. */
  input: string;
  contacts: readonly LogContact[];
  /** Offered first when no name is typed yet. */
  recentContacts: readonly LogContact[];
  /** Escape was pressed once on a typed note: the next one discards it. */
  discardArmed: boolean;
  /** Puts this text in the input: the next step. */
  onFill: (text: string) => void;
  onLog: (log: { kind: LogKind; contact: LogContact; text: string }) => void;
  /**
   * A touch screen picked the contact: open the composer, a text area with
   * Save, rather than a one-line box that hides a longer note.
   */
  onCompose: (log: {
    kind: LogKind;
    contact: LogContact;
    text: string;
  }) => void;
}) => {
  const step = parseLogInput(input);

  if (step.step === "kind") {
    const typed = step.partial.toLowerCase();
    const kinds = LOG_KINDS.filter((kind) => kind.startsWith(typed));
    // No kind starts with the words: they are a name.
    const name = kinds.length === 0 ? step.partial : "";
    if (part === "notes") {
      return name ? null : (
        <Hint>
          Pick a kind
          {/* The one-line form is for a keyboard. */}
          <span className="pointer-coarse:hidden">
            , or type the whole line:{" "}
            <code className="text-on-surface">
              &gt; note Julian: Left a voicemail
            </code>
          </span>
        </Hint>
      );
    }
    return (
      <Command.Group
        heading={name ? `Log for "${name}"` : "Log"}
        className={GROUP_HEADING_EMERALD}
      >
        {(name ? LOG_KINDS : kinds).map((kind) => {
          const { icon: Icon, label } = LOG_KIND_LOOK[kind];
          return (
            <Command.Item
              key={kind}
              value={`logkind_${kind}`}
              onSelect={() => onFill(`> ${kind} ${name}`)}
              className={cn(ROW, ITEM_CURRENT)}
            >
              <Icon className="w-4 h-4 text-success shrink-0" />
              <span className="flex-1">{label}</span>
              <kbd className={cn(KBD_SM, "hidden pointer-fine:inline-flex")}>
                &gt; {kind}
              </kbd>
            </Command.Item>
          );
        })}
      </Command.Group>
    );
  }

  const { label } = LOG_KIND_LOOK[step.kind];
  const noun = step.kind;
  const typedName = step.step === "contact" ? step.partial : step.name;
  const contact =
    step.step === "text" ? findLogContact(contacts, step.name) : undefined;
  // Picking the contact: the names typed so far, or the recent ones first.
  const pool = typedName
    ? contacts
    : [
        ...recentContacts,
        ...contacts.filter((c) => !recentContacts.some((r) => r.id === c.id)),
      ];
  const suggestions = logContactSuggestions(pool, typedName);
  const personRows = (people: readonly LogContact[], text: string) =>
    people.map((person) => (
      <Command.Item
        key={person.id}
        value={`logto_${person.id}_${person.name}`}
        onSelect={() =>
          window.matchMedia?.("(pointer: coarse)").matches
            ? onCompose({ kind: step.kind, contact: person, text })
            : onFill(`> ${step.kind} ${person.name}: ${text}`)
        }
        className={cn(ROW, ITEM_CURRENT)}
      >
        <img
          src={person.avatarUrl || fallbackAvatarUrl(person.name)}
          alt=""
          className="w-6 h-6 rounded-full bg-surface-container-highest object-cover shrink-0"
        />
        <span className="truncate flex-1">{person.name}</span>
      </Command.Item>
    ));

  if (step.step === "text" && contact) {
    if (part === "notes") {
      if (discardArmed) {
        return (
          <Hint>
            {/* A phone's Back steps back as Escape does. */}
            <span className="pointer-coarse:hidden">
              Press <kbd className={KBD_SM}>Esc</kbd> again
            </span>
            <span className="hidden pointer-coarse:inline">Go back again</span>{" "}
            to discard this {noun}
          </Hint>
        );
      }
      return step.text ? null : (
        <Hint>
          Type the {noun} for {contact.name} after the colon, then press Enter
        </Hint>
      );
    }
    if (!step.text) return null;
    const { icon: Icon } = LOG_KIND_LOOK[step.kind];
    // The words could mean someone else: "Nancy" with two Nancys.
    const others =
      contact.name.toLowerCase() === step.name.toLowerCase()
        ? []
        : suggestions.filter((p) => p.id !== contact.id).slice(0, 3);
    return (
      <>
        <Command.Group heading="Log" className={GROUP_HEADING_EMERALD}>
          <Command.Item
            value={`action_${step.kind}_${contact.id}`}
            onSelect={() =>
              onLog({ kind: step.kind, contact, text: step.text })
            }
            className={cn(
              "flex items-center gap-4 px-3 py-3 rounded-xl cursor-default select-none bg-success/10 transition-colors text-on-surface",
              ITEM_CURRENT,
            )}
          >
            <div className="w-10 h-10 flex items-center justify-center bg-success/20 text-success rounded-full shrink-0">
              <Icon className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0 flex flex-col">
              <span className="font-bold text-sm block truncate">
                Log {noun} for{" "}
                <span className="text-success">{contact.name}</span>
              </span>
              <span className="text-sm text-on-surface-variant truncate mt-0.5">
                "{step.text}"
              </span>
            </div>
            <kbd
              className={cn(KBD, "shrink-0 hidden pointer-fine:inline-flex")}
            >
              Enter
            </kbd>
          </Command.Item>
        </Command.Group>
        {others.length > 0 && (
          <Command.Group heading="Or for" className={GROUP_HEADING_EMERALD}>
            {personRows(others, step.text)}
          </Command.Group>
        )}
      </>
    );
  }

  if (suggestions.length === 0) {
    return part === "notes" ? (
      <Hint>No contact matches "{typedName}"</Hint>
    ) : null;
  }
  if (part === "notes") return null;
  return (
    <Command.Group heading={`${label} for…`} className={GROUP_HEADING_EMERALD}>
      {personRows(suggestions, step.step === "text" ? step.text : "")}
    </Command.Group>
  );
};
