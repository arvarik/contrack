import React, { useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Archive, ListPlus as AddToListIcon, Pencil, Download, Palette, Trash2 } from "lucide-react";
import { VIBE_COLORS } from "../contact-detail/components/VibePickerPopover";
import { cn } from "../../lib/utils";

const BulkActionBtn = ({
  icon, label, onClick, disabled, className,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled: boolean;
  className?: string;
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={label}
    className={cn(
      "flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl transition-colors disabled:opacity-40 shrink-0",
      className
    )}
  >
    {icon}
    <span className="text-[8px] font-bold uppercase tracking-wider opacity-80 whitespace-nowrap">{label}</span>
  </button>
);

interface BulkActionToolbarProps {
  selectedCount: number;
  isPending: boolean;
  onArchive: () => void;
  onAddToList: () => void;
  onEditField: () => void;
  onColorChange: (vibeId: string) => void;
  onExportCSV: () => void;
  onDelete: () => void;
}

export const BulkActionToolbar = ({
  selectedCount,
  isPending,
  onArchive,
  onAddToList,
  onEditField,
  onColorChange,
  onExportCSV,
  onDelete,
}: BulkActionToolbarProps) => {
  const [showBulkColorPicker, setShowBulkColorPicker] = React.useState(false);
  const bulkColorPickerRef = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!showBulkColorPicker) return;
    const handler = (e: MouseEvent) => {
      if (bulkColorPickerRef.current && !bulkColorPickerRef.current.contains(e.target as Node)) {
        setShowBulkColorPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showBulkColorPicker]);

  return (
    <motion.div
      initial={{ y: 80, opacity: 1 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 80, opacity: 1 }}
      transition={{ type: 'spring', damping: 22, stiffness: 300 }}
      className="absolute bottom-24 md:bottom-0 left-0 right-0 z-40 px-3 pb-2 md:pb-4"
    >
      <div className="glass-panel rounded-2xl shadow-2xl px-3 py-2.5 flex items-center gap-1 min-w-0 overflow-x-auto scrollbar-hide">
        {/* Action buttons */}
        <BulkActionBtn
          icon={<Archive className="w-4 h-4" />}
          label="Archive"
          onClick={onArchive}
          disabled={isPending}
          className="text-amber-500 hover:bg-amber-500/10"
        />
        <BulkActionBtn
          icon={<AddToListIcon className="w-4 h-4" />}
          label="List"
          onClick={onAddToList}
          disabled={false}
          className="text-primary hover:bg-primary/10"
        />
        <BulkActionBtn
          icon={<Pencil className="w-4 h-4" />}
          label="Field"
          onClick={onEditField}
          disabled={false}
          className="text-primary hover:bg-primary/10"
        />

        {/* Bulk Color Picker */}
        <div className="relative shrink-0" ref={bulkColorPickerRef}>
          <button
            onClick={() => setShowBulkColorPicker(v => !v)}
            title="Change Color"
            className={cn(
              "flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl transition-colors shrink-0",
              showBulkColorPicker ? "text-primary bg-primary/10" : "text-on-surface-variant hover:bg-surface-container-high"
            )}
          >
            <Palette className="w-4 h-4" />
            <span className="text-[8px] font-bold uppercase tracking-wider opacity-80 whitespace-nowrap">Color</span>
          </button>

          <AnimatePresence>
            {showBulkColorPicker && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 6 }}
                className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 glass-panel rounded-xl shadow-xl p-3 z-50 grid grid-cols-4 gap-2 w-[120px] place-items-center"
              >
                {VIBE_COLORS.map(vibe => (
                  <button
                    key={vibe.id}
                    onClick={() => { onColorChange(vibe.id); setShowBulkColorPicker(false); }}
                    disabled={isPending}
                    style={{ backgroundColor: vibe.primary }}
                    title={vibe.id}
                    className="w-6 h-6 rounded-full transition-transform hover:scale-110 shadow-sm hover:ring-2 hover:ring-white/50 hover:ring-offset-1 hover:ring-offset-surface disabled:opacity-50"
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
          disabled={false}
          className="text-on-surface-variant hover:bg-surface-container-high"
        />

        {/* Divider */}
        <div className="w-px h-5 bg-surface-container-high" />

        <BulkActionBtn
          icon={<Trash2 className="w-4 h-4" />}
          label="Delete"
          onClick={onDelete}
          disabled={isPending}
          className="text-rose-500 hover:bg-rose-500/10"
        />
      </div>
    </motion.div>
  );
};
