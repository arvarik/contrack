import React, { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "motion/react";
import { Upload, Check, RefreshCw } from "lucide-react";
import { Modal } from "./ui/Modal";
import { useUploadAvatar, useSetDicebearAvatar } from "../api";
import { toast } from "sonner";
import { cn } from "../lib/utils";
import {
  BTN_QUIET,
  SWATCH_SELECTED,
  TAB_CONTAINER,
  tabItem,
} from "../lib/styles";
import { Segmented } from "./ui/Segmented";
import { usePreferences } from "../contexts/PreferencesContext";

// ---------------------------------------------------------------------------
// Dicebear cartoon presets — a curated set of fun seeds across 3 styles
// ---------------------------------------------------------------------------

const STYLES = [
  { value: "avataaars", label: "Cartoon" },
  { value: "lorelei", label: "Illustrated" },
  { value: "bottts", label: "Bot" },
] as const;

type AvatarStyle = (typeof STYLES)[number]["value"];

const SEEDS = [
  "Felix",
  "Luna",
  "Max",
  "Zoe",
  "Sam",
  "Mia",
  "Leo",
  "Ella",
  "Noah",
  "Ava",
  "Alex",
  "Lily",
  "Jack",
  "Emma",
  "Ethan",
  "Sophia",
  "Ryan",
  "Chloe",
  "Jake",
  "Grace",
  "Owen",
  "Nora",
  "Liam",
  "Ruby",
];

/**
 * Point at the app's own avatar route rather than `api.dicebear.com`.
 *
 * Every per-style parameter this function used to assemble — friendly mouths,
 * skin tone, the pastel backgrounds — now lives server-side in
 * avatarService, applied per style at render time. That removes the failure
 * mode the old comment warned about (passing a parameter a style does not
 * support produced a broken SVG), because the caller no longer chooses
 * parameters at all.
 *
 * `bg=1` asks for the pastel wash, which suits this picker grid; avatars in
 * the contact list stay transparent.
 */
function avatarUrl(style: AvatarStyle, seed: string) {
  return `/api/avatar/${style}?seed=${encodeURIComponent(seed)}&bg=1`;
}

/**
 * The same avatar, drawn for the palette on screen.
 *
 * Kept separate from {@link avatarUrl} on purpose. The URL this picker SAVES
 * must not name a theme: it is stored on the contact and read back for ever,
 * so a `theme=dark` in it would pin that person's avatar to the dark palette
 * for every viewer on every device. The theme belongs to the preview only.
 */
function previewUrl(url: string, theme?: "light" | "dark") {
  return theme ? `${url}&theme=${theme}` : url;
}

// ---------------------------------------------------------------------------
// AvatarPickerModal
// ---------------------------------------------------------------------------

interface Props {
  isOpen: boolean;
  onClose: () => void;
  contactId: string;
}

export const AvatarPickerModal = ({ isOpen, onClose, contactId }: Props) => {
  // The grid draws its wash for the palette on screen. `undefined` under the
  // default `system` theme, where the image answers `prefers-color-scheme`
  // itself and needs no parameter.
  const { preferences, mode } = usePreferences();
  const pinnedTheme = preferences.theme === "system" ? undefined : mode;
  const [tab, setTab] = useState<"avatar" | "upload">("avatar");
  const [style, setStyle] = useState<AvatarStyle>("avataaars");
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [uploadPreview, setUploadPreview] = useState<{
    file: File;
    url: string;
  } | null>(null);

  const uploadAvatar = useUploadAvatar();
  const setDicebear = useSetDicebearAvatar();

  const isPending = uploadAvatar.isPending || setDicebear.isPending;

  // ── Dropzone ──────────────────────────────────────────────────────────
  const onDrop = useCallback((accepted: File[]) => {
    if (!accepted[0]) return;
    const file = accepted[0];
    const previewUrl = URL.createObjectURL(file);
    setUploadPreview({ file, url: previewUrl });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [] },
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024,
  });

  const handleClose = () => {
    setSelectedUrl(null);
    setUploadPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    onClose();
  };

  const handleApply = async () => {
    if (tab === "upload" && uploadPreview) {
      uploadAvatar.mutate(
        { contactId, file: uploadPreview.file },
        {
          onSuccess: () => {
            toast.success("Avatar updated");
            handleClose();
          },
          onError: (err) =>
            toast.error(
              `Upload failed: ${err instanceof Error ? err.message : String(err)}`,
            ),
        },
      );
    } else if (tab === "avatar" && selectedUrl) {
      setDicebear.mutate(
        { contactId, avatarUrl: selectedUrl },
        {
          onSuccess: () => {
            toast.success("Avatar updated");
            handleClose();
          },
          onError: (err) =>
            toast.error(
              `Failed: ${err instanceof Error ? err.message : String(err)}`,
            ),
        },
      );
    }
  };

  const canApply =
    (tab === "avatar" && !!selectedUrl) ||
    (tab === "upload" && !!uploadPreview);

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Edit avatar">
      <div className="space-y-4 pt-1">
        {/* Tab switcher */}
        <div className={TAB_CONTAINER}>
          {(["avatar", "upload"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                tabItem(tab === t),
                "flex-1 min-h-[44px] sm:min-h-0",
              )}
            >
              {t === "avatar" ? "🎭 Choose avatar" : "📷 Upload image"}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* ── Avatar tab ─────────────────────────────────────────────── */}
          {tab === "avatar" && (
            <motion.div
              key="avatar-tab"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              className="space-y-3"
            >
              {/* Style selector. A radio group, so the chosen style has a
                  raised face and a checked state, not a tint alone. */}
              <Segmented
                label="Avatar style"
                value={style}
                onChange={(next) => {
                  setStyle(next);
                  setSelectedUrl(null);
                }}
                options={STYLES}
                className="sm:w-fit"
              />

              {/* Avatar grid. The padding leaves room for the chosen avatar's
                  ring, which the scrolling box would cut at its edges. */}
              <div className="grid grid-cols-6 gap-2 max-h-[280px] overflow-y-auto scrollbar-hide p-1">
                {SEEDS.map((seed) => {
                  const url = avatarUrl(style, seed);
                  const isSelected = selectedUrl === url;
                  const preview = previewUrl(url, pinnedTheme);
                  return (
                    <button
                      key={seed}
                      type="button"
                      onClick={() => setSelectedUrl(url)}
                      aria-pressed={isSelected}
                      className={cn(
                        "relative aspect-square rounded-2xl overflow-hidden transition-transform",
                        isSelected ? SWATCH_SELECTED : "hover:scale-105",
                      )}
                      title={seed}
                    >
                      <img
                        src={preview}
                        alt={seed}
                        className="w-full h-full object-cover bg-surface-container-low"
                        loading="lazy"
                      />
                      {/* The image is the swatch's fill, so the chosen one
                          takes a ring and a check, never a wash over the
                          face. */}
                      {isSelected && (
                        <span className="absolute bottom-1 right-1 bg-primary rounded-full p-0.5">
                          <Check
                            aria-hidden="true"
                            className="w-3 h-3 text-on-primary"
                          />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Randomize hint */}
              <p className="text-[11px] text-on-surface-variant opacity-60 text-center">
                Select any cartoon above, then click Apply
              </p>
            </motion.div>
          )}

          {/* ── Upload tab ─────────────────────────────────────────────── */}
          {tab === "upload" && (
            <motion.div
              key="upload-tab"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              className="space-y-3"
            >
              {uploadPreview ? (
                /* Preview of chosen file */
                <div className="flex flex-col items-center gap-4">
                  <div className="w-32 h-32 rounded-3xl overflow-hidden ring-2 ring-primary/30 shadow-xl">
                    <img
                      src={uploadPreview.url}
                      alt="Preview"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <p className="text-xs text-on-surface-variant truncate max-w-full px-4 text-center">
                    {uploadPreview.file.name}
                  </p>
                  <button
                    onClick={() => {
                      URL.revokeObjectURL(uploadPreview.url);
                      setUploadPreview(null);
                    }}
                    className={BTN_QUIET}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Choose different image
                  </button>
                </div>
              ) : (
                /* Dropzone */
                <div
                  {...getRootProps()}
                  className={cn(
                    "state-layer flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 cursor-pointer transition-colors",
                    isDragActive
                      ? "border-primary bg-primary/5"
                      : "border-surface-container-high",
                  )}
                >
                  <input
                    {...getInputProps()}
                    aria-label="Choose an image file"
                  />
                  <div
                    className={cn(
                      "p-4 rounded-2xl transition-colors",
                      isDragActive
                        ? "bg-primary/10 text-on-primary-wash"
                        : "bg-surface-container text-on-surface-variant",
                    )}
                  >
                    <Upload className="w-7 h-7" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-on-surface">
                      {isDragActive
                        ? "Drop it here"
                        : "Drop a photo or click to browse"}
                    </p>
                    <p className="text-xs text-on-surface-variant mt-1">
                      JPEG, PNG, WebP, GIF · up to 10 MB
                    </p>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Apply button */}
        <div className="flex gap-3 pt-1">
          <button onClick={handleClose} className="btn-secondary flex-1">
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={!canApply || isPending}
            className="btn-primary flex-1"
          >
            {isPending ? "Applying…" : "Apply"}
          </button>
        </div>
      </div>
    </Modal>
  );
};
