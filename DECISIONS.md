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

**Secondo bug trovato subito dopo il deploy, stesso incidente**: l'utente ha riportato lo stesso
sintomo su un'asta NUOVA (screenshot: Adriano&Federico, 28/32, 0 portieri, 0 crediti, 0/15
svincoli, popup Admin che mostrava comunque "Max: 1cr"). Causa: `calcolaPianoSvincoloOttimale()`
aveva un pavimento `Math.max(1, valoreGrezzo)` che garantiva SEMPRE almeno 1 credito di offerta
consentita anche quando `valoreGrezzo` è negativo (nessuna strategia futura basta a coprire il
deficit) — `calcolaMaxOfferta()` delega direttamente a questo valore per bloccare i rilanci nel
handler `'rilancio'`, quindi il pavimento permetteva di vincere un'offerta "fantasma" da 1
credito in uno stato già senza via d'uscita. `verificaCapacitaRecupero()` avrebbe rilevato
correttamente lo stesso stato come irrecuperabile, ma non veniva mai interpellata in tempo per
bloccare la puja: le due funzioni erano disallineate. Nessuno dei 10 test mandatori copriva
questo ramo perché testavano `verificaCapacitaRecupero()` isolatamente, mai il valore di ritorno
di `calcolaMaxOfferta()` con `valoreGrezzo` negativo. Fix: pavimento cambiato a
`Math.max(0, valoreGrezzo)` (nel file reale e nello specchio client
`_calcolaPianoSvincoloOttimaleCli`) — un'offerta pari a 0 è correttamente rifiutata a monte
dall'handler `'rilancio'` (l'offerta minima è sempre ≥1, quindi `offerta > maxOff` scatta sempre
quando `maxOff===0`), nessun altro punto del codice presupponeva un pavimento di 1. Verificato
con 4 nuovi test (inclusa la riproduzione esatta dello screenshot: da "Max: 1cr" a "Max: 0cr") +
i 29 test precedenti rieseguiti, tutti PASS (33/33 totali).

## Badge fascia Strategia in Asta: chiavi della Map normalizzate a stringa, non affidate al tipo di `idFantaleghe` in arrivo

Bug reale segnalato dall'utente: le fasce Strategia non comparivano (nessun badge colorato) creando
un'asta da un JSON esportato in precedenza (`asta_FantaSbocchini_2026-08-18.json`). Causa:
`configByListinoId` (la Map costruita in `selezionaStrategiaAsta()`, `frontend/js/app.js`) usava come
chiave `row.giocatore_id` così com'è da Supabase — colonna `bigint`, quindi sempre un JS `number` —
mentre `g.idFantaleghe` sui giocatori dell'asta arriva con il tipo del file di origine: number quando
l'asta nasce dal bottone "Usa Listino Ufficiale" (`listino_giocatori.id`, anch'esso `bigint`→number),
ma **stringa** quando nasce da un file JSON esportato in precedenza (`idFantaleghe` salvato tra
virgolette) o da colonne Excel formattate come testo. `Map.get()` usa uguaglianza stretta: la chiave
numerica `7127` non combacia mai con la stringa `"7127"`, quindi il lookup falliva silenziosamente in
tutti i 5 punti che leggono `configByListinoId` (badge fascia in Puja/Svincolati, ordinamento per
fascia, filtro "solo preferiti") — confermato sui dati reali (Supabase: `strategia_giocatori` aveva
effettivamente righe con `fascia_id` per i giocatori del JSON, quindi non era un problema di fasce
mancanti in Strategia ma di lookup rotto).

Fix: chiavi del Map normalizzate a `String(...)` sia in scrittura (`selezionaStrategiaAsta`) sia in
lettura (tutti i punti che chiamano `configByListinoId.get(...)`), invece di far dipendere il match
dal tipo con cui `idFantaleghe` arriva da ciascuna fonte di import — nessuna fonte (JSON/Excel/Listino
Ufficiale) viene toccata. `String(null)` non collide mai con una chiave vera (sempre popolata da un
`giocatore_id` reale), quindi i giocatori senza id restano correttamente senza fascia.

## Import Strategia da JSON: selettore tipi asta riusato dal form, non un secondo picker

Bug/gap segnalato dall'utente: importando una Strategia da un file JSON esportato in precedenza
(bottone "📥 Importa strategia"), il tipo di asta associato veniva preso in automatico dal campo
`tipo_asta` scritto dentro il file stesso ([app.js:5577](frontend/js/app.js), versione precedente),
senza alcun selettore — impossibile assegnare la Strategia importata a un tipo diverso (es.
Riparazione 1) senza modificare il JSON a mano.

Invece di costruire un secondo selettore ad hoc, il flusso di import JSON è stato allineato al
flusso "Importa da FantaLab (Excel)" già esistente, che risolveva lo stesso problema riusando lo
`screen-strategia-form` (nome/crediti/checkbox tipi multi-selezionabili, [index.html:145-151]
(frontend/index.html)) prima di scrivere su Supabase: al posto di importare subito al `change` del
file input, il file JSON viene letto e parsato (`FileReader`) e i suoi valori (`nome`,
`crediti_totali`, `tipo_asta`) precompilano il form — la checkbox del tipo salvato nel file resta
premarcata come default comodo, ma è una checkbox normale che l'utente può cambiare o integrare
prima di premere "Crea strategia". La vecchia funzione one-shot `importaStrategiaDaFile(file)` è
stata sostituita da `_importaFasceGiocatoriDaJson(data, strategia)`, chiamata dal click handler
già esistente di "Crea strategia" (stesso punto dove FantaLab chiama
`_importaGiocatoriFantaLabInStrategia`) — nessuna nuova scrittura Supabase introdotta, solo lo
stesso inserimento di fasce/giocatori spostato dopo la creazione della strategia con i tipi scelti
dall'utente invece che con quello letto a sua insaputa dal file.

## Popup selezione svincolo (Asta di riparazione): rosa ordinata per ruolo, riuso di `_antRoleGroupOrder`

Richiesta esplicita dell'utente: nel popup di selezione dei giocatori da svincolare
(`renderPopupSvincolo`, `frontend/js/app.js`), la rosa veniva mostrata nell'ordine grezzo in cui
arriva in `popupData.rosa` (ordine di acquisizione/import), senza alcun raggruppamento — difficile
scorrere una rosa di 25+ giocatori per decidere chi liberare. Invece di scrivere un nuovo criterio
di ordinamento, riusata `_antRoleGroupOrder()` (già esistente per la Panchina di Anteprima, vedi
sopra "Panchina in Anteprima ordinata per ruolo"): stesso raggruppamento a 5 gruppi (Portiere →
Difesa → Centrocampo → Esterni → Attacco), così il criterio resta coerente in tutta l'app invece di
introdurne uno diverso solo per questo popup. Un semplice `.sort()` prima del `.map()` che genera
l'HTML, nessuna modifica alla struttura dati o al payload del server.

## Popup selezione svincolo: contatore selezionati + stato selezionato piu' visibile

Richiesta esplicita dell'utente dopo aver visto lo screenshot in produzione: il popup mostrava
"Recupero: X cr | Debito: Y cr" ma nessun conteggio di QUANTI/QUALI giocatori fossero selezionati —
con una rosa lunga bisognava scorrere tutta la lista controllando ogni singolo checkbox. Aggiunto un
contatore "👥 N selezionati" nella stessa riga (`aggiornaTotaleSvincolo()` in `frontend/js/app.js`,
già eseguita ad ogni `toggleSvincolo`, nessuna nuova chiamata introdotta) e rinforzato lo stile
`.sv-item.selezionato` (`frontend/css/style.css`): bordo 2px invece di 1px e sfondo rosso più
opaco (`.16` invece di `.06`), praticamente impercettibile alla dimensione originale.

## Asta di riparazione: annullamento come rollback completo, solo a ritroso

Richiesta esplicita dell'utente, con specifica dettagliata fornita prima di scrivere codice
(pianificato con `EnterPlanMode`). Due bug/gap distinti nello stesso meccanismo (`_annullaItem()`,
handler `annulla-assegnazione-specifica`, `backend/server.js`):

1. **Rollback incompleto per gli acquisti `con_svincolo`**: annullare un acquisto fatto liberando
   giocatori (`asta.storico` con `tipo:'con_svincolo'` e `svincolati:[...]`, salvato da
   `esegui-svincolo`) rimetteva solo il giocatore acquistato tra gli Svincolati e restituiva i
   crediti pagati per lui — ma ignorava `item.svincolati` del tutto: i giocatori liberati per
   finanziare l'acquisto restavano fuori rosa per sempre, i crediti recuperati dal loro svincolo
   non venivano sottratti (crediti gonfiati), gli slot svincolo consumati non tornavano disponibili,
   e restava un blocco fantasma in `asta.svincoliVietati`. Fix: `_annullaItem()` ora itera
   `item.svincolati` (che già contiene uno snapshot completo di ciascun giocatore — prezzo/ruolo/tipo
   originali — più `creditiRecuperati`, salvato al momento dello svincolo) e per ciascuno sottrae i
   crediti recuperati, restituisce lo slot svincolo, rimette il giocatore in `squadra.rosa` col
   prezzo originale, rimuove il blocco `svincoliVietati` e lo marca come non più chiamabile nel
   `poolGiocatori` (stesso pattern già usato per i giocatori importati direttamente in rosa in
   riparazione). Nessuna nuova struttura dati: tutto il necessario era già salvato da
   `esegui-svincolo`, mancava solo leggerlo in fase di annullamento.

2. **Annullamento fuori ordine cronologico**: `annulla-assegnazione-specifica` accettava un `index`
   arbitrario nello storico — annullare una vecchia estrazione lasciando invariate quelle successive
   può produrre stati incoerenti (crediti negativi, rosa oltre il tetto, slot svincolo errati, doppio
   recupero/sottrazione crediti), perché ogni estrazione modifica lo stato su cui le successive si
   basano. Fix: **solo per `tipoAsta === 'riparazione'`**, l'handler rifiuta la richiesta se
   `index !== asta.storico.length - 1` (si può annullare solo l'estrazione più recente, poi la nuova
   più recente, e così via a ritroso). `annulla-assegnazione` (senza index) non ha richiesto modifiche
   perché annulla già sempre e solo l'ultimo elemento. Asta iniziale esplicitamente esclusa dal
   vincolo (nessun requisito analogo, comportamento invariato). Specchiato lato client
   (`apriModalAnnullaStorico`, `frontend/js/app.js`) disabilitando il bottone su tutte le righe tranne
   la più recente quando l'asta è di riparazione, con tooltip esplicativo — solo hint UI, la
   validazione autoritativa resta sempre server-side.

