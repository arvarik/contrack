/**
 * One setting, addressable by its id. A hash link scrolls to the row and
 * flashes the selected tint for 1.2 s, with no ring, since a ring is the
 * focus ring's look. Rows space themselves 32 px apart with no line.
 *
 * A preference off its default shows a dot after the title (`CHANGED_MARK`)
 * and registers its key for the page's `ResetToDefaults` button. That pair
 * is the app's one way to show a value off its default.
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import { usePreferences } from "../../contexts/PreferencesContext";
import type { Preferences } from "../../api/preferences";
import { cn } from "../../lib/utils";
import { CHANGED_MARK } from "../../lib/styles";
import { useResetScopeKey } from "./ResetToDefaults";
import { Switch } from "../../components/ui/Switch";

interface SettingRowProps {
  /** Stable kebab-case hash id. */
  id: string;
  title: string;
  description: React.ReactNode;
  children?: React.ReactNode;
  prefKey?: keyof Preferences;
  /** A small control (a switch, a stepper) stays beside the title on a phone. */
  inline?: boolean;
  /** A wide control sits under the text at every width. */
  below?: boolean;
}

const CHANGED_LABEL = "Changed from the default";

/** Row titles are h2 under the page's h1, so headings never skip a level. */
const RowHeading = createContext<"h2" | "h3">("h2");

/** Rows under a section's h2: their titles are h3. */
export const RowsUnderHeading = ({
  children,
}: {
  children: React.ReactNode;
}) => <RowHeading.Provider value="h3">{children}</RowHeading.Provider>;

/**
 * A search result's target: when the hash is `id`, scroll to the element,
 * focus it and flash it for 1.2 s. The element needs `tabIndex={-1}`.
 */
export function useHashTarget<T extends HTMLElement>(id: string) {
  const location = useLocation();
  const ref = useRef<T>(null);
  const [flashing, setFlashing] = useState(false);

  useEffect(() => {
    const targetHash = `#${id}`;
    if (location.hash === targetHash || window.location.hash === targetHash) {
      setFlashing(true);
      ref.current?.scrollIntoView?.({
        behavior: "smooth",
        block: "nearest",
      });
      ref.current?.focus?.({ preventScroll: true });
      const timer = setTimeout(() => setFlashing(false), 1200);
      return () => clearTimeout(timer);
    }
  }, [id, location.hash]);

  return { ref, flashing };
}

export const SettingRow = ({
  id,
  title,
  description,
  children,
  prefKey,
  inline = false,
  below = false,
}: SettingRowProps) => {
  const { changed } = usePreferences();
  const Heading = useContext(RowHeading);
  const { ref: rowRef, flashing } = useHashTarget<HTMLDivElement>(id);
  useResetScopeKey(prefKey, rowRef);

  const isChanged = prefKey ? changed.includes(prefKey) : false;

  return (
    <div
      id={id}
      ref={rowRef}
      tabIndex={-1}
      className={cn(
        // No outline: the row takes focus for a screen reader, not as a
        // control, and the flash is its highlight.
        "scroll-mt-20 outline-none rounded-xl transition-colors duration-(--dur-slow)",
        // 12 px each side for the flash, taken back by the margin. The first
        // and last rows keep 8 px for the flash inside the card's padding.
        "-mx-3 px-3 py-4 first:-mt-2 first:pt-2 last:-mb-2 last:pb-2",
        flashing && "flash bg-primary/10",
      )}
    >
      <div
        className={cn(
          "flex gap-3",
          below
            ? "flex-col"
            : cn(
                "sm:flex-row sm:items-center sm:justify-between",
                inline ? "flex-row items-start justify-between" : "flex-col",
              ),
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Heading className="font-bold text-sm text-on-surface">
              {title}
            </Heading>
            {isChanged && (
              <span
                role="img"
                aria-label={CHANGED_LABEL}
                title={CHANGED_LABEL}
                className={CHANGED_MARK}
              />
            )}
          </div>
          <div className="text-xs sm:text-sm text-on-surface-variant mt-0.5 text-pretty">
            {description}
          </div>
        </div>
        {children &&
          (below ? (
            <div className="min-w-0">{children}</div>
          ) : (
            <div className="shrink-0 sm:ml-4 flex items-center gap-2">
              {children}
            </div>
          ))}
      </div>
    </div>
  );
};

type BooleanPref = {
  [K in keyof Preferences]: Preferences[K] extends boolean ? K : never;
}[keyof Preferences];

/** A row whose control is one on/off preference, named by the row's title. */
export const PrefSwitchRow = ({
  id,
  title,
  prefKey,
  description,
}: {
  id: string;
  title: string;
  prefKey: BooleanPref;
  description: string;
}) => {
  const { preferences, setPreference } = usePreferences();
  return (
    <SettingRow
      id={id}
      title={title}
      prefKey={prefKey}
      description={description}
      inline
    >
      <Switch
        label={title}
        checked={preferences[prefKey]}
        onChange={(next) => setPreference(prefKey, next)}
      />
    </SettingRow>
  );
};
