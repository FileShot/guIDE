; ═══════════════════════════════════════════════════════════════════════
;  guIDE — Premium NSIS Installer Script
;  Fully branded dark-themed installer — every element customized
;  Copyright (c) 2025-2026 Brendan Gray / GraySoft LLC
; ═══════════════════════════════════════════════════════════════════════

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "WinMessages.nsh"
!include "LogicLib.nsh"

; ─── Color Palette ──────────────────────────────────────────────────
; Background: #1a1a1a (dark)  |  Text: #e0e0e0 (light)
; Accent: #007acc (blue)      |  Accent hover: #1a8ad4
; Secondary BG: #252526       |  Border: #3e3e42
; Success: #89d185            |  Muted: #858585
; ────────────────────────────────────────────────────────────────────

; ─── Global Appearance ──────────────────────────────────────────────
!define MUI_BGCOLOR "1a1a1a"
!define MUI_TEXTCOLOR "e0e0e0"

; ─── Header ─────────────────────────────────────────────────────────
!ifndef MUI_HEADER_TRANSPARENT_TEXT
  !define MUI_HEADER_TRANSPARENT_TEXT
!endif
!ifndef MUI_HEADERIMAGE
  !define MUI_HEADERIMAGE
!endif
!ifndef MUI_HEADERIMAGE_RIGHT
  !define MUI_HEADERIMAGE_RIGHT
!endif
!ifndef MUI_HEADERIMAGE_BITMAP
  !define MUI_HEADERIMAGE_BITMAP "${BUILD_RESOURCES_DIR}\installerHeader.bmp"
!endif

; ─── Sidebar Bitmaps ───────────────────────────────────────────────
; Welcome + Finish pages use the tall sidebar bitmap
!ifndef MUI_WELCOMEFINISHPAGE_BITMAP
  !define MUI_WELCOMEFINISHPAGE_BITMAP "${BUILD_RESOURCES_DIR}\installerSidebar.bmp"
!endif
!ifndef MUI_WELCOMEFINISHPAGE_BITMAP_NOSTRETCH
  !define MUI_WELCOMEFINISHPAGE_BITMAP_NOSTRETCH
!endif
!ifndef MUI_UNWELCOMEFINISHPAGE_BITMAP
  !define MUI_UNWELCOMEFINISHPAGE_BITMAP "${BUILD_RESOURCES_DIR}\installerSidebar.bmp"
!endif
!ifndef MUI_UNWELCOMEFINISHPAGE_BITMAP_NOSTRETCH
  !define MUI_UNWELCOMEFINISHPAGE_BITMAP_NOSTRETCH
!endif

; ─── Icons ──────────────────────────────────────────────────────────
!ifndef MUI_ICON
  !define MUI_ICON "${BUILD_RESOURCES_DIR}\icon.ico"
!endif
!ifndef MUI_UNICON
  !define MUI_UNICON "${BUILD_RESOURCES_DIR}\icon.ico"
!endif

; ─── Branding ───────────────────────────────────────────────────────
!define MUI_BRANDINGTEXT "guIDE v2.0 — AI-Powered Code Editor by GraySoft"

; ─── Install Details Pane — show & expand by default ────────────────
ShowInstDetails show

; ─── Abort Warning ──────────────────────────────────────────────────
!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT "Are you sure you want to cancel guIDE installation?"
!define MUI_ABORTWARNING_CANCEL_DEFAULT

; ═══════════════════════════════════════════════════════════════════════
;  WELCOME PAGE
; ═══════════════════════════════════════════════════════════════════════
!define MUI_WELCOMEPAGE_TITLE "Welcome to guIDE Setup"
!define MUI_WELCOMEPAGE_TITLE_3LINES
!define MUI_WELCOMEPAGE_TEXT "\
guIDE is a premium AI-powered code editor built for developers who want full \
control over their AI tools.$\r$\n$\r$\n\
  >>  Local LLM inference - GPU-accelerated, fully offline$\r$\n\
  >>  53+ autonomous MCP tools built in$\r$\n\
  >>  9 cloud AI providers (OpenAI, Anthropic, etc.)$\r$\n\
  >>  Browser automation via Playwright$\r$\n\
  >>  Integrated terminal & code runner (25+ languages)$\r$\n\
  >>  Git integration & RAG engine$\r$\n$\r$\n\
No subscriptions. No rate limits. Your models, your machine.$\r$\n$\r$\n\
Click Next to continue."

