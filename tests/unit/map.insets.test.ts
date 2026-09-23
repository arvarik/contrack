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
  clearBounds,
  insetsFor,
  measureInsets,
  measureOpenWidth,
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

describe("a map beside the insights rail", () => {
  // From lg the map ends at the insights rail, 64 px short of the window,
  // and the contact runs to the window's edge, over the rail. Its width
  // covered 64 px of map that is not there, and the pin sat left of centre.
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const layout = () => {
    const app = sized(document.createElement("div"), {
      x: 0,
      y: 0,
      width: 1440,
      height: 900,
    });
    const map = sized(document.createElement("div"), {
      x: 64,
      y: 0,
      width: 1312,
      height: 900,
    });
    const contact = document.createElement("section");
    contact.setAttribute(COVERS_MAP_ATTR, "right");
    // Mid-slide: the rect is off to the right, the layout box is not.
    sized(
      contact,
      { x: 1400, y: 0, width: 860, height: 900 },
      { width: 860, height: 900 },
    );
    Object.defineProperty(contact, "offsetParent", { value: app });
    Object.defineProperty(contact, "offsetLeft", { value: 580 });
    app.append(map, contact);
    document.body.append(app);
    return { app, map };
  };

  it("counts the part of the contact over the map", () => {
    const { map } = layout();
    expect(measureInsets(map, { contactOpen: true }).right).toBe(796);
    expect(measureOpenWidth(map)).toBe(516);
  });

  it("counts the insights panel only while it is open", () => {
    const { app, map } = layout();
    const panel = document.createElement("aside");
    panel.setAttribute("aria-label", "Map insights");
    sized(panel, { x: 1056, y: 0, width: 320, height: 900 });
    Object.defineProperty(panel, "offsetParent", { value: app });
    Object.defineProperty(panel, "offsetLeft", { value: 1056 });
    app.append(panel);
    // Closed, it carries no cover and the map keeps its width.
    expect(measureInsets(map, { contactOpen: false }).right).toBe(0);
    panel.setAttribute(COVERS_MAP_ATTR, "right");
    expect(measureInsets(map, { contactOpen: false }).right).toBe(320);
    // It is not a contact: the toolbar keeps the whole map.
    app.querySelector("section")?.remove();
    expect(measureOpenWidth(map)).toBeNull();
  });
});

describe("measureOpenWidth", () => {
  // The map's toolbar and its bottom-left corner keep to the map an open
  // contact leaves. The contact started at x 580 at 1440 px and covered the
  // end of the toolbar, and at 1024 px it left 100 px.
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const page = (width: number) =>
    sized(document.createElement("div"), { x: 64, y: 0, width, height: 900 });
  const cover = (width: number, label?: string) => {
    const panel = document.createElement(label ? "aside" : "section");
    panel.setAttribute(COVERS_MAP_ATTR, "right");
    if (label) panel.setAttribute("aria-label", label);
    // Mid-slide: the rect is off to the right, the offset width is not.
    return sized(
      panel,
      { x: 2000, y: 0, width, height: 900 },
      { width, height: 900 },
    );
  };

  it("is the page's width less the open contact's", () => {
    const map = page(1376);
    document.body.append(map, cover(860));
    expect(measureOpenWidth(map)).toBe(516);
  });

  it("leaves out the insights pane, which is not a contact", () => {
    const map = page(1376);
    document.body.append(map, cover(320, "Map insights"));
    expect(measureOpenWidth(map)).toBeNull();
    document.body.append(cover(860));
    expect(measureOpenWidth(map)).toBe(516);
  });

  it("is null with no contact, and never below zero", () => {
    const map = page(960);
    document.body.append(map);
    expect(measureOpenWidth(map)).toBeNull();
    document.body.append(cover(1200));
    expect(measureOpenWidth(map)).toBe(0);
    // 1024 px: the sliver the toolbar steps aside for.
    document.body.innerHTML = "";
    const narrow = page(960);
    document.body.append(narrow, cover(860));
    expect(measureOpenWidth(narrow)).toBe(100);
    expect(measureOpenWidth(narrow)!).toBeLessThan(MIN_OPEN_PX);
  });
});

describe("clearBounds", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  /** A map that unprojects a pixel linearly: 1 px is 0.25 degree. */
  const fakeMap = (container: HTMLElement) => ({
    getContainer: () => container,
    unproject: ([x, y]: [number, number]) => ({
      lng: -180 + x * 0.25,
      lat: 90 - y * 0.25,
    }),
  });

  const mapOf = (width: number, height: number) => {
    const el = sized(document.createElement("div"), {
      x: 64,
      y: 0,
      width,
      height,
    });
    Object.defineProperty(el, "clientWidth", { value: width });
    Object.defineProperty(el, "clientHeight", { value: height });
    return el;
  };

  it("leaves the open insights panel's part of the map out of view", () => {
    const map = mapOf(1312, 720);
    const panel = document.createElement("aside");
    panel.setAttribute(COVERS_MAP_ATTR, "right");
    panel.setAttribute("aria-label", "Map insights");
    sized(panel, { x: 1056, y: 0, width: 320, height: 720 });
    document.body.append(map, panel);
    // 1312 - 320 = 992 px clear: 248 degrees from the west edge.
    expect(clearBounds(fakeMap(map), { contactOpen: false })).toEqual([
      -180, -90, 68, 90,
    ]);
  });

  it("is the whole map when nothing covers it", () => {
    const map = mapOf(1312, 720);
    document.body.append(map);
    expect(clearBounds(fakeMap(map), { contactOpen: false })).toEqual([
      -180, -90, 148, 90,
    ]);
  });
});
