import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ListPlus, X } from 'lucide-react';
import {
  Star, Heart, Crown, Flame, Rocket, Target, Gem, Award, Briefcase, Users,
  Globe, Zap, Shield, Coffee, Music, Camera, BookOpen, TrendingUp, Anchor, Flag, Sparkles, Sun
} from 'lucide-react';
import { useLists, useAddToList, useRemoveFromList } from '../../../api';

const LIST_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  star: Star, heart: Heart, crown: Crown, flame: Flame, rocket: Rocket,
  target: Target, gem: Gem, award: Award, briefcase: Briefcase, users: Users,
  globe: Globe, zap: Zap, shield: Shield, coffee: Coffee, music: Music,
  camera: Camera, 'book-open': BookOpen, 'trending-up': TrendingUp,
  anchor: Anchor, flag: Flag, sparkles: Sparkles, sun: Sun,
};

export const DetailListIcon = ({ icon, className }: { icon: string; className?: string }) => {
  const Icon = LIST_ICON_MAP[icon] || Star;
  return <Icon className={className} />;
};

export const ContactListsSection = ({ contactId, contactLists }: { contactId: string; contactLists: { id: string; name: string; icon: string }[] }) => {
  const { data: allLists = [] } = useLists();
  const addToList = useAddToList();
  const removeFromList = useRemoveFromList();
  const [showAdd, setShowAdd] = useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showAdd) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowAdd(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAdd]);

  const memberOfIds = new Set(contactLists.map(l => l.id));
  const availableLists = allLists.filter(l => !memberOfIds.has(l.id));

  return (
    <div className="flex items-center gap-2 mt-3 flex-wrap">
      {contactLists.map(list => (
        <span
          key={list.id}
          className="flex items-center gap-1.5 text-xs font-bold bg-primary/10 text-primary px-2.5 py-1 rounded-full group/listpill transition-colors hover:bg-primary/20"
        >
          <DetailListIcon icon={list.icon} className="w-3 h-3" />
          {list.name}
          <button
            onClick={() => removeFromList.mutate({ listId: list.id, contactId })}
            className="ml-0.5 opacity-0 group-hover/listpill:opacity-100 hover:text-red-500 transition-opacity"
            title="Remove from list"
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}

      {/* Add to list dropdown */}
      {availableLists.length > 0 && (
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-1 text-xs font-bold text-on-surface-variant hover:text-primary px-2 py-1 rounded-full hover:bg-primary/10 transition-colors"
            title="Add to a list"
          >
            <ListPlus className="w-3.5 h-3.5" />
          </button>
          <AnimatePresence>
            {showAdd && (
              <motion.div
                initial={{ opacity: 0, y: 4, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.95 }}
                className="absolute top-full left-0 mt-1 glass-panel rounded-xl shadow-xl z-50 py-1 min-w-[160px]"
              >
                {availableLists.map(list => (
                  <button
                    key={list.id}
                    onClick={() => {
                      addToList.mutate({ listId: list.id, contactId });
                      setShowAdd(false);
                    }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-on-surface hover:bg-surface-container-low transition-colors text-left"
                  >
                    <DetailListIcon icon={list.icon} className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{list.name}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};
