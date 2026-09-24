/**
 * The corvid's rig.
 *
 * The rig is what lets the one drawing move, so the checks are the promises
 * it makes to everything that draws with it:
 *
 * 1. At rest it is the logo, point for point, and its path data is the
 *    mark's to within a rounding of the handles.
 * 2. The ring is not part of it. Nothing a pose does can move the ring,
 *    because the rig never draws one.
 * 3. The nape is the one new line, hidden in the ring and drawn from the
 *    crown when the bird is out.
 * 4. Turning round is a true mirror, about the neck, so a bird that faces the
 *    other way is the same bird and not a new drawing.
 * 5. Whatever the numbers, it draws finite points, and a wing in any part of
 *    a wingbeat keeps its length and never goes flat.
 * 6. A barrel roll turns the points and not the pen, so the bird edge on is
 *    a line as thick as its strokes.
 */
import { describe, expect, it } from "vitest";
import {
  HOME_POSE,
  NECK,
  POSE_KEYS,
  bodyCentre,
  corvidPathData,
  corvidPose,
  drawCorvid,
  rollDrawing,
  splinePath,
  throughPoints,
  trimPoints,
  type CorvidDrawing,
  type CorvidPose,
  type Vec,
} from "../../src/assets/corvidRig";
import {
  BIRD_PART_ORDER,
  CORVID_EYE,
  CORVID_PATHS,
  parsePath,
} from "../../src/assets/corvidPaths";
import { wingbeat } from "../../src/lib/corvidFlight";
import { createRng } from "../../src/lib/corvidMotion";

const close = (a: Vec, b: Vec, within = 1e-9) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]) <= within;

const allPoints = (pose: CorvidPose): Vec[] => {
  const d = drawCorvid(pose);
  return [
    ...d.head[0],
    ...d.head[1],
    ...d.chest,
    ...d.wing,
    ...d.tail1,
    ...d.tail2,
    ...d.nape,
  ];
};

describe("the rig at rest", () => {
  it("draws the logo's own points, every one of them", () => {
    const d = drawCorvid(HOME_POSE);
    const [crown, jaw] = throughPoints(CORVID_PATHS.head);
    const expectSame = (got: Vec[], want: Vec[]) => {
      expect(got).toHaveLength(want.length);
      got.forEach((p, i) =>
        expect(close(p, want[i]!, 1e-9), `point ${i}`).toBe(true),
      );
    };
    expectSame(d.head[0], crown!);
    expectSame(d.head[1], jaw!);
    expectSame(d.chest, throughPoints(CORVID_PATHS.chest)[0]!);
    expectSame(d.wing, throughPoints(CORVID_PATHS.wing)[0]!);
    expectSame(d.tail1, throughPoints(CORVID_PATHS.tail1)[0]!);
    expectSame(d.tail2, throughPoints(CORVID_PATHS.tail2)[0]!);
    expect(d.eye).toEqual({
      cx: CORVID_EYE.cx,
      cy: CORVID_EYE.cy,
      rx: CORVID_EYE.r,
      ry: CORVID_EYE.r,
    });
  });

  it("writes path data the mark's parser reads, within a tenth or so of the mark", () => {
    const paths = corvidPathData(drawCorvid(HOME_POSE));
    for (const part of BIRD_PART_ORDER) {
      const ours = parsePath(paths[part as keyof typeof paths]).flatMap(
        (c) => c.points,
      );
      const theirs = parsePath(CORVID_PATHS[part]).flatMap((c) => c.points);
      expect(ours, part).toHaveLength(theirs.length);
      // The through points are exact; the handles are recomputed from them
      // and rounded to one decimal, as the mark's were.
      ours.forEach((p, i) =>
        expect(close(p, theirs[i]!, 0.15), `${part} ${i}`).toBe(true),
      );
    }
  });

  it("has no nape while the bird is in its ring", () => {
    expect(drawCorvid(HOME_POSE).nape).toEqual([]);
    expect(corvidPathData(drawCorvid(HOME_POSE)).nape).toBe("");
  });

  it("never draws the ring: the ring is not the bird's", () => {
    const paths = corvidPathData(
      drawCorvid(corvidPose({ flight: 1, nape: 1 })),
    );
    expect(Object.keys(paths).sort()).toEqual([
      "chest",
      "head",
      "nape",
      "tail1",
      "tail2",
      "wing",
    ]);
    expect(Object.values(paths)).not.toContain(CORVID_PATHS.ring);
  });
});

