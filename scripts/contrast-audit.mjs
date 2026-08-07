/**
 * contrast-audit — WCAG AA gate for text colour.
 *
 * Static review cannot answer "is this text readable", because the answer
 * depends on what is behind it: a token, its alpha modifier, every ancestor
 * background, and every ancestor opacity, composited. So this drives a real
 * Chrome against a running dev server, walks the live DOM of each route, and
 * computes the true ratio for every visible text node.
 *
 * It exists because the palette shipped for a long time with a primary that
 * measured 2.39:1 at its worst — a defect no amount of reading the CSS would
 * have surfaced.
 *
 * Usage:
 *   npm run dev                       # in another terminal
 *   npm run audit:contrast
 *   npm run audit:contrast -- --url http://127.0.0.1:3210 --routes /,/pulse
 *
 * Exits non-zero when any text fails, so it can gate CI.
 *
 * Notes / limits:
 *   - Only text that is rendered on load is checked. States behind
 *     interaction (open modals, dropdowns, select mode, hover) are not.
 *   - Gradient-filled text is skipped: it is painted by its background, so
 *     its `color` is meaningless.
 *   - Disabled controls are reported separately. WCAG exempts them; an
 *     unreadable label is still worth knowing about.
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 9350;
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const BASE = argOf("url", "http://127.0.0.1:5199");
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), "contrack-contrast-"))}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let page;
for (let i = 0; i < 80 && !page; i++) {
  try {
    page = (
      await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    ).find((t) => t.type === "page");
  } catch {}
  if (!page) await sleep(250);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
});
await new Promise((r) => ws.addEventListener("open", r));
const send = (m, p = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
  });

const AUDIT = String.raw`(() => {
  // Tailwind v4 alpha modifiers compute to oklab(... / a), which no rgb regex
  // will match — so parse every colour by painting it and reading the pixel.
  // That handles rgb/rgba/oklab/oklch/color() uniformly.
  const _cv = document.createElement('canvas'); _cv.width = _cv.height = 1;
  const _ctx = _cv.getContext('2d', { willReadFrequently: true });
  const _cache = new Map();
  const parse = c => {
    if (!c || c === 'transparent') return { r:0, g:0, b:0, a:0 };
    if (_cache.has(c)) return _cache.get(c);
    let v = null;
    try {
      _ctx.clearRect(0, 0, 1, 1);
      _ctx.fillStyle = '#000';
      _ctx.fillStyle = c;
      _ctx.fillRect(0, 0, 1, 1);
      const d = _ctx.getImageData(0, 0, 1, 1).data;
      v = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
    } catch { v = null; }
    _cache.set(c, v);
    return v;
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1,
  });
  const lin = v => { v /= 255; return v <= 0.04045 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
  const lum = c => 0.2126*lin(c.r) + 0.7152*lin(c.g) + 0.0722*lin(c.b);
  const ratio = (a, b) => { const la = lum(a), lb = lum(b); const hi = Math.max(la,lb), lo = Math.min(la,lb); return (hi+0.05)/(lo+0.05); };

  // Composite every ancestor background down to an opaque colour, honouring
  // each ancestor's own element opacity.
  const effectiveBg = el => {
    let acc = { r:255, g:255, b:255, a:1 };
    const chain = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) chain.push(n);
    for (const n of chain.reverse()) {
      const cs = getComputedStyle(n);
      const bg = parse(cs.backgroundColor);
      if (bg && bg.a > 0) acc = over({ ...bg, a: bg.a * parseFloat(cs.opacity) }, acc);
    }
    return acc;
  };
  const inheritedOpacity = el => {
    let o = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity);
    return o;
  };

  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent.trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    // Gradient text is painted by its background, not by the color property,
    // so comparing that color to anything is meaningless.
    if ((cs.webkitBackgroundClip || cs.backgroundClip) === "text") continue;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const op = inheritedOpacity(el);
    if (op < 0.06) continue;                       // decorative, not read
    const fgRaw = parse(cs.color);
    if (!fgRaw) continue;
    const bg = effectiveBg(el);
    const fg = over({ ...fgRaw, a: fgRaw.a * op }, bg);
    const r = ratio(fg, bg);
    const px = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    // WCAG "large text": >=24px, or >=18.66px when bold.
    const large = px >= 24 || (px >= 18.66 && weight >= 700);
    const need = large ? 3.0 : 4.5;
    if (r < need) {
      const disabled = !!el.closest('[disabled], [aria-disabled="true"]');
      out.push({
        ratio: +r.toFixed(2), need, px, weight, disabled,
        fg: cs.color, bgHex: '#' + [bg.r,bg.g,bg.b].map(v => Math.round(v).toString(16).padStart(2,'0')).join(''),
        cls: String(el.className).slice(0, 70),
        text: text.slice(0, 34),
      });
    }
  }
  return JSON.stringify(out);
})()`;

// Default sweep: every top-level route plus every Settings subpage.
const DEFAULT_ROUTES = [
  ["network", "/"],
  ["pulse", "/pulse"],
  ["search", "/search"],
  ["map", "/map"],
  ["settings", "/settings"],
  ["ai-config", "/settings/ai-config"],
  ["enrich", "/settings/ai-search"],
  ["usage", "/settings/ai-stats"],
  ["lists", "/settings/lists"],
  ["dedupe", "/settings/dedupe"],
  ["archived", "/settings/archived"],
  ["trash", "/settings/trash"],
];
/**
 * The contact detail page is the most important one to check and the only one
 * whose URL is not static — and because of that it was silently skipped the
 * first time this ran. It also replaces the entire primary palette with the
 * contact's "vibe" colour, so it is the page most likely to regress. Discover
 * a real id rather than leaving it out.
 */
