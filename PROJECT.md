# PROJECT.md

Informazioni stabili sul progetto: cosa fa, con cosa è costruito, come è organizzato.
Non contiene task, bug o cambi temporanei — vedi [docs/SESSION_SUMMARY.md](docs/SESSION_SUMMARY.md) per quello.

## Cos'è

Tool di asta live in tempo reale per una lega di Fantacalcio (fantasy football italiano), usato dagli
amici della lega "FantaSbocchini". Admin crea un'asta e condivide un link; i partecipanti si uniscono,
i giocatori vengono chiamati uno alla volta e tutti fanno rilanci a tempo via WebSocket finché il timer
scade e il giocatore viene assegnato al miglior offerente.

## Stack

- Backend: Node.js + Express + Socket.io
- Frontend: HTML/CSS/JS vanilla — nessun framework, nessun bundler
- Persistenza/autenticazione/storage: Supabase
- Dipendenze principali (`package.json`): `express`, `socket.io`, `uuid`, `@supabase/supabase-js`,
  `express-rate-limit` (limiti di richieste per IP e per utente — vedi DECISIONS.md)

Non ci sono script di test, lint o build.

## Hosting

Deploy in produzione su **Hostinger** (non più Render). Deploy automatico al push su `main` di
GitHub — nessun passo manuale necessario dopo un push.

## Comandi

```bash
npm install    # installa le dipendenze
npm run dev    # avvia il server con --watch (riavvio automatico su modifiche a backend/)
npm start      # avvia il server in produzione
```

Le modifiche in `frontend/` sono servite come file statici e non richiedono riavvio; le modifiche in
`backend/` fanno riavviare automaticamente `npm run dev` (grazie a `node --watch`). Server in ascolto
su `http://localhost:3000` (o `process.env.PORT`).

## Struttura delle cartelle

```
backend/server.js          ← TUTTO il backend: Express + Socket.io + logica di gioco (1 file, ~1440 righe)
backend/data/*.json         ← snapshot di backup locale delle aste attive (rete di sicurezza)
frontend/index.html        ← SPA a singolo file: tutte le "screen" sono <section> nascoste/mostrate via JS
frontend/js/app.js         ← TUTTA la logica client + WebSocket (1 file, ~4700 righe)
frontend/js/gk-planner-*.js← modulo indipendente "Griglia Portieri/Attaccanti" (vedi ARCHITECTURE.md)
frontend/css/style.css     ← foglio storico: palette (:root), layout, tutti i breakpoint
frontend/css/tema-serata.css← selettore multi-tema: composizione e materie dei 4 temi (`serata`/
                            `cuoio`/`lavagna`/`sala-giochi`, attributo `data-tema` su `<html>`),
                            caricato DOPO style.css
frontend/js/clessidra.js   ← la clessidra del cronometro (SVG); legge il tempo, non lo calcola
frontend/js/comportamenti-asta.js ← comportamenti aggiuntivi della puja (leva, "ancora in gioco")
frontend/js/puja-sticky.js ← la striscia fissa in alto quando la carta di puja scorre via
frontend/js/vista-esterna.js← apre Rose/Storico/Svincolati in una scheda a parte (specchio dal vivo
                             del nodo vero, nessun socket in piu')
frontend/js/videochiamata.js← incastona la videochiamata dell'asta (Jitsi via iframe; il fornitore
                             sta tutto in `creaConferenza`, la stanza si ricava dall'astaId)
frontend/data/*.json       ← dati statici (calendario placeholder, index foto giocatori, override nomi)
frontend/img/players/<Squadra>/<Nome>.jpg  ← foto giocatori locali, organizzate per squadra reale
                           (`player_name_overrides.json` serve per le eccezioni mirate:
                            giocatore archiviato sotto la squadra sbagliata, senza spostare file)
frontend/img/players/_unmatched/<Nome>.jpg ← giocatori a cui lo script che genera le immagini non
                           ha saputo assegnare una squadra. NON è una squadra: la ricerca normale
                           è vincolata alla cartella della squadra, questi si raggiungono solo con
                           la ricerca globale di `_cercaFotoGlobale` (vedi DECISIONS.md). Il nome
                           della cartella è quello prodotto dallo script esterno: va lasciato
                           com'è, così un nuovo export dello script si copia senza rinominare niente.
```

## Variabili d'ambiente

Non esiste `.env.example`. Variabili richieste in produzione:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (backend, service role — mai esporre al client)
- `PORT` (opzionale)
- `ORIGINI_CONSENTITE` (opzionale): allowlist di origini per il socket, separate da virgola.
  **Non serve impostarla per il deploy normale** — il same-origin e' sempre ammesso, quindi
  l'app funziona su qualunque dominio senza configurare niente. Va usata solo se un giorno un
  client servito da un ALTRO dominio dovra' connettersi al socket.

Senza di esse il server parte comunque ma tutte le funzionalità legate a Supabase sono disattivate
(`supabaseAdmin === null`, ogni funzione che lo usa fa un check e no-op/errore gestito).

## Sicurezza: cosa e' pubblico di proposito