; ═══════════════════════════════════════════════════════════════════════
;  LICENSE PAGE
; ═══════════════════════════════════════════════════════════════════════
!define MUI_LICENSEPAGE_CHECKBOX
!define MUI_LICENSEPAGE_CHECKBOX_TEXT "I accept the terms of the license agreement"

; ═══════════════════════════════════════════════════════════════════════
;  DIRECTORY PAGE
; ═══════════════════════════════════════════════════════════════════════
!define MUI_DIRECTORYPAGE_TEXT_TOP "guIDE will be installed in the following folder. Click Browse to choose a different location.$\r$\n$\r$\nIMPORTANT: guIDE bundles CUDA GPU-acceleration libraries and a full AI inference engine (~600 MB). Installation takes 5–10 minutes. The progress bar WILL appear frozen for several minutes while the CUDA libraries are extracted — this is normal and the installer has NOT crashed. Please be patient and do not close the installer."
!define MUI_DIRECTORYPAGE_TEXT_DESTINATION "Installation Folder"

; ═══════════════════════════════════════════════════════════════════════
;  INSTALL PAGE
; ═══════════════════════════════════════════════════════════════════════
!define MUI_INSTFILESPAGE_FINISHHEADER_TEXT "Installation Complete"
!define MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT "guIDE has been installed successfully on your computer."
!define MUI_INSTFILESPAGE_ABORTHEADER_TEXT "Installation Aborted"
!define MUI_INSTFILESPAGE_ABORTHEADER_SUBTEXT "guIDE installation was cancelled."

; ═══════════════════════════════════════════════════════════════════════
;  FINISH PAGE
; ═══════════════════════════════════════════════════════════════════════
!define MUI_FINISHPAGE_TITLE "guIDE is Ready"
!define MUI_FINISHPAGE_TITLE_3LINES
!define MUI_FINISHPAGE_TEXT "\
guIDE has been installed successfully.$\r$\n$\r$\n\
On first launch, guIDE will detect your hardware and recommend the best \
local AI model for your system.$\r$\n$\r$\n\
Visit graysoft.dev/models to browse and download GGUF models.$\r$\n$\r$\n\
Enjoy coding with AI — no rate limits, no subscriptions."

!define MUI_FINISHPAGE_RUN_TEXT "Launch guIDE now"
!define MUI_FINISHPAGE_LINK "Visit graysoft.dev"
!define MUI_FINISHPAGE_LINK_LOCATION "https://graysoft.dev"
!define MUI_FINISHPAGE_LINK_COLOR "4fc1ff"
!define MUI_FINISHPAGE_NOREBOOTSUPPORT

; ═══════════════════════════════════════════════════════════════════════
;  UNINSTALLER PAGES
; ═══════════════════════════════════════════════════════════════════════
!define MUI_UNCONFIRMPAGE_TEXT_TOP "guIDE will be uninstalled from your computer. Your models and project files will not be deleted."
!define MUI_UNFINISHPAGE_NOAUTOCLOSE

; ═══════════════════════════════════════════════════════════════════════
;  CUSTOM MACROS — Dark theme every page element
; ═══════════════════════════════════════════════════════════════════════

!macro customHeader
  ; Header theming via MUI2 defines + custom bitmap
!macroend

!macro customInit
  SetSilent normal
  ; Enable verbose per-file logging in the details pane for the entire install,
  ; including the 7z archive extraction. Must be set here (before extraction starts)
  ; — setting it in customInstall is too late, files are already written by then.
  ; NOTE: ShowInstDetails is only valid in Sections, not in Functions/Macros.
  ; Details-pane visibility is controlled by the MUI_INSTFILESPAGE_ELINES_TOP
  ; show/hide switch in the electron-builder config instead.
  SetDetailsPrint both
!macroend


