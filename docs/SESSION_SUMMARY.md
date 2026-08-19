# SESSION_SUMMARY.md

Stato corrente del progetto. Questo file è memoria di lavoro, non storico — va sovrascritto,
non accumulato (per la cronologia vedi `git log`).

## Stato attuale

- Branch `main`, allineato con `origin/main` (ultimo push: `83f1939`). Modifiche locali
  pendenti: Strategia multi-asta (vedi sotto), non ancora committate.
- **Nota importante**: durante questa sessione, il redesign 3D di Anteprima costruito qui
  (carta FX orizzontale, stadio Three.js con importmap, fix carta Puja admin) è stato
  **scartato su richiesta esplicita dell'utente** in favore di una versione diversa già presente
  su GitHub (`origin/main`), costruita con un altro strumento in parallelo — branding app
  cambiato da "Asta FantaSbocchini" a "FantaBar", stadio 3D con `ant-stadio-3d` (Three.js via
  `<script>` globale, non importmap). Il lavoro scartato resta recuperabile nel branch
  `backup/sesion-redesign-tres-js-20260817` se mai servisse confrontarlo o riprenderlo.
- Git: identità corretta con `git config --global user.name "AlbaVC95"` +
  `user.email "albavicentecarragal@gmail.com"` (coerente con l'autore già usato in commit
  precedenti del repo) e applicata con `--amend --reset-author` all'ultimo commit locale
  (`d5b5b0f`). I commit precedenti di questa sessione restano con l'identità automatica
  precedente (`alba@MacBook-Air-de-Alba.local`), non riscritti.

## Ultimo intervento — Strategia associabile a più Aste (non più solo Asta iniziale)

Bug reale: `strategie.tipo_asta` era una colonna scalare (un solo valore), quindi una
strategia creata come `'iniziale'` non poteva mai risultare compatibile con un'asta di
riparazione (`caricaStrategieCompatibili()` filtrava con `.eq()`) — non era un problema di ID,
solo cardinalità 1:1 dove serviva 1:N. Confermato anche sui dati reali: 2 strategie esistenti
("repa1", "test Riparazione1") già create per riparazione1 erano invisibili in quell'asta.

Fix additivo: nuova tabella `strategia_tipi_asta` (strategia_id, tipo_asta), applicata su
Supabase con backfill (30 strategie → iniziale, 2 → riparazione1, retrocompatibili senza
reimportare). `strategie.tipo_asta` non toccata. Form di creazione ora ha checkbox multiple
(non più un `<select>` singolo); `caricaStrategieCompatibili` legge dalla tabella ponte; 3
punti di rendering mostrano un badge per tipo associato invece di uno solo. Nulla toccato in
`selezionaStrategiaAsta`/`S.strategiaAsta`/calcolo prezzi (operano già su una strategia_id
risolta, indipendente dal tipo) — Asta iniziale invariata.

File: `backend/sql/2026-08-19_strategia_tipi_asta.sql` (nuovo), `frontend/index.html`,
`frontend/js/app.js`, `frontend/css/style.css`.

**Verificato**: query SQL dirette sul DB reale (compatibilità corretta per riparazione1 sui
dati reali; test isolato con strategia associata a tutti e 3 i tipi, poi ripulito), e nel
browser via mock di `supa.from` (impossibile testare con login reale, stesso limite delle
sessioni precedenti): checkbox di default solo "iniziale", multi-selezione funzionante,
badge multipli renderizzati correttamente nella lista strategie (screenshot). Non committato.

## Intervento precedente — Asta di riparazione: UI svincolo, blocco riacquisto, arrotondamento, popup Admin

9 correzioni/aggiunte richieste dall'utente attorno al motore di svincolo (già costruito
nell'intervento precedente, non toccato nella sua logica economica). Pianificato con
`EnterPlanMode` + due `AskUserQuestion` di chiarimento (vista Admin: interattiva come backup,
non solo lettura; blocco riacquisto: solo sul rilancio a tempo, non su assegna-manuale).

1. **Redesign riga selezione svincolo** (`renderPopupSvincolo`, app.js): avatar (stessa cache/
   loader di `_loadEditorAvatars`, nuovo `_loadSvincoloAvatars`), badge ruolo colorato
   (`_getRuoloBadgeHTML`), badge U21, prezzo, recupero. **Rimossa la pre-selezione
   automatica** del piano suggerito dal server — nessun giocatore selezionato di default.
