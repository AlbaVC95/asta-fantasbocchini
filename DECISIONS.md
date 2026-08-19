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

## Anteprima 3D: dimensione carte in `cqw` (container query) invece di px fissi, per evitare sovrapposizioni a qualunque zoom

Bug reale segnalato dall'utente dopo l'uso in produzione del redesign 3D: le carte sul campo
tattico (`.ant-card.size-pitch`) si sovrapponevano vistosamente, specialmente allo zoom minimo
del campo (`_antSetPitchSize`, 220-460px). Causa: dimensione carta fissa in px indipendente dal
contenitore — a campo piccolo la carta occupa una fetta molto più grande dello spazio tra gli
slot. Misurato con `getBoundingClientRect()` su tutti gli 11 moduli: con carta fissa, l'overlap
passava da ~5% al campo massimo a ~45% al campo minimo. Soluzione: `.ant-pitch` dichiarato
`container-type:inline-size`, `.ant-card.size-pitch`/`.ant-slot3d-empty` dimensionati in `cqw`
(percentuale della larghezza REALE del contenitore, non del viewport) — così la carta scala
proporzionalmente col campo e l'overlap misurato resta costante a qualunque livello di zoom,
invece di peggiorare quando l'utente rimpicciolisce. Nota per debug futuro: durante la misura via
browser automatizzato, `getComputedStyle().maxWidth`/`getBoundingClientRect()` letti subito dopo
aver cambiato `--ant-pitch-size` restituivano valori non aggiornati a causa della
`transition:max-width .15s ease` su `.ant-pitch` — bisogna forzare `element.style.transition =
'none'` (o attendere un frame reale) prima di misurare, altrimenti i numeri sono inattendibili.

Oltre al cambio di unità, `ANT_LAYOUT` (`app.js`) è stato riscritto con un template di fasce
verticali condivise (`ANT_Y5`/`ANT_Y4`, ~21-23% di gap) per tutti gli 11 moduli — un gap
verticale inferiore al ~20% dell'altezza campo produce quasi sempre sovrapposizione quando due
ruoli di righe adiacenti condividono una X simile (es. portiere e difensore centrale nei moduli a
3 difensori, entrambi centrati a x=50). Scartato un primo tentativo di rendere le carte "più 3D"
cambiando l'angolo di controrotazione (-50°→-42°) e aumentando il `translateZ`: ingrandiva la
proiezione a schermo della carta e PEGGIORAVA le sovrapposizioni su tutti gli 11 moduli, incluso
alcuni che prima erano puliti — l'angolo/translateZ originali (-50°/34px, già verificati nel
redesign precedente) sono stati mantenuti invariati, e la sensazione di volume richiesta
dall'utente ottenuta invece via luce/ombra CSS (`.ant-card.on-pitch`) senza toccare la geometria
di proiezione.

## Nomi giocatore in Anteprima: auto-fit a riga singola (font ridotto su misura), non wrap multi-riga

Requisito esplicito dell'utente, chiarito dopo un round intermedio: i nomi giocatore devono
stare **su una riga sola** (mai andare a capo) E non devono mai essere tagliati né sovrapporsi
al nome dello slot vicino. Un primo tentativo aveva usato il wrap su più righe
(`-webkit-line-clamp`) per evitare i tagli, ma l'utente ha chiarito che il wrap multi-riga non
va bene: serve una riga sola. Poiché nessun `max-width` fisso (px o cqw) può garantire "riga
singola + mai tagliato + mai sovrapposto" per ogni riga di `ANT_LAYOUT` — righe con pochi
giocatori hanno più margine di righe da 5, e la prospettiva 3D fa sì che lo stesso gap in
percentuale corrisponda a pixel diversi a seconda della profondità della riga — la soluzione è
un **auto-fit a runtime**: `_antFitEtichetteCampo()` misura con `getBoundingClientRect()` la
distanza reale in pixel tra slot vicini sulla stessa riga dopo il render, e
`_antFitTestoLabel()` riduce il `font-size` di ogni etichetta (a step di 0.5px, pavimento 5px)
finché il nome (sempre `white-space:nowrap`) non entra in quello spazio. Stesso helper riusato
per il nome sulla carta XL dell'animazione di assegnazione (nessun vicino: budget fisso
generoso). `ANT_PITCH_SIZE_MIN` resta alzato a 250 (da un fix precedente) come ulteriore
margine di sicurezza.

