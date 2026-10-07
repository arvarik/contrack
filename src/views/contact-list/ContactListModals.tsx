/**
 * The contact list's dialogs: Add to list, Edit field, New contact, Add from
 * text, New list and Import.
 */
import React, { useEffect, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import { motion } from "motion/react";
import { FileText, Sparkles } from "lucide-react";
import { useBlockedAi } from "../../hooks/useAiSetup";
import { AiSetupNote } from "../../components/AiSetupNote";
import { useCreateContact, useParseContactText } from "../../api";
import type {
  ContactList as ContactListType,
  ParsedContactData,
} from "../../types";
import { Modal } from "../../components/ui/Modal";
import { ImportModal } from "../../components/ImportModal";
import { BulkModals } from "../../components/bulk/BulkModals";
import { AnimatedSkeleton } from "../../components/ui/AnimatedSkeleton";
import { FORM_INPUT, FORM_LABEL, formInputHighlight } from "../../lib/styles";
import { cn, errorText } from "../../lib/utils";
import { CreateListModal } from "./CreateListModal";
import { fallbackAvatarUrl } from "../../lib/avatar";

interface ContactListModalsProps {
  selectedCount: number;
  isAddToListOpen: boolean;
  onCloseAddToList: () => void;
  lists: ContactListType[];
  onBulkAddToList: (listId: string) => void;
  isBulkAddToListPending: boolean;
  isBulkEditOpen: boolean;
  onCloseBulkEdit: () => void;
  onBulkEditApply: (field: string, value: string | number) => void;
  isBulkEditPending: boolean;
  /** The control that opened New contact or Add from text, for focus return. */
  returnFocusRef: RefObject<HTMLElement | null>;
  /** Where focus goes after a bulk dialog: the Select button, once back. */
  bulkReturnFocusRef: RefObject<HTMLElement | null>;
  isModalOpen: boolean;
  onCloseModal: () => void;
  onContactCreated: (id: string) => void;
  isSmartPasteOpen: boolean;
  onCloseSmartPaste: () => void;
  /** The text was read: close Add from text and open the form, filled in. */
  onSmartPasteExtracted: () => void;
  isCreateListOpen: boolean;
  onCloseCreateList: () => void;
  onCreateList: (name: string, icon: string) => Promise<void>;
  isCreateListPending: boolean;
  isImportOpen: boolean;
  onCloseImport: () => void;
}

export const ContactListModals = ({
  selectedCount,
  isAddToListOpen,
  onCloseAddToList,
  lists,
  onBulkAddToList,
  isBulkAddToListPending,
  isBulkEditOpen,
  onCloseBulkEdit,
  onBulkEditApply,
  isBulkEditPending,
  returnFocusRef,
  bulkReturnFocusRef,
  isModalOpen,
  onCloseModal,
  onContactCreated,
  isSmartPasteOpen,
  onCloseSmartPaste,
  onSmartPasteExtracted,
  isCreateListOpen,
  onCloseCreateList,
  onCreateList,
  isCreateListPending,
  isImportOpen,
  onCloseImport,
}: ContactListModalsProps) => {
  const [smartPasteText, setSmartPasteText] = useState("");
  const [parsedData, setParsedData] = useState<ParsedContactData | null>(null);

  const createContact = useCreateContact();
  const parseContactText = useParseContactText();
  // Add from text needs a Fast model. Without one the dialog says how to
  // set it up, before Extract is pressed.
  const aiBlocked = useBlockedAi("text", isSmartPasteOpen);

  // What an extraction found, which fills the New contact form.
  const pd = parsedData;

  // Closing Add from text during an extraction cancels it: no form, no toast.
  const smartPasteOpen = useRef(isSmartPasteOpen);
  useEffect(() => {
    smartPasteOpen.current = isSmartPasteOpen;
  }, [isSmartPasteOpen]);
  // Leaving the page cancels too, so no toast shows on the next page.
  useEffect(
    () => () => {
      smartPasteOpen.current = false;
    },
    [],
  );

  const handleExtract = async () => {
    try {
      const res = await parseContactText.mutateAsync(smartPasteText);
      if (!smartPasteOpen.current) return;
      setParsedData(res);
      onSmartPasteExtracted();
      toast.success("Contact details found. Check them and save");
    } catch (err) {
      if (!smartPasteOpen.current) return;
      toast.error(`Could not read the text: ${errorText(err)}`);
    }
  };

  const handleCreateContact = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries());
    const emailValue = data.email as string;
    const phoneValue = data.phone as string;
    try {
      const newContact = await createContact.mutateAsync({
        name: data.name as string,
        role: data.role as string,
        company: data.company as string,
        location: data.location as string,
        avatarUrl:
          (data.avatarUrl as string) || fallbackAvatarUrl(data.name as string),
        emails: emailValue
          ? [{ email: emailValue, label: "work", isPrimary: true }]
          : [],
        phones: phoneValue
          ? [{ phone: phoneValue, label: "mobile", isPrimary: true }]
          : [],
        ...(pd?.socialLinks ? { socialLinks: pd.socialLinks } : {}),
        ...(pd?.education ? { education: pd.education } : {}),
        ...(pd?.experience ? { experience: pd.experience } : {}),
      });
      onCloseModal();
      setParsedData(null);
      setSmartPasteText("");
      toast.success(`Created "${data.name}"`);
      if (newContact?.id) onContactCreated(newContact.id);
    } catch (err: unknown) {
      toast.error(`Could not create the contact: ${errorText(err)}`);
    }
  };

  return (
    <>
      {/* Bulk delete has no confirmation: it goes to a 30-day Trash and its
          toast offers Undo (lib/undoToast). */}
      <BulkModals
        selectedCount={selectedCount}
        isAddToListOpen={isAddToListOpen}
        onCloseAddToList={onCloseAddToList}
        lists={lists}
        onBulkAddToList={onBulkAddToList}
        isBulkAddToListPending={isBulkAddToListPending}
        isBulkEditOpen={isBulkEditOpen}
        onCloseBulkEdit={onCloseBulkEdit}
        onBulkEditApply={onBulkEditApply}
        isBulkEditPending={isBulkEditPending}
        returnFocusRef={bulkReturnFocusRef}
      />

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          onCloseModal();
          setParsedData(null);
        }}
        title="New contact"
        returnFocusRef={returnFocusRef}
      >
        <form onSubmit={handleCreateContact} className="space-y-4 pt-2">
          <div>
            <label htmlFor="new-contact-name" className={FORM_LABEL}>
              Full name *
            </label>
            <input
              id="new-contact-name"
              required
              name="name"
              type="text"
              // Autofill stays off: these are another person's details, and
              // autofill would offer the owner's own.
              autoCapitalize="words"
              autoComplete="off"
              defaultValue={(pd?.name as string) || ""}
              className={cn(FORM_INPUT, formInputHighlight(!!pd?.name))}
              placeholder="Jane Doe"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="new-contact-role" className={FORM_LABEL}>
                Role
              </label>
              <input
                id="new-contact-role"
                name="role"
                type="text"
                defaultValue={(pd?.role as string) || ""}
                className={cn(FORM_INPUT, formInputHighlight(!!pd?.role))}
                placeholder="CEO"
              />
            </div>
            <div>
              <label htmlFor="new-contact-company" className={FORM_LABEL}>
                Company
              </label>
              <input
                id="new-contact-company"
                name="company"
                type="text"
                defaultValue={(pd?.company as string) || ""}
                className={cn(FORM_INPUT, formInputHighlight(!!pd?.company))}
                placeholder="Acme Corp"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="new-contact-email" className={FORM_LABEL}>
                Email
              </label>
              <input
                id="new-contact-email"
                name="email"
                type="email"
                autoComplete="off"
                defaultValue={
                  (pd?.emails?.[0]?.email as string) ||
                  (pd?.email as string) ||
                  ""
                }
                className={cn(
                  FORM_INPUT,
                  formInputHighlight(!!(pd?.emails?.[0]?.email || pd?.email)),
                )}
                placeholder="jane@example.com"
              />
            </div>
            <div>
              <label htmlFor="new-contact-phone" className={FORM_LABEL}>
                Phone
              </label>
              <input
                id="new-contact-phone"
                name="phone"
                type="tel"
                autoComplete="off"
                defaultValue={
                  (pd?.phones?.[0]?.phone as string) ||
                  (pd?.phone as string) ||
                  ""
                }
                className={cn(
                  FORM_INPUT,
                  formInputHighlight(!!(pd?.phones?.[0]?.phone || pd?.phone)),
                )}
                placeholder="+1 (555) 000-0000"
              />
            </div>
          </div>
          <div>
            <label htmlFor="new-contact-location" className={FORM_LABEL}>
              Location
            </label>
            <input
              id="new-contact-location"
              name="location"
              type="text"
              defaultValue={(pd?.location as string) || ""}
              className={cn(FORM_INPUT, formInputHighlight(!!pd?.location))}
              placeholder="San Francisco, CA"
            />
          </div>
          <div className="pt-4">
            <button
              type="submit"
              disabled={createContact.isPending}
              className="btn-primary w-full"
            >
              {createContact.isPending ? "Saving…" : "Save contact"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={isSmartPasteOpen}
        onClose={onCloseSmartPaste}
        title="Add from text"
        returnFocusRef={returnFocusRef}
      >
        <div className="space-y-4 pt-2">
          {parseContactText.isPending ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-4 pt-2"
            >
              <div className="flex items-center gap-2 text-primary text-sm font-bold pb-2">
                <Sparkles className="w-4 h-4" /> Reading the text…
              </div>
              <div className="space-y-4">
                <AnimatedSkeleton
                  className="h-10 w-full rounded-lg"
                  delay={0}
                />
                <div className="grid grid-cols-2 gap-4">
                  <AnimatedSkeleton className="h-10 rounded-lg" delay={0.1} />
                  <AnimatedSkeleton className="h-10 rounded-lg" delay={0.2} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <AnimatedSkeleton className="h-10 rounded-lg" delay={0.3} />
                  <AnimatedSkeleton className="h-10 rounded-lg" delay={0.4} />
                </div>
              </div>
            </motion.div>
          ) : aiBlocked ? (
            <AiSetupNote
              setup={aiBlocked}
              onNavigate={onCloseSmartPaste}
              className="text-sm leading-relaxed"
            />
          ) : (
            <>
              <p className="text-sm text-on-surface-variant leading-relaxed">
                Paste an email signature, a LinkedIn bio or rough notes, and AI
                picks out the contact's details
              </p>
              <textarea
                aria-label="Paste contact details"
                // Dialog whose whole purpose is the pasted text.
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                value={smartPasteText}
                onChange={(e) => setSmartPasteText(e.target.value)}
                rows={5}
                className="w-full bg-surface-container border-none rounded-xl p-4 text-sm font-mono text-on-surface resize-none"
                placeholder={`Examples:\n• "Jane Kim | VP Eng @ Stripe | jane@stripe.com | based in NYC"\n• A copied LinkedIn summary\n• A forwarded email signature`}
              />
            </>
          )}
          {!aiBlocked && (
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={handleExtract}
                disabled={!smartPasteText.trim() || parseContactText.isPending}
                className="btn-primary"
              >
                <FileText className="w-4 h-4" />
                {parseContactText.isPending ? "Extracting…" : "Extract contact"}
              </button>
            </div>
          )}
        </div>
      </Modal>

      <CreateListModal
        isOpen={isCreateListOpen}
        onClose={onCloseCreateList}
        onCreate={onCreateList}
        isPending={isCreateListPending}
      />

      {/* The import's own summary says how it went: no second toast. */}
      <ImportModal
        isOpen={isImportOpen}
        onClose={onCloseImport}
        onSuccess={() => {}}
      />
    </>
  );
};
