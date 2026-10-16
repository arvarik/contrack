/**
 * The redirect address the Integrations row shows is the one the server
 * sends to Google: PUBLIC_URL when it is set, else the browser's own origin.
 * Showing the browser's origin while the server used PUBLIC_URL sent admins
 * to register an address Google would then refuse as a mismatch.
 */
import { describe, expect, it } from "vitest";
import { googleRedirectUri } from "../../../../src/views/settings/admin/GeneralView";

describe("googleRedirectUri", () => {
  it("uses PUBLIC_URL when the server has one, else the browser's origin", () => {
    expect(
      googleRedirectUri("https://crm.example.com", "http://localhost:3210"),
    ).toBe("https://crm.example.com/api/connectors/google/callback");
    expect(googleRedirectUri(null, "http://localhost:3210")).toBe(
      "http://localhost:3210/api/connectors/google/callback",
    );
  });
});
