import React, { useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Archive,
  ListPlus as AddToListIcon,
  Pencil,
  Download,
  Palette,
  Radar,
  Trash2,
} from "lucide-react";
import { VIBES, vibeTokens } from "../../lib/theme";
import { usePreferences } from "../../contexts/PreferencesContext";
import { BAR_BUTTON, BAR_LABEL, SELECTED_TINT } from "../../lib/styles";
import { cn } from "../../lib/utils";
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
    className={cn(BAR_BUTTON, "disabled:opacity-40 cursor-pointer", className)}
  >
    {icon}
    <span className={BAR_LABEL}>{label}</span>
  </button>
);

/**
 * "3 selected" at the start of a bulk bar, read out as it changes. The
 * Network list's bar and the Tracked page's bar both lead with it.
 *
 * Atomic, so a screen reader says the whole "2 selected" when the number
 * changes. Without it NVDA read the changed text node alone: "2".
 */
export const SelectedCount = ({ count }: { count: number }) => (
  <span
    role="status"
    aria-live="polite"
    aria-atomic="true"
    className="text-sm font-bold text-on-surface mx-2 shrink-0 tabular-nums"
  >
    <span className="text-primary">{count}</span> selected
  </span>
);

interface BulkActionToolbarProps {
  /** The bar's outer box, for a list that keeps room under its last row. */
  ref?: React.Ref<HTMLDivElement>;
  /**
   * How many are selected, said first in the bar. The map leaves it out:
   * its own selection bar above this one already says it.
   */
  selectedCount?: number;
  isPending: boolean;
  /**
   * Track the selection, or untrack it. The bar reads Untrack when every
   * selected contact is tracked and Track otherwise, and sends the answer.
   */
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
  // "0 selected" acts on no one, so every action rests until a row is
  // picked. Delete was live at zero, beside a Tracked bar that rests.
  const nothingSelected = selectedCount === 0;
  const [showBulkColorPicker, setShowBulkColorPicker] = React.useState(false);
  const bulkColorPickerRef = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!showBulkColorPicker) return;
    const handler = (e: MouseEvent) => {
      if (
        bulkColorPickerRef.current &&
        !bulkColorPickerRef.current.contains(e.target as Node)
      ) {
        setShowBulkColorPicker(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showBulkColorPicker]);

  return (
    <motion.div
      ref={ref}
      initial={{ y: 80, opacity: 1 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 80, opacity: 1 }}
      transition={{ type: "spring", damping: 22, stiffness: 300 }}
      className="absolute bottom-24 md:bottom-0 left-0 right-0 z-40 px-3 pb-2 md:pb-4"
    >
      {/*
        Opaque, not glass.

        This bar floats over a dense list of avatars and names, and
        `.glass-panel` is 80% white: whatever is underneath bleeds through and
        every label fights it for contrast. A translucent surface is a fine
        choice for something decorative; it is the wrong one for the only
        controls that can archive or delete forty contacts at once. Those need
        to be unambiguously readable over whatever happens to be behind them.

        The blur stays for depth, but at 98% the panel is effectively solid,
        and a ring plus a stronger shadow separate it from the list rather than
        relying on transparency to imply layering.

        The buttons wrap onto a second row when the pane is narrow. They used
        to scroll sideways behind a hidden scrollbar, and at the Network
        pane's width CSV and Delete sat past the edge where nobody saw them.
      */}
      <div
        role="toolbar"
        aria-label="Bulk actions"
        className="bg-surface-container-lowest/98 backdrop-blur-xl ring-1 ring-outline-variant/40 rounded-2xl shadow-2xl px-3 py-2.5 flex flex-wrap items-center justify-center gap-1 min-w-0"
      >
        {selectedCount !== undefined && <SelectedCount count={selectedCount} />}
        {/* Action buttons. Track first: it is the one that decides who the
            score and Pulse are about. */}
        <BulkActionBtn
          icon={<Radar className="w-4 h-4" />}
          label={selectionTracked === "all" ? "Untrack" : "Track"}
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
          label="List"
          onClick={onAddToList}
          disabled={nothingSelected}
          className="text-primary"
        />
        <BulkActionBtn
          icon={<Pencil className="w-4 h-4" />}
          label="Field"
          onClick={onEditField}
          disabled={nothingSelected}
          className="text-primary"
        />

        {/* Bulk Color Picker */}
        <div className="relative shrink-0" ref={bulkColorPickerRef}>
          <button
            type="button"
            onClick={() => setShowBulkColorPicker((v) => !v)}
            disabled={nothingSelected}
            title="Change color"
            className={cn(
              BAR_BUTTON,
              "disabled:opacity-40",
              showBulkColorPicker ? SELECTED_TINT : "text-on-surface-variant",
            )}
          >
            <Palette className="w-4 h-4" />
            <span className={BAR_LABEL}>Color</span>
          </button>

          <AnimatePresence>
            {showBulkColorPicker && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 6 }}
                className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 menu-panel p-3 z-50 grid grid-cols-4 gap-2 w-[120px] place-items-center"
              >
                {VIBES.map((vibe) => (
                  <button
                    aria-label={`Set colour to ${vibe.label}`}
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
        </div>

        <BulkActionBtn
          icon={<Download className="w-4 h-4" />}
          label="CSV"
          onClick={onExportCSV}
          disabled={nothingSelected}
          className="text-on-surface-variant"
        />

        {/* Divider */}
        <div className="w-px h-5 bg-surface-container-high" />

        <BulkActionBtn
          icon={<Trash2 className="w-4 h-4" />}
          label="Delete"
          onClick={onDelete}
          disabled={isPending || nothingSelected}
          className="text-error"
        />
      </div>
    </motion.div>
  );
};
