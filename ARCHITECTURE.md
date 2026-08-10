# ARCHITECTURE.md

Descrizione dell'architettura tecnica: moduli, stato, autenticazione, flusso dati.
Per stack/struttura cartelle vedi [PROJECT.md](PROJECT.md); per il perché di certe scelte vedi
[DECISIONS.md](DECISIONS.md).

## Stato dell'applicazione: in-memory + backup su Supabase

Non c'è database relazionale per lo stato di gioco: tutte le aste attive vivono in memoria di processo
in `const aste = new Map()` (in `server.js`), indicizzata per `astaId`.

- Backup a doppio livello: (1) snapshot JSON su disco locale in `backend/data/backup_asta_*.json`, e
  (2) upsert su Supabase (tabella `asta_backups`), quest'ultimo l'unico che sopravvive a un
  deploy/riavvio del container su Render. All'avvio, `loadBackups()` ripristina prima da Supabase, poi
  da disco locale come fallback (dedup automatico).
- Il backup su Supabase viene fatto ogni 30s per le aste attive (`setInterval` in fondo a `server.js`)
  più ad ogni evento significativo (`broadcastStato(astaId, true)`), con dedup via hash SHA1 del
  contenuto per evitare upload ridondanti. Disattivabile temporaneamente da un toggle Super Admin
  (persistito in `app_settings`); il backup locale su disco resta comunque sempre attivo.
- Quando un'asta termina (`termina-asta`), lo snapshot va in `asta_exports` (storico permanente,
  visibile a chiunque dalla Home) e il backup "in corso" in `asta_backups` viene eliminato (con doppio
  retry ritardato — vedi commenti attorno a `saveExportSupabase`/`deleteBackupSupabase` in `server.js`).
- Pulizia periodica: le aste terminate da più di 24h o create da più di 30 giorni vengono rimosse dalla
  Map `aste` ogni ora.

## Autenticazione e ruoli

Login utenti via Supabase Auth (client-side con `SUPABASE_ANON_KEY` in `app.js`, verificato server-side
via token Bearer con `supabaseAdmin` — service role key, solo backend). Due livelli di privilegio,
entrambi verificati **server-side**:

1. **Admin di un'asta specifica**: determinato da un `adminToken` segreto (UUID) generato alla
   creazione dell'asta, mai esposto dagli endpoint pubblici (es. `/api/asta/:id/info`) — solo chi lo
   possiede può unirsi come admin via `join-asta`. Concede pieno controllo (chiamare giocatori,
   assegnare, annullare, modificare config) sulla singola asta.
2. **Ruolo "admin" applicativo** (tabella `profiles` su Supabase, verificato da `getRuoloUtente()` con
   `role === 'admin'`): funzioni globali non legate a una singola asta — caricare il listino ufficiale,
   il calendario del GK Planner, vedere/pulire le aste "zombie", chiudere *tutte* le aste attive in un
   colpo, attivare/disattivare il backup Supabase globale, attivare/disattivare la modalità
   manutenzione (schermata che blocca l'uso dell'app a chi non è admin). Nonostante il nome della card
   in UI ("⚠️ Amministrazione"), non esiste in `server.js` un livello "Super Admin" separato con email
   hardcoded: è lo stesso ruolo "admin" di cui sopra.

## Ciclo di vita di un'asta e meccaniche di gioco (`server.js`)

Un'asta ha `tipoAsta`: `'iniziale'` (prima asta di stagione, con meccaniche RIC/PLUS di riconferma
giocatori dell'anno precedente) o `'riparazione'` (asta di riparazione/svincoli a stagione in corso).

Flusso chiamata giocatore, centrato su `asta.chiamataAttuale` (unico "slot" di chiamata attiva per
asta) e orchestrato da funzioni chiave in `server.js`:

- `avviaChiamata()` → se il giocatore è tipo `RIC` con `squadraOriginale`, offre prima conferma al
  proprietario precedente (popup `popup-ric-conferma`) prima di aprire l'asta a tutti.
