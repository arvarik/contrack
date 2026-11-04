/**
 * Unit: participant matching.
 */

import { describe, expect, it } from "vitest";
import { createMatcherFromMaps } from "../../../../server/connectors/matching.ts";

describe("connectors matching", () => {
  const matcher = () =>
    createMatcherFromMaps(
      new Map([
        ["alice@example.com", "alice"],
        ["bob@example.com", "bob"],
        ["me@work.com", "self"],
      ]),
      new Map([["4155550100", "phone-bob"]]),
    );

  it.each([
    [{ email: "ALICE@Example.COM" }, "alice"],
    [{ phone: "+1 (415) 555-0100" }, "phone-bob"],
    [{ email: "stranger@other.com" }, null],
  ])("resolves %j to %s", (participant, id) => {
    expect(matcher().resolveContactId(participant)).toBe(id);
  });

  it("matches a registered contact by mailbox, without its +tag or Gmail's dots, and by phone", () => {
    const m = matcher();
    m.registerContact("ana", ["AnaLee@gmail.com"], ["+1 415 555 9999"]);
    expect(m.resolveContactId({ email: "ana.lee+news@gmail.com" })).toBe("ana");
    expect(m.resolveContactId({ phone: "415-555-9999" })).toBe("ana");
  });

  it("takes the first contact as primary and the rest as mentions, leaves the owner out, and keeps strangers", () => {
    const stranger = { email: "stranger@other.com", name: "Stranger" };
    expect(
      matcher().matchParticipants(
        [
          { email: "ME@Work.com", name: "Me" },
          { email: "alice@example.com" },
          stranger,
          { email: "bob@example.com" },
        ],
        { emails: ["me@work.com"], phones: [] },
      ),
    ).toMatchObject({
      hasSelf: true,
      primaryContactId: "alice",
      mentionContactIds: ["bob"],
      unknownParticipants: [stranger],
    });
  });
});
