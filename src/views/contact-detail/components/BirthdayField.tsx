/**
 * Contact dates (birthday, anniversary, other, or a custom label), with or
 * without a year, edited as text (`parseBirthday`). Not a native date input:
 * that needs a year, and Chrome fires a change per typed part.
 *
 * The primary birthday lives on `contact.birthday` so vCard, SQL and merge
 * keep working; additional dates live in `contact.attributes` with
 * `name: "date:<label>"`.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "../../../lib/utils";
import { INLINE_INPUT, TONE_WASH } from "../../../lib/styles";
import { CustomSelect } from "../../../components/ui/CustomSelect";
import { ActionMenu } from "../../../components/ui/ActionMenu";
import { EditHint } from "./EditableField";
import { AddButton, showUndoToast } from "./Field";
import {
  birthdayText,
  formatBirthdayDisplay,
  getUpcomingBirthdayDays,
} from "../../../lib/birthday";
import { birthdayValue, parseBirthday } from "../../../../shared/birthday";

export const DATE_PRESET_LABELS = ["birthday", "anniversary", "other"] as const;
const CUSTOM_OPTION = "custom…";

export interface DateEntry {
  id: string;
  value: string;
  label: string;
}

function optionsForDateLabel(current: string): readonly string[] {
  const lower = current.toLowerCase();
  const isPreset = (DATE_PRESET_LABELS as readonly string[]).includes(lower);
  return isPreset
    ? [...DATE_PRESET_LABELS, CUSTOM_OPTION]
    : [current, ...DATE_PRESET_LABELS, CUSTOM_OPTION];
}

export const BirthdayField = ({
  value,
  attributes = [],
  onSave,
  onSaveDates,
}: {
  value: string | null;
  attributes?: readonly { id: string; name: string; value: string }[];
  onSave: (val: string) => void;
  onSaveDates?: (next: {
    birthday: string | null;
    attributes: { name: string; value: string }[];
  }) => void | Promise<unknown>;
}) => {
  const dateAttributes = attributes.filter((a) => a.name.startsWith("date:"));
  const nonDateAttributes = attributes
    .filter((a) => !a.name.startsWith("date:"))
    .map(({ name, value: v }) => ({ name, value: v }));

  const entries: DateEntry[] = [];
  if (value && formatBirthdayDisplay(value)) {
    entries.push({ id: "primary-birthday", value, label: "birthday" });
  }
  for (const attr of dateAttributes) {
    if (!formatBirthdayDisplay(attr.value)) continue;
    entries.push({
      id: attr.id,
      value: attr.value,
      label: attr.name.slice(5).trim() || "other",
    });
  }

  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [customLabelIndex, setCustomLabelIndex] = useState<number | null>(null);
  const [customLabelDraft, setCustomLabelDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [draftDate, setDraftDate] = useState("");
  const [draftLabel, setDraftLabel] = useState("birthday");
  const [draftCustomMode, setDraftCustomMode] = useState(false);
  const [draftCustomLabel, setDraftCustomLabel] = useState("");
  const [invalid, setInvalid] = useState(false);
  const invalidId = useId();
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const addFormRef = useRef<HTMLDivElement>(null);
  const closedByKey = useRef(false);
  const focusAddAfterClose = useRef(false);
  const switchingToCustomRef = useRef(false);

  useEffect(() => {
    if (adding || !focusAddAfterClose.current) return;
    focusAddAfterClose.current = false;
    addButtonRef.current?.focus();
  }, [adding]);

  const persistEntries = (nextEntries: { value: string; label: string }[]) => {
    let nextBirthday: string | null = null;
    const nextDateAttrs: { name: string; value: string }[] = [];
    for (const item of nextEntries) {
      const cleanLabel = item.label.trim() || "other";
      if (nextBirthday === null && cleanLabel.toLowerCase() === "birthday") {
        nextBirthday = item.value;
      } else {
        nextDateAttrs.push({
          name: `date:${cleanLabel}`,
          value: item.value,
        });
      }
    }

    if (
      onSaveDates &&
      (nextDateAttrs.length > 0 || dateAttributes.length > 0)
    ) {
      onSaveDates({
        birthday: nextBirthday,
        attributes: [...nonDateAttributes, ...nextDateAttrs],
      });
      return;
    }
    if ((nextBirthday ?? "") !== (value ?? "")) {
      onSave(nextBirthday ?? "");
    }
  };

  const commitEdit = (index: number, rawText: string): boolean => {
    const trimmed = rawText.trim();
    const parsed = parseBirthday(trimmed);
    if (trimmed && !parsed) return false;
    if (!trimmed) {
      const next = entries
        .filter((_, i) => i !== index)
        .map(({ value: v, label }) => ({ value: v, label }));
      persistEntries(next);
      return true;
    }
    const formatted = birthdayValue(parsed!);
    const next = entries.map((entry, i) => ({
      value: i === index ? formatted : entry.value,
      label: entry.label,
    }));
    persistEntries(next);
    return true;
  };

  const commitAdd = (byKey: boolean): boolean => {
    const trimmed = draftDate.trim();
    if (!trimmed) {
      setAdding(false);
      setInvalid(false);
      setDraftDate("");
      setDraftCustomMode(false);
      setDraftCustomLabel("");
      if (byKey) focusAddAfterClose.current = true;
      return true;
    }
    const parsed = parseBirthday(trimmed);
    if (!parsed) {
      setInvalid(true);
      return false;
    }
    const chosenLabel = draftCustomMode
      ? draftCustomLabel.trim() || "other"
      : draftLabel;
    const formatted = birthdayValue(parsed);
    persistEntries([
      ...entries.map(({ value: v, label }) => ({ value: v, label })),
      { value: formatted, label: chosenLabel },
    ]);
    setAdding(false);
    setInvalid(false);
    setDraftDate("");
    setDraftCustomMode(false);
    setDraftCustomLabel("");
    if (byKey) focusAddAfterClose.current = true;
    return true;
  };

  const changeLabel = (index: number, nextLabel: string) => {
    if (nextLabel === CUSTOM_OPTION) {
      const current = entries[index]?.label ?? "";
      const isPreset = (DATE_PRESET_LABELS as readonly string[]).includes(
        current.toLowerCase(),
      );
      setCustomLabelDraft(isPreset ? "" : current);
      setCustomLabelIndex(index);
      return;
    }
    persistEntries(
      entries.map((entry, i) => ({
        value: entry.value,
        label: i === index ? nextLabel : entry.label,
      })),
    );
  };

  const commitCustomLabel = (index: number, rawLabel: string) => {
    const clean = rawLabel.trim() || "other";
    setCustomLabelIndex(null);
    setCustomLabelDraft("");
    persistEntries(
      entries.map((entry, i) => ({
        value: entry.value,
        label: i === index ? clean : entry.label,
      })),
    );
  };

  const removeEntry = (index: number) => {
    const removed = entries[index];
    if (!removed) return;
    const before = entries.map(({ value: v, label }) => ({ value: v, label }));
    const after = before.filter((_, i) => i !== index);
    persistEntries(after);
    const display = formatBirthdayDisplay(removed.value) ?? removed.value;
    showUndoToast(`Removed "${display}"`, () => persistEntries(before));
  };

  const openAdd = () => {
    const hasBirthday = entries.some(
      (e) => e.label.toLowerCase() === "birthday",
    );
    setDraftLabel(hasBirthday ? "anniversary" : "birthday");
    setDraftCustomMode(false);
    setDraftCustomLabel("");
    setDraftDate("");
    setInvalid(false);
    setAdding(true);
  };

  return (
    <div className="flex flex-col gap-1">
      {entries.map((entry, index) => {
        const display = formatBirthdayDisplay(entry.value) ?? entry.value;
        const upcomingDays = getUpcomingBirthdayDays(entry.value);
        const isBirthday = entry.label.toLowerCase() === "birthday";

        if (editingIndex === index) {
          return (
            <div key={entry.id} className="flex flex-col gap-1">
              <input
                aria-label="Birthday"
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? invalidId : undefined}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                defaultValue={birthdayText(entry.value)}
                placeholder="May 14, or May 14, 1990"
                onChange={() => setInvalid(false)}
                onBlur={(e) => {
                  if (closedByKey.current) {
                    closedByKey.current = false;
                    return;
                  }
                  const text = e.target.value.trim();
                  if (!commitEdit(index, text)) {
                    toast.error(`Could not read "${text}" as a date`);
                  }
                  setEditingIndex(null);
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== "Escape") return;
                  e.preventDefault();
                  e.stopPropagation();
                  if (
                    e.key === "Enter" &&
                    !commitEdit(index, e.currentTarget.value)
                  ) {
                    setInvalid(true);
                    return;
                  }
                  closedByKey.current = true;
                  setEditingIndex(null);
                }}
                className={cn(INLINE_INPUT, "w-full")}
              />
              {invalid && (
                <p id={invalidId} className="text-xs font-semibold text-error">
                  Use a date like May 14, or May 14, 1990
                </p>
              )}
            </div>
          );
        }

        return (
          <div
            key={entry.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-0.5 sm:gap-x-2 min-h-[44px] sm:pointer-fine:min-h-0"
          >
            <div className="flex flex-wrap items-center gap-2 flex-[1_1_9rem] min-w-0">
              <button
                type="button"
                onClick={() => {
                  setInvalid(false);
                  setEditingIndex(index);
                }}
                className="group/edit hit-area state-layer inline-flex w-fit max-w-full items-center gap-1.5 rounded text-left text-sm font-medium cursor-text transition-colors text-on-surface"
              >
                <span className="min-w-0 break-words">{display}</span>
                <EditHint />
              </button>
              {upcomingDays !== null && (
                <span
                  className={cn(
                    "text-[11px] font-bold px-2 py-0.5 rounded-md shrink-0",
                    TONE_WASH.warning,
                  )}
                >
                  {upcomingDays === 0
                    ? isBirthday
                      ? "🎂 Today"
                      : "Today"
                    : isBirthday
                      ? `🎂 in ${upcomingDays}d`
                      : `in ${upcomingDays}d`}
                </span>
              )}
            </div>

            {customLabelIndex === index ? (
              <input
                aria-label={`Custom label for ${display}`}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                value={customLabelDraft}
                onChange={(e) => setCustomLabelDraft(e.target.value)}
                placeholder="Type (e.g. Graduation)"
                onBlur={(e) => commitCustomLabel(index, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    commitCustomLabel(index, e.currentTarget.value);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setCustomLabelIndex(null);
                    setCustomLabelDraft("");
                  }
                }}
                className={cn(INLINE_INPUT, "w-32 sm:text-xs")}
              />
            ) : (
              <CustomSelect
                value={entry.label}
                onChange={(nextLabel) => changeLabel(index, nextLabel)}
                options={optionsForDateLabel(entry.label)}
                ariaLabel={`Label for ${display}`}
                className="shrink-0"
              />
            )}

            <div className="ml-auto flex items-center">
              <ActionMenu
                label={`Actions for ${display}`}
                iconClassName="w-4 h-4"
                items={[
                  {
                    id: "remove",
                    label: "Remove",
                    icon: Trash2,
                    danger: true,
                    onSelect: () => removeEntry(index),
                  },
                ]}
              />
            </div>
          </div>
        );
      })}

      {adding ? (
        <div
          ref={addFormRef}
          className="flex flex-col gap-1"
          onBlur={(e) => {
            if (switchingToCustomRef.current) {
              switchingToCustomRef.current = false;
              return;
            }
            if (addFormRef.current?.contains(e.relatedTarget as Node | null)) {
              return;
            }
            if (closedByKey.current) {
              closedByKey.current = false;
              return;
            }
            const text = draftDate.trim();
            if (text && !commitAdd(false)) {
              toast.error(`Could not read "${text}" as a date`);
              setAdding(false);
              setDraftDate("");
              setInvalid(false);
            } else if (!text) {
              setAdding(false);
            }
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            {draftCustomMode ? (
              <input
                aria-label="Custom date type"
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                value={draftCustomLabel}
                onChange={(e) => setDraftCustomLabel(e.target.value)}
                placeholder="Type (e.g. Graduation)"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setDraftCustomMode(false);
                    setDraftCustomLabel("");
                  }
                }}
                className={cn(INLINE_INPUT, "w-32 sm:text-xs shrink-0")}
              />
            ) : (
              <CustomSelect
                value={draftLabel}
                onChange={(val) => {
                  if (val === CUSTOM_OPTION) {
                    switchingToCustomRef.current = true;
                    setDraftCustomMode(true);
                    setDraftCustomLabel("");
                  } else {
                    setDraftLabel(val);
                  }
                }}
                options={optionsForDateLabel(draftLabel)}
                ariaLabel="Label for new date"
                className="shrink-0"
              />
            )}
            <input
              aria-label="Birthday"
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? invalidId : undefined}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              value={draftDate}
              placeholder="May 14, or May 14, 1990"
              onChange={(e) => {
                setDraftDate(e.target.value);
                setInvalid(false);
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  closedByKey.current = true;
                  if (!commitAdd(true)) {
                    closedByKey.current = false;
                  }
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  closedByKey.current = true;
                  focusAddAfterClose.current = true;
                  setAdding(false);
                  setInvalid(false);
                  setDraftDate("");
                }
              }}
              className={cn(INLINE_INPUT, "flex-1 min-w-[10rem]")}
            />
          </div>
          {invalid && (
            <p id={invalidId} className="text-xs font-semibold text-error">
              Use a date like May 14, or May 14, 1990
            </p>
          )}
        </div>
      ) : (
        <AddButton ref={addButtonRef} label="Add date" onClick={openAdd} />
      )}
    </div>
  );
};
