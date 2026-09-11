# Session Summary

## Stato attuale

Nuova funzione **"Svincola giocatori"** in Impostazioni Admin, per asta iniziale, riparazione 1 e 2,
e l'export JSON porta ora per ogni svincolo chi, per quanti crediti e come riconoscere l'operazione.
Provato in locale con backup finti ripristinati da disco (lato server e da interfaccia). Da fare in
parallelo: il gestionale (repo `fantasbocchini`) deve leggere i crediti nuovi.

## Cosa è cambiato

- **Svincolo manuale dell'Admin** (`admin-svincola` in `server.js`): squadra + giocatori + crediti per
  ciascuno (precompilati con la formula `calcolaRecuperoSvincolo`, modificabili). Stessi effetti di uno
  svincolo normale: fuori rosa, di nuovo nel pool, crediti alla squadra, **+1 `svincoliUsati` sempre**
  (anche in iniziale). In riparazione rispetta il tetto; bloccato se c'è un popup aperto.
  Nello storico come `svincolo_manuale`. `esegui-svincolo` non è stato toccato.
- **Annulla** gestisce `svincolo_manuale` (prima sarebbe andato in errore) e lo rifiuta se uno di quei
  giocatori è già stato ripreso all'asta da qualcuno (lo duplicherebbe).
- **Export JSON** (`/api/asta/:id/export`, bottone "📥 Esporta JSON"): ogni voce di `svincoli[]` tiene
  `giocatore/ruolo/timestamp` come prima e aggiunge `crediti`, `prezzoAcquisto`, `giocatoreId`,
  `origine` (`acquisto`|`manuale`), `acquistoCollegato`, `idOperazione` (`astaId|timestamp|giocatoreId`).
  Anche il recap porta i crediti.
- Storico, recap riparazione e lista Annulla mostrano il nuovo tipo con i crediti.
- Già in produzione prima: rilancio senza `broadcastStato`, countdown che finisce a 0, chip Recompra.

## Pendenze

- **Bug preesistente da decidere** (logica di backup, serve conferma): dopo un ripristino da backup
  `svincoliVietati` torna `{}` invece di `Set`, e in un'asta di riparazione ripristinata ogni
  `rilancio` fallisce (`.has is not a function`); idem `esegui-svincolo` e l'Annulla di `con_svincolo`.
  Il codice nuovo è protetto (`instanceof Set`), quello vecchio no.
- Adattare il gestionale per registrare i crediti (in corso) e fare il deploy manuale su Hostinger.
- Push dell'asta solo quando non c'è un'asta in corso.

## Prossimo passo

Gestionale → poi push di entrambi, poi prova con un export reale.
