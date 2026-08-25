# SESSION_SUMMARY.md

Stato corrente del progetto. Questo file è **memoria di lavoro, non storico**: va sovrascritto,
non accumulato. La cronologia sta in `git log`, il *perché* delle scelte in
[DECISIONS.md](../DECISIONS.md), stack e convenzioni in [PROJECT.md](../PROJECT.md).

## Stato attuale

Branch di lavoro `claude/arcade-mode-visual-mock-soytgj` (non ancora unito a `main`): contiene il
**quarto tema, "Sala Giochi"**, e il mockup da cui e' nato. Su Hostinger il deploy e' automatico al
push su `main`, quindi finche' resta su questo branch non e' online.

**Quattro temi attivi**, tutti con lo stesso pattern (ruoli `--sc-*` in `tema-serata.css` + token
base in `style.css`, entrambi con un blocco `[data-tema="<id>"]`, + una sezione "materie" in fondo a
`tema-serata.css`; una riga in `TEMI` in `app.js` e, se la clessidra resta visibile, una voce in
`MATERIALI` di `clessidra.js`):

- **`serata`** (scuro, default) — lampada ambra su sala scura.
- **`cuoio`** (chiaro, caldo) — banco di cuoio e pergamena, foto reali; verde bosco SOLO per le
  cifre di credito.
- **`lavagna`** (scuro) — lavagna nera e gesso, cornice in ottone, ciano = struttura, magenta =
  brand + denaro.
- **`sala-giochi`** (chiaro, freddo) — cabinato anni '90: carta bianca a retino, inchiostro spesso,
  ombre dure (`6px 6px 0`, mai sfocate), font a pixel. Cobalto = accento strutturale, oro gettone =
  solo denaro, ciliegia = allarme **e** tasto RILANCIA (unica deroga alla regola "rosso = solo
  stato", vedi DECISIONS.md). Nessuna immagine nuova: tutto in gradienti CSS.

L'attributo e' `data-tema="<id>"` su `<html>`, il selettore e' il menu 🎨 (`.tema-picker*`, regole
scritte solo su token base, quindi valgono anche per i temi futuri). I token globali di `style.css`
cascano da soli su Home, Lobby, Strategie, Editor Fasce, Anteprima e Griglia P/A per tutti e quattro
i temi, senza regole per schermata.

**Due promemoria operativi che non scadono:**

1. **Se un colore "non torna" in NESSUN tema, controllare prima la tabella Supabase
   `theme_overrides`** (riga `id='default'`), non la cache ne' il tema: un "Editor Visuale di Stile"
   nascosto (`?editor=CHIAVE`, `backend/server.js` ~1837-1866) salva override CSS globali per tutti
   gli utenti, iniettati dopo entrambi i fogli. Gia' successo una volta (bottoni viola, 2026-08-05),
   svuotata con `update theme_overrides set styles='{}' where id='default'`.
