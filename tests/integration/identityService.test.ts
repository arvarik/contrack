import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp } from "./helpers.ts";
import { resetAccounts } from "./tenancy/helpers.ts";
import { createUser } from "../../server/services/authService.ts";
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
      expect.objectContaining({ statusCode: 409, code: "IDENTITY_TAKEN" }),
    );
  });

  it("replaces the same account's link to the same provider", async () => {
    const ada = await user("ada");
    linkIdentity(ada.id, ISSUER, "sub-1", null);
    linkIdentity(ada.id, ISSUER, "sub-2", null);
    expect(findUserIdByIdentity(ISSUER, "sub-1")).toBeNull();
    expect(findUserIdByIdentity(ISSUER, "sub-2")).toBe(ada.id);
  });

  it("will not unlink another account's identity", async () => {
    const ada = await user("ada");
    const bob = await user("bob");
    const linked = linkIdentity(ada.id, ISSUER, "sub-1", null);
    expect(() => unlinkIdentity(bob.id, linked.id)).toThrow(
      expect.objectContaining({ statusCode: 404 }),
    );
  });
});
