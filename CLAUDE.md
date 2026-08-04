# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Cos'è

Tool di subasta ("asta") live in tempo reale per una lega di Fantacalcio (fantasy football italiano),
usato dagli amici della lega "FantaSbocchini". Admin crea un'asta e condivide un link; i partecipanti
si uniscono, i giocatori vengono chiamati uno alla volta e tutti fanno rilanci a tempo via WebSocket
finché il timer scade e il giocatore viene assegnato al miglior offerente.

## Comandi

```bash
npm install       # installa le dipendenze
npm run dev        # avvia il server con --watch (riavvio automatico su modifiche a backend/)
npm start          # avvia il server in produzione
```

Non ci sono script di test, lint o build: è un progetto Node.js + frontend vanilla senza bundler.
Le modifiche in `frontend/` sono servite come file statici e non richiedono riavvio; le modifiche
in `backend/` fanno riavviare automaticamente `npm run dev` (grazie a `node --watch`).

Server in ascolto su `http://localhost:3000` (o `process.env.PORT`).

## Architettura generale

Stack: Node.js + Express + Socket.io nel backend, HTML/CSS/JS vanilla (nessun framework, nessun
bundler) nel frontend, Supabase come backend di persistenza/autenticazione/storage.

```
backend/server.js          ← TUTTO il backend: Express + Socket.io + logica di gioco (1 file, ~1440 righe)
frontend/index.html        ← SPA a singolo file: tutte le "screen" sono <section> nascoste/mostrate via JS
frontend/js/app.js         ← TUTTA la logica client + WebSocket (1 file, ~4700 righe)
frontend/js/gk-planner-*.js← modulo indipendente "Griglia Portieri/Attaccanti" (vedi sotto)
frontend/css/style.css     ← tema scuro, mobile-first
frontend/data/*.json       ← dati statici (calendario placeholder, index foto giocatori, override nomi)
frontend/img/players/<Squadra>/<Nome>.jpg  ← foto giocatori locali, organizzate per squadra reale
```

### Stato dell'applicazione: in-memory + backup su Supabase

Non c'è database relazionale per lo stato di gioco: tutte le aste attive vivono in memoria di processo
in `const aste = new Map()` (in `server.js`), indicizzata per `astaId`. Questo significa:

- **Un riavvio del processo perde tutto lo stato in RAM** — per questo esiste un sistema di backup
  a doppio livello: (1) snapshot JSON su disco locale in `backend/data/backup_asta_*.json`, e (2)
  upsert su Supabase (tabella `asta_backups`), quest'ultimo l'unico che sopravvive a un deploy/riavvio
  del container su Render. All'avvio, `loadBackups()` ripristina prima da Supabase, poi da disco locale
  come fallback (dedup automatico).
- Il backup su Supabase viene fatto ogni 30s per le aste attive (`setInterval` in fondo a `server.js`)
  più ad ogni evento significativo (`broadcastStato(astaId, true)`), con dedup via hash SHA1 del
  contenuto per evitare upload ridondanti (risparmio banda — vedi "incidente banda agosto 2026" citato
  nei commenti). Il backup su Supabase è disattivabile temporaneamente da un toggle Super Admin
  (persistito in `app_settings`), per non consumare banda durante i test — il backup locale su disco
  resta comunque sempre attivo come rete di sicurezza.
- Quando un'asta termina (`termina-asta`), lo snapshot va in `asta_exports` (storico permanente,
  visibile a chiunque dalla Home) e il backup "in corso" in `asta_backups` viene eliminato (con doppio
  retry ritardato per evitare una race condition nota con l'autosave dei 30s — vedi commenti attorno a
  `saveExportSupabase`/`deleteBackupSupabase` in `server.js`).
- Pulizia periodica: le aste terminate da più di 24h o create da più di 30 giorni vengono rimosse dalla
  Map `aste` ogni ora, per evitare fughe di memoria.

### Autenticazione e ruoli

Login utenti via Supabase Auth (client-side con `SUPABASE_ANON_KEY` in `app.js`, verificato server-side
via token Bearer con `supabaseAdmin` — service role key, solo backend, letta da
`process.env.SUPABASE_SERVICE_ROLE_KEY`). Tre livelli di privilegio, tutti verificati **server-side**:

1. **Admin di un'asta specifica**: determinato da un `adminToken` segreto (UUID) generato alla
   creazione dell'asta, mai esposto dagli endpoint pubblici (es. `/api/asta/:id/info`) — solo chi lo
   possiede può unirsi come admin via `join-asta`. Concede pieno controllo (chiamare giocatori,
   assegnare, annullare, modificare config) sulla singola asta.
2. **Ruolo "admin" applicativo** (tabella `profiles` su Supabase): serve per funzioni globali non legate
   a una singola asta (caricare il listino ufficiale, il calendario del GK Planner, vedere/pulire le
   aste "zombie"). Verificato da `getRuoloUtente()`.
3. **Super Admin** (email hardcoded `SUPER_ADMIN_EMAIL` in `server.js`): unico che può chiudere
   *tutte* le aste attive in un colpo o attivare/disattivare il backup Supabase globale. Verificato da
   `getSuperAdminAuth()`.

### Ciclo di vita di un'asta e meccaniche di gioco (`server.js`)