describe("the nape", () => {
  it("starts at the crown's first point and grows with the pose", () => {
    let last = 0;
    for (const nape of [0.2, 0.5, 0.8, 1]) {
      const d = drawCorvid(corvidPose({ nape, headAngle: 7 }));
      expect(close(d.nape[0]!, d.head[0][0]!)).toBe(true);
      const length = d.nape.reduce(
        (sum, p, i) =>
          i === 0
            ? 0
            : sum +
              Math.hypot(p[0] - d.nape[i - 1]![0], p[1] - d.nape[i - 1]![1]),
        0,
      );
      expect(length).toBeGreaterThan(last);
      last = length;
    }
  });

  it("follows the head round when the head turns to look the other way", () => {
    const looking = drawCorvid(corvidPose({ nape: 1, headFacing: -1 }));
    // The crown's first point is now on the far side of the neck, and so is
    // the nape's.
    expect(looking.nape[0]![0]).toBeGreaterThan(NECK[0]);
    expect(close(looking.nape[0]!, looking.head[0][0]!)).toBe(true);
  });
});

describe("turning round", () => {
  it("is the logo mirrored about the neck, head and body together", () => {
    const home = drawCorvid(HOME_POSE);
    const turned = drawCorvid(corvidPose({ bodyFacing: -1, headFacing: -1 }));
    const mirror = ([x, y]: Vec): Vec => [2 * NECK[0] - x, y];
    const pairs: [Vec[], Vec[]][] = [
      [home.head[0], turned.head[0]],
      [home.head[1], turned.head[1]],
      [home.chest, turned.chest],
      [home.wing, turned.wing],
      [home.tail1, turned.tail1],
      [home.tail2, turned.tail2],
    ];
    for (const [a, b] of pairs)
      a.forEach((p, i) => expect(close(mirror(p), b[i]!, 1e-9)).toBe(true));
  });

  it("turns the body under a head that holds still", () => {
    const home = drawCorvid(HOME_POSE);
    const turned = drawCorvid(corvidPose({ bodyFacing: -1 }));
    // The head is where it was; the chest has gone to the other side.
    turned.head[0].forEach((p, i) =>
      expect(close(p, home.head[0][i]!, 1e-9)).toBe(true),
    );
    const chestX = (d: typeof home) =>
      d.chest.reduce((s, p) => s + p[0], 0) / d.chest.length;
    expect(chestX(home)).toBeLessThan(NECK[0]);
    expect(chestX(turned)).toBeGreaterThan(NECK[0]);
  });

  it("holds a sitting bird still by its middle while it turns, and mirrors a flying one", () => {
    // On the perch the body turns about the neck under a still head, so the
    // point the bird is held by does not move.
    expect(bodyCentre({ ...HOME_POSE, bodyFacing: -1 })).toEqual(
      bodyCentre(HOME_POSE),
    );
    // In the air the body's middle goes where the body goes.
    const [x] = bodyCentre({ ...HOME_POSE, flight: 1 });
    const [turnedX] = bodyCentre({ ...HOME_POSE, flight: 1, bodyFacing: -1 });
    expect(turnedX).toBeCloseTo(2 * NECK[0] - x, 9);
  });
});

describe("a barrel roll", () => {
  const flying = drawCorvid(corvidPose({ flight: 1, nape: 1 }));
  const about = bodyCentre(corvidPose({ flight: 1 }))[1];
  const strokes = (d: CorvidDrawing): Vec[][] => [
    d.head[0],
    d.head[1],
    d.chest,
    d.wing,
    d.tail1,
    d.tail2,
    d.nape,
  ];

  it("leaves an upright bird exactly as it is", () => {
    expect(rollDrawing(flying, 1, about)).toBe(flying);
  });

  it("turns the points about the line the flight holds it by, and never moves them along it", () => {
    const upside = rollDrawing(flying, -1, about);
    const edgeOn = rollDrawing(flying, 0, about);
    strokes(flying).forEach((stroke, s) =>
      stroke.forEach(([x, y], i) => {
        expect(close(strokes(upside)[s]![i]!, [x, 2 * about - y])).toBe(true);
        expect(close(strokes(edgeOn)[s]![i]!, [x, about])).toBe(true);
      }),
    );
    expect(upside.eye.cy).toBeCloseTo(2 * about - flying.eye.cy, 9);
    expect(upside.eye.ry).toBeCloseTo(flying.eye.ry, 9);
    expect(edgeOn.eye).toEqual({ ...flying.eye, cy: about, ry: 0 });
  });

  it("draws a stroke-thick line edge on, not a hairline: the pen is not part of it", () => {
    // Every point lies on the line, so a path of them is a line drawn with
    // the mark's own stroke width.
    const paths = corvidPathData(rollDrawing(flying, 0, about));
    for (const [part, d] of Object.entries(paths)) {
      for (const command of parsePath(d))
        for (const [, y] of command.points)
          expect(y, part).toBeCloseTo(about, 1);
    }
  });
});

