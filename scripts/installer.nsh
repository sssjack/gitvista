; Standard assisted NSIS installer. Keep existing install locations and explicit /D overrides.
!macro customInit
  ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $0 == ""
    !insertmacro GetDParameter $1
    ${If} $1 == ""
      StrCpy $INSTDIR "D:\LenovoSoftstore\GitVista"
    ${EndIf}
  ${EndIf}
!macroend

; Never recursively remove the installation directory: users may keep repositories there.
; Hash-checked program files only; settings under APPDATA are deliberately untouched.
!macro customRemoveFiles
  InitPluginsDir
  SetOutPath $PLUGINSDIR
  File /oname=gitvista-uninstall.ps1 "${PROJECT_DIR}\scripts\uninstall-files.ps1"
  File /oname=storage-utils.ps1 "${PROJECT_DIR}\scripts\storage-utils.ps1"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\gitvista-uninstall.ps1" -InstallDirectory "$INSTDIR"'
  Pop $0
  ${If} $0 != 0
    SetErrorLevel 2
    Abort "GitVista files are busy or were modified. Your files were preserved. Close GitVista and retry."
  ${EndIf}
  Delete /REBOOTOK "$INSTDIR\${UNINSTALL_FILENAME}"
  RMDir "$INSTDIR"
!macroend
