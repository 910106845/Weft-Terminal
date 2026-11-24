; Weft Terminal NSIS upgrade hardening
; 升级时先结束旧进程，并允许旧卸载器失败后继续覆盖安装。

!macro customInit
  DetailPrint "Closing Weft Terminal before upgrade..."
  nsExec::Exec 'taskkill /F /IM "Weft Terminal.exe" /T'
  nsExec::Exec 'taskkill /F /IM "Weft Terminal Helper.exe" /T'
  nsExec::Exec 'taskkill /F /IM "Weft Terminal Helper (GPU).exe" /T'
  nsExec::Exec 'taskkill /F /IM "Weft Terminal Helper (Renderer).exe" /T'
  Sleep 500
!macroend

!macro customUnInstallCheck
  DetailPrint "Old uninstaller reported an error; continuing with upgrade."
!macroend

!macro customUnInstallCheckCurrentUser
  DetailPrint "Old current-user uninstaller reported an error; continuing with upgrade."
!macroend

; 静默升级（OTA）完成后自动启动新版本。
; 同时再结束一次旧进程，兼容旧版 updater 在安装过程中 app.relaunch 的情况。
!macro customInstall
  ${if} ${Silent}
    DetailPrint "Restarting Weft Terminal after silent upgrade..."
    nsExec::Exec 'taskkill /F /IM "Weft Terminal.exe" /T'
    nsExec::Exec 'taskkill /F /IM "Weft Terminal Helper.exe" /T'
    nsExec::Exec 'taskkill /F /IM "Weft Terminal Helper (GPU).exe" /T'
    nsExec::Exec 'taskkill /F /IM "Weft Terminal Helper (Renderer).exe" /T'
    Sleep 300
    Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  ${endif}
!macroend
