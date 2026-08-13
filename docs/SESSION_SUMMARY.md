# SESSION_SUMMARY.md

Stato attuale del progetto. Questo file va sovrascritto ad ogni task importante — non è uno storico
(per quello c'è `git log`).

## Stato attuale

- **Deploy**: migrato da Render a **Hostinger** (dominio `asta.fantaplus.com`, deploy automatico
  su push a `main`). Render resta attivo temporaneamente come backup dell'utente. Bind esplicito
  su `0.0.0.0` in `server.listen()` applicato come misura difensiva (commit `7d32099`).
- Branch `main`, ultimo commit `af7332d` (9 correzioni post-redesign 3D Anteprima `d9fe35f` +
  round 2 di rifiniture `af7332d`, vedi sotto — **da verificare se già pushato**, vedi comando
  sotto). Migration `backend/sql/2026-08-10_strategia_titolarita_commento.sql` già eseguita
  dall'utente su Supabase.
- **Correzioni post-redesign 3D Anteprima: COMMITTATE su `main`** (commit `d9fe35f`+`af7332d`,
  `frontend/index.html`, `frontend/css/style.css`, `frontend/js/app.js` — nessun file backend
  toccato). Rispondono a 9 problemi concreti segnalati dall'utente dopo il merge del redesign in
  produzione (scroll rotto, animazione troppo veloce, carte 3D piatte/sovrapposte, stadio poco
  visibile, bug di selezione posizione, ruoli tagliati) **più un round 2** di rifiniture su
  screenshot reali dell'utente (etichette ancora sovrapposte, campo troppo semplice, spazio nero
  nella carta XL). Vedi sezione dedicata sotto — **verificate con dati simulati in locale, non
  ancora testate dal vivo dall'utente in un'asta reale**.
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

## Correzioni post-redesign 3D Anteprima (9 punti + round 2, committate `d9fe35f`)

Richiesta dell'utente dopo aver usato il redesign 3D in produzione: 9 problemi concreti di
scroll/animazione/rendering 3D/interazione, tutti risolti senza toccare logica Mantra, moduli,
regole di schieramento, logica Asta/Rose o dati esistenti (solo `frontend/`). Piano in
`/Users/alba/.claude/plans/frolicking-baking-tome.md`.

1. **Scroll verticale rotto** (Storico/Rose/Svincolati/Griglia P/A/Anteprima): causa radice —
   il wrapper `.asta-live-layout` (introdotto dal redesign per affiancare il drawer) non aveva
   `flex:1;min-height:0`, e `.asta-main-col` non era una vera colonna flex vincolata in altezza,
   rompendo la catena `min-height:0`+`overflow-y:auto` da cui dipende ogni scroll interno sotto
   `#screen-asta{height:100vh;overflow:hidden}`. Fix: 3 regole CSS (`style.css`, blocco
   `.asta-live-layout`/`.asta-main-col`).
2. **Animazione assegnazione**: durata `1100ms`→`3000ms` con una fase di "hold" al picco
   (`_playAssegnazioneCardFx()` in `app.js`). Aggiunto toggle **solo locale**
   (`localStorage['antFxAbilitata']`, default attivo) in "⚙️ Impostazioni Admin" — deciso con
   l'utente di non sincronizzarlo lato server: l'animazione è già puramente client-side, nessun
   cambio a socket/stato asta.
3. **Nome giocatore invisibile su carta in campo**: `.ant-slot3d-label` non aveva `translateZ`,
   restava sul piano del prato dietro la carta (che invece "galleggia" a `translateZ(34px)`).
   Ora condivide lo stesso piano (`translateZ(30px)`).
4. **Carte "piatte"/sovrapposte al prato**: risolto con luce/ombra interna su
   `.ant-card.on-pitch` (non toccando l'angolo/translateZ della proiezione 3D, che invece
   ingrandisce la carta a schermo e peggiora le sovrapposizioni — verificato empiricamente).
5. **Carte che si sovrappongono tra loro**: causa combinata — card a dimensione fissa (44×60px)
   indipendente dallo zoom del campo, righe con gap verticale insufficiente specie quando due
   ruoli di righe adiacenti condividono la stessa X (es. portiere/difensore centrale). Fix in due
   parti: (a) `.ant-card.size-pitch`/`.ant-slot3d-empty` ora in **`cqw`** (CSS container query
   units, `container-type:inline-size` su `.ant-pitch`) invece di px fissi, così la dimensione
   della carta resta proporzionale al campo a qualunque livello di zoom (prima le sovrapposizioni
   peggioravano molto sotto i 380px); (b) `ANT_LAYOUT` (`app.js`) riscritto con un template di
   fasce verticali (`ANT_Y5`/`ANT_Y4`, gap ~21-23%) per tutti gli 11 moduli, con piccoli
   disallineamenti X dove due righe adiacenti condividevano la stessa colonna. Verificato
   misurando `getBoundingClientRect()` di ogni carta per tutti gli 11 moduli: da overlap fino al
   45% (dimensione fissa, zoom minimo) a **residuo ~2% su 4 moduli** (solo portiere/difensore
   centrale nei moduli a 3), 0% su tutti gli altri.
