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
- **Fix `svincoliVietati` dopo un ripristino**: il backup lo scriveva come `{}` (un `Set` via JSON) e
  in un'asta di riparazione ripristinata ogni `rilancio` falliva in silenzio
  (`.has is not a function`, riprodotto in locale). Ora `saveBackup` lo scrive come array e i tre
  punti di ripristino (Supabase, disco, "Riprendi") lo ricostruiscono come `Set`; i backup vecchi
  con `{}` diventano un Set vuoto. Verificato: rilancio accettato dopo il ripristino, e il blocco
  "chi ha svincolato non ripuja" sopravvive a un riavvio.
- Già in produzione prima: rilancio senza `broadcastStato`, countdown che finisce a 0, chip Recompra.

## Pendenze

- Gestionale (repo `fantasbocchini`, branch `podio-nombres-y-scambi`, commit `7bdad3d`): registra i
  crediti degli svincoli; build `20260911_svincolimanuali` pronto, **deploy manuale su Hostinger da fare**.
- Push dell'asta solo quando non c'è un'asta in corso.

## Prossimo passo

Deploy manuale del gestionale su Hostinger, poi prova con un export reale in dryRun.
