/**
 * AccentPicker — choose the colour the app is built around.
 *
 * Seven presets and a colour well. The swatches show the DERIVED primary
 * rather than the raw value somebody picked, so the control shows what the app
 * will actually look like: pick a pale yellow and the swatch is the brown-gold
 * the contrast contract turns it into, rather than a pale yellow that then
 * appears nowhere.
 *
 * A radiogroup for the presets, with the colour well beside it as a separate
 * control. The well is a native `<input type="color">` on purpose: every
 * platform already has a colour picker people know, and a hand-built one would
 * be a worse wheel with its own keyboard trap.
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
 * The presets, named so a screen reader can say which one is selected.
 *
 * No violet: the accent replaces the primary on every button and link, and
 * violet is the AI colour's hue. Each preset keeps `AI_HUE_CLEARANCE`
 * degrees away from it, which `tests/unit/theme.contrast.test.ts` holds.
 */
export const ACCENT_PRESETS: readonly { value: string; label: string }[] = [
  { value: DEFAULT_ACCENT, label: "Contrack blue" },
  { value: "#0f766e", label: "Teal" },
  { value: "#15803d", label: "Green" },
  { value: "#b45309", label: "Amber" },
  { value: "#be123c", label: "Rose" },
  // Hue 339: the derived dark primary sits 41 degrees from the dark AI
  // colour. The old #a21caf (hue 324) came within 26 of it in dark.
  { value: "#b0158f", label: "Magenta" },
  { value: "#334155", label: "Slate" },
];

/**
 * What the app will actually paint for this accent.
 *
 * The default is not derived. `applyTheme` leaves the hand-tuned palette in
 * place for it, so deriving it here would show a swatch in a colour the app
 * never uses — close, but visibly not the one on the buttons beside it.
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
   * Arrows move the selection, and take focus with them.
   *
   * The role promises this. A radiogroup whose options can only be reached by
   * Tab is a role that lies about what the control does, and only one option
   * is a tab stop — so without this the other seven are unreachable from a
   * keyboard entirely.
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
    // A custom colour is not in the row, so an arrow starts from the default.
    const from = index === -1 ? 0 : index;
    const next =
      ACCENT_PRESETS[
        (from + step + ACCENT_PRESETS.length) % ACCENT_PRESETS.length
      ];
    onChange(next.value);
    const buttons = group.current?.querySelectorAll("button");
    buttons?.[ACCENT_PRESETS.indexOf(next)]?.focus();
  };

  // Swatches are 36 px with a 44 px tap box (`hit-area`). Eight of them do not
  // fit one row of a phone card, so below `sm` the presets sit in two rows of
  // four with the colour well beside them. The 8 px gap keeps the tap boxes
  // from overlapping.
  return (
    <div className="flex items-end gap-2 sm:items-center">
      <div
        ref={group}
        role="radiogroup"
        aria-label="Accent colour"
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
        The label is the 44 px tap box and the input fills it, invisible. A
        colour input draws no `::after`, so `hit-area` cannot grow it, and an
        `overflow-hidden` label would clip its own box back to the circle. The
        circle is a child span instead.
      */}
      <label
        htmlFor={wellId}
        className="group/well relative w-11 h-11 -m-1 flex items-center justify-center cursor-pointer"
        title="Any other colour"
      >
        <span
          aria-hidden="true"
          className={cn(
            "w-9 h-9 rounded-full transition-transform group-hover/well:scale-110",
            "bg-[conic-gradient(red,yellow,lime,aqua,blue,magenta,red)]",
            !isPreset && SWATCH_SELECTED,
          )}
        />
        <span className="sr-only">Any other colour</span>
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
