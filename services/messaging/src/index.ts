import { createServer } from "node:http";
import { Spectrum } from "spectrum-ts";
import { imessage } from "@spectrum-ts/imessage";
import { createDeliveryHandler } from "./delivery.ts";
import { createPhotonDelivery, createPhotonVerification } from "./photon.ts";

import { readEvent, ReceiptForwarder } from "./receipts.ts";

const token = process.env.MESSAGING_TOKEN;
if (!token) throw new Error("MESSAGING_TOKEN is required");
if (!process.env.PROJECT_ID || !process.env.PROJECT_SECRET) throw new Error("PROJECT_ID and PROJECT_SECRET are required");
const port = Number(process.env.PORT ?? 3001);
const maxVideoBytes = Number(process.env.MAX_VIDEO_BYTES ?? 50 * 1024 * 1024);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
if (!Number.isSafeInteger(maxVideoBytes) || maxVideoBytes < 1) throw new Error("Invalid MAX_VIDEO_BYTES");

if (!process.env.RECEIPT_URL || !process.env.RECEIPT_SECRET || !process.env.RECEIPT_SPOOL_DIR) {
  throw Error("RECEIPT_URL, RECEIPT_SECRET and RECEIPT_SPOOL_DIR are required");
}
const receipts = new ReceiptForwarder(process.env.RECEIPT_SPOOL_DIR, process.env.RECEIPT_URL, process.env.RECEIPT_SECRET);
const app = await Spectrum({
  projectId: process.env.PROJECT_ID!,
  projectSecret: process.env.PROJECT_SECRET!,
  providers: [imessage.config()],
});
const server = createServer(createDeliveryHandler({
  token,
  maxVideoBytes,
  deliver: createPhotonDelivery(imessage(app)),
  verification: createPhotonVerification(imessage(app)),
}));
server.listen(port, process.env.HOST ?? "127.0.0.1");

const receiptLoop = (async () => {
  for await (const [space, message] of imessage(app).messages) {
    const event = readEvent(message, space.type);
    if (event) await receipts.enqueue(event);
  }
})();
receiptLoop.catch(() => { clearInterval(retry); console.error("Receipt consumer stopped"); server.close(() => { void app.stop(); process.exitCode = 1; }); });
const retry = setInterval(() => { void receipts.flush().catch(() => console.error("Receipt spool unavailable")); }, 5000);
void receipts.flush().catch(() => console.error("Receipt spool unavailable"));

// Stop accepting requests, finish active deliveries, then disconnect Photon.
const shutdown = () => server.close(() => { clearInterval(retry); void app.stop(); });
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
