/**
 * Choose the color the app is built around: a radiogroup of presets and a
 * native color well. The swatches show the derived primary, not the raw
 * pick, so a pale yellow shows as the brown-gold the contrast rules make.
 */
import { useId, useRef } from "react";
import { Check } from "lucide-react";
import { cn } from "../../lib/utils";
import { SWATCH_SELECTED } from "../../lib/styles";
import {
  ACCENT_TOKENS,
  deriveAccent,
  DEFAULT_ACCENT,
  PALETTES,
  type AccentTokens,
  type ResolvedMode,
} from "../../lib/theme";

/**
 * The presets, named for a screen reader. No violet, the AI color's hue:
 * each preset keeps `AI_HUE_CLEARANCE` degrees from it
 * (`tests/unit/frontend/style/themeContrast.test.ts`).
 */
export const ACCENT_PRESETS: readonly { value: string; label: string }[] = [
  { value: DEFAULT_ACCENT, label: "Contrack blue" },
  { value: "#0f766e", label: "Teal" },
  { value: "#15803d", label: "Green" },
  { value: "#b45309", label: "Amber" },
  { value: "#be123c", label: "Rose" },
  // Hue 339: the derived dark primary sits 41 degrees from the dark AI
  // color.
  { value: "#b0158f", label: "Magenta" },
  { value: "#334155", label: "Slate" },
];

/**
 * What the app paints for this accent. Not derived for the default:
 * `applyTheme` keeps the hand-tuned palette for it.
 */
function swatchTokens(hex: string, mode: ResolvedMode): AccentTokens {
  if (hex !== DEFAULT_ACCENT) return deriveAccent(hex, mode);
  const palette = PALETTES[mode];
  return Object.fromEntries(
    ACCENT_TOKENS.map((token) => [token, palette[token]]),
  ) as AccentTokens;
}

export const AccentPicker = ({
  value,
  onChange,
  mode,
}: {
  value: string;
  onChange: (next: string) => void;
  /** The palette on screen. The same accent derives differently in each. */
  mode: ResolvedMode;
}) => {
  const wellId = useId();
  const group = useRef<HTMLDivElement>(null);
  const normalized = value.toLowerCase();
  const isPreset = ACCENT_PRESETS.some((p) => p.value === normalized);

  /**
   * Arrows move the selection and the focus, as a radiogroup promises: only
   * one option is a Tab stop.
   */
  const onKeyDown = (event: React.KeyboardEvent) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = ACCENT_PRESETS.findIndex((p) => p.value === normalized);
    // A custom color is not in the row, so an arrow starts from the default.
    const from = index === -1 ? 0 : index;
    const next =
      ACCENT_PRESETS[
        (from + step + ACCENT_PRESETS.length) % ACCENT_PRESETS.length
      ];
    onChange(next.value);
    const buttons = group.current?.querySelectorAll("button");
    buttons?.[ACCENT_PRESETS.indexOf(next)]?.focus();
  };

  // 36 px swatches with 44 px tap boxes (`hit-area`) do not fit one row of a
  // phone card, so below `sm` they sit in two rows of four. The 8 px gap
  // keeps the tap boxes apart.
  return (
    <div className="flex items-end gap-2 sm:items-center">
      <div
        ref={group}
        role="radiogroup"
        aria-label="Accent color"
        className="grid grid-cols-4 gap-2 sm:flex sm:items-center sm:gap-1.5"
      >
        {ACCENT_PRESETS.map((preset) => {
          const selected = normalized === preset.value;
          return (
            <button
              key={preset.value}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={preset.label}
              tabIndex={
                selected || (!isPreset && preset.value === DEFAULT_ACCENT)
                  ? 0
                  : -1
              }
              onKeyDown={onKeyDown}
              onClick={() => onChange(preset.value)}
              style={{
                backgroundColor: swatchTokens(preset.value, mode).primary,
              }}
              className={cn(
                "hit-area w-9 h-9 rounded-full flex items-center justify-center transition-transform",
                "hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2",
                selected && SWATCH_SELECTED,
              )}
            >
              {selected && (
                <Check
                  className="w-3.5 h-3.5"
                  style={{
                    color: swatchTokens(preset.value, mode)["on-primary"],
                  }}
                  aria-hidden="true"
                />
              )}
            </button>
          );
        })}
      </div>

      {/*
        The label is the 44 px tap box, filled by the invisible input: a color
        input draws no `::after` for `hit-area`. The circle is a child span.
      */}
      <label
        htmlFor={wellId}
        className="group/well relative w-11 h-11 -m-1 flex items-center justify-center cursor-pointer"
        title="Any other color"
      >
        <span
          aria-hidden="true"
          className={cn(
            "w-9 h-9 rounded-full transition-transform group-hover/well:scale-110",
            "bg-[conic-gradient(red,yellow,lime,aqua,blue,magenta,red)]",
            // The input is invisible, so its ring is drawn on the circle.
            "group-has-[:focus-visible]/well:outline-2 group-has-[:focus-visible]/well:outline-offset-2 group-has-[:focus-visible]/well:outline-primary",
            !isPreset && SWATCH_SELECTED,
          )}
        />
        <span className="sr-only">Any other color</span>
        <input
          id={wellId}
          type="color"
          value={normalized}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
        />
      </label>
    </div>
  );
};
