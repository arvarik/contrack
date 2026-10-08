import React, { useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Archive,
  ListPlus as AddToListIcon,
  MoreHorizontal,
  Pencil,
  Copy,
  Palette,
  Radar,
  Trash2,
} from "lucide-react";
import { VIBES, vibeTokens } from "../../lib/theme";
import { usePreferences } from "../../contexts/PreferencesContext";
import { BAR_BUTTON, BAR_LABEL, SELECTED_TINT } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { ActionMenu } from "../../components/ui/ActionMenu";
import type { SelectionTracked } from "../../components/bulk/useBulkActions";

const BulkActionBtn = ({
  icon,
  label,
  onClick,
  disabled,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled: boolean;
  className?: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={label}
    aria-label={label}
    className={cn(
      BAR_BUTTON,
      "disabled:opacity-40 cursor-pointer max-sm:min-h-11 max-sm:justify-center",
      className,
    )}
  >
    {icon}
    {/* A phone shows the glyphs alone, so the bar is one row. */}
    <span className={cn(BAR_LABEL, "max-sm:sr-only")}>{label}</span>
  </button>
);

/**
 * On a phone, the three rarer actions wait in a More menu: with their words,
 * all eight buttons wrapped to three rows over the list.
 */
const PHONE_HIDDEN = "max-sm:hidden";

/**
 * "3 selected" at the start of a bulk bar, read out as it changes. Atomic,
 * or NVDA reads only the changed number.
 */
export const SelectedCount = ({ count }: { count: number }) => (
  <span
    role="status"
    aria-live="polite"
    aria-atomic="true"
    className="text-sm font-bold text-on-surface mx-2 max-sm:mx-1 shrink-0 tabular-nums"
  >
    <span className="text-primary">{count}</span>
    {/* Under 360 px the one-row phone bar has no room for the word. */}
    <span className="max-[359px]:sr-only"> selected</span>
  </span>
);

interface BulkActionToolbarProps {
  /** The bar's outer box, for a list that keeps room under its last row. */
  ref?: React.Ref<HTMLDivElement>;
  /** Omitted on the map, whose own selection bar says it. */
  selectedCount?: number;
  isPending: boolean;
  /** Track the selection, or stop when every selected contact is tracked. */
  onTrack: (next: boolean) => void;
  selectionTracked: SelectionTracked;
  onArchive: () => void;
  onAddToList: () => void;
  onEditField: () => void;
  onColorChange: (vibeId: string) => void;
  onExportCSV: () => void;
  onDelete: () => void;
}

export const BulkActionToolbar = ({
  ref,
  selectedCount,
  isPending,
  onTrack,
  selectionTracked,
  onArchive,
  onAddToList,
  onEditField,
  onColorChange,
  onExportCSV,
  onDelete,
}: BulkActionToolbarProps) => {
  const { mode } = usePreferences();
  // Every action is disabled until a row is picked.
  const nothingSelected = selectedCount === 0;
  const [showBulkColorPicker, setShowBulkColorPicker] = React.useState(false);
  // The picker's two homes: Color, and More on a phone. A press anywhere
  // else, another bar button too, closes it.
  const colorHomeRef = useRef<HTMLDivElement>(null);
  const moreHomeRef = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!showBulkColorPicker) return;
    const handler = (e: MouseEvent) => {
      const inside = [colorHomeRef, moreHomeRef].some((home) =>
        home.current?.contains(e.target as Node),
      );
      if (!inside) setShowBulkColorPicker(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showBulkColorPicker]);

  const colorPicker = (
    <AnimatePresence>
      {showBulkColorPicker && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 6 }}
          className="absolute bottom-full mb-2 left-1/2 max-sm:left-auto max-sm:right-0 -translate-x-1/2 max-sm:translate-x-0 menu-panel p-3 z-50 grid grid-cols-4 gap-2 w-[120px] place-items-center"
        >
          {VIBES.map((vibe) => (
            <button
              aria-label={`Set color to ${vibe.label}`}
              key={vibe.id}
              onClick={() => {
                onColorChange(vibe.id);
                setShowBulkColorPicker(false);
              }}
              disabled={isPending || nothingSelected}
              style={{
                backgroundColor: vibeTokens(vibe.id, mode).primary,
              }}
              title={vibe.label}
              className="hit-area w-6 h-6 rounded-full transition-transform hover:scale-110 shadow-sm hover:ring-2 hover:ring-white/50 hover:ring-offset-1 hover:ring-offset-surface disabled:opacity-50"
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <motion.div
      ref={ref}
      initial={{ y: 80, opacity: 1 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 80, opacity: 1 }}
      transition={{ type: "spring", damping: 22, stiffness: 300 }}
      className="absolute bottom-24 md:bottom-0 left-0 right-0 z-40 px-3 pb-2 md:pb-4"
    >
      {/* Nearly opaque, not glass: the list under it would fight the labels
          for contrast. The buttons wrap in a narrow pane, so none sit past
          the edge. A phone gets one row (`PHONE_HIDDEN`). */}
      <div
        role="toolbar"
        aria-label="Bulk actions"
        className="bg-surface-container-lowest/98 backdrop-blur-xl ring-1 ring-outline-variant/40 rounded-2xl shadow-2xl px-3 py-2.5 max-sm:px-2 max-sm:py-1.5 flex flex-wrap max-sm:flex-nowrap items-center justify-center max-sm:justify-between gap-1 max-sm:gap-0 min-w-0"
      >
        {selectedCount !== undefined && <SelectedCount count={selectedCount} />}
        {/* Track first: it decides who the score and Pulse are about. */}
        <BulkActionBtn
          icon={<Radar className="w-4 h-4" />}
          label={selectionTracked === "all" ? "Stop tracking" : "Track"}
          onClick={() => onTrack(selectionTracked !== "all")}
          disabled={isPending || nothingSelected}
          className="text-primary"
        />
        <BulkActionBtn
          icon={<Archive className="w-4 h-4" />}
          label="Archive"
          onClick={onArchive}
          disabled={isPending || nothingSelected}
          className="text-warning"
        />
        <BulkActionBtn
          icon={<AddToListIcon className="w-4 h-4" />}
          label="Add to list"
          onClick={onAddToList}
          disabled={nothingSelected}
          className="text-primary"
        />
        <BulkActionBtn
          icon={<Pencil className="w-4 h-4" />}
          label="Edit field"
          onClick={onEditField}
          disabled={nothingSelected}
          className={cn("text-primary", PHONE_HIDDEN)}
        />

        <div
          ref={colorHomeRef}
          className={cn("relative shrink-0", PHONE_HIDDEN)}
        >
          <button
            type="button"
            onClick={() => setShowBulkColorPicker((v) => !v)}
            disabled={nothingSelected}
            title="Change color"
            aria-expanded={showBulkColorPicker}
            className={cn(
              BAR_BUTTON,
              "disabled:opacity-40",
              showBulkColorPicker ? SELECTED_TINT : "text-on-surface-variant",
            )}
          >
            <Palette className="w-4 h-4" />
            <span className={BAR_LABEL}>Color</span>
          </button>
          {colorPicker}
        </div>

        {/* It copies CSV text, and downloads no file. */}
        <BulkActionBtn
          icon={<Copy className="w-4 h-4" />}
          label="Copy CSV"
          onClick={onExportCSV}
          disabled={nothingSelected}
          className={cn("text-on-surface-variant", PHONE_HIDDEN)}
        />

        <div
          className={cn("w-px h-5 bg-surface-container-high", PHONE_HIDDEN)}
        />

        <BulkActionBtn
          icon={<Trash2 className="w-4 h-4" />}
          label="Delete"
          onClick={onDelete}
          disabled={isPending || nothingSelected}
          className="text-error"
        />

        <div ref={moreHomeRef} className="relative shrink-0 sm:hidden">
          <ActionMenu
            label="More actions"
            // The menu opens over the picker: one panel at a time.
            onOpenChange={(open) => open && setShowBulkColorPicker(false)}
            icon={MoreHorizontal}
            iconClassName="w-4 h-4"
            triggerClassName="min-w-11 min-h-11"
            disabled={nothingSelected}
            items={[
              {
                id: "edit",
                label: "Edit field",
                icon: Pencil,
                onSelect: onEditField,
              },
              {
                id: "color",
                label: "Change color",
                icon: Palette,
                onSelect: () => setShowBulkColorPicker(true),
              },
              {
                id: "csv",
                label: "Copy CSV",
                icon: Copy,
                onSelect: onExportCSV,
              },
            ]}
          />
          {colorPicker}
        </div>
      </div>
    </motion.div>
  );
};