Verificato con 30 test standalone Node sul codice REALE estratto da `_annullaItem()` (rollback
completo di un `con_svincolo` con 2 giocatori liberati, verificando crediti/rosa/svincoliUsati/
svincoliVietati/poolGiocatori tornano esattamente allo stato pre-operazione; rollback a ritroso di 2
estrazioni concatenate A→B annullate in ordine B poi A; regressione su `tipo:'normale'` e
`tipo:'scartato'`; blocco d'ordine su riparazione vs comportamento invariato su iniziale) — tutti
PASS. Verificato anche nel browser con dati sintetici: solo il bottone dell'estrazione più recente è
cliccabile in riparazione, tutti attivi in iniziale.

## Carta di Puja: nome/bottoni rilancio ingranditi su tablet/desktop, stesso pattern "blocco finale" già in uso

Richiesta esplicita dell'utente: nome giocatore e bottoni +5/+10/Rilancia troppo piccoli nella carta
di chiamata (`#chiamata-card`) su tablet/desktop. Prima di scrivere codice, un tentativo di
"ripulire" le regole CSS sparse per questo componente (`.puja-panel-slot`/
`body.layout-admin .asta-row-puja`, decine di dichiarazioni duplicate su `.cc-avatar` accumulate in
sessioni precedenti) ha rotto visivamente il nome in vista Admin (header collassato ad altezza 0,
nome fuori dal contenitore) — scartato subito, `git checkout` di ripristino.

Trovato invece un commento già esistente nel file (`style.css`, blocco "FIX 2026-08-13") che
documenta lo stesso identico problema affrontato in una sessione precedente e la soluzione scelta
apposta per NON rischiare regressioni: **non toccare/rimuovere le regole sparse storiche, aggiungere
invece un blocco nuovo in fondo al file** che vince per ordine di apparizione a parità di
specificità (con `!important` dove serve). Riapplicato lo stesso pattern per questo fix
(`frontend/css/style.css`, subito dopo il blocco "FIX 2026-08-13"): nuovo blocco
`@media (min-width:901px)` che ingrandisce SOLO `.cc-nome` (font-size, mai toccato sopra i 900px da
nessuna regola esistente), `.btn-quick`/`.btn-rilancia`/`.quick-bids-row` (idem) — **non tocca
`.cc-avatar`**, già dimensionato adeguatamente (86×112 partecipante, 108×140 admin, formato
"ritratto" con `object-fit:contain`) da quello stesso fix precedente. Scope `min-width:901px`
scelto perché sotto i 900px esiste già un trattamento dedicato (stacking dei bottoni sotto i 900px,
carta grande con nome 1.12-1.25rem sotto i 640px) verificato funzionante e da non toccare.

**Bug di tooling reale durante l'implementazione**: dopo aver inserito il blocco con lo script Node
(corretto), è stato usato per errore l'Edit tool standard per sistemare degli apici mal-escaped nel
commento — esattamente l'operazione vietata per questo file (vedi sopra, gotcha CRLF). Ha
silenziosamente convertito le 181 righe LF-only storiche (tutte concentrate nella sezione finale del
file, righe 2408-2588) in CRLF, gonfiando il diff da 29 a 391 righe cambiate. Rilevato subito
confrontando il conteggio di righe LF-only (`awk`) tra working tree e `git show HEAD`. Corretto con
`git checkout` di ripristino + ripetizione completa via script Node (nessuna chiamata Edit tool).

**Bug preesistente scoperto durante la verifica, NON causato da questo fix**: in vista Admin, tra
~900px e ~1200px di larghezza, `.rilancio-box` esce completamente dal viewport (verificato:
`x:928, width:908` su un viewport di 950px). Riprodotto identico anche con questo fix disattivato
(`git stash`) — pre-esistente, fuori scope, non corretto in questo intervento. Segnalato all'utente,
non affrontato.

**Verificato**: nel browser (dev server locale, dati sintetici in console) — 1280px vista
partecipante e admin (nome/bottoni visibilmente più grandi, nessun overflow, header admin torna ad
altezza 44px invece di 0), 390px vista partecipante (identico pixel-per-pixel a prima, confermato
che il nuovo blocco non tocca il breakpoint mobile).

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


## Identità visiva "Serata d'Asta": palette nelle variabili, struttura in un foglio a parte

Il tema precedente ("FantaBar Pulse": viola neon + oro + glow) usava il vocabolario visivo di una app
di scommesse, non di un prodotto sportivo, e non rappresentava in alcun modo il nome "FantaBar".
La nuova identità è una regola di illuminazione, non una tavolozza: **una sola sorgente calda in alto
a sinistra**, come la lampada sopra il tavolo di un locale. Ambra = la lampada (unico accento
luminoso), rosso = solo stato (urgenza), verde = solo superficie (il banco), mai testo. Verde e rosso
non si toccano mai: è ciò che tiene la palette lontana dalla bandiera italiana.

Implementata in **due punti separati, di proposito**:

1. `frontend/css/style.css` → blocco `:root`. Cambiano solo i VALORI, i nomi delle variabili restano
   identici: così tutte le schermate che non sono state ridisegnate (login, lobby, strategie,
   anteprima, griglia P/A, fine asta, modali) cambiano identità senza toccarne una riga.
2. `frontend/css/tema-serata.css` (nuovo, caricato dopo) → solo ciò che cambia la COMPOSIZIONE:
   la scena della puja, la griglia delle squadre, le schede, la vista Admin.

Perché non un unico file: la palette è una modifica chirurgica e reversibile in un punto solo; la
parte strutturale è voluminosa e piena di `!important`, e tenerla separata la rende leggibile e
rimovibile con una riga in `index.html` senza toccare `style.css`.

**Debito riconosciuto e non pagato**: `style.css` difende la zona puja con circa 40 regole
`!important` sparse su tutti i breakpoint, quindi il foglio nuovo deve a sua volta usare
`html body #puja-panel-slot` + `!important` per vincere. Ripulire quelle regole è un lavoro a parte,
volutamente NON fatto insieme al cambio di identità per non mescolare un refactor rischioso con una
modifica puramente estetica.

## Comportamenti d'asta in un modulo separato (attivo, con interruttore)

`frontend/js/comportamenti-asta.js` aggiunge tre cose che il tema da solo non può fare: la fase
dell'asta che guida il layout (negli ultimi secondi la schermata si stringe su prezzo/tempo/azione),
il contatore "ancora in gioco" (quante squadre possono ancora coprire l'offerta corrente) e la leva
(RILANCIA si tiene premuto e l'importo sale).

E' **acceso** (`localStorage.fantabar_comportamenti = '0'` per spegnerlo) ma vive in un file a parte, non dentro `app.js`, per una ragione precisa:
i primi due sono additivi e in sola lettura — leggono lo stato che il client già riceve da
`stato-asta` e non cambiano nessuna regola — ma **la leva cambia come si sceglie l'importo del
rilancio**. L'evento emesso resta `'rilancio'` e il server continua a validare con
`calcolaMaxOfferta()`, quindi nessuna regola viene aggirata; il rischio è d'uso, non di correttezza:
si può superare l'importo voluto tenendo premuto mezzo secondo di troppo. Mitigato in due modi:
l'importo è limitato lato client da `getMaxOfferta()` (verificato: tenendo premuto 3 secondi ci si
ferma esattamente al massimo consentito), e il **tocco singolo non viene intercettato affatto** —
sotto i 260 ms il modulo non fa nulla e il rilancio lo manda il click handler originale dell'app.

Il modulo non pilota nulla: si aggancia con un wrapper a `updateTimer()`, `renderChiamata()` e
`renderBudgetBar()` — le funzioni vere dell'app — e legge. Il tempo continua a dettarlo il server.

## Effetto collaterale accettato: negli ultimi secondi i crediti dei rivali si sfocano

La regola "la stanza si stringe" porta il riepilogo squadre a opacità 0.26 con sfocatura sotto i 5
secondi. È deliberato (togliere tutto ciò che non serve a decidere se rilanciare) ma ha un costo
reale: sono esattamente i secondi in cui potresti volerli guardare. Il contatore "ancora in gioco"
resta leggibile in testata proprio per compensare — dice la stessa cosa in una cifra sola.


## Due bug trovati provando i comportamenti, prima di metterli online

Entrambi sarebbero passati inosservati fino a un'asta vera. Vale la pena ricordarli perché sono
trappole generali, non specifiche di questo modulo.

**1. Doppio rilancio con un gesto solo.** L'app registra un `click` su `#btn-rilancio` che chiama
`inviaRilancioRapido(1)`. Il modulo della leva ascoltava `pointerdown`/`pointerup` sullo stesso
bottone: un tocco faceva partire *entrambi*, cioè due `socket.emit('rilancio')` per un gesto solo.
Risolto così: sotto i 260 ms il modulo non fa nulla (se ne occupa l'app, comportamento identico a
prima); sopra, il modulo manda il suo importo e sopprime il click dell'app con un listener in fase
di **capture** (`stopImmediatePropagation`), che gira prima di quello registrato sull'elemento.

**2. `window.S` non esiste.** In `app.js` lo stato è dichiarato `const S = {...}` a livello di
script: una `const` di primo livello **non diventa una proprietà di `window`**. Il modulo leggeva
`window.S`, quindi trovava sempre `undefined` e la leva non partiva mai — senza errori in console,
senza niente di rotto a vista: semplicemente non funzionava. Vale per `socket` allo stesso modo.
Dai file esterni questi vanno letti come **identificatori nudi** (`S`, `socket`), risolti dalla
catena degli scope, con un `try/catch` per il caso in cui `app.js` non sia ancora stato eseguito.

Morale operativa: per un modulo che si aggancia all'app non basta `node --check`. Serve misurare
l'effetto reale — nel nostro caso intercettare `socket.emit` e **contare le offerte che partono
davvero** per ogni gesto.

## Tema chiaro "Cuoio": sostituisce "Mattina al banco", verde riservato al denaro

Su richiesta esplicita dell'utente (mockup di riferimento "PuntBar"), il tema chiaro
(`html.theme-light`) è stato riscritto da zero — non è più "il tema scuro schiarito" in argento/
ottone, ma un banco di cuoio e pergamena. Decisioni non ovvie, per chi tocca queste regole in
futuro:

- **Verde riservato SOLO alle cifre di credito/offerta** (`.cc-offerta`, `.cc-offerta-box`,
  `.sq-crediti`), mai a superfici larghe o testo generico — a differenza del mockup, dove il verde
  compare anche come sfondo di header/tab. Compromesso deliberato: il verde resta leggibile come
  "questo è denaro" invece di diventare un secondo accento generico che competerebbe con il cuoio.
  L'unica eccezione è la barra `.tabs-nav`, resa verde bosco con testo crema per riprendere il
  tratto più riconoscibile del mockup (la striscia verde delle tab) — un'eccezione dichiarata, non
  un'incoerenza.
- **`.sq-crediti` in stato `offerente-attuale` resta cuoio, non verde**: segnala "chi sta vincendo
  ora" (uno stato), non "quanto vale" (un dato) — stessa distinzione semantica, nessuna regola
  nuova aggiunta apposta, solo la cascata naturale delle regole `.offerente-attuale` già esistenti.
- **`.cc-avatar` cambia forma (cerchio → angoli smussati con cornice) SOLO sotto `html.theme-light`,
  e SOLO bordo/border-radius — mai width/height/aspect-ratio.** C'è un bug storico documentato sopra
  ("Carta XL dell'animazione") legato proprio a `.cc-avatar` che cambia forma tra contesti (circle
  84×84 vs rect 118×auto in admin): la cornice ornata del nuovo tema è puramente decorativa apposta
  per non riaprire quella fragilità.
- **La testata (`.asta-header`/`.home-header`) resta in cuoio scuro anche nel tema "chiaro"**: il
  resto della pagina è pergamena, ma il banco (l'header) è sempre scuro — è il tratto più
  riconoscibile del mockup, e l'unico punto dove "tema chiaro" non significa "tutto chiaro".
  Richiede colori di testo/bottoni espliciti nella testata (crema fisso), non ereditati dai ruoli
  `--sc-testo`/`--text-primary` (che nel resto della pagina sono scuri, corretti per fondo chiaro
  ma invisibili su fondo cuoio scuro).
- **Bug preesistente trovato e corretto, non introdotto da questo cambio**: `html body .card` in
  `tema-serata.css` (usata da Home/Login/Lobby/Fine asta) aveva un gradiente scuro hardcoded SENZA
  scoping per tema — le card di quelle schermate restavano scure anche nel vecchio tema chiaro.
  Aggiunta la `html.theme-light body .card{...}` mancante.
- **Verifica**: contrasto testo/sfondo calcolato via script (non a occhio) su tutte le coppie
  chiave, tutte ≥4.9:1. Verificato in browser con stato sintetico iniettato via console (nessuna
  asta reale disponibile, stesso limite di sempre) in vista Partecipante/Admin, desktop/mobile;
  tema scuro ricontrollato invariato. **Non verificato**: Anteprima con carte reali sul campo,
  Griglia P/A, modali con dati veri — vedi [docs/SESSION_SUMMARY.md](docs/SESSION_SUMMARY.md).

## Toggle binario chiaro/scuro sostituito da selettore multi-tema (`data-tema`)

Richiesta esplicita dell'utente: poter creare più temi chiari E più temi scuri, con l'utente che
sceglie il preferito — non più una singola coppia sì/no. La `html.theme-light` (classe booleana)
non poteva rappresentare un terzo/quarto tema, quindi sostituita con `data-tema="<id>"` su
`<html>`: ogni tema è un id, non un bit. Migrazione **rinominando meccanicamente** (sostituzione
di stringa esatta, 107 occorrenze identiche di `html.theme-light` → `html[data-tema="cuoio"]`) —
scelta deliberata invece di riscrivere le regole: **zero righe del tema scuro `:root` toccate**,
nessun rischio di regressione sui due temi già esistenti. Ogni tema nuovo si aggiunge con lo stesso
pattern già rodato (ruoli `--sc-*` in `tema-serata.css` + token base in `style.css`, entrambi con
un blocco `[data-tema="<id>"]`, + una sezione "materie" dedicata in fondo a `tema-serata.css`) —
nessuna riscrittura strutturale richiesta per aggiungere il quarto, quinto tema in futuro.

`localStorage['tema']` migrato in modo silenzioso e automatico (`'light'`→`'cuoio'`,
`'dark'`/mancante→`'serata'`) al primo caricamento dopo l'aggiornamento: nessun utente perde la
propria preferenza, nessuna chiave di migrazione separata (idempotente ad ogni load).

Il selettore (icona 🎨, menu a tendina) sostituisce il vecchio bottone sole/luna negli stessi due
punti di aggancio (`.asta-header-right`, ogni `.home-header`) — nessun nuovo punto di iniezione
nel DOM. Le regole `.tema-picker*` sono scritte SOLO sui token base condivisi (`--bg-card`,
`--border-light`, `--text-primary`...), mai su colori hardcoded: il pannello si adatta da solo a
qualunque tema presente e futuro senza bisogno di una regola per tema.

## "Lavagna al Neon": due accenti neon con ruoli distinti, non un solo colore come negli altri temi

Terzo tema (scuro), mockup fornito dall'utente. Gli altri due temi seguono la regola "un solo
accento diffuso + un colore riservato al denaro" (ambra/verde per Serata-Cuoio); qui il mockup
stesso usa DUE neon appaiati (ciano+magenta, tipico dell'estetica synthwave/insegna anni '80) senza
separazione semantica netta nella fonte. Scelta per restare coerenti con l'app invece di riprodurre
alla lettera: **ciano** = accento strutturale (bordi, cornici, tab attiva, stato "in gioco" — lo
stesso ruolo che altrove ha l'ambra/il cuoio); **magenta** = riservato al brand (nome "FantaBar",
unico punto con un font diverso, Pacifico via Google Fonts) E al denaro (`.cc-offerta`/
`.sq-crediti`) — stessa filosofia restrittiva del verde in Cuoio, solo esteso a due usi invece di
uno perché il mockup lo richiedeva esplicitamente per il brand. Rosso tenuto volutamente diverso
dal magenta (mai la stessa tinta) per non confondere "allarme" con "brand/decorazione". La cornice
fisica in ottone (`#C9A227`) attorno alla testata è un QUARTO colore, deliberatamente caldo contro
la palette fredda ciano/magenta/nero: rappresenta la struttura fisica (le travi della lavagna), mai
un accento diffuso — stesso trattamento riservato che Cuoio applica al filo di cuoio sotto la
testata.

A differenza di Cuoio (tema chiaro, servivano ombre/glow RIMOSSI perché sporcavano su fondo
bianco), Lavagna resta scuro come il default: i glow neon sui testi (`text-shadow`) sono stati
AGGIUNTI apposta invece che rimossi — è l'effetto voluto, non un residuo da ripulire.

## Bug reale: una regola duplicata più vecchia batteva quella giusta per specificità, non per ordine

Trovato mentre si rispondeva a "la texture della lavagna non si vede" — il codice della texture
c'era, ma non si applicava in vista Partecipante. Causa: `tema-serata.css` aveva DUE regole per
`#puja-panel-slot` (Cuoio e Lavagna, entrambe): una piu' vecchia con
`body.layout-partecipante #puja-panel-slot, body #puja-panel-slot{...}` (versione povera, 3
layer), e una piu' nuova nella sezione "materie" con `body #puja-panel-slot, body.layout-admin
.asta-row-puja{...}` (versione ricca, con la texture). Stesso selettore `body #puja-panel-slot`
in entrambe — ma la prima regola ha un SECONDO branch (`body.layout-partecipante
#puja-panel-slot`) con una classe in più, quindi più specifico: in vista Partecipante (dove
quel branch matcha) vinceva SEMPRE la regola vecchia, indipendentemente da quale delle due
venisse dopo nel file. In vista Admin invece (nessun branch con `.layout-partecipante` che
matcha) vinceva quella giusta — motivo per cui il bug era invisibile finché non si guardava
apposta la vista Partecipante.

Diagnosticato NON leggendo il CSS a occhio (la duplicazione storica del file la rende
inaffidabile, vedi sopra "bordo viola mai migrato") ma iterando `document.styleSheets` /
`cssRules` nel browser reale e confrontando gli indici delle regole che matchano
`el.matches(selectorText)` — l'unico modo per sapere con certezza quale regola vince davvero.
Fix: eliminata la regola vecchia duplicata (in entrambi i temi, Cuoio aveva lo stesso bug mai
notato), non solo aggiunta una terza per patcharla — la sezione materie era già l'unica fonte di
verità necessaria per fondo/bordo/ombra. **Promemoria per il futuro**: quando si aggiunge una
regola "più giusta" per un selettore che già esiste altrove nello stesso file con un branch più
specifico, cancellare quella vecchia invece di lasciarla — la specificità CSS non rispetta
l'ordine di lettura del file.

## `theme_overrides` (Supabase): un editor visuale nascosto, non il tema, causava colori "sbagliati"

Bug reale segnalato dall'utente due volte ("questi bottoni restano viola in tutti i temi"),
inizialmente scambiato per un problema di cache/tema. Causa reale: `backend/server.js` espone un
"Editor Visuale di Stile" nascosto (`?editor=CHIAVE`) che salva override CSS **globali per tutti
gli utenti** in una tabella Supabase (`theme_overrides`, riga `id='default'`), applicati ad ogni
caricamento pagina via un `<style id="editor-overrides-style">` iniettato in `<head>` — *sopra*
qualunque tema, perché arriva dopo entrambi i fogli CSS nel DOM. Qualcuno aveva ricolorato a mano
`#btn-recap-iniziale`/`.storico-filtro-btn.active` il 2026-08-05 e salvato: da quel momento
qualunque tema si scegliesse, quei due elementi restavano viola. Diagnosticato leggendo
`document.styleSheets` in browser reale (non nei file sorgente: l'override non e' scritto in
nessun `.css` del repo) e confermato via query diretta sulla tabella con l'MCP Supabase. Svuotato
(`styles='{}'`) invece di eliminare la riga, per lasciare intatta la struttura che l'editor si
aspetta di trovare. **Lezione**: un colore "sbagliato" che non torna in NESSUN tema, su un
elemento con `id`, e che i file CSS del repo non spiegano, è quasi certamente qui — controllare
`theme_overrides` prima di sospettare cache o CSS.

## Materiali della clessidra: JS, non variabili CSS — i gradienti SVG hanno `stop-color` fissi

L'orologio "specifico per tema" richiesto dall'utente non poteva essere fatto con le variabili
`--sc-*` già in uso ovunque: i gradienti della clessidra (`cls-ottone`, `cls-sabbia`) sono
`<linearGradient>` con `stop-color` scritti come attributi fissi dentro la stringa SVG generata
da `clessidra.js` — nessuna cascata CSS può capovolgerli (infatti la variabile `--ottone` già
presente in `tema-serata.css` da sessioni precedenti non veniva letta da **nessun** selettore:
dead code, verificato con un grep mirato prima di aggiungerne altro). Soluzione: un piccolo
oggetto `MATERIALI` in `clessidra.js` con i colori per `serata`/`cuoio`, applicato scrivendo
`stop-color` sui `<stop>` esistenti dopo l'inserimento nel DOM, richiamato di nuovo da un
`MutationObserver` su `data-tema` (il tema può cambiare a caldo dal selettore, senza reload —
stesso principio del `MutationObserver` già esistente che legge il tempo dall'anello). "Lavagna"
non ha un materiale: per quel tema (unico, su richiesta esplicita) l'oggetto stesso sparisce
(`display:none`) e torna visibile il vecchio anello SVG originale — già nel DOM, già alimentato
dallo stesso `#timer-progress`, già ritingibile via CSS (`#timer-grad-start/end` hanno
`stop-color` impostato via JS in `app.js`/`updateTimer()`, ma una regola CSS con `!important`
vince comunque sull'attributo — verificato, nessun cambio a `updateTimer()` necessario).

## Anteprima: bordo viola mai migrato — trovato isolando la regola che vince davvero la cascata

Il file `.ant-pitch-stage` compare **dieci volte** in `style.css` (redesign 3D iterativi di
sessioni precedenti, mai ripulite), quasi tutte per proprietà di layout diverse per breakpoint —
solo una imposta `border`/`box-shadow`, con un viola hardcoded (`rgba(115,105,255,.55)`) mai
toccato da "Serata d'Asta" ne' dai temi successivi. Invece di rincorrere tutte e dieci le
occorrenze, la regola effettivamente vincente è stata isolata leggendo `getComputedStyle` nel
browser reale — l'unico modo affidabile con questo livello di duplicazione storica — poi
sostituita con `var(--sc-ambra-piena)`/`rgba(var(--sc-ambra),...)`, variabili globali già corrette
per tema: **una riga sola** ha sistemato tutti e tre i temi, senza bisogno di regole per-tema
dedicate. Controllato anche il resto della chrome (RESET, toggle Vista, drawer, zoom): già su
token generici, nessun altro intervento necessario — il viola era isolato a quella singola
proprietà.

## Font-size nella zona puja: sempre `cqw` (container "sala"), mai `vw`

`#asta-main-col{container-type:inline-size;container-name:sala}` esiste apposta perché Anteprima è
un drawer **fratello** di `.asta-main-col`, non sovrapposto: aprirlo dimezza la colonna senza
cambiare la finestra (vedi sezione sotto, "Vista partecipante con Anteprima aperta"). Qualunque
`font-size:clamp(...)` scoped a `#puja-panel-slot`/`.asta-row-puja` che misura `vw` invece di `cqw`
ignora questo dimezzamento e resta tarato sulla finestra intera — con un nome lungo e
`white-space:normal` per permettere più righe, il risultato è testo enorme in uno spazio ormai
stretto, che nella peggiore delle ipotesi va a capo lettera per lettera (bug reale, trovato con
screenshot dell'utente: "KOUTSOUPIAS" in vista Admin con Anteprima aperta). Tre regole in
`tema-serata.css` erano rimaste a `vw` mentre i tre scalini `@container sala` della vista
Partecipante usavano già correttamente `cqw` — è la stessa disattenzione, non un pattern voluto.
Prima di aggiungere una nuova regola di font-size in questa zona, copiare da una vicina che usa già
`cqw`, non da una a caso.

## Una decisione pendente (`asta.popupAttivo`) blocca anche l'estrazione, non solo il rilancio

`estrai-giocatore`/`chiama-giocatore`/`assegna-manuale` controllavano solo `asta.chiamataAttuale`
(un rilancio in corso), non `asta.popupAttivo` (svincolo obbligatorio per pagare un'offerta vinta,
o scelta plusvalenza/recompra del proprietario precedente — entrambi mettono `chiamataAttuale` a
`null` e aspettano una risposta). Risultato: l'Admin poteva continuare a chiamare/estrarre nuovi
giocatori mentre una squadra doveva ancora risolvere un obbligo pendente — segnalato dall'utente
("NASCONDI" nel popup di svincolo nascondeva solo la vista, l'asta intanto proseguiva). Bloccato
aggiungendo lo stesso controllo `if (asta.popupAttivo) return ...` usato per `chiamataAttuale`, su
tutti e tre gli handler. Nessun rischio di bloccare l'asta senza via d'uscita: l'Admin ha già un
percorso per risolvere lui stesso lo svincolo per conto della squadra (`popup-svincolo-admin`,
esistente da prima), quindi non serve un override separato per sbloccare.

## "Sala Giochi": il secondo tema chiaro non e' Cuoio raffreddato, e' l'altro estremo

Quarto tema, richiesto dall'utente come "modo chiaro stile arcade" e disegnato prima come mockup
([docs/mockup-tema-sala-giochi.html](docs/mockup-tema-sala-giochi.html), approvato) e solo dopo
implementato. Il rischio vero non era il colore ma la sovrapposizione: avere DUE temi chiari che
si somigliano li rende entrambi inutili. Cuoio e' chiaro-caldo-materico (pergamena, cuoio, ombre
morbide, foto vere); Sala Giochi e' chiaro-freddo-grafico (carta bianca a retino, inchiostro,
colore piatto, zero fotografie). Le due direzioni sono opposte apposta.

Il pattern di aggiunta era gia' rodato (vedi la decisione sul selettore `data-tema`) e ha retto
senza modifiche strutturali: **una riga in `TEMI`** (app.js), **un blocco di token base** in
`style.css`, **un blocco di ruoli `--sc-*`** + **una sezione "materie"** in fondo a
`tema-serata.css`, **una voce in `MATERIALI`** di `clessidra.js`. Zero righe degli altri tre temi
toccate.

Scelte non ovvie, per chi tocca queste regole in futuro:

- **Il rosso qui non e' solo allarme: e' anche il tasto RILANCIA.** Negli altri tre temi il rosso
  e' esclusivamente stato. Deroga deliberata (il mockup approvato lo mostrava cosi'): RILANCIA e'
  l'unico bottone che toglie crediti, quindi resta dentro la famiglia semantica "attenzione". Per
  non perdere il segnale degli ultimi secondi, l'urgenza non si affida piu' al solo colore del
  tasto: cambia TUTTA la piastra (cornice, ombra, nastri, cronometro, cifra) e il tasto passa a un
  rosso piu' scuro *e* pulsa.
- **L'oro ha due valori, non uno**: `#F5B01A` esiste solo come FONDO (il gettone dietro le cifre di
  credito), mentre come TESTO l'oro e' `#8A5A05`. Misurato: il giallo pieno su bianco sta a 3.2:1,
  sotto la soglia; il gettone con testo inchiostro sopra sta a 9.8:1. Stessa regola restrittiva del
  verde in Cuoio (se non e' denaro, non e' oro), applicata a due tinte invece che a una.
- **Il NOME del giocatore resta in Archivo, non in font a pixel.** E' l'unico punto del mockup non
  riprodotto alla lettera, e non per gusto: c'e' gia' un bug storico di sconfinamento del nome
  (`KVARATSKHELIA`/`KOUTSOUPIAS`, vedi sopra) e le lettere a pixel sono ~1.6x piu' larghe di
  Archivo condensato. I due font a pixel ('Press Start 2P' per insegna/cifre/testate, 'Silkscreen'
  per il resto dell'interfaccia) stanno ovunque tranne li'.
- **La larghezza dei font a pixel e' un vincolo di layout, non un dettaglio tipografico**: il totale
  dentro il tasto RILANCIA usciva dal bordo a 270px con la stessa dimensione che Archivo reggeva
  benissimo. Misurato in browser e ridotto (0.48rem/0.6rem). Se si cambia una dimensione qui,
  ricontrollare a 1440 **e** a 390px, non solo su desktop.
- **Nessuna immagine nuova**: retino, raggi del marquee e barre a tacche sono gradienti CSS. E' anche
  il motivo per cui questo tema non ha nessun `?v=` da alzare sulle immagini (vedi PROJECT.md,
  cache-busting su `url(...)`): non ne referenzia.
- **Le ombre sono blocchi d'inchiostro spostati (`6px 6px 0`), mai sfocate.** Su fondo chiaro le
  ombre morbide sporcano — gia' imparato con Cuoio, dove erano state RIMOSSE; qui la stessa lezione
  arriva all'altra conclusione: non toglierle, ma renderle solide.
- **Il bordo dei badge di ruolo e' un `box-shadow: inset`, non un `border`.** I badge hanno misure
  fisse per breakpoint in `style.css`: un bordo vero, anche con `box-sizing:border-box`, avrebbe
  mangiato spazio interno a un badge alto 13px.

**Tre punti dell'app che nessun tema aveva mai coperto** (trovati dall'utente sul sito vero,
non dai test): la cassa delle decisioni dell'Admin (`.admin-conferma-box`, fondo scuro fisso —
rotta anche in Cuoio, corretta li' nello stesso giro), `#mio-panel` (le "materie" del tema base
lo dipingono con un selettore che ha un id, quindi batteva la versione a sola classe del tema
nuovo) e tutta la vista "campo 3D" dell'Anteprima (scena quasi nera con bordi al neon
viola/ciano, righe del campo in un SVG `.ant-field-markings` con alone). Da qui due regole
pratiche: **un tema nuovo non e' finito quando la schermata d'asta e' a posto** — vanno guardate
anche vista Admin e Anteprima; e **prima di scrivere l'override, misurare `getComputedStyle` nel
browser**, perche' in questo progetto la specificita' delle regole di partenza e' imprevedibile.
Una regressione presa proprio cosi': semplificando il selettore di `#mio-panel` in un solo ramo
corto il pannello e' tornato scuro in vista Partecipante — la forma giusta e' **una regola sola
con due rami** (quello lungo per Partecipante, quello corto per Admin), non due regole separate.

**Verifica**: contrasto calcolato via script (non a occhio) su 18 coppie chiave, tutte >=4.5:1 dopo
due correzioni (oro-testo e rosso del tasto). Reso in browser reale (Chromium headless) con stato
sintetico iniettato in un banco di prova temporaneo, a 1440x900 e 390x844, stato normale e
`puja-urgente`, confrontato con `serata` e `cuoio` alla stessa larghezza. **Non verificato**: asta
vera, vista Admin, modali, Griglia P/A, Anteprima, Strategie — lo stesso limite di sempre.

## Rate limiting a tre livelli (IP → utente/giorno → evento socket), niente prima

Non esisteva **nessun** limite: 26 rotte REST e 22 eventi socket erano tutti liberi, con
`express.json({ limit: '10mb' })` a fare da unico tetto. I due vettori concreti erano mandare
corpi da 10MB in ciclo contro rotte che scrivono su Supabase (stesso conto banda dell'incidente
di agosto 2026) e inondare l'asta di `rilancio`, che **resetta il timer a ogni offerta**: un
client scriptato poteva tenere una chiamata aperta all'infinito e rendere impossibile chiudere
l'assegnazione.

Tre livelli, dal piu' largo al piu' stretto: 300 richieste/15min per chiave, 1000/giorno per
chiave, e quote giornaliere strette sulle operazioni costose (20 aste create, 10 caricamenti di
listino, 30 ripristini). Sul socket, finestra scorrevole di 1 secondo: 5 `rilancio`, 15 per gli
altri eventi.

Tre scelte non ovvie dentro questa:

1. **La chiave e' il `sub` del JWT Supabase letto SENZA verifica crittografica**, con fallback
   all'IP. Verificarlo davvero significherebbe una chiamata di rete a Supabase per *ogni*
   richiesta, solo per decidere in quale contatore metterla. Non e' un controllo di accesso —
   l'autenticazione vera resta `getRuoloUtente()`/`getUtenteDaToken()` dentro agli handler — e
   chi falsificasse il `sub` per sfuggire alla propria quota resterebbe comunque sotto il limite
   per IP. L'IP passa per `ipKeyGenerator` (normalizza gli IPv6 sulla /64): senza, un utente IPv6
   avrebbe miliardi di indirizzi e quindi nessun limite effettivo.
2. **`app.set('trust proxy', 1)` e' obbligatorio**, non un dettaglio: Hostinger serve l'app dietro
   a un reverse proxy, quindi senza questa riga `req.ip` sarebbe sempre l'IP del proxy, tutti gli
   utenti finirebbero nello stesso contatore e **il primo che supera la soglia bloccherebbe l'app
   a tutta la lega**.
3. **`express.json()` viene applicato DOPO i limitatori.** Nell'ordine inverso (quello scritto di
   getto la prima volta) un client gia' bloccato costringerebbe comunque il server a leggere e
   parsare fino a 10MB di corpo per ogni richiesta, prima di riceversi il 429.

