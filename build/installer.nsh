!include nsDialogs.nsh

!ifndef BUILD_UNINSTALLER
Var ofbmDesktopChoice
Var ofbmDesktopCheckbox

!macro customHeader
  !undef isNoDesktopShortcut
  !define isNoDesktopShortcut `$ofbmDesktopChoice == 0`
!macroend

!macro customInit
  StrCpy $ofbmDesktopChoice 1
  ${StdUtils.TestParameter} $R9 "no-desktop-shortcut"
  ${If} $R9 == "true"
    StrCpy $ofbmDesktopChoice 0
  ${EndIf}
!macroend

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customPageAfterChangeDir
  Page custom ofbmOptionsCreate ofbmOptionsLeave
  Function ofbmOptionsCreate
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "Installation options" "Choose how to access Open File Backup Manager."
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateLabel} 0 0 100% 28u "Install to:$\r$\n$INSTDIR"
    Pop $0
    ${NSD_CreateCheckbox} 0 42u 100% 14u "Create a desktop shortcut"
    Pop $ofbmDesktopCheckbox
    ${NSD_SetState} $ofbmDesktopCheckbox $ofbmDesktopChoice
    nsDialogs::Show
  FunctionEnd
  Function ofbmOptionsLeave
    ${NSD_GetState} $ofbmDesktopCheckbox $ofbmDesktopChoice
  FunctionEnd
!macroend

!endif

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Open File Backup Manager"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Open File Backup Manager"
    MessageBox MB_YESNO|MB_DEFBUTTON2 "Remove Open File Backup Manager settings and activity logs? Your backup files will not be removed." /SD IDNO IDNO keepData
      RMDir /r "$APPDATA\Open File Backup Manager"
    keepData:
  ${endIf}
!macroend
