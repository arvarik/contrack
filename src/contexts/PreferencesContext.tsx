/**
 * The account's settings, and the theme they paint. They live on the
 * account, not in `localStorage`, so they follow it to another device and
 * two people on one browser do not share them.
 *
 * One fetch, one cache, one writer. The provider sits inside AuthGate's
 * identity-keyed wrapper, so a new sign-in starts it again. `preferences` is
 * the defaults until the fetch resolves, never `undefined`. Writes are
 * optimistic: the worst case is a preference that reverts.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
import { errorText } from "../lib/utils";

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
 * The account's preferences and a way to change one. Outside the provider:
 * the defaults and a setter that does nothing.
 */
export const usePreferences = () => useContext(PreferencesContext);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isSuccess } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchPreferences,
    // This provider is the only writer, so a refetch on focus could only
    // replace an optimistic value with a stale one.
    staleTime: Infinity,
    gcTime: Infinity,
  });

  // Until the account answers, the theme and the accent are what this
  // browser last painted (the boot script's), so a load does not flash the
  // defaults.
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
      // The write failed: put the previous value back.
      if (context?.previous) {
        queryClient.setQueryData(QUERY_KEY, context.previous);
      }
      toast.error(`Could not save the setting: ${errorText(err)}`);
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
      toast.error(`Could not reset the setting: ${errorText(err)}`);
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

  // `mutate` is stable. The mutation object is new on each state.
  const { mutate: resetMutate } = resetMutation;
  const resetPreference = useCallback(
    (key: keyof Preferences) => resetMutate(key),
    [resetMutate],
  );

  // `mode` is derived, not stored, so the attribute on <html> and the value
  // consumers read land in the same commit. The subscription also follows a
  // system that switches palette at sunset.
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
