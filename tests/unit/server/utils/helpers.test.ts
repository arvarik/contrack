import { describe, it, expect } from "vitest";
import {
  contactSlug,
  getErrorMessage,
  newContactId,
  redactUrlForLog,
} from "../../../../server/utils/helpers";

describe("contactSlug & newContactId", () => {
  it.each([
    ["Ada Lovelace", "ada-lovelace"],
    ["Dr. François-Xavier D'Souza", "dr-francois-xavier-d-souza"],
    ["  alice@example.com  ", "alice-example-com"],
    ["???", "contact"],
    ["", "contact"],
    [
      "A Very Long Contact Name That Exceeds Thirty Two Characters Easily",
      "a-very-long-contact-name-that-ex",
    ],
  ])("slugifies %j as %s", (name, expected) => {
    expect(contactSlug(name)).toBe(expected);
  });

  it("appends a unique 8-character hex suffix to the name slug", () => {
    const a = newContactId("Ada Lovelace");
    const b = newContactId("Ada Lovelace");
    expect(a).toMatch(/^ada-lovelace-[0-9a-f]{8}$/);
    expect(b).toMatch(/^ada-lovelace-[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
  });
});

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

// redactUrlForLog
// The query string carries invitation and sign-in secrets, palette searches,
// pasted links and a failed Google sign-in's code. Morgan's `:url` token and
// the error log read `req.originalUrl`, so both keep the path alone.

describe("redactUrlForLog", () => {
  it.each([
    ["/join?token=abc123XYZ_-def", "/join"],
    ["/api/search?q=Zelda%20Marker&limit=5", "/api/search"],
    [
      "/api/connectors/google/callback?code=c&state=s",
      "/api/connectors/google/callback",
    ],
    [
      "/api/link-preview/unfurl?url=https%3A%2F%2Fexample.com%2Fjane",
      "/api/link-preview/unfurl",
    ],
    ["/join#token=abc", "/join"],
    ["/api/contacts/1234", "/api/contacts/1234"],
  ])("writes %s as %s", (url, logged) => {
    expect(redactUrlForLog(url)).toBe(logged);
  });
});
