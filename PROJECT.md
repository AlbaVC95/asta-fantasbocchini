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
- Dipendenze principali (`package.json`): `express`, `socket.io`, `uuid`, `@supabase/supabase-js`

Non ci sono script di test, lint o build.

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
frontend/css/style.css     ← tema scuro, mobile-first
frontend/data/*.json       ← dati statici (calendario placeholder, index foto giocatori, override nomi)
frontend/img/players/<Squadra>/<Nome>.jpg  ← foto giocatori locali, organizzate per squadra reale
```

## Variabili d'ambiente

Non esiste `.env.example`. Variabili richieste in produzione:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (backend, service role — mai esporre al client)
- `PORT` (opzionale)

Senza di esse il server parte comunque ma tutte le funzionalità legate a Supabase sono disattivate
(`supabaseAdmin === null`, ogni funzione che lo usa fa un check e no-op/errore gestito).

## Convenzioni del codice

- Commenti e nomi di variabili/funzioni sono in **italiano** in tutto il progetto (`asta`, `squadra`,
  `giocatore`, `crediti`, `rilancio`, ecc.) — non tradurre in inglese.
- I commenti spiegano spesso il *perché* di scelte non ovvie (race condition note, incidenti passati,
  fix di memory leak) — leggerli prima di modificare quella logica, spesso documentano un bug già
  risolto in un modo specifico per un motivo preciso. Le decisioni importanti sono anche in
  [DECISIONS.md](DECISIONS.md).
- Nel frontend (`app.js`), le sezioni principali del file sono individuabili dai commenti `══` che le
  separano.
