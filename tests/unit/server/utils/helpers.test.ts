import { describe, it, expect } from "vitest";
import {
  getErrorMessage,
  redactUrlForLog,
} from "../../../../server/utils/helpers";

describe("getErrorMessage", () => {
  class CustomError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "CustomError";
    }
  }

  // An Error gives its message. Anything else gives String(value).
  it.each([
    ["an Error", "Something went wrong", new Error("Something went wrong")],
    [
      "an Error subclass",
      "Custom error message",
      new CustomError("Custom error message"),
    ],
    ["a string", "Simple string error", "Simple string error"],
    ["a number", "404", 404],
    ["true", "true", true],
    ["false", "false", false],
    ["null", "null", null],
    ["undefined", "undefined", undefined],
    ["a plain object", "[object Object]", {}],
    [
      "an object with toString",
      "Custom Object Error",
      { toString: () => "Custom Object Error" },
    ],
  ])("reads %s as %j", (_label, message, thrown) => {
    expect(getErrorMessage(thrown)).toBe(message);
  });
});

// =============================================================================
// redactUrlForLog
// =============================================================================
// An invitation link carries its secret in the query string, and the invitee's
// browser sends it to this server as an ordinary page request. Morgan's `:url`
// token is `req.originalUrl`, so without this the one value the invitation
// system keeps out of the database would sit in the access log for as long as
// the operator keeps their logs.

describe("redactUrlForLog", () => {
  it("removes the invitation secret and keeps the path", () => {
    expect(redactUrlForLog("/join?token=abc123XYZ_-def")).toBe(
      "/join?token=%5Bredacted%5D",
    );
  });

  it("leaves a URL with nothing secret in it alone", () => {
    for (const url of [
      "/api/contacts",
      "/api/contacts?limit=50&sort=name",
      "/uploads/u/1234/avatars/face.png",
    ]) {
      expect(redactUrlForLog(url)).toBe(url);
    }
  });

  it("keeps the other parameters beside the redacted one", () => {
    const out = redactUrlForLog("/join?ref=email&token=secret&lang=en");
    expect(out).toContain("ref=email");
    expect(out).toContain("lang=en");
    expect(out).not.toContain("secret");
  });

  it("catches a repeated key and an upper-case one", () => {
    expect(redactUrlForLog("/join?token=one&token=two")).not.toContain("one");
    expect(redactUrlForLog("/join?TOKEN=one")).not.toContain("one");
  });

  it("redacts a value that is not valid percent-encoding", () => {
    // A lone `%` is not valid percent-encoding. The URL parser is lenient
    // about it rather than throwing, so the value is still redacted.
    const out = redactUrlForLog("/join?token=%");
    expect(out).toBe("/join?token=%5Bredacted%5D");
  });
});