Sul socket il pacchetto oltre soglia viene **scartato**, non passato a `next(err)`: `next(err)` fa
emettere un evento `error` che il client non gestisce e che puo' chiudere la connessione, cioe'
butterebbe fuori dall'asta chi ha soltanto cliccato troppo in fretta. Si manda invece un solo
`errore` "stai andando troppo veloce" per finestra. I contatori vivono sull'oggetto `socket`, non
in una Map globale: spariscono da soli alla disconnessione, senza la fuga di memoria gia' vista
con `_ultimoBackupHash`.

Le finestre "giornaliere" sono 24h a scorrimento dalla prima richiesta della persona, non il
giorno di calendario, e i contatori stanno **in memoria**: si azzerano a ogni riavvio/deploy.
Coerente con il resto dell'architettura (lo stato di gioco stesso vive in memoria) e accettabile
perche' le quote servono contro l'abuso, non a fatturare.

## CORS del socket: same-origin sempre ammesso, non un'allowlist da configurare

C'era `{ origin: '*' }`, che non serviva a nessun client reale — il frontend e' servito dallo
stesso processo che espone il socket e in `app.js` la connessione si apre con `io()` senza URL,
cioe' same-origin — ma permetteva a qualunque pagina web di aprire socket verso questo server
usando il browser di un utente.