; ═══════════════════════════════════════════════════════════════════════
;  FINISH PAGE — Extra theming for checkboxes and links
; ═══════════════════════════════════════════════════════════════════════
!macro customFinishRun
  FindWindow $0 "#32770" "" $HWNDPARENT

  ; Theme all text items on the finish page (1200–1215 range)
  GetDlgItem $1 $0 1200
  ${If} $1 != 0
    SetCtlColors $1 "e0e0e0" "1a1a1a"
  ${EndIf}
  GetDlgItem $1 $0 1201
  ${If} $1 != 0
    SetCtlColors $1 "e0e0e0" "1a1a1a"
  ${EndIf}
  GetDlgItem $1 $0 1202
  ${If} $1 != 0
    SetCtlColors $1 "e0e0e0" "1a1a1a"
  ${EndIf}
  GetDlgItem $1 $0 1205
  ${If} $1 != 0
    SetCtlColors $1 "e0e0e0" "1a1a1a"
  ${EndIf}
  GetDlgItem $1 $0 1206
  ${If} $1 != 0
    SetCtlColors $1 "e0e0e0" "1a1a1a"
  ${EndIf}
  GetDlgItem $1 $0 1207
  ${If} $1 != 0
    SetCtlColors $1 "e0e0e0" "1a1a1a"
  ${EndIf}
  GetDlgItem $1 $0 1208
  ${If} $1 != 0
    SetCtlColors $1 "e0e0e0" "1a1a1a"
  ${EndIf}
  GetDlgItem $1 $0 1209
  ${If} $1 != 0
    SetCtlColors $1 "e0e0e0" "1a1a1a"
  ${EndIf}
  GetDlgItem $1 $0 1210
  ${If} $1 != 0
    SetCtlColors $1 "e0e0e0" "1a1a1a"
  ${EndIf}

  ; "Launch guIDE now" checkbox — white text
  ; Controls 1203 and 1204 are in the CHILD dialog ($0), not the parent window
  GetDlgItem $1 $0 1203
  ${If} $1 != 0
    SetCtlColors $1 "ffffff" "1a1a1a"
  ${EndIf}
  ; Fallback: also try direct child enumeration in case ID varies by MUI2 version
  GetDlgItem $1 $HWNDPARENT 1203
  ${If} $1 != 0
    SetCtlColors $1 "ffffff" "1a1a1a"
  ${EndIf}

  ; "Visit graysoft.dev" link — accent blue
  GetDlgItem $1 $0 1204
  ${If} $1 != 0
    SetCtlColors $1 "4fc1ff" "1a1a1a"
  ${EndIf}
  GetDlgItem $1 $HWNDPARENT 1204
  ${If} $1 != 0
    SetCtlColors $1 "4fc1ff" "1a1a1a"
  ${EndIf}

  ; Navigation buttons — accent Next, dark Back/Cancel
  GetDlgItem $1 $HWNDPARENT 1  ; Next/Finish
  ${If} $1 != 0
    SetCtlColors $1 "ffffff" "007acc"
  ${EndIf}
  GetDlgItem $1 $HWNDPARENT 2  ; Cancel
  ${If} $1 != 0
    SetCtlColors $1 "e0e0e0" "333333"
  ${EndIf}
  GetDlgItem $1 $HWNDPARENT 3  ; Back
  ${If} $1 != 0
    SetCtlColors $1 "e0e0e0" "333333"
  ${EndIf}

  ; Branding text — muted
  GetDlgItem $1 $HWNDPARENT 1256
  ${If} $1 != 0
    SetCtlColors $1 "858585" "1a1a1a"
  ${EndIf}

  ; Main window background
  SetCtlColors $HWNDPARENT "e0e0e0" "1a1a1a"
!macroend

