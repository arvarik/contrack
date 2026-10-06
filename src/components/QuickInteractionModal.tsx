/**
 * Log an interaction without leaving the page. ⌘⇧I opens it (Ctrl+Alt+I on
 * Windows and Linux), Escape closes it, ⌘ Enter saves.
 *
 * A header and a "Who?" picker around the compact {@link InteractionComposer},
 * the contact page's composer. Its draft survives a close.
 * `initialContactId` opens it for one person, with no picker and focus in the
 * editor.
 *
 * The picker has its own keys, because it leaves out ghosts and shows the
 * top six, which the generic Combobox does not model.
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
import { X, Search, PenLine } from "lucide-react";
import { useContactNames } from "../api";
import type { ContactSlim } from "../api/contacts";
import { fallbackAvatarUrl } from "../lib/avatar";
import {
  FORM_LABEL,
  MENU_ITEM,
  MENU_ITEM_SELECTED,
  MENU_PANEL,
} from "../lib/styles";
import { DURATION, EASE } from "../lib/motion";
import { cn } from "../lib/utils";
import { DialogCloseButton, Modal } from "./ui/Modal";
import { IconButton } from "./ui/IconButton";
import { ComposerPlaceholder } from "./ComposerPlaceholder";
import { composerChunk } from "./composerChunk";
import {
  INTERACTION_LABELS,
  type InteractionKind,
} from "../lib/interactionKinds";
import { NO_AUTOCORRECT } from "./ui/SearchField";

/**
 * The composer carries tiptap and ProseMirror, so it is its own chunk
 * (`composerChunk`), the contact page's. A closed dialog loads none of it.
 */
const InteractionComposer = composerChunk.Component;

interface QuickInteractionModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Open for this contact: chosen already, with no picker. */
  initialContactId?: string;
}

