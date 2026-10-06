/**
 * The label chip on a value ("WORK", "MOBILE"): a `Select` in its chip form,
 * for a plain list of strings. `hit-area` gives it a 44 px tap box around its
 * 32 px body, so the row keeps its height.
 */
import { Select } from "./Select";

export function CustomSelect({
  value,
  onChange,
  options,
  className,
  ariaLabel = "Label",
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <Select
      variant="chip"
      value={value}
      onChange={onChange}
      options={options.map((option) => ({ value: option, label: option }))}
      label={ariaLabel}
      className={className}
    />
  );
}
