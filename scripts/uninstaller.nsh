!macro customUnInstall
  # electron-builder uses the all-users shell context for per-machine installs.
  # electron-updater's cache is per user, so temporarily switch contexts to target the invoking user.
  ${if} $installMode == "all"
    SetShellVarContext current
  ${endif}
  RMDir /r "$LOCALAPPDATA\desktop-updater"
  ${if} $installMode == "all"
    SetShellVarContext all
  ${endif}
!macroend

!macro customUnInstallSection
  Section "AGline cleanup"
    SectionIn RO
    # The main uninstall section removes files first. Move the working directory out of the install tree.
    SetOutPath $TEMP
    RMDir /REBOOTOK "$INSTDIR"
    # The uninstaller executable may still be running from $INSTDIR, leaving the otherwise-empty root.
    # Retry after this process exits; this also works when NSIS cannot queue a reboot rename.
    ExecShell "open" "$SYSDIR\cmd.exe" '/D /C ping -n 3 127.0.0.1 >NUL & rmdir "$INSTDIR"' SW_HIDE
  SectionEnd
!macroend
