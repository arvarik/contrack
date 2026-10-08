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
import {
  useAddInteraction,
  useCreateContact,
  useParseContactText,
} from "../../api";
import type {
  ContactList as ContactListType,
  ParsedContactData,
} from "../../types";
import { Modal } from "../../components/ui/Modal";
import { ImportModal } from "../../components/ImportModal";
import { BulkModals } from "../../components/bulk/BulkModals";
import { AnimatedSkeleton } from "../../components/ui/AnimatedSkeleton";
import { FORM_INPUT, FORM_LABEL, formInputHighlight } from "../../lib/styles";
import { cn, errorText, plural } from "../../lib/utils";
import { CreateListModal } from "./CreateListModal";
import { fallbackAvatarUrl } from "../../lib/avatar";
import { INTERACTION_LABELS } from "../../lib/interactionKinds";
import { dayInZone } from "../../../shared/dates";

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
  /** From the first request to the last: the contact, then its interactions. */
  const [isSaving, setIsSaving] = useState(false);

  const createContact = useCreateContact();
  const addInteraction = useAddInteraction();
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
    const form = new FormData(e.currentTarget);
    const field = (key: string) => String(form.get(key) ?? "").trim();
    const name = field("name");
    const email = field("email");
    const phone = field("phone");
    const today = dayInZone(new Date()) ?? "";
    const { interactions = [], emails = [], phones = [], ...found } = pd ?? {};
    // What the text gave, with the form's values on top. The first email and
    // phone are the form's, and the model's split of a name the form changed
    // is stale.
    const contact = {
      ...found,
      ...(pd && name !== pd.name && { firstName: null, lastName: null }),
      name,
      role: field("role"),
      company: field("company"),
      location: field("location"),
      avatarUrl: fallbackAvatarUrl(name),
      emails: [
        ...(email
          ? [{ email, label: emails[0]?.label ?? "work", isPrimary: true }]
          : []),
        ...emails.slice(1),
      ],
      phones: [
        ...(phone
          ? [{ phone, label: phones[0]?.label ?? "mobile", isPrimary: true }]
          : []),
        ...phones.slice(1),
      ],
      ...(found.tags && {
        tags: form.getAll("tag").map((tag) => ({ tag: String(tag) })),
      }),
    };
    // The ticked interactions, each on its day. Today is the moment of the
    // save, as in the composer.
    const notes = interactions.flatMap((item, index) => {
      if (!form.has(`interaction-${index}`)) return [];
      const day = field(`interaction-${index}-day`);
      return [
        {
          type: item.type,
          title: INTERACTION_LABELS[item.type],
          content: item.summary,
          ...(day && day < today && { date: day }),
        },
      ];
    });
    setIsSaving(true);
    try {
      const newContact = await createContact.mutateAsync(contact);
      const saved = await Promise.allSettled(
        notes.map((data) =>
          addInteraction.mutateAsync({ contactId: newContact.id, data }),
        ),
      );
      const failed = saved.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      onCloseModal();
      setParsedData(null);
      setSmartPasteText("");
      const logged = saved.length - failed.length;
      toast.success(
        logged > 0
          ? `Created "${name}" with ${plural(logged, "interaction", "interactions")}`
          : `Created "${name}"`,
      );
      if (failed.length > 0)
        toast.error(
          `Could not save ${plural(failed.length, "interaction", "interactions")}: ${errorText(failed[0])}`,
        );
      onContactCreated(newContact.id);
    } catch (err: unknown) {
      toast.error(`Could not create the contact: ${errorText(err)}`);
    } finally {
      setIsSaving(false);
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
                defaultValue={pd?.emails?.[0]?.email ?? ""}
                className={cn(
                  FORM_INPUT,
                  formInputHighlight(!!pd?.emails?.[0]?.email),
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
                defaultValue={pd?.phones?.[0]?.phone ?? ""}
                className={cn(
                  FORM_INPUT,
                  formInputHighlight(!!pd?.phones?.[0]?.phone),
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
          {pd && <FoundInText found={pd} />}
          <div className="pt-4">
            <button
              type="submit"
              disabled={isSaving}
              className="btn-primary w-full"
            >
              {isSaving ? "Saving…" : "Save contact"}
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
                Paste an email signature, a LinkedIn bio or notes from a
                meeting, and AI picks out the person's details, their
                specialties and the meetings the text describes
              </p>
              <textarea
                aria-label="Paste contact details"
                // Dialog whose whole purpose is the pasted text.
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                value={smartPasteText}
                onChange={(e) => setSmartPasteText(e.target.value)}
                rows={5}
                // A phone grows the box with a long paste, up to 40 percent
                // of the screen, then it scrolls.
                className="w-full bg-surface-container border-none rounded-xl p-4 text-sm font-mono text-on-surface resize-none max-sm:[field-sizing:content] max-sm:min-h-32 max-sm:max-h-[40dvh]"
                placeholder={`Examples:\n• "Jane Kim | VP Eng @ Stripe | jane@stripe.com | based in NYC"\n• A copied LinkedIn summary\n• "Met Jane at SaaStr on Tuesday, talked about her Series A"`}
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

/** What else the text gave, saved as it is: "about", "2 jobs". */
function alsoSaved(found: ParsedContactData): string[] {
  const count = (
    items: unknown[] | undefined,
    one: string,
    many: string,
    shown = 0,
  ) => {
    const left = (items?.length ?? 0) - shown;
    return left > 0 && plural(left, one, many);
  };
  return [
    found.headline && "headline",
    found.about && "about",
    found.industry && "industry",
    found.website && "website",
    found.birthday && "birthday",
    found.pronouns && "pronouns",
    count(found.emails, "more email", "more emails", 1),
    count(found.phones, "more phone", "more phones", 1),
    count(found.socialLinks, "link", "links"),
    count(found.experience, "job", "jobs"),
    count(found.education, "school", "schools"),
    count(found.interests, "interest", "interests"),
    count(found.addresses, "address", "addresses"),
    count(found.attributes, "other fact", "other facts"),
  ].filter((part): part is string => !!part);
}

/**
 * What Add from text found past the form's fields. Each tag and each
 * interaction is a ticked checkbox, so a wrong one stays out, and an
 * interaction's day can be put right. The rest is named, and saves as found.
 */
const FoundInText = ({ found }: { found: ParsedContactData }) => {
  const id = React.useId();
  const today = dayInZone(new Date()) ?? "";
  const extras = alsoSaved(found);
  return (
    <>
      {!!found.tags?.length && (
        <fieldset>
          <legend className={FORM_LABEL}>Tags</legend>
          <div className="flex flex-wrap gap-2">
            {found.tags.map(({ tag }) => (
              <label
                key={tag}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-3 min-h-[44px] sm:pointer-fine:min-h-8 text-sm text-on-surface cursor-pointer",
                  formInputHighlight(true),
                )}
              >
                <input
                  type="checkbox"
                  name="tag"
                  value={tag}
                  defaultChecked
                  className="w-4 h-4 shrink-0 accent-primary"
                />
                {tag}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {!!found.interactions?.length && (
        <fieldset>
          <legend className={FORM_LABEL}>Interactions</legend>
          <ul className="space-y-2">
            {found.interactions.map((item, index) => (
              <li
                key={index}
                className={cn("rounded-xl px-3 py-2", formInputHighlight(true))}
              >
                <div className="flex items-center justify-between gap-3">
                  <label className="inline-flex items-center gap-2 min-h-[44px] sm:pointer-fine:min-h-8 text-sm font-bold text-on-surface cursor-pointer">
                    <input
                      type="checkbox"
                      name={`interaction-${index}`}
                      defaultChecked
                      aria-describedby={`${id}-${index}`}
                      className="w-4 h-4 shrink-0 accent-primary"
                    />
                    {INTERACTION_LABELS[item.type]}
                  </label>
                  <input
                    type="date"
                    name={`interaction-${index}-day`}
                    aria-label={`Date of the ${INTERACTION_LABELS[item.type].toLowerCase()}`}
                    aria-describedby={`${id}-${index}`}
                    max={today}
                    defaultValue={item.date ?? today}
                    className="min-h-[44px] sm:pointer-fine:min-h-8 rounded-lg bg-surface-container px-2.5 text-base sm:text-xs font-bold text-on-surface"
                  />
                </div>
                <p
                  id={`${id}-${index}`}
                  className="pb-1 text-sm text-on-surface-variant text-pretty"
                >
                  {item.summary}
                </p>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      {extras.length > 0 && (
        <p className="text-xs text-on-surface-variant">
          Also saved: {extras.join(", ")}
        </p>
      )}
    </>
  );
};
