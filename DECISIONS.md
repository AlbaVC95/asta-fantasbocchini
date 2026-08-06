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

## Timer d'asta autoritativo lato server, stato sempre broadcastato per intero

Il timer non viene mai calcolato o fidato lato client: è gestito interamente in `server.js`
(`startTimer`/`resetTimer`/`clearTimer`) per evitare che un client con orologio o rete diversi possa
percepire un tempo diverso da quello reale, cosa critica in un contesto competitivo di rilanci a
tempo. Per lo stesso motivo di semplicità/robustezza, non esistono aggiornamenti incrementali:
`broadcastStato()` reinvia sempre lo stato asta completo dopo ogni cambiamento, evitando bug di
stato client/server disallineato a costo di un payload più pesante.
