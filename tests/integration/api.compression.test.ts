// =============================================================================
// Integration Tests — response compression
// =============================================================================
// The server compresses an answer with brotli or gzip when the client asks
// for it and the body gains from it (server/middleware/compression.ts). These
// tests read the bytes as they cross the wire, so they see the encoding the
// server chose rather than a body some client already decoded.
//
// The streams (Ask, the progress streams and MCP) have a file of their own,
// api.compression.streams.test.ts, because they need the AI mocks.
// =============================================================================

import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";
import fs from "fs";
import http from "http";
import path from "path";
import zlib from "zlib";
import type { AddressInfo } from "net";
import sharp from "sharp";

const { makeTestApp } = await import("./helpers.ts");
const { localOwnerId } = await import("./tenancy/helpers.ts");
const { contactService } =
  await import("../../server/services/contactService.ts");
const { scopeForOwnerId } = await import("../../server/tenancy/scope.ts");
const { ownerUploadDir, ownerUploadUrl } =
  await import("../../server/utils/paths.ts");
const { COMPRESSION_THRESHOLD_BYTES } =
  await import("../../server/middleware/compression.ts");

const app = makeTestApp();

/** What Chrome and Firefox send over HTTPS. */
const BROWSER = "gzip, deflate, br, zstd";

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  /** The bytes as they crossed the wire, before any decoding. */
  body: Buffer;
}

/**
 * One request with exactly these headers, read as raw bytes.
 *
 * Not supertest: superagent sends `Accept-Encoding: gzip, deflate` on every
 * request and decodes the answer, so it can neither send a request without
 * the header nor show what crossed the wire.
 */
async function raw(
  method: string,
  url: string,
  headers: Record<string, string> = {},
): Promise<RawResponse> {
  if (!app.listening) await new Promise((r) => app.once("listening", r));
  const { port } = app.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path: url, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("error", reject);
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** The body as the client reads it, after the content coding is undone. */
function decoded(res: RawResponse): Buffer {
  const encoding = res.headers["content-encoding"];
  if (encoding === "br") return zlib.brotliDecompressSync(res.body);
  if (encoding === "gzip") return zlib.gunzipSync(res.body);
  if (encoding === undefined) return res.body;
  throw new Error(`Unexpected Content-Encoding: ${encoding}`);
}

/** A real file in the local owner's own upload directory. */
function writeUpload(
  kind: "avatars" | "files",
  name: string,
  body: Buffer | string,
): string {
  const dir = ownerUploadDir(localOwnerId(), kind);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), body);
  return ownerUploadUrl(localOwnerId(), kind, name);
}

const SLIM = "/api/contacts?view=slim";

beforeAll(async () => {
  // A hundred and twenty varied people: a slim list of tens of kilobytes,
  // and a starter pool well past the threshold.
  await contactService.bulkCreateContacts(
    scopeForOwnerId(localOwnerId()),
    Array.from({ length: 120 }, (_, i) => ({
      name: `Person ${i}`,
      industry: `Industry ${String.fromCharCode(65 + (i % 12))}`,
      location: `City ${String.fromCharCode(65 + (i % 11))}, Somewhere`,
      company: `Company ${String.fromCharCode(65 + (i % 10))}`,
      role: `Role ${String.fromCharCode(65 + (i % 9))}`,
      interests: [`Hobby ${String.fromCharCode(65 + (i % 8))}`],
    })),
  );
});

