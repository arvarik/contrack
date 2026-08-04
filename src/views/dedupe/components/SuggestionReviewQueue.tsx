import React, {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from "react";
import {
  CheckCircle2,
  X,
  Loader2,
  ArrowLeftRight,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Shield,
  Inbox,
  Crown,
  AlertTriangle,
  Link2,
  Square,
  CheckSquare,
  GitMerge,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import {
  usePendingSuggestions,
  useMergeSuggestion,
  useDismissSuggestion,
} from "../../../api";
import { ContactCard } from "./shared/ContactCard";
import { MatchBadge } from "./shared/MatchBadge";
import { cn } from "../../../lib/utils";
import { fallbackAvatarUrl } from "../../../lib/avatar";
import type { Contact, PersistedDedupeSuggestion } from "../../../types";

// =============================================================================
// Lightweight Union-Find for frontend cluster grouping
// =============================================================================

class SimpleUnionFind {
  private parent = new Map<string, string>();
  private rank = new Map<string, number>();

  find(x: string): string {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let current = x;
    while (current !== root) {
      const next = this.parent.get(current)!;
      this.parent.set(current, root);
      current = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a),
      rb = this.find(b);
    if (ra === rb) return;
    const rankA = this.rank.get(ra) ?? 0;
    const rankB = this.rank.get(rb) ?? 0;
    if (rankA < rankB) this.parent.set(ra, rb);
    else if (rankA > rankB) this.parent.set(rb, ra);
    else {
      this.parent.set(rb, ra);
      this.rank.set(ra, rankA + 1);
    }
  }

  getClusters(): Map<string, string[]> {
    const clusters = new Map<string, string[]>();
    for (const key of this.parent.keys()) {
      const root = this.find(key);
      const arr = clusters.get(root) ?? [];
      arr.push(key);
      clusters.set(root, arr);
    }
    return clusters;
  }
}

// =============================================================================
// Types
// =============================================================================

interface SuggestionCluster {
  id: string;
  contacts: Contact[];
  suggestions: PersistedDedupeSuggestion[];
  bestPrimaryId: string;
  maxConfidence: number;
  hasWeakLink: boolean;
}

// =============================================================================
// Utility: pick best primary from a list of contacts
// =============================================================================

function pickBestPrimary(contacts: Contact[]): Contact {
  let best = contacts[0];
  let bestScore = scorePrimary(best);
  for (let i = 1; i < contacts.length; i++) {
    const s = scorePrimary(contacts[i]);
    if (s > bestScore) {
      best = contacts[i];
      bestScore = s;
    }
  }
  return best;
}

function scorePrimary(c: Contact): number {
  let score = 0;
  if (c.avatarUrl?.startsWith("/uploads/avatars/")) score += 100;
  else if (c.avatarUrl) score += 5;
  if (c.about) score += 5;
  if (c.role) score += 3;
  if (c.company) score += 3;
  if (c.location) score += 2;
  score += (c.emails?.length ?? 0) * 3;
  score += (c.phones?.length ?? 0) * 3;
  score += (c.socialLinks?.length ?? 0) * 2;
  score += c.tags?.length ?? 0;
  return score;
}

// =============================================================================
// Group pairwise suggestions into clusters
// =============================================================================

function buildSuggestionClusters(
  suggestions: PersistedDedupeSuggestion[],
): SuggestionCluster[] {
  if (suggestions.length === 0) return [];

  const uf = new SimpleUnionFind();
  const contactMap = new Map<string, Contact>();

  for (const s of suggestions) {
    if (!s.contactA || !s.contactB) continue;
    uf.union(s.contactIdA, s.contactIdB);
    contactMap.set(s.contactIdA, s.contactA);
    contactMap.set(s.contactIdB, s.contactB);
  }

  const clusterGroups = uf.getClusters();
  const clusterSuggestionMap = new Map<string, PersistedDedupeSuggestion[]>();

  for (const s of suggestions) {
    if (!s.contactA || !s.contactB) continue;
    const root = uf.find(s.contactIdA);
    const arr = clusterSuggestionMap.get(root) ?? [];
    arr.push(s);
    clusterSuggestionMap.set(root, arr);
  }

  const result: SuggestionCluster[] = [];

  for (const [root, memberIds] of clusterGroups) {
    const contacts = memberIds
      .map((id) => contactMap.get(id))
      .filter((c): c is Contact => c !== undefined);

    if (contacts.length < 2) continue;

    const clusterSuggestions = clusterSuggestionMap.get(root) ?? [];
    if (clusterSuggestions.length === 0) continue;

    const confidences = clusterSuggestions.map((s) => s.confidence);
    const primary = pickBestPrimary(contacts);

    result.push({
      id: clusterSuggestions[0].id,
      contacts,
      suggestions: clusterSuggestions,
      bestPrimaryId: primary.id,
      maxConfidence: Math.max(...confidences),
      hasWeakLink: Math.min(...confidences) < 0.6,
    });
  }

  result.sort((a, b) => b.maxConfidence - a.maxConfidence);
  return result;
}

// =============================================================================
// SuggestionReviewQueue — with multi-select batch actions
// =============================================================================

export const SuggestionReviewQueue = () => {
  const { data: suggestions = [], isLoading } = usePendingSuggestions();
  const mergeSuggestion = useMergeSuggestion();
  const dismissSuggestion = useDismissSuggestion();

  const clusters = useMemo(
    () => buildSuggestionClusters(suggestions),
    [suggestions],
  );

  // Multi-select state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(clusters.map((c) => c.id)));
  }, [clusters]);

  const selectNone = useCallback(() => {
    setSelected(new Set());
  }, []);

  const selectedClusters = useMemo(
    () => clusters.filter((c) => selected.has(c.id)),
    [clusters, selected],
  );

  const handleBatchMerge = useCallback(async () => {
    if (isBatchProcessing || selectedClusters.length === 0) return;
    setIsBatchProcessing(true);
    try {
      for (const cluster of selectedClusters) {
        for (const s of cluster.suggestions) {
          await mergeSuggestion.mutateAsync({
            suggestionId: s.id,
            primaryId: cluster.bestPrimaryId,
          });
        }
      }
      toast.success(
        `Merged ${selectedClusters.length} group${selectedClusters.length !== 1 ? "s" : ""}`,
      );
      setSelected(new Set());
    } catch (err: unknown) {
      toast.error(
        `Batch merge failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setIsBatchProcessing(false);
    }
  }, [selectedClusters, mergeSuggestion, isBatchProcessing]);

  const handleBatchDismiss = useCallback(async () => {
    if (isBatchProcessing || selectedClusters.length === 0) return;
    setIsBatchProcessing(true);
    try {
      for (const cluster of selectedClusters) {
        for (const s of cluster.suggestions) {
          await dismissSuggestion.mutateAsync(s.id);
        }
      }
      toast(
        "Dismissed " +
          selectedClusters.length +
          " group" +
          (selectedClusters.length !== 1 ? "s" : ""),
        {
          icon: <Shield className="w-4 h-4 text-on-surface-variant" />,
        },
      );
      setSelected(new Set());
    } catch (err: unknown) {
      toast.error(
        `Batch dismiss failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setIsBatchProcessing(false);
    }
  }, [selectedClusters, dismissSuggestion, isBatchProcessing]);

  // ─── Keyboard Navigation ───────────────────────────────────────────────
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const clusterRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const setClusterRef = useCallback(
    (index: number, el: HTMLDivElement | null) => {
      if (el) clusterRefs.current.set(index, el);
      else clusterRefs.current.delete(index);
    },
    [],
  );

  useEffect(() => {
    if (clusters.length === 0) return;

    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      switch (e.key) {
        case "j":
        case "ArrowDown": {
          e.preventDefault();
          setFocusedIndex((prev) => {
            const next = Math.min(prev + 1, clusters.length - 1);
            clusterRefs.current
              .get(next)
              ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
            return next;
          });
          break;
        }
        case "k":
        case "ArrowUp": {
          e.preventDefault();
          setFocusedIndex((prev) => {
            const next = Math.max(prev - 1, 0);
            clusterRefs.current
              .get(next)
              ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
            return next;
          });
          break;
        }
        case "l":
        case "ArrowRight": {
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < clusters.length) {
            const cluster = clusters[focusedIndex];
            for (const s of cluster.suggestions) {
              mergeSuggestion
                .mutateAsync({
                  suggestionId: s.id,
                  primaryId: cluster.bestPrimaryId,
                })
                .catch(() => {});
            }
            toast.success("Merged");
          }
          break;
        }
        case "h":
        case "ArrowLeft": {
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < clusters.length) {
            const cluster = clusters[focusedIndex];
            for (const s of cluster.suggestions) {
              dismissSuggestion.mutateAsync(s.id).catch(() => {});
            }
            toast("Kept separate", {
              icon: <Shield className="w-4 h-4 text-on-surface-variant" />,
            });
          }
          break;
        }
        case " ": {
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < clusters.length) {
            toggleSelect(clusters[focusedIndex].id);
          }
          break;
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    clusters,
    focusedIndex,
    mergeSuggestion,
    dismissSuggestion,
    toggleSelect,
  ]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-on-surface-variant" />
      </div>
    );
  }

  if (clusters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="p-4 bg-emerald-500/10 rounded-2xl mb-4">
          <CheckCircle2 className="w-10 h-10 text-emerald-500" />
        </div>
        <h3 className="text-lg font-headline font-bold mb-1">All caught up!</h3>
        <p className="text-sm text-on-surface-variant">
          No pending suggestions to review.
        </p>
        <p className="text-xs text-on-surface-variant/60 mt-1">
          Run a Smart Scan to find new duplicates.
        </p>
      </div>
    );
  }

  const hasSelection = selected.size > 0;

  return (
    <div className="space-y-3">
      {/* Toolbar: select all / count / batch actions */}
      <div className="flex items-center gap-3 mb-3 px-1">
        {/* Select all / none toggle */}
        <button
          onClick={
            hasSelection && selected.size === clusters.length
              ? selectNone
              : selectAll
          }
          className="flex items-center gap-2 text-xs font-bold text-on-surface-variant hover:text-primary transition-colors"
        >
          {hasSelection && selected.size === clusters.length ? (
            <CheckSquare className="w-4 h-4 text-primary" />
          ) : (
            <Square className="w-4 h-4" />
          )}
          {hasSelection
            ? `${selected.size} selected`
            : `${clusters.length} pending`}
        </button>

        <div className="flex-1" />

        {/* Batch action buttons — appear when items are selected */}
        <AnimatePresence>
          {hasSelection && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex items-center gap-2"
            >
              <button
                onClick={handleBatchDismiss}
                disabled={isBatchProcessing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-on-surface-variant bg-surface-container-low hover:bg-rose-500/8 hover:text-rose-500 rounded-full transition-all disabled:opacity-50"
              >
                <X className="w-3.5 h-3.5" />
                Keep Separate ({selected.size})
              </button>
              <button
                onClick={handleBatchMerge}
                disabled={isBatchProcessing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-on-primary bg-primary rounded-full transition-all disabled:opacity-50 hover:shadow-md hover:shadow-primary/20"
              >
                {isBatchProcessing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <GitMerge className="w-3.5 h-3.5" />
                )}
                Merge All ({selected.size})
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Cluster rows */}
      {clusters.map((cluster, i) => (
        <motion.div
          key={cluster.id}
          ref={(el: HTMLDivElement | null) => setClusterRef(i, el)}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: Math.min(i * 0.04, 0.3) }}
          className={cn(
            "rounded-2xl transition-shadow",
            focusedIndex === i &&
              "ring-2 ring-inset ring-primary/40 shadow-md shadow-primary/5",
          )}
          onClick={() => setFocusedIndex(i)}
        >
          {cluster.contacts.length === 2 ? (
            <PairRow
              cluster={cluster}
              mergeSuggestion={mergeSuggestion}
              dismissSuggestion={dismissSuggestion}
              isSelected={selected.has(cluster.id)}
              onToggleSelect={() => toggleSelect(cluster.id)}
            />
          ) : (
            <ClusterCard
              cluster={cluster}
              mergeSuggestion={mergeSuggestion}
              dismissSuggestion={dismissSuggestion}
              isSelected={selected.has(cluster.id)}
              onToggleSelect={() => toggleSelect(cluster.id)}
            />
          )}
        </motion.div>
      ))}
    </div>
  );
};

