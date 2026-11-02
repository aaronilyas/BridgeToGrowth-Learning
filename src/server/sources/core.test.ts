import { describe, expect, test } from "bun:test";
import { HttpError } from "../http.ts";
import { MAX_PDF_BYTES, MAX_TEXT_PAGES } from "./core.ts";
import { readPdf } from "./pdf.ts";

const enc = new TextEncoder();

function escapePdf(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function makePdf(pages: string[]): Uint8Array {
  const chunks: string[] = ["%PDF-1.4\n"];
  const offsets: number[] = [0];
  const add = (body: string): void => {
    offsets.push(enc.encode(chunks.join("")).length);
    chunks.push(body);
  };
  const n = pages.length;
  const pageObjStart = 3;
  const kids = pages.map((_, i) => `${pageObjStart + i * 2} 0 R`).join(" ");
  add("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  add(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${n} >>\nendobj\n`);
  const fontId = pageObjStart + n * 2;
  for (let i = 0; i < n; i++) {
    const pageId = pageObjStart + i * 2;
    const contentId = pageId + 1;
    const stream = `BT /F1 12 Tf 72 720 Td (${escapePdf(pages[i] ?? "")}) Tj ET`;
    add(`${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>\nendobj\n`);
    add(`${contentId} 0 obj\n<< /Length ${enc.encode(stream).length} >>\nstream\n${stream}\nendstream\nendobj\n`);
  }
  add(`${fontId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`);
  const body = chunks.join("");
  const xrefStart = enc.encode(body).length;
  const size = fontId + 1;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let i = 1; i < size; i++) xref += `${String(offsets[i] ?? 0).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return enc.encode(body + xref);
}

describe("readPdf", () => {
  test("extracts text from each page", async () => {
    const read = await readPdf(makePdf(["Hello page one", "Second page alpha"]), 0);
    expect(read.kind).toBe("text");
    expect(read.text).toContain("Hello page one");
    expect(read.text).toContain("Second page alpha");
  });

  test("rejects an oversized file with too_large", async () => {
    const big = new Uint8Array(MAX_PDF_BYTES + 1);
    big.set(enc.encode("%PDF-1.4"));
    try {
      await readPdf(big, 0);
      throw new Error("expected too_large");
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      if (!(e instanceof HttpError)) return;
      expect(e.status).toBe(413);
      expect(e.code).toBe("too_large");
    }
  });

  test("keeps only the first MAX_TEXT_PAGES pages", async () => {
    const pages = Array.from({ length: MAX_TEXT_PAGES + 1 }, (_, i) => `PageMark ${i + 1}`);
    const read = await readPdf(makePdf(pages), 0);
    expect(read.text).toContain("PageMark 1");
    expect(read.text).toContain(`PageMark ${MAX_TEXT_PAGES}`);
    expect(read.text).not.toContain(`PageMark ${MAX_TEXT_PAGES + 1}`);
  });

  test("rejects a non-pdf and an unreadable pdf", async () => {
    try {
      await readPdf(enc.encode("hello"), 0);
      throw new Error("expected unsupported_media");
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      if (!(e instanceof HttpError)) return;
      expect(e.status).toBe(415);
      expect(e.code).toBe("unsupported_media");
    }
    try {
      await readPdf(enc.encode("%PDF-1.4\nnot a pdf"), 0);
      throw new Error("expected source_unreadable");
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      if (!(e instanceof HttpError)) return;
      expect(e.status).toBe(422);
      expect(e.code).toBe("source_unreadable");
    }
  });
});