6. **Ombra "linea nera"**: il box-shadow direzionale ereditato da `.ant-card` base si comprimeva
   sotto la doppia rotazione 3D in una riga nera netta. Sostituito su `.ant-card.on-pitch` con un
   rilievo leggero (inset), lasciando la vera ombra di profondità a `.ant-slot3d-shadow`
   (elemento separato, non contro-ruotato).
7. **Stadio poco visibile**: aggiunte gradinate stilizzate (`.ant-stand-l/-r`, gradiente a bassa
   opacità con mask) + un bagliore ambientale (`.ant-stand-glow`) dentro `.ant-pitch-stands`,
   mantenendo priorità visiva su campo/carte.
8. **Bug selezione posizione→posizione**: `_antCloseHandler()` (chiusura del picker al click
   fuori) era rimasto legato alla vecchia classe 2D `.ant-slot` invece della nuova `.ant-slot3d`
   del campo 3D — un click su un'altra posizione valida veniva interpretato per errore come
   "click fuori" e richiudeva il picker appena riaperto. Fix: selettore esteso a
   `.ant-slot, .ant-slot3d`. Verificato via eventi click reali (non solo chiamate dirette):
   selezione A→B→C ora funziona senza click intermedi fuori dal campo.
9. **Ruoli tagliati su slot vuoti**: sostituito il testo semplice (troncato con ellissi a 70px)
   con `_getRuoloBadgeHTML()` (già usato sulle carte piene) — ruoli compound tipo `"DC/B"`,
   `"T/A/PC"` ora mostrano badge separati su più righe invece di troncare. Effetto collaterale
   individuato e corretto in corsa: lo stesso contenitore serve anche per il NOME sulle carte
   piene, che va invece troncato su una riga sola (altrimenti nomi lunghi si sovrappongono tra
   slot adiacenti) — aggiunto uno `<span class="ant-slot3d-name-txt">` dedicato con
   `overflow:hidden;text-overflow:ellipsis` solo per quel caso.

**Verificato in locale** (browser automatizzato, stato `S.asta`/rosa iniettati via JS — nessuna
asta live disponibile in sessione): scroll interno confermato su Storico con contenuto lungo
(`scrollHeight` 1928px in un contenitore `clientHeight` 562px, `overflow-y:auto`); tutti gli 11
moduli renderizzati senza sovrapposizioni rilevanti; bug di selezione verificato con eventi click
reali end-to-end (assegnazione finisce sullo slot B, non A); toggle animazione verificato
(checkbox default `checked`, disattivandolo `_playAssegnazioneCardFx()` non crea più cloni).
**Non verificabile in questo ambiente**: aspetto reale su schermo/device fisico, animazione vista
dal vivo durante un'asta di prova reale con la Puja popolata.

**Nota tecnica**: durante la sessione, un `Edit` ha convertito l'intero `frontend/js/app.js` da
CRLF a LF (il resto del progetto usa CRLF) — individuato e corretto prima di chiudere, il diff
finale contiene solo le righe effettivamente cambiate. Attenzione a questo rischio nelle prossime
sessioni che editano quel file.

### Round 2 — rifiniture su screenshot reali dell'utente (dopo il primo push)

L'utente ha riportato 3 problemi visti in produzione (screenshot reali, non simulati):

1. **Etichette nome/ruolo ancora sovrapposte**: causa — `.ant-slot3d-label` aveva
   `max-width:64px` fisso, ma il gap minimo reale tra due slot adiacenti in `ANT_LAYOUT` è
   ~16% del campo (difesa a 3): a schermi/zoom normali 64px superava quel gap, quindi due
   etichette vicine (es. un nome lungo accanto al badge ruolo di uno slot vuoto) si
   sovrapponevano comunque nonostante il fix del round 1. Fix: `max-width` portato a **13cqw**
   (proporzionale al campo, coerente con `.size-pitch`/`.ant-slot3d-empty` già in cqw), calibrato
   con margine sul gap minimo del layout.
