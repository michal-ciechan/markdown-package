!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "registering .md OpenWithProgids"
  WriteRegStr SHCTX "Software\Classes\MdpkgViewer.md" "" "Markdown document"
  WriteRegStr SHCTX "Software\Classes\MdpkgViewer.md\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\MdpkgViewer.md\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  WriteRegStr SHCTX "Software\Classes\.md\OpenWithProgids" "MdpkgViewer.md" ""
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DetailPrint "removing .md OpenWithProgids"
  DeleteRegValue SHCTX "Software\Classes\.md\OpenWithProgids" "MdpkgViewer.md"
  DeleteRegKey SHCTX "Software\Classes\MdpkgViewer.md"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
