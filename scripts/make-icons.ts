// Renders desktop/icon.svg into the icon files the installers need, with no external tools:
//   desktop/icon.ico       Windows (setup wizard, shortcuts, Apps & Features), 16 to 256 px
//   desktop/icon.iconset/  macOS app icon (Electrobun runs iconutil on it), 16 to 1024 px
// Run it after changing icon.svg:  bun scripts/make-icons.ts
// The rasterizer supports what icon.svg uses: one <rect> with rx, and <path> elements made of
// absolute M, L, H, V, C and Z commands, filled or stroked with round caps and joins.
import { deflateSync } from "node:zlib";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SVG = join(ROOT, "desktop", "icon.svg");
const ICO = join(ROOT, "desktop", "icon.ico");
const ICONSET = join(ROOT, "desktop", "icon.iconset");
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;
const ICONSET_SIZES = [16, 32, 128, 256, 512] as const;
// macOS icons sit inside a margin: Apple's grid draws the body at 824 of 1024 px.
const MAC_BODY = 824 / 1024;

type Point = { x: number; y: number };
type Rgba = [number, number, number, number];
type Shape =
  | { kind: "rect"; w: number; h: number; r: number; color: Rgba }
  | { kind: "fill"; polygons: Point[][]; color: Rgba }
  | { kind: "stroke"; lines: Point[][]; half: number; color: Rgba };
type Icon = { viewBox: number; shapes: Shape[] };

