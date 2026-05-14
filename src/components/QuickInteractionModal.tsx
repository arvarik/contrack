/**
 * QuickInteractionModal — Global quick-note modal for logging interactions
 * without navigating away from the current page (Feature 14).
 *
 * Keyboard: Cmd+Shift+I to open, Escape to close, Cmd+Enter to submit.
 *
 * Refactor (Phase 3):
 *  - Now uses the shared `Modal` primitive — gains focus trap, scroll lock,
 *    portal rendering, and the new responsive bottom-sheet on mobile.
 *  - Icon-only buttons replaced with `IconButton` for touch-safe 44×44 hit
 *    areas. Interaction-type chips bumped from `text-xs` to `text-sm` with
 *    larger icons, and made flex-wrap-friendly on narrow widths.
 *  - The contact-picker autocomplete keeps its bespoke keyboard navigation
 *    because it has product-specific behaviour (ghost filtering, top-6
 *    truncation) that the generic Combobox doesn't model.
 *
 * @module components/QuickInteractionModal
 */
import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import {
  X,
  Search,
  FileText,
  Phone,
  Calendar,
  Mail,
  Loader2,
} from "lucide-react";
import { useContactNames, useAddInteraction } from "../api";
import type { ContactSlim } from "../api/contacts";
import { fallbackAvatarUrl } from "../lib/avatar";
import { Modal } from "./ui/Modal";
import { IconButton } from "./ui/IconButton";

type InteractionType = "note" | "call" | "meeting" | "email";

interface QuickInteractionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const INTERACTION_TYPES: {
  type: InteractionType;
  label: string;
  icon: React.ReactNode;
}[] = [
  { type: "note", label: "Note", icon: <FileText className="w-4 h-4" /> },
  { type: "call", label: "Call", icon: <Phone className="w-4 h-4" /> },
  { type: "meeting", label: "Meeting", icon: <Calendar className="w-4 h-4" /> },
  { type: "email", label: "Email", icon: <Mail className="w-4 h-4" /> },
];

const TYPE_TITLES: Record<InteractionType, string> = {
  note: "Quick Note",
  call: "Phone Call",
  meeting: "Meeting",
  email: "Email",
};

