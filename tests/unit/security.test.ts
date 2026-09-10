// =============================================================================
// Security utilities — upload path containment, SSRF guards, rate limiting
// =============================================================================

import { describe, it, expect } from "vitest";
import path from "path";
import type { Request, Response } from "express";
import { UPLOADS_DIR, resolveUploadPath } from "../../server/utils/paths.ts";
import { _internal } from "../../server/services/linkPreviewService.ts";
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
// Link preview — private address detection (SSRF guard)
// =============================================================================

describe("isPrivateAddress", () => {
  const { isPrivateAddress } = _internal;

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
  const { assertPublicHttpUrl } = _internal;

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
 * The limiter writes a `Retry-After` header on the request it refuses, so the
 * fake response has to hold headers rather than be an empty object.
 */
function fakeReqRes(
  ip = "10.0.0.1",
  principal?: { user: { id: string } },
): {
  req: Request;
  res: Response;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  return {
    req: { ip, principal } as unknown as Request,
    res: {
      setHeader: (name: string, value: string) => {
        headers[name] = String(value);
      },
      getHeader: (name: string) => headers[name],
    } as unknown as Response,
    headers,
  };
}

describe("createRateLimiter", () => {
  it("allows requests under the limit", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3, name: "t" });
    const { req, res } = fakeReqRes();
    const errors: unknown[] = [];
    for (let i = 0; i < 3; i++)
      limiter(req, res, (e?: unknown) => errors.push(e));
    expect(errors).toEqual([undefined, undefined, undefined]);
  });

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

describe("createRateLimiter — per-account keys and Retry-After", () => {
  it("tells the caller how long to wait", () => {
    // The number, not the header. The error handler is the one place that
    // turns it into `Retry-After`, for every 429 in the app rather than for
    // the two the limiters raise.
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, name: "t" });
    const { req, res } = fakeReqRes();
    limiter(req, res, () => {});
    let refused: unknown;
    limiter(req, res, (e?: unknown) => {
      refused = e;
    });
    expect(refused).toBeInstanceOf(RateLimitedError);
    const seconds = (
      (refused as RateLimitedError).details as { retryAfterSeconds: number }
    ).retryAfterSeconds;
    // A client that sleeps for this and retries must find the window open.
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(60);
  });

  it("gives each account its own window on one address", () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: 1,
      name: "t",
      keyBy: (req) => req.principal?.user.id ?? null,
    });
    const a = fakeReqRes("10.0.0.1", { user: { id: "user-a" } });
    const b = fakeReqRes("10.0.0.1", { user: { id: "user-b" } });

    const errors: unknown[] = [];
    limiter(a.req, a.res, (e?: unknown) => errors.push(e));
    limiter(a.req, a.res, (e?: unknown) => errors.push(e));
    limiter(b.req, b.res, (e?: unknown) => errors.push(e));

    expect(errors[0]).toBeUndefined();
    expect(errors[1]).toBeInstanceOf(RateLimitedError);
    // Same address, different account, still allowed.
    expect(errors[2]).toBeUndefined();
  });

  it("skips a request whose key is null rather than pooling them", () => {
    // A caller nobody has identified has no account to charge. Lumping every
    // such request into one window would let the first anonymous caller of a
    // minute exhaust it for the rest.
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: 1,
      name: "t",
      keyBy: (req) => req.principal?.user.id ?? null,
    });
    const errors: unknown[] = [];
    for (let i = 0; i < 5; i++) {
      const { req, res } = fakeReqRes();
      limiter(req, res, (e?: unknown) => errors.push(e));
    }
    expect(errors).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("isAiCostPath", () => {
  it("covers the two paths risks question Q16 added", () => {
    expect(isAiCostPath("/api/dashboard/insight")).toBe(true);
    expect(isAiCostPath("/api/dedupe/scan")).toBe(true);
  });

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
