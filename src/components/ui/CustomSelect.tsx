/**
 * CustomSelect: the label chip on a value ("WORK", "MOBILE", "HOME").
 *
 * A `Select` in its chip form, for a caller that has a list of strings and
 * no need for icons or groups. It used to wrap a native `<select>`, which
 * drew the operating system's popup beside rows that open a `.menu-panel`.
 * Now the chip opens the same panel as every other menu on the page.
 *
 * `hit-area` on the chip gives it a 44 px tap box on a phone around its 32 px
 * body, so the row keeps its height.
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
