/**
 * The palette's footer: only the keys that work on the highlighted row.
 * `Enter` says what it does to this row, and `Esc` what it does next: back,
 * clear or close.
 */
import { KBD_SM, SECTION_BG } from "../../lib/styles";

/** What Enter does to the highlighted row, or null for no row. */
export type EnterAction =
  "open" | "search" | "go" | "ask" | "log" | "pick" | "create" | null;

/** A row's value starts with its kind. People rows have no prefix. */
const PREFIX_ACTION: Record<string, EnterAction> = {
  history_: "search",
  nav_: "go",
  setup_: "go",
  showall_: "go",
  starter_: "ask",
  askai_: "ask",
  action_: "log",
  logkind_: "pick",
  logto_: "pick",
  filter_: "pick",
  start_: "pick",
  create_: "create",
};

/**
 * What Enter does to a row, read from its cmdk value. A people row's value
 * is its id and name, with no prefix, so anything unknown opens.
 */
export function enterActionFor(row: string): EnterAction {
  if (!row) return null;
  const prefix = row.slice(0, row.indexOf("_") + 1);
  return (
    PREFIX_ACTION[prefix] ?? (row.startsWith("Settings → ") ? "go" : "open")
  );
}

const ESCAPE_WORDS = {
  back: "go back",
  clear: "clear",
  close: "close",
  hide: "hide the values",
  discard: "discard",
} as const;

export const PaletteFooter = ({
  enter,
  canAct,
  canPeek,
  escape,
}: {
  enter: EnterAction;
  /** The row is a person `→` opens actions for. */
  canAct: boolean;
  /** Shift shows a card for the row. */
  canPeek: boolean;
  /** What Escape does next: "hide" closes the facet values, "discard" asks
   * before it throws away a typed note. */
  escape: "back" | "clear" | "close" | "hide" | "discard";
}) => (
  <div
    className={`px-4 py-2.5 ${SECTION_BG} text-[11px] text-on-surface-variant hidden pointer-fine:flex items-center justify-between gap-4`}
  >
    <span className="flex items-center gap-1.5 min-w-0 truncate">
      <kbd className={KBD_SM}>↑</kbd>
      <kbd className={KBD_SM}>↓</kbd> to move
    </span>
    <span className="flex items-center gap-3 shrink-0">
      {canAct && (
        <span>
          <kbd className={KBD_SM}>→</kbd> actions
        </span>
      )}
      {canPeek && (
        <span>
          Hold <kbd className={KBD_SM}>Shift</kbd> to peek
        </span>
      )}
      {enter && (
        <span>
          <kbd className={KBD_SM}>Enter</kbd> to {enter}
        </span>
      )}
      <span>
        <kbd className={KBD_SM}>Esc</kbd> to {ESCAPE_WORDS[escape]}
      </span>
    </span>
  </div>
);
