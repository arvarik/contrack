import React, { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCheck, Building, Briefcase } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { HealthRingAvatar } from "../../components/HealthRingAvatar";
import { useCompanyLogo } from "../../hooks/useCompanyLogo";
import { listRow } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { Contact } from "../../types";

export const ContactListItem = ({
  contact,
  active,
  isSelectMode,
  isSelected,
  onToggleSelect,
}: {
  contact: Contact;
  active: boolean;
  isSelectMode: boolean;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
}) => {
  const primaryEmail = contact.emails?.[0]?.email || null;
  const logoUrl = useCompanyLogo(primaryEmail);
  const [imgError, setImgError] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    if (isSelectMode) {
      e.preventDefault();
      onToggleSelect(contact.id);
    }
  };

  return (
    <Link
      id={`contact-row-${contact.id}`}
      to={isSelectMode ? '#' : `/contact/${contact.id}`}
      onClick={handleClick}
      className={cn(
        listRow(active && !isSelectMode),
        isSelectMode && "cursor-pointer select-none",
        isSelectMode && isSelected && "bg-primary/8 ring-2 ring-primary scale-[1.01]",
      )}
    >
      {/* Checkbox overlay in select mode */}
      <AnimatePresence>
        {isSelectMode && (
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            className="shrink-0"
          >
            <div className={cn(
              "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all",
              isSelected
                ? "bg-primary border-primary"
                : "border-on-surface-variant/40 bg-surface-container-low"
            )}>
              {isSelected && <CheckCheck className="w-3 h-3 text-white" />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <HealthRingAvatar contact={contact} size={48} />
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center">
          <h3 className={`text-sm font-semibold truncate ${(active && !isSelectMode) || (isSelectMode && isSelected) ? 'text-primary' : 'text-on-surface'}`}>
            {contact.name}
          </h3>
        </div>
        {contact.company ? (
          <p className="text-xs text-on-surface-variant truncate font-medium flex items-center gap-1.5 mt-0.5">
            {logoUrl && !imgError ? (
              <img
                src={logoUrl}
                alt={`${contact.company} logo`}
                onError={() => setImgError(true)}
                className="w-4 h-4 rounded-full object-contain bg-surface-container-highest"
              />
            ) : (
              <Building className="w-3.5 h-3.5 opacity-60" />
            )}
            {contact.company}
          </p>
        ) : contact.role ? (
          <p className="text-xs text-on-surface-variant truncate flex items-center gap-1.5 mt-0.5">
            <Briefcase className="w-3.5 h-3.5 opacity-60" />
            {contact.role}
          </p>
        ) : null}
      </div>
    </Link>
  );
};
