/**
 * TrackButton: whether a person keeps up with this contact, and how often.
 *
 * One menu button beside the kebab. The button says the state, and the menu
 * holds every way to change it:
 *
 * ```
 *   untracked                     tracked
 *   ┌───────────────┐             ┌───────────────┐
 *   │ ◎ Track     ▾ │             │ ◎ Quarterly ▾ │
 *   └───────────────┘             └───────────────┘
 *   KEEP UP                       KEEP UP
 *     Weekly                        Weekly
 *     Monthly                       Monthly
 *     Quarterly       Default       Quarterly           ✓
 *     Yearly                        Yearly
 *                                   ───────────────────
 *                                   ⊘ Stop tracking
 * ```
 *
 * 1. Untracked, the button reads Track on the container fill. Each row
 *    tracks the contact at that cadence in one press (`trackAt`), and the
 *    account's default cadence carries the hint "Default".
 * 2. Tracked, the button reads the cadence, one word, in the selected tint
 *    that every toggle wears when it is on, with the Radar glyph in the
 *    primary. The rows change the cadence (`useSetCadence`) with the current
 *    one checked, and Stop tracking, under a hairline, untracks with an Undo
 *    (`useTrackToggle`, the same toast as everywhere else).
 * 3. A cadence off the four words, 60 or 180 days saved before 2.0 or any
 *    value the API took, shows as one more checked row in its place in the
 *    order ("Every 2 months"), and the button says it short: "2 months".
 *    Untracked, an account default off the list is that extra row.
 *
 * It was a split button: the word a toggle, and a caret behind a hairline
 * that held five cadences in sentences ("Every 3 months"). The owner asked
 * for something smaller and sleeker, with single words and no line down the
 * middle. One control does both jobs: the one thing a person does here is
 * choose how often, and stopping is one of the choices.
 *
 * **One width, whatever it says.** Every word the button can show from the
 * menu, the default and the `t` key is drawn in one grid cell, invisibly,
 * and the glyph and the current word are drawn over them, centred. The cell
 * is as wide as the widest word, so choosing a cadence never moves the
 * control's left edge. That matters because the header's cluster is
 * right-aligned: a control that grows pulls its own label out from under
 * the pointer. `tests/e2e/contact.spec.ts` measures the box before and
 * after, and checks that the glyph and the word sit in the middle.
 *
 * **Size.** 32 px tall, the height of `.btn-sm`, with tight sides, 13 px
 * bold type, a 12 px chevron and the 44 px tap box of `hit-area`: about
 * 110 px wide at its widest word. It is flat and hovers with the one state
 * layer, because it is a toggle's face, not a call to action. The menu is
 * as slim as its words (11 rem, where other menus start at 13). The narrow
 * header has room for the glyph and the chevron: the word moves into the
 * accessible name and the tooltip.
 *
 * The `t` key stays a one-key toggle at the account's default cadence
 * (`useTrackShortcut`), as the palette's row is. The ring around the avatar
 * appears or goes with the flag, because both read the same contact. The
 * "Contact actions" menu gets no Track item: one control per concept.
 */
import { ChevronDown, CircleSlash, Radar } from "lucide-react";
import { toast } from "sonner";
import {
  CADENCE_DAYS,
  DEFAULT_CADENCE_DAYS,
  cadenceOptions,
  describeCadence,
  shortCadence,
} from "../../../../shared/cadence";
import { useSetCadence } from "../../../api/contacts";
import {
  useTrackToggle,
  type TrackableContact,
} from "../../../hooks/useTrackToggle";
import { usePreferences } from "../../../contexts/PreferencesContext";
import {
  ActionMenu,
  type ActionMenuItem,
} from "../../../components/ui/ActionMenu";
import { SELECTED_TINT } from "../../../lib/styles";
import { cn } from "../../../lib/utils";

export interface TrackButtonProps {
  contact: TrackableContact;
  /** The narrow header: the glyph and the chevron, with the word in the name. */
  compact?: boolean;
  className?: string;
}

/** The button's name before the contact is tracked. */
export const TRACK_LABEL = "Track, choose how often";

/** The button's name while tracked: "Tracking quarterly, change or stop". */
export const trackingLabel = (cadenceDays: number) =>
  `Tracking ${describeCadence(cadenceDays, { sentence: true })}, change or stop`;

