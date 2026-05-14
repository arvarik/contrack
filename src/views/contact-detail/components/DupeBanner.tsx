/**
 * DupeBanner — Point-of-action banner for pending duplicate suggestions.
 *
 * Renders in the Contact Detail Page when the dedupe engine has found
 * a likely duplicate of the currently viewed contact. Provides inline
 * review with side-by-side comparison and one-click merge/dismiss.
 */
import React, { useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeftRight,
  CheckCircle2,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  useSuggestionForContact,
  useDismissSuggestion,
  useMergeSuggestion,
} from "../../../api";
import { ContactCard } from "../../dedupe/components/shared/ContactCard";

// =============================================================================
// Props
// =============================================================================

interface DupeBannerProps {
  contactId: string;
  contactName: string;
}

// =============================================================================
// Component
// =============================================================================

export const DupeBanner = ({ contactId, contactName }: DupeBannerProps) => {
  const { data: suggestion, isLoading } = useSuggestionForContact(contactId);
  const dismiss = useDismissSuggestion();
  const merge = useMergeSuggestion();
  const [dismissed, setDismissed] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [swapped, setSwapped] = useState(false);

  if (isLoading || !suggestion || dismissed) return null;

  const currentContact =
    suggestion.contactIdA === contactId
      ? suggestion.contactA
      : suggestion.contactB;

  const otherContact =
    suggestion.contactIdA === contactId
      ? suggestion.contactB
      : suggestion.contactA;

  if (!otherContact || !currentContact) return null;

  // By default, the current contact is primary (user came to this page)
  const primary = swapped ? otherContact : currentContact;
  const duplicate = swapped ? currentContact : otherContact;

  const handleDismiss = async () => {
    try {
      await dismiss.mutateAsync(suggestion.id);
      setDismissed(true);
      toast("Marked as different people");
    } catch (err: unknown) {
      toast.error(
        `Failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const handleMerge = async () => {
    try {
      await merge.mutateAsync({
        suggestionId: suggestion.id,
        primaryId: primary.id,
      });
      setDismissed(true); // Hide banner after merge
      toast.success(`Merged into ${primary.name}`);
    } catch (err: unknown) {
      toast.error(
        `Merge failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return (
    <div className="max-w-6xl mx-auto w-full px-6 md:px-8 lg:px-10 mt-2 mb-4">
      {/* Collapsed banner */}
      <div className="flex items-center gap-3 bg-primary/5 rounded-xl px-4 py-3">
        <span className="text-primary text-base">✨</span>
        <p className="flex-1 text-sm text-on-surface">
          We found another contact that looks like{" "}
          <span className="font-bold">{otherContact.name || "someone"}</span>.
        </p>
        <button
          onClick={() => setShowReview((v) => !v)}
          className="shrink-0 px-3 py-1.5 text-xs font-bold text-on-primary bg-primary rounded-full hover:shadow-md hover:shadow-primary/20 transition-all"
        >
          {showReview ? "Hide" : "Review Match"}
        </button>
        <button
          onClick={handleDismiss}
          disabled={dismiss.isPending}
          className="shrink-0 px-3 py-1.5 text-xs font-bold text-on-surface-variant bg-surface-container-low hover:bg-surface-container-high rounded-full transition-colors disabled:opacity-50"
        >
          Not the same
        </button>
      </div>

      {/* Expandable inline review panel */}
      <AnimatePresence>
        {showReview && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="pt-4 space-y-4">
              {/* AI Reasoning */}
              {suggestion.reasoning && (
                <div className="flex items-start gap-2.5 bg-primary/5 rounded-xl p-3">
                  <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <p className="text-sm text-on-surface leading-relaxed">
                    {suggestion.reasoning}
                  </p>
                </div>
              )}

              {/* Side-by-side comparison */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 relative">
                <div className="min-w-0">
                  <ContactCard
                    contact={primary}
                    label="Primary (Keeper)"
                    labelColor="text-emerald-600 bg-emerald-500/10"
                    other={duplicate}
                    isPrimary
                  />
                </div>
                <button
                  onClick={() => setSwapped((s) => !s)}
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 p-2 bg-surface rounded-full shadow-lg hover:shadow-xl hover:scale-110 transition-all hidden lg:flex items-center justify-center"
                  title="Swap primary / duplicate"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5 text-on-surface-variant hover:text-primary transition-colors" />
                </button>
                <div className="min-w-0">
                  <ContactCard
                    contact={duplicate}
                    label="Duplicate (Merges In)"
                    labelColor="text-amber-600 bg-amber-500/10"
                    other={primary}
                    onSetPrimary={() => setSwapped((s) => !s)}
                  />
                </div>
              </div>

              {/* Mobile swap button */}
              <button
                onClick={() => setSwapped((s) => !s)}
                className="lg:hidden w-full flex items-center justify-center gap-2 py-2 bg-surface-container-low rounded-xl text-xs font-bold text-on-surface-variant hover:text-primary transition-colors"
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                Swap Primary / Duplicate
              </button>

              {/* Action buttons */}
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={handleDismiss}
                  disabled={dismiss.isPending}
                  className="flex items-center gap-2 px-5 py-2.5 bg-surface-container-low hover:bg-rose-500/8 rounded-xl text-sm font-bold text-on-surface-variant hover:text-rose-600 transition-all disabled:opacity-50"
                >
                  <X className="w-4 h-4" />
                  Keep Separate
                </button>
                <button
                  onClick={handleMerge}
                  disabled={merge.isPending}
                  className="flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary rounded-xl text-sm font-bold hover:shadow-lg hover:shadow-primary/20 transition-all disabled:opacity-50"
                >
                  {merge.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  Merge Contacts
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
