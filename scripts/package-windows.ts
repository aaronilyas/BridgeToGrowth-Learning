// Wraps the Windows desktop build in a setup wizard: artifacts/BridgeToGrowthLearning-Setup-x64.exe
// Needs the stable Electrobun build (bun run desktop:build) and Inno Setup 6.3 or newer
// (winget install JRSoftware.InnoSetup). With --optional, a missing Inno Setup is a note, not an error.
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, appVersion, findRuntime } from "./bundle.ts";

const OUTPUT = join(ROOT, "artifacts");
const OUTPUT_NAME = "BridgeToGrowthLearning-Setup-x64";
const WEBVIEW2_URL = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";
const WEBVIEW2 = join(ROOT, "scripts", "cache", "webview2", "MicrosoftEdgeWebview2Setup.exe");

// O(1)
async function run(argv: string[]): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn(argv, { cwd: ROOT, stdout: "pipe", stderr: "inherit" });
  const stdout = await new Response(proc.stdout).text();
  return { code: await proc.exited, stdout };
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
  const check = await run([
    "powershell", "-NoProfile", "-Command",
    `$s = Get-AuthenticodeSignature -LiteralPath '${WEBVIEW2.replaceAll("'", "''")}';"$($s.Status)|$($s.SignerCertificate.Subject)"`,
  ]);
  const [status = "", subject = ""] = check.stdout.trim().split("|");
  if (check.code !== 0 || status !== "Valid" || !subject.includes("O=Microsoft Corporation")) {
    await Bun.file(WEBVIEW2).delete().catch(() => undefined);
    throw new Error(`the WebView2 bootstrapper is not signed by Microsoft (${status} ${subject}). It was deleted; run again to download it fresh.`);
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

await packageWindows().catch((error: unknown) => {
  console.error(`\npackage-windows: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