- **`SUPABASE_ANON_KEY` in `app.js` e' pubblica per definizione** e non va "nascosta": la chiave
  anon viaggia in ogni client web, il suo JWT dice `"role":"anon"`, e cio' che protegge i dati e'
  RLS su Supabase, non la segretezza della chiave. Spostarla in una variabile d'ambiente non
  cambierebbe nulla (finirebbe comunque nel file servito al browser). L'unica chiave davvero
  segreta e' `SUPABASE_SERVICE_ROLE_KEY`, che sta solo nel backend.
- **Nessun altro segreto va scritto in chiaro nel codice.** C'era una `THEME_EDITOR_SECRET`
  hardcoded, quindi pubblica su GitHub: rimossa insieme all'editor che proteggeva.
- Le tabelle Supabase hanno tutte RLS attiva, con policy per proprietario; quelle che il solo
  backend deve toccare (`app_settings`, `asta_backups`, `asta_exports`, `theme_overrides`)
  hanno RLS attiva e **zero policy**, cioe' negano tutto a chi non usa la service role key.

## Convenzioni del codice

- Commenti e nomi di variabili/funzioni sono in **italiano** in tutto il progetto (`asta`, `squadra`,
  `giocatore`, `crediti`, `rilancio`, ecc.) — non tradurre in inglese.
- I commenti spiegano spesso il *perché* di scelte non ovvie (race condition note, incidenti passati,
  fix di memory leak) — leggerli prima di modificare quella logica, spesso documentano un bug già
  risolto in un modo specifico per un motivo preciso. Le decisioni importanti sono anche in
  [DECISIONS.md](DECISIONS.md).
- Nel frontend (`app.js`), le sezioni principali del file sono individuabili dai commenti `══` che le
  separano.
- **Fine riga miste — mai l'Edit tool su `frontend/js/app.js`, `frontend/index.html`,
  `frontend/css/style.css`**: hanno righe LF-only preesistenti (rispettivamente 243, 19 e 234 —
  ricontate il 2026-09-02; il numero cresce man mano che si aggiungono righe nelle zone LF) e
  l'Edit tool converte tutto il file a LF, producendo un diff enorme. Usare uno script Node/Python
  che legge il file grezzo e sostituisce stringhe esatte, e ricontare le righe LF-only prima e dopo.
  **Lo stile non e' uniforme in tutto il file**: alcune zone (es. le funzioni 3D dello stadio in
  `app.js`, dentro `_antAssicuraStadio3D`) sono a loro volta LF-only anziche' CRLF — prima di
  scrivere l'`old_string`/`new_string` dello script, verificare lo stile REALE del punto preciso
  d'inserimento (es. `sed -n 'N,Mp' file | od -c`), non assumerlo uniforme.
- **`backend/server.js` è interamente a CRLF** (0 righe LF-only): come lo era `tema-serata.css`,
  l'Edit tool lo convertirebbe tutto a LF e il diff diventerebbe l'intero file. Editarlo con uno
  script che scrive `\r\n`, oppure convertirlo a LF una volta per tutte in un commit dedicato.
- **`frontend/css/tema-serata.css` è invece interamente a LF** e si edita normalmente. Era l'unico
  file al 100% CRLF, quindi qualunque strumento che normalizza le fine riga lo riscriveva tutto e
  ogni modifica al CSS appariva come un diff da 3000+ righe: convertito una volta per tutte in un
  commit di sole fine riga (`style: convert CRLF to LF in tema-serata.css`, 2026-08-26). **Va
  tenuto a LF**: se un giorno ricomparissero dei CR, si è tornati al problema di prima.
  Conteggi righe LF-only al 2026-08-26: `app.js` 240, `index.html` 19, `style.css` 234.
- **`String.replace(x, stringa)` corrompe `app.js`**: le sequenze `$&`, `$'`, `$1` nella stringa di
  sostituzione vengono interpretate come pattern, e `app.js` contiene `['$,$,$']` (riga 293). Usare
  sempre un replacer come **funzione**: `str.replace(x, () => y)`.
- **Cache-busting su CSS/JS**: `frontend/index.html` carica `style.css`/`tema-serata.css`/`app.js`/…
  con `?v=timestamp` (vedi commento in `backend/server.js`, funzione che serve `frontend/`
  staticamente). Dopo qualunque modifica a uno di questi file, bisogna aggiornare a mano il suo
  `?v=` in `index.html` — altrimenti browser/CDN possono continuare a servire la versione vecchia
  sotto la stessa URL anche dopo il deploy.
- **Cache-busting sulle immagini referenziate nei CSS (`url(...)`)**: Hostinger serve gli statici
  con `cache-control: public, max-age=2592000, immutable` — un browser che ha gia' scaricato una
  di queste immagini non la richiede piu' per 30 giorni, nemmeno con hard refresh (`immutable`).
  Le foto vere in `frontend/img/backgrounds/` (`pizarra-lavagna.jpeg`, `pelota-cuoio.jpeg`,
  `fondo-cuoio.jpeg`, usate in `tema-serata.css`/`style.css`) hanno percio' anche loro un
  `?v=N` manuale nell'`url(...)`. Se si sostituisce il contenuto di uno di questi file (stesso
  nome), bisogna alzare `?v=` in OGNI punto dove il file e' referenziato (`grep` il nome del
  file nei due CSS), altrimenti il cambio resta invisibile a chi l'ha gia' visitato.
