// =============================================================================
// Integration: Account Profile Pictures (/api/auth/me/avatar)
// =============================================================================
// Spec: docs/v2/profile-pictures.md section 6 & 7.
//
// Verifies:
// 1. Uploading a valid image (PNG) normalises through sharp to 512px cover JPEG
//    at quality 82 under uploads/u/<userId>/profile/profile-<timestamp>.jpg.
// 2. Profile photo is visible to its owner (200) and any other signed-in user
//    on the instance (200), but returns 401 without credentials.
// 3. Contact avatars in avatars/ remain strictly owner-only (404 to second account).
// 4. Replacing an avatar deletes the previous file on disk and updates the URL.
// 5. Deleting an avatar deletes the file, sets avatarUrl to null, and is idempotent.
// 6. SVG uploads and non-image bytes fail with 400 VALIDATION_ERROR.
// 7. Files exceeding 10 MB fail with 413 PAYLOAD_TOO_LARGE.
// 8. GET /api/auth/status and GET /api/auth/me carry avatarUrl.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { makeTestApp } from "./helpers.ts";
import { createActor, asUser, type Actor } from "./tenancy/helpers.ts";
import {
  ensureDir,
  ownerUploadDir,
  resolveUploadPath,
} from "../../server/utils/paths.ts";

const app = makeTestApp();

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let userA: Actor;
let userB: Actor;

beforeAll(async () => {
  process.env.AUTH_REQUIRED = "true";
  userA = await createActor(app, {
    username: "alice",
    email: "alice@example.com",
  });
  userB = await createActor(app, { username: "bob", email: "bob@example.com" });
});

afterAll(() => {
  process.env.AUTH_REQUIRED = "";
});

