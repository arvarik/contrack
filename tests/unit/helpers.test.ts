import { describe, it, expect } from "vitest";
import { getErrorMessage, redactUrlForLog } from "../../server/utils/helpers";

describe("getErrorMessage", () => {
  it("extracts message from a standard Error instance", () => {
    const message = "Something went wrong";
    const error = new Error(message);
    expect(getErrorMessage(error)).toBe(message);
  });

  it("extracts message from a custom Error subclass", () => {
    class CustomError extends Error {
      constructor(msg: string) {
        super(msg);
        this.name = "CustomError";
      }
    }
    const message = "Custom error message";
    const error = new CustomError(message);
    expect(getErrorMessage(error)).toBe(message);
  });

  it("returns the string representation of a string thrown value", () => {
    const message = "Simple string error";
    expect(getErrorMessage(message)).toBe(message);
  });

  it("returns the string representation of a numeric thrown value", () => {
    expect(getErrorMessage(404)).toBe("404");
  });

  it("returns the string representation of a boolean thrown value", () => {
    expect(getErrorMessage(true)).toBe("true");
    expect(getErrorMessage(false)).toBe("false");
  });

  it("returns the string representation of null", () => {
    expect(getErrorMessage(null)).toBe("null");
  });

  it("returns the string representation of undefined", () => {
    expect(getErrorMessage(undefined)).toBe("undefined");
  });

  it("returns '[object Object]' for a plain object", () => {
    expect(getErrorMessage({})).toBe("[object Object]");
  });

  it("returns string representation of an object with toString", () => {
    const obj = {
      toString: () => "Custom Object Error",
    };
    expect(getErrorMessage(obj)).toBe("Custom Object Error");
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
