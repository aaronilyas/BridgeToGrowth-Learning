import { expect, test } from "bun:test";
import { authenticodeCommand, microsoftSignatureError, windowsPowerShellEnv, windowsPowerShellPath } from "./package-windows.ts";

const SIGNED = "Valid|CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US";

test("Windows PowerShell is started without the parent's PSModulePath", () => {
  const env = windowsPowerShellEnv(
    { PATH: "C:\\Windows", PSModulePath: "C:\\Program Files\\PowerShell\\7\\Modules", psmodulepath: "also-dropped", PSMODULEPATH: "dropped-too", KEEP: "yes" },
    { BTG_AUTHENTICODE_FILE: "C:\\cache\\MicrosoftEdgeWebview2Setup.exe" },
  );
  expect(env.PATH).toBe("C:\\Windows");
  expect(env.KEEP).toBe("yes");
  expect(env.BTG_AUTHENTICODE_FILE).toBe("C:\\cache\\MicrosoftEdgeWebview2Setup.exe");
  expect(Object.keys(env).some((key) => key.toLowerCase() === "psmodulepath")).toBe(false);
});

test("an explicit env value replaces the same name from the parent", () => {
  const env = windowsPowerShellEnv({ BTG_AUTHENTICODE_FILE: "parent" }, { BTG_AUTHENTICODE_FILE: "child" });
  expect(env.BTG_AUTHENTICODE_FILE).toBe("child");
});

test("Windows PowerShell is the in-box 5.1 binary under SystemRoot", () => {
  expect(windowsPowerShellPath({ SystemRoot: "C:\\Windows" })).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  expect(windowsPowerShellPath({ SYSTEMROOT: "D:/Windows" })).toBe("D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  expect(() => windowsPowerShellPath({})).toThrow("not set");
  expect(() => windowsPowerShellPath({ SystemRoot: "Windows" })).toThrow("not an absolute path");
});

test("the signature command loads 5.1's Security module and does not embed the file path", () => {
  const command = authenticodeCommand();
  expect(command).toContain('Import-Module "$PSHOME\\Modules\\Microsoft.PowerShell.Security"');
  expect(command).toContain("Get-AuthenticodeSignature -LiteralPath $env:BTG_AUTHENTICODE_FILE");
  expect(command).not.toContain("MicrosoftEdgeWebview2Setup.exe");
  expect(command.startsWith("$ProgressPreference = 'SilentlyContinue'")).toBe(true);
});

test("a valid Microsoft signature is accepted and every other result is rejected", () => {
  expect(microsoftSignatureError(0, SIGNED, "")).toBeNull();
  expect(microsoftSignatureError(0, `Preparing modules\r\n${SIGNED}\r\n`, "noise")).toBeNull();
  expect(microsoftSignatureError(0, "Valid|CN=Contoso, O=Contoso", "")).toContain("not signed by Microsoft (Valid CN=Contoso, O=Contoso)");
  expect(microsoftSignatureError(0, "NotSigned|", "")).toContain("not signed by Microsoft (NotSigned )");
  const failed = microsoftSignatureError(0, "", "CouldNotAutoloadMatchingModule");
  expect(failed).toContain("did not run");
  expect(failed).toContain("powershell exit 0");
  expect(failed).toContain("CouldNotAutoloadMatchingModule");
  expect(microsoftSignatureError(1, "", "")).toContain("powershell exit 1");
});
