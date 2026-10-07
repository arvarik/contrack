/**
 * One "Reset to defaults" button at the end of a settings page. Each
 * `SettingRow` with a `prefKey` registers its key, and the button shows
 * while any key is in `changed` (a key stored at its default is not
 * changed). One button per page, not one per row, keeps row controls still.
 */
import {
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
import { withUndo } from "../../lib/undoToast";

type PrefKey = keyof Preferences;

/** The row takes the focus after a reset. */
interface Entry {
  key: PrefKey;
  row: RefObject<HTMLElement | null>;
}

interface ResetScope {
  register: (entry: Entry) => () => void;
}

const ResetScopeContext = createContext<ResetScope | null>(null);

/** The shell's side: the rows its page registered. */
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

/** A no-op outside a settings page (a unit test of one row). */
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

const resetMessage = (count: number) =>
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
    // The button is about to go, so focus moves to the first reset row
    // without a scroll.
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
    toast.success(
      resetMessage(keys.length),
      withUndo(() => setPreferences(previous)),
    );
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
