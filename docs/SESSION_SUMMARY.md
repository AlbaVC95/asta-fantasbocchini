# SESSION_SUMMARY.md

Stato attuale del progetto. Questo file va sovrascritto ad ogni task importante — non è uno storico
(per quello c'è `git log`).

## Stato attuale

- **Deploy**: migrato da Render a **Hostinger** (dominio `asta.fantaplus.com`, deploy automatico
  su push a `main`). Render resta attivo temporaneamente come backup dell'utente. Bind esplicito
  su `0.0.0.0` in `server.listen()` applicato come misura difensiva (commit `7d32099`).
- Branch `main` pulito, **tutto pushato e in produzione**, ultimo commit `9db26ef` (merge del
  redesign 3D Anteprima, vedi sotto). Migration
  `backend/sql/2026-08-10_strategia_titolarita_commento.sql` già eseguita dall'utente su Supabase.
- **Redesign 3D Anteprima: MERGIATO su `main` e IN PRODUZIONE** (richiesta esplicita dell'utente
  di deploy, dopo un giro di correzioni su feedback visivo). Branch di lavoro `redesign/asta-3d` e
  backup `backup/pre-redesign-asta-3d` restano su GitHub per riferimento/rollback rapido. Vedi
  sezione dedicata sotto — **non ancora confermato dal vivo dall'utente in un'asta reale**.
- 3 vulnerabilità di sicurezza Supabase corrette (RLS `app_settings`, `search_path`/`EXECUTE` su
  `handle_new_user`) — vedi dettagli in fondo, sezione "Sicurezza Supabase".
- **Altri fix pushati in produzione, non ancora confermati dal vivo dall'utente**: Max Offerta
  Portieri/Movimento separati, Quotazione Ufficiale persa nel pool asta, contatore Svincolati,
  più i 2 bug di sessioni precedenti (plusvalenza/recompra, Anteprima non resettata) — vedi
  "Tasks pendenti".

## Redesign 3D Anteprima — MERGIATO su `main`, IN PRODUZIONE (non ancora confermato dal vivo)

Richiesta dell'utente (7 requisiti precisi): animazione di assegnazione carta (Puja → centro
schermo → drop, ~1-1.2s), pannello Anteprima come drawer laterale che **spinge** il contenuto
(non lo copre), campo 3D con carte giocatore 3D, panchina automatica, tutto senza toccare
Puja/Rose/logica R.MANTRA esistente. Piano dettagliato in
`/Users/alba/.claude/plans/bright-swimming-parnas.md` e in
[docs/REDESIGN_ASTA_3D.md](REDESIGN_ASTA_3D.md).

**Iter di sviluppo** (2 round, entrambi verificati in locale prima del merge):
1. Prima versione: drawer overlay `position:fixed`, campo 3D, carte 3D, animazione, panchina.
2. **Feedback dell'utente con screenshot di confronto** contro il mockup di riferimento → 3
   problemi reali corretti:
   - **Carte "schiacciate"**: causa trovata, `#ant-pitch` ereditava `overflow:hidden` dalla
     vecchia regola del campo 2D, che clippava la resa 3D dei figli. Rimosso; aggiunta anche
     un'ombra di contatto per-carta (non contro-ruotata) per rinforzare la profondità.
   - **Mancava lo stadio con le luci**: aggiunte due torri faro decorative sopra il campo.
   - **Il drawer copriva la Puja**: ristrutturato `#screen-asta` con un wrapper flex
     (`.asta-live-layout` > `.asta-main-col` + `#tab-anteprima`) — `#tab-anteprima` spostato
     fuori da `.tabs-panel` per essere una vera colonna flex che **si affianca**, non un overlay;
     `.asta-main-col` si restringe da solo (`flex:1`) quando il drawer è aperto. Su mobile il
     drawer resta nel flusso normale e si espande sotto il contenuto.

