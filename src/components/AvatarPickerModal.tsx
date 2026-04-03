import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'motion/react';
import { Upload, Check, RefreshCw } from 'lucide-react';
import { Modal } from './Modal';
import { useUploadAvatar, useSetDicebearAvatar } from '../api';
import { toast } from 'sonner';
import { cn } from '../lib/utils';

// ---------------------------------------------------------------------------
// Dicebear cartoon presets — a curated set of fun seeds across 3 styles
// ---------------------------------------------------------------------------

const STYLES = [
  { id: 'avataaars', label: 'Cartoon' },
  { id: 'lorelei', label: 'Illustrated' },
  { id: 'bottts', label: 'Bot' },
] as const;

type DicebearStyle = typeof STYLES[number]['id'];

const SEEDS = [
  'Felix', 'Luna', 'Max', 'Zoe', 'Sam', 'Mia', 'Leo', 'Ella',
  'Noah', 'Ava', 'Alex', 'Lily', 'Jack', 'Emma', 'Ethan', 'Sophia',
  'Ryan', 'Chloe', 'Jake', 'Grace', 'Owen', 'Nora', 'Liam', 'Ruby',
];

function dicebearUrl(style: DicebearStyle, seed: string) {
  return `https://api.dicebear.com/7.x/${style}/svg?seed=${encodeURIComponent(seed)}&mouth=default,smile,serious&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;
}

// ---------------------------------------------------------------------------
// AvatarPickerModal
// ---------------------------------------------------------------------------

interface Props {
  isOpen: boolean;
  onClose: () => void;
  contactId: string;
  contactName: string;
  currentAvatarUrl?: string;
}

export const AvatarPickerModal = ({ isOpen, onClose, contactId, contactName, currentAvatarUrl }: Props) => {
  const [tab, setTab] = useState<'avatar' | 'upload'>('avatar');
  const [style, setStyle] = useState<DicebearStyle>('avataaars');
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [uploadPreview, setUploadPreview] = useState<{ file: File; url: string } | null>(null);

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
    accept: { 'image/*': [] },
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024,
  });

  const handleClose = () => {
    setSelectedUrl(null);
    setUploadPreview(prev => { if (prev) URL.revokeObjectURL(prev.url); return null; });
    onClose();
  };

  const handleApply = async () => {
    if (tab === 'upload' && uploadPreview) {
      uploadAvatar.mutate({ contactId, file: uploadPreview.file }, {
        onSuccess: () => { toast.success('Avatar updated'); handleClose(); },
        onError: (err) => toast.error(`Upload failed: ${err.message}`),
      });
    } else if (tab === 'avatar' && selectedUrl) {
      setDicebear.mutate({ contactId, avatarUrl: selectedUrl }, {
        onSuccess: () => { toast.success('Avatar updated'); handleClose(); },
        onError: (err) => toast.error(`Failed: ${err.message}`),
      });
    }
  };

  const canApply = (tab === 'avatar' && !!selectedUrl) || (tab === 'upload' && !!uploadPreview);

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Edit Avatar">
      <div className="space-y-4 pt-1">
        {/* Tab switcher */}
        <div className="flex bg-surface-container rounded-xl p-1 gap-1">
          {(['avatar', 'upload'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "flex-1 py-1.5 rounded-lg text-sm font-bold transition-all capitalize",
                tab === t
                  ? "bg-surface-container-high text-on-surface shadow-sm"
                  : "text-on-surface-variant hover:text-on-surface"
              )}
            >
              {t === 'avatar' ? '🎭 Choose Avatar' : '📷 Upload Image'}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* ── Avatar tab ─────────────────────────────────────────────── */}
          {tab === 'avatar' && (
            <motion.div
              key="avatar-tab"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              className="space-y-3"
            >
              {/* Style selector */}
              <div className="flex gap-2">
                {STYLES.map(s => (
                  <button
                    key={s.id}
                    onClick={() => { setStyle(s.id); setSelectedUrl(null); }}
                    className={cn(
                      "flex-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all",
                      style === s.id
                        ? "bg-primary text-on-primary"
                        : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {/* Avatar grid */}
              <div className="grid grid-cols-6 gap-2 max-h-[280px] overflow-y-auto scrollbar-hide pr-1">
                {SEEDS.map(seed => {
                  const url = dicebearUrl(style, seed);
                  const isSelected = selectedUrl === url;
                  return (
                    <button
                      key={seed}
                      onClick={() => setSelectedUrl(url)}
                      className={cn(
                        "relative aspect-square rounded-2xl overflow-hidden transition-all border-2",
                        isSelected
                          ? "border-primary scale-105 shadow-lg shadow-primary/30"
                          : "border-transparent hover:border-primary/30 hover:scale-105"
                      )}
                      title={seed}
                    >
                      <img
                        src={url}
                        alt={seed}
                        className="w-full h-full object-cover bg-surface-container-low"
                        loading="lazy"
                      />
                      {isSelected && (
                        <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                          <div className="bg-primary rounded-full p-0.5">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Randomize hint */}
              <p className="text-[10px] text-on-surface-variant opacity-60 text-center">
                Select any cartoon above, then click Apply
              </p>
            </motion.div>
          )}

          {/* ── Upload tab ─────────────────────────────────────────────── */}
          {tab === 'upload' && (
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
                    <img src={uploadPreview.url} alt="Preview" className="w-full h-full object-cover" />
                  </div>
                  <p className="text-xs text-on-surface-variant truncate max-w-full px-4 text-center">
                    {uploadPreview.file.name}
                  </p>
                  <button
                    onClick={() => { URL.revokeObjectURL(uploadPreview.url); setUploadPreview(null); }}
                    className="flex items-center gap-1.5 text-xs text-on-surface-variant hover:text-on-surface transition-colors"
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
                    "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 cursor-pointer transition-all",
                    isDragActive
                      ? "border-primary bg-primary/5 scale-[1.02]"
                      : "border-surface-container-high hover:border-primary/40 hover:bg-surface-container-low"
                  )}
                >
                  <input {...getInputProps()} />
                  <div className={cn(
                    "p-4 rounded-2xl transition-colors",
                    isDragActive ? "bg-primary/10 text-primary" : "bg-surface-container text-on-surface-variant"
                  )}>
                    <Upload className="w-7 h-7" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-on-surface">
                      {isDragActive ? 'Drop it here' : 'Drop a photo or click to browse'}
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
          <button
            onClick={handleClose}
            className="flex-1 py-2.5 rounded-xl bg-surface-container font-bold text-sm text-on-surface hover:bg-surface-container-high transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={!canApply || isPending}
            className="flex-1 py-2.5 rounded-xl bg-primary text-on-primary font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {isPending ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </Modal>
  );
};
