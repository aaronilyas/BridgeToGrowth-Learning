import { z } from "zod";
import type { ExternalTarget } from "../shared/providers.ts";
import { api } from "./api.ts";

// O(1)
// SEC: the renderer names a fixed target; the backend owns the URL and opens it in the system browser
export async function openExternalTarget(target: ExternalTarget): Promise<void> {
  await api("/api/open-external", z.undefined(), { method: "POST", body: { target } });
}
