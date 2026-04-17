; ==============================================
; RheoLab Enterprise - NSIS Installer Hooks
; Provides option to delete user data on uninstall
; ==============================================

; Variable to store user's choice
Var DeleteUserData

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