- Rilanci via evento socket `rilancio`, validati server-side (`calcolaMaxOfferta()` calcola il tetto
  massimo offribile in base a crediti, slot minimi da riempire e — in asta di riparazione — crediti
  recuperabili da eventuali svincoli).
- Timer gestito interamente server-side (`startTimer`/`resetTimer`/`clearTimer`), ogni rilancio lo
  resetta; alla scadenza lo stato passa a `attesa-conferma` e serve un'azione esplicita dell'admin
  (`conferma-assegnazione` o `riapri-asta`).
- `chiudiAsta()` gestisce i casi speciali post-asta (proposta di plusvalenza/recompra al proprietario
  precedente se il giocatore RIC/PLUS è stato vinto da un'altra squadra; gestione svincolo se
  l'offerta vincente supera i crediti disponibili) prima dell'assegnazione definitiva.
- Ogni azione che modifica lo stato di gioco viene appesa a `asta.storico`, base per
  `annulla-assegnazione(-specifica)` (undo, ripristina crediti/slot/pool giocatori).

Tutto lo stato viene ribroadcastato con `broadcastStato()` dopo ogni cambiamento rilevante — non ci
sono aggiornamenti incrementali lato client, il client riceve sempre lo stato asta completo via evento
`stato-asta`.

## Frontend (`app.js`)

SPA a singola pagina: le "schermate" sono `<section id="screen-*">` in `index.html`, mostrate/nascoste
via `showScreen(id)`. Stato client centralizzato nell'oggetto globale `S` (in cima ad `app.js`):
`astaId`, `miaSquadra`, `isAdmin`, `adminToken`, `asta` (l'ultimo stato ricevuto dal server), ecc.
Sessione persistita in `localStorage` (`salvaSessione`/`getSessione`) per sopravvivere a
refresh/riconnessioni — alla riconnessione del socket (`socket.on('connect'/'reconnect')`) si rifà
sempre `join-asta` con l'`adminToken` salvato.

Sezioni principali del file (individuabili dai commenti `══` che le separano):
- Tema chiaro/scuro, suoni, notifiche browser, persistenza sessione/stato locale
- Export asta (JSON/Excel/Fantaleghe/Recap) ed export storico
- Home / creazione asta / lobby / schermata asta live / fine asta (render + handler socket)
- Ricerca foto giocatori con fallback a cascata (foto locale → SportsDB → Wikidata → Wikipedia →
  API-Football → iniziali colorate)
- "Anteprima formazioni" (campo virtuale drag&drop per organizzare la rosa per ruolo)
- "Strategie" ed "Editor Fasce" (pre-pianificazione pre-asta: assegnare prezzo/percentuale/preferito/
  titolarità/commento ai giocatori del listino ufficiale, salvata per utente su Supabase)

Gli eventi Socket.io lato client sono tutti registrati a livello top del file (non dentro funzioni),
sezione `SOCKET EVENTS`: ogni evento server (`stato-asta`, `nuova-chiamata`, `giocatore-assegnato`,
`popup-*`, ecc.) ha un handler dedicato che aggiorna `S` e richiama le funzioni `render*`.

## Modulo GK Planner (`gk-planner-engine.js` + `gk-planner-ui.js`)

Modulo indipendente e riusabile (namespace globale `window.GKPlanner`), separato apposta dal resto:
analizza le 38 giornate di Serie A per trovare le migliori combinazioni di 2-3 portieri o attaccanti da
tenere in rosa, in base a punteggi Attacco/Difesa per squadra. `gk-planner-engine.js` è logica pura
senza DOM (algoritmo di scoring/normalizzazione); `gk-planner-ui.js` è il layer di rendering/interazione.
Il calendario può essere quello placeholder (round-robin generato) o uno reale caricato dall'Admin
(persistito su Supabase, tabella `theme_overrides` con id `gk_planner_calendario`).
