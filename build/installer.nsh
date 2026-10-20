; Extra uninstaller steps for the app (included via build.nsis.include in package.json).
; None of this runs during an update (a new version installed over the old one).

; Registry key with file types (the test replaces it with a separate test key)
!ifndef CHYTALKA_CLASSES
  !define CHYTALKA_CLASSES "Software\Classes"
!endif

; Removes an extension entry if it points to this app (the standard electron-builder uninstall
; leaves ".fb2" → "Chytalka.FB2" and OpenWithProgids behind). Entries of other apps are left alone:
; DeleteRegKey /ifempty only checks subkeys, not values, so emptiness is checked here instead:
; the key is deleted only if it has no values at all (EnumRegValue with indexes 0 and 1,
; because the default value has an empty name, just like the "no more values" result).
!macro chytalkaCleanAssociation EXT PROGID
  Push $0
  Push $1
  ReadRegStr $0 SHCTX "${CHYTALKA_CLASSES}\.${EXT}" ""
  StrCmp $0 "${PROGID}" 0 +2
    DeleteRegValue SHCTX "${CHYTALKA_CLASSES}\.${EXT}" ""
  DeleteRegValue SHCTX "${CHYTALKA_CLASSES}\.${EXT}\OpenWithProgids" "${PROGID}"

  ; OpenWithProgids: only if no entries of other apps remain there
  EnumRegValue $0 SHCTX "${CHYTALKA_CLASSES}\.${EXT}\OpenWithProgids" 0
  EnumRegValue $1 SHCTX "${CHYTALKA_CLASSES}\.${EXT}\OpenWithProgids" 1
  StrCmp "$0$1" "" 0 +2
    DeleteRegKey /ifempty SHCTX "${CHYTALKA_CLASSES}\.${EXT}\OpenWithProgids"

  ; The extension key itself: only if it is completely empty (no values; /ifempty checks subkeys)
  ReadRegStr $0 SHCTX "${CHYTALKA_CLASSES}\.${EXT}" ""
  StrCmp $0 "" 0 +5
  EnumRegValue $0 SHCTX "${CHYTALKA_CLASSES}\.${EXT}" 0
  EnumRegValue $1 SHCTX "${CHYTALKA_CLASSES}\.${EXT}" 1
  StrCmp "$0$1" "" 0 +2
    DeleteRegKey /ifempty SHCTX "${CHYTALKA_CLASSES}\.${EXT}"
  Pop $1
  Pop $0
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    !insertmacro chytalkaCleanAssociation "fb2" "Chytalka.FB2"
    !insertmacro chytalkaCleanAssociation "epub" "Chytalka.EPUB"
    !insertmacro chytalkaCleanAssociation "pdf" "Chytalka.PDF"
    !insertmacro chytalkaCleanAssociation "djvu" "Chytalka.DjVu"
    !insertmacro chytalkaCleanAssociation "djv" "Chytalka.DjVu"

    ; Ask whether to also delete settings, bookmarks and reading positions (%APPDATA%\book-reader)
    IfSilent skipDeleteData
    MessageBox MB_YESNO|MB_ICONQUESTION "Видалити також ваші налаштування, закладки та місця читання?$\r$\n$\r$\nОберіть «Ні», якщо плануєте встановити програму знову.$\r$\nФайли книг і резервні копії в «Документи\Chytalka» не видаляються." /SD IDNO IDNO skipDeleteData
      SetShellVarContext current
      RMDir /r "$APPDATA\book-reader"
    skipDeleteData:
  ${endIf}
!macroend