describe("choosing an encoding", () => {
  it("compresses a large JSON answer with brotli, and it decodes to the same bytes", async () => {
    const plain = await raw("GET", SLIM);
    const br = await raw("GET", SLIM, { "Accept-Encoding": "br" });

    expect(plain.status).toBe(200);
    expect(br.status).toBe(200);
    expect(br.headers["content-encoding"]).toBe("br");
    // The length of a compressed body is not known until it is written.
    expect(br.headers["content-length"]).toBeUndefined();
    expect(decoded(br).equals(plain.body)).toBe(true);
    expect(br.body.length).toBeLessThan(plain.body.length / 4);
    expect(JSON.parse(decoded(br).toString())).toHaveLength(120);
  });

  it("compresses with gzip for a client that takes only gzip", async () => {
    const plain = await raw("GET", SLIM);
    const gzip = await raw("GET", SLIM, { "Accept-Encoding": "gzip" });

    expect(gzip.headers["content-encoding"]).toBe("gzip");
    expect(decoded(gzip).equals(plain.body)).toBe(true);
    expect(gzip.body.length).toBeLessThan(plain.body.length / 4);
  });

  it("prefers brotli when the client takes both, as a browser does", async () => {
    const res = await raw("GET", SLIM, { "Accept-Encoding": BROWSER });

    expect(res.headers["content-encoding"]).toBe("br");
  });

  it("follows the client's own preference", async () => {
    // A client that refuses brotli outright gets gzip.
    const res = await raw("GET", SLIM, { "Accept-Encoding": "br;q=0, gzip" });

    expect(res.headers["content-encoding"]).toBe("gzip");
  });

  it("sends the body as it is to a client that asks for no encoding the server has", async () => {
    const plain = await raw("GET", SLIM);

    // No header at all, a plain `identity`, and zstd alone, which the server
    // does not write.
    const requests: Array<Record<string, string>> = [
      {},
      { "Accept-Encoding": "identity" },
      { "Accept-Encoding": "zstd" },
    ];
    for (const headers of requests) {
      const res = await raw("GET", SLIM, headers);
      expect(res.headers["content-encoding"]).toBeUndefined();
      expect(res.headers["content-length"]).toBe(String(plain.body.length));
      expect(res.body.equals(plain.body)).toBe(true);
    }
  });

  it("says Vary: Accept-Encoding on every variant, so a cache keeps them apart", async () => {
    // A cache that stored the brotli answer and handed it to a client that
    // cannot read brotli would show that client garbage. Vary is what stops
    // it, and it belongs on the uncompressed variant as much as on the others.
    const requests: Array<Record<string, string>> = [
      {},
      { "Accept-Encoding": "gzip" },
      { "Accept-Encoding": "br" },
    ];
    for (const headers of requests) {
      const res = await raw("GET", SLIM, headers);
      expect(res.headers.vary).toMatch(/\bAccept-Encoding\b/i);
    }
  });

  it("keeps the security headers and the request id on a compressed answer", async () => {
    const res = await raw("GET", SLIM, { "Accept-Encoding": "br" });

    expect(res.headers["content-encoding"]).toBe("br");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["content-security-policy"]).toContain(
      "default-src 'self'",
    );
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("what goes out as it is", () => {
  it("leaves an answer under the threshold alone", async () => {
    for (const url of ["/healthz", "/api/auth/status"]) {
      const res = await raw("GET", url, { "Accept-Encoding": BROWSER });

      expect(res.status).toBe(200);
      expect(res.body.length).toBeLessThan(COMPRESSION_THRESHOLD_BYTES);
      expect(res.headers["content-encoding"]).toBeUndefined();
      expect(res.headers["content-length"]).toBe(String(res.body.length));
      expect(() => JSON.parse(res.body.toString())).not.toThrow();
    }
  });

  it("does not compress a photo again", async () => {
    // Real images of random pixels, so each is far over the threshold and
    // none would shrink by more than a few bytes if it were compressed.
    const width = 96;
    const height = 96;
    const pixels = crypto.randomBytes(width * height * 3);
    const image = sharp(pixels, { raw: { width, height, channels: 3 } });
    const photos: Array<[string, Buffer]> = [
      ["photo.png", await image.clone().png().toBuffer()],
      ["photo.jpg", await image.clone().jpeg().toBuffer()],
      ["photo.webp", await image.clone().webp().toBuffer()],
      ["photo.avif", await image.clone().avif().toBuffer()],
    ];

    for (const [name, bytes] of photos) {
      expect(bytes.length).toBeGreaterThan(COMPRESSION_THRESHOLD_BYTES);
      const url = writeUpload("avatars", name, bytes);

      const res = await raw("GET", url, { "Accept-Encoding": BROWSER });

      expect(res.status, name).toBe(200);
      expect(res.headers["content-type"], name).toMatch(/^image\//);
      expect(res.headers["content-encoding"], name).toBeUndefined();
      expect(res.headers["content-length"], name).toBe(String(bytes.length));
      expect(res.body.equals(bytes), name).toBe(true);
    }
  });

  it("compresses an SVG avatar, which is text", async () => {
    // The other side of the photo rule: it goes by the type, and an SVG is
    // XML. The avatar route draws one per contact name.
    const url = "/api/avatar/avataaars?seed=Ada%20Lovelace";
    const plain = await raw("GET", url);
    const br = await raw("GET", url, { "Accept-Encoding": BROWSER });

    expect(plain.headers["content-type"]).toMatch(/^image\/svg\+xml/);
    expect(plain.body.length).toBeGreaterThan(COMPRESSION_THRESHOLD_BYTES);
    expect(br.headers["content-encoding"]).toBe("br");
    expect(decoded(br).equals(plain.body)).toBe(true);
    // The day-long caching the avatar route sets is untouched.
    expect(br.headers["cache-control"]).toBe(plain.headers["cache-control"]);
  });

  it("answers a byte range of an attachment with the bytes as stored", async () => {
    // A text attachment compresses well, so the whole file goes out
    // compressed. A range of it cannot: Content-Range counts the stored
    // bytes, and a resumed download would come out corrupt.
    const text = "A line of a long text attachment.\n".repeat(600);
    const url = writeUpload("files", "notes.txt", text);

    const whole = await raw("GET", url, { "Accept-Encoding": BROWSER });
    expect(whole.headers["content-encoding"]).toBe("br");
    expect(decoded(whole).toString()).toBe(text);

    const part = await raw("GET", url, {
      "Accept-Encoding": BROWSER,
      Range: "bytes=1000-5999",
    });
    expect(part.status).toBe(206);
    expect(part.headers["content-range"]).toBe(
      `bytes 1000-5999/${Buffer.byteLength(text)}`,
    );
    expect(part.headers["content-encoding"]).toBeUndefined();
    expect(part.headers["content-length"]).toBe("5000");
    expect(part.body.toString()).toBe(text.slice(1000, 6000));
  });
});

describe("conditional requests, HEAD, errors and no-store", () => {
  it("revalidates the compressed starter pool with a 304", async () => {
    const url = "/api/search/starters";
    const first = await raw("GET", url, { "Accept-Encoding": "br" });
    expect(first.status).toBe(200);
    expect(first.headers["content-encoding"]).toBe("br");
    expect(
      JSON.parse(decoded(first).toString()).questions.length,
    ).toBeGreaterThan(10);

    // Express takes the ETag from the body before it is compressed, and it is
    // weak, so it is the same for every encoding of the same pool. A browser
    // that revalidates gets its 304 whichever encoding it asks for.
    const etag = first.headers.etag;
    expect(etag).toMatch(/^W\//);
    expect((await raw("GET", url)).headers.etag).toBe(etag);
    expect(
      (await raw("GET", url, { "Accept-Encoding": "gzip" })).headers.etag,
    ).toBe(etag);

    for (const encoding of ["br", "gzip", "identity"]) {
      const again = await raw("GET", url, {
        "Accept-Encoding": encoding,
        "If-None-Match": etag!,
      });
      expect(again.status, encoding).toBe(304);
      expect(again.body.length, encoding).toBe(0);
      expect(again.headers["content-encoding"], encoding).toBeUndefined();
      expect(again.headers.etag, encoding).toBe(etag);
    }
  });

  it("revalidates a compressed file from the static server with a 304", async () => {
    // express.static serves the uploads here and dist/ in production, with
    // its own ETag and Last-Modified.
    const url = writeUpload(
      "files",
      "revalidate.txt",
      "Some text. ".repeat(400),
    );
    const first = await raw("GET", url, { "Accept-Encoding": BROWSER });
    expect(first.headers["content-encoding"]).toBe("br");
    expect(first.headers.etag).toBeDefined();

    const byTag = await raw("GET", url, {
      "Accept-Encoding": BROWSER,
      "If-None-Match": first.headers.etag!,
    });
    expect(byTag.status).toBe(304);
    expect(byTag.body.length).toBe(0);

    const byDate = await raw("GET", url, {
      "Accept-Encoding": BROWSER,
      "If-Modified-Since": first.headers["last-modified"]!,
    });
    expect(byDate.status).toBe(304);
  });

  it("answers HEAD with the plain length, no body and no encoding", async () => {
    const plain = await raw("GET", SLIM);
    const head = await raw("HEAD", SLIM, { "Accept-Encoding": BROWSER });

    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
    expect(head.headers["content-encoding"]).toBeUndefined();
    expect(head.headers["content-length"]).toBe(String(plain.body.length));
    expect(head.headers.vary).toMatch(/\bAccept-Encoding\b/i);

    const health = await raw("HEAD", "/healthz", {
      "Accept-Encoding": BROWSER,
    });
    expect(health.status).toBe(200);
    expect(health.body.length).toBe(0);
  });

  it("keeps error answers readable", async () => {
    // Outside production the envelope carries the stack, which can take it
    // over the threshold, so either encoding may come back. Both must read.
    for (const [url, code] of [
      [`/api/contacts/${crypto.randomUUID()}`, "NOT_FOUND"],
      ["/api/no-such-route", "ROUTE_NOT_FOUND"],
    ]) {
      const res = await raw("GET", url, { "Accept-Encoding": BROWSER });

      expect(res.status, url).toBe(404);
      expect(res.headers["content-type"], url).toMatch(/^application\/json/);
      expect(JSON.parse(decoded(res).toString()).error.code, url).toBe(code);
    }
  });

  it("compresses a whole-account export and keeps it out of every cache", async () => {
    const res = await raw("GET", "/api/export/json", {
      "Accept-Encoding": BROWSER,
    });

    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("br");
    expect(res.headers["cache-control"]).toBe(
      "no-store, no-cache, must-revalidate",
    );
    expect(res.headers["content-disposition"]).toMatch(/^attachment/);
    const exported = JSON.parse(decoded(res).toString());
    expect(exported.contacts).toHaveLength(120);
  });
});
