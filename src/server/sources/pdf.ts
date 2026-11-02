import { extractText, getResolvedPDFJS } from "unpdf";
import { VerbosityLevel, type PDFDocumentLoadingTask, type PDFDocumentProxy, type PDFPageProxy } from "unpdf/pdfjs";
import { HttpError } from "../http.ts";
import { sniffMime } from "../styles/core.ts";
import { MAX_CONCURRENT_PDF_TOOLS, MAX_PDF_BYTES, MAX_TEXT_PAGES, tidyText } from "./core.ts";

export type PdfRead = { kind: "text"; text: string };

const PDF_TIMEOUT_MS = 30_000;
const TEXT_OUT_CAP = 4 * 1024 * 1024;
// SEC: isEvalSupported is forced off, fonts stay unloaded, and no cmap, font, wasm or document URL is set, so a PDF cannot eval, fetch or open a worker thread; maxImageSize refuses one bitmap large enough to exhaust memory
const PDF_OPEN = {
  isEvalSupported: false,
  disableFontFace: true,
  useSystemFonts: false,
  useWorkerFetch: false,
  useWasm: false,
  disableAutoFetch: true,
  disableStream: true,
  disableRange: true,
  isOffscreenCanvasSupported: false,
  isImageDecoderSupported: false,
  maxImageSize: 16_777_216,
  verbosity: VerbosityLevel.ERRORS,
};

type PdfPiece = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>["items"][number];

let running = 0;

// O(1)
function clipPdfChars(text: string): string {
  return text.length <= TEXT_OUT_CAP ? text : text.slice(0, TEXT_OUT_CAP);
}

// O(n) in the item
function pieceText(item: PdfPiece): string {
  if (!("str" in item)) return "";
  return item.str + (item.hasEOL ? "\n" : "");
}

// O(text on the page)
async function textOfPage(doc: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const content = await (await doc.getPage(pageNumber)).getTextContent();
  return content.items.map(pieceText).join("");
}

// O(pages) bounded by MAX_TEXT_PAGES
// INV: numPages above MAX_TEXT_PAGES are not read; the first MAX_TEXT_PAGES are kept, the same bound the previous extractor applied with its last-page flag
async function readCappedPages(doc: PDFDocumentProxy, signal: AbortSignal): Promise<string> {
  if (signal.aborted) throw new HttpError(422, "source_unreadable");
  if (doc.numPages <= MAX_TEXT_PAGES) {
    const extracted = await extractText(doc, { mergePages: true });
    return extracted.text;
  }
  const parts: string[] = [];
  let chars = 0;
  for (let n = 1; n <= MAX_TEXT_PAGES; n++) {
    if (signal.aborted) throw new HttpError(422, "source_unreadable");
    const page = await textOfPage(doc, n);
    parts.push(page);
    chars += page.length;
    if (chars >= TEXT_OUT_CAP) break;
  }
  return parts.join("\n");
}

// O(n) in file size
async function readPdfText(bytes: Uint8Array, signal: AbortSignal, bind: (task: PDFDocumentLoadingTask) => void): Promise<string> {
  const pdfjs = await getResolvedPDFJS();
  if (signal.aborted) throw new HttpError(422, "source_unreadable");
  const task = pdfjs.getDocument({ data: bytes.slice(), ...PDF_OPEN });
  bind(task);
  if (signal.aborted) throw new HttpError(422, "source_unreadable");
  return readCappedPages(await task.promise, signal);
}

// O(n) in file size, bounded by PDF_TIMEOUT_MS
// SEC: at most MAX_CONCURRENT_PDF_TOOLS reads run at once; a further request fails with 429 rather than queueing
// INV: on timeout the loading task is destroyed and the read fails with source_unreadable, the error a read that did not finish already surfaced
async function withPdfSlot(bytes: Uint8Array): Promise<string> {
  if (running >= MAX_CONCURRENT_PDF_TOOLS) throw new HttpError(429, "rate_limited");
  running += 1;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PDF_TIMEOUT_MS);
  const held: { task: PDFDocumentLoadingTask | null } = { task: null };
  let settled = false;
  try {
    return await new Promise<string>((resolve, reject) => {
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        controller.signal.removeEventListener("abort", onAbort);
        fn();
      };
      const onAbort = (): void => {
        void held.task?.destroy().catch(() => undefined);
        finish(() => reject(new HttpError(422, "source_unreadable")));
      };
      if (controller.signal.aborted) {
        onAbort();
        return;
      }
      controller.signal.addEventListener("abort", onAbort, { once: true });
      readPdfText(bytes, controller.signal, (next) => {
        held.task = next;
      }).then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error instanceof HttpError ? error : new HttpError(422, "source_unreadable"))),
      );
    });
  } finally {
    clearTimeout(timer);
    await held.task?.destroy().catch(() => undefined);
    running -= 1;
  }
}

// O(n) in file size
// SEC: magic bytes and size are checked before pdf.js runs; the bytes are copied in and are never stored
// INV: extracted text is cut at TEXT_OUT_CAP characters, the same ceiling as the previous extractor's output cap
export async function readPdf(bytes: Uint8Array, idx: number): Promise<PdfRead> {
  if (bytes.length > MAX_PDF_BYTES) throw new HttpError(413, "too_large");
  if (sniffMime(bytes.subarray(0, 8)) !== "application/pdf") throw new HttpError(415, "unsupported_media");
  return { kind: "text", text: tidyText(clipPdfChars(await withPdfSlot(bytes))) };
}