/**
 * Every word the button can come to show without a change of contact: Track,
 * and each accepted cadence. They size the label's cell.
 */
const SIZER_WORDS = ["Track", ...CADENCE_DAYS.map(shortCadence)];

/**
 * The shape: 32 px tall, 4 px corners, 13 px bold, 4 px between the parts.
 * The trigger's own padding goes, and the sides are set here, a little
 * tighter after the chevron.
 */
const SHAPE = "h-8 gap-1 p-0 rounded-md text-[13px] leading-none font-bold";

/**
 * On: the selected tint. The ink stays on hover and while the menu is open,
 * so the button never reads as off.
 */
const ON = cn(SELECTED_TINT, "hover:text-on-primary-wash");

/** Off: the container fill, flat. */
const OFF = "bg-surface-container-high text-on-surface hover:text-on-surface";

export const TrackButton = ({
  contact,
  compact = false,
  className,
}: TrackButtonProps) => {
  const { toggle, trackAt, isPending } = useTrackToggle();
  const setCadence = useSetCadence();
  const { preferences } = usePreferences();
  const defaultDays = preferences.defaultCadenceDays ?? DEFAULT_CADENCE_DAYS;
  const { cadenceDays, isTracked: on } = contact;
  const word = on ? shortCadence(cadenceDays) : "Track";
  const label = on ? trackingLabel(cadenceDays) : TRACK_LABEL;
  // A change on its way: the rows wait for it, so two presses cannot race.
  const busy = isPending || setCadence.isPending;

  const change = (days: number) => {
    if (days === cadenceDays) return;
    setCadence.mutate(
      { id: contact.id, cadenceDays: days },
      {
        onSuccess: () =>
          toast.success(
            `${contact.name}, ${describeCadence(days, { sentence: true })}`,
          ),
      },
    );
  };

  // Untracked, the rows are ways to take one action, so none is checked:
  // there is no cadence yet to be the current one. The contact's stored
  // cadence is not shown then, because nobody chose it for this contact.
  const items: ActionMenuItem[] = cadenceOptions(
    on ? cadenceDays : defaultDays,
  ).map((days) => ({
    id: String(days),
    label: describeCadence(days),
    checked: on ? days === cadenceDays : undefined,
    hint: days === defaultDays ? "Default" : undefined,
    speakHint: true,
    disabled: busy,
    onSelect: () => (on ? change(days) : trackAt(contact, days)),
  }));
  if (on) {
    items.push({
      id: "stop",
      label: "Stop tracking",
      icon: CircleSlash,
      separatorBefore: true,
      disabled: busy,
      onSelect: () => toggle(contact),
    });
  }

  const sizers = SIZER_WORDS.includes(word)
    ? SIZER_WORDS
    : [...SIZER_WORDS, word];

  const glyph = (
    <Radar
      aria-hidden="true"
      className={cn("w-4 h-4 shrink-0", on && "text-primary")}
    />
  );

  return (
    <ActionMenu
      label={label}
      title={compact ? label : undefined}
      heading="Keep up"
      items={items}
      align="end"
      className={className}
      panelClassName="min-w-44"
      triggerClassName={cn(
        SHAPE,
        compact ? "px-2" : "pl-2 pr-1.5",
        on ? ON : OFF,
      )}
      triggerContent={
        <>
          {compact ? (
            glyph
          ) : (
            // One cell, many layers: the words it may show, invisible, set
            // the width, and the glyph and the current word are drawn over
            // them together, centred. A short word such as Track sits in
            // the middle of the button, not against its left edge with a
            // gap before the chevron. Each sizer leaves room for the glyph
            // and the gap after it: `pl-5` is the 16 px glyph and 4 px.
            <span className="grid">
              {sizers.map((sizer) => (
                <span
                  key={sizer}
                  aria-hidden="true"
                  className="col-start-1 row-start-1 invisible whitespace-nowrap pl-5"
                >
                  {sizer}
                </span>
              ))}
              <span className="col-start-1 row-start-1 flex items-center justify-center gap-1 whitespace-nowrap">
                {glyph}
                {word}
              </span>
            </span>
          )}
          <ChevronDown aria-hidden="true" className="w-3 h-3 shrink-0" />
        </>
      }
    />
  );
};