2. **Per usare una foto vera** (non un'imitazione CSS) serve che sia l'utente a salvarla su disco e
   dire il nome del file: nessun tool di Claude Code puo' esportare un'immagine incollata in chat.
   Poi si copia in `frontend/img/backgrounds/` e si referenzia con `url(...)` + `?v=N` manuale.

Per portare online o tornare indietro: **[docs/DEPLOY_TEMA.md](DEPLOY_TEMA.md)** — attenzione, e'
fermo al vecchio toggle binario chiaro/scuro e alla palette chiara precedente, va riscritto per i
quattro temi prima del prossimo deploy importante.

## Cambi recenti

- **Quarto tema "Sala Giochi" (chiaro, da cabinato), dal mockup approvato all'implementazione.**
  Richiesto come "modo chiaro stile arcade": prima un mockup visuale
  ([docs/mockup-tema-sala-giochi.html](mockup-tema-sala-giochi.html) — la sola schermata d'asta,
  desktop e mobile, nei due stati), poi il tema vero. Cinque file toccati, nessuna riga degli altri
  tre temi modificata: `app.js` (una riga in `TEMI`), `style.css` (token base + testata/avatar/
  strategie), `tema-serata.css` (ruoli `--sc-*` + sezione "materie" in fondo), `clessidra.js`
  (materiali: cornice cobalto, sabbia oro), `index.html` (i due font a pixel + `?v=` nuovi su tutti
  e quattro i file).
  Le decisioni non ovvie (rosso anche sull'azione, oro con due valori diversi per fondo e testo,
  nome del giocatore NON a pixel, ombre solide invece che sfocate) sono in
  [DECISIONS.md](../DECISIONS.md).
  **Secondo giro, dopo il deploy** (segnalazioni dell'utente sul sito vero): coperti i tre punti
  che nessun tema aveva mai toccato — la cassa decisioni dell'Admin (`.admin-conferma-box`, fondo
  scuro fisso: **stesso bug in Cuoio**, corretto anche li'), `#mio-panel` in vista Admin, e tutta
  la vista "campo 3D" dell'Anteprima (scena, prato, righe SVG, slot, carte, sotto-tab, picker):
  ora e' un campo piatto a 16 bit con cornice d'inchiostro, niente neon.
  **Verificato**: contrasto via script su 18 coppie (tutte >=4.5:1 dopo due correzioni), e resa in
  Chromium headless leggendo `getComputedStyle` (non il CSS a occhio) in vista Partecipante, Admin
  e Anteprima, stato normale e `puja-urgente`, a 1440x900 e 390x844, confrontato con
  `serata`/`cuoio`. **Non verificato**: asta vera, modali, Griglia P/A, Strategie.
  **Nota**: la vista "campo 3D" resta al neon in `serata` e `cuoio` — nessun tema la copriva prima,
  ora la copre solo `sala-giochi`.

- **Autorellenar sceglieva i PEGGIORI, non i migliori — bug reale nel valore di riferimento.**
  Segnalato dall'utente subito dopo il rilascio del punto sotto. Causa: l'algoritmo confrontava
  solo `g.fm`, ma FM e' un campo opzionale (dipende dalla colonna nel file caricato) — quando
  manca su quasi tutti i giocatori, il confronto e' sempre un pareggio a `-Infinity` e vince
  semplicemente il primo della lista, non il migliore. **Sostituito con una catena di priorita'**
  (`_antValoreRiferimento()`, richiesta esplicita e chiarita dall'utente in piu' passate):
  `quotazione` (QUOT.) prima di tutto se presente, poi `valore` (Valore Algoritmico, dal JSON),
  poi `fm`, poi `mv` — mai `prezzo`/`costo` (scartato esplicitamente dall'utente: quanto pagato
  in asta dipende da troppi fattori estranei alla qualita' del giocatore). 0/null/non numerico
  sempre trattati come "assente", mai come valore basso reale.
  **Gap trovato e chiuso di rimando**: il secondo importatore Excel (roster di una lega esistente,
  usato per avviare un'asta di riparazione — diverso dal Listino Ufficiale) non cercava affatto
  una colonna QUOT./Quotazione, a differenza del primo — aggiunta con lo stesso alias-matching
  gia' in uso altrove.
  **Svincolati**: gia' mostra "Quot." in automatico appena `g.quotazione` e' presente, da
  qualunque fonte (verificato con dati sintetici, nessun cambio necessario li').
  **Nota per l'utente**: se importa un JSON generato da uno strumento esterno, il campo deve
  chiamarsi esattamente `quotazione` (minuscolo) per ogni giocatore — l'upload diretto di JSON
  non fa alcun mapping di alias di colonna come invece fa l'Excel.
- **Anteprima: drag & drop + "Autorellenar" (miglior 11 per FMV), richiesta esplicita
  dell'utente con specifica dettagliata.** Nuove funzioni in `app.js`, nessuna esistente
  toccata nella logica:
  - **Drag & drop** (`_antSetupDragDrop`/`_antGestisciDrop`/`_antGestisciDropInPanchina`,
    richiamate da `renderAnteprimaPitch()`): alternativa al click esistente su
    `_antOpenPicker` (mai toccato, eventi diversi — dragstart/dragover/drop vs click — nessun
    conflitto, un drag nativo non fa scattare click dopo il drop). Panchina→campo,
    campo→panchina (rimuove), campo→campo (sposta, o scambia se lo slot d'arrivo e' occupato
    — solo se l'occupante e' a sua volta compatibile con lo slot di partenza, altrimenti
    l'intero scambio e' annullato: mai un ruolo scorretto piazzato per far posto). Riusa
    `_ruoliCompatibili()` gia' esistente per la validazione. Carte draggable via
    `draggable="true"` in `_antCardHTML` (esclusa la carta 'xl' del clone volante
    dell'animazione assegnazione). Feedback visivo in `style.css`
    (`.dragging`/`.drag-over`, generico/theme-agnostic).
  - **Autorellenar** (`_antAutoRiempi`, bottone `#ant-autofill-btn` accanto a Reset): riempie
    SOLO gli slot vuoti (mai quelli piazzati a mano), ricalcolando sempre da zero sulla
    Panchina attuale (idempotente — due click senza cambi alla rosa non spostano nulla).
    Algoritmo chiarito a fondo dall'utente in due passate: processa le "linee" del campo dalla
    piu' difensiva alla piu' offensiva — `P → (DS/DC/B/DD) → M → (C/E) → (W/T) → (A/PC)`
    (`ANT_LINEE_ORDINE`/`_antLineaIndex`, indipendente dalle righe di
    `ANTEPRIMA_FORMAZIONI`, che mischiano piu' linee sulla stessa riga visiva, es. `M/C`).
    Per ogni linea, assegna ripetutamente il paio (slot vuoto, giocatore compatibile) di FMV
    (`g.fm`) piu' alto fino a esaurire slot o candidati di quella linea. Un giocatore
    multi-ruolo (es. `DD/E`) viene cosi' "conteso" per primo sugli slot della sua linea piu'
    difensiva — se non e' il migliore li', resta disponibile per una linea piu' avanzata.
    Verificato con roster sintetico (incluso un caso DD/E) che il risultato combacia esattamente
    col comportamento atteso, passo per passo.
  - **Errore di tooling ripetuto durante l'implementazione**: modifiche fatte con l'Edit tool
    standard su `app.js`/`index.html` invece dello script Python (vietato, righe LF-only
    preesistenti — vedi PROJECT.md) — rilevato dal conteggio LF-only sceso a 0, corretto con
    `git stash` di entrambi i file + riapplicazione degli stessi 7 cambi via script,
    stavolta rilevando per ciascun punto lo stile di fine riga REALE del punto d'inserimento
    (non assumendolo uniforme: una parte di `app.js`, dentro le funzioni tridimensionali dello
    stadio, e' essa stessa LF-only anziche' CRLF). **Lezione aggiuntiva**: non basta sapere
    "questo file e' nella lista dei 3 pericolosi", bisogna anche verificare lo stile ESATTO
    del punto preciso in cui si inserisce, non assumerlo uniforme in tutto il file.
  - Verificato nei 3 temi: selezione a click intatta, drag nelle 4 combinazioni (banco→campo,
    campo→banco, sposta, scambio valido/rifiutato), autorellenar idempotente, nessun errore
    console.
- **Correzione del punto sopra: l'utente ha chiarito che il problema era in vista UTENTE
  (Partecipante/allenatore), non Admin — "PERO ES EN LA VISTA UTENTE, TIENEN QUE SALIR
  DESPLEGADOS, SI EL ENTRENADOR QUIERE YA LO ENCOJE EL".** Aggiunto lo stesso accordion anche
  li' (stesso meccanismo/classe `acc-open`), ma **al contrario**: default sempre espanso (come
  oggi), l'allenatore lo stringe lui se vuole — non parte mai chiuso. Stessa classe `acc-open`
  ma significato invertito rispetto ad Admin/mobile (li' vuol dire "aperto", qui "l'utente lo ha
  chiuso") — commentato a dovere nel CSS per non confondere in futuro. **Bug trovato durante
  l'implementazione**: `#mio-panel` in vista Partecipante ha una regola separata
  (`html body.layout-partecipante .asta-row-panels > #mio-panel`, la "vetrina" della carta) con
  `min-height:220px !important` — e min-height vince sempre su max-height quando confliggono,
  quindi il pannello non si chiudeva mai sotto 220px finche' non si e' azzerato anche
  `min-height` nella regola di chiusura. Verificato nei 3 temi, apri/chiudi funzionante,
  `.panel-budget` (senza questo min-height concorrente) non ne aveva bisogno.
- **Riepilogo squadre e Mio team, collassabili anche su desktop in vista Admin.** L'utente ha
  segnalato che occupavano troppo spazio verticale, lasciando le tab sotto (Storico/Rose/
  Svincolati/Griglia P/A/Anteprima) a malapena raggiungibili senza scroll. Esisteva gia' un
  accordion identico per mobile (`setupAstaMobileAccordion()` in `app.js`, handler di click gia'
  agganciati SEMPRE, non solo sotto i 640px — leggeva un commento che diceva "su desktop questa
  classe non ha alcun effetto visivo", vero solo perche' mancava la CSS, non l'handler). Aggiunto
  lo stesso meccanismo (stessa classe `acc-open`, stesso trigger) anche `@media (min-width:641px)`
  scoped a `body.layout-admin`: default chiuso (44px, solo header) per `.panel-budget` e
  `#mio-panel`, tap sull'header per espandere. **Non tocca `#admin-panel`** (ha i controlli
  Backup/Termina dell'Admin, devono restare sempre visibili) ne' la vista Partecipante (nessuna
  lamentela li', nessuna regola aggiunta). Verificato nei 3 temi, click di apertura/chiusura,
  `#admin-panel` e vista Partecipante confermati invariati.
- **Bug di logica (non tema): l'asta proseguiva mentre una squadra aveva uno svincolo/decisione
  pendente.** Segnalato dall'utente: nel popup "Svincola giocatori", il bottone NASCONDI chiude
  solo la vista (comportamento voluto, per poter controllare "Svincolati" e tornare — vedi
  `nascondiSvincolo`/`riprendiSvincolo` in `app.js`), ma l'Admin poteva comunque estrarre/chiamare
  altri giocatori nel frattempo — mai dovrebbe essere possibile finché quella squadra (o l'Admin
  per conto suo) non risolve. Causa: `estrai-giocatore`/`chiama-giocatore`/`assegna-manuale`
  (`backend/server.js`) controllavano solo `asta.chiamataAttuale` (rilancio in corso), non
  `asta.popupAttivo` (svincolo O plusvalenza/recompra pendenti — entrambi mettono
  `chiamataAttuale` a `null`). Aggiunto lo stesso controllo ai tre handler. Dettagli e perché non
  serve un override separato in [DECISIONS.md](../DECISIONS.md). Verificato solo staticamente
  (`node --check`) e leggendo i punti di clear di `popupAttivo` — **non testato end-to-end con
  2 client reali** (limite noto di tutte le sessioni, nessuna asta di test disponibile).
- **Bug grave: il nome del giocatore andava a capo lettera per lettera (o spariva del
  tutto) in vista Admin con Anteprima aperta e nomi lunghi (es. "KOUTSOUPIAS")** —
  segnalato dall'utente con screenshot reale, "esto NUNCA puede pasar". Due cause
  distinte, entrambe in `tema-serata.css`, trovate misurando (non a occhio) larghezza
  reale della colonna via `getBoundingClientRect`/`getComputedStyle` a piu' finestre:
  1) **`.cc-nome` usava `vw` (viewport) invece di `cqw` (container)** in tre punti —
     `html body #puja-panel-slot .cc-nome` (2 varianti, righe ~203 e ~1329) e
     `html body.layout-admin .asta-row-puja .cc-nome` (riga ~1345). Con Anteprima
     aperta la FINESTRA non cambia ma la COLONNA si dimezza: il font restava enorme
     (fino a 2.2rem fissi) in uno spazio ormai stretto, e (con `white-space:normal`
     per permettere nomi lunghi su piu' righe) il browser andava a capo lettera per
     lettera per starci. Il container "sala" (`#asta-main-col{container-type:inline-size}`)
     esisteva gia' ed e' usato correttamente altrove (i tre scalini `@container sala`
     per la vista Partecipante) — mancava solo su questi tre punti rimasti a `vw`.
     Passati tutti a `cqw`, e per Admin anche `white-space:nowrap+ellipsis` (come tutte
     le ALTRE regole `.cc-nome` di Admin, mai state a rischio — questa era l'unica
     eccezione con `white-space:normal` senza una vera gestione multi-riga sotto).
  2) **`.cc-header` (badge+nome+meta) era l'unico figlio shrinkabile di `.chiamata-card`**
     (colonna flex, `flex:1 1 auto` da `style.css`): quando testo/badge non ci stavano
     piu' nell'altezza della carta, era lui a farsi schiacciare fino a ~4px — il nome
     (dentro) spariva del tutto, ritagliato a una sottile riga. Aggiunto
     `flex-shrink:0;min-height:32px` su `html body.layout-admin .asta-row-puja
     .cc-header` cosi' e' la carta (height:auto, non height-capped) a crescere se serve
     piu' spazio, non il nome a sparire.
  Verificato nei 3 temi, vista Admin, larghezze 700/1050/1300/1990px, con/senza
  Anteprima aperta: il nome resta sempre leggibile su una riga (troncato con "…" se
  davvero non c'e' posto, mai a capo lettera per lettera). **Nota per il prossimo
  intervento su `.cc-nome`/`#asta-main-col`**: qualunque nuova regola di font-size
  scoped a `#puja-panel-slot`/`.asta-row-puja` deve usare `cqw`, mai `vw` — e' facile
  sbagliare copiando una regola vicina.
- **Nome di chi offre (`.cc-offerente`) e "In attesa 1ª offerta..." (`.chiamata-stato`)
  ingranditi ovunque**: l'utente ha segnalato che non si leggeva bene. Trovata via
  `getComputedStyle` (non a occhio, tra le ~15 regole `font-size` sparse su `.cc-offerente` nei
  due file — stesso "debito tecnico" gia' noto, vedi sezione omonima piu' sotto) quali regole
  vincono DAVVERO la cascata nei 4 contesti (Partecipante/Admin × largo/stretto): la maggior
  parte delle regole in `style.css` era **morta** (classi, mai vincenti contro l'id
  `#puja-panel-slot` di `tema-serata.css` che ha sempre la meglio quando il layout e'
  Partecipante). Alzate le 2 regole vincenti per Partecipante in `tema-serata.css`
  (`.72rem`→`.95rem` normale, `.68rem`→`.85rem` sotto i 900px) e le regole vincenti per Admin in
  `style.css` (`.76rem`→`.95rem` largo, `.62rem`→`.78rem` e `.52rem`→`.68rem` nei due breakpoint
  stretti, `.78rem`→`.92rem` sotto i 640px — quest'ultima condivisa con `.cc-meta`, **separata**
  in due regole per non ingrandire anche quella, non richiesta). Le altre gia' morte sono state
  comunque alzate per coerenza (nessun effetto visivo, ma se in futuro cambia la cascata non
  regrediscono a valori minuscoli). Verificato nei 4 contesti via `getComputedStyle` +
  screenshot, nessuna regressione nei 3 temi (regole non scoped per tema).
- **Foto della lavagna sostituita con una piu' nitida — e bug di cache-busting sulle immagini,
  non solo su CSS/JS, scoperto qui.** L'utente ha detto che la prima (`pizarra.jpeg`) era
  sfocata — sostituita con `lavagna.jpeg` fornita dall'utente, stesso nome di file nel progetto
  (`pizarra-lavagna.jpeg`). Dopo il deploy l'utente continuava a vedere la foto vecchia: causa
  reale, non la solita cache CDN generica, ma `cache-control: public, max-age=2592000, immutable`
  su Hostinger per le immagini statiche — un browser che ha gia' scaricato l'URL una volta non
  la richiede piu' per 30 giorni, **nemmeno con hard refresh**, perche' `immutable` dice al
  browser di non rivalidare mai entro il max-age. La convenzione `?v=` di questo progetto
  (PROJECT.md) copriva solo i `<link>`/`<script>` in `index.html`, non i `url(...)` dentro i CSS:
  aggiunta la stessa tecnica li', **`?v=N` manuale sulle 3 foto vere** (`pizarra-lavagna.jpeg?v=2`,
  `pelota-cuoio.jpeg?v=1`, `fondo-cuoio.jpeg?v=1` — 4 punti in `tema-serata.css`/`style.css`,
  vedi grep `pizarra-lavagna\|pelota-cuoio\|fondo-cuoio` in entrambi i file per trovarli tutti).
  **Se in futuro si sostituisce di nuovo una di queste foto (stesso nome file)**: alzare il
  numero dopo `?v=` in OGNI punto dove compare quel file, altrimenti il bug si ripete identico.
- **Tolto il pallone piccolo dentro la carta di chiamata (Cuoio)**: l'utente ha detto che
  "queda mal" li' dentro — rimossa `html[data-tema="cuoio"] .chiamata-card::after` (`style.css`),
  nessuna regola generica sotto da far riemergere (era l'unico `::after` di quel tema).
  Resta il pallone grande sullo sfondo di pagina (`.pitch-bg::after`, angolo, fuori dalla carta) —
  non menzionato dall'utente, non toccato.
- **Sfondo di pagina Cuoio: anche questo ora e' una foto vera.** L'utente ha fornito una terza
  foto (pergamena con impronte di pallone sbiadite, `fondoCuero.jpeg` → salvata come
  `frontend/img/backgrounds/fondo-cuoio.jpeg`). Sostituiva la vecchia `fantabar-bg.jpg` (foto
  del bar, resa "pergamena" solo con `filter:saturate(.22) sepia(.12)...` a mano) nella regola
  che vince davvero la cascata per `.pitch-bg` in Cuoio (`tema-serata.css`, non l'omonima in
  `style.css` — stesso file/riga gia' noti da regressioni precedenti). Tolti i filtri, restano
  solo due bagliori radiali leggeri sopra la foto. Verificato: texture visibile nei margini
  attorno alle carte a finestra larga, Lavagna/Serata non toccati (controllato lo stesso
  screenshot per errore — la vista non cambiava perche' lo screenshot del browser di test era
  in ritardo di un frame, confermato invece corretto via `getComputedStyle` prima di riprovare).
- **Pallone Cuoio e lavagna Lavagna: da disegno CSS a foto reale.** L'utente ha confrontato
  l'ultimo tentativo (un SVG fatto a mano, gradiente sferico + cuciture a gajos, tecnica
  `feTurbulence` gia' usata per la sabbia della clessidra) con la foto vera e ha chiesto di
  usare quella, non un'imitazione — vedi "Novità" sopra in "Stato attuale" per come si sono
  ottenuti i file. Cambiato **solo** `background-image` nelle regole gia' esistenti (nessuna
  nuova regola): `html[data-tema="cuoio"] .pitch-bg::after`/`.chiamata-card::after` (`style.css`)
  ora puntano a `url("../img/backgrounds/pelota-cuoio.jpeg")` dentro un cerchio (`border-radius:
  50%` — il browser ritaglia lo sfondo alla forma arrotondata, quindi gli angoli bianchi della
  foto originale non si vedono; niente `clip-path` necessario), zoomata e posizionata
  (`background-size:160% 160%; background-position:50% 40%`) per inquadrare solo la palla,
  senza il riflesso in basso nella foto originale. `html[data-tema="lavagna"] .pitch-bg` e
  `#puja-panel-slot` (tutti gli stati, incluso `data-fase="finale"`) in `tema-serata.css` ora
  usano `url("../img/backgrounds/pizarra-lavagna.jpeg")` con `background-size:cover`, sopra solo
  due bagliori radiali ciano/magenta e una vignetta scura ai bordi — tolti tutti gli strati
  CSS a mano (bande diagonali, macchie, pallini di grana) delle passate precedenti, non piu'
  necessari. **Bug trovato subito dopo dall'utente**: `.chiamata-card` (dove stanno foto/nome
  del giocatore) aveva un `background` proprio, opaco, sopra `#puja-panel-slot` — la foto della
  lavagna sul pannello restava coperta esattamente dove serviva vederla di piu'. Aggiunta la
  stessa foto anche su `html[data-tema="lavagna"] .chiamata-card` (con un velo scuro sopra per
  la leggibilita' del testo). **Errore di tooling durante il fix**: un'edit su `style.css` e'
  passata per sbaglio dall'Edit tool standard invece dello script Python (vietato, righe LF-only
  preesistenti) — rilevato subito (conteggio LF-only sceso da 210 a 0), risolto con `git stash`
  (che ha ripristinato la versione pulita dell'ultimo commit) e poi ririapplicando via script sia
  questo fix sia le due modifiche precedenti (foto pallone) sulla stessa base pulita — nessun
  lavoro perso. Verificato nei 3 temi con dati sintetici (nessun'asta reale disponibile, limite
  noto), nessun errore console, foto caricate con 200 OK.
- **Lavagna, quinta passata: texture ridisegnata su foto di riferimento reale fornita
  dall'utente** (una lavagna vera, con le sbavature ampie e direzionali del cancellino e una
  grana fitta e irregolare — non nuvole rotonde, non un pattern che ripete). Nuova ricetta
  applicata a `.pitch-bg`, `#puja-panel-slot` (tutti gli stati) e
  `.panel-budget`/`#mio-panel`/`.admin-panel`/`.tabs-panel`: 2-3 bande diagonali UNICHE (non
  ripetute, ognuna con angolo/ampiezza propria — cosi' non si leggono come un motivo), 2-3
  macchie di tono ampie e irregolari (chiare E scure, non solo chiare), grana fine piu' fitta
  (6 tile invece di 3-5). Cuoio non toccato.
- **Lavagna, quarta passata: tolte le righe diagonali ripetute**. L'utente ha segnalato che il
  `repeating-linear-gradient` diagonale (pensato per imitare i segni del cancellino) all'opacità
  alzata nel giro precedente si leggeva come un tessuto/pattern regolare, non come lavagna —
  tolto ovunque in Lavagna (`.pitch-bg`, `.panel-budget`/`.admin-panel`/`.tabs-panel`,
  `#puja-panel-slot`, stato finale), tenute solo le nuvole di sbavatura organiche
  (radial-gradient) e la polvere fine. Cuoio non toccato (nessuna lamentela, li' allo stesso
  livello resta leggibile perché il fondo e' chiaro).
- **Lavagna, terza passata: tutti i fregi dentro la carta di puja, non solo sullo sfondo**.
  L'utente ha chiarito che voleva vedere texture/cancellino/cocktail/scintilla proprio dove
  sta la foto/il nome del giocatore in puja, non genericamente sulla pagina. Texture di
  `#puja-panel-slot` alzata ancora (nuvole piu' grandi, fondo un filo piu' chiaro #181B21
  invece di #111318 — sul nero pieno anche le sbavature chiare restavano poco leggibili).
  Cancellino+scintilla spostati dentro `.chiamata-card::after` (un solo pseudo-elemento esteso
  a tutta la carta, due fregi come layer di sfondo separati, niente clip-path li' perche'
  taglierebbe l'intero pseudo-elemento). Bicchiere da cocktail su `.chiamata-card::before`,
  che nel foglio storico era gia' usato (la linea animata in cima) ma disattivato con
  `display:none` da un'altra regola con `#puja-panel-slot` (ID): serviva un selettore con lo
  stesso ID per avere abbastanza specificita', un normale `.puja-panel-slot` (classe) non
  bastava — stesso tipo di bug di specificita' del punto sotto, trovato con la stessa tecnica
  (`document.styleSheets`/`cssRules`). **Errore di tooling durante l'implementazione**: un
  primo tentativo ha usato per sbaglio l'Edit tool standard su `style.css` (vietato, ha righe
  LF-only preesistenti) invece dello script Python — rilevato subito confrontando il conteggio
  di righe LF-only (era sceso a 0), corretto con `git checkout` di ripristino + ripetizione via
  script. **Lezione ripetuta da altre sessioni**: controllare SEMPRE il conteggio LF-only prima
  di editare questi 3 file, non fidarsi della memoria di "quale tool ho usato l'ultima volta".
- **Lavagna: bug reale di specificita' CSS trovato, texture/cancellino/cocktail/scintilla
  aggiunti**. L'utente ha segnalato che la texture "polvere di gesso" non si vedeva nella carta
  di puja nonostante il codice ci fosse: causa reale (non a occhio, isolata con
  `document.styleSheets`/`cssRules` in browser) — una regola piu' vecchia
  (`body.layout-partecipante #puja-panel-slot, body #puja-panel-slot{background:...}`, versione
  povera a 3 layer) batteva quella nuova per SPECIFICITA' (il branch `.layout-partecipante` ha
  una classe in piu'), non per ordine — capitava in vista Partecipante, non Admin, e lo stesso
  bug esisteva identico anche in Cuoio (mai notato perche' la differenza visiva era meno
  marcata). Risolto eliminando la regola vecchia duplicata in entrambi i temi (la nuova
  copriva gia' border/box-shadow). Aggiunti anche: nuvole di sbavatura piu' grandi (non solo
  polvere fine) su `.pitch-bg` e sui pannelli; cancellino (legno+feltro) sia sullo sfondo di
  pagina sia — apposta, per essere SEMPRE visibile — dentro `.chiamata-card::after`; bicchiere
  da cocktail al neon (`.pitch-bg::after`, un solo clip-path con `filter:drop-shadow` invece di
  `box-shadow` perche' quest'ultimo non segue le forme ritagliate); scintilla al neon accanto al
  logo (`.asta-header-left::after` — non su `.asta-header-title::after`, gia' occupato dal
  "respiro" del neon). Verificato nei 3 temi, nessuna regressione.
- **Il campo di Anteprima, non solo la cornice, ridisegnato per tema**: l'utente ha fatto notare
  (due volte, con screenshot reali) che il prato restava sempre verde-neon a prescindere dal
  tema — avevo toccato solo `.ant-pitch-stage` (cornice esterna) in un giro precedente, non
  `.ant-pitch` (il prato/le linee, un'unica regola con 7 gradienti solidi + box-shadow, colore
  neon `#38FFC4` hardcoded ovunque — trovata leggendo `getComputedStyle` reale, non a occhio).
  Ora: **Cuoio** = campo vecchio, verde oliva spento, linee crema piene senza alcun glow (un
  pallone vintage, non un'insegna); **Lavagna** = non e' piu' un prato per niente, e' un
  diagramma tattico disegnato col gesso su ardesia (fondo nero con polvere di gesso, linee
  bianche, glow ciano ridotto e non verde). Stessa geometria esatta (`background-size`/
  `background-position` identici all'originale) in entrambi, cambiano solo le materie — nessun
  rischio di rompere il posizionamento delle porte/cerchio di centrocampo. `Serata` non toccato
  (nessuna lamentela, il verde-neon ci sta gia' bene in un bar di sera). **Gotcha di debug**: il
  browser di test aveva la vecchia `style.css` in cache dalla sessione (stesso `?v=` riusato per
  test multipli nello stesso pomeriggio) — il fix sembrava non funzionare finche' non si e'
  forzato un fetch fresco; ricordarsene se in futuro un cambio CSS "non si vede" durante i test
  ravvicinati nella STESSA sessione di debug (diverso dal bug di cache-busting sul deploy, gia'
  noto).
- **Cuoio, seconda passata su feedback dell'utente col mockup alla mano**: (1) pallone di sfondo
  ridisegnato con le stringhe incrociate (prima solo una cucitura dritta); (2) stessa eco del
  pallone, in piccolo e a bassa opacità, dentro `.chiamata-card::after` — non solo sullo sfondo;
  (3) cornice CUCITA sui ritratti (`.cc-avatar` e `.ant-card`): la prima versione aveva due anelli
  pieni, mancava la cucitura a vista del mockup — aggiunta con `outline:dashed` (proprietà separata
  da `border`, non consuma i due pseudo-elementi `::before`/`::after` già usati per il riflesso),
  fascia di cuoio allargata apposta per fargli spazio. Verificato: dashed assente su `serata`
  (`outline:none`), nessun errore console.
- **Pallone di cuoio decorativo in Cuoio** (`.pitch-bg::after`, riquesta esplicita dell'utente
  col mockup "PuntBar" alla mano): fregio in un angolo dello sfondo, disegnato solo in CSS
  (nessun asset nuovo), non dentro la carta di chiamata — nel mockup il pallone compare solo nel
  pannello vetrina, non nella UI reale, per non affollare una carta già densa di numeri.
  Verificato: visibile solo su `cuoio`, assente su `serata`/`lavagna`.
- **Rifinitura texture lavagna + Anteprima, su feedback diretto dell'utente col mockup alla
  mano**: la grana "polvere di gesso" era tarata come quella di Cuoio (opacità .007-.03), pensata
  per un fondo chiaro — sul nero era quasi invisibile, la lavagna sembrava plastica scura invece
  che ardesia. Opacità alzate 3-4× + aggiunti pallini di polvere (radial-gradient a tile) su
  `#puja-panel-slot`/`.panel-budget`/`.admin-panel`/`.tabs-panel`, stessa tecnica di `.pitch-bg`.
  Trovato e sistemato un secondo glow viola hardcoded, stavolta su `.ant-slot3d-empty` (stessa
  causa di `.ant-pitch-stage` sopra — riga isolata tra le ~10 duplicate col cascade-winner
  verificato). Verificato nei 3 temi, nessuna regressione.
- **Orologio, texture e Anteprima specifici per tema** (rifinitura sul lavoro sotto). La
  clessidra usava materiali hardcoded nell'SVG (`clessidra.js`, gradienti `stop-color` fissi):
  nessuna variabile CSS puo' capovolgerli, quindi aggiunto `MATERIALI` (serata=ottone/ambra
  originale, cuoio=ottone scuro/sabbia cuoio) applicato via JS a `#cls-ottone`/`#cls-sabbia`, con
  un `MutationObserver` su `data-tema` per seguire i cambi di tema a caldo. Per **lavagna** niente
  clessidra: torna visibile il vecchio anello SVG originale (`#timer-progress`, gia' nel DOM,
  nascosto negli altri due temi) ritinto ciano→magenta via `#timer-grad-start/end` — un
  meccanismo diverso apposta (richiesta esplicita dell'utente), non solo un ricolorito.
  **Texture lavagna**: `.pitch-bg` mostrava ancora la foto del bar scurita invece di una vera
  lavagna — sostituita con nero pieno + polvere di gesso (radial-gradient a tile multipli, stessa
  tecnica della pergamena Cuoio) e zero `url(...)`. **Anteprima**: trovato un bordo/glow viola
  hardcoded (`rgba(115,105,255,.55)`, mai migrato dalla vecchia identita' "FantaBar Pulse")
  sull'unica regola `.ant-pitch-stage` che vince davvero la cascata (verificato via
  `getComputedStyle`, non a occhio, tra le ~10 regole `.ant-pitch-stage` sparse nel file) —
  sostituito con `var(--sc-ambra-piena)`/`rgba(var(--sc-ambra),...)`, che essendo variabili
  globali già corrette per tema si sistemano da sole nei 3 temi con una riga sola, nessuna regola
  per-tema aggiuntiva. Il resto della chrome di Anteprima (RESET, toggle Vista, drawer, zoom) era
  già correttamente su token generici — non serviva altro. Verificato nei 3 temi, desktop e
  mobile, nessun errore console.
- **Selettore multi-tema + terzo tema "Lavagna al Neon"** (architettura descritta sopra in "Stato
  attuale"). Verificato via script di contrasto (tutte le coppie chiave del nuovo tema ≥5.3:1,
  margine ampio) e nel browser con dati sintetici (stesso metodo del punto sotto): menu a tendina
  funzionante nei 3 temi, vista Partecipante/Admin desktop e mobile (375px) per Lavagna, `serata`
  e `cuoio` ricontrollati invariati dopo il refactor del selettore, preferenza persistita dopo
  reload. **Da fare prima del prossimo push**: aggiornare `?v=` cache-busting (vedi sotto — questa
  volta già incluso nel lavoro, non dimenticare comunque di ricontrollarlo prima di committere se
  si continua a toccare questi file). **Non verificato** (stesso limite di sempre): asta reale,
  Anteprima/Griglia P/A/modali col nuovo tema.
- **Tema chiaro "Cuoio"** (mockup utente "PuntBar"): sostituisce interamente il vecchio "Mattina
  al banco" (bianco/argento/ottone). Cuoio scuro per testata/cornici anche a pagina chiara,
  pergamena per i piani, verde bosco riservato SOLO al denaro (`.cc-offerta`/`.sq-crediti`),
  `.cc-avatar` da cerchio a cornice smussata (solo bordo/forma, dimensioni invariate — vedi "Carta
  XL animazione" sotto, stesso vincolo). Contrasto verificato via script, tutte le coppie ≥4.9:1.
  **Non verificato**: Anteprima con giocatori reali sul campo, Griglia P/A, modali con dati veri.
- **Fix cache-busting dimenticato dopo "Cuoio"**: il commit del redesign non aveva aggiornato `?v=`
  di `style.css`/`tema-serata.css` in `index.html` (convenzione del progetto, vedi PROJECT.md) —
  browser/CDN potevano continuare a servire il CSS precedente sotto la stessa URL, con residui
  visivi del tema viola pre-Serata d'Asta ancora in cache. Se in futuro un cambio a un file statico
  "non si vede" dopo il deploy, controllare per primo questo.
- **Bug preesistente scoperto e corretto** (non introdotto da questi cambi): `html body .card` in
  `tema-serata.css` aveva un gradiente scuro hardcoded senza scoping per tema — le card di
  Home/Login/Lobby/Fine asta restavano scure anche nel vecchio tema chiaro. Corretto aggiungendo
  l'override mancante per tema chiaro accanto alle altre regole "Porta d'ingresso".

- **Vista partecipante con Anteprima aperta — reflow vero.** Anteprima è una colonna sorella
  di `.asta-main-col`: aprendola la finestra non cambia, si dimezza la colonna, e tutti gli
  `@media` sulla viewport restavano fermi. La causa di fondo non era CSS:
  `forzaVisibilitaRilancioMobile()` scrive stili **inline `!important`** decidendo su
  `window.innerWidth`, e un inline `!important` non lo batte nessuna regola. Ora guarda anche
  la larghezza reale della colonna (soglia sulla finestra invariata, si aggiunge "colonna
  ≤900") e `_antToggleDrawer()` la richiama. Le proporzioni sono `@container` su
  `.asta-main-col`, con scalini a 1200/900/620px.
- **Le tab non sono più un avanzo.** Ricevevano quello che restava: 214px a 1440×900, 54px a
  1280×800. Ora hanno un minimo garantito (`clamp(420px,46vh,720px)`) e, se la finestra non
  basta, scorre la colonna.
- **Riepilogo squadre compattato**: una riga per squadra invece di due (nelle colonne strette i
  conteggi scendono su una seconda riga, non spariscono). Da ~200-240px a ~140-170px.
- **Tolta "la stanza si stringe"**: negli ultimi 5 secondi squadre, tab, conto e metà dei dati
  del giocatore sfocavano. Durante un'asta si deve poter guardare tutto sempre — i crediti dei
  rivali servono proprio in quei secondi. Restano le luci e il rosso.
- **Tema chiaro riadattato** (prima era ancora viola e coi pannelli scuri, illeggibile).
- **Bug preesistente corretto**: in vista Admin il nome del giocatore finiva sotto la
  clessidra (la carta era limitata a 420px mentre la clessidra ne prendeva 652 per mostrarne
  150).

## Debito tecnico riconosciuto (non pagato di proposito)

`style.css` difende la zona puja con ~40 regole `!important` su tutti i breakpoint, quindi
`tema-serata.css` deve vincerle con `html body #puja-panel-slot` + `!important`. Ripulirle è il
lavoro successivo naturale, tenuto fuori dagli interventi estetici per non mescolare un
refactor rischioso con un cambio di aspetto. Nello stesso giro si può togliere il blocco
`@media (min-width:901px)` in fondo a `style.css` (commit `039206b`, lavoro di un altro
strumento): è ridondante da quando il tema ridisegna la stessa zona con specificità più alta.

## Pendenze

- **Mai provato end-to-end in un'asta vera**: login Supabase, più dispositivi, modali critici
  (svincolo, conferma RIC, plusvalenza/recompra, annulla storico) con dati reali. È il limite
  noto di tutte le sessioni finora — non ci sono credenziali di test.
- Schermate Strategie, Editor Fasce e Griglia P/A: ereditano la palette ma non sono state
  guardate una per una, in nessuno dei quattro temi. L'Anteprima (campo 3D) e' stata coperta solo
  in `sala-giochi`: in `serata` e `cuoio` resta la scena al neon viola/ciano del tema base.
- [docs/DEPLOY_TEMA.md](DEPLOY_TEMA.md) descrive ancora il vecchio toggle binario e la palette
  chiara precedente — da riscrivere per i 4 temi/selettore prima del prossimo deploy importante.
- Ripristinare `.cc-strategia-info` su mobile: è l'unico `display:none` del tema che tocca
  contenuto vero e non decorazione.
- Nel tema **scuro** il grigio più tenue (`--sc-tenue`) resta a 3.4:1 su testi da 9-10px. È così
  da quando il tema è online, non è una regressione, ma si schiarisce con una riga.

## Prossimo passo

Unire il branch del tema "Sala Giochi" a `main` (il push su `main` e' anche il deploy) e poi
aprire un'asta di test reale, idealmente con 2+ dispositivi, e guardare in ordine: la schermata
asta (sera e mattina), i modali di svincolo con dati veri, e infine i comportamenti della puja
(la leva su RILANCIA).

## Regola da non dimenticare: non si nasconde informazione

Per far entrare il nome della squadra in colonne strette era stato messo un
`@container (max-width:250px){ .sq-bottom{display:none} }`: spariva la riga `Tot: n/25 🧤 🔓`.
L'utente se n'è accorto subito. Compattare il layout è legittimo, **eliminare un dato per far
spazio no**: se due informazioni non stanno su una riga, si usa una riga in più. Vale per tutta
l'app, ed è il motivo per cui ogni intervento sul layout ora finisce con un controllo che conta
i dati a schermo a ogni larghezza.
