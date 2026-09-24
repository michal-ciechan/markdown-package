!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "spike: registering .md OpenWithProgids"
  WriteRegStr SHCTX "Software\Classes\MdpkgSpike.md" "" "Markdown document (spike)"
  WriteRegStr SHCTX "Software\Classes\MdpkgSpike.md\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\MdpkgSpike.md\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  WriteRegStr SHCTX "Software\Classes\.md\OpenWithProgids" "MdpkgSpike.md" ""
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DetailPrint "spike: removing .md OpenWithProgids"
  DeleteRegValue SHCTX "Software\Classes\.md\OpenWithProgids" "MdpkgSpike.md"
  DeleteRegKey SHCTX "Software\Classes\MdpkgSpike.md"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
