// Unit: a photo inside an imported or synced vCard becomes a 256 px JPEG in
// the owner's uploads. Two ways a photo went wrong: a file whose lines end in
// CR CR LF cut every folded photo after its first line, so sharp failed and
// the contact got a drawn avatar; and sharp decoded whatever the bytes were,
// an SVG included. A photo is read by its bytes, in the formats
// server/utils/imageFormats.ts lists, whatever type its data URI names.

import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { extractVCardContacts, foldLine } from "../../../../shared/vcard.ts";
import {
  avatarTypeOf,
  processBase64Avatar,
} from "../../../../server/utils/avatarProcessor.ts";
import { scopeForOwnerId } from "../../../../server/tenancy/scope.ts";
import { resolveUploadPath } from "../../../../server/utils/paths.ts";

const scope = scopeForOwnerId("44444444-4444-4444-8444-444444444444");

type Format = "jpeg" | "png" | "gif" | "webp" | "tiff" | "avif";

/** A small real image. Each call draws another color, so no file is reused. */
let shade = 0;
function makeImage(format: Format): Promise<Buffer> {
  shade += 1;
  return sharp({
    create: {
      width: 48,
      height: 48,
      channels: 3,
      background: { r: shade, g: 120, b: 200 },
    },
  })
    .toFormat(format)
    .toBuffer();
}

/** The avatar file a returned URL names, as sharp reads it back. */
async function saved(url: string | null) {
  expect(url).toMatch(
    /^\/uploads\/u\/[^/]+\/avatars\/import-[0-9a-f]{16}\.jpg$/,
  );
  return sharp(resolveUploadPath(url!)!).metadata();
}

describe("processBase64Avatar", () => {
  it.each([
    ["CR CR LF, as an Apple Contacts export can", "\r\r\n"],
    ["CR LF", "\r\n"],
    ["LF", "\n"],
  ])(
    "saves the folded photo of a vCard whose lines end in %s",
    async (_label, end) => {
      const photo = (await makeImage("jpeg")).toString("base64");
      const vcf = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        "FN:Ada",
        foldLine(`PHOTO;ENCODING=b;TYPE=JPEG:${photo}`),
        "END:VCARD",
        "",
      ]
        .join("\r\n")
        .replaceAll("\r\n", end);
      const [contact] = extractVCardContacts(vcf).contacts;

      const url = await processBase64Avatar(scope, contact!.avatarUrl!);
      expect(await saved(url)).toMatchObject({
        format: "jpeg",
        width: 256,
        height: 256,
      });
    },
  );

  // A 3.0 photo with no TYPE reads as JPEG, and an older Mac address book can
  // write a TIFF photo that way.
  it.each(["jpeg", "png", "gif", "webp", "tiff"] as const)(
    "saves a %s photo whatever type its data URI names",
    async (format) => {
      const image = await makeImage(format);
      const url = await processBase64Avatar(
        scope,
        `data:image/jpeg;base64,${image.toString("base64")}`,
      );
      expect(await saved(url)).toMatchObject({ format: "jpeg", width: 256 });
    },
  );

  it.each<[string, () => Promise<Buffer>]>([
    [
      "an SVG, which the server never draws",
      async () =>
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>',
        ),
    ],
    ["an AVIF, while the HEIF loader is blocked", () => makeImage("avif")],
    ["text", async () => Buffer.from("not an image at all")],
  ])("saves nothing for %s", async (_label, bytes) => {
    const dataUri = `data:image/png;base64,${(await bytes()).toString("base64")}`;
    expect(await processBase64Avatar(scope, dataUri)).toBeNull();
  });
});

describe("avatarTypeOf", () => {
  /** The first bytes of an ISO BMFF file with these brands. */
  const ftyp = (major: string, ...compatible: string[]) => {
    const size = 16 + 4 * compatible.length;
    const head = Buffer.alloc(size);
    head.writeUInt32BE(size, 0);
    head.write(`ftyp${major}`, 4, "latin1");
    head.write(compatible.join(""), 16, "latin1");
    return head;
  };

  it.each<[string, Promise<Buffer> | Buffer, string | null]>([
    ["a JPEG", makeImage("jpeg"), "image/jpeg"],
    ["a PNG", makeImage("png"), "image/png"],
    ["a GIF", makeImage("gif"), "image/gif"],
    ["a WebP", makeImage("webp"), "image/webp"],
    ["an AVIF", makeImage("avif"), "image/avif"],
    [
      "an AVIF that names itself only as compatible",
      ftyp("mif1", "miaf", "avif"),
      "image/avif",
    ],
    ["a TIFF, which a browser does not draw", makeImage("tiff"), null],
    ["an iPhone HEIC", ftyp("heic", "mif1", "heic"), null],
    ["an SVG", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), null],
    ["an HTML page", Buffer.from("<!doctype html><script>x</script>"), null],
    ["an empty file", Buffer.alloc(0), null],
  ])("reads %s", async (_label, bytes, type) => {
    expect(avatarTypeOf((await bytes).subarray(0, 64))).toBe(type);
  });
});
