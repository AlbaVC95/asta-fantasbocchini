# DECISIONS.md

Decisioni tecniche importanti e il perché. Non contiene task né cronologia di sviluppo — vedi
`git log` per quello e [docs/SESSION_SUMMARY.md](docs/SESSION_SUMMARY.md) per lo stato attuale.

## Stato di gioco in memoria (`Map`), non su database relazionale

Le aste attive vivono in `const aste = new Map()` nel processo Node, non in una tabella. Un'asta live
richiede letture/scritture a bassissima latenza ad ogni rilancio (ordine di centinaia di ms sotto
timer); un round-trip al DB per ogni rilancio sarebbe stato più lento e più fragile in caso di picchi
di concorrenza. Contropartita accettata: lo stato si perde a un riavvio del processo, compensato dal
sistema di backup a doppio livello (vedi sotto).

## Backup a doppio livello (disco locale + Supabase)

Il disco locale (`backend/data/backup_asta_*.json`) da solo non basta perché su Render il filesystem
del container non sopravvive a un deploy/riavvio. Supabase (tabella `asta_backups`) da solo non basta
come unica rete di sicurezza in caso di problemi di rete/quota verso Supabase. Si tengono entrambi:
disco come rete di sicurezza immediata e sempre attiva, Supabase come quello che sopravvive ai riavvii
del container.

## Toggle Super Admin per disattivare il backup Supabase

Esiste un incidente noto di consumo di banda eccessivo dovuto ai backup periodici su Supabase
("incidente banda agosto 2026", citato nei commenti di `server.js`). Per poterlo evitare durante i
test/sviluppo senza rimuovere la rete di sicurezza, è stato aggiunto un toggle (persistito in
`app_settings`) che disattiva solo l'upload a Supabase — il backup su disco locale resta comunque
sempre attivo.

## Dedup via hash SHA1 sui backup Supabase

Stessa motivazione del toggle: i backup periodici (ogni 30s) e ad evento spesso contengono contenuto
identico al backup precedente. Si calcola un hash SHA1 del contenuto e si salta l'upload se invariato,
per ridurre traffico verso Supabase senza perdere garanzie di persistenza.

## Doppio retry ritardato in `deleteBackupSupabase`

A fine asta il backup "in corso" va eliminato da `asta_backups`, ma esiste una race condition nota con
l'autosave dei 30s: se l'autosave schedulato scatta subito dopo la cancellazione, ricrea il record
appena eliminato. Per questo `deleteBackupSupabase` viene richiamato con un doppio retry ritardato
invece di un singolo tentativo immediato (vedi commenti in `server.js` attorno a
`saveExportSupabase`/`deleteBackupSupabase`).

## Pulizia periodica della Map `aste` (24h / 30 giorni)

Senza pulizia, ogni asta mai chiusa esplicitamente o abbandonata resterebbe in memoria per sempre,
causando una fuga di memoria nel processo long-running. Si è scelto un job orario che rimuove le aste
terminate da più di 24h o create da più di 30 giorni, come compromesso tra "tenerle disponibili
abbastanza a lungo per debug/recupero" e "non far crescere la RAM indefinitamente".

## Tre livelli di autenticazione separati (adminToken / ruolo profiles / Super Admin hardcoded)

I tre livelli rispondono a esigenze diverse che non si sovrappongono: il controllo su una singola asta
non deve richiedere un account registrato (chi ha il link/token la amministra), le funzioni globali di
gestione contenuti richiedono un ruolo applicativo persistito, e le azioni distruttive/globali
(chiudere tutte le aste, disattivare il backup per tutti) richiedono un livello ulteriore ristretto a
una singola email hardcoded, per limitarne al massimo la superficie. Tutti e tre sono verificati
lato server, mai fidandosi di flag lato client.

## Toggle "admin" per la modalità manutenzione (stesso pattern del toggle backup)