2. **Campo troppo semplice/non "futuristico"**: richiesta esplicita di un aspetto più moderno.
   `.ant-pitch.ant-pitch3d` riscritto con griglia neon viola/ciano sovrapposta al prato scurito,
   linea di metà campo e cerchio centrale con glow, bordo pulsante (`@keyframes
   ant-pitch-pulse`, disattivato sotto `prefers-reduced-motion`) e 4 bracket agli angoli stile
   HUD (`.ant-pitch-corner-tl/tr/bl/br`, markup iniettato in `renderAnteprimaPitch()` perché
   `#ant-pitch.innerHTML` viene rigenerato ad ogni render). Stessa palette `--primary`/neon ciano
   già usata altrove nel progetto, nessun colore nuovo.
3. **Spazio nero vuoto sotto il nome nella carta XL** (animazione di assegnazione): la fascia
   `.ant-card-fade` (36% dell'altezza, pensata per le mini-carte panchina) su una carta 152px
   lasciava molto spazio vuoto sopra al nome. Aggiunta un override
   `.ant-card.in-bench.size-xl .ant-card-fade{height:20%}` + nome riposizionato/ingrandito.

**Verificato in locale** (stesso harness JS del round 1): etichette con nomi realistici lunghi
("Bongracio", "Zaminay", "Di Lorenzo"...) troncano con ellissi senza più sovrapporsi ai badge
ruolo dello slot accanto; bracket agli angoli e griglia neon visibili su screenshot; carta XL con
fascia nera ridotta e nome ben proporzionato (verificato creando una carta XL isolata via
`_antCardHTML(...,'xl',false)`). Commit: `af7332d` su `main` (round 1 `d9fe35f`; deploy Hostinger
automatico su push).

### Round 3 — l'utente ha ritestato in produzione: nomi ancora tagliati, campo "sinking", carta XL ancora nera

Con screenshot reali (uno da app, uno foto da telefono di un'asta in corso) l'utente ha
confermato che il round 2 non bastava: i nomi si tagliavano ancora (l'ellissi troncava
comunque cognomi normali), le carte sembravano "affondare" nel prato, e la carta XL
dell'animazione aveva ancora molto spazio nero vuoto col nome tagliato. Richiesta esplicita
stavolta: **i nomi non devono MAI essere tagliati**, nemmeno parzialmente.

1. **Nomi tagliati (in campo)**: sostituito il troncamento a riga singola con ellissi
   (`.ant-slot3d-name-txt`) con un wrap su **max 4 righe** (`-webkit-line-clamp:4`),
   `max-width` alzato da 13cqw a **15.5cqw**, font ridotto a `.46rem` per fare stare più
   caratteri per riga. Verificato con `scrollHeight>clientHeight` (rileva un taglio reale,
   non solo "sembra tagliato") su tutti gli 11 moduli con cognomi deliberatamente estremi
   (`"Kvaratskhelia"`, 13 lettere): a zoom ≥250px nessun taglio; sotto i 250px anche 4 righe
   non bastavano per il caso più estremo, quindi **`ANT_PITCH_SIZE_MIN` alzato da 220 a 250**
   (soglia minima misurata: 230px) — l'utente non può più zoomare il campo così piccolo da
   rischiare un taglio. Il wrap multi-riga (verticale) invece che l'allargamento orizzontale
   evita anche di reintrodurre la sovrapposizione tra etichette adiacenti (verificato: 0
   overlap su tutti gli 11 moduli con nomi lunghi, a 250/300/460px).
2. **Carte che "affondano" nel prato**: causa — `.ant-slot3d-shadow` (ombra di contatto) era
   centrata a `top:50%` del box carta (il suo centro verticale), non alla base/piedi. La
   carta "galleggia" via `translateZ` da quel punto centrale, quindi la meta' inferiore
   restava visivamente allo stesso piano Z del prato invece che sopra l'ombra. Fix:
   `top:100%` (base della carta) + dimensione in cqw invece di px fissi (coerente con
   `.size-pitch`).
3. **Carta XL ancora con nome tagliato e molto nero vuoto**: causa radice trovata —
   `display:-webkit-box` (necessario per `-webkit-line-clamp`) NON ha alcun effetto se
   applicato direttamente a un elemento `position:absolute` (Chrome lo "blockifica",
   perdendo la modalità box legacy del line-clamp): il fix del round 2 sembrava corretto nel
   CSS ma non funzionava mai a runtime. Il nome ora vive in uno `<span class="ant-card-name-
   txt">` interno NON posizionato, dentro al div assoluto usato solo per il posizionamento
   (`_antCardHTML()` in `app.js`) — stesso pattern già usato per `.ant-slot3d-name-txt` in
   campo, che infatti funzionava correttamente fin dal round 2. Fascia nera e dimensione
   nome invariate dal round 2 (già ridotte), ora effettivamente wrappano su 2 righe invece di
   troncare.

**Verificato in locale**: 0 nomi tagliati su tutti gli 11 moduli con cognomi reali E con un
cognome deliberatamente estremo, a tutti e 3 i livelli di zoom (250/300/460px); 0
sovrapposizioni tra etichette negli stessi test; carta XL isolata (`_antCardHTML(...,'xl',
false)`) verificata via `scrollHeight===clientHeight` (nessun taglio) e screenshot (wrap su 2
righe, fascia nera compatta). **Non verificabile in questo ambiente**: la sensazione di
profondità/"non affondare" richiede un giudizio visivo umano, non solo una misura DOM — da
confermare con l'utente.

### Round 4 — requisito cambiato: nome SEMPRE su una riga sola, mai a capo (non più multi-riga)

L'utente ha chiarito il requisito dopo il round 3: i nomi si sovrapponevano ancora tra loro
E non devono andare a capo su più righe — devono stare **su una riga sola**, per intero, senza
mai toccare il nome dello slot vicino. Un `max-width` fisso (in cqw o px) non può garantirlo
per ogni riga di `ANT_LAYOUT`: righe con pochi giocatori hanno molto più margine di righe da 5,
e la prospettiva 3D del campo fa sì che lo stesso gap in percentuale corrisponda a pixel
diversi a seconda di quanto la riga è vicina alla "telecamera". Sostituito l'approccio
"dimensione fissa che tronca/va a capo" con un **auto-fit a runtime**:

- `_antFitEtichetteCampo(pitch)` (nuova, `app.js`): dopo il render, raggruppa gli slot per riga
  e MISURA con `getBoundingClientRect()` la distanza reale in pixel tra gli slot vicini sulla
  stessa riga (tiene conto automaticamente della prospettiva, a differenza di un calcolo sulle
  coordinate percentuali).
- `_antFitTestoLabel(el, maxWidthPx)` (nuova, `app.js`): riduce il `font-size` di un'etichetta
  a step di 0.5px finché il testo (sempre `white-space:nowrap`, mai a capo) non entra nello
  spazio disponibile, con un pavimento leggibile (5px). Stesso helper riusato per il nome sulla
  carta XL dell'animazione (nessun vicino: budget fisso generoso, 96px).
- CSS: `.ant-slot3d-name-txt`/`.ant-card-name-txt` tornati a riga singola
  (`white-space:nowrap;text-overflow:ellipsis`, l'ellissi resta come rete di sicurezza teorica
  ma non dovrebbe più scattare); rimossi i `max-width` statici in CSS, sostituiti dal calcolo
  dinamico.

**Verificato in locale**: con cognomi reali E uno deliberatamente estremo
(`"Kvaratskhelia"`), su tutti gli 11 moduli e 3 livelli di zoom (250/300/460px) — **0 nomi
tagliati** (`scrollWidth<=clientWidth`) e **0 sovrapposizioni tra etichette** in ogni singolo
caso testato, confermato anche via screenshot (riga singola, leggibile, es. riga da 5 giocatori
del 3-5-2 con "Fabbian/Skriniar/Immobile/Berardi/Puczka" tutti su una riga senza toccarsi).
Carta XL isolata con "Kvaratskhelia": una riga, font auto-ridotto a 9px, entra esattamente nel
budget di 96px.

### Round 5 — preselezione squadra utente, Anteprima come tab normale su mobile, animazione solo per chi vince

Tre richieste distinte dell'utente, tutte in `frontend/`, nessuna tocca `backend/`:

1. **Anteprima preseleziona la squadra dell'utente**: `populateAnteprimaSquadre()` ora sceglie
   `S.miaSquadra` come default (invece della prima squadra della lista) quando non c'è già una
   scelta precedente da ricordare — se l'utente sta guardando l'Anteprima di un'altra squadra,
   quella scelta resta rispettata ai render successivi, non viene rimessa sopra ad ogni update.
2. **Su mobile, Anteprima si comporta come una tab normale** (richiesta esplicita: "no
   toques la vista ordenador", solo mobile): prima era un drawer che su schermi stretti si
   espandeva IN FONDO a tutta la pagina, sotto Storico/Rose/ecc. Ora (solo sotto i 760px,
   stesso breakpoint già usato altrove) `#tab-anteprima` viene spostato DAVVERO dentro
   `.tabs-panel` da `_antSyncDrawerLayout()` (`app.js`) e diventa esclusiva con le altre tab
   (classe `.ant-drawer-as-tab`, nuova, in `style.css`) — stesso flusso/scroll delle altre
   `.tab-content`, niente più header/bottone chiudi del drawer. Su desktop tutto invariato
   (`_antToggleDrawer()`, drawer laterale indipendente). La sincronizzazione avviene
   all'avvio, su `matchMedia('(max-width:760px)').addEventListener('change', ...)` **e**
   viene ri-verificata ad ogni click su una tab (difensivo: garantisce comportamento corretto
   anche se l'evento di resize non scattasse in tempo).
3. **Animazione carta solo per chi vince la puja**: prima `_playAssegnazioneCardFx()` partiva
   per OGNI client che riceveva `giocatore-assegnato` (evento broadcast a tutti, invariato).
   Ora parte solo se `squadra === S.miaSquadra` (l'admin ha sempre una propria squadra
   all'ingresso in asta, stessa regola per tutti — chiarito con l'utente). Gli altri
   partecipanti continuano a vedere il toast già esistente con nome giocatore/squadra
   vincitrice/prezzo (invariato, copriva già questo caso), solo senza l'effetto carta volante.

**Verificato in locale**: preselezione confermata (`S.miaSquadra='Alba'` → select su "Alba"
invece della prima squadra); comportamento mobile verificato con click reali — tab Anteprima
si apre/chiude in modo esclusivo con le altre, contenuto (squadra preselezionata + campo 3D)
visibile subito sotto la barra tab, non più in fondo alla pagina; verificato anche il
"self-correcting sync" (resize senza aspettare l'evento, poi click su una tab: si corregge da
solo). Il gate `squadra===S.miaSquadra` sull'animazione è una modifica di una riga,
logicamente diretta, non replicabile in questo ambiente senza un'asta live reale con due
client connessi (richiederebbe un round-trip socket reale) — verificata leggendo il codice, non
via browser.

### Round 6 — carta XL "alargada" con troppo spazio nero: causa vera trovata (non il CSS della fascia)

Dopo il round 5 l'utente ha rilevato che la carta dell'animazione (con l'animazione ormai
corretta per essere riservata al vincitore) era tornata "alargada" (allungata) con molto spazio
nero sotto il nome — nonostante il round 3 avesse già ridotto la fascia. Causa REALE, mai
notata prima perché i test dei round precedenti creavano la carta XL isolata con dimensioni
fisse (110×152) invece di passare per il flusso reale: `_playAssegnazioneCardFx()` forzava
`cardEl.style.width/height = '100%'` dentro un `wrap` dimensionato esattamente come
`.cc-avatar` — ma `.cc-avatar` NON è sempre un cerchio 84×84: nel layout admin è
`width:118px;height:auto` con `position:absolute;top:8px;bottom:8px` (si "stira" per riempire
l'altezza del contenitore, spesso 200px+), quindi la carta usciva alta e stretta con
proporzioni completamente diverse da quelle disegnate (110:152), e la fascia nera al 16%
di un'altezza molto maggiore del previsto tornava a sembrare eccessiva.

Fix: il `wrap` ora ha SEMPRE le dimensioni naturali della carta (`ANT_FX_CARD_W/H` = 110×152,
mai deformate), centrato sul punto medio dell'avatar sorgente invece di copiarne la sagoma;
l'illusione "esce dall'avatar" viene dalla scala di partenza (`startScale`, proporzionale alla
larghezza reale dell'avatar, tetto 1 pavimento 0.35) invece che dalla forma del contenitore, e
il picco (`scalePeak`) punta a una dimensione fissa (~250px) svincolata dall'avatar sorgente.

**Verificato in locale**: simulato sia un avatar "stiracchiato" (118×260, come nel layout
admin) sia uno normale (84×84 cerchio) come sorgente — in entrambi i casi la carta
(`cardEl.getBoundingClientRect()`) mantiene esattamente le proporzioni naturali 110:152 (mai
deformata), con la scala di partenza calcolata correttamente in ciascun caso; screenshot al
picco dell'animazione conferma card portrait pulita, fascia nera compatta, nome su una riga.

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

- **Committare e pushare le correzioni post-redesign 3D Anteprima** (vedi sezione dedicata sopra)
  quando l'utente conferma di volerle in produzione — al momento sono solo nel working tree.
- **Verificare dal vivo le 9 correzioni post-redesign** in un'asta di test reale (scroll nelle 5
  sotto-tab, tutti gli 11 moduli di Anteprima, animazione ~3s col toggle, selezione posizioni
  A→B→C senza click fuori) prima del prossimo uso reale della lega.
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
