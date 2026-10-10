import { createServer } from "node:http";
import { Spectrum } from "spectrum-ts";
import { imessage } from "@spectrum-ts/imessage";
import { createDeliveryHandler } from "./delivery.ts";
import { createPhotonDelivery } from "./photon.ts";

const token = process.env.MESSAGING_TOKEN;
if (!token) throw new Error("MESSAGING_TOKEN is required");
if (!process.env.PROJECT_ID || !process.env.PROJECT_SECRET) throw new Error("PROJECT_ID and PROJECT_SECRET are required");
const port = Number(process.env.PORT ?? 3001);
const maxVideoBytes = Number(process.env.MAX_VIDEO_BYTES ?? 50 * 1024 * 1024);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
if (!Number.isSafeInteger(maxVideoBytes) || maxVideoBytes < 1) throw new Error("Invalid MAX_VIDEO_BYTES");

const app = await Spectrum({
  projectId: process.env.PROJECT_ID!,
  projectSecret: process.env.PROJECT_SECRET!,
  providers: [imessage.config()],
});
const server = createServer(createDeliveryHandler({
  token,
  maxVideoBytes,
  deliver: createPhotonDelivery(imessage(app)),
}));
server.listen(port, process.env.HOST ?? "127.0.0.1");

// Stop accepting requests, finish active deliveries, then disconnect Photon.
const shutdown = () => server.close(() => { void app.stop(); });
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
