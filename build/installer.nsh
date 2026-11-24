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
