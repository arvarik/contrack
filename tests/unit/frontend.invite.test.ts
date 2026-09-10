// =============================================================================
// One-time credentials — the link, and the value read out loud
// =============================================================================
// Three things in 2.0 exist exactly once: the invitation link, the temporary
// password an administrator hands over, and a personal API token. Each is
// shown on one screen and never again, so a bug in how one is read or
// displayed does not fail loudly — it fails when somebody cannot sign in with
// a password they were sure they copied correctly.
//
// These are the pure parts of that journey. The rest is rendering.
// =============================================================================
import { describe, expect, it } from "vitest";
import {
  groupSecret,
  parseInvitationToken,
  urlWithoutInvitationToken,
} from "../../src/lib/credentials";

describe("invitation links", () => {
  it("reads the token out of the link the server builds", () => {
    expect(
      parseInvitationToken("https://crm.example.com/join?token=abc123"),
    ).toBe("abc123");
    expect(
      parseInvitationToken("http://localhost:3210/join?token=abc123"),
    ).toBe("abc123");
  });

  it("keeps a base64url secret intact", () => {
    // The server sends 32 random bytes as base64url, so the value can carry
    // `-` and `_`, and a naive split on a delimiter would truncate it.
    const secret = "aB3-_xY7zQ9wErTyUiOpAsDfGhJkLzXcVbNm1234567";
    expect(
      parseInvitationToken(`https://example.com/join?token=${secret}`),
    ).toBe(secret);
  });

  it("only treats /join as an invitation", () => {
    // Any other page with a `token` parameter belongs to some other feature.
    // Reading it as an invitation would drop a signed-in person onto a
    // create-an-account form for no reason.
    expect(parseInvitationToken("https://example.com/?token=abc")).toBeNull();
    expect(
      parseInvitationToken("https://example.com/contacts?token=abc"),
    ).toBeNull();
    expect(
      parseInvitationToken("https://example.com/join/extra?token=abc"),
    ).toBeNull();
  });

  it("treats a missing or empty token as no invitation", () => {
    expect(parseInvitationToken("https://example.com/join")).toBeNull();
    expect(parseInvitationToken("https://example.com/join?token=")).toBeNull();
    expect(
      parseInvitationToken("https://example.com/join?token=%20"),
    ).toBeNull();
  });

  it("survives a href it cannot parse", () => {
    expect(parseInvitationToken("")).toBeNull();
    expect(parseInvitationToken("::not a url::")).toBeNull();
  });

  it("removes the secret from the address bar and leaves /join behind", () => {
    // `/join` is not a route in the router — the gate answers it before the
    // router exists — so staying there would leave a reload on a 404-shaped
    // path. The secret must go either way: it reaches the history, the tab
    // title, and any screenshot.
    expect(
      urlWithoutInvitationToken("https://example.com/join?token=abc123"),
    ).toBe("/");
    expect(
      urlWithoutInvitationToken("https://example.com/join?token=abc&ref=email"),
    ).toBe("/?ref=email");
    expect(
      urlWithoutInvitationToken("https://example.com/join?token=abc#top"),
    ).toBe("/#top");
  });

  it("leaves a path that was not the join screen alone", () => {
    expect(
      urlWithoutInvitationToken("https://example.com/contacts?q=ann"),
    ).toBe("/contacts?q=ann");
  });
});

describe("temporary password display", () => {
  it("groups a generated password into blocks of four", () => {
    // The server generates 20 characters from a 62-character alphabet, and
    // the comment beside the generator says why: "A temporary password gets
    // read aloud and typed." Five blocks of four is the same string with
    // somewhere for the eye to rest.
    expect(groupSecret("aB3xY7zQ9wErTyUiOpAs")).toEqual([
      "aB3x",
      "Y7zQ",
      "9wEr",
      "TyUi",
      "OpAs",
    ]);
  });

  it("never changes the characters, only where they are shown", () => {
    // The groups are rendered as separate elements with a CSS gap and no
    // space between them, so a hand-made selection copies the same value the
    // copy button gives. A space typed into a password field is a different
    // password, and this is the assertion that says so.
    const secret = "aB3xY7zQ9wErTyUiOpAs";
    expect(groupSecret(secret).join("")).toBe(secret);
  });

  it("keeps a short last group rather than padding it", () => {
    expect(groupSecret("abcdefg")).toEqual(["abcd", "efg"]);
  });

  it("handles the degenerate inputs without throwing", () => {
    expect(groupSecret("")).toEqual([]);
    expect(groupSecret("ab", 4)).toEqual(["ab"]);
    // A group size below one would loop forever, so it is refused rather
    // than obeyed.
    expect(groupSecret("abcd", 0)).toEqual(["abcd"]);
  });

  it("takes a group size when a caller wants a different rhythm", () => {
    expect(groupSecret("abcdefgh", 2)).toEqual(["ab", "cd", "ef", "gh"]);
  });
});
