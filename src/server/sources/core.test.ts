import { describe, expect, test } from "bun:test";
import { buildPdfToolArgv } from "./core.ts";

const argv = buildPdfToolArgv("/usr/bin/prlimit", "/usr/bin/bwrap", "/usr/bin/gs", ["-q", "in.pdf"], "/tmp/btg-pdf-abc");

describe("buildPdfToolArgv", () => {
  test("unshares all namespaces and drops every capability", () => {
    expect(argv).toContain("--unshare-all");
    const i = argv.indexOf("--cap-drop");
    expect(i).toBeGreaterThan(-1);
    expect(argv[i + 1]).toBe("ALL");
  });

  test("binds only the given dir read-write, at /work", () => {
    const rw = argv.flatMap((a, i) => (a === "--bind" || a === "--bind-try" ? [[argv[i + 1], argv[i + 2]]] : []));
    expect(rw).toEqual([["/tmp/btg-pdf-abc", "/work"]]);
  });

  test("never mounts /proc, /etc or /home", () => {
    expect(argv).not.toContain("--proc");
    for (const p of ["/proc", "/etc", "/home"]) expect(argv.some((a) => a === p || a.startsWith(`${p}/`))).toBe(false);
  });
});
