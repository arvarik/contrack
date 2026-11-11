/**
 * HEIC photos, the format an iPhone takes, become a JPEG in the browser
 * before they reach the server, which reads no HEIF image. Chromium has no
 * HEIC decoder of its own, so each test here loads heic-to, the decoder the
 * app fetches on demand, under the production CSP. An import also says how
 * many photos it could not read.
 *
 * The photo is a synthetic 96 by 64 HEIC, red on its left half and blue on
 * its right, so a saved copy shows it is the same picture.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { foldLine } from "../../shared/vcard";
import { expect, gatedTest, test } from "./fixtures/test";
import { ADMIN, accountMenu, completeSetup } from "./fixtures/accounts";
import type { ContrackInstance } from "./fixtures/instance";

const HEIC = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "images",
  "photo.heic",
);

/** The converter has a 3 MB decoder to fetch and start on a slow runner. */
const CONVERTED = { timeout: 30_000 };

interface SlimContact {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/** The colors at the left and right of a saved photo, as [r, g, b]. */
async function sides(page: import("@playwright/test").Page, url: string) {
  const res = await page.request.get(url);
  expect(res.ok()).toBe(true);
  const image = sharp(await res.body());
  const { width, height } = await image.metadata();
  const { data, info } = await image
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (x: number) => {
    const i = (Math.round(height! / 2) * info.width + x) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
  return {
    left: at(Math.round(width! * 0.15)),
    right: at(Math.round(width! * 0.85)),
  };
}

/** Red on the left and blue on the right, within JPEG's rounding. */
function expectRedThenBlue({
  left,
  right,
}: {
  left: number[];
  right: number[];
}) {
  expect(left[0]).toBeGreaterThan(150);
  expect(left[2]).toBeLessThan(100);
  expect(right[2]).toBeGreaterThan(150);
  expect(right[0]).toBeLessThan(100);
}

async function remove(instance: ContrackInstance, ids: string[]) {
  for (const id of ids) await instance.api("DELETE", `/contacts/${id}`);
}

test("an import turns a HEIC photo into a JPEG, and counts a photo it cannot read", async ({
  page,
  instance,
}) => {
  const heic = readFileSync(HEIC).toString("base64");
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>',
  ).toString("base64");
  // Every line ends in CR CR LF, as an Apple Contacts export can.
  const vcf = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:Hana Heic",
    foldLine(`PHOTO;ENCODING=b;TYPE=HEIC:${heic}`),
    "END:VCARD",
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:Sven Svg",
    foldLine(`PHOTO;ENCODING=b;TYPE=PNG:${svg}`),
    "END:VCARD",
    "",
  ]
    .join("\r\n")
    .replaceAll("\r\n", "\r\r\n");

  await page.goto("/settings/import");
  await page.locator('input[type="file"]').setInputFiles({
    name: "iPhone.vcf",
    mimeType: "text/vcard",
    buffer: Buffer.from(vcf),
  });

  await expect(page.getByText("Import complete")).toBeVisible(CONVERTED);
  await expect(page.getByText("2 contacts imported")).toBeVisible();
  await expect(page.getByText("1 photo could not be read")).toBeVisible();

  const contacts = await instance.api<SlimContact[]>(
    "GET",
    "/contacts?view=slim",
  );
  const hana = contacts.find((c) => c.name === "Hana Heic")!;
  const sven = contacts.find((c) => c.name === "Sven Svg")!;
  try {
    expect(hana.avatarUrl).toMatch(
      /^\/uploads\/u\/.+\/avatars\/import-.+\.jpg$/,
    );
    expectRedThenBlue(await sides(page, hana.avatarUrl!));
    // The server refuses an SVG, so the contact keeps its drawn face.
    expect(sven.avatarUrl).toMatch(/^\/api\/avatar\//);
  } finally {
    await remove(instance, [hana.id, sven.id]);
  }
});

test("the contact photo picker turns a HEIC photo into a JPEG", async ({
  page,
  instance,
}) => {
  const { id } = await instance.api<{ id: string }>("POST", "/contacts", {
    name: "Pico Heic",
  });
  try {
    await page.goto(`/contact/${id}`);
    await page.getByRole("button", { name: "Change avatar" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit avatar" });
    await dialog.getByRole("button", { name: "Upload a photo" }).click();
    await dialog.locator('input[type="file"]').setInputFiles(HEIC);

    // The preview shows the converted file, under its new name.
    await expect(dialog.getByText("photo.jpg")).toBeVisible(CONVERTED);
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("Avatar updated")).toBeVisible();

    const contact = await instance.api<SlimContact>("GET", `/contacts/${id}`);
    expect(contact.avatarUrl).toMatch(/\/avatars\/avatar-.+\.jpg$/);
    expectRedThenBlue(await sides(page, contact.avatarUrl!));
  } finally {
    await remove(instance, [id]);
  }
});

gatedTest(
  "the account photo picker turns a HEIC photo into a JPEG",
  async ({ page }) => {
    await completeSetup(page, ADMIN);
    await page.goto("/settings/account");
    await expect(page.getByRole("heading", { name: "Photo" })).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles(HEIC);
    const upload = page.getByRole("button", { name: "Upload" });
    await expect(upload).toBeEnabled(CONVERTED);
    await upload.click();
    await expect(page.getByText("Photo updated")).toBeVisible();

    const avatar = accountMenu(page, ADMIN).locator("img");
    await expect(avatar).toHaveAttribute("src", /\/profile\//);
    expectRedThenBlue(await sides(page, (await avatar.getAttribute("src"))!));
  },
);
