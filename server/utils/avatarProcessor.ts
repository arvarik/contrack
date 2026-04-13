/**
 * avatarProcessor — Decodes base64 data-URI avatars from VCF imports,
 * resizes them to a reasonable size (256px for 2x retina), converts to
 * JPEG, and saves to /uploads/avatars/. Returns the file URL path.
 *
 * This prevents 150KB+ raw photos from bloating the SQLite database
 * as enormous base64 strings. A typical processed avatar is ~5-10KB.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { log } from './logger.ts';
import { getErrorMessage } from "./helpers.ts";

const AVATAR_DIR = path.join(process.cwd(), 'uploads', 'avatars');
const AVATAR_SIZE = 256; // px — 2x for 128px CSS display (retina-ready)
const JPEG_QUALITY = 80;

/**
 * Process a base64 data-URI avatar: resize, compress, save to disk.
 * Returns the URL path (e.g., `/uploads/avatars/abc123.jpg`) or null on failure.
 */
export async function processBase64Avatar(dataUri: string): Promise<string | null> {
  try {
    // Parse the data URI
    const match = dataUri.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) return null;

    const base64Data = match[2];
    const inputBuffer = Buffer.from(base64Data, 'base64');

    // Ensure the avatars directory exists
    if (!fs.existsSync(AVATAR_DIR)) {
      fs.mkdirSync(AVATAR_DIR, { recursive: true });
    }

    // Generate a unique filename
    const hash = crypto.createHash('md5').update(inputBuffer).digest('hex').slice(0, 12);
    const filename = `import-${hash}-${Date.now()}.jpg`;
    const outputPath = path.join(AVATAR_DIR, filename);

    // Resize + convert to JPEG
    await sharp(inputBuffer)
      .resize(AVATAR_SIZE, AVATAR_SIZE, {
        fit: 'cover',
        position: 'centre',
      })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toFile(outputPath);

    const stats = fs.statSync(outputPath);
    log.debug('AvatarProcessor', `Processed avatar: ${Math.round(inputBuffer.length / 1024)}KB → ${Math.round(stats.size / 1024)}KB (${filename})`);

    return `/uploads/avatars/${filename}`;
  } catch (err: unknown) {
    log.warn('AvatarProcessor', `Failed to process avatar: ${getErrorMessage(err)}`);
    return null;
  }
}

/**
 * Check if a string is a base64 data URI (not an HTTP URL or dicebear SVG).
 */
export function isBase64DataUri(url: string | null | undefined): boolean {
  return !!url && url.startsWith('data:image/');
}