La tentazione era sostituirlo con una allowlist da variabile d'ambiente. **Sarebbe stato un
trabocchetto di deploy**: se `ORIGINI_CONSENTITE` non fosse impostata su Hostinger, l'origine di
produzione verrebbe rifiutata e l'app si romperebbe interamente al primo push. La regola scritta
e' invece: same-origin **sempre** ammesso (si confronta l'host dell'`Origin` con l'header `Host`
della richiesta), piu' l'eventuale allowlist esplicita, piu' i localhost per lo sviluppo. Cosi'
il deploy funziona su qualunque dominio senza configurare niente.

`Origin` assente = richiesta non-browser (curl, health check del provider, app native): non e' un
caso CORS e viene ammessa — non c'e' nessun utente da proteggere. Gli header CORS vengono emessi
**solo** se e' stata configurata un'allowlist esplicita: senza, socket.io non ne emette nessuno e
il browser blocca da solo il cross-origin, che e' esattamente il comportamento voluto.

## Editor visuale di stile: eliminato, non protetto meglio

`THEME_EDITOR_SECRET` era una stringa scritta in chiaro nel backend, quindi
pubblica su GitHub, ed era l'**unica** protezione di `POST /api/theme`, che riscrive il CSS
globale iniettato a tutti gli utenti dell'app: e' esattamente il meccanismo dell'incidente dei
bottoni viola del 2026-08-05.

Si poteva spostare la chiave in una variabile d'ambiente o passare l'endpoint al ruolo `admin`
(che gia' esiste). Si e' scelto invece di **eliminare l'editor**: non era piu' usato, e un
endpoint che riscrive il CSS per tutti e' una superficie che non conviene tenere in piedi per una
funzione che nessuno apre. Sono spariti l'IIFE di ~530 righe in fondo ad `app.js`, le due rotte, i
keyframes `editor-anim-*` (che nessun altro CSS usava) e la `fetch('/api/theme')` che **ogni
visitatore** faceva al caricamento della pagina.

La tabella `theme_overrides` **non** e' stata toccata: ospita anche la riga
`gk_planner_calendario`, cioe' il calendario reale del GK Planner (~21KB). La riga `default`
resta li' dentro, vuota (`{}`), ormai senza nessun lettore. Resta valido il promemoria storico
"se un colore non torna, controlla `theme_overrides`" solo per capire un incidente passato: da
ora quella riga non puo' piu' influenzare niente.

## RLS: era gia' a posto, la verifica e' il contributo

Controllate tutte e 11 le tabelle `public` del progetto Supabase: RLS attiva ovunque. Le tabelle
dei dati personali (`strategie`, `strategia_giocatori`, `strategia_tipi_asta`, `fasce`,
`gk_planner_config`, `profiles`) hanno policy per proprietario via `auth.uid()`;
`listino_giocatori` e' in sola lettura per gli autenticati; e le quattro che solo il backend deve
toccare (`app_settings`, `asta_backups`, `asta_exports`, `theme_overrides`) hanno RLS attiva e
**zero policy**, che in Postgres significa negare tutto a chiunque non usi la service role key.
Il linter di sicurezza di Supabase non segnala nessun ERROR/WARN sulle policy.

Le policy `FOR ALL` hanno `with_check` nullo: non e' un buco, Postgres in quel caso riusa
l'espressione `USING` anche come check su INSERT/UPDATE.

Resta un solo punto aperto, ed e' un interruttore del pannello Supabase, non codice: **protezione
password compromesse (HaveIBeenPwned) disattivata**.

## `/api/exports`: erano tre rotte completamente aperte

Fuori dai quattro punti dell'audit ma piu' sfruttabile di due di essi: `GET /api/exports`,
`GET /api/exports/:id` e soprattutto **`DELETE /api/exports/:id`** non avevano alcuna
autenticazione. Chiunque poteva elencare, scaricare e **cancellare per sempre** lo storico delle
aste concluse di tutta la lega con un `curl`, senza nemmeno essere loggato.

Ora la lettura richiede il login (`getUtenteDaToken`) e la cancellazione il ruolo `admin`
(`getRuoloUtente`), stesso schema delle altre rotte amministrative. Non e' una restrizione reale
per gli utenti: lo storico si apre solo dal menu principale, cioe' a utente gia' loggato.

## Pastiglia del nome in Anteprima: `width:max-content`, non la larghezza dello slot

Segnalato dall'utente sul tema "sala-giochi": il cartellino bianco dietro al nome del giocatore
non copriva tutto il nome, che usciva dai due lati.

La causa non era nel tema. `.ant-slot3d-label` era rimasta a `left:0; width:100%` (regola "Cada
etiqueta pertenece físicamente a su slot"), cioè larga esattamente quanto la carta e **sempre
identica**, qualunque fosse il nome; il testo però vive in uno `<span>` a `width:auto` con
l'etichetta a `overflow:visible` (impostato dal "blocco finale" che ha ripristinato la riga
singola). Risultato: pastiglia di larghezza fissa, testo di larghezza variabile, e i nomi lunghi
che sbordavano. Misurato in browser a 560px: **pastiglia sempre 42.3px**, contro CARNISECCHI
62.5px (+20.2), THORSTVEDT 57.6 (+15.3), RASPADORI 53.3 (+11.0); e all'opposto DODÒ (27px) si
prendeva una pastiglia larga quasi il doppio del suo testo.

**Il difetto c'era in tutti e quattro i temi**, non solo in "sala-giochi": lì la pastiglia è un
cartellino bianco su prato chiaro e il bordo nero rende lo sbordo evidente, negli altri è una
pastiglia scura su fondo scuro e si notava molto meno. Utile ricordarlo: un difetto segnalato su
un tema non è automaticamente un difetto *del* tema — qui il tema ha solo reso visibile una
regola di layout sbagliata per tutti.

La correzione è una regola sola nel "blocco finale" di `style.css`: `width:max-content` +
`left:50%` + `translateX(-50%)` al posto di `left:0` + `width:100%`. L'etichetta si stringe
esattamente sul testo e resta centrata sullo slot. **Non serve nessun limite di larghezza qui** —
è `_antFitTestoLabel()` a ridurre il font finché il nome entra nello spazio misurato fra le carte
vicine, quindi anche a contenuto libero l'etichetta non può invadere quella del vicino (misurato:
zero sovrapposizioni fra etichette adiacenti sulla stessa riga, in tutti i temi, a 371px e 980px).

