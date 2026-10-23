import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp } from "./helpers.ts";
import { resetAccounts } from "./tenancy/helpers.ts";
import { sqlite } from "../../server/db.ts";
import { createUser } from "../../server/services/authService.ts";
import { ConflictError, NotFoundError } from "../../server/utils/AppError.ts";
import {
  findUserIdByIdentity,
  linkIdentity,
  listIdentities,
  unlinkIdentity,
} from "../../server/services/identityService.ts";

makeTestApp(); // opens the test database

const ISSUER = "https://id.example.com";

async function user(name: string) {
  return createUser({
    email: `${name}@example.com`,
    username: name,
    password: "correct horse battery staple",
    role: "member",
  });
}

describe("identityService", () => {
  beforeEach(() => resetAccounts());

  it("links, finds, lists and unlinks", async () => {
    const ada = await user("ada");
    const linked = linkIdentity(ada.id, ISSUER, "sub-1", "ada@example.com");
    expect(findUserIdByIdentity(ISSUER, "sub-1")).toBe(ada.id);
    expect(listIdentities(ada.id)).toEqual([
      expect.objectContaining({ id: linked.id, email: "ada@example.com" }),
    ]);
    unlinkIdentity(ada.id, linked.id);
    expect(findUserIdByIdentity(ISSUER, "sub-1")).toBeNull();
  });

  it("refuses an identity another account holds", async () => {
    const ada = await user("ada");
    const bob = await user("bob");
    linkIdentity(ada.id, ISSUER, "sub-1", null);
    expect(() => linkIdentity(bob.id, ISSUER, "sub-1", null)).toThrow(
      ConflictError,
    );
  });

  it("replaces the same account's link to the same provider", async () => {
    const ada = await user("ada");
    linkIdentity(ada.id, ISSUER, "sub-1", null);
    sqlite
      .prepare(
        "UPDATE user_identities SET createdAt = '2020-01-01 00:00:00', lastUsedAt = '2020-01-02 00:00:00'",
      )
      .run();
    const relinked = linkIdentity(ada.id, ISSUER, "sub-2", null);
    expect(findUserIdByIdentity(ISSUER, "sub-1")).toBeNull();
    expect(findUserIdByIdentity(ISSUER, "sub-2")).toBe(ada.id);
    // A new link: its dates start over.
    expect(relinked.createdAt).not.toBe("2020-01-01 00:00:00");
    expect(relinked.lastUsedAt).toBeNull();
  });

  it("will not unlink another account's identity", async () => {
    const ada = await user("ada");
    const bob = await user("bob");
    const linked = linkIdentity(ada.id, ISSUER, "sub-1", null);
    expect(() => unlinkIdentity(bob.id, linked.id)).toThrow(NotFoundError);
  });
});
