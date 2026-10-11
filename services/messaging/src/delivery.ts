import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

interface DeliveryOptions {
  token: string;
  maxVideoBytes: number;
  verification?(recipient: string, code: string): Promise<string>;
  deliver(recipient: string, video: Buffer): Promise<string>;
}

const digest = (value: string) => createHash("sha256").update(value).digest();

export function createDeliveryHandler({ token, maxVideoBytes, deliver, verification }: DeliveryOptions) {
  if (!token) throw new Error("MESSAGING_TOKEN is required");
  if (!Number.isSafeInteger(maxVideoBytes) || maxVideoBytes < 1) throw new Error("Invalid MAX_VIDEO_BYTES");
  const expectedAuthorization = digest(`Bearer ${token}`);

  return async (request: IncomingMessage, response: ServerResponse) => {
    const reply = (status: number, body: object) => {
      if (status >= 400) response.setHeader("Connection", "close");
      response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(body));
    };
    const path = request.url?.split("?")[0];
    if (path !== "/video" && path !== "/verification") return reply(404, { error: "Not found" });
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      return reply(405, { error: "Method not allowed" });
    }
    if (!timingSafeEqual(digest(request.headers.authorization ?? ""), expectedAuthorization)) {
      response.setHeader("WWW-Authenticate", "Bearer");
      return reply(401, { error: "Unauthorized" });
    }
    if (path === "/verification") {
      if (request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
        return reply(415, { error: "Content-Type must be application/json" });
      }
      if (Number(request.headers["content-length"]) > 1024) return reply(413, { error: "Request too large" });
      const chunks: Buffer[] = [];
      let size = 0;
      let body: unknown;
      try {
        for await (const chunk of request.iterator({ destroyOnReturn: false })) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bytes.length;
          if (size > 1024) return reply(413, { error: "Request too large" });
          chunks.push(bytes);
        }
        body = JSON.parse(Buffer.concat(chunks).toString());
      } catch { return reply(400, { error: "Invalid verification request" }); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return reply(400, { error: "Invalid verification request" });
      const fields = body as Record<string, unknown>;
      if (Object.keys(fields).length !== 2 || typeof fields.recipient !== "string"
          || !/^\+[1-9][0-9]{7,14}$/.test(fields.recipient) || typeof fields.code !== "string"
          || !/^[0-9]{6}$/.test(fields.code)) return reply(400, { error: "Invalid verification request" });
      try {
        const id = await verification?.(fields.recipient, fields.code);
        if (!id?.trim()) throw Error("No acceptance");
        return reply(202, { accepted: true, message_id: id });
      } catch { return reply(502, { error: "Verification acceptance not confirmed" }); }
    }
    const recipient = request.headers["x-recipient"];
    const job = request.headers["x-lesson-job"];
    if (typeof recipient !== "string" || !/^\+[1-9][0-9]{7,14}$/.test(recipient)
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
