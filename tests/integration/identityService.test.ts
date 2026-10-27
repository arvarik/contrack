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

  it("will not link or unlink an identity another account holds", async () => {
    const ada = await user("ada");
    const bob = await user("bob");
    linkIdentity(ada.id, ISSUER, "sub-1", null);
    expect(() => linkIdentity(bob.id, ISSUER, "sub-1", null)).toThrow(
      ConflictError,
    );
    const [held] = listIdentities(ada.id);
    expect(() => unlinkIdentity(bob.id, held.id)).toThrow(NotFoundError);
    expect(findUserIdByIdentity(ISSUER, "sub-1")).toBe(ada.id);
  });

  it("replaces the same account's link to the same provider", async () => {
    const ada = await user("ada");
    linkIdentity(ada.id, ISSUER, "sub-1", null);
    sqlite
      .prepare(
        "UPDATE user_identities SET createdAt = '2020-01-01 00:00:00', lastUsedAt = '2020-01-02 00:00:00'",
      )
      .run();
    linkIdentity(ada.id, ISSUER, "sub-2", null);
    expect(findUserIdByIdentity(ISSUER, "sub-1")).toBeNull();
    expect(findUserIdByIdentity(ISSUER, "sub-2")).toBe(ada.id);
    // A new link: its dates start over.
    const [relinked] = listIdentities(ada.id);
    expect(relinked.createdAt).not.toBe("2020-01-01 00:00:00");
    expect(relinked.lastUsedAt).toBeNull();
  });
});
