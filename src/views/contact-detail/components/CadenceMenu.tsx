/**
 * CadenceMenu: the menu half of the Track split button.
 *
 * It is the caret at the right end of the button, in both states, because
 * the cadence is the second half of Track: Track says who, the cadence says
 * how often. A split button puts the one action a person takes most on the
 * left and its close relatives behind the caret, which is exactly the shape
 * of this pair:
 *
 *   untracked   pressing Track tracks at the account's default cadence, and
 *               the menu tracks at a cadence the person picks instead
 *   tracked     pressing Tracked stops tracking, and the menu changes the
 *               cadence
 *
 * So the caret is never dead and never appears from nowhere: it means the
 * same thing before and after, "how often", and the button keeps one shape.
 *
 * The caret carries no words, so its accessible name and its tooltip say
 * what it does and, once tracked, what the cadence is now. While tracked a
 * value off the list shows as a sixth checked item, so the menu never
 * claims a cadence the contact does not have.
 */
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { CADENCE_CHOICES, describeCadence } from "../../../../shared/cadence";
import { useSetCadence } from "../../../api/contacts";
import {
  useTrackToggle,
  type TrackableContact,
} from "../../../hooks/useTrackToggle";
import {
  ActionMenu,
  type ActionMenuItem,
} from "../../../components/ui/ActionMenu";
import { cn } from "../../../lib/utils";

export interface CadenceMenuProps {
  contact: TrackableContact;
  /** The fill of the half beside it, so the two read as one control. */
  className?: string;
}

/** What the caret is for, before the contact is tracked. */
export const TRACK_AT_LABEL = "Track, and choose how often";

export const CadenceMenu = ({ contact, className }: CadenceMenuProps) => {
  const setCadence = useSetCadence();
  const { trackAt } = useTrackToggle();
  const { cadenceDays, isTracked } = contact;
  const words = describeCadence(cadenceDays);
  const sentence = describeCadence(cadenceDays, { sentence: true });

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

  // Untracked, the rows are five ways to take the same action, so none of
  // them is checked: there is no cadence yet to be the current one.
  const items: ActionMenuItem[] = CADENCE_CHOICES.map((choice) => ({
    id: String(choice.days),
    label: choice.label,
    checked: isTracked ? choice.days === cadenceDays : undefined,
    onSelect: () =>
      isTracked ? change(choice.days) : trackAt(contact, choice.days),
  }));
  if (
    isTracked &&
    !CADENCE_CHOICES.some((choice) => choice.days === cadenceDays)
  ) {
    items.push({
      id: String(cadenceDays),
      label: words,
      checked: true,
      onSelect: () => change(cadenceDays),
    });
  }

  const label = isTracked ? `Cadence: ${sentence}` : TRACK_AT_LABEL;

  return (
    <ActionMenu
      label={label}
      title={label}
      heading="Keep up"
      items={items}
      align="end"
      className="items-stretch"
      triggerClassName={cn(
        "hit-area w-9 p-0 flex items-center justify-center rounded-l-none rounded-r-md border-l",
        className,
      )}
      triggerContent={<ChevronDown className="w-4 h-4" aria-hidden="true" />}
    />
  );
};
