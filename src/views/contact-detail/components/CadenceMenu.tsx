/**
 * CadenceMenu: how often a person wants to keep up with this contact.
 *
 * Beside the Track button, and only while the contact is tracked, because
 * the cadence is the second half of Track: Track says who, the cadence says
 * how often. A quiet chip reads the cadence in words ("Every 3 months", or
 * "3 mo" on a narrow page) and opens a menu of the five choices with the
 * current one checked. A value off the list, set through the API, shows as
 * a sixth checked item, so the menu never claims a cadence the contact does
 * not have.
 *
 * Choosing writes `cadenceDays` and toasts "Ada Lovelace, every month".
 */
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  CADENCE_CHOICES,
  describeCadence,
  shortCadence,
} from "../../../../shared/cadence";
import { useSetCadence } from "../../../api/contacts";
import {
  ActionMenu,
  type ActionMenuItem,
} from "../../../components/ui/ActionMenu";

export interface CadenceMenuProps {
  contact: { id: string; name: string; cadenceDays: number };
  /** The narrow header: "3 mo" instead of "Every 3 months". */
  compact?: boolean;
}

export const CadenceMenu = ({ contact, compact = false }: CadenceMenuProps) => {
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
      title="How often to keep up"
      heading="Keep up"
      items={items}
      triggerClassName="hit-area rounded-full px-3 py-1 text-xs font-bold bg-surface-container text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-colors"
      triggerContent={
        <span className="flex items-center gap-1 whitespace-nowrap">
          {compact ? shortCadence(cadenceDays) : words}
          <ChevronDown
            className="w-3.5 h-3.5 opacity-70 shrink-0"
            aria-hidden="true"
          />
        </span>
      }
    />
  );
};
