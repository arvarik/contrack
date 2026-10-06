/**
 * AvatarPickerModal: a new picture for a contact, a cartoon from the grid or
 * a photo of the person's own.
 *
 * The pencil on the contact's avatar opens it (`ProfileHeader`), and focus
 * goes back to the pencil when it closes, by Apply, Cancel, Escape or the
 * close button (`returnFocusRef`).
 */
import { useState, useCallback, type RefObject } from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "motion/react";
import { Upload, Check, RefreshCw } from "lucide-react";
import { Modal } from "./ui/Modal";
import { useUploadAvatar, useSetDicebearAvatar } from "../api";
import { toast } from "sonner";
import { cn, errorText } from "../lib/utils";
import {
  BTN_QUIET,
  DROPZONE_INPUT,
  SWATCH_SELECTED,
  TAB_CONTAINER,
  tabItem,
} from "../lib/styles";
import { Segmented } from "./ui/Segmented";
import { usePreferences } from "../contexts/PreferencesContext";

// Dicebear cartoon presets: chosen seeds across 3 styles

const STYLES = [
  {
    value: "avataaars",
    label: "Cartoon",
    hint: "Choose a cartoon, then Apply",
  },
  {
    value: "lorelei",
    label: "Illustrated",
    hint: "Choose a drawing, then Apply",
  },
  { value: "bottts", label: "Bot", hint: "Choose a bot, then Apply" },
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
 * The app's own avatar route, not `api.dicebear.com`. avatarService applies
 * each style's parameters, so a caller cannot pass one a style does not
 * support. `bg=1` asks for the pastel wash, for this grid only.
 */
function avatarUrl(style: AvatarStyle, seed: string) {
  return `/api/avatar/${style}?seed=${encodeURIComponent(seed)}&bg=1`;
}

/**
 * The same avatar, for the palette on screen. Apart from {@link avatarUrl}
 * because the saved URL must not name a theme: it would pin the avatar to
 * that palette for every viewer.
 */
function previewUrl(url: string, theme?: "light" | "dark") {
  return theme ? `${url}&theme=${theme}` : url;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  contactId: string;
  /**
   * The pencil that opened the picker. Focus goes back to it on close:
   * Safari does not focus a clicked button.
   */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export const AvatarPickerModal = ({
  isOpen,
  onClose,
  contactId,
  returnFocusRef,
}: Props) => {
  // The grid's wash follows the palette on screen. Under `system` the image
  // answers `prefers-color-scheme` itself.
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
    // react-dropzone turns paste-to-upload on by default. Off until it is a
    // decision.
    noPaste: true,
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
            toast.error(`Could not upload the photo: ${errorText(err)}`),
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
            toast.error(`Could not save the avatar: ${errorText(err)}`),
        },
      );
    }
  };

  const canApply =
    (tab === "avatar" && !!selectedUrl) ||
    (tab === "upload" && !!uploadPreview);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Edit avatar"
      returnFocusRef={returnFocusRef}
    >
      <div className="space-y-4 pt-1">
        {/* Tab switcher */}
        <div className={TAB_CONTAINER}>
          {(["avatar", "upload"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                tabItem(tab === t),
                "flex-1 min-h-[44px] sm:pointer-fine:min-h-0",
              )}
            >
              {t === "avatar" ? "Choose an avatar" : "Upload a photo"}
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

              <p className="text-xs text-on-surface-variant text-center">
                {STYLES.find(({ value }) => value === style)?.hint}
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
                    className={DROPZONE_INPUT}
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
                        : "Choose a photo, or drop one here"}
                    </p>
                    <p className="text-xs text-on-surface-variant mt-1">
                      JPEG, PNG, WebP, GIF, AVIF · up to 10 MB
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
