import { describe, it, expect, beforeEach, vi } from "vitest";

vi.unmock("../../server/db.ts");
vi.unmock("../server/db.ts");

import crypto from "node:crypto";
import { sqlite } from "../../server/db.ts";
import {
  createAuthLink,
  redeemAuthLink,
  hashToken,
  RESET_LINK_TTL_SECONDS,
  MAGIC_LINK_TTL_SECONDS,
  ADMIN_RESET_LINK_TTL_SECONDS,
  HOURLY_CREATION_CAP,
} from "../../server/services/authLinkService.ts";
import { AppError } from "../../server/utils/AppError.ts";

describe("authLinkService", () => {
  const testUserId = "test-user-links-" + crypto.randomUUID().slice(0, 8);
  const otherUserId =
    "test-user-links-other-" + crypto.randomUUID().slice(0, 8);
  const adminUserId =
    "test-user-links-admin-" + crypto.randomUUID().slice(0, 8);

  beforeEach(() => {
    // Insert test users if not present
    sqlite
      .prepare(
        `INSERT OR IGNORE INTO users (id, email, username, passwordHash)
         VALUES (?, ?, ?, 'hash')`,
      )
      .run(testUserId, `${testUserId}@example.com`, testUserId);
    sqlite
      .prepare(
        `INSERT OR IGNORE INTO users (id, email, username, passwordHash)
         VALUES (?, ?, ?, 'hash')`,
      )
      .run(otherUserId, `${otherUserId}@example.com`, otherUserId);
    sqlite
      .prepare(
        `INSERT OR IGNORE INTO users (id, email, username, passwordHash)
         VALUES (?, ?, ?, 'hash')`,
      )
      .run(adminUserId, `${adminUserId}@example.com`, adminUserId);

    // Clean up links for test users
    sqlite
      .prepare(`DELETE FROM auth_links WHERE userId IN (?, ?, ?)`)
      .run(testUserId, otherUserId, adminUserId);
  });

  describe("token hashing", () => {
    it("hashes tokens with sha256 hex encoding", () => {
      const token = "fixed-test-token-value-1234567890";
      const expected = crypto.createHash("sha256").update(token).digest("hex");
      expect(hashToken(token)).toBe(expected);
      expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("expiry per kind", () => {
    it("creates reset links with 1-hour expiry", () => {
      const now = Date.now();
      const link = createAuthLink("reset", testUserId, RESET_LINK_TTL_SECONDS);
      expect(link).not.toBeNull();
      const expiresAt = new Date(link!.expiresAt).getTime();
      const diffSeconds = Math.round((expiresAt - now) / 1000);
      expect(diffSeconds).toBeGreaterThanOrEqual(3595);
      expect(diffSeconds).toBeLessThanOrEqual(3605);
    });

    it("creates magic links with 15-minute expiry", () => {
      const now = Date.now();
      const link = createAuthLink("magic", testUserId, MAGIC_LINK_TTL_SECONDS);
      expect(link).not.toBeNull();
      const expiresAt = new Date(link!.expiresAt).getTime();
      const diffSeconds = Math.round((expiresAt - now) / 1000);
      expect(diffSeconds).toBeGreaterThanOrEqual(895);
      expect(diffSeconds).toBeLessThanOrEqual(905);
    });

    it("creates admin reset links with 24-hour expiry", () => {
      const now = Date.now();
      const link = createAuthLink(
        "reset",
        testUserId,
        ADMIN_RESET_LINK_TTL_SECONDS,
        adminUserId,
      );
      expect(link).not.toBeNull();
      const expiresAt = new Date(link!.expiresAt).getTime();
      const diffSeconds = Math.round((expiresAt - now) / 1000);
      expect(diffSeconds).toBeGreaterThanOrEqual(86395);
      expect(diffSeconds).toBeLessThanOrEqual(86405);
    });

    it("refuses expired tokens with 410 LINK_EXPIRED", () => {
      // Create a link that expired 10 seconds ago
      const link = createAuthLink("reset", testUserId, -10);
      expect(link).not.toBeNull();

      try {
        redeemAuthLink("reset", link!.token);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(410);
        expect(appErr.code).toBe("LINK_EXPIRED");
      }
    });
  });

  describe("single use and validation", () => {
    it("redeems valid link once and marks it used", () => {
      const link = createAuthLink("reset", testUserId, RESET_LINK_TTL_SECONDS);
      expect(link).not.toBeNull();

      const redeemed = redeemAuthLink("reset", link!.token);
      expect(redeemed.userId).toBe(testUserId);
      expect(redeemed.kind).toBe("reset");
      expect(redeemed.usedAt).not.toBeNull();

      // Second use throws 410 LINK_USED
      try {
        redeemAuthLink("reset", link!.token);
        expect.unreachable("should have thrown on second use");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(410);
        expect(appErr.code).toBe("LINK_USED");
      }
    });

    it("refuses unknown token with 404 LINK_INVALID", () => {
      try {
        redeemAuthLink("reset", "totally-unknown-token-xyz");
        expect.unreachable("should have thrown for unknown token");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(404);
        expect(appErr.code).toBe("LINK_INVALID");
      }
    });

    it("refuses link when redeemed with the wrong kind", () => {
      const magicLink = createAuthLink(
        "magic",
        testUserId,
        MAGIC_LINK_TTL_SECONDS,
      );
      expect(magicLink).not.toBeNull();

      try {
        redeemAuthLink("reset", magicLink!.token);
        expect.unreachable("should have thrown for wrong kind");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(404);
        expect(appErr.code).toBe("LINK_INVALID");
      }
    });
  });

  describe("hourly creation cap", () => {
    it("enforces cap of 3 creations per hour per account and allows other accounts", () => {
      // Create 3 links for testUserId
      const l1 = createAuthLink("reset", testUserId, RESET_LINK_TTL_SECONDS);
      const l2 = createAuthLink("reset", testUserId, RESET_LINK_TTL_SECONDS);
      const l3 = createAuthLink("magic", testUserId, MAGIC_LINK_TTL_SECONDS);

      expect(l1).not.toBeNull();
      expect(l2).not.toBeNull();
      expect(l3).not.toBeNull();

      // 4th creation returns null
      const l4 = createAuthLink("reset", testUserId, RESET_LINK_TTL_SECONDS);
      expect(l4).toBeNull();

      // otherUserId can still create links
      const otherLink = createAuthLink(
        "reset",
        otherUserId,
        RESET_LINK_TTL_SECONDS,
      );
      expect(otherLink).not.toBeNull();
    });

    it("admin-issued links bypass the self-service hourly cap", () => {
      // Max out testUserId
      for (let i = 0; i < HOURLY_CREATION_CAP; i++) {
        expect(
          createAuthLink("reset", testUserId, RESET_LINK_TTL_SECONDS),
        ).not.toBeNull();
      }
      expect(
        createAuthLink("reset", testUserId, RESET_LINK_TTL_SECONDS),
      ).toBeNull();

      // Admin-issued link succeeds
      const adminLink = createAuthLink(
        "reset",
        testUserId,
        ADMIN_RESET_LINK_TTL_SECONDS,
        adminUserId,
      );
      expect(adminLink).not.toBeNull();
    });
  });
});
