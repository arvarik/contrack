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
