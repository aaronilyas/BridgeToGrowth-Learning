import { attachment, text } from "spectrum-ts";

// A small interface lets tests exercise routing without Photon credentials.
interface PhotonPlatform<User> {
  user(phone: string): Promise<User>;
  space: {
    create(user: User): Promise<{
      send(content: ReturnType<typeof attachment> | ReturnType<typeof text>): Promise<{ id: string } | undefined>;
    }>;
  };
}

export function createPhotonDelivery<User>(platform: PhotonPlatform<User>) {
  return async (recipient: string, video: Buffer): Promise<string> => {
    const space = await platform.space.create(await platform.user(recipient));
    const message = await space.send(attachment(video, {
      name: "lesson.mp4",
      mimeType: "video/mp4",
    }));
    // Spectrum can resolve without a message when a capability is unsupported.
    if (!message || typeof message.id !== "string" || !message.id.trim()) {
      throw new Error("Photon acceptance not confirmed");
    }
    return message.id;
  };
}


export function createPhotonVerification<User>(platform: PhotonPlatform<User>) {
  return async (recipient: string, code: string): Promise<string> => {
    const space = await platform.space.create(await platform.user(recipient));
    const message = await space.send(text(`Your BridgeToGrowth verification code is ${code}. It expires in 10 minutes. Do not share this code.`));
    if (!message || typeof message.id !== "string" || !message.id.trim()) {
      throw new Error("Verification acceptance not confirmed");
    }
    return message.id;
  };
}