2. **Recap Riparazione**: mostra ora il credito recuperato per ciascun giocatore svincolato
   più il totale (`renderStorico`), non solo i nomi.
3. **Blocco riacquisto squadra+giocatore+asta**: nuovo `asta.svincoliVietati` (Set, escluso da
   `broadcastStato` perché non serializzabile/non necessario al client), popolato in
   `esegui-svincolo`, controllato in `'rilancio'` — chi ha svincolato un giocatore non può
   ripujarlo se ri-estratto nella stessa asta; le altre squadre restano libere. Solo sul
   rilancio a tempo (decisione confermata), non su `assegna-manuale`.
4. **Nessun cooldown sul re-svincolo**: verificato che comprare-e-poi-risvincolare nella
   stessa asta resti sempre permesso (nessuna modifica necessaria).
5-6. **Arrotondamento**: `Math.floor` → nuovo `calcolaRecuperoSvincolo(prezzo, fattore)` =
   `Math.max(1, Math.round(prezzo*fattore))` (Math.round arrotonda .5 sempre per eccesso in
   JS, coincide con tutti gli esempi dati), con pavimento di 1 credito garantito. Sostituito
   in tutti e 7 i punti dove veniva calcolato (3 backend, 4 frontend, duplicato client come da
   pattern già in uso).
7. **Chip "🔓 X/Y" svincoli rimanenti** in `renderBudgetBar` (pannello "Riepilogo squadre"
   live, tutte le squadre), si aggiorna da solo ad ogni `broadcastStato`.