export const QuickInteractionModal: React.FC<QuickInteractionModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [selectedContact, setSelectedContact] = useState<ContactSlim | null>(
    null,
  );
  const [contactQuery, setContactQuery] = useState("");
  const [interactionType, setInteractionType] =
    useState<InteractionType>("note");
  const [content, setContent] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);

  const contactInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  const { data: contacts } = useContactNames();
  const addInteraction = useAddInteraction();

  const filteredContacts = useMemo(() => {
    if (!contacts || !contactQuery.trim()) return [];
    const q = contactQuery.toLowerCase();
    return contacts
      .filter((c) => !c.isGhost && c.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [contacts, contactQuery]);

  // Reset on close (deferred so the exit animation completes first)
  useEffect(() => {
    if (!isOpen) {
      const t = setTimeout(() => {
        setSelectedContact(null);
        setContactQuery("");
        setInteractionType("note");
        setContent("");
        setDropdownOpen(false);
        setHighlightIndex(0);
      }, 300);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  // Focus the contact input when the modal opens. We defer past the Modal's
  // own initial focus-on-close-button so this input wins.
  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => contactInputRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  useEffect(() => {
    setDropdownOpen(
      filteredContacts.length > 0 &&
        contactQuery.length > 0 &&
        !selectedContact,
    );
    setHighlightIndex(0);
  }, [filteredContacts, contactQuery, selectedContact]);

  const selectContact = useCallback((contact: ContactSlim) => {
    setSelectedContact(contact);
    setContactQuery("");
    setDropdownOpen(false);
    setTimeout(() => contentRef.current?.focus(), 50);
  }, []);

  const clearContact = useCallback(() => {
    setSelectedContact(null);
    setContactQuery("");
    setTimeout(() => contactInputRef.current?.focus(), 50);
  }, []);

  const handleContactKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!dropdownOpen) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIndex((prev) =>
          Math.min(prev + 1, filteredContacts.length - 1),
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filteredContacts[highlightIndex])
          selectContact(filteredContacts[highlightIndex]);
      } else if (e.key === "Escape") {
        setDropdownOpen(false);
      }
    },
    [dropdownOpen, filteredContacts, highlightIndex, selectContact],
  );

  const handleSubmit = useCallback(async () => {
    if (!selectedContact || !content.trim()) return;
    try {
      await addInteraction.mutateAsync({
        contactId: selectedContact.id,
        data: {
          type: interactionType,
          title: TYPE_TITLES[interactionType],
          content: content.trim(),
          date: new Date().toISOString(),
        },
      });
      toast.success(
        `${TYPE_TITLES[interactionType]} logged for ${selectedContact.name}`,
      );
      onClose();
    } catch {
      toast.error("Failed to log interaction");
    }
  }, [selectedContact, content, interactionType, addInteraction, onClose]);

  // Cmd+Enter submit shortcut. Escape is handled by the shared Modal.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, handleSubmit]);

  const canSubmit =
    !!selectedContact && content.trim().length > 0 && !addInteraction.isPending;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      {/* Custom header — uses headless mode so the icon-prefixed title
          can use the brand color halo */}
      <div className="flex items-center justify-between px-5 py-4 bg-surface-container-low">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-primary/10 rounded-lg">
            <FileText className="w-4 h-4 text-primary" />
          </div>
          <h2 className="font-headline font-bold text-on-surface">
            Quick Interaction
          </h2>
        </div>
        <IconButton
          aria-label="Close dialog"
          tone="subtle"
          onClick={onClose}
          className="-mr-2"
        >
          <X className="w-5 h-5" />
        </IconButton>
      </div>

      {/* Body */}
      <div className="px-5 py-4 space-y-4">
        {/* Contact Picker */}
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1.5 block">
            Who?
          </label>

          {selectedContact ? (
            <div className="flex items-center gap-2 bg-surface-container-low rounded-xl px-3 py-2.5">
              <img
                src={
                  selectedContact.avatarUrl ||
                  fallbackAvatarUrl(selectedContact.name)
                }
                alt=""
                className="w-7 h-7 rounded-full object-cover"
              />
              <span className="font-bold text-sm text-on-surface flex-1 truncate">
                {selectedContact.name}
              </span>
              <IconButton
                aria-label="Change contact"
                tone="subtle"
                size="sm"
                onClick={clearContact}
              >
                <X className="w-4 h-4" />
              </IconButton>
            </div>
          ) : (
            <div className="relative">
              <div className="flex items-center gap-2 bg-surface-container-low rounded-xl px-3 py-2.5 focus-within:ring-2 focus-within:ring-primary/30 transition-all">
                <Search className="w-4 h-4 text-on-surface-variant/50 shrink-0" />
                <input
                  ref={contactInputRef}
                  value={contactQuery}
                  onChange={(e) => setContactQuery(e.target.value)}
                  onKeyDown={handleContactKeyDown}
                  placeholder="Search for a contact…"
                  // text-base on mobile prevents iOS Safari's auto-zoom on focus
                  // (which would otherwise rescale the whole bottom sheet).
                  className="flex-1 bg-transparent border-none focus:ring-0 focus:outline-none text-base sm:text-sm text-on-surface placeholder:text-on-surface-variant/40"
                  autoComplete="off"
                  inputMode="search"
                />
              </div>

              <AnimatePresence>
                {dropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="absolute top-full left-0 right-0 mt-1 bg-surface-container-lowest rounded-xl shadow-lg z-10 overflow-hidden max-h-[200px] overflow-y-auto"
                  >
                    {filteredContacts.map((contact, i) => (
                      <button
                        key={contact.id}
                        onClick={() => selectContact(contact)}
                        onMouseEnter={() => setHighlightIndex(i)}
                        // py-3 keeps every option ≥ 44 px tall on touch.
                        className={`w-full flex items-center gap-2.5 px-3 py-3 text-left transition-colors ${
                          i === highlightIndex
                            ? "bg-primary/10 text-primary"
                            : "text-on-surface hover:bg-surface-container-low"
                        }`}
                      >
                        <img
                          src={
                            contact.avatarUrl || fallbackAvatarUrl(contact.name)
                          }
                          alt=""
                          className="w-7 h-7 rounded-full object-cover"
                        />
                        <span className="text-sm font-medium truncate">
                          {contact.name}
                        </span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Type Selector — pill chips, each ≥ 44px tall on touch */}
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1.5 block">
            Type
          </label>
          <div className="flex flex-wrap gap-2">
            {INTERACTION_TYPES.map(({ type, label, icon }) => (
              <button
                key={type}
                onClick={() => setInteractionType(type)}
                aria-pressed={interactionType === type}
                className={`min-h-[44px] flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-bold transition-all ${
                  interactionType === type
                    ? "bg-primary text-on-primary shadow-sm"
                    : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high"
                }`}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Content Area */}
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1.5 block">
            What happened?
          </label>
          <textarea
            ref={contentRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Discussed Q3 targets and Series B timeline…"
            // text-base on mobile prevents iOS auto-zoom on focus.
            className="w-full bg-surface-container-low rounded-xl px-3 py-3 text-base sm:text-sm text-on-surface placeholder:text-on-surface-variant/40 border-none focus:ring-2 focus:ring-primary/30 focus:outline-none resize-none transition-all"
            style={{
              fieldSizing: "content" as unknown as "fixed",
              minHeight: "88px",
              maxHeight: "200px",
            }}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-3.5 bg-surface-container-low flex items-center justify-between sticky bottom-0 sm:static">
        <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-on-surface-variant/50">
          <kbd className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-md bg-surface-container-high text-[10px] font-bold">
            ⌘
          </kbd>
          {" + "}
          <kbd className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-md bg-surface-container-high text-[10px] font-bold">
            ⏎
          </kbd>
          {" to save"}
        </span>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          // min-h-[44px] keeps the primary CTA touch-safe.
          className="ml-auto min-h-[44px] flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary font-bold text-sm rounded-xl hover:bg-primary/90 active:bg-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {addInteraction.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <FileText className="w-4 h-4" />
          )}
          Save Interaction
        </button>
      </div>
    </Modal>
  );
};
