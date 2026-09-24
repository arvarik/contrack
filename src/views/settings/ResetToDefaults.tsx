/**
 * Reset to defaults: one button at the end of a settings page.
 *
 * Every row that holds an account preference (`SettingRow` with a
 * `prefKey`) tells the page's scope which key it holds. While any of those
 * keys is off its default, the page ends with one button, "Reset to
 * defaults", in the primary look of Pulse's Log note. It resets every
 * changed key on the page at once, says how many in a toast with an Undo,
 * and goes away. It also goes when a person sets each value back by hand,
 * with the dots after the rows' titles, because both read `changed`: a key
 * that is stored at its default is not changed.
 *
 * It replaced a "Reset" text button on each changed row, which moved the
 * row's controls and repeated itself down a page of changes.
 *
 * @module views/settings/ResetToDefaults
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type RefObject,
} from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { usePreferences } from "../../contexts/PreferencesContext";
import type { Preferences } from "../../api/preferences";
import { UNDO_DURATION_MS } from "../../lib/undoToast";

type PrefKey = keyof Preferences;

/** A row in the page: its key, and the row itself, for the focus after a reset. */
interface Entry {
  key: PrefKey;
  row: RefObject<HTMLElement | null>;
}

interface ResetScope {
  /** Adds a row. Returns the function that takes it away. */
  register: (entry: Entry) => () => void;
}

const ResetScopeContext = createContext<ResetScope | null>(null);

/**
 * The page's scope, for the shell: the rows its page registered, and the
 * provider to put around the page.
 */
export function useResetScope() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const register = useCallback((entry: Entry) => {
    setEntries((prev) => [...prev, entry]);
    return () => setEntries((prev) => prev.filter((item) => item !== entry));
  }, []);
  const scope = useMemo(() => ({ register }), [register]);
  return { scope, entries };
}

export const ResetScopeProvider = ResetScopeContext.Provider;

/**
 * Called by a row that holds a preference. Outside a settings page (a unit
 * test that renders one row) it does nothing.
 *
 * @param key - The preference the row holds, if any.
 * @param row - The row, which takes the focus after a reset.
 */
export function useResetScopeKey(
  key: PrefKey | undefined,
  row: RefObject<HTMLElement | null>,
) {
  const scope = useContext(ResetScopeContext);
  useLayoutEffect(() => {
    if (!key || !scope) return;
    return scope.register({ key, row });
  }, [key, row, scope]);
}

/** "1 setting is back to its default", "3 settings are back to their defaults". */
export const resetMessage = (count: number) =>
  count === 1
    ? "1 setting is back to its default"
    : `${count} settings are back to their defaults`;

export const ResetToDefaults = ({ entries }: { entries: readonly Entry[] }) => {
  const { preferences, changed, resetPreference, setPreferences } =
    usePreferences();
  const off = entries.filter((entry) => changed.includes(entry.key));
  const keys = [...new Set(off.map((entry) => entry.key))];
  if (keys.length === 0) return null;

  const reset = () => {
    const previous = Object.fromEntries(
      keys.map((key) => [key, preferences[key]]),
    ) as Partial<Preferences>;
    // The button is about to go. The keyboard lands on the first row that
    // was reset, which a screen reader reads by its title, and the page
    // stays where it is.
    const first = off
      .map((entry) => entry.row.current)
      .filter((row): row is HTMLElement => row !== null)
      .sort((a, b) =>
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
          ? -1
          : 1,
      )[0];
    keys.forEach(resetPreference);
    first?.focus({ preventScroll: true });
    toast.success(resetMessage(keys.length), {
      duration: UNDO_DURATION_MS,
      action: { label: "Undo", onClick: () => setPreferences(previous) },
    });
  };

  return (
    <div className="pt-6 flex justify-end">
      <button
        type="button"
        onClick={reset}
        className="btn-primary max-sm:w-full"
      >
        <RotateCcw className="w-4 h-4" aria-hidden="true" />
        Reset to defaults
      </button>
    </div>
  );
};
