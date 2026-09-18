/**
 * avatarProcessor — Decodes base64 data-URI avatars from VCF imports,
 * resizes them to a reasonable size (256px for 2x retina), converts to
 * JPEG, and saves to the caller's uploads/u/<ownerId>/avatars/. Returns the URL.
 *
 * This prevents 150KB+ raw photos from bloating the SQLite database
 * as enormous base64 strings. A typical processed avatar is ~5-10KB.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { log } from "./logger.ts";
import { getErrorMessage } from "./helpers.ts";
import { ensureDir, ownerUploadDir, ownerUploadUrl } from "./paths.ts";
import { ValidationError } from "./AppError.ts";
import type { Scope } from "../tenancy/scope.ts";

// Raster image types only. SVG is deliberately excluded — it can carry
// scripts and is served from the app origin. The extension is derived from
// the MIME type, never from the client-supplied filename.
export const AVATAR_MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
};

export const RASTER_MIME_ALLOWLIST = Object.keys(AVATAR_MIME_EXTENSIONS);

const AVATAR_SIZE = 256; // px — 2x for 128px CSS display (retina-ready)
const JPEG_QUALITY = 80;

const PROFILE_PHOTO_SIZE = 512;
const PROFILE_PHOTO_QUALITY = 82;

/**
 * Process a base64 data-URI avatar: resize, compress, save to disk.
 * Returns the URL path (e.g. `/uploads/u/<ownerId>/avatars/abc123.jpg`), or null on failure.
 */
export async function processBase64Avatar(
  scope: Scope,
  dataUri: string,
): Promise<string | null> {
  try {
    // Parse the data URI
    const match = dataUri.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) return null;

    const base64Data = match[2];
    const inputBuffer = Buffer.from(base64Data, "base64");

    // The owner comes from the caller's scope, so the file lands in the same
    // directory the stored URL will point at.
    const avatarDir = ownerUploadDir(scope.ownerId, "avatars");
    ensureDir(avatarDir);

    // Generate a unique filename
    const hash = crypto
      .createHash("md5")
      .update(inputBuffer)
      .digest("hex")
      .slice(0, 12);
    const filename = `import-${hash}-${Date.now()}.jpg`;
    const outputPath = path.join(avatarDir, filename);

    // Resize + convert to JPEG
    await sharp(inputBuffer)
      .resize(AVATAR_SIZE, AVATAR_SIZE, {
        fit: "cover",
        position: "centre",
      })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toFile(outputPath);

    const stats = fs.statSync(outputPath);
    log.debug(
      "AvatarProcessor",
      `Processed avatar: ${Math.round(inputBuffer.length / 1024)}KB → ${Math.round(stats.size / 1024)}KB (${filename})`,
    );

    return ownerUploadUrl(scope.ownerId, "avatars", filename);
  } catch (err: unknown) {
    log.warn(
      "AvatarProcessor",
      `Failed to process avatar: ${getErrorMessage(err)}`,
    );
    return null;
  }
}

/**
 * Check if a string is a base64 data URI (not an HTTP URL or dicebear SVG).
 */
export function isBase64DataUri(url: string | null | undefined): url is string {
  return !!url && url.startsWith("data:image/");
}

/**
 * Normalise and save an account profile photo.
 *
 * Resizes to 512px cover, auto-rotates by EXIF orientation, strips metadata,
 * converts to JPEG quality 82, and saves to uploads/u/<userId>/profile/.
 * Returns the public URL path (/uploads/u/<userId>/profile/profile-<timestamp>.jpg).
 *
 * Throws ValidationError if sharp cannot decode the buffer.
 */
export async function processProfilePhoto(
  userId: string,
  buffer: Buffer,
): Promise<string> {
  const profileDir = ownerUploadDir(userId, "profile");
  ensureDir(profileDir);

  const filename = `profile-${Date.now()}.jpg`;
  const outputPath = path.join(profileDir, filename);

  try {
    await sharp(buffer)
      .rotate()
      .resize(PROFILE_PHOTO_SIZE, PROFILE_PHOTO_SIZE, {
        fit: "cover",
        position: "centre",
      })
      .jpeg({ quality: PROFILE_PHOTO_QUALITY, mozjpeg: true })
      .toFile(outputPath);
  } catch (err: unknown) {
    if (fs.existsSync(outputPath)) {
      try {
        fs.unlinkSync(outputPath);
      } catch {}
    }
    throw new ValidationError("Invalid or unsupported image format", {
      cause: err,
    });
  }

  return ownerUploadUrl(userId, "profile", filename);
}