Un'asta ha `tipoAsta`: `'iniziale'` (prima asta di stagione, con meccaniche RIC/PLUS di riconferma
giocatori dell'anno precedente) o `'riparazione'` (asta di riparazione/svincoli a stagione in corso).

Flusso chiamata giocatore, tutto centrato su `asta.chiamataAttuale` (unico "slot" di chiamata attiva
per asta) e orchestrato da funzioni chiave in `server.js`:

- `avviaChiamata()` → se il giocatore è tipo `RIC` con `squadraOriginale`, offre prima conferma al
  proprietario precedente (popup `popup-ric-conferma`) prima di aprire l'asta a tutti.
- Rilanci via evento socket `rilancio`, validati server-side (`calcolaMaxOfferta()` calcola il tetto
  massimo offribile in base a crediti, slot minimi da riempire e — in asta di riparazione —
  crediti recuperabili da eventuali svincoli).
- Timer gestito interamente server-side (`startTimer`/`resetTimer`/`clearTimer`), ogni rilancio lo
  resetta; alla scadenza lo stato passa a `attesa-conferma` e serve un'azione esplicita dell'admin
  (`conferma-assegnazione` o `riapri-asta`).
- `chiudiAsta()` gestisce i casi speciali post-asta (proposta di plusvalenza/recompra al proprietario
  precedente se il giocatore RIC/PLUS è stato vinto da un'altra squadra; gestione svincolo se l'offerta
  vincente supera i crediti disponibili) prima dell'assegnazione definitiva.
- Ogni azione che modifica lo stato di gioco viene appesa a `asta.storico`, che è anche la base per
  `annulla-assegnazione(-specifica)` (undo, ripristina crediti/slot/pool giocatori).

Tutto lo stato viene ribroadcastato con `broadcastStato()` dopo ogni cambiamento rilevante — non ci sono
aggiornamenti incrementali lato client, il client riceve sempre lo stato asta completo via evento
`stato-asta`.

### Frontend (`app.js`)

SPA a singola pagina: le "schermate" sono `<section id="screen-*">` in `index.html`, mostrate/nascoste
via `showScreen(id)`. Stato client centralizzato nell'oggetto globale `S` (in cima ad `app.js`):
`astaId`, `miaSquadra`, `isAdmin`, `adminToken`, `asta` (l'ultimo stato ricevuto dal server), ecc.
Sessione persistita in `localStorage` (`salvaSessione`/`getSessione`) per sopravvivere a refresh/riconnessioni
— alla riconnessione del socket (`socket.on('connect'/'reconnect')`) si rifà sempre `join-asta` con
l'`adminToken` salvato.

Sezioni principali del file (individuabili dai commenti `══` che le separano):
- Tema chiaro/scuro, suoni, notifiche browser, persistenza sessione/stato locale
- Export asta (JSON/Excel/Fantaleghe/Recap) ed export storico
- Home / creazione asta / lobby / schermata asta live / fine asta (render + handler socket)
- Ricerca foto giocatori con fallback a cascata (foto locale → SportsDB → Wikidata → Wikipedia →
  API-Football → iniziali colorate)
- "Anteprima formazioni" (campo virtuale drag&drop per organizzare la rosa per ruolo)
- "Strategie" ed "Editor Fasce" (pre-pianificazione pre-asta: assegnare prezzo/percentuale/preferito
  ai giocatori del listino ufficiale, salvata per utente su Supabase)

Gli eventi Socket.io lato client sono tutti registrati a livello top del file (non dentro funzioni),
sezione `SOCKET EVENTS`: ogni evento server (`stato-asta`, `nuova-chiamata`, `giocatore-assegnato`,
`popup-*`, ecc.) ha un handler dedicato che aggiorna `S` e richiama le funzioni `render*`.

### Modulo GK Planner (`gk-planner-engine.js` + `gk-planner-ui.js`)

Modulo indipendente e riusabile (namespace globale `window.GKPlanner`), separato apposta dal resto:
analizza le 38 giornate di Serie A per trovare le migliori combinazioni di 2-3 portieri o attaccanti da
tenere in rosa, in base a punteggi Attacco/Difesa per squadra. `gk-planner-engine.js` è logica pura
senza DOM (algoritmo di scoring/normalizzazione); `gk-planner-ui.js` è il layer di rendering/interazione.
Il calendario può essere quello placeholder (round-robin generato) o uno reale caricato dall'Admin
(persistito su Supabase, tabella `theme_overrides` con id `gk_planner_calendario`).

## Convenzioni del codice

- Commenti e nomi di variabili/funzioni sono in **italiano** in tutto il progetto (`asta`, `squadra`,
  `giocatore`, `crediti`, `rilancio`, ecc.) — segui questa convenzione per coerenza, non tradurre in
  inglese.
- I commenti spiegano spesso il *perché* di scelte non ovvie (race condition note, incidenti passati
  tipo il "consumo banda agosto 2026", fix di memory leak) — leggerli prima di modificare quella logica,
  spesso documentano un bug già risolto in un modo specifico per un motivo preciso.
- Non esiste `.env.example`: le variabili d'ambiente richieste in produzione sono `SUPABASE_URL` e
  `SUPABASE_SERVICE_ROLE_KEY` (backend, service role — mai esporre al client) più `PORT` (opzionale).
  Senza di esse il server parte comunque ma tutte le funzionalità legate a Supabase sono disattivate
  (`supabaseAdmin === null`, ogni funzione che lo usa fa un check e no-op/errore gestito).
