import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Request } from "express";
import {
  publicOrigin,
  validatePublicUrl,
  getPasskeyRp,
} from "../../../../server/utils/publicOrigin.ts";
import { AppError } from "../../../../server/utils/AppError.ts";

/**
 * A request as Express presents it with no trusted proxy hop: `host` is
 * `req.host`, which Express then takes from Host. The forwarded-host cases,
 * with Express's real trust-proxy setting, are tested in
 * tests/integration/api.admin.test.ts.
 */
function mockRequest({
  protocol = "http",
  headers = {},
}: {
  protocol?: string;
  headers?: Record<string, string>;
} = {}): Request {
  return {
    protocol,
    host: headers.host,
  } as unknown as Request;
}

describe("publicOrigin and passkey RP derivation", () => {
  const originalEnv = process.env.PUBLIC_URL;

  beforeEach(() => {
    delete process.env.PUBLIC_URL;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.PUBLIC_URL = originalEnv;
    } else {
      delete process.env.PUBLIC_URL;
    }
  });

  it("uses the PUBLIC_URL override when set", () => {
    process.env.PUBLIC_URL = "https://public.example.org";
    const req = mockRequest({
      protocol: "http",
      headers: { host: "localhost:3210" },
    });

    expect(publicOrigin(req)).toBe("https://public.example.org");
    const { rpID, origin } = getPasskeyRp(req);
    expect(origin).toBe("https://public.example.org");
    expect(rpID).toBe("public.example.org");
  });

  it.each(["127.0.0.1:3210", "192.168.1.100:3210", "[::1]:3210"])(
    "throws PASSKEY_UNSUPPORTED_ORIGIN for the IP host %s",
    (host) => {
      const req = mockRequest({ protocol: "http", headers: { host } });
      // The origin is still built. Only the passkey rpID refuses an IP.
      expect(publicOrigin(req)).toBe(`http://${host}`);
      let thrown: unknown;
      try {
        getPasskeyRp(req);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(AppError);
      expect(thrown).toMatchObject({
        statusCode: 400,
        code: "PASSKEY_UNSUPPORTED_ORIGIN",
      });
    },
  );

  describe("validatePublicUrl", () => {
    it("accepts http and https URLs without paths", () => {
      expect(validatePublicUrl("https://crm.example.com")).toBe(
        "https://crm.example.com",
      );
      expect(validatePublicUrl("http://localhost:3210")).toBe(
        "http://localhost:3210",
      );
      expect(validatePublicUrl("https://crm.example.com/")).toBe(
        "https://crm.example.com",
      );
      expect(validatePublicUrl(undefined)).toBeNull();
      expect(validatePublicUrl("")).toBeNull();
      expect(validatePublicUrl("   ")).toBeNull();
    });

    it("rejects URLs with a path", () => {
      expect(() => validatePublicUrl("https://crm.example.com/crm")).toThrow(
        /PUBLIC_URL must not include a path/,
      );
    });

    it("rejects non-http/https protocols", () => {
      expect(() => validatePublicUrl("ftp://crm.example.com")).toThrow(
        /PUBLIC_URL must have an http or https protocol/,
      );
    });

    it("rejects invalid URLs", () => {
      expect(() => validatePublicUrl("not-a-url")).toThrow(
        /PUBLIC_URL must be a valid http or https origin/,
      );
    });

    it("rejects query parameters and hashes", () => {
      expect(() =>
        validatePublicUrl("https://crm.example.com?foo=bar"),
      ).toThrow(/PUBLIC_URL must not include query parameters/);
      expect(() =>
        validatePublicUrl("https://crm.example.com#section"),
      ).toThrow(/PUBLIC_URL must not include query parameters/);
    });
  });
});
