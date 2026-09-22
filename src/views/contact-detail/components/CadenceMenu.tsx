/**
 * CadenceMenu: how often a person wants to keep up with this contact.
 *
 * The caret at the right end of the Track button, and only while the
 * contact is tracked, because the cadence is the second half of Track:
 * Track says who, the cadence says how often. It was a chip of its own that
 * appeared beside the button, which pushed the word "Track" sideways the
 * moment anybody pressed it.
 *
 * The caret carries no words, so its accessible name and its tooltip say
 * both what it adjusts and what the cadence is now: "Cadence: every 3
 * months". The menu lists the five choices with the current one checked. A
 * value off the list, set through the API, shows as a sixth checked item,
 * so the menu never claims a cadence the contact does not have.
 *
 * Choosing writes `cadenceDays` and toasts "Ada Lovelace, every month".
 */
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { CADENCE_CHOICES, describeCadence } from "../../../../shared/cadence";
import { useSetCadence } from "../../../api/contacts";
import {
  ActionMenu,
  type ActionMenuItem,
} from "../../../components/ui/ActionMenu";
import { CARET_SLOT } from "./TrackButton";

export interface CadenceMenuProps {
  contact: { id: string; name: string; cadenceDays: number };
}

export const CadenceMenu = ({ contact }: CadenceMenuProps) => {
  const setCadence = useSetCadence();
  const { cadenceDays } = contact;
  const words = describeCadence(cadenceDays);
  const sentence = describeCadence(cadenceDays, { sentence: true });

  const choose = (days: number) => {
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

  const items: ActionMenuItem[] = CADENCE_CHOICES.map((choice) => ({
    id: String(choice.days),
    label: choice.label,
    checked: choice.days === cadenceDays,
    onSelect: () => choose(choice.days),
  }));
  if (!CADENCE_CHOICES.some((choice) => choice.days === cadenceDays)) {
    items.push({
      id: String(cadenceDays),
      label: words,
      checked: true,
      onSelect: () => choose(cadenceDays),
    });
  }

  return (
    <ActionMenu
      label={`Cadence: ${sentence}`}
      title={`Cadence: ${sentence}`}
      heading="Keep up"
      items={items}
      align="end"
      className="items-stretch"
      triggerClassName={`hit-area ${CARET_SLOT} p-0 flex items-center justify-center rounded-l-none rounded-r-md border-l border-primary/25 bg-primary/10 text-on-primary-wash hover:bg-primary/20 transition-colors`}
      triggerContent={
        <ChevronDown className="w-4 h-4 text-primary" aria-hidden="true" />
      }
    />
  );
};
