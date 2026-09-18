import { describe, it, expect } from "vitest";
import { suggestUsername } from "../../src/components/auth/accountForm";

describe("suggestUsername", () => {
  it("returns empty string for empty or missing input", () => {
    expect(suggestUsername("")).toBe("");
  });

  it("extracts the local part of an email", () => {
    expect(suggestUsername("ada@example.com")).toBe("ada");
    expect(suggestUsername("marcus.aurelius@rome.org")).toBe("marcus.aurelius");
  });

  it("lowercases the result", () => {
    expect(suggestUsername("Grace.Hopper@Navy.Mil")).toBe("grace.hopper");
    expect(suggestUsername("ALAN_TURING@cambridge.ac.uk")).toBe("alan_turing");
  });

  it("replaces characters outside USERNAME_PATTERN with dot", () => {
    expect(suggestUsername("ada+newsletter@example.com")).toBe(
      "ada.newsletter",
    );
    expect(suggestUsername("user$name!test@example.com")).toBe(
      "user.name.test",
    );
  });

  it("collapses consecutive dots", () => {
    expect(suggestUsername("user...name@domain.com")).toBe("user.name");
    expect(suggestUsername("user+++test@domain.com")).toBe("user.test");
    expect(suggestUsername("a..b..c@domain.com")).toBe("a.b.c");
  });

  it("trims non-alphanumeric characters from the start and end", () => {
    expect(suggestUsername(".username.@domain.com")).toBe("username");
    expect(suggestUsername("-username-@domain.com")).toBe("username");
    expect(suggestUsername("_username_@domain.com")).toBe("username");
    expect(suggestUsername("...+test+...@domain.com")).toBe("test");
  });

  it("clips to 32 characters and ensures clean boundaries", () => {
    const longLocal = "a".repeat(40) + "@domain.com";
    const suggested = suggestUsername(longLocal);
    expect(suggested.length).toBeLessThanOrEqual(32);
    expect(suggested).toBe("a".repeat(32));

    // When clipping cuts right after a dot/dash, trailing non-alphanumeric is trimmed
    const withDotAt32 = "a".repeat(31) + ".-b@domain.com";
    const clippedDot = suggestUsername(withDotAt32);
    expect(clippedDot.length).toBeLessThanOrEqual(32);
    expect(/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(clippedDot)).toBe(true);
  });

  it("handles string without at sign", () => {
    expect(suggestUsername("plainusername")).toBe("plainusername");
    expect(suggestUsername("Plain+Username")).toBe("plain.username");
  });
});
