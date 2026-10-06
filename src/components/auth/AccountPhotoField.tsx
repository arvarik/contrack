/**
 * A round photo preview and drop zone, in Account settings and in account
 * creation, where it stages an optional photo before the first sign-in.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { Camera } from "lucide-react";
import { cn } from "../../lib/utils";
import { DROPZONE_INPUT } from "../../lib/styles";

interface AccountPhotoFieldProps {
  value: File | null;
  currentUrl?: string | null;
  fallbackUrl: string;
  onChange: (file: File | null) => void;
  onRemove?: () => void;
  showRemoveCurrent?: boolean;
}

const ACCEPTED_TYPES = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "image/avif": [".avif"],
};

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/** The photo's width and height, in CSS pixels. */
const PHOTO_SIZE = 96;

export const AccountPhotoField = ({
  value,
  currentUrl,
  fallbackUrl,
  onChange,
  onRemove,
  showRemoveCurrent = true,
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
          setError("Image must be under 10 MB");
        } else if (first?.code === "file-invalid-type") {
          setError("Only JPEG, PNG, GIF, WebP, or AVIF images are allowed");
        } else {
          setError(first?.message || "Invalid image file");
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
    // Paste-to-upload is on by default since react-dropzone 19.2. Off, as
    // before, until it is a decision rather than a side effect.
    noPaste: true,
  });

  const chooseBtnRef = React.useRef<HTMLButtonElement>(null);

  const displayUrl = objectUrl
    ? objectUrl
    : currentUrl && !imgFailed
      ? currentUrl
      : fallbackUrl;

  const handleRemove = () => {
    setError(null);
    onChange(null);
    onRemove?.();
    setTimeout(() => {
      chooseBtnRef.current?.focus();
    }, 0);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4">
        <input
          {...getInputProps({
            className: DROPZONE_INPUT,
            "aria-label": "Choose a profile photo",
            "aria-describedby": error ? "account-photo-error" : undefined,
          })}
        />
        <button
          type="button"
          {...getRootProps({
            role: "button",
            "aria-label": "Choose a profile photo",
            "aria-describedby": error ? "account-photo-error" : undefined,
            className: cn(
              "relative rounded-full overflow-hidden shrink-0 group cursor-pointer",
              // A file held over the photo, not focus: the base layer draws
              // the focus ring.
              isDragActive && "ring-2 ring-primary",
            ),
            style: { width: PHOTO_SIZE, height: PHOTO_SIZE },
          })}
        >
          <img
            src={displayUrl}
            alt=""
            aria-hidden="true"
            className="w-full h-full object-cover rounded-full bg-surface-container-high"
            onError={() => setImgFailed(true)}
          />
          {/* The camera marks the photo as a button: on hover, on focus, and
              at rest on a touch screen. */}
          <div
            className={cn(
              "absolute inset-0 bg-black/25 flex items-center justify-center",
              "pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-visible:opacity-100 transition-opacity",
              isDragActive && "pointer-fine:opacity-100 bg-primary/20",
            )}
          >
            <Camera className="w-5 h-5 text-white drop-shadow" />
          </div>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          <button
            ref={chooseBtnRef}
            type="button"
            onClick={open}
            className="btn-secondary"
          >
            Choose photo
          </button>
          {(value !== null || (showRemoveCurrent && Boolean(currentUrl))) && (
            <button
              type="button"
              onClick={handleRemove}
              className="btn-secondary text-error"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {error && (
        <p
          id="account-photo-error"
          role="alert"
          className="text-xs text-error font-medium"
        >
          {error}
        </p>
      )}
    </div>
  );
};
