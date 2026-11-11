/**
 * HEIF photos become a JPEG in the browser before they reach the server,
 * which reads no HEIF image. The browser's own decoder does it: every current
 * browser reads AVIF, and Safari reads HEIC. Chromium has no HEIC decoder, so
 * here a HEIC photo is refused with a word on what to do, and one inside an
 * import is counted on its summary.
 *
 * Each photo is a 96 by 64 picture, red on its left half and blue on its
 * right, so a saved copy shows it is the same picture. The HEIC is a
 * synthetic one of the same colors.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { foldLine } from "../../shared/vcard";
import { expect, gatedTest, test } from "./fixtures/test";
import { ADMIN, accountMenu, completeSetup } from "./fixtures/accounts";
import type { ContrackInstance } from "./fixtures/instance";

const HEIC = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "fixtures",
    "images",
    "photo.heic",
  ),
);

interface SlimContact {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/** A 96 by 64 picture, red on the left and blue on the right. */
function redThenBlue(format: "avif" | "jpeg"): Promise<Buffer> {
  return sharp({
    create: { width: 96, height: 64, channels: 3, background: "#ff0000" },
  })
    .composite([
      {
        input: {
          create: { width: 48, height: 64, channels: 3, background: "#0000ff" },
        },
        left: 48,
        top: 0,
      },
    ])
    .toFormat(format)
    .toBuffer();
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

test("an import turns an AVIF photo into a JPEG, and counts the photos it cannot read", async ({
  page,
  instance,
}) => {
  const avif = (await redThenBlue("avif")).toString("base64");
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>',
  ).toString("base64");
  // Every line ends in CR CR LF, as an Apple Contacts export can.
  const vcf = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:Ava Avif",
    foldLine(`PHOTO;ENCODING=b;TYPE=AVIF:${avif}`),
    "END:VCARD",
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:Hana Heic",
    foldLine(`PHOTO;ENCODING=b;TYPE=HEIC:${HEIC.toString("base64")}`),
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

  await expect(page.getByText("Import complete")).toBeVisible();
  await expect(page.getByText("3 contacts imported")).toBeVisible();
  // Chromium cannot read the HEIC, and the server refuses the SVG.
  await expect(page.getByText("2 photos could not be read")).toBeVisible();

  const contacts = await instance.api<SlimContact[]>(
    "GET",
    "/contacts?view=slim",
  );
  const named = (name: string) => contacts.find((c) => c.name === name)!;
  const ava = named("Ava Avif");
  try {
    expect(ava.avatarUrl).toMatch(
      /^\/uploads\/u\/.+\/avatars\/import-.+\.jpg$/,
    );
    expectRedThenBlue(await sides(page, ava.avatarUrl!));
    for (const name of ["Hana Heic", "Sven Svg"]) {
      expect(named(name).avatarUrl).toMatch(/^\/api\/avatar\//);
    }
  } finally {
    await remove(
      instance,
      ["Ava Avif", "Hana Heic", "Sven Svg"].map((name) => named(name).id),
    );
  }
});

test("the contact photo picker turns an AVIF photo into a JPEG", async ({
  page,
  instance,
}) => {
  const { id } = await instance.api<{ id: string }>("POST", "/contacts", {
    name: "Pico Avif",
  });
  try {
    await page.goto(`/contact/${id}`);
    await page.getByRole("button", { name: "Change avatar" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit avatar" });
    await dialog.getByRole("button", { name: "Upload a photo" }).click();
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "photo.avif",
      mimeType: "image/avif",
      buffer: await redThenBlue("avif"),
    });

    // The preview shows the converted file, under its new name.
    await expect(dialog.getByText("photo.jpg")).toBeVisible();
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("Avatar updated")).toBeVisible();

    const contact = await instance.api<SlimContact>("GET", `/contacts/${id}`);
    expect(contact.avatarUrl).toMatch(/\/avatars\/avatar-.+\.jpg$/);
    expectRedThenBlue(await sides(page, contact.avatarUrl!));
  } finally {
    await remove(instance, [id]);
  }
});

test("the contact photo picker takes a JPEG as it is, and says why it refuses a file", async ({
  page,
  instance,
}) => {
  const { id } = await instance.api<{ id: string }>("POST", "/contacts", {
    name: "Jo Jpeg",
  });
  try {
    await page.goto(`/contact/${id}`);
    await page.getByRole("button", { name: "Change avatar" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit avatar" });
    await dialog.getByRole("button", { name: "Upload a photo" }).click();
    const input = dialog.locator('input[type="file"]');

    await input.setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not a photo"),
    });
    await expect(
      page.getByText("Could not use the file: choose a photo"),
    ).toBeVisible();

    // A HEIC with no type, as a system that does not know it gives one.
    await input.setInputFiles({
      name: "IMG_0001.HEIC",
      mimeType: "",
      buffer: HEIC,
    });
    await expect(
      page.getByText(
        "Could not read the photo: this browser could not read it. Choose a JPEG, or use Safari, which reads HEIC",
      ),
    ).toBeVisible();

    await input.setInputFiles({
      name: "portrait.jpg",
      mimeType: "image/jpeg",
      buffer: await redThenBlue("jpeg"),
    });
    await expect(dialog.getByText("portrait.jpg")).toBeVisible();
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
  "the account photo picker turns an AVIF photo into a JPEG",
  async ({ page }) => {
    await completeSetup(page, ADMIN);
    await page.goto("/settings/account");
    await expect(page.getByRole("heading", { name: "Photo" })).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles({
      name: "me.avif",
      mimeType: "image/avif",
      buffer: await redThenBlue("avif"),
    });
    const upload = page.getByRole("button", { name: "Upload" });
    await expect(upload).toBeEnabled();
    await upload.click();
    await expect(page.getByText("Photo updated")).toBeVisible();

    const avatar = accountMenu(page, ADMIN).locator("img");
    await expect(avatar).toHaveAttribute("src", /\/profile\//);
    expectRedThenBlue(await sides(page, (await avatar.getAttribute("src"))!));
  },
);
