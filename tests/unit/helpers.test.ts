import { describe, it, expect } from "vitest";
import { getErrorMessage } from "../../server/utils/helpers";

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