// =============================================================================
// PairRow — Simple 2-contact row (most common case)
// =============================================================================

function PairRow({
  cluster,
  mergeSuggestion,
  dismissSuggestion,
  isSelected,
  onToggleSelect,
}: {
  cluster: SuggestionCluster;
  mergeSuggestion: ReturnType<typeof useMergeSuggestion>;
  dismissSuggestion: ReturnType<typeof useDismissSuggestion>;
  isSelected: boolean;
  onToggleSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [swapped, setSwapped] = useState(false);
  const suggestion = cluster.suggestions[0];

  const primary = swapped
    ? cluster.contacts[1]
    : (cluster.contacts.find((c) => c.id === cluster.bestPrimaryId) ??
      cluster.contacts[0]);
  const duplicate =
    cluster.contacts.find((c) => c.id !== primary.id) ?? cluster.contacts[1];

  const handleMerge = async () => {
    try {
      await mergeSuggestion.mutateAsync({
        suggestionId: suggestion.id,
        primaryId: primary.id,
      });
      toast.success("Merged successfully");
    } catch (err: unknown) {
      toast.error(
        `Merge failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const handleDismiss = async () => {
    try {
      for (const s of cluster.suggestions) {
        await dismissSuggestion.mutateAsync(s.id);
      }
      toast("Kept separate", {
        icon: <Shield className="w-4 h-4 text-on-surface-variant" />,
      });
    } catch (err: unknown) {
      toast.error(
        `Dismiss failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return (
    <div
      className={cn(
        "bg-surface-container-lowest rounded-2xl shadow-sm transition-all ring-2 ring-inset",
        isSelected ? "ring-primary/40" : "ring-transparent",
      )}
    >
      <div
        className="flex items-center gap-3 px-5 py-4 cursor-pointer group"
        onClick={() => setExpanded((e) => !e)}
      >
        {/* Checkbox */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          className="shrink-0 text-on-surface-variant/40 hover:text-primary transition-colors"
        >
          {isSelected ? (
            <CheckSquare className="w-4 h-4 text-primary" />
          ) : (
            <Square className="w-4 h-4" />
          )}
        </button>

        {/* Primary */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <img
            src={primary.avatarUrl || fallbackAvatarUrl(primary.name)}
            alt={primary.name}
            className="w-8 h-8 rounded-full object-cover bg-surface-container-high shrink-0"
          />
          <div className="min-w-0">
            <div className="text-sm font-bold truncate">{primary.name}</div>
            {primary.company && (
              <div className="text-[11px] text-on-surface-variant truncate">
                {primary.company}
              </div>
            )}
          </div>
        </div>

        <span className="text-on-surface-variant/30 shrink-0 text-xs">⇄</span>

        {/* Duplicate */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <img
            src={duplicate.avatarUrl || fallbackAvatarUrl(duplicate.name)}
            alt={duplicate.name}
            className="w-8 h-8 rounded-full object-cover bg-surface-container-high shrink-0"
          />
          <div className="min-w-0">
            <div className="text-sm font-bold truncate">{duplicate.name}</div>
            {duplicate.company && (
              <div className="text-[11px] text-on-surface-variant truncate">
                {duplicate.company}
              </div>
            )}
          </div>
        </div>

        {/* Badge */}
        <div className="shrink-0 hidden sm:block">
          <MatchBadge
            type={suggestion.matchType}
            confidence={suggestion.confidence}
          />
        </div>

        {/* Actions */}
        <div className="shrink-0 flex items-center gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleMerge();
            }}
            disabled={mergeSuggestion.isPending}
            className="px-3 py-1.5 text-xs font-bold text-on-primary bg-primary rounded-full transition-all disabled:opacity-50 hover:shadow-md hover:shadow-primary/20"
          >
            Merge
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDismiss();
            }}
            disabled={dismissSuggestion.isPending}
            className="p-1.5 text-on-surface-variant/50 hover:text-rose-500 hover:bg-rose-500/8 rounded-lg transition-colors"
            title="Not the same person"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="shrink-0 text-on-surface-variant/40">
          {expanded ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 space-y-4">
              {suggestion.reasoning && (
                <div className="flex items-start gap-2.5 bg-primary/5 rounded-xl p-3">
                  <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <p className="text-sm text-on-surface leading-relaxed">
                    {suggestion.reasoning}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 relative">
                <div className="min-w-0">
                  <ContactCard
                    contact={primary}
                    label="Primary (Keeper)"
                    labelColor="text-emerald-600 bg-emerald-500/10"
                    other={duplicate}
                  />
                </div>
                <button
                  onClick={() => setSwapped((s) => !s)}
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 p-2 bg-surface-container-lowest rounded-full shadow-lg hover:shadow-xl hover:scale-110 transition-all hidden lg:flex items-center justify-center"
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
                  />
                </div>
              </div>

              <button
                onClick={() => setSwapped((s) => !s)}
                className="lg:hidden w-full flex items-center justify-center gap-2 py-2 bg-surface-container-low rounded-xl text-xs font-bold text-on-surface-variant hover:text-primary transition-colors"
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                Swap Primary / Duplicate
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// =============================================================================
// ClusterCard — 3+ contact cluster
// =============================================================================

function ClusterCard({
  cluster,
  mergeSuggestion,
  dismissSuggestion,
  isSelected,
  onToggleSelect,
}: {
  cluster: SuggestionCluster;
  mergeSuggestion: ReturnType<typeof useMergeSuggestion>;
  dismissSuggestion: ReturnType<typeof useDismissSuggestion>;
  isSelected: boolean;
  onToggleSelect: () => void;
}) {
  const [selectedPrimaryId, setSelectedPrimaryId] = useState(
    cluster.bestPrimaryId,
  );
  const [showEvidence, setShowEvidence] = useState(false);
  const [isMerging, setIsMerging] = useState(false);

  const primary =
    cluster.contacts.find((c) => c.id === selectedPrimaryId) ??
    cluster.contacts[0];
  const duplicates = cluster.contacts.filter((c) => c.id !== selectedPrimaryId);

  const handleMergeAll = async () => {
    if (isMerging) return;
    setIsMerging(true);
    try {
      for (const s of cluster.suggestions) {
        await mergeSuggestion.mutateAsync({
          suggestionId: s.id,
          primaryId: selectedPrimaryId,
        });
      }
      toast.success(`Merged ${cluster.contacts.length} contacts into one`);
    } catch (err: unknown) {
      toast.error(
        `Merge failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setIsMerging(false);
    }
  };

  const handleDismissAll = async () => {
    try {
      for (const s of cluster.suggestions) {
        await dismissSuggestion.mutateAsync(s.id);
      }
      toast("Kept all separate", {
        icon: <Shield className="w-4 h-4 text-on-surface-variant" />,
      });
    } catch (err: unknown) {
      toast.error(
        `Dismiss failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return (
    <div
      className={cn(
        "bg-surface-container-lowest rounded-2xl shadow-sm p-5 space-y-4 ring-2 ring-inset",
        isSelected ? "ring-primary/40" : "ring-transparent",
      )}
    >
      {/* Cluster header with checkbox */}
      <div className="flex items-start gap-3">
        <button
          onClick={onToggleSelect}
          className="shrink-0 mt-1 text-on-surface-variant/40 hover:text-primary transition-colors"
        >
          {isSelected ? (
            <CheckSquare className="w-4 h-4 text-primary" />
          ) : (
            <Square className="w-4 h-4" />
          )}
        </button>
        <div className="flex-1 bg-surface-container-low rounded-xl p-3 flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-on-surface leading-relaxed">
              These {cluster.contacts.length} contacts may represent the same
              person.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-bold text-on-surface-variant bg-surface-container-high px-2.5 py-1 rounded-full tabular-nums">
              {cluster.contacts.length} contacts
            </span>
            {cluster.hasWeakLink && (
              <span className="text-xs font-bold text-amber-600 bg-amber-500/10 px-2.5 py-1 rounded-full">
                Weak link
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Large cluster warning */}
      {cluster.contacts.length > 5 && (
        <div
          className="flex items-start gap-3 bg-amber-500/8 rounded-xl p-3 ml-7"
          role="alert"
        >
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700 leading-relaxed">
            <span className="font-bold">
              Large cluster ({cluster.contacts.length} contacts).
            </span>{" "}
            Review carefully — merging many contacts is harder to undo.
          </p>
        </div>
      )}

      {/* Primary selection strip */}
      <div
        className="space-y-2 ml-7"
        role="radiogroup"
        aria-label="Select primary contact"
      >
        <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant px-1">
          Select Primary Contact
        </div>
        <div className="flex gap-2 overflow-x-auto p-1 nice-scrollbar">
          {cluster.contacts.map((contact) => {
            const isContactSelected = contact.id === selectedPrimaryId;
            return (
              <button
                key={contact.id}
                onClick={() => setSelectedPrimaryId(contact.id)}
                role="radio"
                aria-checked={isContactSelected}
                className={cn(
                  "shrink-0 flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all min-w-0",
                  isContactSelected
                    ? "bg-emerald-500/10 ring-2 ring-emerald-500/50 shadow-sm"
                    : "bg-surface-container-low hover:bg-surface-container-high",
                )}
              >
                <img
                  src={contact.avatarUrl || fallbackAvatarUrl(contact.name)}
                  alt={contact.name}
                  className="w-9 h-9 rounded-full object-cover bg-surface-container-high shrink-0"
                />
                <div className="min-w-0 text-left">
                  <div className="text-sm font-bold truncate max-w-[140px]">
                    {contact.name}
                  </div>
                  {contact.company && (
                    <div className="text-[11px] text-on-surface-variant truncate max-w-[140px]">
                      {contact.company}
                    </div>
                  )}
                </div>
                {isContactSelected && (
                  <Crown className="w-4 h-4 text-emerald-600 shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Side-by-side comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 ml-7">
        <div className="min-w-0">
          <ContactCard
            contact={primary}
            label="Primary (Keeper)"
            labelColor="text-emerald-600 bg-emerald-500/10"
            isPrimary
          />
        </div>
        <div className="space-y-3 min-w-0">
          {duplicates.map((dup) => (
            <ContactCard
              key={dup.id}
              contact={dup}
              label="Merges In"
              labelColor="text-amber-600 bg-amber-500/10"
              other={primary}
              onSetPrimary={() => setSelectedPrimaryId(dup.id)}
            />
          ))}
        </div>
      </div>

      {/* Evidence toggle */}
      <button
        onClick={() => setShowEvidence((s) => !s)}
        className="w-full flex items-center justify-center gap-2 py-2 bg-surface-container-low hover:bg-surface-container-high rounded-xl text-xs font-bold text-on-surface-variant transition-colors ml-7 max-w-[calc(100%-1.75rem)]"
      >
        <Link2 className="w-3.5 h-3.5" />
        {showEvidence ? "Hide" : "Show"} Evidence ({cluster.suggestions.length}{" "}
        link{cluster.suggestions.length !== 1 ? "s" : ""})
        {showEvidence ? (
          <ChevronUp className="w-3.5 h-3.5" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5" />
        )}
      </button>

      {showEvidence && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          className="space-y-2 overflow-hidden ml-7"
        >
          {cluster.suggestions.map((s, i) => {
            const a = cluster.contacts.find((c) => c.id === s.contactIdA);
            const b = cluster.contacts.find((c) => c.id === s.contactIdB);
            return (
              <div
                key={i}
                className="flex items-center gap-3 bg-surface-container-low rounded-xl px-3 py-2.5 text-sm"
              >
                <span className="font-bold text-on-surface truncate min-w-0 flex-1 text-right">
                  {a?.name ?? "Unknown"}
                </span>
                <MatchBadge type={s.matchType} confidence={s.confidence} />
                <span className="font-bold text-on-surface truncate min-w-0 flex-1">
                  {b?.name ?? "Unknown"}
                </span>
              </div>
            );
          })}
        </motion.div>
      )}

      {/* Action buttons */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 ml-7">
        <button
          onClick={handleDismissAll}
          className="group flex items-center gap-3 px-6 py-3 bg-surface-container-low hover:bg-rose-500/8 rounded-2xl transition-all text-on-surface-variant hover:text-rose-600 w-full sm:w-auto justify-center"
        >
          <X className="w-5 h-5 group-hover:scale-110 transition-transform" />
          <div className="text-left">
            <div className="text-sm font-bold">Keep Separate</div>
          </div>
        </button>
        <button
          onClick={handleMergeAll}
          disabled={isMerging}
          className="group flex items-center gap-3 px-6 py-3 bg-primary text-on-primary rounded-2xl hover:shadow-lg hover:shadow-primary/20 transition-all disabled:opacity-50 w-full sm:w-auto justify-center"
        >
          <div className="text-right">
            <div className="text-sm font-bold">
              {isMerging ? "Merging..." : `Merge ${cluster.contacts.length}`}
            </div>
          </div>
          {isMerging ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <CheckCircle2 className="w-5 h-5" />
          )}
        </button>
      </div>
    </div>
  );
}
