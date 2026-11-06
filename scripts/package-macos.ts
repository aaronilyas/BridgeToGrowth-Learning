// Wraps the macOS desktop build in a disk image: artifacts/BridgeToGrowthLearning-macOS-<arch>.dmg
// Opening it shows the app beside an Applications shortcut, the usual drag-to-install window.
// Needs the stable Electrobun build (bun run desktop:build) and the macOS tools codesign, ditto
// and hdiutil, which every Mac has.
//
// The app is not signed with a Developer ID. It gets an ad-hoc signature, which Apple silicon
// requires before it will run the app at all; Gatekeeper still asks the user to allow it once.
import { mkdir, readdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { ROOT } from "./bundle.ts";

const OUTPUT = join(ROOT, "artifacts");
const VOLUME_NAME = "BridgeToGrowth Learning";

// O(1)
async function run(argv: string[]): Promise<number> {
  const proc = Bun.spawn(argv, { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  return proc.exited;
}

// O(n) in build folders. The stable build's .app is the app Electrobun ships; it unpacks itself
// into ~/Library/Application Support on first launch.
async function findApp(): Promise<string> {
  const build = join(ROOT, "desktop", "build");
  for (const dir of (await readdir(build).catch(() => [])).filter((name) => name.startsWith("stable-macos-"))) {
    const app = (await readdir(join(build, dir))).find((name) => name.endsWith(".app"));
    if (app) return join(build, dir, app);
  }
  throw new Error("no stable macOS app found under desktop/build. Run the desktop build first.");
}

// O(n) in app size
async function packageMacos(): Promise<void> {
  if (process.platform !== "darwin") throw new Error("the macOS disk image can only be built on macOS.");
  const app = await findApp();
  const appName = app.split("/").pop() as string;
  const stage = join(OUTPUT, "dmg-stage");
  const output = join(OUTPUT, `BridgeToGrowthLearning-macOS-${process.arch}.dmg`);

  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  if (await run(["ditto", app, join(stage, appName)]) !== 0) throw new Error("copying the app failed.");
  await symlink("/Applications", join(stage, "Applications"));

  console.log(`Signing ${appName} (ad-hoc)`);
  if (await run(["codesign", "--force", "--deep", "--sign", "-", join(stage, appName)]) !== 0) throw new Error("codesign failed.");

  console.log("Building the disk image");
  await rm(output, { force: true });
  // hdiutil sometimes fails with "Resource busy" on CI machines; a retry clears it.
  for (let attempt = 1; ; attempt++) {
    const code = await run(["hdiutil", "create", "-volname", VOLUME_NAME, "-srcfolder", stage, "-fs", "HFS+", "-format", "UDZO", "-ov", output]);
    if (code === 0) break;
    if (attempt === 3) throw new Error("hdiutil failed to create the disk image.");
    await Bun.sleep(5000);
  }
  await rm(stage, { recursive: true, force: true });
  console.log(output);
}

await packageMacos().catch((error: unknown) => {
  console.error(`\npackage-macos: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