Serve un modo per bloccare l'uso dell'app a tutti i partecipanti mentre si fanno modifiche in
produzione, senza dover fermare il processo o rimuovere l'accesso all'Admin che sta lavorando. Si è
riusato esattamente il pattern già esistente per il toggle backup Supabase: stato persistito in
`app_settings` (id `manutenzione_attiva`), broadcast via socket (`manutenzione-changed`) a tutti i
client connessi per bloccarli/sbloccarli in tempo reale senza reload, endpoint di lettura pubblico
(nessun dato sensibile) ed endpoint di scrittura riservato al ruolo `admin`. Il blocco è solo lato UI
(overlay full-screen `#screen-manutenzione` che copre tutto tranne per chi ha `role === 'admin'`): non
tocca i singoli handler socket (`join-asta`, `rilancio`, ecc.) per non introdurre rischi nell'area più
delicata del progetto (timer d'asta, vedi sotto).

## Griglia P/A: qualità sportiva come filtro+ordinamento, budget come filtro secco (non più blend continuo)

Il vecchio approccio (`score = qualityScore*0.6 + priceScore*0.4`, sia per Portieri che Attaccanti)
faceva salire in classifica combinazioni sportivamente mediocri solo perché economiche — il prezzo
"schiacciava" la qualità anche dopo lo stretch min-max introdotto in precedenza (vedi sopra). Sostituito
con una logica in tre fasi dentro `applyRankingQualitaBudget()`
([gk-planner-engine.js](frontend/js/gk-planner-engine.js)): (1) filtro qualità minima dinamica (soglia
80/100, si abbassa a scaglioni di 5 se troppo poche combinazioni la superano, mai sotto 50); (2) filtro
budget secco (scarta chi supera il target configurato di oltre il 15%, senza premiare chi costa meno);
(3) ordinamento finale SOLO per qualità, con il prezzo usato come spareggio solo fra combinazioni a
qualità quasi identica (differenza ≤3 punti). Applicata sia a Portieri che Attaccanti (stesse funzioni
condivise). Se nessuna combinazione rientra nel budget dopo il filtro qualità, si ripiega comunque sulle
migliori per qualità invece di restituire una Griglia vuota.

## Export/Import Strategia: fasce riferite per indice, non per id Supabase

L'id di una fascia (`fasce.id`) è generato da Supabase ed è specifico dell'installazione/database in cui
è stata creata — non ha senso portarlo in un file esportato da un'altra istanza dell'app. L'export
usa quindi l'indice della fascia nell'array esportato (`fascia_index`) come riferimento stabile;
l'import ricrea le fasce nello stesso ordine e riassocia i giocatori tramite quell'indice. L'unico id
portato tale e quale è `giocatore_id`, perché è l'id ufficiale del listino Mantra (colonna `#` del file
Excel), condiviso fra tutte le installazioni che usano lo stesso listino — è anche il criterio con cui
l'import scarta silenziosamente i giocatori non più presenti nel Listino Ufficiale corrente.

## Auction Value: nuova stima del costo SOLO per la Griglia P/A, il FVM resta invariato ovunque

Il FVM ufficiale rappresenta bene il valore di un giocatore, ma non il prezzo che una combinazione
raggiunge realmente in un'asta: le squadre forti finivano sistematicamente sottostimate come costo, e
quindi sovra-raccomandate. Introdotto un `auctionValueSquadra`/`auctionValueGruppo` in
[gk-planner-engine.js](frontend/js/gk-planner-engine.js), usato ESCLUSIVAMENTE per il costo atteso
della Griglia P/A — Listino, Strategia, Asta, Scambi e Comparazioni continuano a leggere `fvm1000`
direttamente, invariati. Formula: riusa la stessa aggregazione FVM di `costoAttesoSquadra` (Portieri:
somma di tutti i portieri; Attaccanti: migliore*100% + secondo*40%, logica NON toccata), poi applica un
moltiplicatore di "premio di mercato" in base alla Forza Squadre (Difesa per i Portieri, Attacco per gli
Attaccanti). Moltiplicatori configurabili in Config Admin ("Moltiplicatori Auction Value", sezione
`gk-admin-only`), default 1.00 per Forza 1-5 salendo fino a 1.50 per Forza 10 — nessuna penalizzazione
alle squadre piccole, solo un premio crescente per quelle forti.

Contestualmente si è ripristinato il comportamento pre-esistente (poi reintrodotto per richiesta
esplicita dell'utente dopo un primo tentativo con filtro budget secco, vedi commit precedente): il
ranking finale torna a un blend pesato `qualityScore*0.6 + priceScore*0.4` per Portieri E Attaccanti, e
**nessuna combinazione viene mai esclusa dal ranking per motivi di budget** — il budget configurato
dall'utente influenza solo l'ordinamento e il colore (over/entro budget), mai la visibilità. Il tentativo
precedente (filtro qualità minima + esclusione secca sopra budget + ordinamento solo per qualità) è
stato abbandonato perché nascondeva combinazioni che l'utente vuole invece vedere sempre.

## Registrazione: signUp resta lato client, ma l'accettazione delle Condizioni Closed Beta è validata e scritta solo dal backend

Per il nuovo flusso di registrazione (Nome/Cognome/Età + accettazione obbligatoria delle Condizioni di
partecipazione alla Closed Beta) si è valutato di spostare la creazione dell'utente Supabase stesso nel
backend (service role, `admin.createUser`), per poter rifiutare la creazione dell'account se
`termsAccepted` non è `true`. Scartato di proposito: `supa.auth.signUp()` chiama comunque l'API
pubblica di Supabase con la chiave anon (per natura pubblica), quindi un bypass diretto della UI
dell'app resterebbe comunque possibile chiamando quell'API con altri strumenti — un limite intrinseco
della piattaforma non chiudibile da codice applicativo senza disabilitare la registrazione pubblica su
Supabase (azione da dashboard, fuori scope, non richiesta). Spostare la creazione utente lato backend
avrebbe inoltre richiesto rinunciare alla mail di conferma già gestita da Supabase (nessuna
infrastruttura di invio email esiste nel progetto) — un cambio di UX più invasivo del necessario.

Approccio scelto: `signUp` resta invariato lato client (nessun cambio alla UX di conferma email
esistente), con nome/cognome/età/accettazione passati come `user_metadata` (`options.data`). Un nuovo
endpoint `POST /api/auth/completa-registrazione` (`backend/server.js`) — chiamato in modo non
bloccante ad ogni login/restore sessione da `applicaUtenteLoggato()` in `app.js` — legge questi dati
**da Supabase stesso** (mai dal body della richiesta), li valida indipendentemente lato server, e solo
se validi scrive su `profiles` con timestamp (`terms_accepted_at`) e versione (`terms_version`)
generati/decisi **sempre dal server**, mai dal client. Per gli utenti registrati prima di questo cambio
(nessun `user_metadata.nome`) l'endpoint è un no-op esplicito: restano intoccati.

## Titolarità e Commento: dati personali per Strategia, sola lettura in Asta

Aggiunte due colonne a `strategia_giocatori` (`titolarita` smallint 1-5, `commento` text),
stesso pattern di `prezzo`/`percentuale`/`preferito` già presenti sulla tabella: sono dati
della Strategia dell'utente, non condivisi tra i partecipanti della lega, e non richiedono
una tabella o un livello di permessi separati. Editabili solo nell'editor Strategia (bottone
titolarità con modal a 5 stelle, icona commento con modal a textarea); in Asta, alla chiamata
del giocatore e nella lista Svincolati, sono mostrati in **sola lettura** — nessun salvataggio
avviene durante l'asta live, per non introdurre scritture concorrenti su Supabase nell'area
più delicata del progetto (timer/rilanci). Motivazione: sono note di preparazione pre-asta,
non c'è un caso d'uso reale per modificarle sotto il timer di un rilancio.

