/**
 * The rows of the palette's `>` mode: log a note, a call, a meeting or an
 * email in one line, one step at a time (`actionMode.ts`).
 *
 * 1. `>`: the four kinds. Picking one types `> note `.
 * 2. `> note Tyl`: the contacts whose names match. Picking one types
 *    `> note Tyler Jackson: `.
 * 3. `> note Tyler Jackson: Sent the deck`: the row that logs it.
 *
 * Each step is plain text in the box, so the whole line typed in one go
 * still works, and the row in step 3 names the contact it will log for.
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
const LOG_KIND_LOOK: Record<
  LogKind,
  { icon: LucideIcon; label: string; noun: string }
> = {
  note: { icon: MessageSquare, label: "Log a note", noun: "note" },
  call: { icon: Phone, label: "Log a call", noun: "call" },
  meeting: { icon: Calendar, label: "Log a meeting", noun: "meeting" },
  email: { icon: Mail, label: "Log an email", noun: "email" },
};

const ROW =
  "flex items-center gap-3 px-3 py-2 min-h-[44px] sm:min-h-0 rounded-xl cursor-default select-none transition-colors text-sm text-on-surface";

/** A line of help under the rows. Not a row: nothing to pick. */
const Hint = ({ children }: { children: React.ReactNode }) => (
  <p className="px-3 py-3 text-xs text-on-surface-variant">{children}</p>
);

const Example = () => (
  <Hint>
    Or type it in one line:{" "}
    <code className="text-on-surface">&gt; note Julian: Left a voicemail</code>
  </Hint>
);

export const LogMode = ({
  input,
  contacts,
  recentContacts,
  onFill,
  onLog,
}: {
  /** The whole input, `>` and all. */
  input: string;
  contacts: readonly LogContact[];
  /** Offered first when no name is typed yet. */
  recentContacts: readonly LogContact[];
  /** Puts this text in the input: the next step. */
  onFill: (text: string) => void;
  onLog: (log: { kind: LogKind; contact: LogContact; text: string }) => void;
}) => {
  const step = parseLogInput(input);

  if (step.step === "kind") {
    const typed = step.partial.toLowerCase();
    const kinds = LOG_KINDS.filter((kind) => kind.startsWith(typed));
    if (kinds.length === 0) {
      return <Hint>Start with the kind: note, call, meeting or email</Hint>;
    }
    return (
      <>
        <Command.Group heading="Log" className={GROUP_HEADING_EMERALD}>
          {kinds.map((kind) => {
            const { icon: Icon, label } = LOG_KIND_LOOK[kind];
            return (
              <Command.Item
                key={kind}
                value={`logkind_${kind}`}
                onSelect={() => onFill(`> ${kind} `)}
                className={cn(ROW, ITEM_CURRENT)}
              >
                <Icon className="w-4 h-4 text-success shrink-0" />
                <span className="flex-1">{label}</span>
                <kbd className={cn(KBD_SM, "hidden sm:inline-flex")}>
                  &gt; {kind}
                </kbd>
              </Command.Item>
            );
          })}
        </Command.Group>
        <Example />
      </>
    );
  }

  const { noun } = LOG_KIND_LOOK[step.kind];
  const typedName = step.step === "contact" ? step.partial : step.name;
  const contact =
    step.step === "text" ? findLogContact(contacts, step.name) : undefined;

  if (step.step === "text" && contact) {
    if (!step.text) {
      return (
        <Hint>
          Type the {noun} for {contact.name} after the colon, then press Enter
        </Hint>
      );
    }
    const { icon: Icon } = LOG_KIND_LOOK[step.kind];
    return (
      <Command.Group heading="Log" className={GROUP_HEADING_EMERALD}>
        <Command.Item
          value={`action_${step.kind}_${contact.id}`}
          onSelect={() => onLog({ kind: step.kind, contact, text: step.text })}
          className={cn(
            "flex items-center gap-4 px-3 py-4 rounded-xl cursor-default select-none bg-success/10 transition-colors text-on-surface",
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
          <kbd className={cn(KBD, "shrink-0 hidden sm:inline-flex")}>Enter</kbd>
        </Command.Item>
      </Command.Group>
    );
  }

  // Picking the contact: the names typed so far, or the recent ones first.
  const pool = typedName
    ? contacts
    : [
        ...recentContacts,
        ...contacts.filter((c) => !recentContacts.some((r) => r.id === c.id)),
      ];
  const suggestions = logContactSuggestions(pool, typedName);
  const text = step.step === "text" ? step.text : "";
  if (suggestions.length === 0) {
    return <Hint>No contact matches "{typedName}"</Hint>;
  }
  return (
    <Command.Group
      // "Log an email for…": the label carries the article.
      heading={`${LOG_KIND_LOOK[step.kind].label} for…`}
      className={GROUP_HEADING_EMERALD}
    >
      {suggestions.map((person) => (
        <Command.Item
          key={person.id}
          value={`logto_${person.id}_${person.name}`}
          onSelect={() => onFill(`> ${step.kind} ${person.name}: ${text}`)}
          className={cn(ROW, ITEM_CURRENT)}
        >
          <img
            src={person.avatarUrl || fallbackAvatarUrl(person.name)}
            alt=""
            className="w-6 h-6 rounded-full bg-surface-container-highest object-cover shrink-0"
          />
          <span className="truncate flex-1">{person.name}</span>
        </Command.Item>
      ))}
    </Command.Group>
  );
};
