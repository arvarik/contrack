/**
 * TrackButton: whether a person keeps up with this contact, and how often.
 *
 * One menu button beside the kebab. The button says the state, and the menu
 * holds every way to change it:
 * 1. Untracked, the button reads Track. Each row tracks the contact at that
 *    cadence in one press (`trackAt`). The account default reads "Default".
 * 2. Tracked, the button reads the cadence in the selected tint. The rows
 *    change it (`useSetCadence`), and Stop tracking untracks with an Undo
 *    (`useTrackToggle`).
 * 3. A stored cadence off the four words (such as 60 days) shows as one more
 *    checked row, and the button says it short: "2 months".
 * 4. Custom… asks for a number of days, up to ten years.
 *
 * The button keeps one width whatever it says. The header cluster is
 * right-aligned, so a control that grows pulls its own label out from under
 * the pointer. `tests/e2e/contact.spec.ts` measures the box.
 *
 * The `t` key toggles at the default cadence (`useTrackShortcut`). The
 * "Contact actions" menu has no Track item: one control per concept.
 */
import { useState, type FormEvent } from "react";
import { ChevronDown, CircleSlash, Radar } from "lucide-react";
import { toast } from "sonner";
import {
  CADENCE_DAYS,
  DEFAULT_CADENCE_DAYS,
  MAX_CADENCE_DAYS,
  cadenceOptions,
  describeCadence,
  shortCadence,
} from "../../../../shared/cadence";
import { Modal } from "../../../components/ui/Modal";
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
import { DIALOG_ACTIONS, FORM_INPUT, SELECTED_TINT } from "../../../lib/styles";
import { cn } from "../../../lib/utils";

interface TrackButtonProps {
  contact: TrackableContact;
  /** The narrow header: the glyph, and the cadence word once tracked. */
  compact?: boolean;
}

/** The button's name before the contact is tracked. */
const TRACK_LABEL = "Track, choose how often";

/** The button's name while tracked: "Tracking quarterly, change or stop". */
const trackingLabel = (cadenceDays: number) =>
  `Tracking ${describeCadence(cadenceDays, { sentence: true })}, change or stop`;

/** Every word the button can show for this contact. They size the label. */
const SIZER_WORDS = ["Track", ...CADENCE_DAYS.map(shortCadence)];

/** 32 px tall, the height of `.btn-sm`. The sides are set per use. */
const SHAPE = "h-8 gap-1 p-0 rounded-md text-[13px] leading-none font-bold";

/** The ink stays on hover and while open, so the button never reads as off. */
const ON = cn(SELECTED_TINT, "hover:text-on-primary-wash");

const OFF = "bg-surface-container-high text-on-surface hover:text-on-surface";

export const TrackButton = ({ contact, compact = false }: TrackButtonProps) => {
  const { toggle, trackAt, isPending } = useTrackToggle();
  const setCadence = useSetCadence();
  const { preferences } = usePreferences();
  const defaultDays = preferences.defaultCadenceDays ?? DEFAULT_CADENCE_DAYS;
  const { cadenceDays, isTracked: on } = contact;
  const word = on ? shortCadence(cadenceDays) : "Track";
  const label = on ? trackingLabel(cadenceDays) : TRACK_LABEL;
  // A change on its way: the rows wait for it, so two presses cannot race.
  const busy = isPending || setCadence.isPending;
  /** Custom… is asking for a number of days. */
  const [asking, setAsking] = useState(false);

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

  // Untracked, no row is checked and the stored cadence is not offered:
  // nobody chose it for this contact.
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
  items.push({
    id: "custom",
    label: "Custom…",
    separatorBefore: true,
    disabled: busy,
    onSelect: () => setAsking(true),
  });
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

  const saveCustom = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const days = Number(new FormData(event.currentTarget).get("days"));
    setAsking(false);
    if (on) change(days);
    else trackAt(contact, days);
  };

  return (
    <>
      <ActionMenu
        label={label}
        title={compact ? label : undefined}
        heading="Keep up"
        items={items}
        align="end"
        panelClassName="min-w-44"
        triggerClassName={cn(
          SHAPE,
          compact ? "px-2" : "pl-2 pr-1.5",
          on ? ON : OFF,
        )}
        triggerContent={
          <>
            {compact ? (
              <span className="flex items-center gap-1 whitespace-nowrap">
                {glyph}
                {on && word}
              </span>
            ) : (
              // One grid cell: the invisible sizers set the width, and the
              // glyph and word sit centered over them. `pl-5` leaves room for
              // the 16 px glyph and the 4 px gap.
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
      <Modal
        isOpen={asking}
        onClose={() => setAsking(false)}
        title="How often to keep up"
        size="sm"
      >
        {/* The browser holds the number to a whole one from 1 to ten years. */}
        <form onSubmit={saveCustom} className="space-y-4">
          <label className="flex items-center gap-2 text-sm text-on-surface">
            Every
            <input
              name="days"
              type="number"
              inputMode="numeric"
              required
              min={1}
              max={MAX_CADENCE_DAYS}
              step={1}
              defaultValue={on ? cadenceDays : defaultDays}
              className={cn(FORM_INPUT, "w-24")}
            />
            days
          </label>
          <div className={DIALOG_ACTIONS}>
            <button
              type="button"
              onClick={() => setAsking(false)}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              {on ? "Save" : "Track"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
};
