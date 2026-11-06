import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

// INV: these are the system sonames Electrobun 2.0.5's libNativeWrapper.so links against (readelf -d); libasar.so ships inside the bundle and is not listed
// INV: the launcher reports a missing dependency of the wrapper as "Failed to open native wrapper ... FileNotFound", so this check runs before every launch
type Family = "debian" | "fedora" | "arch" | "suse";
type Need = { soname: string; packages: Record<Family, string[]> };

const ROOT = resolve(import.meta.dir, "..");
const NEEDS: Need[] = [
  { soname: "libgtk-3.so.0", packages: { debian: ["libgtk-3-0t64", "libgtk-3-0"], fedora: ["gtk3"], arch: ["gtk3"], suse: ["libgtk-3-0"] } },
  { soname: "libwebkit2gtk-4.1.so.0", packages: { debian: ["libwebkit2gtk-4.1-0"], fedora: ["webkit2gtk4.1"], arch: ["webkit2gtk-4.1"], suse: ["libwebkit2gtk-4_1-0"] } },
  { soname: "libjavascriptcoregtk-4.1.so.0", packages: { debian: ["libjavascriptcoregtk-4.1-0"], fedora: ["javascriptcoregtk4.1"], arch: ["webkit2gtk-4.1"], suse: ["libjavascriptcoregtk-4_1-0"] } },
  { soname: "libsoup-3.0.so.0", packages: { debian: ["libsoup-3.0-0", "libsoup3"], fedora: ["libsoup3"], arch: ["libsoup3"], suse: ["libsoup-3_0-0"] } },
  { soname: "libayatana-appindicator3.so.1", packages: { debian: ["libayatana-appindicator3-1"], fedora: ["libayatana-appindicator-gtk3"], arch: ["libayatana-appindicator"], suse: ["libayatana-appindicator3-1"] } },
];
const INSTALLERS: Record<Family, string[]> = {
  debian: ["apt-get", "install", "-y"],
  fedora: ["dnf", "install", "-y"],
  arch: ["pacman", "-S", "--needed", "--noconfirm"],
  suse: ["zypper", "install", "-y"],
};

// O(n) in installed libraries
// INV: ldconfig's cache is what the dynamic loader consults, so a soname absent from it fails to load; LD_LIBRARY_PATH entries are scanned too
function installedSonames(): Set<string> {
  const found = new Set<string>();
  const ldconfig = Bun.which("ldconfig") ?? (existsSync("/sbin/ldconfig") ? "/sbin/ldconfig" : null);
  if (ldconfig) {
    const out = Bun.spawnSync([ldconfig, "-p"], { stdout: "pipe", stderr: "ignore" }).stdout.toString();
    for (const line of out.split("\n")) {
      const name = line.trim().split(" ")[0];
      if (name) found.add(name);
    }
  }
  const dirs = [...(process.env.LD_LIBRARY_PATH ?? "").split(":"), ...(ldconfig ? [] : ["/usr/lib", "/usr/lib64", "/usr/lib/x86_64-linux-gnu", "/usr/lib/aarch64-linux-gnu"])];
  for (const dir of dirs.filter(Boolean)) {
    try {
      for (const name of readdirSync(dir)) found.add(name);
    } catch {}
  }
  return found;
}

// O(n) in ldd output
// INV: a built wrapper is also checked with ldd, so a future Electrobun that links a new library is still caught even before NEEDS is updated
function lddMissing(): string[] {
  const ldd = Bun.which("ldd");
  const build = join(ROOT, "desktop", "build");
  if (!ldd || !existsSync(build)) return [];
  const missing = new Set<string>();
  for (const entry of readdirSync(build, { recursive: true, withFileTypes: true })) {
    if (entry.name !== "libNativeWrapper.so") continue;
    const dir = entry.parentPath;
    const out = Bun.spawnSync([ldd, join(dir, entry.name)], { stdout: "pipe", stderr: "ignore", env: { ...process.env, LD_LIBRARY_PATH: dir } }).stdout.toString();
    for (const match of out.matchAll(/^\s*(\S+) => not found/gm)) missing.add(match[1]!);
  }
  return [...missing];
}

// O(1)
function detectFamily(): Family | null {
  let text = "";
  try {
    text = readFileSync("/etc/os-release", "utf8");
  } catch {
    return null;
  }
  const field = (key: string) => text.match(new RegExp(`^${key}="?([^"\\n]*)"?`, "m"))?.[1] ?? "";
  const ids = `${field("ID")} ${field("ID_LIKE")}`.toLowerCase().split(/\s+/);
  if (ids.some((id) => ["debian", "ubuntu"].includes(id))) return "debian";
  if (ids.some((id) => ["fedora", "rhel", "centos"].includes(id))) return "fedora";
  if (ids.some((id) => ["arch", "manjaro"].includes(id))) return "arch";
  if (ids.some((id) => id.startsWith("opensuse") || id === "suse" || id === "sles")) return "suse";
  return null;
}

