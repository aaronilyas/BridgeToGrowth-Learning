import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindStable, firstPickPort, readSavedPort, savePort } from "./stablePort.ts";

const dirs: string[] = [];
const servers: { stop: (force?: boolean) => unknown }[] = [];

// O(1)
function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "btg-port-"));
  dirs.push(dir);
  return join(dir, "listen-port");
}

// O(1)
function listen(port: number): ReturnType<typeof Bun.serve> {
  const server = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("ok") });
  servers.push(server);
  return server;
}

afterEach(() => {
  for (const s of servers.splice(0)) s.stop(true);
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

test("a saved port reads back; junk, privileged and missing values read as none", () => {
  const file = tempFile();
  expect(readSavedPort(file)).toBeNull();
  savePort(file, 23456);
  expect(readSavedPort(file)).toBe(23456);
  expect(statSync(file).mode & 0o777).toBe(0o600);
  for (const bad of ["", "80", "65536", "12a45", "-2000", "2.5e4", "99999"]) {
    writeFileSync(file, bad);
    expect(readSavedPort(file)).toBeNull();
  }
});

test("a first pick stays below the Linux and Windows ephemeral ranges", () => {
  expect(firstPickPort(() => 0)).toBe(20_000);
  expect(firstPickPort(() => 0.999999)).toBe(29_999);
});

test("the saved port is reused when it is free, and nothing needs saving", () => {
  const probe = listen(0);
  const port = probe.port ?? 0;
  probe.stop(true);
  const { server, changed } = bindStable(port, listen);
  expect(server.port).toBe(port);
  expect(changed).toBe(false);
});

test("a saved port held by another process falls back to a fresh port, which the caller saves", () => {
  const squatter = listen(0);
  const held = squatter.port ?? 0;
  const { server, changed } = bindStable(held, listen);
  expect(server.port).not.toBe(held);
  expect(server.port).toBeGreaterThan(0);
  expect(changed).toBe(true);
});

test("with nothing saved, the first pick is bound and reported as changed", () => {
  const tried: number[] = [];
  const { server, changed } = bindStable(null, (p) => {
    tried.push(p);
    return listen(p);
  }, () => 0.5);
  expect(tried[0]).toBe(25_000);
  expect(changed).toBe(true);
  expect(server.port).toBeGreaterThan(0);
});
