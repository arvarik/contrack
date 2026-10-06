/** Fields that the connector forms share, each with the same markup in every form. */

import {
  Segmented,
  type SegmentedOption,
} from "../../../components/ui/Segmented";
import { Switch } from "../../../components/ui/Switch";
import { FORM_INPUT, TONE_WASH } from "../../../lib/styles";
import { cn } from "../../../lib/utils";

/** The heading over one field. */
export const FIELD_HEADING = "block text-xs font-semibold text-on-surface mb-1";

interface NumberChoiceProps {
  value: number;
  onChange: (value: number) => void;
}

const INTERVALS: SegmentedOption<number>[] = [
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "Hourly" },
  { value: 1440, label: "Daily" },
];

const LOOKBACKS: SegmentedOption<number>[] = [
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 365, label: "1 year" },
];

const Choice = ({
  label,
  options,
  value,
  onChange,
}: NumberChoiceProps & {
  label: string;
  options: SegmentedOption<number>[];
}) => (
  <div>
    <span className={FIELD_HEADING}>{label}</span>
    <Segmented<number>
      label={label}
      className="sm:w-fit"
      value={value}
      onChange={onChange}
      options={options}
    />
  </div>
);

export const SyncScheduleField = (props: NumberChoiceProps) => (
  <Choice label="Sync schedule" options={INTERVALS} {...props} />
);

export const LookbackField = (props: NumberChoiceProps) => (
  <Choice label="First sync goes back" options={LOOKBACKS} {...props} />
);

/** An on/off setting on its own tile. The switch is named by the title. */
export const SwitchTile = ({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) => (
  <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-surface-container">
    <div>
      <span className="text-xs font-semibold text-on-surface block">
        {title}
      </span>
      <span className="text-xs text-on-surface-variant block mt-0.5">
        {description}
      </span>
    </div>
    <Switch checked={checked} onChange={onChange} label={title} />
  </div>
);

/** How many messages with an unknown address before Contrack suggests a contact. */
export const GhostThresholdField = ({
  id,
  unit,
  value,
  onChange,
}: NumberChoiceProps & { id: string; unit: string }) => (
  <div>
    <label htmlFor={id} className={FIELD_HEADING}>
      Suggest a new person after
    </label>
    <div className="flex items-center gap-3">
      <input
        id={id}
        type="number"
        min={1}
        max={10}
        value={value}
        onChange={(e) =>
          onChange(Math.max(1, Math.min(10, Number(e.target.value) || 3)))
        }
        className={cn(FORM_INPUT, "w-20")}
      />
      <span className="text-xs text-on-surface-variant">{unit}</span>
    </div>
  </div>
);

export const FormError = ({ message }: { message: string | null }) =>
  message ? (
    <div role="alert" className={cn("rounded-lg p-3 text-xs", TONE_WASH.error)}>
      {message}
    </div>
  ) : null;
