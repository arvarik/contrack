import React, { useEffect } from 'react';
import { Palette } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export const VIBE_COLORS = [
  { id: 'brand', primary: '#009EDB', dim: '#007BB0', container: '#D6F1FF' },
  { id: 'emerald', primary: '#10B981', dim: '#059669', container: '#D1FAE5' },
  { id: 'amber', primary: '#F59E0B', dim: '#D97706', container: '#FEF3C7' },
  { id: 'rose', primary: '#F43F5E', dim: '#E11D48', container: '#FFE4E6' },
  { id: 'indigo', primary: '#6366F1', dim: '#4F46E5', container: '#E0E7FF' },
  { id: 'pink', primary: '#EC4899', dim: '#BE185D', container: '#FCE7F3' },
  { id: 'violet', primary: '#8B5CF6', dim: '#6D28D9', container: '#EDE9FE' },
  { id: 'teal', primary: '#14B8A6', dim: '#0F766E', container: '#CCFBF1' }
];

export const VibePickerPopover = ({
  showVibePicker,
  setShowVibePicker,
  currentVibeId,
  onSelect,
}: {
  showVibePicker: boolean;
  setShowVibePicker: (v: boolean) => void;
  currentVibeId: string;
  onSelect: (id: string) => void;
}) => {
  const ref = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showVibePicker) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setShowVibePicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showVibePicker, setShowVibePicker]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button 
        onClick={() => setShowVibePicker(!showVibePicker)} 
        className={`p-2 rounded-xl transition-all ${showVibePicker ? 'bg-primary/20 text-primary' : 'text-on-surface-variant hover:bg-surface-container hover:text-primary'}`}
        title="Change Theme Vibe"
        aria-label="Change theme color"
        aria-pressed={showVibePicker}
      >
        <Palette className="w-5 h-5" />
      </button>
      
      <AnimatePresence>
        {showVibePicker && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            className="absolute top-12 left-1/2 -translate-x-1/2 md:left-auto md:right-0 md:translate-x-0 glass-panel rounded-xl shadow-xl p-3 z-50 grid grid-cols-5 gap-2 w-[180px] place-items-center"
            role="radiogroup"
            aria-label="Theme color options"
          >
            {VIBE_COLORS.map(vibe => (
               <button 
                key={vibe.id} 
                onClick={() => onSelect(vibe.id)}
                style={{ backgroundColor: vibe.primary }}
                className={`w-7 h-7 rounded-full transition-transform hover:scale-110 shadow-sm ${currentVibeId === vibe.id ? 'ring-2 ring-primary ring-offset-2 ring-offset-surface-container-lowest scale-110' : 'hover:ring-2 hover:ring-on-surface-variant hover:ring-offset-2 hover:ring-offset-surface-container-lowest'}`}
                aria-label={`Set theme to ${vibe.id}`}
                aria-pressed={currentVibeId === vibe.id}
                role="radio"
                aria-checked={currentVibeId === vibe.id}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
