import React, { useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { ContactProfile } from './ContactDetail/ContactProfile';

interface FloatingContactCardProps {
  contactId: string | null;
  isOpen: boolean;
  onClose: () => void;
  showNetworkButton?: boolean;
}

export const FloatingContactCard: React.FC<FloatingContactCardProps> = ({
  contactId,
  isOpen,
  onClose,
  showNetworkButton = false,
}) => {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  return (
    <AnimatePresence>
      {isOpen && contactId && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ type: 'spring', damping: 28, stiffness: 380, mass: 0.8 }}
            className="fixed inset-4 md:inset-8 lg:inset-12 xl:inset-x-[10%] xl:inset-y-8 z-[101] flex flex-col overflow-hidden rounded-3xl bg-surface shadow-2xl ring-1 ring-surface-container-highest/50"
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 z-50 p-2 bg-surface-container-low hover:bg-surface-container-high rounded-full transition-colors shadow-sm"
              title="Close"
            >
              <X className="w-5 h-5 text-on-surface-variant" />
            </button>

            <div className="flex-1 min-h-0 overflow-hidden">
               <ContactProfile 
                 contactId={contactId} 
                 onClose={onClose} 
                 showNetworkButton={showNetworkButton} 
               />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
