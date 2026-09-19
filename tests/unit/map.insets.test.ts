// @vitest-environment jsdom
/**
 * What covers the map, and what the map does about it.
 *
 * The sliver rule first, without a layout: a cover that leaves less than
 * the minimum open is the whole map, and the map centres in all of itself
 * for the moment the cover lifts. Then the measurement, with elements whose
 * sizes are set by hand, because jsdom lays nothing out.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  COVERS_MAP_ATTR,
  MIN_OPEN_PX,
  insetsFor,
  measureInsets,
  paddingFor,
  samePadding,
} from "../../src/views/map/insets";

describe("insetsFor", () => {
  it("takes the contact's width off the right and the bar off the bottom", () => {
    expect(
      insetsFor({
        mapWidth: 1216,
        mapHeight: 720,
        panelWidth: 860,
        barHeight: 0,
      }),
    ).toEqual({ right: 860, bottom: 0 });
    expect(
      insetsFor({
        mapWidth: 390,
        mapHeight: 740,
        panelWidth: 0,
        barHeight: 88,
      }),
    ).toEqual({ right: 0, bottom: 88 });
  });

  it("ignores a cover that leaves only a sliver, or nothing, of the map", () => {
    // A phone: the contact covers the map edge to edge.
    expect(
      insetsFor({
        mapWidth: 390,
        mapHeight: 740,
        panelWidth: 390,
        barHeight: 0,
      }).right,
    ).toBe(0);
    // A narrow tablet: the contact leaves less than the minimum.
    expect(
      insetsFor({
        mapWidth: 760 + MIN_OPEN_PX - 1,
        mapHeight: 720,
        panelWidth: 760,
        barHeight: 0,
      }).right,
    ).toBe(0);
    expect(
      insetsFor({
        mapWidth: 760 + MIN_OPEN_PX,
        mapHeight: 720,
        panelWidth: 760,
        barHeight: 0,
      }).right,
    ).toBe(760);
  });

  it("never reports a negative cover or one larger than the map", () => {
    expect(
      insetsFor({
        mapWidth: 1000,
        mapHeight: 700,
        panelWidth: -5,
        barHeight: -5,
      }),
    ).toEqual({ right: 0, bottom: 0 });
    expect(
      insetsFor({
        mapWidth: 1000,
        mapHeight: 700,
        panelWidth: 5000,
        barHeight: 0,
      }).right,
    ).toBe(0);
  });
});

describe("paddingFor and samePadding", () => {
  it("turns insets into MapLibre's four sides", () => {
    expect(paddingFor({ right: 860, bottom: 88 })).toEqual({
      top: 0,
      right: 860,
      bottom: 88,
      left: 0,
    });
  });

  it("compares all four sides", () => {
    const a = { top: 0, right: 860, bottom: 0, left: 0 };
    expect(samePadding(a, { ...a })).toBe(true);
    expect(samePadding(a, { ...a, bottom: 1 })).toBe(false);
  });
});

/** Give a jsdom element a size and a place, since jsdom lays nothing out. */
function sized(
  element: HTMLElement,
  rect: { x: number; y: number; width: number; height: number },
  offset: { width: number; height: number } = rect,
) {
  element.getBoundingClientRect = () =>
    ({
      x: rect.x,
      y: rect.y,
      top: rect.y,
      left: rect.x,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      width: rect.width,
      height: rect.height,
      toJSON: () => ({}),
    }) as DOMRect;
  Object.defineProperty(element, "offsetWidth", { value: offset.width });
  Object.defineProperty(element, "offsetHeight", { value: offset.height });
  return element;
}

describe("measureInsets", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reads the open contact's width and the bar's overlap", () => {
    const map = sized(document.createElement("div"), {
      x: 64,
      y: 0,
      width: 1216,
      height: 720,
    });
    const panel = document.createElement("section");
    panel.setAttribute(COVERS_MAP_ATTR, "right");
    // Mid-slide: the rect is off to the right, the offset width is not.
    sized(
      panel,
      { x: 900, y: 0, width: 860, height: 720 },
      { width: 860, height: 720 },
    );
    const bar = document.createElement("nav");
    bar.setAttribute(COVERS_MAP_ATTR, "bottom");
    sized(bar, { x: 0, y: 632, width: 1280, height: 88 });
    document.body.append(map, panel, bar);

    expect(measureInsets(map, { contactOpen: true })).toEqual({
      right: 860,
      bottom: 88,
    });
  });

  it("counts the contact only while one is open, and a hidden bar never", () => {
    const map = sized(document.createElement("div"), {
      x: 64,
      y: 0,
      width: 1216,
      height: 720,
    });
    const panel = document.createElement("section");
    panel.setAttribute(COVERS_MAP_ATTR, "right");
    sized(panel, { x: 420, y: 0, width: 860, height: 720 });
    // `md:hidden` on a desktop: no box at all.
    const bar = document.createElement("nav");
    bar.setAttribute(COVERS_MAP_ATTR, "bottom");
    sized(bar, { x: 0, y: 0, width: 0, height: 0 });
    document.body.append(map, panel, bar);

    // The closing contact is still in the document for its exit animation.
    expect(measureInsets(map, { contactOpen: false })).toEqual({
      right: 0,
      bottom: 0,
    });
  });

  it("measures nothing when nothing covers the map", () => {
    const map = sized(document.createElement("div"), {
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
    document.body.append(map);
    expect(measureInsets(map, { contactOpen: true })).toEqual({
      right: 0,
      bottom: 0,
    });
  });

  it("takes the widest open right cover between the insights pane and contact", () => {
    const map = sized(document.createElement("div"), {
      x: 0,
      y: 0,
      width: 1440,
      height: 900,
    });

    const insightsPane = document.createElement("aside");
    insightsPane.setAttribute(COVERS_MAP_ATTR, "right");
    insightsPane.setAttribute("aria-label", "Map insights");
    sized(insightsPane, { x: 1120, y: 0, width: 320, height: 900 });

    const contactPanel = document.createElement("section");
    contactPanel.setAttribute(COVERS_MAP_ATTR, "right");
    sized(contactPanel, { x: 580, y: 0, width: 860, height: 900 });

    document.body.append(map, insightsPane, contactPanel);

    // When contact is open, contact is 860px > insights 320px -> 860px
    expect(measureInsets(map, { contactOpen: true })).toEqual({
      right: 860,
      bottom: 0,
    });

    // When contact is closed, closing contact ignored, insights pane is 320px -> 320px
    expect(measureInsets(map, { contactOpen: false })).toEqual({
      right: 320,
      bottom: 0,
    });
  });
});