; ═══════════════════════════════════════════════════════════════════════
;  CUSTOM INSTALL ACTIONS
; ═══════════════════════════════════════════════════════════════════════
!macro customInstall
  ; (SetDetailsPrint both is set in customInit — applies to the full install including extraction)

  DetailPrint ""
  DetailPrint "  ╔══════════════════════════════════════════════════════╗"
  DetailPrint "  ║          guIDE — Installation in Progress            ║"
  DetailPrint "  ╚══════════════════════════════════════════════════════╝"
  DetailPrint ""
  DetailPrint "  guIDE includes CUDA GPU-acceleration libraries and a full"
  DetailPrint "  local AI inference engine. Total size: ~600 MB."
  DetailPrint ""
  DetailPrint "  ⚠  WHY THE PROGRESS BAR PAUSES:"
  DetailPrint "     The installer is extracting CUDA runtime libraries"
  DetailPrint "     (cublas, curand, ggml backends). These are large binary"
  DetailPrint "     files that take time to decompress and write to disk."
  DetailPrint "     This is NORMAL — the installer has not crashed."
  DetailPrint ""
  DetailPrint "  ⏱  EXPECTED TIME: 5–10 minutes on most machines."
  DetailPrint "     Slower HDDs or antivirus scanning may extend this."
  DetailPrint ""
  DetailPrint "  ✋  DO NOT close this window. Installation is running."
  DetailPrint "  ──────────────────────────────────────────────────────"
  DetailPrint ""
  DetailPrint ""

  ; Create models directory for GGUF files
  CreateDirectory "$INSTDIR\models"

  ; Create a README in the models directory
  FileOpen $0 "$INSTDIR\models\README.txt" w
  FileWrite $0 "guIDE — Local AI Model Directory$\r$\n"
  FileWrite $0 "=================================$\r$\n"
  FileWrite $0 "$\r$\n"
  FileWrite $0 "Place your GGUF model files in this directory.$\r$\n"
  FileWrite $0 "$\r$\n"
  FileWrite $0 "Recommended models:$\r$\n"
  FileWrite $0 "  - qwen2.5-coder-7b-instruct-q4_k_m.gguf (best for coding)$\r$\n"
  FileWrite $0 "  - qwen3-4b-q4_k_m.gguf (best for general use)$\r$\n"
  FileWrite $0 "  - phi-4-mini-instruct-q4_k_m.gguf (great for math/reasoning)$\r$\n"
  FileWrite $0 "$\r$\n"
  FileWrite $0 "Browse and download models at: https://graysoft.dev/models$\r$\n"
  FileWrite $0 "$\r$\n"
  FileWrite $0 "guIDE will auto-detect models in this directory on startup.$\r$\n"
  FileClose $0

  ; ── File Associations ──

  ; .gguf model files → open with guIDE
  WriteRegStr HKCR ".gguf" "" "guIDE.ModelFile"
  WriteRegStr HKCR "guIDE.ModelFile" "" "GGUF Model File"
  WriteRegStr HKCR "guIDE.ModelFile\DefaultIcon" "" '"$INSTDIR\guIDE.exe",0'
  WriteRegStr HKCR "guIDE.ModelFile\shell\open\command" "" '"$INSTDIR\guIDE.exe" "%1"'

  ; Common code files — "Open with guIDE" option
  WriteRegStr HKCR ".js\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR ".ts\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR ".tsx\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR ".jsx\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR ".py\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR ".json\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR ".html\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR ".css\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR ".md\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR ".c\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR ".cpp\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR ".h\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR ".java\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR ".rs\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR ".go\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR ".rb\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR ".php\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR ".swift\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR ".kt\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR ".yaml\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR ".yml\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR ".toml\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR ".xml\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR ".sql\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR ".sh\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR ".bat\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR ".ps1\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR ".vue\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR ".svelte\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR ".astro\OpenWithProgids" "guIDE.CodeFile" ""
  WriteRegStr HKCR "guIDE.CodeFile" "" "Code File (guIDE)"
  WriteRegStr HKCR "guIDE.CodeFile\DefaultIcon" "" '"$INSTDIR\guIDE.exe",0'
  WriteRegStr HKCR "guIDE.CodeFile\shell\open\command" "" '"$INSTDIR\guIDE.exe" "%1"'

  ; ── Explorer Context Menu ──

  ; Right-click on a folder → "Open with guIDE"
  WriteRegStr HKCR "Directory\shell\guIDE" "" "Open with guIDE"
  WriteRegStr HKCR "Directory\shell\guIDE" "Icon" '"$INSTDIR\guIDE.exe"'
  WriteRegStr HKCR "Directory\shell\guIDE\command" "" '"$INSTDIR\guIDE.exe" "%V"'

  ; Right-click on folder background → "Open with guIDE"
  WriteRegStr HKCR "Directory\Background\shell\guIDE" "" "Open with guIDE"
  WriteRegStr HKCR "Directory\Background\shell\guIDE" "Icon" '"$INSTDIR\guIDE.exe"'
  WriteRegStr HKCR "Directory\Background\shell\guIDE\command" "" '"$INSTDIR\guIDE.exe" "%V"'

  ; Right-click on a file → "Open with guIDE"
  WriteRegStr HKCR "*\shell\guIDE" "" "Open with guIDE"
  WriteRegStr HKCR "*\shell\guIDE" "Icon" '"$INSTDIR\guIDE.exe"'
  WriteRegStr HKCR "*\shell\guIDE\command" "" '"$INSTDIR\guIDE.exe" "%1"'

  ; ── PATH Registration ──
  ; Set GUIDE_HOME environment variable
  WriteRegStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "GUIDE_HOME" "$INSTDIR"

  ; Notify shell of association changes
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, p 0, p 0)'
!macroend

