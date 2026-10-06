// Integration: the stored Google photo sweep.
// A contact can still hold a googleusercontent.com URL, and a sync rewrites
// it only for a contact Google sends again. The boot sweep copies each one
// into the owner's uploads, clears a photo Google no longer serves, and
// leaves a temporary failure for the next boot. The network is stubbed at
// safeFetch, as in connectors.photos.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { safeFetchMock } = vi.hoisted(() => ({ safeFetchMock: vi.fn() }));
vi.mock("../../server/utils/urlSafety.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/utils/urlSafety.ts")>()),
  safeFetch: safeFetchMock,
}));

import crypto from "node:crypto";
import fs from "node:fs";
import sharp from "sharp";
import { sqlite } from "../../server/db.ts";
import { localizeStoredGooglePhotos } from "../../server/connectors/photoSweep.ts";
import { resolveUploadPath } from "../../server/utils/paths.ts";

const SAVED = "https://lh3.googleusercontent.com/cm/saved-photo=s100";
const GONE = "https://lh4.googleusercontent.com/cm/expired-photo=s100";
const BUSY = "https://lh5.googleusercontent.com/cm/busy-photo=s100";
const OTHER = "https://photos.example.com/imported.jpg";

let ownerId: string;
let photo: Buffer;

function addContact(name: string, avatarUrl: string | null): string {
  const id = crypto.randomUUID();
  sqlite
    .prepare(
      `INSERT INTO contacts (id, ownerId, name, avatarUrl) VALUES (?, ?, ?, ?)`,
    )
    .run(id, ownerId, name, avatarUrl);
  return id;
}

const avatarOf = (id: string) =>
  (
    sqlite.prepare("SELECT avatarUrl FROM contacts WHERE id = ?").get(id) as {
      avatarUrl: string | null;
    }
  ).avatarUrl;

beforeEach(async () => {
  sqlite.exec("DELETE FROM contacts");
  ownerId = crypto.randomUUID();
  sqlite
    .prepare(
      `INSERT INTO users (id, email, username, passwordHash) VALUES (?, ?, ?, 'hash')`,
    )
    .run(ownerId, `${ownerId}@example.com`, `u-${ownerId.slice(0, 8)}`);
  photo ??= await sharp({
    create: { width: 120, height: 120, channels: 3, background: "#3366aa" },
  })
    .png()
    .toBuffer();
  safeFetchMock.mockReset();
  safeFetchMock.mockImplementation(async (url: string) => {
    const status = url === SAVED ? 200 : url === GONE ? 404 : 503;
    return {
      response: new Response(status === 200 ? new Uint8Array(photo) : "no", {
        status,
      }),
      finalUrl: url,
    };
  });
});

describe("localizeStoredGooglePhotos", () => {
  it("copies a stored Google photo into uploads and points the contact at it", async () => {
    const id = addContact("Saved Photo", SAVED);

    const result = await localizeStoredGooglePhotos();

    expect(result).toMatchObject({ saved: 1 });
    const avatar = avatarOf(id);
    expect(avatar).toMatch(
      new RegExp(`^/uploads/u/${ownerId}/avatars/remote-[0-9a-f]{24}\\.jpg$`),
    );
    const file = resolveUploadPath(avatar!);
    expect(file && fs.existsSync(file)).toBe(true);
  });

  it("clears a photo Google no longer serves, and keeps one that may come back", async () => {
    const gone = addContact("Gone Photo", GONE);
    const busy = addContact("Busy Photo", BUSY);

    const result = await localizeStoredGooglePhotos();

    expect(result).toEqual({ saved: 0, cleared: 1, deferred: 1 });
    expect(avatarOf(gone)).toBeNull();
    expect(avatarOf(busy)).toBe(BUSY);
  });

  it("leaves every avatar that is not a Google photo alone", async () => {
    const other = addContact("Imported", OTHER);
    const local = addContact("Local", "/api/avatar/avataaars/abc.svg");
    const none = addContact("None", null);

    const result = await localizeStoredGooglePhotos();

    expect(result).toEqual({ saved: 0, cleared: 0, deferred: 0 });
    expect(safeFetchMock).not.toHaveBeenCalled();
    expect(avatarOf(other)).toBe(OTHER);
    expect(avatarOf(local)).toBe("/api/avatar/avataaars/abc.svg");
    expect(avatarOf(none)).toBeNull();
  });

  it("keeps an avatar the person changed while the photo downloaded", async () => {
    const id = addContact("Changed Meanwhile", SAVED);
    safeFetchMock.mockImplementation(async (url: string) => {
      sqlite
        .prepare("UPDATE contacts SET avatarUrl = ? WHERE id = ?")
        .run("/api/avatar/lorelei/new.svg", id);
      return { response: new Response(new Uint8Array(photo)), finalUrl: url };
    });

    await localizeStoredGooglePhotos();

    expect(avatarOf(id)).toBe("/api/avatar/lorelei/new.svg");
  });
});
