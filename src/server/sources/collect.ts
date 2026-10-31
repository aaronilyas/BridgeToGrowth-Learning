import { HttpError } from "../http.ts";
import type { FilePart } from "../llm/core.ts";
import { MAX_PDF_BYTES, MAX_SOURCE_FILES, MAX_SOURCE_URLS, buildAttachmentBlock, cleanLabel, type SourceText } from "./core.ts";
import { readPdf, type PdfRead } from "./pdf.ts";
import { fetchUrlSource } from "./web.ts";

export type GatheredSources = { block: string; files: FilePart[]; count: number };

type Read = { label: string; read: PdfRead };

// O(n) in file size
async function readUploaded(file: File, idx: number): Promise<Read> {
  if (file.size > MAX_PDF_BYTES) throw new HttpError(413, "too_large");
  if (file.type !== "application/pdf") throw new HttpError(415, "unsupported_media");
  const read = await readPdf(new Uint8Array(await file.arrayBuffer()), idx);
  return { label: `PDF "${cleanLabel(file.name) || "upload.pdf"}"`, read };
}

// O(n) in response size
async function readLinked(url: string, idx: number): Promise<Read> {
  const f = await fetchUrlSource(url);
  if (f.kind === "pdf") return { label: `PDF from ${f.url}`, read: await readPdf(f.bytes, idx) };
  if (f.text === "") throw new HttpError(422, "source_unreadable");
  return { label: `${f.title ? `Web page "${f.title}"` : "Web page"} at ${f.url}`, read: { kind: "text", text: f.text } };
}

// O(total input size)
// SEC: counts are capped here as well as at the route; nothing read is stored, only returned for one model call; any unreadable or blocked source fails the whole request so the learner knows it was not used
export async function gatherSources(urls: string[], files: File[]): Promise<GatheredSources> {
  if (files.length > MAX_SOURCE_FILES || urls.length > MAX_SOURCE_URLS) throw new HttpError(400, "bad_request");
  if (files.length === 0 && urls.length === 0) return { block: "", files: [], count: 0 };
  const reads = await Promise.all([...files.map((f, i) => readUploaded(f, i)), ...urls.map((u, i) => readLinked(u, files.length + i))]);
  const texts: SourceText[] = [];
  const labels: string[] = [];
  const parts: FilePart[] = [];
  for (const r of reads) {
    if (r.read.kind === "text") texts.push({ label: r.label, text: r.read.text });
    else {
      labels.push(r.label);
      parts.push(r.read.part);
    }
  }
  return { block: buildAttachmentBlock(texts, labels), files: parts, count: reads.length };
}
