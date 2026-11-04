/**
 * Unit: the connector ingestion engine, for what the lab cannot reach:
 * Google's contacts, older rows, batching and caps. Mail and meetings are
 * proven against real servers in tests/lab/.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("../../../../server/db.ts");

import crypto from "node:crypto";
import { sqlite } from "../../../../server/db.ts";
import { buildContactMatcher } from "../../../../server/connectors/matching.ts";
import {
  fillFromRemote,
  ingestStream,
} from "../../../../server/connectors/ingest.ts";
import { mergeContacts } from "../../../../server/services/dedupe/merging.ts";
import { defaultAvatarUrl } from "../../../../server/utils/avatarUrl.ts";
import { urlDigest } from "../../../../server/utils/remoteImage.ts";
import type { HydratedContact } from "../../../../server/repositories/types.ts";
import { listCorrespondents } from "../../../../server/connectors/service.ts";
import type { SyncEvent } from "../../../../server/connectors/types.ts";
import type { ConnectorKind } from "../../../../shared/connectors.ts";
import { scopeForOwnerId } from "../../../../server/tenancy/scope.ts";

describe("connectors ingestStream", () => {
  const ownerId = "test-ingest-user-" + crypto.randomUUID().slice(0, 8);
  const connectorId = "conn-" + crypto.randomUUID().slice(0, 8);
  const scope = scopeForOwnerId(ownerId);
  /** Known Alice, alice@example.com. */
  let contactId: string;

  const column = (sql: string, ...params: unknown[]) =>
    sqlite
      .prepare(sql)
      .pluck()
      .all(...params);

  /** A contact of the owner's, made outside any sync. */
  function addContact(name: string, extra = "", ...values: unknown[]) {
    const id = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO contacts (id, ownerId, name, addedAt, updatedAt${extra ? `, ${extra}` : ""})
         VALUES (?, ?, ?, datetime('now'), datetime('now')${", ?".repeat(values.length)})`,
      )
      .run(id, ownerId, name, ...values);
    return id;
  }

  const addEmail = (id: string, email: string, isPrimary = 1) =>
    sqlite
      .prepare(
        "INSERT INTO contact_emails (id, contactId, email, isPrimary) VALUES (?, ?, ?, ?)",
      )
      .run(crypto.randomUUID(), id, email, isPrimary);

  beforeEach(() => {
    sqlite
      .prepare(
        `INSERT OR IGNORE INTO users (id, email, username, passwordHash)
         VALUES (?, ?, ?, 'hash')`,
      )
      .run(ownerId, `${ownerId}@example.com`, ownerId);
    sqlite
      .prepare(
        `INSERT INTO connectors (id, ownerId, kind, name, status, config, createdAt, updatedAt)
         VALUES (?, ?, 'google', 'Test Google', 'active', '{}', datetime('now'), datetime('now'))`,
      )
      .run(connectorId, ownerId);
    contactId = addContact("Known Alice");
    addEmail(contactId, "alice@example.com");
  });

  afterEach(() => {
    for (const table of [
      "upcoming_events",
      "connector_links",
      "interactions",
      "contacts",
      "connectors",
      // What the writes recorded and queued. Both name the owner, and both
      // keys restrict the delete of the account.
      "events",
      "dedupe_merge_log",
      "jobs",
    ]) {
      sqlite.prepare(`DELETE FROM ${table} WHERE ownerId = ?`).run(ownerId);
    }
    sqlite.prepare("DELETE FROM users WHERE id = ?").run(ownerId);
  });

  /** Runs `events` through ingest for the test connector, as a `kind` sync. */
  function ingest(
    events: SyncEvent[],
    options: {
      kind?: ConnectorKind;
      config?: Record<string, unknown>;
      ghostThreshold?: number;
    } = {},
  ) {
    const { kind = "google", config = {}, ghostThreshold } = options;
    return ingestStream(
      scope,
      { id: connectorId, ownerId, kind, config },
      (async function* () {
        yield* events;
      })(),
      buildContactMatcher(scope),
      { emails: ["me@example.com"], phones: [] },
      ghostThreshold ? { ghostThreshold } : {},
    );
  }

  const card = (
    externalId: string,
    name: string,
    email: string,
    extra: Record<string, unknown> = {},
  ): SyncEvent => ({
    kind: "contact",
    externalId,
    contact: {
      name,
      emails: [{ email, type: "work", isPrimary: true }],
      phones: [],
      ...extra,
    },
  });

  const mail = (
    externalId: string,
    participants: Array<{ email: string; name?: string }>,
    extra: Record<string, unknown> = {},
  ): SyncEvent => ({
    kind: "interaction",
    externalId,
    type: "email",
    title: externalId,
    date: "2026-02-01T10:00:00.000Z",
    direction: "in",
    participants,
    ...extra,
  });

  /** The contact a synced card is linked to. */
  const linked = (externalId: string) =>
    column(
      "SELECT localId FROM connector_links WHERE connectorId = ? AND kind = 'contact' AND externalId = ?",
      connectorId,
      externalId,
    )[0] as string;

  it("lists the rows an older version kept as one person each, without robots, the owner or known contacts", () => {
    const row = sqlite.prepare(
      `INSERT INTO connector_links (connectorId, ownerId, kind, externalId, localId, seenCount, lastSeenAt, displayName)
       VALUES (?, ?, 'correspondent', ?, NULL, 1, '2026-02-02T10:00:00Z', ?)`,
    );
    for (const [email, name] of [
      ["ana.lee@gmail.com", "Ana Lee"],
      ["analee+news@gmail.com", null],
      ["quiet.river-4a@icloud.com", "Hide My Email"],
      [`${ownerId}+fedex@example.com`, null],
      ["ALICE+promo@example.com", null],
    ]) {
      row.run(connectorId, ownerId, email, name);
    }
    expect(listCorrespondents(scope).map((c) => [c.name, c.seenCount])).toEqual(
      [["Ana Lee", 2]],
    );
  });

  it("replaces a Google connector's upcoming rows only once the run listed its window", async () => {
    const upcoming = (externalId: string): SyncEvent => ({
      kind: "upcoming",
      externalId,
      title: externalId,
      startsAt: "2099-03-01T10:00:00Z",
      endsAt: "2099-03-01T11:00:00Z",
      participants: [],
    });
    const rows = () =>
      column(
        "SELECT externalId FROM upcoming_events WHERE connectorId = ? ORDER BY externalId",
        connectorId,
      );
    // The second row is an instance of a series cancelled since.
    await ingest([upcoming("kept"), upcoming("series_20990301T100000Z")]);
    await ingest([upcoming("kept")]);
    expect(rows()).toEqual(["kept", "series_20990301T100000Z"]);
    await ingest([upcoming("kept"), { kind: "upcoming_listed" }]);
    expect(rows()).toEqual(["kept"]);
  });

  it("commits in transactions of 100 events, so a stream that fails keeps every full batch", async () => {
    const stored = () =>
      column("SELECT id FROM interactions WHERE ownerId = ?", ownerId).length;
    // 101 meetings, then the feed breaks. Just before the 100th event, the
    // stream also reads what is stored: the first batch is still open then.
    let storedBefore100th = -1;
    async function* failingFeed(): AsyncGenerator<SyncEvent> {
      for (let i = 0; i < 101; i++) {
        if (i === 99) storedBefore100th = stored();
        yield mail(`batch-${i}`, [{ email: "alice@example.com" }], {
          type: "meeting",
        });
      }
      throw new Error("feed closed");
    }

    await expect(
      ingestStream(
        scope,
        { id: connectorId, ownerId, kind: "ics", config: {} },
        failingFeed(),
        buildContactMatcher(scope),
        { emails: [], phones: [] },
      ),
    ).rejects.toThrow("feed closed");

    expect(storedBefore100th).toBe(0);
    expect(stored()).toBe(100);
  });

  it("rolls up a contact's mails of one day into one interaction", async () => {
    const alice = [{ email: "alice@example.com" }];
    const { stats } = await ingest(
      [
        mail("email-1", alice, {
          content: "First content",
          date: "2026-03-15T09:00:00Z",
        }),
        mail("email-2", alice, {
          content: "Second content",
          date: "2026-03-15T15:00:00Z",
        }),
      ],
      { kind: "imap", config: { rollup: true } },
    );
    expect(stats).toMatchObject({ interactions: 2, emails: 2 });
    const [rollup] = sqlite
      .prepare("SELECT id, title, content FROM interactions WHERE ownerId = ?")
      .all(ownerId) as Array<{ id: string; title: string; content: string }>;
    expect(rollup.title).toBe("2 emails with Known Alice");
    expect(rollup.content).toMatch(/First content[\s\S]*Second content/);
    expect(
      sqlite
        .prepare(
          "SELECT kind, externalId, localId, seenCount FROM connector_links WHERE connectorId = ? ORDER BY kind, externalId",
        )
        .all(connectorId),
    ).toEqual([
      {
        kind: "interaction",
        externalId: "email-1",
        localId: rollup.id,
        seenCount: 1,
      },
      {
        kind: "interaction",
        externalId: "email-2",
        localId: rollup.id,
        seenCount: 1,
      },
      {
        kind: "rollup",
        externalId: `${contactId}:2026-03-15`,
        localId: rollup.id,
        seenCount: 2,
      },
    ]);
  });

  it("caps a synced person like the API caps one", async () => {
    await ingest([
      card("huge", "N".repeat(1_000), "huge@example.com", {
        about: "A".repeat(30_000),
        emails: Array.from({ length: 300 }, (_, i) => ({
          email: `e${i}@huge.example`,
        })),
        tags: Array.from({ length: 300 }, (_, i) => `${i}`.padEnd(150, "t")),
      }),
    ]);
    const id = linked("huge");
    expect(
      sqlite
        .prepare(
          `SELECT length(name) AS name, length(about) AS about,
             (SELECT COUNT(*) FROM contact_emails WHERE contactId = c.id) AS emails,
             (SELECT COUNT(*) FROM contact_tags WHERE contactId = c.id) AS tags,
             (SELECT MAX(length(tag)) FROM contact_tags WHERE contactId = c.id) AS tag
           FROM contacts c WHERE id = ?`,
        )
        .get(id),
    ).toEqual({ name: 300, about: 20_000, emails: 100, tags: 100, tag: 100 });
  });

  it("only fills in a contact a synced person shares an address with", async () => {
    // The card binds to the contact by the shared address. A later sync of
    // it must not rename the contact, nor drop the emails and phones Google
    // does not know.
    const momId = addContact("Mom", "company", "Home");
    addEmail(momId, "shared@family.example");
    addEmail(momId, "mom@family.example", 0);
    sqlite
      .prepare(
        "INSERT INTO contact_phones (id, contactId, phone, isPrimary) VALUES (?, ?, '+14155550100', 1)",
      )
      .run(crypto.randomUUID(), momId);

    const dad = card("people/dad", "Dad", "shared@family.example", {
      role: "Engineer",
      phones: [{ phone: "+14155550199", type: "mobile", isPrimary: true }],
    });
    // The first sync fills in too: Google sends an unchanged card only once,
    // so a fill left for the second sync never happened.
    for (let sync = 0; sync < 2; sync++) {
      await ingest([dad]);
      expect(
        sqlite
          .prepare("SELECT name, company, role FROM contacts WHERE id = ?")
          .get(momId),
      ).toEqual({ name: "Mom", company: "Home", role: "Engineer" });
      expect(
        column(
          "SELECT email FROM contact_emails WHERE contactId = ? ORDER BY email",
          momId,
        ),
      ).toEqual(["mom@family.example", "shared@family.example"]);
      expect(
        column(
          "SELECT phone FROM contact_phones WHERE contactId = ? ORDER BY phone",
          momId,
        ),
      ).toEqual(["+14155550100", "+14155550199"]);
    }
  });

  it("only fills in a contact that survived a merge with one the sync created", async () => {
    // The merge moves the duplicate's source row to the survivor. Taken as
    // "made by the sync", the duplicate's card then wrote over the survivor.
    await ingest([card("people/dup", "Sam Dup", "sam@dup.example")]);
    const mainId = addContact("Samantha");
    mergeContacts(scope, mainId, linked("people/dup"), "test-merge");

    await ingest([card("people/dup", "Sam Renamed", "sam@dup.example")]);

    expect(column("SELECT name FROM contacts WHERE id = ?", mainId)).toEqual([
      "Samantha",
    ]);
  });

  it("fills a photo over the drawn default avatar, and keeps a real one", () => {
    const photo = "/uploads/u/x/avatars/remote-abc.jpg";
    const local = (avatarUrl: string) =>
      ({
        name: "Ada",
        avatarUrl,
        emails: [],
        phones: [],
      }) as unknown as HydratedContact;
    expect(
      fillFromRemote(local(defaultAvatarUrl("Ada")), { avatarUrl: photo }),
    ).toEqual({ avatarUrl: photo });
    expect(
      fillFromRemote(local("/uploads/u/x/avatars/mine.jpg"), {
        avatarUrl: photo,
      }),
    ).toBeNull();
  });

  it("adds Google's labels and links to a contact the sync made, and keeps the owner's", async () => {
    await ingest([card("people/bob", "Bob Builder", "bob@builder.example")]);
    const bobId = linked("people/bob");
    sqlite
      .prepare(
        "INSERT INTO contact_tags (id, contactId, tag) VALUES (?, ?, 'VIP')",
      )
      .run(crypto.randomUUID(), bobId);
    sqlite
      .prepare(
        `INSERT INTO contact_social_links (id, contactId, platform, url)
         VALUES (?, ?, 'github', 'https://github.com/bob')`,
      )
      .run(crypto.randomUUID(), bobId);

    await ingest([
      card("people/bob", "Bob Builder", "bob@builder.example", {
        tags: ["Friends"],
        socialLinks: [
          { url: "https://github.com/bob" },
          { url: "https://bob.example" },
        ],
      }),
    ]);

    expect(
      column(
        "SELECT tag FROM contact_tags WHERE contactId = ? ORDER BY tag",
        bobId,
      ),
    ).toEqual(["Friends", "VIP"]);
    expect(
      column(
        "SELECT url FROM contact_social_links WHERE contactId = ? ORDER BY url",
        bobId,
      ),
    ).toEqual(["https://bob.example", "https://github.com/bob"]);
  });

  it("records a promoted ghost as a new contact, and makes it a contact when a Google card names them, so later edits apply", async () => {
    const stranger = { email: "sam@stranger.example", name: "sam" };
    await ingest([mail("m-1", [stranger]), mail("m-2", [stranger])], {
      ghostThreshold: 2,
    });
    const ghost = sqlite
      .prepare(
        "SELECT id, phoneticHash FROM contacts WHERE ownerId = ? AND isGhost = 1",
      )
      .get(ownerId) as { id: string; phoneticHash: string | null };
    expect(ghost.phoneticHash).toBeTruthy();
    expect(
      column(
        "SELECT payload FROM events WHERE ownerId = ? AND type = 'contact.created' AND subjectId = ?",
        ownerId,
        ghost.id,
      ).map((p) => JSON.parse(p as string)),
    ).toEqual([{ origin: "connector", autoEnrich: false }]);

    await ingest([card("people/sam", "Sam Stranger", "sam@stranger.example")]);
    expect(
      sqlite
        .prepare("SELECT name, isGhost FROM contacts WHERE id = ?")
        .get(ghost.id),
    ).toEqual({ name: "Sam Stranger", isGhost: 0 });

    await ingest([
      card("people/sam", "Samuel Stranger", "sam@stranger.example"),
    ]);
    expect(column("SELECT name FROM contacts WHERE id = ?", ghost.id)).toEqual([
      "Samuel Stranger",
    ]);
  });

  it("puts the drawn avatar back over a saved copy of Google's letter tile, and keeps any other photo", async () => {
    const tile = "https://lh3.googleusercontent.com/cm/ABC123=s100";
    const ana = card("people/ana", "Ana Lee", "ana@example.com");
    const bo = card("people/bo", "Bo Ray", "bo@example.com");
    await ingest([ana, bo]);
    const avatarOf = (externalId: string) =>
      column("SELECT avatarUrl FROM contacts WHERE id = ?", linked(externalId));
    const setAvatar = sqlite.prepare(
      "UPDATE contacts SET avatarUrl = ? WHERE id = ?",
    );
    // An earlier sync saved the tile, under the digest of its URL.
    setAvatar.run(
      `/uploads/u/${ownerId}/avatars/remote-${urlDigest(tile)}.jpg`,
      linked("people/ana"),
    );
    const uploaded = `/uploads/u/${ownerId}/avatars/avatar-1-2.jpg`;
    setAvatar.run(uploaded, linked("people/bo"));

    await ingest([
      { ...ana, defaultPhotoUrl: tile },
      { ...bo, defaultPhotoUrl: tile },
    ] as SyncEvent[]);

    expect(avatarOf("people/ana")).toEqual([defaultAvatarUrl("Ana Lee")]);
    expect(avatarOf("people/bo")).toEqual([uploaded]);
  });

  it("trashes a contact the sync created when Google deletes it, and only unlinks one it matched", async () => {
    await ingest([
      card("people/alice", "Alice G", "alice@example.com"),
      card("people/bob", "Bob Builder", "bob@builder.example"),
    ]);
    const bobId = linked("people/bob");

    await ingest([
      { kind: "contact_deleted", externalId: "people/alice" },
      { kind: "contact_deleted", externalId: "people/bob" },
    ]);

    const deletedAt = (id: unknown) =>
      column("SELECT deletedAt FROM contacts WHERE id = ?", id)[0];
    expect(deletedAt(contactId)).toBeNull();
    expect(deletedAt(bobId)).toEqual(expect.any(String));
    expect(linked("people/alice") ?? linked("people/bob")).toBeUndefined();
  });

  it("links a connector added back to the contacts it made, and only fills them in", async () => {
    const solo = (name: string): SyncEvent => ({
      kind: "contact",
      externalId: "people/solo",
      contact: { name, emails: [], phones: [], company: "Acme" },
    });
    await ingest([solo("Name Only")]);
    // Removed, which drops the links, and added back later.
    sqlite
      .prepare("DELETE FROM connector_links WHERE connectorId = ?")
      .run(connectorId);
    sqlite
      .prepare(
        "UPDATE connectors SET createdAt = datetime('now', '+1 minute') WHERE id = ?",
      )
      .run(connectorId);

    await ingest([solo("Renamed In Google")]);
    expect(
      column(
        "SELECT name FROM contacts WHERE ownerId = ? AND company = 'Acme'",
        ownerId,
      ),
    ).toEqual(["Name Only"]);
  });

  it("links a card whose UID names a merged-away contact to the one it was merged into", async () => {
    const dupId = addContact("Old Alice", "canonicalId", contactId);
    await ingest([
      {
        kind: "contact",
        externalId: `book/${dupId}.vcf`,
        contact: { uid: dupId, name: "Alice Card", emails: [], phones: [] },
      },
    ]);
    expect(linked(`book/${dupId}.vcf`)).toBe(contactId);
  });
});
