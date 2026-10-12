// Spectrum 12.10.1: inbound read messages have reader + outbound target.
import { createHash, createHmac } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ReadEvent {
  event_id: string;
  message_id: string;
  recipient: string;
  read_at: string;
}
interface ReceiptMessage {
  id: string;
  platform: string;
  sender?: { id: string };
  timestamp: Date;
  content: { type: string; target?: { id: string; direction?: string } };
}
export function readEvent(message: ReceiptMessage, spaceType: string): ReadEvent | undefined {
  if (message.platform !== "imessage" || message.content.type !== "read" || spaceType !== "dm"
      || message.content.target?.direction !== "outbound" || !message.sender
      || !/^\+[1-9][0-9]{7,14}$/.test(message.sender.id)
      || !message.id || message.id.length > 255 || !message.content.target.id
      || message.content.target.id.length > 255 || !Number.isFinite(message.timestamp.getTime())) return;
  return { event_id: message.id, message_id: message.content.target.id,
           recipient: message.sender.id, read_at: message.timestamp.toISOString() };
}

export function signedReceipt(event: ReadEvent, secret: string, now = Math.floor(Date.now() / 1000)) {
  const body = JSON.stringify(event);
  const timestamp = String(now);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return { body, headers: { "Content-Type": "application/json",
    "X-Receipt-Timestamp": timestamp, "X-Receipt-Signature": signature } };
}

// Durable metadata only: this spool never stores credentials, codes or videos.
export class ReceiptForwarder {
  private flushing = false;
  constructor(private directory: string, private url: string, private secret: string,
              private now = () => Date.now()) {
    if (secret.length < 32) throw Error("RECEIPT_SECRET must contain at least 32 characters");
    const target = new URL(url);
    if (!["http:", "https:"].includes(target.protocol) || target.pathname !== "/internal/receipts"
        || target.username || target.password || target.search || target.hash) throw Error("Invalid RECEIPT_URL");
  }
  async enqueue(event: ReadEvent) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const name = createHash("sha256").update(event.event_id).digest("hex");
    const temporary = join(this.directory, `${name}.tmp`);
    await writeFile(temporary, JSON.stringify(event), { mode: 0o600 });
    await rename(temporary, join(this.directory, `${name}.json`));
  }
  async flush() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const retained: string[] = [];
      // Purge every expired record before network retries; a failed callback must
      // not prevent later files (including interrupted writes) from expiring.
      for (const file of await readdir(this.directory)) {
        if (!/^[a-f0-9]{64}\.(json|tmp)(\.rejected)?$/.test(file)) continue;
        const path = join(this.directory, file);
        if (this.now() - (await stat(path)).mtimeMs >= 7 * 86400 * 1000) {
          await unlink(path);
        } else if (file.endsWith(".json")) retained.push(path);
      }
      for (const path of retained) {
        let event: ReadEvent;
        try {
          event = JSON.parse(await readFile(path, "utf8")) as ReadEvent;
        } catch {
          await rename(path, path + ".rejected");
          console.error("Malformed receipt metadata quarantined");
          continue;
        }
        const { body, headers } = signedReceipt(event, this.secret);
        try {
          const response = await fetch(this.url, { method: "POST", body, headers, signal: AbortSignal.timeout(10000), redirect: "error" });
          if (response.status === 204) await unlink(path);
          else if (response.status === 400 || response.status === 409) {
            // Quarantine conflicting/malformed evidence; never discard it as successful.
            await rename(path, path + ".rejected");
            console.error("Receipt evidence rejected by coordinator");
          } else break;
        } catch { break; }
      }
    } finally { this.flushing = false; }
  }
}
