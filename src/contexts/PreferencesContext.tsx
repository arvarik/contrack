/**
 * PreferencesContext — the account's settings, and the theme they paint.
 *
 * Everything in here used to be a `localStorage` key read directly by whichever
 * hook wanted it. That had two faults on a shared instance: a preference set on
 * a laptop never reached a phone, and `localStorage` is keyed by origin rather
 * than by account, so two people signing in and out of one browser shared every
 * value — including the search history, which is a list of the things somebody
 * looked for.
 *
 * So there is one fetch, one cache, and one writer. The provider is mounted
 * inside AuthGate's identity-keyed wrapper, which means signing in as somebody
 * else unmounts it and starts again rather than showing the previous account's
 * choices while the new ones load.
 *
 * ── Reading before the server answers ──────────────────────────────────────
 * `preferences` is the defaults until the fetch resolves, never `undefined`.
 * A hook that has to handle "not loaded yet" makes every call site handle it
 * too, and the honest answer for every one of these settings is the default.
 *
 * ── Writing ────────────────────────────────────────────────────────────────
 * Optimistic. A density toggle that waits for a round trip feels broken, and
 * the failure case is a preference that reverts — not lost data.
 *
 * @module contexts/PreferencesContext
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  DEFAULT_PREFERENCES,
  deletePreference,
  fetchPreferences,
  isDefaultValue,
  savePreferences,
  type Preferences,
  type PreferencesResponse,
} from "../api/preferences";
import { applyTheme, readThemeCache, type ResolvedMode } from "../lib/theme";
import { takeLocalPreferences } from "../lib/localPreferenceMigration";

const QUERY_KEY = ["preferences"] as const;

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Whether the machine is asking for a dark palette right now. */
function getSystemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(DARK_QUERY).matches;
}