## Filtri/ricerca/ordinamento Strategia: due copie DOM sincronizzate, non spostate

La pagina Editor Strategia può avere una lista di fasce/giocatori molto lunga tra l'header e i
controlli di ricerca/filtro ruolo/ordinamento (che stavano solo sopra "Non assegnati"),
costringendo a molto scroll. Invece di spostarli in cima (perderebbe comodità quando si è già
scrollati in fondo) o di usare una barra sticky (comportamento diverso, mai usato altrove
nell'app), si sono duplicati gli stessi controlli in cima alla pagina, con classi condivise
(`editor-cerca-input`, `editor-filtro-ruolo-group`, `editor-ordina-campo-select`,
`editor-ordina-dir-btn`) invece di id univoci: ogni handler in `setupEditor()` aggiorna lo
stato condiviso in `S` e rispecchia il nuovo valore su **tutte** le copie via
`querySelectorAll`, cosi' le due istanze non vanno mai fuori sincrono indipendentemente da
quale l'utente usa.

## Diritto plusvalenza/recompra perso: persistito sul giocatore, non sulla chiamata

Bug reale: il flag che segna "il proprietario precedente ha già punteggiato su questo giocatore
in questa asta" (quindi ha perso il diritto a plusvalenza/recompra) viveva su
`chiamata.proprietarioPrecedenteHaPuntato`, dentro l'oggetto `chiamataAttuale` che viene
ricreato da zero ad ogni ri-chiamata dello stesso giocatore (timer scaduto e riaperto, asta
annullata e ripetuta, richiamata manuale) — il diritto perso veniva quindi "resuscitato" come
effetto collaterale del reset, mai per scelta esplicita. Spostato su `giocatore.
dirittoRiacquistoPerso` (persistente, vive sull'oggetto in `asta.poolGiocatori`, sopravvive a
qualunque ricreazione di `chiamataAttuale` e viene salvato/ripristinato dal backup esistente
come tutti gli altri campi del giocatore). Impostato una sola volta al primo rilancio del
proprietario precedente, mai resettato automaticamente da nessun punto del codice.

## Anteprima: chiave `localStorage` per-asta, non solo per-squadra

Bug reale: `Anteprima` (planner di formazione locale, vedi sopra "Redesign 3D") salvava tutto
sotto un'unica chiave fissa (`ftb_anteprima_v1`) indicizzata solo per nome squadra — entrando in
un'asta nuova con una squadra dallo stesso nome di una precedente, si ereditava la formazione
salvata nell'asta finita, con giocatori che magari non fanno più parte della rosa attuale. La
chiave ora include `S.astaId` (`_antLsKey()`), cosi' ogni asta parte con uno stato pulito senza
bisogno di reset manuali; lo stato resta comunque locale al browser (nessun cambio a questa
scelta architetturale, vedi sopra).

## Timer d'asta autoritativo lato server, stato sempre broadcastato per intero

Il timer non viene mai calcolato o fidato lato client: è gestito interamente in `server.js`
(`startTimer`/`resetTimer`/`clearTimer`) per evitare che un client con orologio o rete diversi possa
percepire un tempo diverso da quello reale, cosa critica in un contesto competitivo di rilanci a
tempo. Per lo stesso motivo di semplicità/robustezza, non esistono aggiornamenti incrementali:
`broadcastStato()` reinvia sempre lo stato asta completo dopo ogni cambiamento, evitando bug di
stato client/server disallineato a costo di un payload più pesante.