// O(1) per candidate
// INV: Debian renamed several libraries in the 64-bit time_t transition (libgtk-3-0 -> libgtk-3-0t64), and apt refuses a virtual name, so the first name apt has a candidate for wins
function pickPackage(family: Family, candidates: string[]): string {
  if (family !== "debian" || candidates.length === 1 || !Bun.which("apt-cache")) return candidates[0]!;
  for (const name of candidates) {
    const out = Bun.spawnSync(["apt-cache", "policy", name], { stdout: "pipe", stderr: "ignore" }).stdout.toString();
    const candidate = out.match(/Candidate:\s*(\S+)/)?.[1];
    if (candidate && candidate !== "(none)") return name;
  }
  return candidates[0]!;
}

export type RuntimeReport = { missing: string[]; family: Family | null; packages: string[]; unknown: string[]; command: string[] | null };

// O(n) in installed libraries
export function checkLinuxRuntime(): RuntimeReport {
  const have = installedSonames();
  const missing = new Set(NEEDS.map((need) => need.soname).filter((soname) => !have.has(soname)));
  for (const soname of lddMissing()) missing.add(soname);
  const family = detectFamily();
  const packages = new Set<string>();
  const unknown: string[] = [];
  for (const soname of missing) {
    const need = NEEDS.find((entry) => entry.soname === soname);
    if (family && need) packages.add(pickPackage(family, need.packages[family]));
    else if (family === "fedora" || family === "suse") packages.add(`${soname}()(64bit)`);
    else unknown.push(soname);
  }
  const command = family && packages.size > 0 ? [...INSTALLERS[family], ...packages] : null;
  return { missing: [...missing], family, packages: [...packages], unknown, command };
}

// O(1)
function printReport(report: RuntimeReport): void {
  console.error("\nThe desktop window needs system libraries that are not installed:");
  for (const soname of report.missing) console.error(`  - ${soname}`);
  if (report.command) console.error(`\nInstall them with:\n  sudo ${report.command.join(" ")}`);
  if (report.unknown.length > 0 || !report.command) {
    console.error("\nInstall GTK 3, WebKitGTK 4.1, libsoup 3 and Ayatana AppIndicator 3 with your package manager, for example:");
    console.error("  Debian/Ubuntu: sudo apt install libgtk-3-0t64 libwebkit2gtk-4.1-0 libayatana-appindicator3-1");
    console.error("  Fedora/RHEL:   sudo dnf install gtk3 webkit2gtk4.1 libayatana-appindicator-gtk3");
    console.error("  Arch/Manjaro:  sudo pacman -S gtk3 webkit2gtk-4.1 libayatana-appindicator");
    console.error("  openSUSE:      sudo zypper install libgtk-3-0 libwebkit2gtk-4_1-0 libayatana-appindicator3-1");
  }
}

// O(1) plus the install
// INV: installs only after the user agrees at a terminal; non-interactive runs (CI, BTG_SKIP_INSTALL_PROMPT=1) print the command and fail
export async function ensureLinuxRuntime(): Promise<boolean> {
  if (process.platform !== "linux" || process.env.BTG_SKIP_RUNTIME_CHECK === "1") return true;
  const report = checkLinuxRuntime();
  if (report.missing.length === 0) return true;
  printReport(report);
  const interactive = process.stdin.isTTY && process.stdout.isTTY && process.env.BTG_SKIP_INSTALL_PROMPT !== "1";
  if (!report.command || !interactive) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("\nRun that command now? [Y/n] ")).trim().toLowerCase();
  rl.close();
  if (answer !== "" && answer !== "y" && answer !== "yes") return false;
  const argv = process.getuid?.() === 0 ? report.command : ["sudo", ...report.command];
  if (report.family === "debian") Bun.spawnSync([...argv.slice(0, argv.indexOf("apt-get") + 1), "update"], { stdio: ["inherit", "inherit", "inherit"] });
  const code = Bun.spawnSync(argv, { stdio: ["inherit", "inherit", "inherit"] }).exitCode;
  const after = checkLinuxRuntime();
  if (code === 0 && after.missing.length === 0) {
    console.log("All desktop libraries are installed.\n");
    return true;
  }
  console.error(`\nStill missing: ${after.missing.join(", ") || "(install command failed)"}`);
  return false;
}

if (import.meta.main) {
  const ok = await ensureLinuxRuntime();
  if (ok) console.log(process.platform === "linux" ? "Linux desktop libraries: all present." : "Nothing to check on this platform.");
  process.exit(ok ? 0 : 1);
}
