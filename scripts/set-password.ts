import { z } from "zod";
import { claimLocalProfile, setUserPassword } from "../src/server/auth/sql.ts";
import { sql } from "../src/server/db.ts";

// usage: bun [--env-file=/etc/btg/btg.env] scripts/set-password.ts <email> [--claim-local]
// Sets a new password for an existing account and signs it out everywhere (operator-assisted reset).
// --claim-local renames the pre-accounts local profile (local@localhost) to <email>, keeping all its lessons and history.
// The password is read from stdin: typed without echo on a terminal, or piped.

const MIN_PASSWORD = 12;
const Email = z.string().trim().toLowerCase().max(254).pipe(z.email());

// O(n) in input length
// SEC: echo is turned off while a terminal user types the password; it is never printed or logged
async function readPassword(): Promise<string> {
  const tty = process.stdin.isTTY === true;
  if (tty) {
    process.stdout.write("New password: ");
    Bun.spawnSync(["stty", "-echo"], { stdin: "inherit" });
  }
  try {
    for await (const line of console) return line;
    return "";
  } finally {
    if (tty) {
      Bun.spawnSync(["stty", "echo"], { stdin: "inherit" });
      process.stdout.write("\n");
    }
  }
}

// O(1) plus one argon2id hash
async function runSetPassword(): Promise<number> {
  const email = Email.safeParse(process.argv[2] ?? "");
  const claim = process.argv.includes("--claim-local");
  if (!email.success) {
    console.error("usage: bun scripts/set-password.ts <email> [--claim-local]");
    return 2;
  }
  const password = await readPassword();
  if (password.length < MIN_PASSWORD || password.length > 256) {
    console.error(`password must be ${MIN_PASSWORD} to 256 characters`);
    return 2;
  }
  const hash = await Bun.password.hash(password, "argon2id");
  try {
    if (claim) {
      const r = await claimLocalProfile(email.data, hash);
      if (r === "taken") console.error(`${email.data} already has an account; sign in with it or pick another email`);
      if (r === "missing") console.error("there is no local profile to claim");
      if (r !== "claimed") return 1;
      console.log(`the local profile is now ${email.data}`);
      return 0;
    }
    if (!(await setUserPassword(email.data, hash))) {
      console.error(`no account for ${email.data}`);
      return 1;
    }
    console.log(`password updated for ${email.data}; all of its sessions were signed out`);
    return 0;
  } finally {
    await sql.close();
  }
}

process.exit(await runSetPassword());