; ═══════════════════════════════════════════════════════════════════════
;  CUSTOM UNINSTALL ACTIONS
; ═══════════════════════════════════════════════════════════════════════
!macro customUnInstall
  ; Clean up file associations
  DeleteRegKey HKCR ".gguf"
  DeleteRegKey HKCR "guIDE.ModelFile"
  DeleteRegKey HKCR "guIDE.CodeFile"
  DeleteRegKey HKCR "Directory\shell\guIDE"
  DeleteRegKey HKCR "Directory\Background\shell\guIDE"
  DeleteRegKey HKCR "*\shell\guIDE"

  ; Clean up OpenWithProgids
  DeleteRegValue HKCR ".js\OpenWithProgids" "guIDE.CodeFile"
  DeleteRegValue HKCR ".ts\OpenWithProgids" "guIDE.CodeFile"
  DeleteRegValue HKCR ".tsx\OpenWithProgids" "guIDE.CodeFile"
  DeleteRegValue HKCR ".jsx\OpenWithProgids" "guIDE.CodeFile"
  DeleteRegValue HKCR ".py\OpenWithProgids" "guIDE.CodeFile"
  DeleteRegValue HKCR ".json\OpenWithProgids" "guIDE.CodeFile"
  DeleteRegValue HKCR ".html\OpenWithProgids" "guIDE.CodeFile"
  DeleteRegValue HKCR ".css\OpenWithProgids" "guIDE.CodeFile"
  DeleteRegValue HKCR ".md\OpenWithProgids" "guIDE.CodeFile"
  DeleteRegValue HKCR ".c\OpenWithProgids" "guIDE.CodeFile"
  DeleteRegValue HKCR ".cpp\OpenWithProgids" "guIDE.CodeFile"
  DeleteRegValue HKCR ".h\OpenWithProgids" "guIDE.CodeFile"
  DeleteRegValue HKCR ".java\OpenWithProgids" "guIDE.CodeFile"
  DeleteRegValue HKCR ".rs\OpenWithProgids" "guIDE.CodeFile"
  DeleteRegValue HKCR ".go\OpenWithProgids" "guIDE.CodeFile"
  DeleteRegValue HKCR ".rb\OpenWithProgids" "guIDE.CodeFile"
  DeleteRegValue HKCR ".php\OpenWithProgids" "guIDE.CodeFile"
  DeleteRegValue HKCR ".swift\OpenWithProgids" "guIDE.CodeFile"
  DeleteRegValue HKCR ".kt\OpenWithProgids" "guIDE.CodeFile"
  DeleteRegValue HKCR ".yaml\OpenWithProgids" "guIDE.CodeFile"
  DeleteRegValue HKCR ".yml\OpenWithProgids" "guIDE.CodeFile"
  DeleteRegValue HKCR ".toml\OpenWithProgids" "guIDE.CodeFile"
  DeleteRegValue HKCR ".xml\OpenWithProgids" "guIDE.CodeFile"
  DeleteRegValue HKCR ".sql\OpenWithProgids" "guIDE.CodeFile"
  DeleteRegValue HKCR ".sh\OpenWithProgids" "guIDE.CodeFile"
  DeleteRegValue HKCR ".bat\OpenWithProgids" "guIDE.CodeFile"
  DeleteRegValue HKCR ".ps1\OpenWithProgids" "guIDE.CodeFile"
  DeleteRegValue HKCR ".vue\OpenWithProgids" "guIDE.CodeFile"
  DeleteRegValue HKCR ".svelte\OpenWithProgids" "guIDE.CodeFile"
  DeleteRegValue HKCR ".astro\OpenWithProgids" "guIDE.CodeFile"

  ; Clean up PATH
  DeleteRegValue HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "GUIDE_HOME"

  ; Remove models directory if empty
  RMDir "$INSTDIR\models"

  ; Notify shell
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, p 0, p 0)'
!macroend