La regola è ristretta con `:has(.ant-slot3d-name-txt)` alle sole etichette che contengono un
**nome**. Le etichette degli slot vuoti contengono badge di ruolo e hanno già una loro regola
(`:has(.badge-ruolo)`, `display:flex` + `flex-wrap`): con `max-content` un ruolo multiplo tipo
"T/A/Pc" smetterebbe di andare a capo e si allargherebbe oltre lo slot. Restano come sono.

**Nota sul metodo, ripetibile**: l'Anteprima non è raggiungibile senza login Supabase, quindi la
verifica è stata fatta con un banco di prova temporaneo in `frontend/` (poi cancellato) che
ricostruisce il DOM esatto di `renderAnteprimaPitch()` e riesegue la stessa logica di
`_antFitEtichetteCampo()`, caricando i due CSS veri. Il bug è stato prima **riprodotto e
misurato** e solo dopo corretto, e le misure sono state ripetute sui quattro temi a due larghezze
(l'ampiezza mobile va forzata con un `<iframe>` stretto: le media query rispondono al viewport
dell'iframe).

## Riepilogo squadre in Admin: due righe di default, e `justify-self:end` non deve poter sbordare

Segnalato dall'utente: nella vista Admin, con Anteprima chiusa, i conteggi
(`Tot: n/25 🧤 🔓`) si stampavano SOPRA il nome della squadra.

Non era un troncamento andato male: era una **sovrapposizione vera**. Misurato in browser
(finestra 1400, tema sala-giochi, asta di riparazione): scheda squadra 211px, colonna
`conteggi` della griglia **32px**, casella `.sq-bottom` renderizzata **142px**. Con
`justify-self:end` un grid item si dimensiona sul CONTENUTO invece che sulla sua colonna e,
ancorato al bordo destro dell'area, cresce verso **sinistra** fino a coprire nome e pallino.
`overflow:hidden` non lo ferma, perche' la casella e' davvero larga 142px: non c'e' niente da
ritagliare. È il tranello di `justify-self` diverso da `stretch` su una griglia sotto pressione,
e vale la pena ricordarlo: **quando una griglia e' troppo stretta, `justify-self:end` trasforma
un troncamento in una sovrapposizione.**

La causa profonda pero' e' un'altra: **la soglia guardava la cosa sbagliata**. La composizione a
due righe esisteva gia' ed era corretta, ma agganciata a `@container sala (max-width:1200px)`,
cioe' alla larghezza della *colonna della sala*. In Admin con Anteprima chiusa quella colonna e'
larghissima, quindi la soglia non scattava mai — mentre le schede erano strette lo stesso, perche'
in Admin `#budget-bar` e' `repeat(auto-fit,minmax(190px,1fr))` (meta' dei `minmax(336px,1fr)` del
partecipante). **La scheda e' stretta per quante colonne fa `#budget-bar`, non per quanto e' larga
la sala**: due misure diverse che la regola trattava come una sola.

La soluzione naturale sarebbe stata una container query sulla scheda stessa, ma **`@container`
interroga sempre un ANTENATO**: un elemento non puo' reagire alla propria larghezza, quindi
`.sidebar-squadra` non puo' cambiare il proprio `grid-template-areas` in base a quanto e' larga.
Farlo avrebbe richiesto un wrapper in piu' nell'HTML generato da `app.js`. Non serve: in Admin le
schede sono *sempre* strette, quindi bastano due righe di default, riusando la STESSA composizione
gia' scritta per le colonne strette del partecipante (`"pallino nome crediti" / ". conteggi
conteggi"`), senza inventare niente di nuovo.

In piu' una rete di sicurezza valida ovunque: `.sq-bottom{max-width:100%}`, cosi' la casella non
puo' mai superare la propria colonna in nessun tema e in nessuna vista. Nel caso peggiore i
conteggi si accorciano; sovrapporsi al nome non e' piu' possibile.

**Verificato**: prima riprodotto e misurato (24 sovrapposizioni su 12 schede), poi corretto —
zero sovrapposizioni nelle 8 combinazioni vista×tema (Admin/Partecipante × serata/cuoio/lavagna/
sala-giochi) e su sei larghezze di colonna da 820 a 1400px. **Zero testo troncato tranne il
nome** (di 2-7px sulle schede da 196px), che e' il comportamento voluto e gia' documentato nel
CSS: "a cedere per prima e' solo la coda del nome, con i puntini". Come effetto collaterale il
nome guadagna spazio: prima era inchiodato al suo minimo di 52px, ora ne prende 72-89.

## Il cabinato diventa un disegno SVG, e il ritratto cresce in altezza

L'utente ha respinto due giri di cabinato fatto a gradienti: "si vede molto uguale". Aveva
ragione, e il limite non era il dettaglio ma la **sagoma**. I gradienti CSS sanno fare solo bande
orizzontali e pallini: davano insegna, cruscotto e tasti, ma non le spalle arrotondate, il bisel
del monitor, il cruscotto che sporge piu' largo del mobile, lo sportello dei gettoni. Ed e' la
sagoma, non il dettaglio, a far riconoscere una macchina da sala giochi.

Ora il mobile e' **un disegno SVG in `::after`, sovrapposto alla foto**, con la finestra dello
schermo ritagliata come buco vero (`fill-rule="evenodd"`): la foto sta sotto e si vede solo li'.

**Il ritratto cresce in ALTEZZA** (rapporto 100:166 invece di ~100:130). Era inevitabile: su un
cabinato vero lo schermo occupa circa il 60% del frontale, quindi nel riquadro di prima la faccia
sarebbe scesa al ~38% per far posto a testata e cruscotto. Crescendo in altezza la finestra resta
grande quanto la foto di prima (anzi un filo di piu': 135x183 contro 138x177) e il mobile ha lo
spazio che gli serve. **Solo in altezza**: allargarlo avrebbe richiesto di ritoccare il
`padding-left` di `.chiamata-card` in ogni breakpoint, dove un errore fa finire il ritratto sopra
il nome — incidente gia' successo.

Tre trappole incontrate, tutte utili da ricordare:

1. **Le percentuali di `padding` si risolvono sulla larghezza del CONTENITORE, non
   dell'elemento.** Primo tentativo: `padding:33% 12% 30%` per far cadere la foto nella finestra.
   Con `.cc-avatar` in `position:absolute` dentro a una card larga 1200px, quel 33% diventava
   400px e la border-box si allargava da 178 a 296px. La foto va posizionata invece con
   `inset`/`top`/`left` in percentuale, che si misurano sull'elemento stesso (alto/basso
   sull'altezza, sinistra/destra sulla larghezza) — la mappatura che serviva. Cosi' non serve
   nessuna tabella di misure per breakpoint: `aspect-ratio` lega l'altezza alla larghezza e la
   foto cade nella finestra a qualunque misura.
2. **Per un elemento rimpiazzato (`<img>`) in `position:absolute`, `width:auto` prende la
   dimensione INTRINSECA e `right` viene ignorato**, invece di stirarsi fra i due bordi come farebbe
   un `<div>`. La foto usciva a 257px invece dei 135 della finestra. Servono misure esplicite
   (`width:76%; height:62.05%`).
3. **Un ID batte qualunque numero di classi.** In `style.css` la foto e' formattata da
   `#chiamata-card .cc-avatar-img`; il mio ramo Admin, tutto a classi, perdeva — mentre quello
   utente vinceva *per caso*, perche' contiene gia' `#puja-panel-slot`. Risultato: la foto restava
   alta il 100% della scatola solo in vista Admin. Aggiunto `#chiamata-card` anche li'.

**Niente nero attorno alla foto** (richiesta dell'utente dopo il primo rilascio): il nero veniva
da tre punti diversi, e toglierne uno solo non sarebbe bastato. (1) Il bisel scuro del monitor.
(2) Il `stroke` del corpo del mobile: su un path con `fill-rule="evenodd"` il tratto viene
disegnato **anche attorno al buco**, quindi la foto si ritrovava un contorno nero anche senza
bisel — risolto separando il path in due, uno riempito col buco (senza tratto) e uno che disegna
il solo contorno esterno. (3) La vignettatura del vetro, che scuriva i bordi della foto stessa.
Ora la foto sta direttamente nell'apertura del mobile, sul cobalto.

E una trappola di **metodo**: ispezionare questa cornice col `zoom` del browser inganna, perche'
`zoom` riduce anche la dimensione del container `sala` e fa scattare le soglie strette. Sembrava
un bug, era lo strumento di misura. Si guarda con finestra stretta + colonna forzata larga, a 1:1.

## Cabinato: il mobile ESSENZIALE e' la base, il dettaglio si aggiunge se c'e' spazio

Su richiesta dell'utente il cabinato e' stato reso molto piu' elaborato: lampadine sull'insegna,
griglia dell'altoparlante, schermo a tubo catodico con le righe di scansione e la vignettatura,
leva con piastra e riflesso, tre tasti bombati, gettoniera, zoccolo, montanti ai lati.

Il primo tentativo ha aggiunto tutto in un blocco solo, uguale a ogni misura. Misurato subito
dopo: sulla scatola da 112px la faccia scendeva al **48%** dell'area contro il 61% della misura
piena, e su quella dell'Admin (124px) al 51%. Sotto una certa taglia lampadine e griglia non sono
dettaglio: sono sporcizia da 2px che ruba spazio al soggetto.

La struttura e' stata quindi **invertita**: il mobile essenziale (insegna, traversa, cruscotto con
leva e tasti, zoccolo) e' la regola BASE e vale per Admin e utente; il dettaglio ricco si aggiunge
solo in `@container sala (min-width:1201px)`, cioe' sulla carta grande dove c'e' spazio per
leggerlo. Risultato: la faccia sta al 58-61% a ogni misura, Admin compreso.

Il motivo per cui vale la pena scriverlo cosi', e non con due liste duplicate: la lista degli
strati ricchi vive in **un solo punto**. Due copie della stessa cosa, in questo progetto, finiscono
sempre per divergere — e' successo con la regola CSS duplicata piu' vecchia che vinceva per
specificita', ed e' successo con le due soglie del rosso a 5s e 4s.

Un'altra cosa scartata per misura, non per gusto: i montanti erano due bande arcobaleno a tutta
altezza. Leggevano come una cornice colorata attorno alla foto — non come i fianchi di un mobile —
e rubavano l'occhio al giocatore, che e' il soggetto. Ora sono due montanti in un solo colore con
lo spigolo in luce, limitati all'altezza dello SCHERMO.

**Nota di metodo**: ispezionare questa cornice col `zoom` del browser INGANNA. `zoom` riduce anche
la dimensione del container `sala`, quindi fa scattare le soglie strette e il mobile appare
semplificato quando in realta' non lo sarebbe. Sembrava un bug, era lo strumento di misura. Per
guardarlo davvero: finestra stretta + colonna forzata larga, cattura a scala 1:1.

## Cabinato attorno al ritratto (sala-giochi): cornice costruita DENTRO, non attorno

Richiesta dell'utente: attorno alla foto del giocatore, nel tema "sala-giochi", una cornice a
forma di macchina da sala giochi — marquise, montanti, pulsantiera — **senza occupare piu'
spazio**. Ambito concordato: solo il ritratto della carta di puja (Admin e Partecipante), non le
miniature di rose e liste, dove sotto i ~60px il mobile coprirebbe la faccia, cioe' l'unica
informazione utile.

Tre scelte che vale la pena ricordare:

1. **Il cabinato si costruisce verso l'interno.** `.cc-avatar` e' `box-sizing:border-box`, quindi
   basta il `padding` per ricavare marquise/montanti/cruscotto dentro al riquadro esistente: la
   scatola esterna resta identica (verificato: 178x226 partecipante e 124x158 admin, uguali in
   tutti e quattro i temi, prima e dopo) e a rimpicciolirsi e' solo la foto (~62% dell'area).
   Allargare il riquadro avrebbe voluto dire ritoccare anche il `padding-left` di
   `.chiamata-card` in OGNI breakpoint — l'incavo in cui il ritratto e' incassato — e un errore
   li' fa finire il ritratto sopra il nome, incidente gia' successo in passato.