**Cosa è cambiato** (solo `frontend/index.html`, `frontend/css/style.css`, `frontend/js/app.js`
— nessun file backend toccato, nessun contratto socket nuovo, nessuna riga toccata in
`#chiamata-card`/`.cc-avatar` o in `renderRose()`, confermato via `git diff`):
- `_playAssegnazioneCardFx()` — agganciata come prima riga di
  `socket.on('giocatore-assegnato', ...)`, clona la carta dalla posizione reale di `.cc-avatar`
  (`getBoundingClientRect()`, mai una dimensione fissa), Web Animations API, salta con
  `prefers-reduced-motion`, tetto di 3 cloni simultanei.
- Drawer: guard di una riga in `setupTabs()` smista il click su "Anteprima" verso
  `_antToggleDrawer()` invece del vecchio `.active`; resto delle tab invariato.
- `renderAnteprimaPitch()` riscritta solo nella generazione dell'HTML per slot — `ANT_LAYOUT`,
  calcolo coordinate e binding al picker restano identici. Carte 3D (`.ant-card`) con foto reale
  via `_antApplyCardPhoto()` (riusa la cache di `.cc-avatar` senza toccarla), colore per ruolo via
  `_roseRowRoleClass()`, badge ruolo via `_getRuoloBadgeHTML()` — nessuna palette nuova.
- Panchina automatica (`_antRenderPanchina()`) e sotto-tab "Vista lista"
  (`_antRenderLista()`): si aggiornano da sole, agganciate alla fine di `renderAnteprimaPitch()`
  già richiamata dal flusso esistente `stato-asta` → `populateAnteprimaSquadre()`.

**Verificato in locale** (browser automatizzato, dati simulati — nessuna asta live disponibile in
sessione per un test reale): tutte le altre tab restano identiche; il drawer si affianca
correttamente senza nascondere Rose (confermato via `getBoundingClientRect`: `.asta-main-col` si
restringe esattamente della larghezza del drawer, sia desktop sia mobile); il campo 3D renderizza
tutti gli 11 moduli con le coordinate invariate; il picker filtra ancora per R.MANTRA; assegnare
un giocatore lo sposta da panchina a campo; foto caricate correttamente; meccanica
dell'animazione verificata (posizione, cleanup, tetto cloni, skip reduced-motion).

**Non verificabile in questo ambiente — da fare con l'utente ora che è in produzione**: aspetto
reale su schermo (l'utente ha già validato che il fix dell'`overflow` migliora la profondità, in
attesa di conferma finale), test su device reale (specialmente Android fascia bassa), test
multiplayer reale (2+ dispositivi sulla stessa asta), verifica che il drawer aperto non copra
`.rilancio-box`/timer durante una puja reale attiva, animazione vista dal vivo durante un'asta di
prova. **Rollback rapido disponibile**: `backup/pre-redesign-asta-3d` punta al commit `main`
immediatamente precedente al merge, se qualcosa non va basta un revert/reset a quel branch.

## Tasks pendenti

- **Verificare dal vivo il redesign 3D Anteprima** in un'asta di test reale (vedi sopra) prima
  del prossimo uso reale della lega — è il cambio più corposo di questa sessione, mai testato in
  condizioni reali.
- **Verificare dal vivo il fix Max Offerta Portieri/Movimento**: portare una squadra a un solo
  portiere ma oltre il minimo di movimento, controllare che l'offerta massima sui giocatori di
  movimento lasci crediti sufficienti per completare i portieri minimi.
- **Verificare dal vivo la Quotazione Ufficiale in Svincolati**: creare un'asta dal Listino
  Ufficiale, controllare che il badge "Quot." compaia nella lista Svincolati.
- **Verificare dal vivo il Bug plusvalenza/recompra**: far puntare il proprietario precedente sul
  proprio ex giocatore, far scadere/riaprire il timer, controllare che il popup NON venga più
  offerto.
- **Verificare dal vivo il Bug Anteprima (reset tra aste)**: terminare un'asta, entrare in una
  nuova con una squadra dallo stesso nome, controllare che Anteprima parta vuota.