8. **Popup svincolo azionabile anche dall'Admin**: stesso pattern già esistente per la
   riconferma RIC (`emitToAdmins` con lo stesso payload arricchito della squadra,
   `esegui-svincolo` già accettava l'Admin lato server) — il client ora riusa DIRETTAMENTE lo
   stesso `modal-svincolo`/`renderPopupSvincolo` invece del vecchio messaggio di sola attesa.
   Fix necessario: `sv-crediti` cercava `getMiaSquadra()` (sbagliato per l'Admin che supervisiona
   un'altra squadra) — ora cerca la squadra vincitrice per nome in `S.asta.squadre`.
9. **"Nascondi" + ripresa dello svincolo**: nuovo bottone che nasconde il modal SENZA toccare
   `S.popupAttivoCli`/`S.svincoloSel` (l'operazione resta pendente), badge fisso
   `#btn-svincolo-pendente` per riprenderla identica. Stesso meccanismo di "nessuna
   preselezione" (punto 1) riusato per il ripristino: `renderPopupSvincolo` ri-applica sempre
   `S.svincoloSel` corrente (vuoto al primo apertura, preservato se nascosto e riaperto), mai
   il suggerimento del server.

**Bug reale trovato durante l'implementazione**: il primo tentativo di inserire il badge
`#btn-svincolo-pendente` lo ha piazzato per errore DENTRO `#modal-overlay` — restava invisibile
insieme a lui quando l'overlay veniva nascosto (`display:none` su un antenato vince su
`position:fixed`). Spostato fuori, subito prima di `</body>`.

**Bug di tooling reale, da ricordare per il futuro**: l'Edit tool standard, usato per un
singolo cambio di una riga in `frontend/js/app.js`, ha silenziosamente convertito TUTTE le
6000+ righe del file da CRLF a LF (non solo la riga toccata) — il file ha 137 righe LF-only
preesistenti (confermate già presenti nel commit `7a1cafb`, non introdotte da questa sessione)
che evidentemente confondono il meccanismo di patch dell'Edit tool su questo file specifico.
Rilevato subito dal controllo `awk` di routine (137→0), corretto con `git checkout` del file +
ripetizione del cambio con lo script Node che fa `split("\n")` (mai `split("\r\n")`, che
disallinea gli indici di riga proprio a causa di queste righe miste) + `\r` esplicito solo
sulle righe nuove. **Da questa sessione in poi: mai più l'Edit tool su `frontend/js/app.js` o
`frontend/index.html` o `frontend/css/style.css` (tutti hanno righe LF-only preesistenti),
nemmeno per un cambio di una riga sola — sempre lo script Node.**

**Verificato**: 14 test standalone Node (arrotondamento con tutti gli esempi esatti
dell'utente + blocco riacquisto), verifica visuale nel browser con dati sintetici iniettati in
console (screenshot): redesign riga con avatar/badge/nessuna preselezione, arrotondamento
corretto a schermo (3cr→+2cr), Nascondi→badge pendente→Riprendi con selezione esatta
ripristinata E bordo di selezione ora visibile (fix CSS `.selezionato`), popup Admin con nota
"stai gestendo per conto di X" e crediti della squadra corretta (non i propri), chip svincoli
nel Riepilogo squadre che decresce con l'uso, Recap con dettaglio per-giocatore. Non
verificato in un flusso live reale (stesso limite di login Supabase delle sessioni precedenti).

## Intervento precedente — Asta di riparazione: Massima Offerta ottimizzata + svincoli post-vittoria

Feature complessa richiesta esplicitamente dall'utente (pianificata con `EnterPlanMode`,
decisioni chiave confermate via `AskUserQuestion` prima di scrivere codice — vedi
`DECISIONS.md` per il design completo). Riassunto:

- **Massima Offerta** in riparazione ora simula QUALE combinazione di portieri/movimento
  liberare massimizza `crediti + recuperabili − riservati per i minimi`, invece del vecchio
  top-N per valore che ignorava l'effetto sui minimi Portieri/Movimento. Nuove
  `costruisciListeOrdinateSvincolo()`/`calcolaPianoSvincoloOttimale()` in `backend/server.js`
  (prima di `calcolaMaxOfferta()`), specchiate lato client in `_costruisciListeOrdinateSvincoloCli`/
  `_calcolaPianoSvincoloOttimaleCli` (`frontend/js/app.js`, dentro `calcolaMaxOffertaSquadra`).
- Una squadra al tetto `maxGiocatoriPerSquadra` ora può continuare a offrire in riparazione
  SE ha ancora svincoli disponibili (prima bloccata sempre a 0, anche in riparazione — fix
  necessario di un mio intervento precedente nella stessa sessione). `tipoAsta==='iniziale'`
  resta invariato.
- Il popup di svincolo (`chiudiAsta`) ora scatta anche per mancanza di SPAZIO rosa, non solo
  crediti, e mostra il numero minimo di svincoli necessari (`calcolaSvincoliMinimiPerVittoria()`)
  con un piano suggerito pre-selezionato nella UI (`renderPopupSvincolo`).
- `esegui-svincolo` era completamente privo di validazione server-side (bypassabile dal
  client) — aggiunta copertura crediti, tetto massimo (`svincoliRimanenti`), spazio minimo
  rosa, tutto ricalcolato fresco lato server, mai fidandosi del popup congelato.
- `svincoliTotali` ora è configurabile anche dopo la creazione (`admin-update-config` +
  modale Impostazioni Admin) e viene incluso nell'export JSON, cosi' il tetto cumulativo
  Riparazione1→Riparazione2 sopravvive al reimport.
- Creare un'asta di riparazione dal Listino Ufficiale è ora bloccato (client: opzione
  disabilitata proattivamente; server: 400 esplicito) — produrrebbe squadre senza rosa
  pregressa da cui svincolare.

**Verificato**: 11 test standalone Node sul codice REALE estratto da `server.js` (incluso
l'esempio numerico esatto dell'utente: 26 movimento/min 25/0 crediti/3 svincoli da 10cr →
atteso e ottenuto 14, non 15), 6 test di sincronia client↔server (stessi input, stesso
output), verifica manuale nel browser via dati sintetici iniettati in console: popup svincolo
con pre-selezione del suggerimento server, blocco al superamento del tetto svincoli, blocco
pulsante conferma sotto il minimo, campo Impostazioni Admin mostrato solo in riparazione e
pre-riempito, riabilitazione dell'opzione "riparazione" dopo un ricaricamento Excel/JSON. Non
verificato in un flusso live completo (stesso limite di login Supabase delle sessioni
precedenti).

**Nota tecnica**: sia `backend/server.js` sia `frontend/js/app.js` hanno line-ending misti
pre-esistenti (137 righe LF-only in app.js, confermate presenti già nel commit
`7a1cafb` "Add files via upload", non introdotte da questa sessione) — lo split ingenuo per
`\r\n` usato nelle sessioni precedenti per patch puntuali può disallineare gli indici di riga
in punti del file adiacenti a queste righe. Tecnica corretta usata da questa sessione in poi:
split per `\n` (come fa `sed`/`grep -n`), poi ricongiungere sempre con `\n` aggiungendo `\r`
esplicito solo alle righe NUOVE inserite — preserva esattamente la terminazione originale
(mista) di ogni riga non toccata.

## Intervento precedente — Asta di riparazione: i giocatori importati restano nella loro fantasquadra

Bug segnalato dall'utente: creando un'asta di riparazione (1 o 2) da Excel o JSON, i
giocatori che nel file appartenevano già a una fantasquadra finivano trattati come
svincolati/chiamabili invece di restare nella loro rosa — solo chi nel file risultava
davvero senza squadra doveva essere svincolato. Causa: `POST /api/asta`
(`backend/server.js:598-618`) metteva SEMPRE ogni giocatore di `sq.giocatori` in
`asta.poolGiocatori` con `assegnato:false` (chiamabile), senza mai popolare
`squadra.rosa` all'import — quel campo veniva riempito solo da `assegnaGiocatoreASquadra()`
durante un'asta live, mai al momento della creazione.

Fix, **solo per `tipoAsta === 'riparazione'`** (comportamento di `'iniziale'` invariato,
per scelta esplicita — lì i giocatori con una fantasquadra nel file devono restare
chiamabili per la logica RIC/PLUS):
- `backend/server.js:598-618`: se l'asta è di riparazione, ogni giocatore di
  `sq.giocatori` viene marcato `assegnato:true, estratto:true` in `poolGiocatori` (non più
  richiamabile) E aggiunto direttamente a `squadra.rosa` con `prezzo: costoOriginale`
  (nessuna doppia decurtazione crediti — `sq.crediti` per riparazione rappresenta già il
  budget NETTO residuo, non un totale lordo, vedi commento esistente su `campiCrediti`
  poco sopra). Effetto collaterale positivo: il calcolo "crediti recuperabili da svincolo"
  in `calcolaMaxOfferta()` (ramo riparazione) ora funziona fin dalla creazione, prima
  restava sempre a zero perché `squadra.rosa` era sempre vuota all'import.
- `frontend/js/app.js:1421-1452` (`handleExcelFile`): il parsing Excel raggruppava i
  giocatori senza `FantaSquadra` sotto una fantasquadra FITTIZIA letterale
  `"Senza squadra"` (mai un vero array `svincolati`, a differenza del formato
  JSON/export). Ora le righe con `FantaSquadra` vuota (o solo spazi, con `.trim()`)
  finiscono in un array `svincolati` separato — stesso formato già atteso dal backend
  (`svincolatiJson`) e dall'import JSON. Necessario perché senza questo fix il nuovo
  comportamento backend avrebbe creato una squadra reale "Senza squadra" con tutti i
  liberi intrappolati nella sua rosa invece che svincolati.

**Verificato**: `node --check` su entrambi i file, diff puliti (CRLF preservato a mano via
`perl`, stesso gotcha di sempre). Estratto il codice REALE di entrambe le funzioni
modificate e testato con l'identico scenario descritto dall'utente (Giocatore A →
fantasquadra1, Giocatore B → fantasquadra2, Giocatore C → senza squadra): 13/13 casi
passati lato backend (A e B restano in rosa con crediti squadra invariati, C è l'unico
chiamabile, comportamento `'iniziale'` invariato in regressione) + 7/7 lato frontend
(nessuna squadra fittizia "Senza squadra", C finisce in `svincolati` con
`squadraOriginale:null`, gestito anche il caso di celle con soli spazi). **Non verificato
in un flusso live reale nel browser** (upload file → creazione asta → controllo rose):
stesso limite di login Supabase già annotato per l'intervento precedente.

## Intervento precedente — `maxGiocatoriPerSquadra` ora è un tetto TOTALE (portieri+movimento), enforced

Richiesta esplicita dell'utente: prima `maxGiocatoriPerSquadra` esisteva solo come dato di
config, senza ALCUN enforcement in nessun punto del codice (né come totale né come solo
movimento — verificato con grep esaustivo prima di intervenire). L'etichetta del form già
diceva "Portieri + Giocatori" ma non veniva mai fatta rispettare. `minimoPortieri`/
`minimoMovimento` restano vincoli minimi separati per categoria, invariati (già corretti,
riservano crediti in `calcolaMaxOfferta`/`calcolaMaxOffertaSquadra`).

Aggiunto un guard `if (squadra.rosa.length >= (asta.maxGiocatoriPerSquadra || 25)) return 0`
in **4 punti** di `backend/server.js` (nessuna nuova funzione, riuso dei percorsi di
validazione/gating già esistenti):
- `calcolaMaxOfferta()` (riga 333): punto centrale, blocca qualunque rilancio normale tramite
  il controllo `offerta > maxOff` già esistente nell'handler `'rilancio'` — non tocca l'handler.
- `avviaChiamata()` RIC (riga 376, `haSpazio`): il proprietario precedente non riceve più
  l'offerta di riconferma a prezzo fisso se la sua rosa è già piena — il giocatore va invece
  alla normale asta a tempo per le altre squadre.
- `chiudiAsta()` popup post-asta (riga 433, `hasRecompra`): l'opzione "recompra" viene
  nascosta se il proprietario precedente è al tetto (la "plusvalenza", che non aggiunge un
  giocatore alla sua rosa, resta sempre disponibile).
- Handler `'assegna-manuale'` (riga 1114): stesso blocco per l'assegnazione diretta admin, che
  non passa da `calcolaMaxOfferta`.

Specchio lato client in `frontend/js/app.js:4399` (`calcolaMaxOffertaSquadra`, già documentata
come "deve restare sincronizzata col server, solo hint UI").

**Verificato**: `node --check` su entrambi i file, diff puliti senza rumore di line-ending
(file CRLF, stesso gotcha di sempre — modifiche fatte a mano via `perl` preservando `\r\n`,
non con l'Edit tool). Estratto il codice REALE di `calcolaMaxOfferta()` così com'è nel file e
testato con 8 casi sintetici (incluso l'esempio esatto dell'utente: min 3 portieri/25
movimento/max 32 totali) — sotto il tetto può offrire, al tetto o oltre è bloccata (max=0),
minimi per categoria e logica svincoli (asta riparazione) invariati. **Non verificato in un
flusso live reale nel browser** (crea asta → chiama giocatore → rilancio → blocco): l'app
richiede login con account Supabase e non erano disponibili credenziali di test in sessione,
non è stato creato un account per questo.

**Limite noto, non corretto in questo intervento** (per non allargare lo scope, l'utente non
ha ancora confermato se vuole chiuderlo): race molto rara se un admin usa `'assegna-manuale'`
per la stessa squadra mentre un popup "recompra" è pendente per quella squadra — stesso tipo
di race già preesistente per i contatori slotsRIC/slotsPLUS, non introdotta da questo
intervento.

## Intervento precedente — Badge U21 sulle carte Anteprima

Richiesta esplicita dell'utente: i giocatori U21 devono essere riconoscibili come tali anche
in Anteprima (non solo in Puja/Svincolati/Fasce, dove esisteva già `.tipo-U21`). Aggiunto in
`_antCardHTML()` (`frontend/js/app.js`, dopo la riga `const stato = ...`) un badge condizionale
`g.u21 === true ? '<div class="ant-card-u21">U21</div>' : ''`, stesso campo/valore booleano già
usato altrove (nessuna logica nuova, solo un badge sulla carta). CSS `.ant-card-u21`
(`frontend/css/style.css`, subito dopo `.ant-card-role`) speculare al badge ruolo esistente
(stessa posizione in angolo, stesso pattern di dimensioni per `size-xl`) ma a destra invece che
a sinistra, riusando i colori di `.tipo-U21` (verde `--success`). Aggiunti anche gli stessi
override di z-index/posizione già esistenti per il badge ruolo nei contesti `in-bench.size-xl`
e `.assegnazione-fx-card` (carta grande dell'animazione di assegnazione), cosi' il badge U21 si
comporta in modo coerente in tutte le dimensioni di carta (bench, pitch minimo ~37px, xl).
Verificato iniettando carte di test nella pagina reale (via console) alle tre dimensioni: badge
leggibile e senza overlap col badge ruolo anche alla dimensione minima del campo. Non verificato
con un giocatore U21 reale in un'asta live (nessuna asta di test disponibile in sessione).

## Intervento precedente — Panchina in Anteprima ordinata per ruolo

Richiesta esplicita dell'utente: i giocatori in Panchina (Anteprima) ora sono ordinati per
ruolo (Portiere → Difesa → Centrocampo → Esterni → Attacco), invece dell'ordine grezzo di
`squadra.rosa`. Nuova `_antRoleGroupOrder()` (`frontend/js/app.js`, subito dopo
`_antRoleClass`) riusa lo stesso raggruppamento a 5 gruppi già usato per il colore d'accento
delle carte (`_roseRowRoleClass`), cosi' i due criteri restano coerenti. Applicato con un
`.sort()` sull'array `disponibili` in `_antRenderPanchina()`. Nessun controllo UI aggiunto
(nessun toggle): l'ordinamento per ruolo è ora il comportamento di default, non opzionale.
Verificato con dati sintetici in console browser (ordine risultante Por→Dc→M→W/T→A, come
richiesto) — non verificato in un'asta reale con rosa assegnata.

## Intervento precedente — Cambio modulo in Anteprima non svuota più gli slot

Richiesta esplicita dell'utente: passando da un modulo all'altro (es. 4-3-3 → 4-2-3-1) i
giocatori già piazzati non vengono più cancellati — si ricollocano automaticamente nel nuovo
modulo dove il ruolo lo permette, riusando la stessa `_ruoliCompatibili()` già usata dal picker
(nessuna nuova regola R.Mantra). Nuova `_antRimappaSlotSuNuovoModulo()`
(`frontend/js/app.js`, dopo `_ruoliCompatibili`) risolve il matching bipartito
giocatori-piazzati↔slot-nuovo-modulo con l'algoritmo di Kuhn (augmenting path) — garantisce il
numero MASSIMO di giocatori riposizionabili, non solo il primo abbinamento trovato da un greedy
semplice. Chi non trova più posto torna in Panchina, mai rimosso dalla rosa.

**Verificato**: caso avversariale sintetico costruito ad hoc dove un greedy fallirebbe (1/2) e
Kuhn trova l'ottimo (2/2); scenario realistico 4-3-3→4-2-3-1 con 11 giocatori reali (10/11
riposizionati correttamente, il centrocampista in eccesso torna in panchina); reversibilità
4-2-3-1→4-3-3; nessun errore console nuovo; `node --check` superato. Diff finale minimale (52
inserimenti, 1 riga modificata) — ricostruito a mano preservando i CRLF originali del file dopo
che un primo tentativo con l'Edit tool aveva introdotto rumore di line-ending su righe non
toccate (rischio già noto per questo file, vedi `DECISIONS.md`).

## Foto giocatori — set completo sostituito e verificato al 100%

Sostituite tutte le 515 foto in `frontend/img/players/<Squadra>/`, nuovo
`frontend/data/player_photos_index.json` (formato "Cognome.jpg"/"Cognome_Iniz..jpg", già
compatibile con il matching esistente), svuotato `player_name_overrides.json` (le 439 eccezioni
vecchie puntavano a file non più esistenti). Verificato al 100% (515/515) contro il Listino
Ufficiale completo fornito dall'utente — trovati e corretti 4 casi di foto archiviata sotto la
squadra sbagliata (Frattesi, Piccoli, Pellegrino M., Kristensen T.) con eccezioni mirate in
`player_name_overrides.json`, senza spostare file.

## Cambi ereditati da GitHub (costruiti con un altro strumento, non verificati in profondità da questa sessione)

- **Campo Anteprima 3D**: blocco CSS in coda a `style.css` (`perspective` sullo stage, campo
  `rotateX(48deg)`, carte `rotateX(-48deg) translateZ`), stadio 3D `ant-stadio-3d` via Three.js
  globale.
- **Foto giocatore in Asta**: avatar più alti (rapporto portrait), `object-fit:contain`.
- **Svincolati mobile**: con Strategia attiva il nome non collassa più.

## Tasks pendenti

- **Verificare dal vivo in un'asta di test reale** l'intero stack attuale (mai testato end-to-end
  dopo la sincronizzazione con GitHub): stadio 3D, carta Puja, cambio modulo con ricollocamento
  automatico, foto giocatori nuove.
- Confermare con l'utente se correggere l'identità git dei commit di questa sessione.

## Prossimo passo

Aprire un'asta di test reale (idealmente con 2+ dispositivi) e verificare in ordine: stadio 3D
Anteprima, cambio modulo con ricollocamento automatico, foto giocatori sulle carte reali.