2. **Le parti del mobile sono strati di `background`, non elementi nuovi.** `::before` e `::after`
   di `.cc-avatar` sono gia' occupati dalla gradazione di colore e dal riflesso del tema, e non
   c'e' nessun altro gancio DOM senza toccare `app.js`. Otto strati (pomello, asta, tre tasti,
   piano del cruscotto, marquise a tacche, traversa) le cui misure derivano tutte da tre
   variabili: cambiarle in un breakpoint ribilancia insieme padding e gradienti. Le due patine
   del tema vanno **ristrette allo schermo** con `inset:var(...)`: a tutto riquadro
   ricoprirebbero marquise e cruscotto, spegnendoli.

3. **La soglia deve misurare la cosa giusta — errore ripetuto e corretto.** Il primo tentativo
   assottigliava il mobile con `@media (max-width:1200px)`. Ma il ritratto non rimpicciolisce per
   larghezza di finestra: rimpicciolisce per `@container sala`, la colonna dell'asta. Risultato
   misurato: scatola scesa a 112px con il mobile ancora spesso, foto schiacciata al **54%**
   dell'area. Spostate le soglie su `@container sala` (1200/900/620), la foto resta al 61-68% a
   ogni misura. **E' lo stesso errore del Riepilogo squadre**, commesso di nuovo a due ore di
   distanza: in questo progetto la larghezza della finestra e quella della colonna sono due
   grandezze diverse, e quasi sempre quella giusta e' la seconda.

Sotto i ~70px di lato (telefono) il cabinato sparisce del tutto: marquise e pulsantiera sarebbero
due macchie e la faccia diventerebbe illeggibile. A 84px restano marquise, montanti e cruscotto
liscio: pomello e tasti si spengono azzerandone la `background-size`, cosi' la lista degli strati
resta una sola e non va tenuta sincronizzata in due punti.

**Nota di metodo**: ispezionare questa cornice col `zoom` del browser INGANNA. `zoom` riduce anche
la dimensione del container `sala`, quindi fa scattare le soglie strette e il mobile appare
semplificato quando in realta' non lo sarebbe. Sembrava un bug, era lo strumento di misura. Per
guardarlo davvero: finestra larga e cattura a scala 1:1, oppure `transform:scale` (che non tocca
il layout), mai `zoom`.

## Password: lunghezza minima 10 al posto di HaveIBeenPwned (che il piano gratuito non ha)

L'audit di sicurezza aveva lasciato un solo rilievo aperto: la protezione contro le password
compromesse (confronto con HaveIBeenPwned) disattivata. Si e' scoperto che **e' una funzione dei
piani a pagamento di Supabase**, quindi non attivabile. In sostituzione e' stata imposta una
**lunghezza minima di 10 caratteri**.

E' un buon ripiego, ma va registrato con onesta' che **copre una minaccia diversa**. La lunghezza
alza il costo di forza bruta e cracking offline; HaveIBeenPwned serviva contro il *riuso* di una
password gia' finita in una fuga altrove, e li' la lunghezza non aiuta — `Password123` ha 11
caratteri ed e' in qualunque dizionario di breach. Il minimo vale inoltre solo per le password
**nuove**: gli account gia' esistenti tengono la loro.

Conseguenza operativa da ricordare: **il rate limiting del backend non protegge il login.**
`signInWithPassword`, `signUp` e `resetPasswordForEmail` partono dal browser e vanno DIRETTAMENTE
all'API di Supabase con la chiave anon (`app.js`, sezione auth) — non toccano mai `server.js`,
quindi `express-rate-limit` non li vede.

**Correzione a una raccomandazione sbagliata data qui in precedenza**: si era scritto che la leva
rimasta fossero i "Rate Limits di Supabase Auth, da stringere dal pannello". **Non e' vero.**
Verificato sulla documentazione: l'endpoint del login (`/auth/v1/token`, dove finisce
`signInWithPassword`) e' limitato per indirizzo IP a 1800 richieste/ora con raffiche fino a 30, ed
e' esplicitamente **non configurabile**. Nel pannello Authentication > Rate Limits si possono
regolare soltanto invii di OTP, finestra dei magic link, conferma di registrazione e richiesta di
reset password: nessuno di questi e' il percorso del login con password. Su quel fronte non c'e'
nulla da stringere — il limite per IP c'e' gia' ed e' fisso.

La difesa vera disponibile, se un giorno servisse, e' il **CAPTCHA**, che Supabase supporta su
registrazione, login e reset. Non e' un interruttore: richiede un account hCaptcha o Cloudflare
Turnstile e la modifica delle chiamate di auth in `app.js` per inviare il token. Per una lega
privata di dodici amici in beta chiusa e' sproporzionato; diventa sensato solo se la registrazione
venisse aperta al pubblico.

Lezione di metodo: **una raccomandazione operativa va verificata sulla documentazione prima di
darla.** Questa era plausibile e sbagliata, ed e' rimasta scritta come "cosa da fare" finche'
l'utente non ha chiesto i passi esatti.

Nota: il linter di sicurezza di Supabase continuera' a segnalare `auth_leaked_password_protection`
come WARN per sempre. E' atteso e non va inseguito.

## Ruoli in riga sopra il nome, e colore del ruolo anche in vista utente

Due difetti segnalati insieme dall'utente sulla carta di puja, con la stessa radice: una regola
pensata per il caso a UN ruolo che si comportava male con i giocatori multi-ruolo.

**I ruoli si incolonnavano.** `.cc-nome-row` era stata messa `flex-direction:column` apposta —
"il badge del ruolo rubava la riga al nome" — e con un ruolo solo funziona. Ma
`_getRuoloBadgeHTML()` produce **un `<span>` per ruolo**, fratelli del nome: un `Dd/Ds/E` diventa
tre badge, e in colonna finiscono uno sotto l'altro. Si torna `flex-direction:row` +
`flex-wrap:wrap` e si manda a capo il solo NOME con `flex:0 0 100%`. Cosi' i badge stanno
affiancati sopra e il nome tiene comunque tutta la colonna per se': **entrambe le richieste sono
soddisfatte invece di sacrificarne una**, che era il compromesso implicito della regola vecchia.

**I ruoli erano scoloriti solo nella puja.** La regola generica "contorno, non pastiglia piena"
(`html body #puja-panel-slot .badge-ruolo[class*="r-"]`) li spegne tutti a contorno grigio, e per
specificita' batte `html[data-tema="sala-giochi"] .badge-ruolo.r-*`: percio' nella carta di puja i
ruoli erano bianchi mentre ovunque altrove (rose, Anteprima, liste) erano colorati — un'incoerenza
visibile solo li'. Si rialza la specificita' nel solo contesto della puja, tenendo la forma arcade
(gettone squadrato, bordo inset nero, Silkscreen) e restituendo la codifica per colore.
**Solo nel tema arcade**: negli altri tre il contorno e' una scelta voluta, perche' il pieno
colorato e' riservato agli stati.

Nota: la correzione dell'incolonnamento vale per **tutti** i temi, perche' era un difetto di
layout, non una scelta estetica di uno di essi.

## Il rosso degli ultimi secondi: soglia a 3, e il ticchettio resta a 5

Richiesta dell'utente: il rosso della scena deve accendersi **solo negli ultimi 3 secondi**.

Il punto da ricordare e' che la scena diventa rossa da **due posti diversi**, che vanno tenuti
allineati a mano: `updateTimer()` in `app.js` accende `.urgent` sul cronometro (numero, anello,
pulsazione), mentre `fase()` in `comportamenti-asta.js` accende `body.puja-urgente`, da cui
dipendono nel tema il tasto RILANCIA, l'etichetta dell'offerta e i colori del gradiente. Erano a
soglie **diverse** (5 e 4): mezza scena diventava rossa un secondo prima dell'altra. Ora entrambe
a 3, con un commento incrociato nei due file perche' non tornino a divergere.

**Il ticchettio sonoro resta a 5 secondi**, staccato dal rosso: e' l'avviso che il tempo sta per
finire e anticiparlo di due secondi e' utile, mentre il rosso e' l'allarme vero. Prima erano
nello stesso ramo `if` per caso, non per scelta.

## Export Fantaleghe: si esporta la ROSA, non lo storico delle assegnazioni

Bug segnalato dall'utente. `_exportAstaFantaleghe()` costruiva il CSV da `asta.storico`, cioe'
dall'elenco delle assegnazioni avvenute **in quella singola asta**. Su un'asta iniziale non si
nota, perche' li' tutto quello che una squadra possiede e' stato aggiudicato in quell'asta. Su
un'**asta di riparazione** invece lo storico contiene solo i nuovi acquisti: reimportando il file
in Fantaleghe ogni squadra risultava composta soltanto da quelli, **perdendo tutto il resto della
rosa**. Un danno silenzioso, perche' il file si scaricava senza errori.

La fonte giusta e' `squadra.rosa`, che e' lo stato finale vero: in riparazione parte gia' piena
dei giocatori pregressi (nella creazione dell'asta, chi nel file ha gia' una fantasquadra entra
direttamente in `squadra.rosa`), si arricchisce dei nuovi acquisti e perde gli svincolati
(`esegui-svincolo` fa `splice` sulla rosa). E' la stessa fonte gia' usata dal foglio "Rose"
dell'export Excel — il CSV Fantaleghe era l'unico rimasto indietro.

Per l'asta 'iniziale' il risultato non cambia (la rosa parte vuota e si riempie solo con cio' che
viene aggiudicato); anzi e' piu' corretto, perche' la rosa riflette gia' gli annullamenti invece
di doverli ricostruire scorrendo lo storico.

Vale anche per lo **Storico Esportazioni**: li' il payload salvato su Supabase e' l'oggetto asta
intero (`JSON.parse(JSON.stringify(asta))`), quindi contiene le rose e il bottone Fantaleghe delle
aste passate si corregge da solo.

Prezzo esportato: per i giocatori pregressi e' il loro costo di contratto (`prezzo` della rosa,
che alla creazione dell'asta vale `costoOriginale`), per i nuovi acquisti il prezzo pagato in
questa asta.

Aggiunto anche un controllo sui **doppioni**: se lo stesso `idFantaleghe` comparisse in due rose,
prima sarebbe finito due volte nel file corrompendo l'import in silenzio. Ora viene esportato una
volta sola con un avviso esplicito.

## Le Rose in "sala-giochi": la schermata che nessun tema aveva mai toccato

Segnalato dall'utente. `.rose-*` non aveva **una sola regola** in `tema-serata.css`: la schermata
delle rose ereditava i token base e restava con carte arrotondate, ombre sfocate e badge in
gradiente — l'esatto contrario del cabinato. Ora segue la stessa grammatica degli altri pannelli
arcade: angoli vivi, filo d'inchiostro, ombra dura non sfocata, gettone d'oro per le cifre.

I colori dei ruoli **non sono nuovi**: sono i quattro gruppi gia' usati da `.badge-ruolo`
(portieri oro, difesa verde, centrocampo azzurro, attacco corallo), cosi' un ruolo ha lo stesso
colore in Puja, in Anteprima e nelle Rose. La schermata ne usava cinque, con il viola per T/W:
quel gruppo confluisce nell'oro, come gia' avviene nei badge della puja.

**Il punto che vale la pena ricordare: una font a pixel costa larghezza.** Applicando Silkscreen a
tutta la schermata, tre colonne passavano da 432px a **588px (+36%)** — cioe' meno squadre a
schermo, l'esatto opposto di quello che serve alla "Visione compatta", che e' proprio la modalita'
in cui l'utente stava guardando. Misurando elemento per elemento, il collo di bottiglia era
l'intestazione (nome squadra + gettone), piu' larga di qualunque riga giocatore.

La soluzione non e' stata rimpicciolire tutto, ma **dividere per ruolo del testo**: Silkscreen
resta sul "chrome" — intestazioni di reparto, badge, gettoni, interruttore — dove il testo e' corto
e fa il look; i **nomi dei giocatori** tornano alla font base, perche' sono il contenuto denso e
ripetuto ed e' li' che si pagava quasi tutta la larghezza. Il nome squadra resta a pixel ma di
corpo minore. Risultato: **494px, +14% invece di +36%**, e quel resto e' il filo d'inchiostro,
cioe' il tema stesso.

Regola generale che ne esce: **prima di applicare una font a pixel a una schermata densa, misurare
la larghezza risultante contro gli altri temi.** Il tema non deve costare densita' a una vista che
esiste apposta per mostrarne tanta.

## Dimensionare i limiti su un'asta VERA: 12-22 persone per 8-9 ore

Domanda dell'utente dopo il giro di sicurezza: "l'asta e' di 12-22 persone collegate per 8-9 ore,
ne sono gia' state fatte due e ha retto — non e' che ora l'ho rotta?". Domanda giusta: i limiti
erano stati scelti a tavolino, senza confrontarli con il carico reale.