export const QuickInteractionModal: React.FC<QuickInteractionModalProps> = ({
  isOpen,
  onClose,
  initialContactId,
}) => {
  const [selectedContact, setSelectedContact] = useState<ContactSlim | null>(
    null,
  );
  const [contactQuery, setContactQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  /** True while the dialog waits for the composer to take focus. */
  const [focusComposer, setFocusComposer] = useState(false);

  const contactInputRef = useRef<HTMLInputElement>(null);
  const listId = React.useId();

  const { data: contacts } = useContactNames();

  /** The preset contact, once the names have loaded. */
  const presetContact = useMemo(
    () =>
      initialContactId
        ? (contacts?.find((c) => c.id === initialContactId) ?? null)
        : null,
    [contacts, initialContactId],
  );
  const chosen = initialContactId ? presetContact : selectedContact;
  const chosenId = initialContactId ?? selectedContact?.id ?? null;

  const filteredContacts = useMemo(() => {
    if (!contacts || !contactQuery.trim()) return [];
    const q = contactQuery.toLowerCase();
    return contacts
      .filter((c) => !c.isGhost && c.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [contacts, contactQuery]);

  // Reset on close (deferred so the exit animation completes first). The
  // composer needs no reset: it leaves the page with the dialog's content.
  useEffect(() => {
    if (!isOpen) {
      const t = setTimeout(() => {
        setSelectedContact(null);
        setContactQuery("");
        setDropdownOpen(false);
        setHighlightIndex(0);
        setFocusComposer(false);
      }, 300);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  // Focus on open: the picker, or the editor when the contact is chosen.
  // Deferred past the Modal's own first focus, so this one wins.
  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => {
      if (initialContactId) setFocusComposer(true);
      else contactInputRef.current?.focus();
    }, 120);
    return () => clearTimeout(t);
  }, [isOpen, initialContactId]);

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
    setFocusComposer(true);
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

  const handleSaved = useCallback(
    ({ type }: { type: InteractionKind }) => {
      const name = chosen?.name;
      toast.success(
        name
          ? `${INTERACTION_LABELS[type]} logged for ${name}`
          : `${INTERACTION_LABELS[type]} logged`,
      );
      onClose();
    },
    [chosen, onClose],
  );

  const focusPicker = useCallback(() => {
    contactInputRef.current?.focus();
  }, []);

  const composerFocused = useCallback(() => setFocusComposer(false), []);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      // The header below is the modal's own, so the primitive needs telling
      // what to call the dialog.
      ariaLabel="Log an interaction"
    >
      <div className="flex items-center justify-between px-5 py-4 bg-surface-container-low">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-primary/10 rounded-lg">
            <PenLine aria-hidden="true" className="w-4 h-4 text-primary" />
          </div>
          <h2 className="font-headline font-bold text-on-surface">
            Log an interaction
          </h2>
        </div>
        <DialogCloseButton onClick={onClose} />
      </div>

      {/* Who */}
      <div className="px-5 pt-4 pb-2">
        {initialContactId ? (
          // Chosen by whoever opened the dialog. Shown, not offered.
          <p className="flex items-center gap-2 text-sm text-on-surface-variant">
            <span>With</span>
            {chosen && (
              <>
                <img
                  src={chosen.avatarUrl || fallbackAvatarUrl(chosen.name)}
                  alt=""
                  className="w-7 h-7 rounded-full object-cover"
                />
                <span className="font-bold text-on-surface truncate">
                  {chosen.name}
                </span>
              </>
            )}
          </p>
        ) : (
          <>
            <span className={FORM_LABEL}>Who?</span>
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
                {/* A composite field: the box draws the ring for its input. */}
                <div className="focus-frame flex items-center gap-2 bg-surface-container-low rounded-xl px-3 py-2.5">
                  <Search
                    aria-hidden="true"
                    className="w-4 h-4 text-on-surface-variant shrink-0"
                  />
                  <input
                    aria-label="Search for a contact"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={dropdownOpen}
                    aria-controls={dropdownOpen ? listId : undefined}
                    aria-activedescendant={
                      dropdownOpen && filteredContacts[highlightIndex]
                        ? `${listId}-${highlightIndex}`
                        : undefined
                    }
                    ref={contactInputRef}
                    value={contactQuery}
                    onChange={(e) => setContactQuery(e.target.value)}
                    onKeyDown={handleContactKeyDown}
                    placeholder="Search for a contact…"
                    // text-base on a phone, or iOS Safari zooms on focus.
                    className="flex-1 bg-transparent border-none text-base sm:text-sm text-on-surface placeholder:text-on-surface-variant"
                    autoComplete="off"
                    {...NO_AUTOCORRECT}
                    inputMode="search"
                  />
                </div>

                <AnimatePresence>
                  {dropdownOpen && (
                    <motion.div
                      id={listId}
                      role="listbox"
                      aria-label="Matching contacts"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: DURATION.fast, ease: EASE }}
                      // Motion draws the entrance, so the panel's own CSS
                      // entrance is taken off.
                      className={cn(
                        MENU_PANEL,
                        "menu-enter-none absolute top-full left-0 right-0 mt-1 z-10 min-w-0 max-h-[200px]",
                      )}
                    >
                      {filteredContacts.map((contact, i) => (
                        <button
                          key={contact.id}
                          id={`${listId}-${i}`}
                          type="button"
                          role="option"
                          aria-selected={i === highlightIndex}
                          onClick={() => selectContact(contact)}
                          onMouseEnter={() => setHighlightIndex(i)}
                          className={cn(
                            MENU_ITEM,
                            i === highlightIndex && MENU_ITEM_SELECTED,
                          )}
                        >
                          <img
                            src={
                              contact.avatarUrl ||
                              fallbackAvatarUrl(contact.name)
                            }
                            alt=""
                            className="w-7 h-7 rounded-full object-cover"
                          />
                          <span className="truncate">{contact.name}</span>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </>
        )}
      </div>

      <React.Suspense fallback={<ComposerPlaceholder compact />}>
        <InteractionComposer
          compact
          contactId={chosenId}
          focusRequested={focusComposer}
          onFocusHandled={composerFocused}
          onSaved={handleSaved}
          onContactMissing={focusPicker}
        />
      </React.Suspense>
    </Modal>
  );
};
