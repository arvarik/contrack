// =============================================================================
// GET /api/logos/:domain — one fetch per domain, cached on disk
// =============================================================================
// The browser never loads a logo from Google. The server asks Google's S2
// favicon service once per domain, re-encodes the answer, and serves it from
// disk after that. These tests pin the cache states:
//   - a logo is fetched, re-encoded to PNG within 128 px, and served;
//   - a permanent "no" is written to disk and not asked again for 30 days;
//   - a transient failure is kept in memory for 10 minutes and never on disk;
//   - concurrent requests for one domain make one outbound fetch.
//
// Which failures count as permanent or transient is tested in
// remoteImage.test.ts. The route reads only that label.
//
// The network is stubbed at safeFetch. The route, the helper, sharp and the
// file system are real. LOGOS_DIR sits in this file's temp DATA_DIR.
// =============================================================================

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { safeFetchMock } = vi.hoisted(() => ({ safeFetchMock: vi.fn() }));
vi.mock("../../../../server/utils/urlSafety.ts", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../server/utils/urlSafety.ts")
  >()),
  safeFetch: safeFetchMock,
}));

import fs from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import sharp from "sharp";
import {
  LOGO_MISS_RETRY_MS,
  LOGO_TRANSIENT_BACKOFF_MS,
  logosRouter,
} from "../../../../server/routes/logos.ts";
import { LOGOS_DIR } from "../../../../server/utils/paths.ts";

let app: express.Express;
let png: Buffer;

/** What safeFetch resolves with. A fresh Response each call. */
function served(body: Buffer | string, status = 200) {
  const bytes = typeof body === "string" ? body : new Uint8Array(body);
  return {
    response: new Response(bytes, {
      status,
      headers: { "content-type": "image/png" },
    }),
    finalUrl: "https://www.google.com/s2/favicons",
  };
}

/** A domain no other test uses, so the in-memory backoff never leaks. */
let counter = 0;
const freshDomain = () => `company${++counter}-${Date.now()}.com`;

const logoPath = (domain: string) => path.join(LOGOS_DIR, `${domain}.png`);
const missPath = (domain: string) => path.join(LOGOS_DIR, `${domain}.miss`);

beforeAll(async () => {
  app = express();
  app.use("/api/logos", logosRouter);
  png = await sharp({
    create: {
      width: 256,
      height: 256,
      channels: 4,
      background: { r: 0, g: 120, b: 255, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
});

beforeEach(() => {
  safeFetchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/logos/:domain", () => {
  it("fetches from Google S2 once, stores a 128 px PNG, and serves it", async () => {
    const domain = freshDomain();
    safeFetchMock.mockImplementation(async () => served(png));

    const res = await request(app).get(`/api/logos/${domain}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["cache-control"]).toBe("public, max-age=2592000");

    const [url] = safeFetchMock.mock.calls[0];
    expect(url).toBe(
      `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
    );

    // Re-encoded, not copied: the 256 px source is now 128 px and keeps
    // its alpha channel.
    const meta = await sharp(logoPath(domain)).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(128);
    expect(meta.hasAlpha).toBe(true);

    const again = await request(app).get(`/api/logos/${domain}`);
    expect(again.status).toBe(200);
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
  });

  it("records a permanent miss on disk and does not ask again", async () => {
    const domain = freshDomain();
    safeFetchMock.mockImplementation(async () => served("nope", 404));

    const res = await request(app).get(`/api/logos/${domain}`);
    expect(res.status).toBe(204);
    expect(fs.existsSync(missPath(domain))).toBe(true);
    expect(fs.existsSync(logoPath(domain))).toBe(false);

    const again = await request(app).get(`/api/logos/${domain}`);
    expect(again.status).toBe(204);
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks again once the miss is 30 days old, and clears the marker on success", async () => {
    const domain = freshDomain();
    safeFetchMock.mockImplementationOnce(async () => served("nope", 404));
    await request(app).get(`/api/logos/${domain}`);
    expect(fs.existsSync(missPath(domain))).toBe(true);

    // Only Date is faked, so timers and sockets behave as usual.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + LOGO_MISS_RETRY_MS + 60_000);

    safeFetchMock.mockImplementationOnce(async () => served(png));
    const res = await request(app).get(`/api/logos/${domain}`);
    expect(res.status).toBe(200);
    expect(safeFetchMock).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(missPath(domain))).toBe(false);
    expect(fs.existsSync(logoPath(domain))).toBe(true);
  });

  it("treats a damaged miss marker as expired", async () => {
    const domain = freshDomain();
    fs.writeFileSync(missPath(domain), "not a date");
    safeFetchMock.mockImplementation(async () => served(png));
    const res = await request(app).get(`/api/logos/${domain}`);
    expect(res.status).toBe(200);
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a transient failure in memory only, and retries after the backoff", async () => {
    const domain = freshDomain();
    safeFetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    const res = await request(app).get(`/api/logos/${domain}`);
    expect(res.status).toBe(503);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(fs.existsSync(missPath(domain))).toBe(false);
    expect(fs.existsSync(logoPath(domain))).toBe(false);

    // Inside the backoff: no new request to Google.
    const soon = await request(app).get(`/api/logos/${domain}`);
    expect(soon.status).toBe(503);
    expect(safeFetchMock).toHaveBeenCalledTimes(1);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + LOGO_TRANSIENT_BACKOFF_MS + 1000);

    safeFetchMock.mockImplementationOnce(async () => served(png));
    const later = await request(app).get(`/api/logos/${domain}`);
    expect(later.status).toBe(200);
    expect(safeFetchMock).toHaveBeenCalledTimes(2);
  });

  it("makes one outbound fetch for concurrent requests for one domain", async () => {
    const domain = freshDomain();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    safeFetchMock.mockImplementation(async () => {
      await gate;
      return served(png);
    });

    const server = app.listen(0);
    try {
      const pending = [
        request(server)
          .get(`/api/logos/${domain}`)
          .then((r) => r),
        request(server)
          .get(`/api/logos/${domain}`)
          .then((r) => r),
        request(server)
          .get(`/api/logos/${domain.toUpperCase()}`)
          .then((r) => r),
      ];
      // Every request has to be waiting on the fetch before it resolves.
      await vi.waitFor(() => expect(safeFetchMock).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 100));
      release();
      const responses = await Promise.all(pending);
      expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(safeFetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("refuses a malformed domain without a fetch", async () => {
    for (const bad of ["localhost", "-bad.com", "a_b.com", "..%2F..%2Fetc"]) {
      const res = await request(app).get(`/api/logos/${bad}`);
      expect(res.status, bad).toBe(400);
    }
    expect(safeFetchMock).not.toHaveBeenCalled();
  });
});
