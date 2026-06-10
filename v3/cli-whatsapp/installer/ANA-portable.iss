; Script de Inno Setup para ANA - Instalador Portable
; Incluye Node.js, Playwright y todas las dependencias

[Setup]
AppId={{9D7D0C8A-9A5E-4C0E-A15D-7B7D3E2C1B6A}
AppName=Asistente de Negociacion Avanzada (ANA)
AppVersion=1.0.0
AppPublisher=Pernexium
AppPublisherURL=https://pernexium.com
AppSupportURL=https://pernexium.com/support
AppUpdatesURL=https://pernexium.com/updates
DefaultDirName={autopf}\ANA
DefaultGroupName=Asistente de Negociacion Avanzada
DisableProgramGroupPage=yes
OutputDir=..\dist-portable
OutputBaseFilename=ANA-Setup-Portable
; SetupIconFile=..\banner.png
Compression=lzma2/ultra64
SolidCompression=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
DisableWelcomePage=no
LicenseFile=
InfoBeforeFile=
InfoAfterFile=
UninstallDisplayIcon={app}\ANA.bat

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "Crear icono en el escritorio"; GroupDescription: "Iconos adicionales:"

[Files]
; Node.js portable
Source: "..\dist-portable\nodejs\*"; DestDir: "{app}\nodejs"; Flags: ignoreversion recursesubdirs createallsubdirs

; Aplicación y dependencias
Source: "..\dist-portable\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs

; Navegadores de Playwright
Source: "..\dist-portable\browsers\*"; DestDir: "{app}\browsers"; Flags: ignoreversion recursesubdirs createallsubdirs

; Scripts de inicio
Source: "..\dist-portable\ANA.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist-portable\ANA-con-imagen.bat"; DestDir: "{app}"; Flags: ignoreversion

; Archivos adicionales (README, etc.)
; Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion isreadme

[Icons]
Name: "{group}\ANA"; Filename: "{app}\ANA.bat"; WorkingDir: "{app}"; Comment: "Asistente de Negociacion Avanzada"
Name: "{group}\ANA (con imagen)"; Filename: "{app}\ANA-con-imagen.bat"; WorkingDir: "{app}"; Comment: "ANA con soporte para imagen desde portapapeles"
Name: "{group}\Desinstalar ANA"; Filename: "{uninstallexe}"
Name: "{autodesktop}\ANA"; Filename: "{app}\ANA.bat"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\ANA.bat"; Description: "Ejecutar Asistente de Negociacion Avanzada"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent shellexec

[UninstallDelete]
Type: filesandordirs; Name: "{app}\app\whatsapp-session"
Type: filesandordirs; Name: "{app}\app\whatsapp-session-manual"
Type: filesandordirs; Name: "{app}\app\node_modules"

[Code]
function InitializeSetup(): Boolean;
begin
  Result := True;
  if not IsWin64 then
  begin
    MsgBox('Este instalador requiere Windows de 64 bits.', mbError, MB_OK);
    Result := False;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    // Crear directorios de trabajo si no existen
    if not DirExists(ExpandConstant('{app}\app\whatsapp-session')) then
      CreateDir(ExpandConstant('{app}\app\whatsapp-session'));
    if not DirExists(ExpandConstant('{app}\app\whatsapp-session-manual')) then
      CreateDir(ExpandConstant('{app}\app\whatsapp-session-manual'));
  end;
end;