**La buona notizia, verificata leggendo il codice**: quel carico non passa dal rate limiting REST.
Durante l'asta tutto — rilanci, stato, popup — viaggia sul WebSocket, e le **riconnessioni non
fanno nessuna chiamata REST**: `socket.on('connect'/'reconnect')` si limita a riemettere
`join-asta` sul socket. Nove ore di micro-cadute di rete costano zero richieste. Le rotte `/api`
vengono toccate poche volte per caricamento di pagina.

Sono emersi pero' **tre rischi reali**, tutti corretti:

1. **Il contatore per IP puo' essere condiviso.** Le richieste senza token sono contate per IP, e
   un IP e' condiviso in due casi legittimi: due persone della lega sulla stessa wifi, e — molto
   peggio — un reverse proxy che non inoltri l'IP reale, nel qual caso **tutti i partecipanti
   finiscono in un unico contatore**. Con 22 persone che entrano insieme a inizio serata, 300
   richieste/15min si sarebbero potute esaurire proprio li'. Soglie alzate a 600/15min e
   3000/giorno, e soprattutto le due letture pubbliche che servono per ENTRARE
   (`/asta/:id/info`, `/admin/manutenzione-status`) hanno ora un limite loro molto piu' alto e
   **sganciato** dagli altri: non devono mai poter chiudere la porta a chi sta entrando.
   Nota di implementazione: l'esenzione si fa con `skip` reciproco, non registrando una rotta piu'
   specifica prima — dentro a un `app.use('/api', ...)` il `next()` ricadrebbe comunque nei
   limitatori globali e l'esenzione non varrebbe niente.

2. **5 rilanci al secondo erano troppo pochi per una puja combattuta.** Ogni tocco del tasto e' un
   rilancio da un credito; chi martella supera i 5/s e le pulsazioni in eccesso venivano scartate,
   cioe' la persona rilanciava MENO di quanto credeva e poteva perdere il giocatore. Alzato a 10/s.
   Misurato: 8 tocchi umani rapidi (uno ogni 110ms) ora passano tutti, mentre 60 emessi di colpo da
   uno script vengono ancora fermati. La tenuta prolungata del tasto non c'entrava: emette un solo
   evento al rilascio.

3. **Il controllo same-origin del socket poteva bloccare TUTTI.** Confrontava `new URL(origin).host`
   con l'header `Host`. Dietro a un reverse proxy quel confronto fallisce facilmente — la porta
   cambia quasi sempre (443 fuori, 3000 dentro) e spesso `Host` viene riscritto con un nome interno
   lasciando quello vero in `X-Forwarded-Host`. Se fallisse in produzione, **nessuno potrebbe
   collegarsi all'asta**. Ora si confronta l'HOSTNAME (senza porta) contro `Host` e
   `X-Forwarded-Host`, gestendo anche la catena di piu' proxy. Verificato: passano same-origin,
   porta diversa, Host riscritto e catena doppia; restano bloccati dominio estraneo e
   typosquatting (`fantasbocchini.com.evil.net`).

Aggiunta infine una **diagnostica**: `GET /api/health/banda` ritorna l'IP che il server vede per chi
chiama. Aprendola da due dispositivi su reti diverse si devono leggere due IP diversi; se ne compare
uno solo, il proxy non inoltra l'IP reale e le soglie per IP vanno riviste. Non e' un dato
sensibile: a ciascuno mostra il proprio.

Lezione: **un limite di sicurezza va dimensionato sul carico vero, non sul numero che sembra
prudente.** Qui il numero prudente rischiava di rompere la serata che doveva proteggere.

## "Lavagna al Neon" scritto a mano: due font, e le metriche prima dell'estetica

Il tema aveva l'ambiente di una lavagna ma i caratteri della stampa (Archivo/Space Mono, come gli
altri tre locali). Richiesta dell'utente: gesso, leggibile, non una corsiva strana. La scelta e'
ricaduta su **due** font con ruoli distinti, come gia' fa "Sala Giochi" (Press Start 2P + Silkscreen):
**Kalam** e' il font dell'interfaccia (sostituisce Archivo e Space Mono dappertutto), **Caveat** e' la
mano larga riservata alle poche cose grandi e corte — nome del giocatore, cifra dell'offerta,
cronometro, RILANCIA, esito. `Pacifico` resta l'insegna del brand: e' il tubo al neon, non il gesso.

**La scelta e' stata fatta misurando, non guardando.** Con un canvas a 100px, x-height e larghezza
della stessa stringa:

| | x-height | riga | cifre alte | "0" largo |
|---|---|---|---|---|
| Archivo | 52.6 | 990px | 69.8 | 56.3 |
| Space Mono | 49.6 | 1285px | 71.4 | 61.2 |
| Kalam | 51.1 | 891px | 72.9 | 51.6 |
| Caveat | 35.7 | 724px | 56.3 | 45.0 |

Kalam ha praticamente l'occhio di Archivo ed e' piu' stretto di entrambi: si legge alle misure minime
dell'app (8-10px) e le viste dense si **stringono** invece di allargarsi — tre colonne delle Rose
passano da 594px a 560px (-6%), l'esatto contrario della regressione di Silkscreen documentata sopra.
Caveat ha l'occhio del 32% piu' piccolo: e' inservibile come font di base, va bene solo dove il testo
e' maiuscolo (dove le sue maiuscole valgono quelle di Archivo) o enorme. E' questo il motivo del
doppio font, non un gusto grafico.

**Attenzione a come si legge quella tabella** — la colonna "riga" confronta le font a larghezza
NORMALE, ma nella carta di puja Archivo gira a `wdth 62`, cioe' condensato. Sul testo davvero
impaginato "KVARATSKHELIA" occupa 6.5 volte la sua font-size in Caveat contro 6.2 in Archivo
condensato: li' Caveat e' il 5% piu' LARGO, non piu' stretto. (Una misura precedente diceva il
contrario perche' era presa con `scrollWidth` su un elemento a `white-space:nowrap`, che restituisce
la larghezza della scatola invece di quella del testo: per misurare il testo serve un `Range`.)
La tabella resta valida per il confronto Kalam/Space Mono, dove nessuna delle due e' condensata.

**Variabili + liste esplicite, non solo variabili.** Ridefinire `--font-main`/`--font-display` copre
tutto style.css (Rose, Storico, Strategie, modali, campi), ma il foglio di tema riscrive
'Archivo'/'Space Mono' a mano dentro ~43 regole con `!important`, che una variabile non raggiunge:
per quelle serve un elenco di selettori, prefissati con `html[data-tema="lavagna"]` per vincere di
specificita'. `--font-mono` invece **non** si tocca: il link da copiare (`.link-text`), le colonne
numeriche della Griglia P/A (hanno `min-width` + `text-align`) e i `<code>` usano il monospazio per
allineamento e trascrizione, non per estetica.

**Le cifre grandi e il limite `line-height >= 0.76 · k`.** In Caveat le cifre nascono il 19% piu'
basse: sull'offerta, il dato piu' importante a schermo, non era accettabile. Si ingrandiscono con
`font-size-adjust:ch-width`, che ridimensiona la font sulla larghezza del suo "0" senza toccare
nessuna delle `font-size` esistenti — che qui sono responsive (`clamp`/`cqw`) e riscriverle avrebbe
voluto dire rifarle a ogni breakpoint. Ma il valore che pareggia Archivo (.563) **taglia le cifre**:
`.cc-offerta-box` ha `overflow:hidden` e il foglio base stringe l'interlinea sotto 1 (.76 nella carta
grande, .8 in Admin) per recuperare spazio; Caveat ha il corpo molto piu' alto della sua parte
scritta (1.26em contro cifre alte .575em), quindi la linea di base scende e l'inchiostro esce sotto
la riga. Messo in formula, con k = di quanto si ingrandisce la font, le cifre restano dentro finche'
`line-height >= 0.76 · k`. Da qui la coppia k = 1.10 (`ch-width .495`) + interlinea .92: cifre solo
il 10% piu' basse di Archivo invece del 19%, ~4px di margine, 14px di altezza in piu' sulla carta
grande. Tarare piu' su (k 1.156 con interlinea .90) lasciava meno di 1px: verificato a schermo che le
cifre tornavano a toccare il bordo. Dove `font-size-adjust` non e' supportato (Safari < 17) la
dichiarazione viene ignorata: cifre naturali di Caveat, piu' piccole, mai tagliate.

**La coda del 7.** In Caveat l'inchiostro sborda di .088em oltre la larghezza nominale della cifra, e
`.cc-offerta-box` si dimensiona esattamente su quella larghezza: la coda veniva tranciata di netto.
Risolto con `padding-right:.1em` sull'offerta. E' il tipo di dettaglio che una grottesca non ha mai
e che una scrittura a mano porta con se': **quando si cambia famiglia di font non basta guardare
l'altezza, va guardato anche quanto l'inchiostro esce dalla scatola.**

**Un difetto trovato per strada, corretto a parte** (vedi la voce successiva): in vista Partecipante
a 1280px il nome del giocatore andava a capo in mezzo alla parola. Non era una regressione del gesso
ne' un difetto del solo tema lavagna — forzando Archivo sugli stessi elementi restava identico.


## Il nome del giocatore misura la SUA colonna, non la sala

Bug segnalato: in vista Partecipante a 1280px "KVARATSKHELIA" andava a capo in mezzo alla parola —
tre righe nei temi scuri, cinque in "lavagna". Sembrava un difetto del tema lavagna; non lo era:
forzando Archivo sugli stessi elementi il difetto restava identico. Era di tutti e quattro i temi.

**La causa e' uno scalino, non una misura sbagliata.** Appena la sala supera i 1200px
`.asta-row-panels` passa da una colonna a due (la lista squadre si affianca alla puja) e la carta
della puja CROLLA da 596px a 285. Nello stesso identico istante la carta entra nella fascia larga,
che le assegna il ritratto grande: `padding-left:206px` su una carta di 285px lascia 79px al nome,
con la font tarata su `4.4cqw` della SALA, cioe' 54px. Un nome che ne chiede 336 dentro 79px di
colonna: da qui le cinque righe. Misurato (carta / colonna del nome / righe):

| sala | carta | colonna nome | righe (prima) | righe (dopo) |
|---|---|---|---|---|
| 1192 | 596 | 464 | 1 | 1 |
| 1262 | 292–346 | 86–140 | 3, e 5 in lavagna | **1** |
| 1382 | 412–466 | 206–334 | 2 | **1** |
| 1902 | 932 | 726–780 | 1 | 1 |

**La soglia esisteva gia' ed era la cosa giusta da guardare — solo che guardava la sala mentre il
problema era la carta.** E' lo stesso errore, in un altro punto, gia' documentato per il Riepilogo
squadre in Admin ("la soglia misurava la cosa sbagliata") e per il cabinato di Sala Giochi
(`@media` invece di `@container`). Vale la pena scriverlo come regola: **una soglia responsive deve
misurare la scatola che contiene davvero il testo, non un antenato che le somiglia.**

Due correzioni, nessuna delle quali inventa numeri nuovi:

1. **`.cc-info` diventa un container** (`nomecol`) e la font del nome si misura su di lei: `15cqw`.
   Il 15 non e' a occhio — il nome piu' lungo dell'app occupa ~6.5 volte la sua font-size (Caveat) e
   ~6.2 (Archivo condensato), quindi `15% x 6.5 = 97.5%` della colonna: sta sempre su UNA riga, a
   qualunque larghezza e in tutti e quattro i temi, senza una tabella di valori da mantenere. I
   tetti massimi per fascia restano quelli di prima: cambia da cosa si parte, non dove si arriva.
2. **Il ritratto scende con la carta** invece che con la sala, riusando le misure che le fasce
   strette avevano gia' (100px e 112px). Le nuove fasce sembrano fuori scala rispetto a quella
   sopra i 1200px — ed e' voluto: e' proprio li' che la carta e' piu' stretta, per lo scalino della
   griglia.

**Il container va messo solo in vista Partecipante.** Provato anche in Admin, la colonna del nome
collassava a **0px**: li' `.cc-header` si dimensiona sul contenuto, e `container-type:inline-size`
azzera la larghezza intrinseca di cio' che contiene. In Partecipante non succede perche'
`.cc-header` e' `width:100%`. Verificato prima di sceglierlo: la sola dichiarazione `container-type`
non sposta di un pixel nessuna delle larghezze in gioco.

**Terza correzione, stessa famiglia:** `.cc-offerente` ("Offerta di: Real Cazzuola") era
`nowrap` + `ellipsis` e a 1280px veniva troncato a "Real Caz…" — 180px di testo in 160px di casella.
Ora va a capo. E' l'applicazione diretta della regola "non si nasconde informazione": se due
informazioni non stanno su una riga si usa una riga in piu', non si taglia un dato.

