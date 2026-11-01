import { CodeRunRequest, CodeSpec } from "../../shared/code.ts";
import { HttpError, json, route } from "../http.ts";
import { findQuestion } from "../learn/sql.ts";
import { toRunResponse } from "./core.ts";
import { runInSandbox } from "./sandbox.ts";

// SEC: runs only against a code question the local user owns, with that question's libraries and no hidden tests; anything else is 404
const run = route({ entitled: true, body: CodeRunRequest, rate: { key: "code", cap: 20, perMin: 20 } }, async (c) => {
  const row = await findQuestion(c.user.id, c.body.questionId);
  if (!row || row.kind !== "code") throw new HttpError(404, "not_found");
  const spec = CodeSpec.parse(row.code_spec);
  return json(toRunResponse(await runInSandbox(c.user.id, spec.libraries, c.body.code, [])));
});

export const codeRoutes = { "/api/code/run": { POST: run } };
