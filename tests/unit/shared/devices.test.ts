import { describe, expect, it } from "vitest";
import { describeSessionMethod } from "../../../shared/devices";

describe("describeSessionMethod", () => {
  it("names each way the server signs somebody in", () => {
    expect(describeSessionMethod("password")).toBe("Password");
    expect(describeSessionMethod("passkey")).toBe("Passkey");
    // The server writes "email-link" for a reset link and a sign-in link.
    expect(describeSessionMethod("email-link")).toBe("Emailed link");
  });

  it("reads a session with no recorded method as a password", () => {
    expect(describeSessionMethod(null)).toBe("Password");
    expect(describeSessionMethod(undefined)).toBe("Password");
  });

  it("does not read an object property name as a method", () => {
    expect(describeSessionMethod("constructor")).toBe("Password");
  });
});
