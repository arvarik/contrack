// =============================================================================
// Connector contact photos — copied to the owner's uploads, never linked
// =============================================================================
// Google's People API gives each contact a photo URL on googleusercontent.com.
// A contact that stored that URL made the browser ask Google for the image on
// every view. ingestStream now copies the photo into
// uploads/u/<owner>/avatars/remote-<digest>.jpg before the event joins a batch,
// and the contact stores that local path.
//
// Real database, real ingest engine, real sharp. The network is stubbed at
// safeFetch, the one door every server-side image download goes through.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { safeFetchMock } = vi.hoisted(() => ({ safeFetchMock: vi.fn() }));
vi.mock("../../server/utils/urlSafety.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/utils/urlSafety.ts")>()),
  safeFetch: safeFetchMock,
}));

import crypto from "node:crypto";
import fs from "node:fs";
import sharp from "sharp";
import { sqlite } from "../../server/db.ts";
import { ingestStream } from "../../server/connectors/ingest.ts";
import { buildContactMatcher } from "../../server/connectors/matching.ts";
import type { SyncEvent } from "../../server/connectors/types.ts";
import { scopeForOwnerId, type Scope } from "../../server/tenancy/scope.ts";
import { resolveUploadPath } from "../../server/utils/paths.ts";

const PHOTO_URL =
  "https://lh3.googleusercontent.com/cm/AOhXYZ-private-token=s100";

let ownerId: string;
let connectorId: string;
let scope: Scope;
let photo: Buffer;

function served(body: Buffer | string, status = 200) {
  const bytes = typeof body === "string" ? body : new Uint8Array(body);
  return {
    response: new Response(bytes, {
      status,
      headers: { "content-type": "image/jpeg" },
    }),
    finalUrl: PHOTO_URL,
  };
}

function contactEvent(
  externalId: string,
  name: string,
  photoUrl?: string,
): SyncEvent {
  const slug = name.toLowerCase().replace(/\s+/g, ".");
  return {
    kind: "contact",
    externalId,
    contact: {
      name,
      emails: [
        { email: `${slug}@builder.example`, type: "work", isPrimary: true },
      ],
      phones: [],
    },
    photoUrl,
  };
}

async function sync(events: SyncEvent[], signal?: AbortSignal) {
  async function* stream() {
    yield* events;
  }
  return ingestStream(
    scope,
    { id: connectorId, ownerId, kind: "google", config: {} },
    stream(),
    buildContactMatcher(scope),
    { emails: ["me@example.com"], phones: [] },
    { signal },
  );
}

/** The avatar of the contact a Google person was linked to. */
function avatarOf(externalId: string): string | null | undefined {
  const row = sqlite
    .prepare(
      `SELECT c.avatarUrl FROM connector_links l
         JOIN contacts c ON c.id = l.localId
        WHERE l.connectorId = ? AND l.kind = 'contact' AND l.externalId = ?`,
    )
    .get(connectorId, externalId) as { avatarUrl: string | null } | undefined;
  return row?.avatarUrl;
}