**Gotcha da ricordare** (rimasto valido anche col nuovo approccio, per la carta XL): il testo
che deve essere misurato/ridimensionato via JS (`scrollWidth`, `-webkit-line-clamp` se mai
servisse di nuovo) va sempre in uno `<span>` interno NON posizionato, dentro all'elemento
`position:absolute` usato solo per il posizionamento — `display:-webkit-box` e simili non hanno
effetto se applicati direttamente a un elemento assoluto (Chrome lo "blockifica"
silenziosamente). Pattern: `.ant-slot3d-label`/`.ant-slot3d-name-txt` (campo),
`.ant-card-name`/`.ant-card-name-txt` (carta XL/panchina).

## Anteprima su mobile: sposta davvero il nodo DOM tra drawer (desktop) e tab (mobile), non solo CSS

Su desktop Anteprima è un drawer laterale indipendente (`#tab-anteprima`, figlio di
`.asta-live-layout`, sibling di `.asta-main-col`) che può restare aperto sopra un'altra tab
attiva — comportamento voluto, non toccato. Su mobile l'utente ha chiesto esplicitamente che si
comporti come una tab normale (esclusiva con le altre, non un pannello che si espande sotto
tutto il resto della pagina). Invece di scrivere CSS parallelo che duplica il comportamento di
`.tab-content`/`.tab-content.active` (rischio di andare fuori sincrono ad ogni modifica futura
allo scroll/layout delle tab, vedi il fix strutturale in cima a questo file), si è scelto di
**spostare fisicamente il nodo DOM** dentro `.tabs-panel` quando si è sotto i 760px
(`_antSyncDrawerLayout()` in `app.js`), aggiungendo solo la classe `.ant-drawer-as-tab` che
attiva regole di visibilità minime (`display:none`/`.active{display:flex}`) dentro il
`@media(max-width:760px)` esistente. Nessun codice interno di Anteprima si accorge dello
spostamento (tutto lavora per `getElementById`, incluso il posizionamento del picker che è
relativo — `picker.parentElement` — quindi si muove insieme al resto).

Sincronizzazione a due livelli, perché un solo listener di resize non è affidabile in ogni
contesto (verificato: l'emulazione viewport di alcuni tool di automazione non sempre dispara un
evento `resize` "vero"): `matchMedia('(max-width:760px)').addEventListener('change', ...)`
all'avvio/al cambio soglia, **più** una ri-verifica difensiva a inizio del click handler di ogni
tab (`_antSyncDrawerLayout()` chiamato ad ogni click, idempotente) — così anche se l'evento di
resize non fosse scattato in tempo, il primo click su una tab corregge comunque lo stato prima
di decidere cosa mostrare.

## Carta XL dell'animazione: dimensioni sempre fisse (110×152), mai copiate dalla forma di `.cc-avatar`

