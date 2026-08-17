#!/usr/bin/env python3
"""Append remaining formal catalog entries."""
from __future__ import annotations

import json
from pathlib import Path

L10N = Path(__file__).parent
cat = json.loads((L10N / "_formal_catalog.json").read_text(encoding="utf-8"))

cat.setdefault("fr", {})
cat.setdefault("nl", {})

extra = {
    "it": {
        "Every audiobook in your library. Press Play on a row to listen.": "Tutti gli audiolibri in libreria. Premere Riproduci su una riga per ascoltare.",
        "Every song in your library. Press Play on a row to listen.": "Tutti i brani in libreria. Premere Riproduci su una riga per ascoltare.",
        "No in-progress tracks match your search.": "Nessun brano in corso corrisponde alla ricerca.",
        "No recently added tracks match your search.": "Nessun brano aggiunto di recente corrisponde alla ricerca.",
        "Open your collection": "Aprire la raccolta",
        "The official Android app connects to this Nextcloud. Stream or download your library — progress stays on your server.": "L'app Android ufficiale si connette a questo Nextcloud. Streaming o download della libreria — l'avanzamento resta sul server.",
        "This file may not play in your browser.": "Questo file potrebbe non essere riprodotto nel browser.",
        "You do not have access to AudioCheck. Your account is not among the users or groups allowed to use this app. Ask a server or app administrator if you need access.": "Nessun accesso ad AudioCheck. Questo account non è tra gli utenti o i gruppi autorizzati. Contattare un amministratore del server o dell'app se serve accesso.",
        "Your library on your phone": "Biblioteca sul telefono",
        "Your saved position is kept if you stop early.": "La posizione salvata resta se la riproduzione viene interrotta prima.",
        "Your session has expired. Reload the page to sign in again.": "La sessione è scaduta. Ricaricare la pagina per accedere di nuovo.",
    },
    "sv": {
        "Fresh tracks from your library.": "Nya spår från biblioteket.",
        "Include files in subfolders when scanning. Used for new library folders and the default folder.": "Inkludera filer i undermappar vid skanning. Gäller nya biblioteksmappar och standardmappen.",
        "One-time purchase in Google Play. The price for your country is shown on the listing. No public iOS app yet.": "Engångsköp i Google Play. Priset för landet visas på produktsidan. Offentlig iOS-app finns ännu inte.",
        "The official Android app connects to this Nextcloud. Stream or download your library — progress stays on your server.": "Den officiella Android-appen ansluter till denna Nextcloud. Streama eller ladda ned biblioteket — förloppet sparas på servern.",
        "This file may not play in your browser.": "Filen kanske inte spelas upp i webbläsaren.",
        "This server uses AJAX background jobs instead of system cron. Scans continue while you use AudioCheck; for faster indexing, ask an administrator to enable system cron in Nextcloud settings.": "Servern använder AJAX-bakgrundsjobb i stället för system-cron. Skanning fortsätter under användning av AudioCheck; för snabbare indexering kan en administratör aktivera system-cron i Nextcloud-inställningarna.",
        "Used when AudioCheck starts with no saved queue. Changing speed while listening applies to the whole queue.": "Används när AudioCheck startar utan sparad kö. Hastighetsändring under lyssning gäller hela kön.",
        "You are not allowed to use AudioCheck right now.": "Användning av AudioCheck är inte tillåten just nu.",
        "You can control playback without the keyboard. Look for these controls:": "Uppspelning kan styras utan tangentbord. Sök efter dessa kontroller:",
    },
    "nb": {
        "Open your collection": "Åpne samlingen",
        "Resuming where you left off on this track": "Gjenopptar fra lagret posisjon på dette sporet",
        "Scan now — AudioCheck indexes audio inside your folders.": "Skann nå — AudioCheck indekserer lyd i mappene.",
        "Scanning starts automatically. Use Scan now if you add files later.": "Skanning starter automatisk. Bruk Skann nå hvis filer legges til senere.",
        "Scanning your folders…": "Skanner mapper…",
        "Scope updated. Re-scanning your folders…": "Omfang oppdatert. Skanner mapper på nytt…",
        "Songs in the list only confirm you are in the right place — do not click them.": "Spor i listen bekrefter bare riktig plassering — ikke klikk på dem.",
        "The official Android app connects to this Nextcloud. Stream or download your library — progress stays on your server.": "Den offisielle Android-appen kobler til denne Nextcloud. Strøm eller last ned biblioteket — fremdrift lagres på serveren.",
        "This file may not play in your browser.": "Filen spilles kanskje ikke av i nettleseren.",
        "This server uses AJAX background jobs instead of system cron. Scans continue while you use AudioCheck; for faster indexing, ask an administrator to enable system cron in Nextcloud settings.": "Serveren bruker AJAX-bakgrunnsjobber i stedet for system-cron. Skanning fortsetter under bruk av AudioCheck; for raskere indeksering kan en administrator aktivere system-cron i Nextcloud-innstillingene.",
        "Used when AudioCheck starts with no saved queue. Changing speed while listening applies to the whole queue.": "Brukes når AudioCheck starter uten lagret kø. Endring av hastighet under lytting gjelder hele køen.",
        "When restriction is enabled, add at least one user or group.": "Når begrensning er aktivert, legg til minst én bruker eller gruppe.",
        "You are not allowed to use AudioCheck right now.": "Bruk av AudioCheck er ikke tillatt akkurat nå.",
        "You can control playback without the keyboard. Look for these controls:": "Avspilling kan styres uten tastatur. Se etter disse kontrollene:",
    },
    "pt_BR": {
        "You are not allowed to use AudioCheck right now.": "O uso do AudioCheck não é permitido no momento.",
        "You can control playback without the keyboard. Look for these controls:": "A reprodução pode ser controlada sem o teclado. Procure estes controles:",
        "You do not have access to AudioCheck. Your account is not among the users or groups allowed to use this app. Ask a server or app administrator if you need access.": "Sem acesso ao AudioCheck. Esta conta não está entre os usuários ou grupos autorizados. Contate um administrador do servidor ou do app se precisar de acesso.",
        "You do not have permission to do this.": "Sem permissão para esta ação.",
        "Your curated playlists.": "Playlists curadas.",
    },
}

for lang, fixes in extra.items():
    cat.setdefault(lang, {}).update(fixes)

(L10N / "_formal_catalog.json").write_text(json.dumps(cat, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Patched catalog")
