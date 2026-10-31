import { HttpError } from "../http.ts";
import type { FilePart } from "../llm/core.ts";
import { MAX_PDF_BYTES, MAX_SOURCE_FILES, MAX_SOURCE_URLS, buildAttachmentBlock, cleanLabel, type SourceText } from "./core.ts";
import { readPdf, type PdfRead } from "./pdf.ts";
import { fetchUrlSource } from "./web.ts";

export type GatheredSources = { block: string; files: FilePart[]; count: number };

type Read = { label: string; read: PdfRead };
type Pending = { label: string; text: string } | { label: string; pdf: Uint8Array; idx: number };

// O(n) in file size
async function loadUploaded(file: File, idx: number): Promise<Pending> {
  if (file.size > MAX_PDF_BYTES) throw new HttpError(413, "too_large");
  if (file.type !== "application/pdf") throw new HttpError(415, "unsupported_media");
  return { label: `PDF "${cleanLabel(file.name) || "upload.pdf"}"`, pdf: new Uint8Array(await file.arrayBuffer()), idx };
}

// O(n) in response size
async function loadLinked(url: string, idx: number): Promise<Pending> {
  const f = await fetchUrlSource(url);
  if (f.kind === "pdf") return { label: `PDF from ${f.url}`, pdf: f.bytes, idx };
  if (f.text === "") throw new HttpError(422, "source_unreadable");
  return { label: `${f.title ? `Web page "${f.title}"` : "Web page"} at ${f.url}`, text: f.text };
}

// O(total input size)
// SEC: counts are capped here as well as at the route; fetches run in parallel but PDF tools run one at a time so one request never exceeds the global sandbox cap on its own; nothing read is stored, only returned for one model call; any unreadable or blocked source fails the whole request so the learner knows it was not used
export async function gatherSources(urls: string[], files: File[]): Promise<GatheredSources> {
  if (files.length > MAX_SOURCE_FILES || urls.length > MAX_SOURCE_URLS) throw new HttpError(400, "bad_request");
  if (files.length === 0 && urls.length === 0) return { block: "", files: [], count: 0 };
  const loaded = await Promise.all([...files.map((f, i) => loadUploaded(f, i)), ...urls.map((u, i) => loadLinked(u, files.length + i))]);
  const reads: Read[] = [];
  for (const p of loaded) reads.push({ label: p.label, read: "pdf" in p ? await readPdf(p.pdf, p.idx) : { kind: "text", text: p.text } });
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
