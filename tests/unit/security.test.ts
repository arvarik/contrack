// =============================================================================
// Security utilities — upload path containment, SSRF guards, rate limiting
// =============================================================================

import { describe, it, expect } from "vitest";
import path from "path";
import type { Request, Response } from "express";
import { UPLOADS_DIR, resolveUploadPath } from "../../server/utils/paths.ts";
import {
  assertPublicHttpUrl,
  isPrivateAddress,
} from "../../server/utils/urlSafety.ts";
import {
  createRateLimiter,
  isAiCostPath,
} from "../../server/middleware/rateLimit.ts";
import {
  RateLimitedError,
  ValidationError,
} from "../../server/utils/AppError.ts";

// =============================================================================
// resolveUploadPath — containment
// =============================================================================

describe("resolveUploadPath", () => {
  it("resolves a valid avatar URL inside the uploads dir", () => {
    const resolved = resolveUploadPath("/uploads/avatars/abc.jpg");
    expect(resolved).toBe(path.join(UPLOADS_DIR, "avatars", "abc.jpg"));
  });

  it("resolves a top-level attachment URL", () => {
    const resolved = resolveUploadPath("/uploads/attachment-123.eml");
    expect(resolved).toBe(path.join(UPLOADS_DIR, "attachment-123.eml"));
  });

  it("rejects traversal via ..", () => {
    expect(
      resolveUploadPath("/uploads/avatars/../../../../etc/passwd"),
    ).toBeNull();
    expect(resolveUploadPath("/uploads/../server/db.ts")).toBeNull();
  });

  it("rejects paths outside /uploads/", () => {
    expect(resolveUploadPath("/etc/passwd")).toBeNull();
    expect(resolveUploadPath("avatars/x.jpg")).toBeNull();
    expect(resolveUploadPath("")).toBeNull();
  });

  it("rejects the uploads root itself", () => {
    expect(resolveUploadPath("/uploads/")).toBeNull();
    expect(resolveUploadPath("/uploads/.")).toBeNull();
  });
});

// =============================================================================
// URL safety — private address detection (SSRF guard)
// =============================================================================

describe("isPrivateAddress", () => {
  it("flags loopback and private IPv4 ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.5",
      "192.168.1.10",
      "172.16.0.1",
      "172.31.255.255",
      "169.254.169.254", // cloud metadata
      "100.64.0.1", // CGNAT
      "0.0.0.0",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("allows public IPv4", () => {
    for (const ip of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "172.32.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it("flags private/loopback IPv6", () => {
    for (const ip of ["::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("allows public IPv6", () => {
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
  });
});

describe("assertPublicHttpUrl", () => {
  it("rejects non-http(s) schemes", async () => {
    for (const url of [
      "file:///etc/passwd",
      "ftp://example.com/x",
      "javascript:alert(1)",
      "gopher://example.com",
    ]) {
      await expect(assertPublicHttpUrl(url)).rejects.toThrow(ValidationError);
    }
  });

  it("rejects literal private IPs without DNS", async () => {
    for (const url of [
      "http://127.0.0.1:3210/api/contacts",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.1/",
      "http://[::1]/",
    ]) {
      await expect(assertPublicHttpUrl(url)).rejects.toThrow("private address");
    }
  });

  it("rejects localhost hostnames", async () => {
    await expect(assertPublicHttpUrl("http://localhost:8080/")).rejects.toThrow(
      "private address",
    );
    await expect(assertPublicHttpUrl("http://foo.localhost/")).rejects.toThrow(
      "private address",
    );
  });

  it("rejects unparseable URLs", async () => {
    await expect(assertPublicHttpUrl("not a url")).rejects.toThrow(
      ValidationError,
    );
  });

  it("accepts a public literal IP", async () => {
    const url = await assertPublicHttpUrl("https://1.1.1.1/");
    expect(url.hostname).toBe("1.1.1.1");
  });
});

// =============================================================================
// Rate limiter
// =============================================================================

/**
 * The limiter reads the caller's address and hands a refusal to `next`. The
 * error handler writes `Retry-After`, so the response here needs nothing.
 */
function fakeReqRes(ip = "10.0.0.1"): { req: Request; res: Response } {
  return {
    req: { ip } as unknown as Request,
    res: {} as Response,
  };
}

describe("createRateLimiter", () => {
  it("rejects requests over the limit with RateLimitedError", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2, name: "t" });
    const { req, res } = fakeReqRes();
    const errors: unknown[] = [];
    for (let i = 0; i < 4; i++)
      limiter(req, res, (e?: unknown) => errors.push(e));
    expect(errors[0]).toBeUndefined();
    expect(errors[1]).toBeUndefined();
    expect(errors[2]).toBeInstanceOf(RateLimitedError);
    expect(errors[3]).toBeInstanceOf(RateLimitedError);
  });

  it("tracks limits per client IP", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, name: "t" });
    const a = fakeReqRes("10.0.0.1");
    const b = fakeReqRes("10.0.0.2");
    const errors: unknown[] = [];
    limiter(a.req, a.res, (e?: unknown) => errors.push(e));
    limiter(b.req, b.res, (e?: unknown) => errors.push(e));
    expect(errors).toEqual([undefined, undefined]);
  });
});

// The per-account window, the wait a refused caller is told, the requests
// nobody has identified, and the two paths risks question Q16 added go
// through both real limiters in tests/integration/api.rateLimit.test.ts.

describe("isAiCostPath", () => {
  it("still covers the paths that were already listed", () => {
    for (const path of [
      "/api/search/semantic",
      "/api/search/synthesize",
      "/api/parse-contact",
      "/api/contacts/abc/enrich",
      "/api/contacts/abc/briefing",
      "/api/ai-search",
      "/api/dedupe/backfill-embeddings",
      "/api/link-preview/unfurl",
    ]) {
      expect(isAiCostPath(path), path).toBe(true);
    }
  });

  it("leaves the bulk import out, which Q16 decided on purpose", () => {
    // Rare, already capped at 50 MB, and its AI work runs after the response.
    expect(isAiCostPath("/api/contacts/bulk")).toBe(false);
    expect(isAiCostPath("/api/contacts")).toBe(false);
    expect(isAiCostPath("/api/ai-search/status")).toBe(false);
  });
});