Bug reale, rimasto nascosto per 3 round di fix perché i test in locale creavano la carta XL
isolata con dimensioni fisse invece di passare dal flusso reale: `_playAssegnazioneCardFx()`
forzava la carta a riempire (`width/height:100%`) un contenitore dimensionato esattamente come
`.cc-avatar` al momento dell'assegnazione — ma `.cc-avatar` cambia forma parecchio tra i layout
(cerchio 84×84 in alcuni contesti, rettangolo `width:118px;height:auto` STIRATO da
`top:8px;bottom:8px` nel layout admin, che puo' arrivare a 200px+ di altezza). Il risultato:
la carta "ereditava" la forma spesso molto allungata dell'avatar sorgente invece delle sue
proporzioni disegnate, con la fascia del nome (percentuale dell'altezza) che sembrava
eccessiva perché calcolata su un'altezza molto maggiore del previsto.

Fix: la carta ha ora dimensioni SEMPRE fisse (110×152, mai lette/copiate da `.cc-avatar`),
centrata sul punto medio dell'avatar sorgente. L'illusione "esce da lì" viene affidata a una
scala di partenza proporzionale alla larghezza dell'avatar (non alla sua forma), non più a una
dimensione/forma copiata 1:1. Lezione per i test futuri su questo componente: verificare sempre
anche il flusso reale (`_playAssegnazioneCardFx` con un `#chiamata-card .cc-avatar` presente),
non solo la carta creata isolata con `_antCardHTML(...)` — è quel secondo modo di testare che
aveva nascosto il bug nei round precedenti.

## Toggle animazione assegnazione carta: locale (localStorage), non sincronizzato lato server

Per lo stesso motivo del toggle pitch-size (`antPitchSize`): l'animazione di assegnazione
(`_playAssegnazioneCardFx()`) è già un effetto puramente client-side (nessun evento socket
dedicato, si aggancia solo a `giocatore-assegnato` che arriva comunque a tutti). Decisione presa
con l'utente: il nuovo toggle on/off in "Impostazioni Admin" resta locale al browser
(`localStorage['antFxAbilitata']`, default attivo) invece di diventare un campo della config asta
sincronizzato via `admin-update-config`/`broadcastStato()` — evita di toccare lo stato asta
condiviso lato server per una preferenza puramente visiva e per-dispositivo.

## Cambio modulo in Anteprima: matching bipartito (Kuhn) invece di greedy per ricollocare i giocatori

Richiesta esplicita dell'utente: cambiando modulo (es. 4-3-3 → 4-2-3-1) i giocatori già
piazzati non devono più essere cancellati, ma ricollocati automaticamente dove il ruolo lo
permette, riusando la stessa `_ruoliCompatibili()` già usata dal picker (nessuna nuova regola
R.Mantra). Il problema è un matching bipartito (giocatori piazzati ↔ slot del nuovo modulo, arco
solo se i ruoli sono compatibili) — scartato un abbinamento greedy semplice ("assegna il primo
slot libero compatibile nell'ordine in cui si processano i giocatori") perché può bloccare un
abbinamento migliore: un giocatore con un solo slot possibile può restare senza posto solo perché
un giocatore precedente, che aveva anche altre opzioni valide, ha occupato per primo quell'unico
slot. Risolto con l'algoritmo di Kuhn (augmenting path, `_antRimappaSlotSuNuovoModulo()` in
`app.js`): quando un giocatore non trova slot libero, l'algoritmo tenta di RIASSEGNARE il
giocatore che occupa uno slot candidato a un'altra opzione valida, liberandolo — garantendo il
numero massimo di giocatori riposizionabili, non solo il primo risultato trovato. Scala tipica
(~11 giocatori × ~11 slot) rende il costo computazionale irrilevante. Chi non trova comunque
posto nel nuovo modulo torna in Panchina (derivata al volo da rosa meno slot occupati), mai
rimosso dalla rosa.

## Timer d'asta autoritativo lato server, stato sempre broadcastato per intero

Il timer non viene mai calcolato o fidato lato client: è gestito interamente in `server.js`
(`startTimer`/`resetTimer`/`clearTimer`) per evitare che un client con orologio o rete diversi possa
percepire un tempo diverso da quello reale, cosa critica in un contesto competitivo di rilanci a
tempo. Per lo stesso motivo di semplicità/robustezza, non esistono aggiornamenti incrementali:
`broadcastStato()` reinvia sempre lo stato asta completo dopo ogni cambiamento, evitando bug di
stato client/server disallineato a costo di un payload più pesante.

## Asta di riparazione: Massima Offerta come ottimizzazione (p,m), non top-N per valore

La stima dei crediti recuperabili da svincolo ordinava la rosa per valore economico e sommava
i primi N (N = svincoli residui), ignorando l'effetto sulla composizione Portieri/Movimento —
poteva quindi suggerire di liberare giocatori che facevano scendere una categoria sotto il
minimo configurato, sottostimando la vera Massima Offerta (la riserva calcolata sui minimi non
teneva conto di QUALI giocatori sarebbero stati liberati). Sostituito con una ricerca su tutte
le combinazioni possibili (p portieri, m movimento da liberare, con `p+m <= svincoliRimanenti`)
che massimizza `crediti + recuperabili(p,m) - riservati(p,m)`, dove la riserva è calcolata
SIMULANDO la rimozione di p/m giocatori dalla rosa attuale prima di confrontare con i minimi
(`calcolaPianoSvincoloOttimale()` in `backend/server.js`, prefix-sum per accesso O(1) al
recupero di ciascuna categoria — scala tipica ≤ ~900 combinazioni, irrilevante). Non forza
l'uso di tutti gli svincoli disponibili: un ultimo svincolo che costa più in riserva di quanto
recupera in crediti non viene scelto, la ricerca esplora anche k inferiori. Verificato contro
un esempio numerico fornito dall'utente prima di scrivere codice (26 movimento/minimo 25/0
crediti/3 svincoli da 10cr, fattore 0.5 → atteso 14, non 15 come darebbe un top-N ingenuo).

I minimi Portieri/Movimento restano vincoli "morbidi" (solo riserva di crediti, mai bloccano
uno svincolo): una squadra può scendere temporaneamente sotto un minimo dopo uno svincolo,
scelta esplicita dell'utente per non impedire operazioni altrimenti legali. Il tetto rosa
(`maxGiocatoriPerSquadra`) è invece un vincolo DURO (`kRoster` nel codice): se non c'è modo di
liberare abbastanza spazio con gli svincoli residui, l'offerta/operazione è impossibile a
prescindere dai crediti disponibili.

Conseguenza su una decisione presa in una sessione precedente: il blocco assoluto "squadra al
tetto rosa non può mai offrire" (aggiunto per `maxGiocatoriPerSquadra`) si applicava a
`calcolaMaxOfferta()` senza distinguere `tipoAsta`. In riparazione questo impediva di vincere
un giocatore anche quando la squadra aveva svincoli disponibili per fare spazio DOPO la
vittoria — corretto rendendo il blocco condizionato: bloccata solo se al tetto E senza
svincoli residui. `tipoAsta==='iniziale'` mantiene il blocco assoluto originale, invariato
(non esiste un meccanismo di svincolo in quel tipo di asta).

## Asta di riparazione: svincoli post-vittoria, non durante il rilancio

Coerentemente con l'asta di riparazione che già permette offerte sopra i crediti correnti
(risolte poi con un popup di svincolo, vedi sopra "Backup a doppio livello" — pattern
preesistente), il trigger del popup è stato allargato: prima scattava solo per crediti
insufficienti (`offertaAttuale > sq.crediti`), ora scatta anche per mancanza di SPAZIO rosa
rispetto al tetto configurato. Il numero minimo di svincoli da liberare (crediti E spazio) è
calcolato server-side (`calcolaSvincoliMinimiPerVittoria()`) e comunicato al client come
suggerimento pre-selezionabile — l'allenatore resta libero di liberarne di più (fino al limite
residuo) ma mai di meno. Caso limite esplicitamente gestito (richiesta dell'utente): se anche
liberando tutti gli svincoli residui non basta (dovrebbe essere impossibile se Massima Offerta
funziona bene, ma può accadere con un'assegnazione manuale admin che ignora i limiti),
l'operazione viene bloccata con un errore invece di lasciare crediti negativi o la rosa oltre
il tetto — `chiamataAttuale` non viene toccata, l'admin può ritentare.

L'handler `esegui-svincolo` non validava nulla lato server (bypassabile dal client: nessun
controllo su copertura crediti, tetto svincoli per operazione, o tetto cumulativo
`svincoliTotali`) — aggiunta validazione autoritativa completa, stesso principio già applicato
al timer d'asta ("il server non si fida mai del client").

## Asta di riparazione: "stato morto" bloccato con `verificaCapacitaRecupero`, non con soglie dirette su crediti/svincoli

Bug reale in produzione (squadra "Adriano&Federico", asta_id `b953b4db-250e-4f2f-b374-c76391505906`):
finita a `21/32, 🧤 0/3 portieri, 💰 0 crediti, 🔓 0/15 svincoli` — sotto il minimo portieri e
senza più alcuna risorsa per recuperare. Causa reale, riprodotta con la sequenza esatta delle
8 operazioni ricostruite dall'export Supabase reale: `calcolaMaxOfferta()` aveva un ramo
speciale `if (svincoliRimanenti <= 0) return squadra.crediti` che ignorava del tutto la riserva
sui minimi (introdotta per il caso normale, vedi sopra "Massima Offerta come ottimizzazione")
quando gli svincoli erano finiti — proprio il caso in cui la riserva serve di più. Con 0
svincoli residui e 0/3 portieri, la Massima Offerta tornava 5 crediti crudi invece di riservarne
3 per i portieri mancanti; l'ultima chiamata normale (nessuno svincolo coinvolto) ha speso quei
5 crediti, azzerando ogni risorsa residua in uno stato ormai irrecuperabile.

Scartati esplicitamente pattern semplicistici tipo `if (crediti===0) blocca` o
`if (svincoli===0) blocca tutti gli svincoli`: bloccherebbero anche operazioni legittime che
lasciano la squadra temporaneamente sotto un minimo ma ancora recuperabile (comportamento
esplicitamente voluto, vedi sopra "vincoli morbidi"). Serviva invece un controllo che simuli lo
stato RISULTANTE di un'operazione e verifichi se da lì esiste ancora una combinazione di
crediti+svincoli residui capace di raggiungere i minimi — non se l'operazione stessa consuma
l'ultima risorsa.

Fix (nessuna nuova formula economica, solo un nuovo predicato sopra le funzioni esistenti):
- Rimosso il ramo speciale `svincoliRimanenti<=0` da `calcolaMaxOfferta()` — ora delega sempre a
  `calcolaPianoSvincoloOttimale()`, che già gestisce correttamente 0 svincoli residui (nessun
  recupero possibile, solo riserva sui minimi correnti) essendo un caso particolare della stessa
  ricerca (p=0, m=0 è sempre tra le combinazioni valutate).
- `calcolaPianoSvincoloOttimale()` ora ritorna anche `valoreGrezzo` (il valore netto NON
  pavimentato a 1 credito) — necessario per distinguere "posso ancora offrire almeno 1cr per
  convenzione UI" da "sono realmente in grado di coprire la riserva senza andare in negativo".
- Nuova `verificaCapacitaRecupero(asta, squadraSimulata, svincoliRimanenti, capMax)`:
  `piano.possibile && piano.valoreGrezzo >= 0` — il predicato di "stato morto", riusato in tre
  punti (non duplicato): dentro `esegui-svincolo` (rifiuta una scelta specifica di giocatori da
  liberare se lascerebbe la squadra senza via d'uscita, es. liberare tutti i portieri quando
  bastava liberare movimento), in una nuova validazione finale di `termina-asta` per l'asta di
  riparazione (blocca la chiusura se una squadra risulta sotto un minimo o sopra il tetto al
  momento esatto di chiusura già esistente, nessun nuovo punto di validazione inventato), e
  specchiata lato client (`_verificaCapacitaRecuperoCli`) solo come hint UI che disabilita
  "Conferma svincolo" — la validazione autoritativa resta sempre server-side.
- `assegna-manuale` (admin) resta volutamente FUORI da questi controlli, stessa scelta esplicita
  già presa in una sessione precedente per la creazione dell'asta di riparazione: l'admin può
  bypassare i limiti automatici in casi eccezionali, a proprio rischio.

Verificato con 29 test standalone Node sul codice REALE estratto (10 scenari mandatori inclusa
la riproduzione esatta del bug reale, 4 sulla scelta di combo in `esegui-svincolo`, 3 su
`termina-asta`, 6 di sincronia client↔server sugli stessi input, 6 di regressione su
`tipoAsta==='iniziale'` e sui casi "sotto il minimo ma ancora recuperabile" che devono restare
permessi) — tutti PASS, nessuna regressione sui vincoli morbidi esistenti.

## Strategia ↔ tipo asta: tabella ponte additiva, non colonna array/modifica dello schema esistente

`strategie.tipo_asta` era scalare (un solo valore), impedendo strutturalmente a una strategia
di essere compatibile con più di un'asta. Scartata l'opzione di convertire la colonna in
`text[]` (avrebbe richiesto un `ALTER COLUMN TYPE` con migrazione dei dati esistenti, più
rischioso) in favore di una nuova tabella `strategia_tipi_asta(strategia_id, tipo_asta)`,
stesso pattern RLS già usato da `fasce`/`strategia_giocatori` (ownership verificato via
subquery su `strategie.user_id`, non hanno una colonna `user_id` propria). `strategie.tipo_asta`
resta intatta come dato storico/fallback, mai più letta dal codice; un backfill iniziale crea
una riga ponte per ogni strategia esistente così le strategie già create restano compatibili
senza bisogno di reimportarle.
