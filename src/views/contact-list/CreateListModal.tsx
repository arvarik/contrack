import React, { useState } from "react";
import { motion } from "motion/react";
import {
  Star,
  Heart,
  Crown,
  Flame,
  Rocket,
  Target,
  Gem,
  Award,
  Briefcase,
  Users,
  Globe,
  Zap,
  Shield,
  Coffee,
  Music,
  Camera,
  BookOpen,
  TrendingUp,
  Anchor,
  Flag,
  Sparkles,
  Sun,
} from "lucide-react";
import { Modal } from "../../components/ui/Modal";
import { cn } from "../../lib/utils";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  star: Star,
  heart: Heart,
  crown: Crown,
  flame: Flame,
  rocket: Rocket,
  target: Target,
  gem: Gem,
  award: Award,
  briefcase: Briefcase,
  users: Users,
  globe: Globe,
  zap: Zap,
  shield: Shield,
  coffee: Coffee,
  music: Music,
  camera: Camera,
  "book-open": BookOpen,
  "trending-up": TrendingUp,
  anchor: Anchor,
  flag: Flag,
  sparkles: Sparkles,
  sun: Sun,
};

const ICON_OPTIONS = Object.keys(ICON_MAP);

export const ListIcon = ({
  icon,
  className,
}: {
  icon: string;
  className?: string;
}) => {
  const Icon = ICON_MAP[icon] || Star;
  return <Icon className={className} />;
};

export const CreateListModal = ({
  isOpen,
  onClose,
  onCreate,
  isPending,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, icon: string) => void;
  isPending: boolean;
}) => {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("star");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate(name.trim(), icon);
    setName("");
    setIcon("star");
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create List">
      <form onSubmit={handleSubmit} className="space-y-6 pt-2">
        <div>
          <label className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-widest mb-3">
            Choose an Icon
          </label>
          <div className="grid grid-cols-7 gap-2">
            {ICON_OPTIONS.map((key) => {
              const active = icon === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setIcon(key)}
                  className={cn(
                    "p-2.5 rounded-xl transition-all flex items-center justify-center",
                    active
                      ? "bg-primary/15 text-primary ring-2 ring-primary/30 shadow-sm scale-110"
                      : "text-on-surface-variant hover:text-primary hover:bg-surface-container-low",
                  )}
                  title={key}
                >
                  <ListIcon icon={key} className="w-5 h-5" />
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-widest mb-1.5">
            List Name
          </label>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. VIP Clients, Investors, Friends"
            className="w-full bg-surface-container border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 focus:outline-none"
          />
        </div>
        <div className="flex items-center justify-between pt-2">
          {name.trim() && (
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-2 text-sm text-primary font-bold"
            >
              <ListIcon icon={icon} className="w-4 h-4" />
              {name.trim()}
            </motion.div>
          )}
          <button
            type="submit"
            disabled={!name.trim() || isPending}
            className="ml-auto bg-primary text-on-primary font-bold py-2.5 px-6 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 text-sm"
          >
            {isPending ? "Creating..." : "Create List"}
          </button>
        </div>
      </form>
    </Modal>
  );
};