**Verificato** in browser reale, A/B con e senza la correzione, a 390 / 800 / 1000 / 1219 / 1232 /
1250 / 1261 / 1280 / 1348 / 1366 / 1400 / 1418 / 1422 / 1440 / 1531 / 1549 / 1560 / 1920px, nei
quattro temi: una riga sola ovunque, cifra dell'offerta che non sborda piu' dalla carta, nome
dell'offerente mai troncato. Fuori dalla fascia rotta (390, 1000, 1920) il risultato e' identico
pixel per pixel a prima.

## La pagina dell'asta scorre: una sola area, non tre annidate

Richiesta dell'utente. Sopra i 768px la schermata d'asta era alta esattamente un viewport
(`#screen-asta.active{height:100vh;overflow:hidden}`) e l'unica cosa che scorreva era il contenuto
della tab aperta. Conseguenza non voluta: la carta di puja restava sempre a schermo, quindi la
**striscia di puja** (`js/puja-sticky.js`), costruita apposta per quando la scena scorre via, non
aveva quasi mai occasione di comparire. Si era pagato un modulo intero per un caso che il layout
rendeva raro.

Non e' un meccanismo nuovo. Sotto i 768px la pagina scorre da sempre, e in vista Partecipante
scorreva gia' `#asta-main-col` (regola introdotta perche' con la sala stretta le tab venivano
spinte fuori dalla finestra e diventavano **irraggiungibili**). C'erano quindi gia' tre aree di
scorrimento possibili — colonna, riga delle tab, contenuto della tab — che si passavano il
problema. Ora ce n'e' **una**: `#screen-asta`.

Tre scelte non ovvie:

1. **Lo scorrimento va su `#screen-asta`, non su `html`/`body`.** Quelli sono condivisi con Home,
   Lobby, Strategie, Editor Fasce e Griglia P/A, che scorrono gia' per conto loro dentro
   `.screen.active`. Toccarli avrebbe cambiato cinque schermate per sistemarne una. Di fatto la
   regola nuova **restituisce** a `#screen-asta` il comportamento generico di `.screen.active`
   (`height:100vh` + `overflow-y:auto`), che era annullato da `overflow:hidden`.

2. **Il blocco sta in `tema-serata.css` e non in `style.css`, che sarebbe il foglio del layout.**
   Le regole da battere stanno in quel file e sono `!important` (lo scroll di `#asta-main-col`, il
   `min-height` delle tab, `align-self:stretch` + `max-height:100%` sul drawer di Anteprima), e
   `style.css` viene caricato PRIMA: scrivere li' avrebbe voluto dire inventare selettori piu'
   lunghi per vincere una cascata che parte gia' perdente, e spargere una modifica sola su due
   file. In questo progetto due meta' della stessa cosa in due file finiscono sempre per divergere
   — e' successo con le due soglie del rosso a 5s e 4s e con la regola duplicata che vinceva per
   specificita'.

3. **Non si tocca nessun `overflow`, solo `flex` e `min-height`.** Le scatole annidate erano
   `flex:1;min-height:0` per spartirsi un'altezza fissa; passandole a `flex:0 0 auto` prendono
   l'altezza del contenuto, e a quel punto un `overflow-y:auto` non fa comparire nessuna barra e un
   `overflow:hidden` non ritaglia niente (a `.tabs-panel` serve ancora, per i suoi angoli
   arrotondati). Vale anche per `.rose-container`, che conserva intatto il suo `overflow-x:auto`:
   la striscia di 12 colonne resta orizzontale, com'e' giusto.

**Anteprima e' l'unica esclusa, e non per capriccio.** Non e' una tab: e' una colonna SORELLA di
`.asta-main-col` con `align-self:stretch`. Con la colonna principale alta quanto le Rose si
stirerebbe uguale, e il campo 3D finirebbe minuscolo in cima a un pannello lunghissimo. Resta alta
un viewport con lo scorrimento suo, e diventa `position:sticky;top:0` per restare a portata mentre
scorri il resto.

**Griglia P/A invece NON si puo' escludere in modo pulito**, ed e' bene sia scritto: appena
`.tabs-panel` passa ad altezza automatica, il suo contenuto eredita quell'altezza anche mantenendo
`flex:1`. Tenerle uno scorrimento interno avrebbe richiesto un'altezza fissa in pixel — cioe'
esattamente l'errore gia' documentato tre volte qui dentro ("la soglia misurava la cosa
sbagliata"). Cio' che definisce quella vista, l'`overflow-x:auto` della mappa di calore dentro al
suo piano, non e' toccato: cambia solo che cresce verso il basso invece di scorrere dentro. Effetto
collaterale accettato: le intestazioni di colonna della mappa sono `position:sticky;top:0` rispetto
al loro contenitore, che ora non scorre piu' in verticale, quindi non seguono piu' lo scorrimento
della pagina. Le etichette di riga (`left:0`), che servono sull'asse che conta li', funzionano
come prima.

**Effetto collaterale sulle Rose, dichiarato:** la barra di scorrimento orizzontale della striscia
di colonne si trova ora in fondo a un pannello molto alto, quindi per raggiungerla col mouse
bisogna scorrere fino in fondo. Rotella orizzontale e trackpad continuano a funzionare da
qualunque punto. Si e' scartato di far andare a capo le colonne (`flex-wrap`) nell'app: cambierebbe
parecchio la vista e va contro la "Visione compatta", che esiste per vedere piu' squadre in meno
spazio. Nella vista a parte, dove lo spazio c'e', il wrap si fa (vedi sotto).

**La testata non e' stata toccata**: era gia' `position:relative` (`tema-serata.css`), quindi se ne
va con lo scorrimento da sola. Se un giorno tornasse `sticky` andrebbe ricordato che ha
`z-index:1000` mentre la striscia di puja sta a 800: coprirebbe la striscia, non il contrario.

**Verificato** in browser con stato d'asta sintetico: 8 combinazioni vista x tema a 1280px e le due
viste a 900 / 1100 / 1280 / 1440 / 1920px — la pagina scorre in tutte, **zero sbordo orizzontale**
in tutte. A 375px le regole non si applicano affatto (sono in `@media (min-width:769px)`) e i valori
calcolati restano quelli di prima (`flex:1 1 0%` su `.tab-content` e `.rose-container`). Con la
pagina scorsa di 352px la striscia di puja compare col giocatore, l'offerta, l'offerente e il tasto;
il drawer di Anteprima resta incollato a `top:0` con `max-height` pari al viewport invece di
stirarsi a 1250px.

## La vista a parte: uno specchio del DOM, non una seconda app

Richiesta dell'utente: poter aprire le Rose (e, per estensione, Storico e Svincolati) in una scheda
del browser tutta loro, a tutto schermo. Nuovo modulo `frontend/js/vista-esterna.js`, additivo come
`clessidra.js`, `comportamenti-asta.js` e `puja-sticky.js`.

La scelta di fondo e' fra due strade molto diverse:

- **una pagina vera** (`/rose.html?asta=ID`), bookmarcabile e ricaricabile, ma che apre un **secondo
  socket per persona** (22 partecipanti = 44 connessioni una sera d'asta) e ha bisogno di un suo
  login e di un suo `join-asta`;
- **uno specchio**: `window.open('', nome)` su una scheda `about:blank` scritta da qui, che
  rispecchia l'`innerHTML` del nodo vero.

Scelto lo specchio, su indicazione dell'utente. Puo' funzionare per un motivo preciso che vale la
pena scrivere: `renderRose`, `renderStorico` e `renderGiocatoriLiberi` girano ad **ogni**
aggiornamento di stato, non solo quando la loro tab e' aperta (`app.js`, nel blocco che ridisegna
tutto dopo `stato-asta`). Il nodo sorgente e' quindi sempre fresco anche mentre guardi un'altra
tab: allo specchio basta copiarlo. Zero socket, zero REST, zero login in piu'.

Tre decisioni dentro questa:

1. **I click tornano indietro per POSIZIONE nell'albero.** Lo specchio e' una copia esatta
   dell'`innerHTML`, quindi il percorso di indici fra i soli figli-elemento porta allo stesso
   elemento nel documento madre, dove si fa `.click()` sull'elemento VERO. Nessuna conoscenza del
   markup: funziona per le intestazioni pieghevoli delle Rose, per le righe degli Svincolati e per
   qualunque cosa venga aggiunta domani. E' lo stesso principio della striscia di puja, che per
   rilanciare fa `.click()` sul vero `#btn-rilancio` invece di emettere l'evento: un percorso solo,
   con tutti i controlli dell'app in mezzo.
2. **Il click si ferma SEMPRE nello specchio, anche quando il gemello non si trova.** Trovato
   provando: l'HTML copiato si porta dietro anche gli `onclick` inline che l'app scrive nel markup
   (`_toggleRoseSec(...)`, `chiamaLibero('p2')`), funzioni che in quella scheda non esistono — ogni
   click finiva con un `ReferenceError` non gestito. Il listener sta in fase di **cattura** sul
   documento, quindi `stopPropagation()` impedisce all'evento di arrivare all'elemento e al suo
   handler inline di partire. Stessa tecnica con cui `comportamenti-asta.js` sopprime il click
   dell'app sotto la leva. E' anche la regola del modulo scritta per intero: **lo specchio non
   esegue mai niente per conto suo.**
3. **La scheda si ricostruisce da sola se viene ricaricata.** Un F5 sullo specchio riporta il
   documento a un `about:blank` vuoto, e senza rimedio resterebbe bianco. Il giro lento da un
   secondo — che serve comunque ad accorgersi di una scheda chiusa — controlla se il contenitore
   c'e' ancora e, se non c'e', rifa' la pagina. Era l'unico vero difetto della strada "specchio", e
   costa cinque righe.

Altri punti che vale la pena ricordare:

- **`d.title` va scritto DOPO aver svuotato `<head>`, non prima.** `document.title` crea un
  `<title>` dentro `<head>`: svuotare la testa dopo se lo porta via. Scritto nell'ordine sbagliato
  la scheda restava intitolata `about:blank` — trovato solo perche' la verifica guardava il titolo.
- Nello specchio si copiano `data-tema` sull'`<html>` e la `className` del `<body>`: senza, le
  regole dei quattro temi (scritte su `html[data-tema=...]` e spesso su `body.layout-*`) non
  aggancerebbero niente e la scheda uscirebbe col tema di default. Un `MutationObserver` su
  `data-tema` la tiene allineata quando il tema cambia a caldo dal menu 🎨.
- Si copiano anche i `<link>` di Google Fonts, non solo i due CSS: due temi su quattro cambiano i
  caratteri, e senza quelli la scheda uscirebbe in Archivo mentre l'app e' in gesso o a pixel.
- **Solo qui le colonne delle Rose vanno a capo** (`flex-wrap`): e' l'unico punto in cui la vista a
  parte si comporta diversamente dall'originale, ed e' il motivo per cui la si voleva — a tutto
  schermo 12 squadre stanno in tre file invece che dietro una barra orizzontale.
- Lo stile della scheda vive **dentro il modulo**, non in `tema-serata.css` dove sta quello della
  striscia di puja: la scheda e' un DOCUMENTO diverso, con un foglio che questo file deve comunque
  scrivere da zero. Tenere le due meta' della stessa finestra in due posti e' il modo sicuro di
  farle divergere. I colori sono tutti token (`--bg-elevated`, `--border-light`, ...), quindi la
  scheda segue i quattro temi senza una regola per tema, come gia' fa il selettore 🎨.
- Se il browser blocca la finestra, il modulo lo dice con un `alert` invece di non fare niente:
  `toast()` vive in `app.js` e questo modulo non presuppone di averlo.

**Verificato** in browser con stato sintetico. Il `window.open` non e' provabile dentro al browser
integrato usato per la verifica (blocca i pop-up sempre — e quel ramo, l'avviso all'utente, e'
stato visto scattare davvero). Il resto e' stato provato sul codice REALE del modulo, non su una
copia, sostituendo temporaneamente `window.open` con il `contentWindow` di un `<iframe>`: e' un
`Window` con un `Document` veri, quindi `costruisci`, `aggiorna` e `delega` girano per intero.
Risultati: Rose 12 colonne e 216 giocatori identici all'originale, Storico 25 righe, Svincolati 60,
titoli e fogli di stile giusti in tutte e tre; aggiornamento in diretta (cambiati i crediti di una
squadra, lo specchio li mostra); click su un'intestazione dello specchio che piega la sezione VERA
e si riflette indietro; click sul nome dentro una riga di Svincolati che arriva a
`chiamaLibero('p2')`, esattamente l'id che quella riga porta nell'originale; cambio di tema a caldo
che passa allo specchio e torna indietro; documento svuotato a mano e ricostruito dal giro lento
entro un secondo; e, dopo la correzione, **zero errori** in console sia nello specchio sia nella
scheda madre.

**Non verificato**: l'apertura vera di una scheda del browser (bloccata dallo strumento di
verifica), e il comportamento con un'asta reale e piu' dispositivi — il limite di sempre.
