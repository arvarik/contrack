/**
 * Decode a base64 data-URI avatar from a VCF import, resize it to 256 px (2x
 * retina), convert to JPEG and save it under the caller's
 * uploads/u/<ownerId>/avatars/, returning the URL. A 150 KB+ photo becomes a 5
 * to 10 KB file instead of a huge base64 string in the database. Either kind of
 * photo is read only in a format imageFormats.ts accepts.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { log } from "./logger.ts";
import { getErrorMessage } from "./helpers.ts";
import { ensureDir, ownerUploadDir, ownerUploadUrl } from "./paths.ts";
import { ValidationError } from "./AppError.ts";
import { assertReadableImage } from "./imageFormats.ts";
import { writeFileAtomically } from "./remoteImage.ts";
import type { Scope } from "../tenancy/scope.ts";

// Raster image types only. SVG is left out on purpose: it can carry scripts and
// is served from the app origin. The extension comes from the MIME type, never
// from the client's file name.
export const AVATAR_MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
};

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * The type of a contact photo by its first bytes, one of
 * AVATAR_MIME_EXTENSIONS, or null. The upload keeps the file as it came, so
 * this is what stops an SVG or a page sent as image/png, which the app would
 * then serve from its own origin. It reads signatures only: AVIF has no
 * decoder here while sharp's HEIF loader is blocked (imageFormats.ts).
 */
export function avatarTypeOf(head: Buffer): string | null {
  const ascii = (from: number, to: number) => head.toString("latin1", from, to);
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return "image/jpeg";
  }
  if (head.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (head.length >= 12 && ascii(4, 8) === "ftyp") {
    // AVIF names itself as the major brand, or as a compatible brand after
    // the minor version at bytes 12 to 16.
    const end = Math.min(head.readUInt32BE(0), head.length);
    for (let at = 8; at + 4 <= end; at += 4) {
      if (at !== 12 && ["avif", "avis"].includes(ascii(at, at + 4))) {
        return "image/avif";
      }
    }
  }
  return null;
}

/** The first bytes of a file, enough for `avatarTypeOf`. */
export async function readFileHead(file: string, bytes = 64): Promise<Buffer> {
  const handle = await fs.promises.open(file, "r");
  try {
    const head = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(head, 0, bytes, 0);
    return head.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

const AVATAR_SIZE = 256; // px — 2x for 128px CSS display (retina-ready)
const JPEG_QUALITY = 80;

const PROFILE_PHOTO_SIZE = 512;
const PROFILE_PHOTO_QUALITY = 82;

/**
 * Save a base64 data-URI photo from a vCard as a 256 px JPEG under the
 * caller's avatars folder, and return its URL path
 * (`/uploads/u/<ownerId>/avatars/import-<digest>.jpg`).
 *
 * Throws a ValidationError when the photo cannot be read: not a base64 image,
 * a format the server does not read, or bytes that do not decode. Any other
 * error, such as a full disk, is the server's own, and a later try can work.
 */
export async function saveBase64Avatar(
  scope: Scope,
  dataUri: string,
): Promise<string> {
  const match = dataUri.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) throw new ValidationError("Not a base64 image");
  const inputBuffer = Buffer.from(match[2], "base64");

  // Content-addressed filename so re-importing or re-syncing the same photo
  // reuses the file on disk rather than writing a new file every run. Only
  // bytes that passed the check below are written under this name, and the
  // write is atomic, so a file there is the finished copy.
  const hash = crypto
    .createHash("sha256")
    .update(inputBuffer)
    .digest("hex")
    .slice(0, 16);
  const filename = `import-${hash}.jpg`;
  // The owner comes from the caller's scope, so the file lands in the same
  // directory the stored URL will point at.
  const outputPath = path.join(
    ownerUploadDir(scope.ownerId, "avatars"),
    filename,
  );
  if (fs.existsSync(outputPath)) {
    return ownerUploadUrl(scope.ownerId, "avatars", filename);
  }

  // By its bytes: the type the data URI names is the file's claim.
  await assertReadableImage(inputBuffer);
  let jpeg: Buffer;
  try {
    jpeg = await sharp(inputBuffer)
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, {
        fit: "cover",
        position: "center",
      })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
  } catch (err) {
    throw new ValidationError("The image could not be decoded", {
      cause: err,
    });
  }
  // A write cut short leaves no half photo under the name that is reused.
  await writeFileAtomically(outputPath, jpeg);

  log.debug(
    "AvatarProcessor",
    `Processed avatar: ${Math.round(inputBuffer.length / 1024)}KB → ${Math.round(jpeg.length / 1024)}KB (${filename})`,
  );
  return ownerUploadUrl(scope.ownerId, "avatars", filename);
}

/**
 * `saveBase64Avatar` for an import: the URL, or null on any failure, which
 * leaves the contact its drawn avatar. Either way the photo is not saved.
 */
export async function processBase64Avatar(
  scope: Scope,
  dataUri: string,
): Promise<string | null> {
  try {
    return await saveBase64Avatar(scope, dataUri);
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
 * Normalize and save an account profile photo: 512 px cover, rotated by its
 * EXIF orientation, metadata stripped, JPEG quality 82, saved under
 * uploads/u/<userId>/profile/.
 *
 * @returns the URL path (/uploads/u/<userId>/profile/profile-<timestamp>.jpg)
 * @throws ValidationError if sharp cannot decode the buffer
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
    // By its bytes: the part's Content-Type is the client's claim.
    await assertReadableImage(buffer);
    await sharp(buffer)
      .rotate()
      .resize(PROFILE_PHOTO_SIZE, PROFILE_PHOTO_SIZE, {
        fit: "cover",
        position: "center",
      })
      .jpeg({ quality: PROFILE_PHOTO_QUALITY, mozjpeg: true })
      .toFile(outputPath);
  } catch (err: unknown) {
    if (fs.existsSync(outputPath)) {
      try {
        await fs.promises.unlink(outputPath).catch(() => {});
      } catch {}
    }
    throw new ValidationError("Invalid or unsupported image format", {
      cause: err,
    });
  }

  return ownerUploadUrl(userId, "profile", filename);
}
