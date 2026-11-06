; Setup wizard for BridgeToGrowth Learning on Windows (Inno Setup 6.3 or newer).
; Build it with `bun scripts/package-windows.ts`, which passes the defines below to ISCC.
;
; The wizard: welcome, license, install for me or for everyone, folder, desktop shortcut, install,
; launch. It adds a Start menu entry and an uninstaller in Settings > Apps, and installs the
; Microsoft Edge WebView2 runtime (the app's window) when the computer does not have it.

#ifndef AppVersion
  #error Run bun scripts/package-windows.ts instead of compiling this file directly.
#endif

#define AppName "BridgeToGrowth Learning"
#define AppExe "bin\launcher.exe"
#define AppIcon "BridgeToGrowthLearning.ico"
#define RepoUrl "https://github.com/aaronilyas/BridgeToGrowth-Learning"

[Setup]
; AppId identifies the app across versions, so a newer setup upgrades in place. Never change it.
AppId={{4D6E1CB5-88A4-4AD7-BA1D-90373B978574}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=BridgeToGrowth
AppPublisherURL={#RepoUrl}
AppSupportURL={#RepoUrl}/issues
AppUpdatesURL={#RepoUrl}/releases
VersionInfoVersion={#AppVersion}
VersionInfoProductName={#AppName}
VersionInfoDescription={#AppName} Setup
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableWelcomePage=no
; Installs for the current user without an administrator prompt; the wizard offers "all users".
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
LicenseFile={#LicenseFile}
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\{#AppIcon}
UninstallDisplayName={#AppName}
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
OutputDir={#OutputDir}
OutputBaseFilename={#OutputName}
CloseApplications=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#AppDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#IconFile}"; DestDir: "{app}"; DestName: "{#AppIcon}"; Flags: ignoreversion
Source: "{#WebView2Setup}"; DestDir: "{tmp}"; DestName: "MicrosoftEdgeWebview2Setup.exe"; Flags: deleteafterinstall; Check: NeedsWebView2

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}\bin"; IconFilename: "{app}\{#AppIcon}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}\bin"; IconFilename: "{app}\{#AppIcon}"; Tasks: desktopicon

[Run]
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "Installing the Microsoft Edge WebView2 runtime..."; Check: NeedsWebView2; Flags: waituntilterminated
Filename: "{app}\{#AppExe}"; WorkingDir: "{app}\bin"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent runasoriginaluser

[Code]
const
  WebView2Key = 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

// The runtime is registered per machine (32-bit registry view) or per user. Windows 11 ships it.
function HasWebView2In(RootKey: Integer): Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(RootKey, WebView2Key, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0');
end;

function NeedsWebView2: Boolean;
begin
  Result := not (HasWebView2In(HKLM32) or HasWebView2In(HKLM64) or HasWebView2In(HKCU));
end;