- Opzionale: eliminare la strategia "Strategia SOS Fanta" duplicata in produzione (dati di test
  di una sessione precedente).

## Prossimo passo consigliato

Aprire un'asta di test reale (idealmente con 2+ dispositivi/persone) e verificare in ordine: il
redesign 3D Anteprima (il cambio più a rischio, appena andato in produzione), poi i fix minori
già pushati ma non confermati (Max Offerta, Quotazione Ufficiale, i 2 bug di sessioni precedenti).
Farlo prima del prossimo utilizzo reale della lega, non durante.

## Sicurezza Supabase — 3 fix applicati (email di alert + Security Advisors)

Verificato con `get_advisors` prima e dopo ogni fix. Tutti applicati dall'utente via SQL Editor
del dashboard Supabase (l'`apply_migration` diretto è stato bloccato dal classificatore di
permessi dell'agente su un'operazione DDL di produzione).

1. **`app_settings` aveva RLS completamente disattivato** (ERROR critico, oggetto dell'email di
   alert Supabase): chiunque avesse la chiave anon pubblica poteva leggere/modificare/cancellare
   via API REST i toggle globali `backup_supabase_attivo`/`manutenzione_attiva` (vedi
   [DECISIONS.md](../DECISIONS.md)), senza passare dall'app. Fix: `ALTER TABLE
   public.app_settings ENABLE ROW LEVEL SECURITY;` (nessuna policy, stesso pattern già usato per
   `asta_backups`/`asta_exports`/`theme_overrides`).
2. **`handle_new_user()` con `search_path` non fissato**: `ALTER FUNCTION
   public.handle_new_user() SET search_path = public, pg_temp;`.
3. **`handle_new_user()` invocabile via RPC pubblico**: `REVOKE EXECUTE ON FUNCTION
   public.handle_new_user() FROM PUBLIC;` (il primo tentativo, `REVOKE ... FROM anon,
   authenticated`, non bastava perché l'`EXECUTE` restava concesso a `PUBLIC`). Il trigger di
   signup continua a funzionare invariato (`SECURITY DEFINER`).

**Residuo, non un problema**: 4 avvisi INFO "RLS enabled, no policy" (pattern intenzionale, solo
il backend con service role accede a quelle tabelle). **Residuo non risolvibile sul piano
attuale**: "Leaked Password Protection" richiede piano Supabase Pro, l'organizzazione è su Free.

## Cambi principali già in produzione (riferimento rapido)

- **Redesign 3D Anteprima** — vedi sezione dedicata sopra.
- **Import/export Strategia formato FantaLab** (`frontend/js/app.js`,
  `_importaGiocatoriFantaLabInStrategia()`/`esportaStrategiaFantaLab()`): 12 fogli Excel per
  ruolo Mantra, matching nome+ruolo, fasce automatiche. Testato in produzione con dati reali
  (497/497 giocatori importati, 0 scartati).
- **Fix Max Offerta** (`backend/server.js`, `calcolaMaxOfferta()`): minimo Portieri e minimo
  Movimento sono due vincoli separati, non un totale unico.
- **Fix Quotazione Ufficiale**: il campo `quotazione` ora sopravvive alla creazione/export/
  reimport di un'asta (prima si perdeva nel pool `poolGiocatori`, pur restando corretto su
  `listino_giocatori`).
- **Contatore Svincolati**: "X / Y giocatori chiamati" sopra la lista.
- **Fix — Diritto plusvalenza/recompra perso non persistente** (`backend/server.js`): spostato da
  `chiamataAttuale` (ricreata ad ogni chiamata) a `giocatore.dirittoRiacquistoPerso`
  (persistente). Dettagli in [DECISIONS.md](../DECISIONS.md).
- **Fix — Anteprima non resettata tra aste diverse**: chiave `localStorage` ora include
  `S.astaId`. Dettagli in [DECISIONS.md](../DECISIONS.md).