describe("POST /api/auth/me/avatar", () => {
  it("requires a session cookie", async () => {
    const res = await request(app)
      .post("/api/auth/me/avatar")
      .attach("avatar", PNG_1X1, "test.png");
    expect(res.status).toBe(401);
  });

  it("fails with 400 VALIDATION_ERROR when no file is attached", async () => {
    const res = await asUser(userA)(
      request(app).post("/api/auth/me/avatar").send({}),
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("fails with 400 VALIDATION_ERROR for SVG uploads", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="5"/></svg>',
    );
    const res = await asUser(userA)(
      request(app).post("/api/auth/me/avatar").attach("avatar", svg, {
        filename: "avatar.svg",
        contentType: "image/svg+xml",
      }),
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("fails with 400 VALIDATION_ERROR for non-image bytes sent with an image MIME type", async () => {
    const corrupt = Buffer.from("this is plain text pretending to be a png");
    const res = await asUser(userA)(
      request(app).post("/api/auth/me/avatar").attach("avatar", corrupt, {
        filename: "corrupt.png",
        contentType: "image/png",
      }),
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("fails with 413 PAYLOAD_TOO_LARGE for files exceeding 10 MB", async () => {
    const largeBuffer = Buffer.alloc(11 * 1024 * 1024);
    const res = await asUser(userA)(
      request(app).post("/api/auth/me/avatar").attach("avatar", largeBuffer, {
        filename: "too-large.png",
        contentType: "image/png",
      }),
    );
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("normalises a valid photo into JPEG and stores it under uploads/u/<id>/profile/", async () => {
    const res = await asUser(userA)(
      request(app)
        .post("/api/auth/me/avatar")
        .attach("avatar", PNG_1X1, "photo.png"),
    );

    expect(res.status).toBe(200);
    expect(res.body.user.avatarUrl).toMatch(
      new RegExp(`^/uploads/u/${userA.user.id}/profile/profile-\\d+\\.jpg$`),
    );

    const absPath = resolveUploadPath(res.body.user.avatarUrl);
    expect(absPath).not.toBeNull();
    expect(fs.existsSync(absPath!)).toBe(true);

    // Verify JPEG magic bytes: FF D8
    const bytes = fs.readFileSync(absPath!);
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
  });
});

describe("profile photo access permissions and isolation", () => {
  let photoUrl: string;
  let oldDiskPath: string;
  let contactAvatarUrl: string;

  beforeAll(async () => {
    // Ensure userA has an uploaded profile photo
    const res = await asUser(userA)(
      request(app)
        .post("/api/auth/me/avatar")
        .attach("avatar", PNG_1X1, "avatar.png"),
    );
    expect(res.status).toBe(200);
    photoUrl = res.body.user.avatarUrl;
    oldDiskPath = resolveUploadPath(photoUrl)!;

    // Seed a contact avatar in userA's private avatars/ folder
    const avatarsDir = ownerUploadDir(userA.user.id, "avatars");
    ensureDir(avatarsDir);
    const avatarFilename = "contact-face.png";
    fs.writeFileSync(path.join(avatarsDir, avatarFilename), PNG_1X1);
    contactAvatarUrl = `/uploads/u/${userA.user.id}/avatars/${avatarFilename}`;
  });

  it("serves the photo to the owner", async () => {
    const res = await asUser(userA)(request(app).get(photoUrl));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/jpeg");
  });

  it("serves the photo to a second signed-in account (instance-visible)", async () => {
    const res = await asUser(userB)(request(app).get(photoUrl));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/jpeg");
  });

  it("refuses unauthenticated access to the photo with 401", async () => {
    const res = await request(app).get(photoUrl);
    expect(res.status).toBe(401);
  });

  it("answers 404 when the second account attempts to access owner-only avatars/", async () => {
    // Owner can access it
    const ownerRes = await asUser(userA)(request(app).get(contactAvatarUrl));
    expect(ownerRes.status).toBe(200);

    // Other user cannot access it
    const otherRes = await asUser(userB)(request(app).get(contactAvatarUrl));
    expect(otherRes.status).toBe(404);
  });

  it("unlinks previous photo on replace and gives a new URL", async () => {
    expect(fs.existsSync(oldDiskPath)).toBe(true);

    const res = await asUser(userA)(
      request(app)
        .post("/api/auth/me/avatar")
        .attach("avatar", PNG_1X1, "replacement.png"),
    );

    expect(res.status).toBe(200);
    const newUrl = res.body.user.avatarUrl;
    expect(newUrl).toMatch(
      new RegExp(`^/uploads/u/${userA.user.id}/profile/profile-\\d+\\.jpg$`),
    );
    expect(newUrl).not.toBe(photoUrl);

    // Old file on disk must be unlinked
    expect(fs.existsSync(oldDiskPath)).toBe(false);

    // New file on disk must exist
    const newDiskPath = resolveUploadPath(newUrl)!;
    expect(fs.existsSync(newDiskPath)).toBe(true);
  });
});

describe("DELETE /api/auth/me/avatar", () => {
  it("requires a session cookie", async () => {
    const res = await request(app).delete("/api/auth/me/avatar");
    expect(res.status).toBe(401);
  });

  it("unlinks the photo on disk and nulls avatarUrl", async () => {
    // Upload a photo first
    const uploadRes = await asUser(userA)(
      request(app)
        .post("/api/auth/me/avatar")
        .attach("avatar", PNG_1X1, "to-delete.png"),
    );
    expect(uploadRes.status).toBe(200);
    const fileUrl = uploadRes.body.user.avatarUrl;
    const absPath = resolveUploadPath(fileUrl)!;
    expect(fs.existsSync(absPath)).toBe(true);

    // DELETE avatar
    const delRes = await asUser(userA)(
      request(app).delete("/api/auth/me/avatar"),
    );
    expect(delRes.status).toBe(200);
    expect(delRes.body.user.avatarUrl).toBeNull();

    // File on disk must be removed
    expect(fs.existsSync(absPath)).toBe(false);

    // Second DELETE is idempotent (returns 200 with avatarUrl null)
    const delRes2 = await asUser(userA)(
      request(app).delete("/api/auth/me/avatar"),
    );
    expect(delRes2.status).toBe(200);
    expect(delRes2.body.user.avatarUrl).toBeNull();
  });
});

describe("auth endpoints reflect avatarUrl", () => {
  it("GET /api/auth/status and GET /api/auth/me return avatarUrl", async () => {
    // Set a profile photo
    const uploadRes = await asUser(userB)(
      request(app)
        .post("/api/auth/me/avatar")
        .attach("avatar", PNG_1X1, "userb.png"),
    );
    expect(uploadRes.status).toBe(200);
    const expectedUrl = uploadRes.body.user.avatarUrl;

    const meRes = await asUser(userB)(request(app).get("/api/auth/me"));
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.avatarUrl).toBe(expectedUrl);

    const statusRes = await asUser(userB)(request(app).get("/api/auth/status"));
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.user.avatarUrl).toBe(expectedUrl);
  });
});
