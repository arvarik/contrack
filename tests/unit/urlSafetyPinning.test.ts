// =============================================================================
// SSRF guard — the connect-time lookup that closes the rebinding hole
// =============================================================================
// assertPublicHttpUrl resolves a hostname, checks it, and then fetch resolves
// the SAME name again to dial the socket. Two queries, two answers: a hostile
// DNS server passes the check with a public address and serves the connect a
// private one. guardedLookup runs INSIDE the dialing resolver, so the address
// it validates is the address the socket uses.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("dns", () => ({ lookup: lookupMock, default: { lookup: lookupMock } }));

const { guardedLookup } = await import("../../server/utils/urlSafety.ts");

/** Drive guardedLookup and capture what it reports to the socket layer. */
function resolve(
  hostname: string,
): Promise<{ err: NodeJS.ErrnoException | null; address: unknown }> {
  return new Promise((res) => {
    guardedLookup(hostname, {}, (err, address) => res({ err, address }));
  });
}

beforeEach(() => {
  lookupMock.mockReset();
});

describe("guardedLookup", () => {
  it("blocks a name that resolves to a private address", async () => {
    // The rebinding scenario: the check earlier saw a public address, and by
    // connect time the attacker's DNS answers with loopback.
    lookupMock.mockImplementation((_h, _o, cb) => cb(null, "127.0.0.1", 4));
    const { err } = await resolve("rebind.attacker.example");
    expect(err?.code).toBe("ERR_PRIVATE_ADDRESS");
  });

  it.each(["10.0.0.8", "192.168.1.20", "169.254.169.254", "::1"])(
    "blocks %s",
    async (address) => {
      lookupMock.mockImplementation((_h, _o, cb) =>
        cb(null, address, address.includes(":") ? 6 : 4),
      );
      const { err } = await resolve("internal.example");
      expect(err?.code).toBe("ERR_PRIVATE_ADDRESS");
    },
  );

  it("passes a public address through untouched", async () => {
    lookupMock.mockImplementation((_h, _o, cb) => cb(null, "93.184.216.34", 4));
    const { err, address } = await resolve("example.com");
    expect(err).toBeNull();
    expect(address).toBe("93.184.216.34");
  });

  it("propagates resolver failures", async () => {
    const boom: NodeJS.ErrnoException = new Error("ENOTFOUND");
    boom.code = "ENOTFOUND";
    lookupMock.mockImplementation((_h, _o, cb) => cb(boom, ""));
    const { err } = await resolve("nxdomain.example");
    expect(err?.code).toBe("ENOTFOUND");
  });

  it("validates every address of an all:true answer, not just the first", async () => {
    // net asks with all:true and dials its own pick from the set. One clean
    // address in front of a private one must not pass — the socket may
    // choose the private one.
    lookupMock.mockImplementation((_h, _o, cb) =>
      cb(null, [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.8", family: 4 },
      ]),
    );
    const { err } = await resolve("mixed.example");
    expect(err?.code).toBe("ERR_PRIVATE_ADDRESS");
  });

  it("passes a clean all:true answer through in array form", async () => {
    // net reads addresses[0].address — collapsing the array to a string
    // breaks the socket layer (ERR_INVALID_IP_ADDRESS), which is how the
    // first version of this guard failed against a real host.
    const answer = [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ];
    lookupMock.mockImplementation((_h, _o, cb) => cb(null, answer));
    const { err, address } = await resolve("example.com");
    expect(err).toBeNull();
    expect(address).toEqual(answer);
  });
});
