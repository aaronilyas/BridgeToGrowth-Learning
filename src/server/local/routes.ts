import type { MeResponse } from "../../shared/api.ts";
import { freeEntitlement, json, route } from "../http.ts";

const me = route({ auth: true }, async (c) => {
  const e = freeEntitlement();
  return json({ id: c.user.id, email: c.user.email, settings: c.user.settings, entitlement: { plan: e.plan, capMicros: Number(e.capMicros) } } satisfies MeResponse);
});

export const localRoutes = {
  "/api/me": { GET: me },
};
