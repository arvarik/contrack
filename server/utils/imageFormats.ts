// The images the server reads, in one place. Every image that sharp decodes
// passes this check first: a photo inside an imported or synced vCard, an
// account photo, a connector's photo URL, a company logo and a link-preview
// image. One list, so a photo reads the same way wherever it comes from.
//
// sharp picks its decoder from the bytes, whatever a file name, a MIME type or
// a data URI says. So the check reads the header and compares the format sharp
// found, before anything decodes the pixels. Two decoders are blocked for the
// whole process, so they never parse a byte:
//   HEIF  The libheif 1.23.5 in sharp 0.35.5 has high-severity decoder flaws
//         (GHSA-48p4-gj45-w9v6, GHSA-rcqc-842v-m26h, GHSA-hpg4-g2gc-pq42).
//         Unblock it when a sharp release bundles libheif 1.23.7 or later, and
//         AVIF reads again; imageFormats.test.ts fails until it is. A phone's
//         HEIC stays unreadable here even then, because sharp's prebuilt
//         libheif has no HEVC decoder. A browser that reads HEIC, such as
//         Safari, turns one into a JPEG before it sends it
//         (src/lib/heifPhoto.ts).
//   SVG   No image the server keeps is drawn from an SVG, and librsvg is a
//         large parser (GHSA-wq5f-xc86-pv6w). Blocked, an SVG is refused
//         before librsvg reads it.

import sharp, { type Metadata } from "sharp";
import { ValidationError } from "./AppError.ts";

sharp.cache(false);
sharp.concurrency(2);
sharp.block({ operation: ["VipsForeignLoadHeif", "VipsForeignLoadSvg"] });

/**
 * sharp's names for the formats the server decodes. TIFF is one: an older Mac
 * address book can write a contact's photo as TIFF.
 */
const READABLE_FORMATS = new Set(["jpeg", "png", "gif", "webp", "tiff"]);

/**
 * Throw a ValidationError unless `input` is an image the server reads: "Not an
 * image" when sharp has no decoder it may use, a blocked one included, and
 * `Refusing image format "<format>"` for an image in another format. sharp
 * reads the header only, so no pixel of a refused image is decoded.
 *
 * sharp reports AVIF as "heif" with AV1 compression, and AVIF counts. While
 * the HEIF block stands, sharp refuses it before this check. HEIF with any
 * other codec, such as the HEVC in a phone's .heic, does not count.
 */
export async function assertReadableImage(input: Buffer): Promise<void> {
  let meta: Metadata;
  try {
    meta = await sharp(input).metadata();
  } catch (err) {
    throw new ValidationError("Not an image", { cause: err });
  }
  const readable =
    READABLE_FORMATS.has(meta.format ?? "") ||
    (meta.format === "heif" && meta.compression === "av1");
  if (!readable) {
    throw new ValidationError(
      `Refusing image format "${meta.format ?? "unknown"}"`,
    );
  }
}