// O(1)
function parseColor(hex: string): Rgba {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) throw new Error(`unsupported color: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

// O(n) in attribute text
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w-]+)="([^"]*)"/g)) if (m[1] && m[2] !== undefined) out[m[1]] = m[2];
  return out;
}

// O(n) in path length. Cubic curves are flattened into 24 segments each.
function parsePath(d: string): { lines: Point[][]; closed: boolean[] } {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const lines: Point[][] = [];
  const closed: boolean[] = [];
  let current: Point[] = [];
  let at: Point = { x: 0, y: 0 };
  let start: Point = at;
  let command = "";
  let i = 0;
  const num = (): number => {
    const token = tokens[i++];
    if (token === undefined || Number.isNaN(Number(token))) throw new Error(`bad number in path: ${d}`);
    return Number(token);
  };
  const finish = (isClosed: boolean): void => {
    if (current.length > 1) { lines.push(current); closed.push(isClosed); }
    current = [];
  };
  while (i < tokens.length) {
    const token = tokens[i] ?? "";
    if (/[A-Za-z]/.test(token)) { command = token; i++; }
    switch (command) {
      case "M": finish(false); at = { x: num(), y: num() }; start = at; current = [at]; command = "L"; break;
      case "L": at = { x: num(), y: num() }; current.push(at); break;
      case "H": at = { x: num(), y: at.y }; current.push(at); break;
      case "V": at = { x: at.x, y: num() }; current.push(at); break;
      case "C": {
        const p0 = at, p1 = { x: num(), y: num() }, p2 = { x: num(), y: num() }, p3 = { x: num(), y: num() };
        for (let s = 1; s <= 24; s++) {
          const t = s / 24, u = 1 - t;
          current.push({
            x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
            y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
          });
        }
        at = p3;
        break;
      }
      case "Z": case "z": current.push(start); at = start; finish(true); current = [start]; command = ""; break;
      default: throw new Error(`unsupported path command "${command}" in ${SVG}`);
    }
  }
  finish(false);
  return { lines, closed };
}

// O(n) in SVG size
function parseSvg(text: string): Icon {
  const viewBox = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(text);
  if (!viewBox?.[1] || viewBox[1] !== viewBox[2]) throw new Error("icon.svg needs a square viewBox starting at 0 0");
  const shapes: Shape[] = [];
  for (const m of text.matchAll(/<(rect|path)\b([^>]*)\/?>/g)) {
    const a = attrs(m[2] ?? "");
    if (m[1] === "rect") {
      if (!a.fill) throw new Error("rect needs a fill");
      shapes.push({ kind: "rect", w: Number(a.width), h: Number(a.height), r: Number(a.rx ?? 0), color: parseColor(a.fill) });
      continue;
    }
    const { lines } = parsePath(a.d ?? "");
    if (a.fill && a.fill !== "none") shapes.push({ kind: "fill", polygons: lines, color: parseColor(a.fill) });
    if (a.stroke && a.stroke !== "none") {
      if ((a["stroke-linecap"] ?? "round") !== "round") throw new Error("only round line caps are supported");
      shapes.push({ kind: "stroke", lines, half: Number(a["stroke-width"] ?? 1) / 2, color: parseColor(a.stroke) });
    }
  }
  return { viewBox: Number(viewBox[1]), shapes };
}

// O(1)
function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// O(n) in polygon points. Signed distance: negative inside (even-odd rule).
function polygonDistance(p: Point, polygons: Point[][]): number {
  let best = Infinity;
  let inside = false;
  for (const poly of polygons) {
    for (let k = 0, j = poly.length - 1; k < poly.length; j = k++) {
      const a = poly[j] as Point, b = poly[k] as Point;
      best = Math.min(best, segmentDistance(p, a, b));
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside ? -best : best;
}

// O(1). Signed distance to a rounded rectangle at the origin.
function roundedRectDistance(p: Point, w: number, h: number, r: number): number {
  const qx = Math.abs(p.x - w / 2) - (w / 2 - r);
  const qy = Math.abs(p.y - h / 2) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// O(1)
function shapeDistance(shape: Shape, p: Point): number {
  if (shape.kind === "rect") return roundedRectDistance(p, shape.w, shape.h, shape.r);
  if (shape.kind === "fill") return polygonDistance(p, shape.polygons);
  let best = Infinity;
  for (const line of shape.lines) for (let k = 1; k < line.length; k++) best = Math.min(best, segmentDistance(p, line[k - 1] as Point, line[k] as Point));
  return best - shape.half;
}

// O(size^2 * path points). body is the fraction of the canvas the artwork fills, centered.
function render(icon: Icon, size: number, body = 1): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  const unitsPerPixel = icon.viewBox / (size * body);
  const offset = (size * (1 - body)) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = { x: (x + 0.5 - offset) * unitsPerPixel, y: (y + 0.5 - offset) * unitsPerPixel };
      let r = 0, g = 0, b = 0, a = 0; // premultiplied, 0..1
      for (const shape of icon.shapes) {
        const coverage = Math.max(0, Math.min(1, 0.5 - shapeDistance(shape, p) / unitsPerPixel));
        if (coverage === 0) continue;
        const sa = (coverage * shape.color[3]) / 255;
        r = (shape.color[0] / 255) * sa + r * (1 - sa);
        g = (shape.color[1] / 255) * sa + g * (1 - sa);
        b = (shape.color[2] / 255) * sa + b * (1 - sa);
        a = sa + a * (1 - sa);
      }
      const o = (y * size + x) * 4;
      if (a > 0) {
        pixels[o] = Math.round((r / a) * 255);
        pixels[o + 1] = Math.round((g / a) * 255);
        pixels[o + 2] = Math.round((b / a) * 255);
        pixels[o + 3] = Math.round(a * 255);
      }
    }
  }
  return pixels;
}

// O(n)
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, Bun.hash.crc32(out.subarray(4, 8 + data.length)));
  return out;
}

// O(size^2)
function encodePng(pixels: Uint8Array, size: number): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  const raw = new Uint8Array(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) raw.set(pixels.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);
  return Buffer.concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

// O(size^2). Classic 32-bit DIB with an AND mask, which every ICO reader accepts.
function encodeDib(pixels: Uint8Array, size: number): Uint8Array {
  const maskRow = Math.ceil(size / 32) * 4;
  const out = new Uint8Array(40 + size * size * 4 + maskRow * size);
  const view = new DataView(out.buffer);
  view.setUint32(0, 40, true);
  view.setInt32(4, size, true);
  view.setInt32(8, size * 2, true); // color rows plus mask rows
  view.setUint16(12, 1, true);
  view.setUint16(14, 32, true);
  view.setUint32(20, size * size * 4 + maskRow * size, true);
  for (let y = 0; y < size; y++) {
    const row = size - 1 - y; // bottom-up
    for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4, d = 40 + (row * size + x) * 4;
      out[d] = pixels[s + 2] ?? 0; out[d + 1] = pixels[s + 1] ?? 0; out[d + 2] = pixels[s] ?? 0; out[d + 3] = pixels[s + 3] ?? 0;
      if ((pixels[s + 3] ?? 0) === 0) {
        const m = 40 + size * size * 4 + row * maskRow + (x >> 3);
        out[m] = (out[m] ?? 0) | (0x80 >> (x & 7));
      }
    }
  }
  return out;
}

// O(n) in image bytes. 256 px is stored as PNG, smaller sizes as DIB.
function encodeIco(icon: Icon): Uint8Array {
  const images = ICO_SIZES.map((size) => {
    const pixels = render(icon, size);
    return { size, bytes: size >= 256 ? encodePng(pixels, size) : encodeDib(pixels, size) };
  });
  const header = new Uint8Array(6 + 16 * images.length);
  const view = new DataView(header.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, images.length, true);
  let offset = header.length;
  images.forEach((image, k) => {
    const e = 6 + 16 * k;
    header[e] = image.size >= 256 ? 0 : image.size;
    header[e + 1] = image.size >= 256 ? 0 : image.size;
    view.setUint16(e + 4, 1, true);
    view.setUint16(e + 6, 32, true);
    view.setUint32(e + 8, image.bytes.length, true);
    view.setUint32(e + 12, offset, true);
    offset += image.bytes.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.bytes)]);
}

// O(total pixels)
async function makeIcons(): Promise<void> {
  const icon = parseSvg(await Bun.file(SVG).text());
  await Bun.write(ICO, encodeIco(icon));
  console.log(`wrote ${ICO}`);
  await rm(ICONSET, { recursive: true, force: true });
  await mkdir(ICONSET, { recursive: true });
  for (const size of ICONSET_SIZES) {
    await Bun.write(join(ICONSET, `icon_${size}x${size}.png`), encodePng(render(icon, size, MAC_BODY), size));
    await Bun.write(join(ICONSET, `icon_${size}x${size}@2x.png`), encodePng(render(icon, size * 2, MAC_BODY), size * 2));
  }
  console.log(`wrote ${ICONSET}/ (${ICONSET_SIZES.length * 2} images)`);
}

await makeIcons();
