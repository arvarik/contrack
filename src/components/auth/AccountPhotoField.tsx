/**
 * AccountPhotoField — A round profile photo preview and dropzone.
 *
 * Used in Account settings to choose or change an account photo, and during
 * account creation (wizard, register, join) to stage an optional photo before
 * the first sign-in.
 *
 * @module components/auth/AccountPhotoField
 */
import React, { useCallback, useEffect, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { Camera } from "lucide-react";
import { cn } from "../../lib/utils";

export interface AccountPhotoFieldProps {
  value: File | null;
  currentUrl?: string | null;
  fallbackUrl: string;
  onChange: (file: File | null) => void;
  onRemove?: () => void;
  showRemoveCurrent?: boolean;
  size?: number;
}

const ACCEPTED_TYPES = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "image/avif": [".avif"],
};

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export const AccountPhotoField = ({
  value,
  currentUrl,
  fallbackUrl,
  onChange,
  onRemove,
  showRemoveCurrent = true,
  size = 96,
}: AccountPhotoFieldProps) => {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  // Manage object URL lifecycle so memory does not leak
  useEffect(() => {
    if (!value) {
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(value);
    setObjectUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [value]);

  useEffect(() => {
    setImgFailed(false);
  }, [value, currentUrl]);

  const onDrop = useCallback(
    (accepted: File[], rejections: FileRejection[]) => {
      if (rejections.length > 0) {
        const first = rejections[0].errors[0];
        if (first?.code === "file-too-large") {
          setError("Image must be under 10 MB.");
        } else if (first?.code === "file-invalid-type") {
          setError("Only JPEG, PNG, GIF, WebP, or AVIF images are allowed.");
        } else {
          setError(first?.message || "Invalid image file.");
        }
        return;
      }
      if (accepted.length > 0) {
        setError(null);
        onChange(accepted[0]);
      }
    },
    [onChange],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxSize: MAX_BYTES,
    maxFiles: 1,
    multiple: false,
  });

  const displayUrl = objectUrl
    ? objectUrl
    : currentUrl && !imgFailed
      ? currentUrl
      : fallbackUrl;

  const handleRemove = () => {
    setError(null);
    onChange(null);
    onRemove?.();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4">
        <input
          {...getInputProps({
            "aria-label": "Choose a profile photo",
          })}
        />
        <button
          type="button"
          {...getRootProps({
            role: "button",
            "aria-label": "Choose a profile photo",
            className: cn(
              "relative rounded-full overflow-hidden shrink-0 group cursor-pointer",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              isDragActive && "ring-2 ring-primary",
            ),
            style: { width: size, height: size },
          })}
        >
          <img
            src={displayUrl}
            alt=""
            aria-hidden="true"
            className="w-full h-full object-cover rounded-full bg-surface-container-high"
            onError={() => setImgFailed(true)}
          />
          <div
            className={cn(
              "absolute inset-0 bg-black/25 flex items-center justify-center",
              "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity",
              isDragActive && "opacity-100 bg-primary/20",
            )}
          >
            <Camera className="w-5 h-5 text-white drop-shadow" />
          </div>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={open}
            className="btn-secondary text-sm"
          >
            Choose photo
          </button>
          {(value !== null || (showRemoveCurrent && Boolean(currentUrl))) && (
            <button
              type="button"
              onClick={handleRemove}
              className="btn-secondary text-sm text-error hover:bg-error/10 hover:text-error"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-xs text-error font-medium">
          {error}
        </p>
      )}
    </div>
  );
};