beforeEach(async () => {
  ownerId = crypto.randomUUID();
  connectorId = crypto.randomUUID();
  scope = scopeForOwnerId(ownerId);
  sqlite
    .prepare(
      `INSERT INTO users (id, email, username, passwordHash) VALUES (?, ?, ?, 'hash')`,
    )
    .run(ownerId, `${ownerId}@example.com`, `u-${ownerId.slice(0, 8)}`);
  sqlite
    .prepare(
      `INSERT INTO connectors (id, ownerId, kind, name, status, config, createdAt, updatedAt)
       VALUES (?, ?, 'google', 'Google', 'active', '{}', datetime('now'), datetime('now'))`,
    )
    .run(connectorId, ownerId);
  photo ??= await sharp({
    create: {
      width: 400,
      height: 300,
      channels: 3,
      background: { r: 30, g: 90, b: 160 },
    },
  })
    .jpeg()
    .toBuffer();
  safeFetchMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Google contact photos", () => {
  it("stores a local 256 px avatar, and the file exists", async () => {
    safeFetchMock.mockImplementation(async () => served(photo));

    await sync([contactEvent("people/c1", "Bob Builder", PHOTO_URL)]);

    const avatar = avatarOf("people/c1");
    expect(avatar).toMatch(
      new RegExp(`^/uploads/u/${ownerId}/avatars/remote-[0-9a-f]{24}\\.jpg$`),
    );
    const onDisk = resolveUploadPath(avatar!);
    expect(onDisk && fs.existsSync(onDisk)).toBe(true);
    const meta = await sharp(onDisk!).metadata();
    expect(meta.format).toBe("jpeg");
    expect([meta.width, meta.height]).toEqual([256, 256]);

    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    expect(safeFetchMock.mock.calls[0][0]).toBe(PHOTO_URL);
  });

  it("reuses the file on the next sync with no image fetch", async () => {
    safeFetchMock.mockImplementation(async () => served(photo));
    await sync([contactEvent("people/c2", "Wendy Builder", PHOTO_URL)]);
    const first = avatarOf("people/c2");

    safeFetchMock.mockClear();
    const result = await sync([
      contactEvent("people/c2", "Wendy Builder", PHOTO_URL),
    ]);

    expect(result.stats.contacts).toBe(1);
    expect(safeFetchMock).not.toHaveBeenCalled();
    expect(avatarOf("people/c2")).toBe(first);
  });

  it("stores no remote URL when the download fails", async () => {
    safeFetchMock.mockImplementation(async () => served("gone", 404));

    await sync([contactEvent("people/c3", "Spud Builder", PHOTO_URL)]);

    const avatar = avatarOf("people/c3");
    expect(avatar ?? "").not.toMatch(/^https?:/);
    expect(avatar ?? "").not.toContain("googleusercontent");
  });

  it("stores no remote URL when the network is down", async () => {
    safeFetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const result = await sync([
      contactEvent("people/c4", "Dizzy Builder", PHOTO_URL),
    ]);

    expect(result.stats.contacts).toBe(1);
    expect(avatarOf("people/c4") ?? "").not.toContain("googleusercontent");
  });

  it("replaces a remote URL an older sync stored, on the next sync", async () => {
    // What a contact synced before this change looks like.
    safeFetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await sync([contactEvent("people/c5", "Roley Builder")]);
    sqlite
      .prepare(
        `UPDATE contacts SET avatarUrl = ?
          WHERE id = (SELECT localId FROM connector_links
                       WHERE connectorId = ? AND externalId = ?)`,
      )
      .run(PHOTO_URL, connectorId, "people/c5");
    expect(avatarOf("people/c5")).toBe(PHOTO_URL);

    safeFetchMock.mockReset();
    safeFetchMock.mockImplementation(async () => served(photo));
    await sync([contactEvent("people/c5", "Roley Builder", PHOTO_URL)]);

    expect(avatarOf("people/c5")).toMatch(
      /^\/uploads\/u\/.+\/avatars\/remote-/,
    );
  });

  it("downloads several photos at once and still stores every contact", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    safeFetchMock.mockImplementation(async () => {
      await gate;
      return served(photo);
    });

    const names = ["Lofty Builder", "Scoop Builder", "Pilchard Builder"];
    const running = sync(
      names.map((name, i) =>
        contactEvent(`people/p${i}`, name, `${PHOTO_URL}&n=${i}`),
      ),
    );
    // All three downloads start before any of them finishes.
    await vi.waitFor(() => expect(safeFetchMock).toHaveBeenCalledTimes(3));
    release();
    const result = await running;

    expect(result.stats.contacts).toBe(3);
    const avatars = names.map((_, i) => avatarOf(`people/p${i}`));
    for (const avatar of avatars) {
      expect(avatar).toMatch(/^\/uploads\/u\/.+\/avatars\/remote-/);
    }
    // One file per photo URL.
    expect(new Set(avatars).size).toBe(3);
  });

  it("never runs more than six photo downloads at once", async () => {
    let inFlight = 0;
    let peak = 0;
    safeFetchMock.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight--;
      return served(photo);
    });

    const events = Array.from({ length: 14 }, (_, i) =>
      contactEvent(`people/q${i}`, `Crew Member ${i}`, `${PHOTO_URL}&q=${i}`),
    );
    const result = await sync(events);

    expect(result.stats.contacts).toBe(14);
    expect(safeFetchMock).toHaveBeenCalledTimes(14);
    expect(peak).toBe(6);
  });

  it("stops the sync when it is aborted during a photo download", async () => {
    const controller = new AbortController();
    safeFetchMock.mockImplementation(async () => {
      controller.abort(new Error("sync cancelled"));
      throw new DOMException("aborted", "AbortError");
    });

    await expect(
      sync(
        [contactEvent("people/c6", "Muck Builder", PHOTO_URL)],
        controller.signal,
      ),
    ).rejects.toThrow("sync cancelled");
    expect(avatarOf("people/c6")).toBeUndefined();
  });
});
