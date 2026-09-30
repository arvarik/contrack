// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  KEEP_LIMIT,
  isImageKept,
  keepImage,
} from "../../../../src/lib/keptImages";

describe("keepImage", () => {
  it("holds a picture once it is shown", () => {
    keepImage("/api/avatar/a.svg");
    expect(isImageKept("/api/avatar/a.svg")).toBe(true);
    expect(isImageKept("/api/avatar/never-shown.svg")).toBe(false);
  });

  it("lets the oldest picture go past the limit", () => {
    keepImage("/api/avatar/first.svg");
    for (let i = 0; i < KEEP_LIMIT; i++) keepImage(`/api/avatar/${i}.svg`);
    expect(isImageKept("/api/avatar/first.svg")).toBe(false);
    expect(isImageKept(`/api/avatar/${KEEP_LIMIT - 1}.svg`)).toBe(true);
  });

  it("keeps a picture shown again as the newest", () => {
    keepImage("/api/avatar/again.svg");
    for (let i = 0; i < KEEP_LIMIT - 1; i++) {
      keepImage(`/api/avatar/b${i}.svg`);
      // Shown again on each pass, as a row on screen is.
      if (i % 10 === 0) keepImage("/api/avatar/again.svg");
    }
    keepImage("/api/avatar/last.svg");
    expect(isImageKept("/api/avatar/again.svg")).toBe(true);
  });
});
