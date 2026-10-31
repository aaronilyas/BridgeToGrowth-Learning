import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpError } from "../http.ts";
import type { FilePart } from "../llm/core.ts";
import { sniffMime } from "../styles/core.ts";
import { MAX_CONCURRENT_PDF_TOOLS, MAX_PDF_BYTES, MAX_SCAN_PAGES, MAX_SENT_PDF_BYTES, MAX_TEXT_PAGES, MIN_TEXT_CHARS, buildPdfToolArgv, tidyText } from "./core.ts";

export type PdfRead = { kind: "text"; text: string } | { kind: "file"; part: FilePart };

const TOOL_TIMEOUT_MS = 30_000;
const TEXT_OUT_CAP = 4 * 1024 * 1024;
const GS_OUT_CAP = 256 * 1024;
const TOOL_PATH = "/usr/bin:/bin";
const COMPRESS_PRESETS = ["/ebook", "/screen"] as const;
let running = 0;

// O(1)
// SEC: tools resolve only from system directories; a missing tool, bwrap or prlimit means the PDF cannot be read safely, so the request fails rather than running unsandboxed or sending the raw file
function locateTool(name: string): string {
  const path = Bun.which(name, { PATH: TOOL_PATH });
  if (!path) throw new HttpError(422, "source_unreadable");
  return path;
}

// O(output) bounded by cap
// SEC: always inside bubblewrap under prlimit (see buildPdfToolArgv); argv only, no shell; empty env; stdin closed; killed on timeout or oversized output
// SEC: at most MAX_CONCURRENT_PDF_TOOLS run at once across all users; extra requests get 429
async function runTool(tool: string, args: string[], dir: string, cap: number): Promise<{ ok: boolean; out: Uint8Array }> {
  const argv = buildPdfToolArgv(locateTool("prlimit"), locateTool("bwrap"), locateTool(tool), args, dir);
  if (running >= MAX_CONCURRENT_PDF_TOOLS) throw new HttpError(429, "rate_limited");
  running += 1;
  try {
    const proc = Bun.spawn(argv, { env: {}, stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: TOOL_TIMEOUT_MS, killSignal: "SIGKILL" });
    const chunks: Uint8Array[] = [];
    let size = 0;
    let over = false;
    for await (const chunk of proc.stdout) {
      size += chunk.length;
      if (size > cap) {
        over = true;
        proc.kill("SIGKILL");
        break;
      }
      chunks.push(chunk);
    }
    const code = await proc.exited;
    return { ok: code === 0 && !over && proc.signalCode === null, out: Buffer.concat(chunks) };
  } finally {
    running -= 1;
  }
}

// O(n) in text length
function countVisible(text: string): number {
  return text.replace(/\s+/g, "").length;
}

// O(pages) via subprocess
// INV: a scanned PDF is cut to MAX_SCAN_PAGES and downsampled, trying coarser presets until it fits MAX_SENT_PDF_BYTES
async function compressPdf(dir: string): Promise<Uint8Array> {
  for (const preset of COMPRESS_PRESETS) {
    const r = await runTool("gs", ["-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-dNOPROMPT", "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.5", `-dPDFSETTINGS=${preset}`, "-dDetectDuplicateImages=true", "-dFirstPage=1", `-dLastPage=${MAX_SCAN_PAGES}`, "-sOutputFile=out.pdf", "in.pdf"], dir, GS_OUT_CAP);
    const size = await stat(join(dir, "out.pdf")).then((s) => s.size, () => -1);
    if (!r.ok || size <= 0) throw new HttpError(422, "source_unreadable");
    if (size <= MAX_SENT_PDF_BYTES) return new Uint8Array(await Bun.file(join(dir, "out.pdf")).arrayBuffer());
  }
  throw new HttpError(413, "too_large");
}

// O(n) in file size
// SEC: magic bytes and size are checked before any tool runs; the bytes live only in a private 0700 temp dir that is removed before returning, and are never stored
// INV: text-layer PDFs become capped plain text (cheapest); image-only PDFs become a compressed, page-limited file part
export async function readPdf(bytes: Uint8Array, idx: number): Promise<PdfRead> {
  if (bytes.length > MAX_PDF_BYTES) throw new HttpError(413, "too_large");
  if (sniffMime(bytes.subarray(0, 8)) !== "application/pdf") throw new HttpError(415, "unsupported_media");
  const dir = await mkdtemp(join(tmpdir(), "btg-pdf-"));
  try {
    await writeFile(join(dir, "in.pdf"), bytes, { mode: 0o600 });
    const r = await runTool("pdftotext", ["-q", "-enc", "UTF-8", "-nopgbrk", "-f", "1", "-l", String(MAX_TEXT_PAGES), "in.pdf", "-"], dir, TEXT_OUT_CAP);
    const text = r.ok ? tidyText(new TextDecoder("utf-8", { fatal: false }).decode(r.out)) : "";
    if (countVisible(text) >= MIN_TEXT_CHARS) return { kind: "text", text };
    const small = await compressPdf(dir);
    return { kind: "file", part: { type: "file", file: { filename: `attachment-${idx + 1}.pdf`, file_data: `data:application/pdf;base64,${Buffer.from(small).toString("base64")}` } } };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => console.error("sources: temp cleanup failed"));
  }
}