/** Tell React when that answer changes. */
function subscribeToColorScheme(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

interface PreferencesContextValue {
  preferences: Preferences;
  /** False until the account's own answer has arrived. */
  isLoaded: boolean;
  /** The palette actually on screen, after `system` has been resolved. */
  mode: ResolvedMode;
  /** The keys this account has actually chosen. */
  stored: (keyof Preferences)[];
  /**
   * The chosen keys whose value is not the default. A key set back to its
   * default by hand is stored, and not changed.
   */
  changed: (keyof Preferences)[];
  setPreference: <K extends keyof Preferences>(
    key: K,
    value: Preferences[K],
  ) => void;
  /** Set several keys in one request, such as an Undo of a reset. */
  setPreferences: (patch: Partial<Preferences>) => void;
  resetPreference: (key: keyof Preferences) => void;
}

const PreferencesContext = createContext<PreferencesContextValue>({
  preferences: DEFAULT_PREFERENCES,
  isLoaded: false,
  mode: "light",
  stored: [],
  changed: [],
  setPreference: () => {},
  setPreferences: () => {},
  resetPreference: () => {},
});

/**
 * The account's preferences and a way to change one.
 *
 * Safe to call anywhere inside the app. Outside the provider it answers with
 * the defaults and a setter that does nothing, which is what a test rendering
 * one component in isolation wants.
 */
export const usePreferences = () => useContext(PreferencesContext);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isSuccess } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchPreferences,
    // The account is the only writer, and this provider is the only place that
    // writes. Refetching on a window focus would replace an optimistic value
    // with a stale one for no gain.
    staleTime: Infinity,
    gcTime: Infinity,
  });

  // Until the account answers, the theme and the accent come from whatever
  // this browser last painted — which the boot script has already put on the
  // screen. Starting from the defaults instead would repaint to light and back
  // on every load, and would leave a browser that cannot reach the server
  // showing the default rather than the choice.
  const fallback = useMemo(() => {
    const cached = readThemeCache();
    return cached
      ? { ...DEFAULT_PREFERENCES, theme: cached.theme, accent: cached.accent }
      : DEFAULT_PREFERENCES;
  }, []);

  const preferences = useMemo(
    () =>
      data?.preferences
        ? { ...DEFAULT_PREFERENCES, ...data.preferences }
        : fallback,
    [data?.preferences, fallback],
  );
  const stored = useMemo(() => data?.stored ?? [], [data?.stored]);
  const changed = useMemo(
    () => stored.filter((key) => !isDefaultValue(key, preferences[key])),
    [stored, preferences],
  );

  const mutation = useMutation({
    mutationFn: savePreferences,
    onMutate: async (patch: Partial<Preferences>) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<PreferencesResponse>(QUERY_KEY);
      if (previous) {
        queryClient.setQueryData<PreferencesResponse>(QUERY_KEY, {
          preferences: { ...previous.preferences, ...patch },
          stored: [
            ...new Set([
              ...previous.stored,
              ...(Object.keys(patch) as (keyof Preferences)[]),
            ]),
          ],
        });
      }
      return { previous };
    },
    onError: (err, _patch, context) => {
      // Put the old value back. The server refused or could not be reached, and
      // a control left showing a choice that did not happen is a lie.
      if (context?.previous) {
        queryClient.setQueryData(QUERY_KEY, context.previous);
      }
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to save preference. Changes reverted",
      );
    },
    onSuccess: (response) => {
      queryClient.setQueryData<PreferencesResponse>(QUERY_KEY, (current) => {
        if (!current) return response;
        return {
          ...response,
          preferences: {
            ...response.preferences,
            ...current.preferences,
          },
          stored: [...new Set([...response.stored, ...current.stored])],
        };
      });
    },
  });

  const resetMutation = useMutation({
    mutationFn: deletePreference,
    onMutate: async (key: keyof Preferences) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<PreferencesResponse>(QUERY_KEY);
      if (previous) {
        queryClient.setQueryData<PreferencesResponse>(QUERY_KEY, {
          preferences: {
            ...previous.preferences,
            [key]: DEFAULT_PREFERENCES[key],
          },
          stored: previous.stored.filter((k) => k !== key),
        });
      }
      return { previous };
    },
    onError: (err, _key, context) => {
      if (context?.previous) {
        queryClient.setQueryData(QUERY_KEY, context.previous);
      }
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to reset preference. Changes reverted",
      );
    },
    onSuccess: (response) => {
      queryClient.setQueryData<PreferencesResponse>(QUERY_KEY, (current) => {
        if (!current) return response;
        return {
          ...response,
          preferences: {
            ...response.preferences,
            ...current.preferences,
          },
          stored: [...new Set([...response.stored, ...current.stored])],
        };
      });
    },
  });

  const { mutate } = mutation;
  const setPreferences = useCallback(
    (patch: Partial<Preferences>) => mutate(patch),
    [mutate],
  );
  const setPreference = useCallback(
    <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
      setPreferences({ [key]: value } as Partial<Preferences>);
    },
    [setPreferences],
  );

  // `mutate` is stable, the mutation object is not: a callback that closed
  // over the object changed on every state of every reset, and with it the
  // context value every consumer reads.
  const { mutate: resetMutate } = resetMutation;
  const resetPreference = useCallback(
    (key: keyof Preferences) => resetMutate(key),
    [resetMutate],
  );

  // ── The one-time move out of localStorage ────────────────────────────────
  // Runs once, after the account's own answer arrives, and only for keys the
  // account has not chosen on some other device. Then the local keys are
  // removed, which is what closes the leak between two accounts on one
  // browser: whatever is left behind cannot be read by the next person.
  const migrated = useRef(false);
  useEffect(() => {
    if (!isSuccess || !data || migrated.current) return;
    migrated.current = true;
    const local = takeLocalPreferences(data.stored);
    if (Object.keys(local).length > 0) mutate(local);
  }, [isSuccess, data, mutate]);

  // ── Painting it ──────────────────────────────────────────────────────────
  // `mode` is derived, not stored. Keeping it in `useState` and setting it from
  // the same effect that paints meant the attribute on <html> and the value
  // consumers read landed in different commits — so a component that asks
  // "which palette am I in" could be told "light" while the page was already
  // dark. `useSyncExternalStore` subscribes to the machine's preference and
  // gives every reader one answer per render.
  //
  // The subscription also does the job the old effect did: an operating system
  // that switches at sunset moves the app with it.
  const systemPrefersDark = useSyncExternalStore(
    subscribeToColorScheme,
    getSystemPrefersDark,
    () => false,
  );
  const mode: ResolvedMode =
    preferences.theme === "system"
      ? systemPrefersDark
        ? "dark"
        : "light"
      : preferences.theme;

  useEffect(() => {
    applyTheme(preferences.theme, preferences.accent);
  }, [preferences.theme, preferences.accent, mode]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute(
      "data-text-scale",
      preferences.textScale,
    );
  }, [preferences.textScale]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-motion", preferences.motion);
  }, [preferences.motion]);

  const value = useMemo<PreferencesContextValue>(
    () => ({
      preferences,
      isLoaded: isSuccess,
      mode,
      stored,
      changed,
      setPreference,
      setPreferences,
      resetPreference,
    }),
    [
      preferences,
      isSuccess,
      mode,
      stored,
      changed,
      setPreference,
      setPreferences,
      resetPreference,
    ],
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}