async function withDetailRoute(routes) {
  try {
    const res = await fetch(`${BASE}/api/contacts?view=slim`);
    const contacts = await res.json();
    if (Array.isArray(contacts) && contacts[0]?.id) {
      return [...routes, ["detail", `/contact/${contacts[0].id}`]];
    }
    console.warn("! no contacts found — skipping the contact detail route");
  } catch {
    console.warn(
      "! could not reach the API — skipping the contact detail route",
    );
  }
  return routes;
}

const routes = argOf("routes", null)
  ? argOf("routes")
      .split(",")
      .map((p) => [p, p])
  : await withDetailRoute(DEFAULT_ROUTES);
const all = [];
for (const [name, path] of routes) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: BASE + path });
  await sleep(4200);
  const res = await send("Runtime.evaluate", {
    expression: AUDIT,
    returnByValue: true,
  });
  const fails = JSON.parse(res.result.value || "[]");
  console.log(
    `${name.padEnd(14)} ${String(fails.length).padStart(3)} failing text elements`,
  );
  for (const f of fails) all.push({ ...f, route: name });
}

console.log("\n──── failures grouped by colour pair ────");
const groups = new Map();
for (const f of all) {
  const key = `${f.fg} on ${f.bgHex}${f.disabled ? "  [disabled]" : ""}`;
  if (!groups.has(key)) groups.set(key, { n: 0, minRatio: 99, samples: [] });
  const g = groups.get(key);
  g.n++;
  g.minRatio = Math.min(g.minRatio, f.ratio);
  if (g.samples.length < 3)
    g.samples.push(`${f.px}px/${f.weight} "${f.text}" [${f.cls.slice(0, 44)}]`);
}
for (const [k, g] of [...groups.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(
    `\n${String(g.n).padStart(3)}×  ${k}   worst ratio ${g.minRatio}`,
  );
  for (const s of g.samples) console.log(`      ${s}`);
}
const blocking = all.filter((f) => !f.disabled);
console.log(
  `\nTOTAL failing text elements: ${all.length}` +
    (all.length !== blocking.length
      ? ` (${all.length - blocking.length} on disabled controls)`
      : ""),
);
ws.close();
chrome.kill();
process.exit(blocking.length > 0 ? 1 : 0);