describe("any pose", () => {
  it("draws finite points for a thousand random poses", () => {
    const rng = createRng(7);
    const ranges: Partial<Record<keyof CorvidPose, [number, number]>> = {
      flight: [0, 1],
      crouch: [-1, 1],
      bodyFacing: [-1, 1],
      nape: [0, 1],
      fluff: [0, 1],
      x: [-10, 10],
      y: [-10, 10],
      headAngle: [-70, 30],
      headFacing: [-1, 1],
      headX: [-10, 12],
      headY: [-4, 14],
      beak: [0, 1],
      eye: [0, 1],
      wingAngle: [-90, 80],
      wingSpread: [0, 1],
      wingCurl: [-1, 1],
      wingTurn: [-1, 1],
      tailAngle: [-10, 10],
    };
    for (let i = 0; i < 1000; i++) {
      const pose = { ...HOME_POSE };
      for (const key of POSE_KEYS) {
        const range = ranges[key];
        if (range) pose[key] = range[0] + (range[1] - range[0]) * rng();
      }
      for (const [x, y] of allPoints(pose)) {
        expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
      }
      const eye = drawCorvid(pose).eye;
      expect(eye.ry).toBeGreaterThan(0);
      expect(eye.rx).toBeGreaterThan(0);
    }
  });

  it("opens and shuts the eye without moving it", () => {
    const open = drawCorvid(HOME_POSE).eye;
    const shut = drawCorvid(corvidPose({ eye: 0 })).eye;
    expect(shut.cx).toBe(open.cx);
    expect(shut.cy).toBe(open.cy);
    expect(shut.ry).toBeLessThan(open.ry / 5);
  });

  it("opens the beak at the tip and leaves the crown alone", () => {
    const shut = drawCorvid(HOME_POSE);
    const open = drawCorvid(corvidPose({ beak: 1 }));
    expect(open.head[0]).toEqual(shut.head[0]);
    // The lower beak's tip drops.
    expect(open.head[1][0]![1]).toBeGreaterThan(shut.head[1][0]![1] + 3);
  });
});

describe("the wing through a wingbeat", () => {
  const shoulderToTip = (pose: CorvidPose) => {
    const wing = drawCorvid(pose).wing;
    const root = wing[10]!;
    return Math.max(
      ...wing.map((p) => Math.hypot(p[0] - root[0], p[1] - root[1])),
    );
  };

  it("keeps its length and never goes flat, whatever the phase", () => {
    const lengths: number[] = [];
    for (let i = 0; i < 40; i++) {
      const beat = wingbeat(i / 40);
      expect(Math.abs(beat.wingTurn)).toBeGreaterThanOrEqual(0.22);
      lengths.push(
        shoulderToTip({
          ...HOME_POSE,
          flight: 1,
          nape: 1,
          headFacing: -1,
          ...beat,
        }),
      );
    }
    const shortest = Math.min(...lengths);
    const longest = Math.max(...lengths);
    expect(shortest / longest).toBeGreaterThan(0.6);
  });

  it("spends longer going down than coming up, and joins up at the top", () => {
    const top = wingbeat(0);
    const again = wingbeat(1);
    expect(again.wingAngle).toBeCloseTo(top.wingAngle, 9);
    // The lowest point of the stroke is at 55 percent.
    const angles = Array.from(
      { length: 101 },
      (_, i) => wingbeat(i / 100).wingAngle,
    );
    const lowest = angles.indexOf(Math.max(...angles));
    expect(lowest).toBe(55);
    expect(Math.min(...angles)).toBe(top.wingAngle);
  });

  it("flips to show the underside on the way down and back on the way up", () => {
    expect(wingbeat(0).wingTurn).toBe(1);
    expect(wingbeat(0.5).wingTurn).toBeLessThan(0);
    expect(wingbeat(0.99).wingTurn).toBeGreaterThan(0.9);
  });
});

describe("helpers", () => {
  it("trims a polyline to a share of its length", () => {
    const line: Vec[] = [
      [0, 0],
      [10, 0],
      [20, 0],
    ];
    expect(trimPoints(line, 0)).toEqual([]);
    expect(trimPoints(line, 1)).toEqual(line);
    expect(trimPoints(line, 0.25)).toEqual([
      [0, 0],
      [5, 0],
    ]);
    expect(trimPoints(line, 0.75)).toEqual([
      [0, 0],
      [10, 0],
      [15, 0],
    ]);
  });

  it("writes a spline the mark's parser reads, and nothing for one point", () => {
    expect(splinePath([[1, 1]])).toBe("");
    const d = splinePath([
      [0, 0],
      [10, 5],
      [20, 0],
    ]);
    expect(parsePath(d).map((c) => c.cmd)).toEqual(["M", "C", "C"]);
  });
});
