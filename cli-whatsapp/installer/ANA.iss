[Setup]
AppId={{9D7D0C8A-9A5E-4C0E-A15D-7B7D3E2C1B6A}
AppName=Asistente de Negociacion Avanzada (ANA)
AppVersion=1.0.0
AppPublisher=Pernexium
DefaultDirName={pf}\Asistente de Negociacion Avanzada (ANA)
DefaultGroupName=Asistente de Negociacion Avanzada (ANA)
OutputDir=..
OutputBaseFilename=ANA-Setup
Compression=lzma
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64

[Files]
Source: "..\dist\ANA.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\browsers\*"; DestDir: "{app}\browsers"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Asistente de Negociacion Avanzada (ANA)"; Filename: "{app}\ANA.exe"
Name: "{commondesktop}\Asistente de Negociacion Avanzada (ANA)"; Filename: "{app}\ANA.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Crear icono en el escritorio"; GroupDescription: "Tareas adicionales:"; Flags: unchecked

[Run]
Filename: "{app}\ANA.exe"; Description: "Ejecutar Asistente de Negociacion Avanzada (ANA)"; Flags: nowait postinstall skipifsilent
