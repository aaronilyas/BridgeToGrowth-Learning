// Wraps the Windows desktop build in a setup wizard: artifacts/BridgeToGrowthLearning-Setup-x64.exe
// Needs the stable Electrobun build (bun run desktop:build) and Inno Setup 6.3 or newer
// (winget install JRSoftware.InnoSetup). With --optional, a missing Inno Setup is a note, not an error.
import { mkdir, readdir } from "node:fs/promises";
import { join, win32 } from "node:path";
import { ROOT, appVersion, findRuntime } from "./bundle.ts";

const OUTPUT = join(ROOT, "artifacts");
const OUTPUT_NAME = "BridgeToGrowthLearning-Setup-x64";
const WEBVIEW2_URL = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";
const WEBVIEW2 = join(ROOT, "scripts", "cache", "webview2", "MicrosoftEdgeWebview2Setup.exe");
// The file path is an environment variable, not part of the -Command text.
const AUTHENTICODE_FILE_ENV = "BTG_AUTHENTICODE_FILE";

// O(1). Windows PowerShell 5.1 cannot load PowerShell 7's Microsoft.PowerShell.Security.
// The desktop workflow runs under pwsh, so a child powershell.exe inherits PSModulePath,
// finds that 7.x module first, and Get-AuthenticodeSignature never loads
// (CouldNotAutoloadMatchingModule). An absent PSModulePath makes 5.1 build its own.
// Every casing: Node's process.env keys are case-sensitive, Windows env names are not.
export function windowsPowerShellEnv(source: NodeJS.ProcessEnv, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const skip = new Set(["psmodulepath", ...Object.keys(extra).map((key) => key.toLowerCase())]);
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || skip.has(key.toLowerCase())) continue;
    env[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) env[key] = value;
  return env;
}

// O(1). Absolute path: a bare "powershell.exe" is searched in the current directory before PATH.
export function windowsPowerShellPath(env: NodeJS.ProcessEnv = process.env): string {
  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT ?? env.windir ?? env.WINDIR;
  if (systemRoot === undefined || !/^[A-Za-z]:[\\/]/.test(systemRoot)) {
    throw new Error(`cannot locate Windows PowerShell: SystemRoot is ${systemRoot === undefined ? "not set" : `not an absolute path (${systemRoot})`}`);
  }
  return win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

// O(1). Import by path: on Windows Server 2025, autoload of Get-AuthenticodeSignature fails
// when PSModulePath was absent at startup, which is exactly the environment above.
export function authenticodeCommand(): string {
  return [
    "$ProgressPreference = 'SilentlyContinue'",
    "$ErrorActionPreference = 'Stop'",
    'Import-Module "$PSHOME\\Modules\\Microsoft.PowerShell.Security"',
    `$s = Get-AuthenticodeSignature -LiteralPath $env:${AUTHENTICODE_FILE_ENV}`,
    'Write-Output "$($s.Status)|$($s.SignerCertificate.Subject)"',
  ].join("; ");
}

// O(1). null when the signature is Valid and the signer is Microsoft Corporation.
// An empty status means the cmdlet did not run; that is not the same as an unsigned file.
export function microsoftSignatureError(code: number, stdout: string, stderr: string): string | null {
  const line = stdout.split(/\r?\n/).map((row) => row.trim()).find((row) => row.includes("|")) ?? "";
  const bar = line.indexOf("|");
  const status = bar === -1 ? "" : line.slice(0, bar).trim();
  const subject = bar === -1 ? "" : line.slice(bar + 1).trim();
  if (code !== 0 || status === "") {
    const detail = stderr.trim().replace(/\s+/g, " ");
    const clipped = detail.length > 500 ? `${detail.slice(0, 500)}…` : detail;
    return `the WebView2 signature check did not run (powershell exit ${code}${clipped ? `: ${clipped}` : ""}). The bootstrapper was deleted; run again to download it fresh.`;
  }
  if (status !== "Valid" || !subject.includes("O=Microsoft Corporation")) {
    return `the WebView2 bootstrapper is not signed by Microsoft (${status} ${subject}). It was deleted; run again to download it fresh.`;
  }
  return null;
}

// O(1)
async function run(argv: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(argv, { cwd: ROOT, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

// O(n) in installed Inno Setup versions
async function findIscc(): Promise<string | null> {
  const onPath = Bun.which("iscc");
  if (onPath) return onPath;
  for (const base of [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs")]) {
    if (!base) continue;
    const dirs = (await readdir(base).catch(() => [])).filter((name) => name.startsWith("Inno Setup")).sort().reverse();
    for (const dir of dirs) {
      const iscc = join(base, dir, "ISCC.exe");
      if (await Bun.file(iscc).exists()) return iscc;
    }
  }
  return null;
}

// O(1). The bootstrapper is Microsoft's evergreen download, so it is checked by its Authenticode
// signature instead of a fixed hash.
async function ensureWebView2Bootstrapper(): Promise<string> {
  if (!await Bun.file(WEBVIEW2).exists()) {
    console.log("Downloading the WebView2 bootstrapper");
    const response = await fetch(WEBVIEW2_URL);
    if (!response.ok) throw new Error(`WebView2 bootstrapper download failed: HTTP ${response.status}`);
    await mkdir(join(WEBVIEW2, ".."), { recursive: true });
    await Bun.write(WEBVIEW2, response);
  }
  const check = await run(
    [windowsPowerShellPath(), "-NoProfile", "-NonInteractive", "-Command", authenticodeCommand()],
    windowsPowerShellEnv(process.env, { [AUTHENTICODE_FILE_ENV]: WEBVIEW2 }),
  );
  const error = microsoftSignatureError(check.code, check.stdout, check.stderr);
  if (error) {
    await Bun.file(WEBVIEW2).delete().catch(() => undefined);
    throw new Error(error);
  }
  return WEBVIEW2;
}

// O(1) plus the compile
async function packageWindows(): Promise<void> {
  const optional = process.argv.includes("--optional");
  if (process.platform !== "win32") throw new Error("the Windows setup can only be built on Windows.");
  const iscc = await findIscc();
  if (!iscc) {
    const message = "Inno Setup was not found, so the setup wizard was not built. Install it with: winget install JRSoftware.InnoSetup";
    if (optional) { console.log(`\nNote: ${message}`); return; }
    throw new Error(message);
  }

  const version = await appVersion();
  const appDir = await findRuntime(".exe");
  const webView2 = await ensureWebView2Bootstrapper();
  await mkdir(OUTPUT, { recursive: true });
  console.log(`Building the setup wizard for ${appDir}`);
  const proc = Bun.spawn([
    iscc, "/Q",
    `/DAppVersion=${version}`,
    `/DAppDir=${appDir}`,
    `/DIconFile=${join(ROOT, "desktop", "icon.ico")}`,
    `/DLicenseFile=${join(ROOT, "LICENSE")}`,
    `/DWebView2Setup=${webView2}`,
    `/DOutputDir=${OUTPUT}`,
    `/DOutputName=${OUTPUT_NAME}`,
    join(ROOT, "installer", "windows-setup.iss"),
  ], { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  if (await proc.exited !== 0) throw new Error("Inno Setup failed. See the messages above.");
  console.log(join(OUTPUT, `${OUTPUT_NAME}.exe`));
}

if (import.meta.main) {
  await packageWindows().catch((error: unknown) => {
    console.error(`\npackage-windows: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
