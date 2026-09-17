import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Request } from "express";
import {
  publicOrigin,
  validatePublicUrl,
  getPasskeyRp,
} from "../../server/utils/publicOrigin.ts";
import { AppError } from "../../server/utils/AppError.ts";

function mockRequest({
  protocol = "http",
  headers = {},
}: {
  protocol?: string;
  headers?: Record<string, string>;
} = {}): Request {
  return {
    protocol,
    get(name: string) {
      const lower = name.toLowerCase();
      return headers[lower] ?? headers[name];
    },
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

  it("derives origin and rpID for localhost:3210", () => {
    const req = mockRequest({
      protocol: "http",
      headers: { host: "localhost:3210" },
    });

    expect(publicOrigin(req)).toBe("http://localhost:3210");
    const { rpID, origin } = getPasskeyRp(req);
    expect(origin).toBe("http://localhost:3210");
    expect(rpID).toBe("localhost");
  });

  it("derives origin and rpID for a proxied https host", () => {
    const req = mockRequest({
      protocol: "https",
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "crm.example.com",
        host: "backend-internal:3210",
      },
    });

    expect(publicOrigin(req)).toBe("https://crm.example.com");
    const { rpID, origin } = getPasskeyRp(req);
    expect(origin).toBe("https://crm.example.com");
    expect(rpID).toBe("crm.example.com");
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

  it("throws PASSKEY_UNSUPPORTED_ORIGIN for an IP host", () => {
    const ipv4Req = mockRequest({
      protocol: "http",
      headers: { host: "127.0.0.1:3210" },
    });
    expect(publicOrigin(ipv4Req)).toBe("http://127.0.0.1:3210");
    expect(() => getPasskeyRp(ipv4Req)).toThrowError(AppError);
    try {
      getPasskeyRp(ipv4Req);
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(400);
      expect((err as AppError).code).toBe("PASSKEY_UNSUPPORTED_ORIGIN");
    }

    const lanReq = mockRequest({
      protocol: "http",
      headers: { host: "192.168.1.100:3210" },
    });
    expect(() => getPasskeyRp(lanReq)).toThrowError(AppError);
    try {
      getPasskeyRp(lanReq);
    } catch (err) {
      expect((err as AppError).code).toBe("PASSKEY_UNSUPPORTED_ORIGIN");
    }

    const ipv6Req = mockRequest({
      protocol: "http",
      headers: { host: "[::1]:3210" },
    });
    expect(() => getPasskeyRp(ipv6Req)).toThrowError(AppError);
    try {
      getPasskeyRp(ipv6Req);
    } catch (err) {
      expect((err as AppError).code).toBe("PASSKEY_UNSUPPORTED_ORIGIN");
    }
  });

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
