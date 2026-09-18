// =============================================================================
// Unit Tests — Uploads Guard Middleware
// =============================================================================
// Tests guardUploads in isolation:
// - Instance-visible profile pictures: /u/<uuid>/profile/<file> allowed for
//   any authenticated principal, rejected with NotFoundError without one.
// - Owner-only isolation: /u/<uuid>/avatars/ and /u/<uuid>/files/ allowed only
//   to the owning account, NotFoundError to anyone else.
// - Shared logos: allowed without ownership restrictions.
// - Path traversal: rejected with NotFoundError.
// =============================================================================

import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { guardUploads } from "../../server/middleware/uploads.ts";
import { NotFoundError } from "../../server/utils/AppError.ts";
import type { Principal } from "../../server/middleware/auth.ts";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

function mockPrincipal(userId: string): Principal {
  return {
    kind: "user",
    via: "session",
    sessionId: "test-session",
    user: {
      id: userId,
      email: `${userId}@example.com`,
      username: `user-${userId.slice(0, 8)}`,
      displayName: "Test User",
      role: "member",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLoginAt: null,
      status: "active",
      credentialState: "password",
      mustChangePassword: 0,
      passwordChangedAt: null,
      disabledAt: null,
      createdBy: null,
      avatarUrl: null,
    },
  };
}

function runGuard(path: string, principal?: Principal): Error | undefined {
  const req = {
    path,
    principal,
  } as unknown as Request;
  const res = {} as Response;
  let passedErr: Error | undefined;
  const next: NextFunction = vi.fn((err?: unknown) => {
    if (err instanceof Error) passedErr = err;
  });

  guardUploads(req, res, next);
  expect(next).toHaveBeenCalledTimes(1);
  return passedErr;
}

describe("guardUploads unit tests", () => {
  describe("profile pictures (/u/<uuid>/profile/*)", () => {
    it("allows any authenticated principal to read another user's profile photo", () => {
      const err = runGuard(
        `/u/${OWNER_ID}/profile/profile-12345.jpg`,
        mockPrincipal(OTHER_ID),
      );
      expect(err).toBeUndefined();
    });

    it("allows the owner to read their own profile photo", () => {
      const err = runGuard(
        `/u/${OWNER_ID}/profile/profile-12345.jpg`,
        mockPrincipal(OWNER_ID),
      );
      expect(err).toBeUndefined();
    });

    it("fails with NotFoundError when no principal is present", () => {
      const err = runGuard(`/u/${OWNER_ID}/profile/profile-12345.jpg`);
      expect(err).toBeInstanceOf(NotFoundError);
    });
  });

  describe("owner-only uploads (/u/<uuid>/avatars/* and /u/<uuid>/files/*)", () => {
    it("allows the owner to read their own contact avatar", () => {
      const err = runGuard(
        `/u/${OWNER_ID}/avatars/avatar-123.jpg`,
        mockPrincipal(OWNER_ID),
      );
      expect(err).toBeUndefined();
    });

    it("allows the owner to read their own interaction file", () => {
      const err = runGuard(
        `/u/${OWNER_ID}/files/note.pdf`,
        mockPrincipal(OWNER_ID),
      );
      expect(err).toBeUndefined();
    });

    it("returns NotFoundError when another authenticated user attempts to read avatars/", () => {
      const err = runGuard(
        `/u/${OWNER_ID}/avatars/avatar-123.jpg`,
        mockPrincipal(OTHER_ID),
      );
      expect(err).toBeInstanceOf(NotFoundError);
    });

    it("returns NotFoundError when another authenticated user attempts to read files/", () => {
      const err = runGuard(
        `/u/${OWNER_ID}/files/note.pdf`,
        mockPrincipal(OTHER_ID),
      );
      expect(err).toBeInstanceOf(NotFoundError);
    });

    it("returns NotFoundError for avatars/ when no principal is present", () => {
      const err = runGuard(`/u/${OWNER_ID}/avatars/avatar-123.jpg`);
      expect(err).toBeInstanceOf(NotFoundError);
    });
  });

  describe("shared assets and safety checks", () => {
    it("allows reading company logos without authentication", () => {
      const err = runGuard("/logos/acme.png");
      expect(err).toBeUndefined();
    });

    it("allows reading company logos with authentication", () => {
      const err = runGuard("/logos/acme.png", mockPrincipal(OTHER_ID));
      expect(err).toBeUndefined();
    });

    it("returns NotFoundError on path traversal attempts", () => {
      const err = runGuard(
        `/u/${OTHER_ID}/profile/../../${OWNER_ID}/avatars/secret.jpg`,
        mockPrincipal(OTHER_ID),
      );
      expect(err).toBeInstanceOf(NotFoundError);
    });

    it("returns NotFoundError on encoded path traversal attempts", () => {
      const err = runGuard(
        `/u/${OTHER_ID}/profile/%2e%2e%2f%2e%2e%2f${OWNER_ID}/avatars/secret.jpg`,
        mockPrincipal(OTHER_ID),
      );
      expect(err).toBeInstanceOf(NotFoundError);
    });

    it("returns NotFoundError on invalid percent encoding", () => {
      const err = runGuard("/u/%E0%A4%A", mockPrincipal(OTHER_ID));
      expect(err).toBeInstanceOf(NotFoundError);
    });
  });
});
