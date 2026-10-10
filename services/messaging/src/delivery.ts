import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

interface DeliveryOptions {
  token: string;
  maxVideoBytes: number;
  deliver(recipient: string, video: Buffer): Promise<string>;
}

const digest = (value: string) => createHash("sha256").update(value).digest();

export function createDeliveryHandler({ token, maxVideoBytes, deliver }: DeliveryOptions) {
  if (!token) throw new Error("MESSAGING_TOKEN is required");
  if (!Number.isSafeInteger(maxVideoBytes) || maxVideoBytes < 1) throw new Error("Invalid MAX_VIDEO_BYTES");
  const expectedAuthorization = digest(`Bearer ${token}`);

  return async (request: IncomingMessage, response: ServerResponse) => {
    const reply = (status: number, body: object) => {
      if (status >= 400) response.setHeader("Connection", "close");
      response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(body));
    };
    if (request.url?.split("?")[0] !== "/video") return reply(404, { error: "Not found" });
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      return reply(405, { error: "Method not allowed" });
    }
    if (!timingSafeEqual(digest(request.headers.authorization ?? ""), expectedAuthorization)) {
      response.setHeader("WWW-Authenticate", "Bearer");
      return reply(401, { error: "Unauthorized" });
    }
    const recipient = request.headers["x-recipient"];
    const job = request.headers["x-lesson-job"];
    if (typeof recipient !== "string" || !/^\+[1-9]\d{1,14}$/.test(recipient)
        || typeof job !== "string" || !job.trim()) {
      return reply(400, { error: "X-Recipient (E.164) and X-Lesson-Job are required" });
    }
    if (request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "video/mp4") {
      return reply(415, { error: "Content-Type must be video/mp4" });
    }
    if (Number(request.headers["content-length"]) > maxVideoBytes) {
      return reply(413, { error: "Video too large" });
    }

    // Consume the complete request before contacting Photon. No disk writes.
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > maxVideoBytes) return reply(413, { error: "Video too large" });
        chunks.push(bytes);
      }
    } catch {
      return reply(400, { error: "Incomplete video upload" });
    }
    if (!size) return reply(400, { error: "Video body is required" });
    const video = Buffer.concat(chunks, size);
    chunks.length = 0;
    try {
      const messageId = await deliver(recipient, video);
      if (typeof messageId !== "string" || !messageId.trim()) throw new Error("Missing provider ID");
      return reply(202, { accepted: true, message_id: messageId });
    } catch {
      return reply(502, { error: "Photon acceptance not confirmed" });
    }
  };
}
