; ==============================================
; RheoLab Enterprise - NSIS Installer Hooks
; Provides option to delete user data on uninstall
; ==============================================

; Variable to store user's choice
Var DeleteUserData

; ==============================================
; INSTALL: Refresh existing shortcuts with explicit app icon
; ==============================================
!macro NSIS_HOOK_POSTINSTALL
  ; Tauri's update mode preserves existing shortcuts. Windows Explorer can keep
  ; showing a stale EXE icon when the shortcut has an empty IconLocation, so pin
  ; shortcuts to the bundled ICO resource and notify the shell.
  IfFileExists "$INSTDIR\resources\rheolab-app-icon.ico" 0 iconRefreshDone

  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayIcon" "$\"$INSTDIR\resources\rheolab-app-icon.ico$\""

  IfFileExists "$SMPROGRAMS\${PRODUCTNAME}.lnk" 0 skipStartMenuRoot
    CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\resources\rheolab-app-icon.ico" 0
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  skipStartMenuRoot:

  !if "${STARTMENUFOLDER}" != ""
    IfFileExists "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" 0 skipStartMenuFolder
      CreateShortcut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\resources\rheolab-app-icon.ico" 0
      !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
    skipStartMenuFolder:
  !endif

  IfFileExists "$DESKTOP\${PRODUCTNAME}.lnk" 0 skipDesktopShortcut
    CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\resources\rheolab-app-icon.ico" 0
    !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
  skipDesktopShortcut:

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'

  iconRefreshDone:
!macroend

; ==============================================
; UNINSTALL: Show dialog asking about data deletion
; ==============================================
!macro NSIS_HOOK_PREUNINSTALL
  ; Ask user if they want to delete all application data
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Удалить все данные приложения (эксперименты, настройки, лицензию)?$\n$\nDelete all application data (experiments, settings, license)?" \
    /SD IDNO \
    IDYES deleteData IDNO keepData
  
  deleteData:
    StrCpy $DeleteUserData "1"
    Goto done
    
  keepData:
    StrCpy $DeleteUserData "0"
    
  done:
!macroend

; ==============================================
; UNINSTALL: Delete user data if requested
; ==============================================
!macro NSIS_HOOK_POSTUNINSTALL
  ; Check if user chose to delete data
  StrCmp $DeleteUserData "1" 0 skipDelete
  
  ; Delete application data folder
  ; Path: %LOCALAPPDATA%\com.rheolab.enterprise
  RMDir /r "$LOCALAPPDATA\com.rheolab.enterprise"
  
  ; Show confirmation
  MessageBox MB_OK|MB_ICONINFORMATION \
    "Все данные приложения удалены.$\n$\nAll application data has been deleted."
  
  skipDelete:
!macroend
