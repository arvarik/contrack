/**
 * The palette's footer: the keys that work on the highlighted row, and
 * nothing else.
 *
 * It used to show "→ actions" and "Hold Shift to peek" in AI and `>` modes
 * and with no results, where neither did anything, and "Enter to select"
 * where Enter did nothing. Now `Enter` says what it does to this row, and
 * `Esc` says what it does next: back, clear or close.
 *
 * @module components/command-palette/PaletteFooter
 */
import { KBD_SM, SECTION_BG } from "../../lib/styles";

/** What Enter does to the highlighted row, or null for no row. */
export type EnterAction =
  "open" | "search" | "go" | "ask" | "log" | "pick" | "create" | null;

/**
 * What Enter does to a row, read from its cmdk value. A people row's value
 * is its id and name, with no prefix, so anything unknown opens.
 */
export function enterActionFor(row: string): EnterAction {
  if (!row) return null;
  if (row.startsWith("history_")) return "search";
  if (row.startsWith("nav_") || row.startsWith("Settings: ")) return "go";
  if (row.startsWith("starter_")) return "ask";
  if (row.startsWith("action_")) return "log";
  if (row.startsWith("logkind_") || row.startsWith("logto_")) return "pick";
  if (row.startsWith("create_")) return "create";
  return "open";
}

export const PaletteFooter = ({
  enter,
  canAct,
  canPeek,
  escape,
  tip,
}: {
  enter: EnterAction;
  /** The row is a person `→` opens actions for. */
  canAct: boolean;
  /** Shift shows a card for the row. */
  canPeek: boolean;
  /** What Escape does next. */
  escape: "back" | "clear" | "close";
  /** A line for the left side, in place of the arrow keys. */
  tip?: React.ReactNode;
}) => (
  <div
    className={`px-4 py-2.5 ${SECTION_BG} text-[11px] text-on-surface-variant hidden sm:flex items-center justify-between gap-4`}
  >
    <span className="flex items-center gap-1.5 min-w-0 truncate">
      {tip ?? (
        <>
          <kbd className={KBD_SM}>↑</kbd>
          <kbd className={KBD_SM}>↓</kbd> to move
        </>
      )}
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
        <kbd className={KBD_SM}>Esc</kbd> to {escape}
      </span>
    </span>
  </div>
);
