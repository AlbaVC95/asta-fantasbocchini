# SESSION_SUMMARY.md

Stato corrente del progetto. Questo file è **memoria di lavoro, non storico**: va sovrascritto,
non accumulato. La cronologia sta in `git log`, il *perché* delle scelte in
[DECISIONS.md](../DECISIONS.md), stack e convenzioni in [PROJECT.md](../PROJECT.md).

## Stato attuale

Branch `main`, allineato con `origin/main`. Deploy automatico su Hostinger al push su `main`,
quindi **tutto quanto è qui sotto è in produzione**.

Il lavoro del 2026-09-01 è in tre commit: lo scorrimento della pagina d'asta con la vista a parte
(`vista-esterna.js`), poi il tetto sul pannello delle tab che ha restituito anche lo scorrimento
interno, poi la videochiamata (`videochiamata.js`). Vedi le prime due sezioni qui sotto.

**Quattro temi attivi** (`serata` default, `cuoio`, `lavagna`, `sala-giochi`), tutti con lo stesso
pattern (ruoli `--sc-*` in `tema-serata.css` + token base in `style.css`, entrambi con un blocco
`[data-tema="<id>"]`, + una sezione "materie" in fondo a `tema-serata.css`; una riga in `TEMI` in
`app.js` e, se la clessidra resta visibile, una voce in `MATERIALI` di `clessidra.js`).
L'attributo è `data-tema="<id>"` su `<html>`, il selettore è il menu 🎨. Home, Lobby, Strategie,
Editor Fasce, Anteprima e Griglia P/A ereditano i token globali senza regole per schermata.
Due dei quattro temi cambiano anche i **caratteri** (`sala-giochi`: Press Start 2P + Silkscreen;
`lavagna`: Caveat + Kalam): in quel caso la famiglia va aggiunta al `<link>` di Google Fonts in
`index.html`, e non basta ridefinire `--font-main`/`--font-display` — il foglio di tema scrive
'Archivo'/'Space Mono' a mano in ~43 regole con `!important`, che le variabili non raggiungono.

**Promemoria operativi che non scadono:**

1. **Font-size nella zona puja (`#puja-panel-slot`/`.asta-row-puja`) deve sempre usare `cqw`, mai
   `vw`**: il container "sala" (`#asta-main-col`) si dimezza quando si apre Anteprima senza che la
   finestra cambi — una regola in `vw` resta tarata sulla finestra e può arrivare a rompere il
   layout (nome del giocatore a capo lettera per lettera, bug reale già capitato).
2. **I 3 file con righe LF-only** (`frontend/js/app.js`, `frontend/index.html`,
   `frontend/css/style.css`) non vanno mai editati con l'Edit tool standard — vedi PROJECT.md per
   il procedimento (script Python, verificare lo stile di fine riga ESATTO del punto
   d'inserimento, non assumerlo uniforme, e ricontare le righe LF-only prima e dopo).
   `frontend/css/tema-serata.css` **non è più in questa lista**: era l'unico file al 100% CRLF ed
   è stato convertito a LF il 2026-08-26 in un commit di sole fine riga, apposta per non trascinare
   un diff da 3000 righe a ogni ritocco al CSS. Ora si edita normalmente, e va tenuto a LF.
   Conteggi righe LF-only al 2026-08-26: app.js 240, index.html 19, style.css 234.
3. **Per usare una foto vera** (non un'imitazione CSS) serve che sia l'utente a salvarla su disco
   e dire il nome del file: nessun tool di Claude Code può esportare un'immagine incollata in
   chat. Poi si copia in `frontend/img/backgrounds/` e si referenzia con `url(...)` + `?v=N`
   manuale (Hostinger serve gli statici con cache `immutable` di 30gg).
4. **Non vale più il vecchio promemoria "se un colore non torna, controlla `theme_overrides`"**:
   l'Editor Visuale di Stile che scriveva quella riga è stato eliminato (vedi sotto). La riga
   `default` resta nel database, vuota, ma nessuno la legge più.
5. **Sopra i 769px la pagina d'asta scorre, e le aree che scorrono sono DUE, ciascuna col suo
   mestiere**: la pagina (`#screen-asta`, non `html`/`body`) toglie di mezzo testata, riepilogo
   squadre e carta di puja; il pannello delle tab scorre la lista lunga, con un tetto di
   `calc(100vh - 72px)`. I 72px sono l'altezza misurata della striscia di puja (61-64 secondo il
   tema) più 8 di margine: la striscia è `position:fixed` e **non riserva spazio**, quindi senza
   quella sottrazione a fondo pagina la barra delle tab finirebbe sotto di lei. È l'unico numero
   da rivedere se la striscia cambiasse altezza. Prima di aggiungere un `overflow` o un `flex:1`
   in quella zona, leggere il blocco in fondo a `tema-serata.css`. E se un giorno la testata
   tornasse `sticky`: ha `z-index:1000` contro gli 800 della striscia, la coprirebbe.

Per portare online, tornare indietro o aggiungere un tema:
**[docs/DEPLOY_TEMA.md](DEPLOY_TEMA.md)** — riscritto il 2026-08-26 per i quattro temi, con i due
cache-busting da non dimenticare prima di un push.

## Cambi recenti — la videochiamata dentro l'asta (2026-09-01)

Richiesta dell'utente: come su FantaLab, vedersi e sentirsi senza uscire dall'asta. Nuovo modulo
`frontend/js/videochiamata.js`, additivo come `puja-sticky.js` e `vista-esterna.js`.

**Non si costruisce niente di video.** A 12-22 persone il peer-to-peer puro non regge (21 salite a
testa, si rompe verso i 5-6 partecipanti) e un server di media su Hostinger non è un'opzione. Si
incastona un servizio di terzi in un `<iframe>`, e **tutto quello che sa quale servizio sia sta in
una funzione** (`creaConferenza`). Che quell'isolamento servisse davvero si è visto subito: il
fornitore è cambiato nel giro di poche ore (vedi più sotto).

Un bottone "🎥 Chiamata" in testata; **non si entra da soli**. La stanza si ricava dall'`astaId`,
quindi tutti quelli della stessa asta cadono nella stessa senza passarsi link; sotto la faccia si
legge il nome della squadra. Franja in basso con **quattro misure** (pastiglia / piccola / media /
grande), che si ricordano per dispositivo insieme allo stato della camera — la camera parte spenta
solo la prima volta.

**La franja riserva il suo posto invece di galleggiare**: altrimenti coprirebbe la barra orizzontale
delle Rose, che a fondo pagina sta a 5px dal bordo. La riserva è in due punti, `padding-bottom` su
`#screen-asta` e la stessa altezza sottratta al tetto di `.tabs-panel`, tramite la variabile
`--h-chiamata` che scrive il modulo. Finché nessuno entra in chiamata vale `0px` e non cambia un
pixel.

**Su telefono non può stare in basso**: lì `.rilancio-box` è `position:fixed;bottom:0`, cioè
RILANCIA vive in quel posto. Si appoggia sopra di lui misurandolo a runtime, e da "media" in su va a
schermo intero, con la striscia di puja che resta sopra (z-index 800 contro 760) così si vedono
comunque prezzo, tempo e tasto.

**Negli ultimi secondi le facce si attenuano** come il resto della scena, agganciandosi alla classe
`body.puja-urgente` che già esiste. L'audio non si tocca: è quando si urla.

**Una correzione a un'obiezione mia, sbagliata**: avevo detto che la schermata d'asta "va giusta di
rendimento". Misurata: 4,5 ms di mediana per redisegnare tutto a ogni rilancio su un bilancio di
16,7, 61 fotogrammi al secondo, zero canvas attivi. Va larga. Resta vero che è **critica nel tempo**
— il cronometro è del server e ogni rilancio lo azzera — ma è un'altra cosa, ed è il motivo del
punto sopra sugli ultimi secondi, non un motivo per non fare la chiamata.

**Il fornitore è cambiato subito dopo il primo deploy, e il motivo va ricordato**: `meet.jit.si`
incrustato **taglia la chiamata dopo 5 minuti** — è un uso "da demo" e lo dice con un avviso sopra
il video. Visto dal vero. Si è passati a **JaaS** (lo stesso Jitsi, ospitato da loro), che è la
stessa identica API: cambia il dominio, la stanza va preceduta dall'AppID e serve un token firmato
dal backend. Il piano gratuito di JaaS conta **25 dispositivi al mese, minuti illimitati** — e
siccome conta dispositivi e non minuti, il fatto che molte persone giochino in entrambe le leghe
gioca a favore: chi ripete entra dallo stesso portatile e conta una volta sola. Le alternative a
minuti (Daily 10.000, LiveKit 5.000, Whereby 2.000) non coprono due aste nello stesso mese.
Auto-ospitarlo è escluso: l'hosting è *Unlimited Web Hosting*, cioè condiviso — niente root, niente
UDP, e un'asta muove ~280 GB. Dettagli e numeri in [DECISIONS.md](../DECISIONS.md).

Due rotte nuove nel backend, additive (non sfiorano backup, auth d'asta né timer):
`GET /api/chiamata/config` e `GET /api/chiamata/token`. La chiave privata sta **solo** in una
variabile d'ambiente; si firma con il `crypto` di Node, senza nuove dipendenze; e la rotta del
token **richiede il login**, perché una quota da 25 dispositivi la brucia chiunque trovi
l'indirizzo.

**Il bottone esiste solo se il server è configurato.** Senza le variabili d'ambiente,
`/api/chiamata/config` risponde `attiva:false` e il modulo non monta niente. È la lezione della
serata: era finito online un bottone che dava una chiamata rotta.

**Verificato** senza toccare nessun servizio reale: le funzioni di firma estratte dal `server.js`
vero producono un JWT che si verifica con la chiave pubblica, con header e payload identici a
quanto documenta 8x8; le tre forme di incollare la chiave funzionano; senza chiave il bottone non
compare; con le variabili impostate compare; la rotta del token dà **401 senza login**; e con
fornitore e token finti il modulo chiama l'API con dominio `8x8.vc`, `roomName` `<AppID>/<stanza>` e
il jwt, la forma documentata. Più tutto il resto della franja: quattro misure che riservano il posto
(tetto del pannello 624/500/264/698 su 800), zero sbordo orizzontale, barra delle Rose mai coperta,
uscita che rimette il layout identico, quattro temi, e su 375px mai sopra RILANCIA.
**Non verificato — ed è la parte che conta**: una chiamata vera contro JaaS. Servono le credenziali
dell'utente. Vedi le pendenze.

## Cambi recenti — la pagina scorre, e le Rose si staccano (2026-09-01)

Due richieste dell'utente, la prima corretta subito dopo con una terza.

**1. La pagina d'asta scorre (da 769px in su), e il pannello delle tab scorre al suo interno.**
Prima la schermata era alta esattamente un viewport e scorreva solo il contenuto della tab aperta:
la carta di puja restava sempre a schermo, quindi la striscia di puja — costruita apposta per
quando la scena scorre via — non aveva quasi mai occasione di comparire. Non è un meccanismo nuovo
(sotto i 768px c'era già, e in vista Partecipante scorreva già `#asta-main-col`): il cambio vero è
che le aree che scorrono passano da **tre annidate a due, ciascuna col suo mestiere** — la pagina
toglie di mezzo il chrome, il pannello scorre la lista.

**Fatto in due giri, e vale la pena ricordarlo.** Il primo ne aveva lasciata una sola, col pannello
alto quanto il contenuto: con 12 rose la pagina diventava alta 2000px, la barra orizzontale delle
Rose finiva irraggiungibile in fondo e le intestazioni di colonna della Griglia P/A smettevano di
seguire. L'utente ha chiesto di riavere anche lo scorrimento interno e aveva ragione. Il secondo
giro è **più piccolo** del primo: un `max-height:calc(100vh - 72px)` sul pannello e via tre
anulazioni, perché le regole base di `style.css` (`flex:1;min-height:0;overflow-y:auto`) erano già
esattamente quello che serve — mancava solo un'altezza definita sul pannello.

I 72px sono misurati, non a occhio: la striscia sta fra 61 e 64px secondo il tema, più 8 di
margine. Servono perché la striscia è `position:fixed` e non riserva spazio; a fondo pagina la
barra delle tab resta 8px sotto di lei invece che coperta.

Il blocco sta in fondo a `tema-serata.css`, non in `style.css` che sarebbe il foglio del layout: le
regole da battere stanno lì e sono `!important`, e quel foglio è caricato dopo.

**Anteprima ha una regola sua**: è una colonna sorella con `align-self:stretch`, si sarebbe stirata
quanto le Rose col campo 3D minuscolo in cima. Resta alta un viewport, con lo scorrimento suo, e
`sticky` per restare a portata — la stessa forma che il tetto dà al pannello, ottenuta in un altro
modo perché vive in un'altra colonna. **Griglia P/A**, che nel primo giro non si poteva escludere,
col tetto non ha più bisogno di essere esclusa: torna a scorrere dentro di sé come le altre, e con
lei tornano a funzionare le intestazioni di colonna della mappa di calore.

**2. Rose, Storico e Svincolati si aprono in una scheda a parte.** Nuovo modulo
`frontend/js/vista-esterna.js`, additivo come `puja-sticky.js`: un bottone "⧉ Apri a parte" in
ciascuna delle tre tab. **Non apre nessuna connessione in più** — nessun socket, nessun login,
nessuna chiamata REST: la scheda è `about:blank` scritta dal modulo, che rispecchia l'`innerHTML`
del nodo vero e si riallinea con un `MutationObserver`. Funziona perché quei tre `render*` girano
ad ogni aggiornamento di stato, non solo quando la loro tab è aperta.

I click nella scheda tornano al documento madre **per posizione nell'albero** e lì si fa `.click()`
sull'elemento vero — stesso principio della striscia di puja con `#btn-rilancio`. A tutto schermo
le colonne delle Rose vanno a capo invece di scorrere: è l'unico punto in cui la vista a parte si
comporta diversamente dall'originale, ed è il motivo per cui la si voleva.

**Tre difetti veri trovati provandolo, tutti corretti**: il titolo della scheda restava
`about:blank` (`d.title` scritto prima di svuotare `<head>`, che se lo porta via); ogni click nello
specchio finiva con un `ReferenceError` non gestito, perché l'HTML copiato si porta dietro gli
`onclick` inline dell'app (`_toggleRoseSec`, `chiamaLibero`) che lì non esistono — risolto
fermando l'evento in fase di cattura; e una scheda ricaricata con F5 restava bianca — ora il giro
lento se ne accorge e la ricostruisce.

**Verificato** in browser con stato sintetico, con rose da 30 giocatori apposta per far traboccare
il pannello: 8 combinazioni vista × tema a 1280px più 900 / 1100 / 1920px, in tutte scorrono
**tutte e due** le aree e **zero sbordo orizzontale**; provate anche separate (scorrendo il
pannello la pagina non si muove e viceversa); a fondo pagina la barra delle tab resta scoperta di
8px; a 375px le regole non si applicano e i valori calcolati sono identici a prima. Per la vista a
parte,
il codice reale del modulo è stato eseguito contro un `Window`/`Document` veri (un `<iframe>` al
posto di `window.open`, che il browser di verifica blocca sempre): contenuto identico
all'originale nelle tre viste, aggiornamento in diretta, click delegati che agiscono sull'elemento
vero, tema che segue a caldo, ricostruzione dopo ricarica, zero errori in console.
**Non verificato**: l'apertura vera di una scheda del browser, bloccata dallo strumento.

## Cambi recenti — "Lavagna al Neon" scritta a mano (2026-08-26)

Richiesta dell'utente: nel tema lavagna il testo doveva sembrare scritto col gesso, leggibile, non
una corsiva strana. Il tema aveva l'ambiente giusto ma i caratteri della stampa, gli stessi degli
altri tre locali. Ora usa **due font, con ruoli distinti** come gia' fa Sala Giochi:

- **Kalam** = l'interfaccia intera (prende il posto di Archivo e Space Mono);
- **Caveat** = la mano larga, solo per nome del giocatore, offerta, cronometro, RILANCIA, esito;
- **Pacifico** resta l'insegna: e' il tubo al neon, non il gesso.

Restano a monospazio, di proposito, il link da copiare, le colonne numeriche della Griglia P/A e i
`<code>`: li' non e' estetica ma allineamento. Per questo si ridefiniscono solo `--font-main` e
`--font-display`, mai `--font-mono`; le ~43 regole del foglio di tema che scrivono il font a mano con
`!important` hanno bisogno di due elenchi espliciti di selettori, che le variabili non raggiungono.

**Scelto misurando, non guardando**: Kalam ha l'occhio di Archivo (51.1 contro 52.6 su 100px) ed e'
piu' stretto di Archivo e Space Mono, quindi regge gli 8-10px dell'app e le viste dense si
*stringono* — tre colonne delle Rose passano da 594px a 560px (-6%), il contrario della regressione
di Silkscreen. Caveat ha l'occhio del 32% piu' piccolo: serve solo dove il testo e' maiuscolo o
enorme. Dettagli e formule in [DECISIONS.md](../DECISIONS.md).
**Un dato di quel commit era sbagliato ed e' stato corretto dopo**: Caveat non e' piu' stretto di
Archivo per il nome del giocatore, e' il 5% piu' largo — Archivo li' gira condensato (`wdth 62`), e
la prima misura era presa con `scrollWidth`, che restituisce la scatola invece del testo.

**Due trappole vere, trovate e risolte a schermo**: le cifre ingrandite con `font-size-adjust`
venivano *tagliate* da `.cc-offerta-box` perche' il foglio base stringe l'interlinea sotto 1 (limite
ricavato: `line-height >= 0.76 · k`); e la coda del 7 di Caveat sborda di .088em oltre la larghezza
nominale della cifra, quindi veniva tranciata.

**Verificato** in browser reale con stato d'asta finto, a 390 / 900 / 1280 / 1440 / 1600px, in vista
Partecipante e Admin, su carta di puja, Riepilogo squadre, Rose, tab, modali, Anteprima e menu: font
applicato ovunque, nessun taglio, nessun errore in console, e gli altri **tre temi hanno le stesse
identiche font di prima** (controllo automatico su 12 selettori x 4 temi).

**Difetto preesistente trovato per strada**: a 1280px il nome del giocatore andava a capo in mezzo
alla parola. Non era del gesso (forzando Archivo restava identico) ed e' stato corretto a parte —
vedi la sezione qui sotto.

## Cambi recenti — la striscia di puja quando scorri via (2026-08-31)

Richiesta dell'utente, con un video di Fantalab: scorrendo la pagina il pannello di puja esce dallo
schermo e non si puo' piu' rilanciare. Riprodotto e misurato: a **1100x800**, vista Partecipante,
senza nemmeno aprire Anteprima, il tasto RILANCIA finisce a **-137px**; su mobile a 390px a -88px.
Resti a guardare le squadre senza poter rilanciare e senza sapere quanto tempo manca.

Nuovo modulo **`frontend/js/puja-sticky.js`**, additivo come `clessidra.js` e
`comportamenti-asta.js`: si costruisce il suo DOM da solo e finche' il tasto vero e' raggiungibile
resta `display:none`. Contiene, nell'ordine in cui servono per decidere: foto, ruoli, nome, squadra,
riga di Strategia, importo, **chi ha fatto l'ultima offerta**, timer e il tasto.

**Non manda rilanci**: il suo tasto fa `.click()` sul vero `#btn-rilancio`. Verificato intercettando
il socket che i due producano lo **stesso identico payload** (`{astaId, offerta:188}`). Un `.click()`
programmatico non fa scattare la soppressione della "leva", che si arma solo su una pressione vera.

**La soglia: tre tentativi, due sbagliati.** E' la parte che e' costata di piu', perche' l'altezza
del tasto RILANCIA **cambia moltissimo col layout** — 35px in Admin su schermo largo, 62-64px in
vista Partecipante, 134px in Admin a 1100x800.
1. Osservavo il *riquadro* di rilancio invece del tasto: a scroll finito ne restavano visibili 34px
   su 226, quindi "intersecava" e la striscia non compariva mentre il tasto era gia' fuori.
   **Il contenitore mente sul suo contenuto.**
2. Soglia in percentuale (60%): in Admin a 1100x800 il tasto e' visibile al 55% *a riposo*, quindi
   la striscia restava accesa in permanenza — peggio del problema.
3. Soglia in pixel fissi (44): **segnalato dall'utente**, in Admin su schermo largo il tasto e' alto
   35px e si vede tutto, ma 35 < 44 e la striscia compariva su un bottone perfettamente cliccabile.

   La soglia giusta e' **`min(44px, altezza del tasto)`**: ti servono 44px di bottone, oppure tutto
   il bottone se e' piu' basso di 44. Cosi' un tasto interamente visibile non fa mai comparire la
   striscia, qualunque altezza abbia. L'errore di fondo era confondere *quanto e' grande il bottone*
   con *quanta parte se ne vede*.
3. `IntersectionObserver` e `requestAnimationFrame` **non funzionano a pagina nascosta**: il primo
   riporta intersezione zero per tutto, il secondo non viene servito. Sostituiti da un calcolo sul
   rettangolo con throttle a tempo — deterministico, e soprattutto verificabile.

**Verificato**: 8 combinazioni vista x tema, 11 elementi ciascuna, **zero differenze** rispetto
all'app senza il modulo; comparsa/sparizione su desktop e mobile; ricompare da sola quando viene
chiamato un giocatore nuovo senza che tu scrolli; rispetta il tasto disabilitato; nessuno sbordo.

## Cambi recenti — la Griglia P/A poggia su un piano (2026-08-26)

Era l'ultima schermata senza un trattamento suo: `.gk-view` in `style.css` è pura impaginazione,
senza fondo, quindi il contenuto stava appoggiato direttamente sull'immagine d'ambiente — sulla
pergamena di Cuoio e sulla foto del bar di Serata si leggeva male e la schermata sembrava non finita
rispetto a tutte le altre.

Non è stato inventato niente di nuovo: si riusa, tema per tema, **la stessa materia che ciascuno dà
già a `.card`**. Così la Griglia entra nel locale invece di galleggiarci sopra, e chi domani ritocca
`.card` non deve ricordarsi di ritoccare anche questa. Il piano va su `.gk-view.active` e non su un
contenitore più esterno perché un contenitore non c'è: in `index.html` testata, toggle, tab e viste
sono fratelli. Testata e tab restano "chrome" appoggiato all'ambiente, come già fanno la Home e la
riga di tab della schermata d'asta.

In più, le righe della classifica in **sala-giochi** erano bianche su piano bianco: hanno preso lo
stesso trattamento che il tema dà già alle righe delle Rose (angoli vivi e filo d'inchiostro). Gli
altri tre temi non sono stati toccati — si leggevano già bene.

`overflow-x:auto` sul piano è deliberato: la vista "Griglia" è una mappa di calore con una colonna
per giornata, quindi è più larga della pagina per costruzione. Deve scorrere DENTRO il suo piano,
mai far scorrere la pagina in orizzontale.

Nello stesso giro sono stati vestiti anche **tab, toggle Portieri/Attaccanti e sub-tab**, ultimi
pezzi rimasti con le pastiglie generiche. Il tasto del toggle attivo aveva anche un difetto vero in
tutti e quattro i temi: `linear-gradient(primary, fire)` con testo bianco, misurato **3.95:1**. Il
gradiente è sparito (nessun altro punto dell'app lo usa) e si applica la stessa soluzione già scelta
per le sub-tab: fondo d'accento pieno e testo `var(--sc-fondo)`.

**Trappola di specificità, presa prima di spedirla**: `html[data-tema="x"] body .gk-mode-btn` e
`html body .gk-mode-btn.active` hanno la STESSA specificità (2 elementi + 2 selettori di classe),
quindi vince l'ultima scritta. Le mie regole di tema, essendo più in basso nel file, azzeravano il
fondo dello stato attivo: in cuoio e lavagna attivo e inattivo erano diventati lo stesso colore,
indistinguibili. Risolto ridichiarando l'attivo dentro ogni tema. È la terza volta che questo file
morde nello stesso modo — vedi la regola già scritta in DEPLOY_TEMA.md.

**Verificato** nei quattro temi a 1100px e 390px, su tutte le viste della Griglia (Ranking, Griglia,
Impostazioni): il piano compare, nessun sbordo orizzontale, su mobile misura 358px in tutti e
quattro, e tab/toggle/sub-tab attivi sono sempre distinguibili dagli inattivi con contrasto
6.1-10.9:1.

## Cambi recenti — chiuse le pendenze vecchie (2026-08-26)

Quattro voci ferme da sessioni, chiuse in un giro solo.

**Codice morto della catena foto — 214 righe.** La nota di debito diceva che `app.js` chiamava
`/api/player-photo`, rotta inesistente, prendendo un 404 a ogni giocatore. **Era sbagliata**: la
funzione non era chiamata da nessuno. Insieme a lei erano morte altre 13 funzioni della vecchia
catena a fonti esterne (SportsDB, Wikidata, Wikipedia, API-Football, il filtro anti-nazionale e la
lista dei 190 paesi), abbandonata quando si è deciso di usare solo le foto locali verificate a mano.
Rimosse con uno script che, **dopo ogni singola rimozione, confronta l'insieme delle definizioni
prima e dopo e annulla se è sparito qualcos'altro**. Quella guardia ha intercettato due volte un
errore vero del brace-matching, che stava per cancellare `_withTimeout` (usata 4 volte) e
`_teamPhotoFolders`: senza controllo sarebbe andata online una app con le foto rotte.

**`.cc-strategia-info` su mobile.** Era l'unico `display:none` del tema che nascondeva un DATO
(fascia di Strategia, titolarità, commento) invece di una decorazione — e proprio su mobile, dove
serve di più perché non c'è la colonna Strategie accanto. Ora si compatta: una riga per voce, con i
puntini se non ci sta, e il commento resta un bottone che apre il testo intero. Si stringe, non
sparisce.

**Contrasto.** `--sc-tenue` (tema scuro) da `#6E645A` a `#8A8076`: era 3.2-3.4:1 sui tre fondi su cui
compare davvero, sotto la soglia AA, su testi da 9-10px. Ora 4.7-5.0:1. Stessa cosa per
`--text-muted` in `style.css`, che aveva lo stesso identico valore e vestiva `.gk-header-sub`.

**Due difetti trovati guardando le tre schermate mai controllate** (Strategie, Editor Fasce,
Griglia P/A) nei quattro temi:
- `.gk-subtab.active` aveva `color:#fff` fisso sopra l'accento del tema: nei due temi con accento
  CHIARO (ambra di serata, ciano di lavagna) faceva **1.8:1**, illeggibile. Risolto con
  `color:var(--sc-fondo)` — il fondo di ciascun tema è per costruzione il suo opposto, quindi una
  riga sola copre tutti e quattro (7.4-16:1).
- `--text-muted`, sopra.

Nessuno **sbordo** orizzontale in nessuna delle otto schermate controllate, in nessuno dei quattro
temi.

**Nota di metodo, costata tre giri a vuoto**: leggere i colori con `getComputedStyle` subito dopo
aver cambiato `data-tema` restituisce valori **in mezzo alla transizione CSS** — sembravano difetti
e non lo erano. Va sempre atteso il termine della transizione (~450ms). E una sonda di contrasto in
JS non sa leggere i pixel veri: sopra i fondi fotografici o a gradiente dà numeri inventati, quindi
lì l'unico controllo valido resta guardare.

## Cambi recenti — la carta di puja a 1280px: il nome non si spezza piu' (2026-08-26)

Segnalato dall'utente. In vista Partecipante a 1280px il nome del giocatore andava a capo in mezzo
alla parola: tre righe nei temi scuri, cinque in lavagna. **Non era un difetto del tema lavagna** —
forzando Archivo sugli stessi elementi restava identico. Era di tutti e quattro.

La causa e' uno **scalino**: appena la sala supera i 1200px la lista squadre si affianca alla puja e
la carta crolla da 596px a 285, ma nello stesso istante la carta entra nella fascia larga, che le
mette il ritratto grande (206px di padding) e la font tarata sulla SALA (54px). Restavano 79px al
nome. La soglia esisteva, ma **misurava la sala mentre il problema era la carta** — lo stesso errore
gia' visto nel Riepilogo squadre e nel cabinato.

Corretto in tre punti: la font del nome si misura ora sulla propria colonna (`.cc-info` diventa un
container, `15cqw`, ricavato dal fatto che il nome piu' lungo occupa ~6.5 volte la sua font-size); il
ritratto scende con la carta invece che con la sala, riusando le misure che le fasce strette avevano
gia'; e `.cc-offerente` va a capo invece di troncarsi coi puntini ("Real Caz…" a 1280px).

**Il container va messo solo in vista Partecipante**: provato in Admin, la colonna del nome collassa
a 0px, perche' li' `.cc-header` si dimensiona sul contenuto.

**Verificato** A/B, con e senza, a 16 larghezze da 390 a 1920px nei quattro temi: una riga sola
ovunque, offerta che non sborda, offerente mai troncato; e fuori dalla fascia rotta il risultato e'
identico a prima. Dettagli e tabella delle misure in [DECISIONS.md](../DECISIONS.md).

## Cambi recenti — limiti ridimensionati su un'asta vera (2026-08-25)

L'utente ha chiesto se i limiti appena introdotti reggono un'asta vera: 12-22 persone collegate per
8-9 ore. Verificato che il carico dell'asta **non passa dal rate limiting REST** (tutto sul
WebSocket, e le riconnessioni non fanno nessuna chiamata REST). Ma sono emersi tre rischi reali,
tutti corretti — dettagli in [DECISIONS.md](../DECISIONS.md):

1. **Contatore per IP condiviso** (stessa wifi, o proxy che non inoltra l'IP reale: tutti in un
   contatore solo). Soglie alzate a 600/15min e 3000/giorno, e le due letture pubbliche che servono
   per ENTRARE hanno un limite proprio e sganciato: non possono mai chiudere la porta a chi entra.
2. **5 rilanci/s erano pochi** per chi martella il tasto in una puja combattuta: le pulsazioni in
   eccesso venivano scartate e si rilanciava meno del previsto. Alzato a 10/s.
3. **Il same-origin del socket poteva bloccare tutti**: dietro a un proxy il confronto con l'header
   `Host` fallisce facilmente. Ora confronta l'hostname contro `Host` e `X-Forwarded-Host`.

**Controllo fatto il 2026-08-26 — passato.** `/api/health/banda` da due reti diverse ha restituito
due IP distinti (`79.150.106.127` da wifi, un IPv6 da 4G), quindi il proxy di Hostinger inoltra
davvero l'IP del client e `trust proxy` e' tarato bene: le soglie per IP non vanno riviste.

Il telefono ha risposto con un **IPv6**, cosa che il codice gia' gestiva: `ipKeyGenerator` raggruppa
sulla /56, quindi un utente IPv6 resta un solo contatore anche quando le privacy extensions gli
cambiano gli ultimi 64 bit. Verificato sull'indirizzo vero. (Il commento nel codice diceva /64 ed e'
stato corretto.)

**Nota su cosa il test NON dimostra**: le due prove erano su reti diverse. Se la sera dell'asta
sono tutti nella stessa stanza sulla stessa wifi, condividono un solo IPv4 e quindi un solo
contatore. Non e' un problema per chi ha fatto il login — li' la chiave e' il `sub` del JWT, una
per persona — ma lo sarebbe per le chiamate anonime, che infatti hanno soglie proprie e sganciate
apposta perche' non possano mai chiudere la porta a chi entra.

## Cambi recenti — le Rose vestite da sala giochi (2026-08-25)

Segnalato dall'utente: la schermata delle rose non seguiva il tema arcade. Motivo: `.rose-*` non
aveva **nessuna regola** in `tema-serata.css` — quella vista non era mai stata toccata da nessuno
dei quattro temi. Ora ha angoli vivi, filo d'inchiostro, ombra dura, intestazioni di reparto
cobalto, badge di ruolo piatti con la stessa codifica colore della Puja, e gettoni d'oro per
prezzi e crediti.

**Attenzione alla densita'**: applicando Silkscreen a tutto, tre colonne passavano da 432px a
588px (+36%), cioe' meno squadre a schermo proprio in "Visione compatta". Risolto tenendo la font
a pixel sul chrome (intestazioni, badge, gettoni) e riportando i **nomi dei giocatori** alla font
base: 494px, +14%. Vedi DECISIONS.md — la regola e' misurare sempre la larghezza contro gli altri
temi prima di mettere una font a pixel in una vista densa.

## Cambi recenti — export Fantaleghe: la rosa completa, non solo i nuovi acquisti (2026-08-25)

Bug segnalato dall'utente. Il CSV Fantaleghe si costruiva da `asta.storico`, cioe' dalle
assegnazioni di QUELLA asta: su un'asta di riparazione conteneva solo i nuovi acquisti, e
reimportandolo ogni squadra restava composta da quelli soli, **perdendo il resto della rosa**.
Danno silenzioso: il file si scaricava senza errori.

Ora si esporta `squadra.rosa`, lo stato finale vero (pregressi + acquisti - svincolati), la stessa
fonte gia' usata dal foglio "Rose" dell'Excel. Per l'asta 'iniziale' il risultato non cambia. Vale
anche per lo Storico Esportazioni, il cui payload contiene l'oggetto asta intero. Aggiunto un
avviso sui doppioni (stesso idFantaleghe in due rose), che prima avrebbero corrotto l'import in
silenzio.

**Verificato** eseguendo la funzione REALE estratta da app.js su aste sintetiche: riparazione con
rosa pregressa + nuovi acquisti -> 5 giocatori esportati invece di 2; asta iniziale invariata;
casi limite (idFantaleghe mancante, doppioni, rose vuote, prezzo assente) tutti con l'avviso
giusto.

## Cambi recenti — ruoli in riga, ruoli colorati, rosso a 3 secondi (2026-08-25)

Tre richieste dell'utente sulla carta di puja:

- **Ruoli in RIGA, non incolonnati.** `.cc-nome-row` era `flex-direction:column` (per proteggere
  il nome), ma un giocatore multi-ruolo produce un badge per ruolo: `Dd/Ds/E` diventava tre badge
  impilati. Ora riga + `flex-wrap`, con il solo nome a capo (`flex:0 0 100%`): badge affiancati
  sopra E nome con tutta la colonna. Vale per tutti i temi — era un difetto di layout.
- **Ruoli col loro colore anche in vista utente** (solo tema arcade): la regola "contorno, non
  pastiglia piena" della puja vinceva per specificita' sui colori del tema, quindi i ruoli erano
  bianchi solo li' e colorati ovunque altrove. Rialzata la specificita' nel contesto della puja,
  tenendo la forma arcade.
- **Rosso solo negli ultimi 3 secondi.** La scena diventava rossa da DUE posti a soglie diverse
  (`.urgent` in app.js a 5s, `body.puja-urgente` in comportamenti-asta.js a 4s): mezza scena si
  accendeva un secondo prima dell'altra. Ora entrambe a 3. Il **ticchettio sonoro resta a 5s**,
  deliberatamente staccato dal rosso.

**Verificato** in browser: i tre badge su una riga sola in tutti e quattro i temi, colori per ruolo
corretti in sala-giochi e contorno intatto negli altri tre; soglie del timer simulate secondo per
secondo (rosso da 3, tic-tac da 5, le due meta' della scena in sincronia).
**Confermato dall'utente**: il ticchettio resta a 5s e il rosso a 3s — lo sfasamento e' voluto,
non una svista da correggere in futuro.

## Cambi recenti — Riepilogo squadre in Admin: conteggi sopra il nome (2026-08-25)

Segnalato dall'utente. **Sovrapposizione vera, non un troncamento**: con `justify-self:end` la
casella dei conteggi si dimensiona sul contenuto (142px) invece che sulla sua colonna (32px) e,
ancorata a destra, cresce verso sinistra sopra il nome. La composizione a due righe che avrebbe
evitato tutto esisteva gia', ma era agganciata a `@container sala (max-width:1200px)` — la
larghezza della *colonna della sala*, che in Admin con Anteprima chiusa e' larghissima, mentre le
schede sono strette lo stesso perche' in Admin `#budget-bar` usa `minmax(190px,1fr)`. **La soglia
misurava la cosa sbagliata.** Risolto con due righe di default in Admin (stessa composizione gia'
scritta per il partecipante stretto) piu' `max-width:100%` su `.sq-bottom` come rete di sicurezza
globale. Dettagli e il tranello di `justify-self` in [DECISIONS.md](../DECISIONS.md).

**Verificato** riproducendo prima il bug: 24 sovrapposizioni su 12 schede; dopo, zero nelle 8
combinazioni vista×tema e su sei larghezze da 820 a 1400px, senza nessun testo troncato tranne la
coda del nome (comportamento voluto). Il nome anzi guadagna spazio: da 52px fissi a 72-89px.

## Cambi recenti — giro di sicurezza (2026-08-25)

Audit su quattro punti richiesti dall'utente. **Due erano reali, uno era già a posto, uno era un
falso allarme**; in più è emerso un buco più grave dei precedenti. Motivazioni tecniche complete
in [DECISIONS.md](../DECISIONS.md), in fondo.

- **API key in chiaro — falso allarme a metà.** La `SUPABASE_ANON_KEY` in `app.js` è **pubblica
  per definizione** e non va nascosta (è RLS a proteggere i dati, non la segretezza della chiave);
  la `service_role` non è mai stata committata, verificato su tutto lo storico git. Era invece un
  vero segreto filtrato `THEME_EDITOR_SECRET`, hardcoded, unica protezione di
  `POST /api/theme`.
- **Editor Visuale di Stile eliminato** (l'utente ha confermato che non lo usa): via l'IIFE di
  ~530 righe in fondo ad `app.js`, le due rotte `/api/theme`, la costante segreta, i keyframes
  `editor-anim-*` e la `fetch('/api/theme')` che ogni visitatore faceva a ogni caricamento.
  La tabella `theme_overrides` **non** è stata toccata: ospita anche il calendario del GK Planner.
- **RLS — era già corretta.** Tutte e 11 le tabelle `public` hanno RLS attiva, con policy per
  proprietario sui dati personali e zero policy (= deny-all) sulle quattro tabelle solo-backend.
  Nessun ERROR/WARN dal linter Supabase. Nessuna modifica al database.
- **Rate limiting — non esisteva, ora a tre livelli.** 300 richieste/15min e 1000/giorno per
  persona su tutte le API, più quote giornaliere strette (20 aste create, 10 caricamenti listino,
  30 ripristini, 20 tentativi di registrazione/15min) e antiflood sul socket (5 `rilancio`/s, 15
  altri eventi/s). Chiave: `sub` del JWT con fallback all'IP. Aggiunta la dipendenza
  `express-rate-limit` e `app.set('trust proxy', 1)` (indispensabile dietro il proxy Hostinger).
- **CORS del socket chiuso.** Via `{ origin: '*' }`; ora same-origin sempre ammesso (confronto
  `Origin` ↔ `Host`, così il deploy non richiede configurazione), più l'allowlist opzionale
  `ORIGINI_CONSENTITE` e i localhost.
- **`/api/exports` — il buco più grave, fuori dai quattro punti.** Le tre rotte erano
  completamente aperte: chiunque, senza login, poteva elencare, scaricare e **cancellare per
  sempre** lo storico delle aste concluse di tutta la lega. Ora lettura con login, cancellazione
  con ruolo `admin`.

**Verificato** con server locale su :3999 e client socket.io reale: rotte `/api/theme` a 404 anche
con la vecchia chiave; `/api/exports` a 401 senza token; handshake socket rifiutato da un'origine
esterna e accettato same-origin e senza `Origin`; quote da 20 e 10 rispettate al richiesto; 40
`rilancio` di fila scartati oltre i primi 5 con **un solo** avviso e senza disconnettere il
socket, che torna operativo dopo un secondo. Diff di `app.js` 23/536 righe, recuento LF-only
invariato (240/19/210).

**Non verificato**: comportamento dietro il proxy reale di Hostinger (`trust proxy`), e i limiti
con utenti veri loggati (in locale non ci sono le variabili Supabase).

## Prima del prossimo deploy

1. ~~Protezione password compromesse (HaveIBeenPwned)~~ — **non disponibile**: e' una funzione
   dei piani a pagamento. In sostituzione l'utente ha imposto una **lunghezza minima di 10
   caratteri**. Il linter di Supabase continuera' a segnalare quel WARN per sempre: e' atteso,
   non una svista.
   **Non c'e' nient'altro da configurare sul login**: l'endpoint `/auth/v1/token` e' limitato per
   IP (1800/ora, raffiche 30) e NON e' regolabile — una raccomandazione precedente diceva il
   contrario ed era sbagliata, vedi la correzione in DECISIONS.md. La sola difesa aggiuntiva
   possibile sarebbe il CAPTCHA, che richiede codice e un provider esterno: sproporzionato per
   una lega privata, da riconsiderare solo se la registrazione venisse aperta.
2. Dopo il primo deploy, controllare i log per righe `[CORS] Handshake socket rifiutato` — se ne
   compaiono con l'origine legittima del sito, impostare `ORIGINI_CONSENTITE` su Hostinger.
3. Le quote in memoria si azzerano a ogni riavvio/deploy: è voluto, non un bug.

## Debito tecnico riconosciuto (non pagato di proposito)

- `style.css` difende la zona puja con `!important` su tutti i breakpoint (897 occorrenze su 504
  righe in tutto il file), quindi `tema-serata.css` deve vincerle con `html body #puja-panel-slot`
  + `!important`. **Il blocco `@media (min-width:901px)` in fondo è stato sfrondato il 2026-08-26**:
  le sue regole per la vista Partecipante erano morte e sono state tolte, verificando a runtime che
  nelle due viste per tutti e quattro i temi non cambiasse un pixel.
  **Attenzione, la vecchia nota diceva di togliere il blocco INTERO ed era sbagliata**: le tre
  regole `body.layout-admin` sono vive, e toglierle cambia davvero il tasto RILANCIA dell'Admin.
  È anche il motivo per cui il resto della ripulitura non è stato fatto in blocco: in questa zona
  "sembra morto" e "è morto" non coincidono, e l'unico modo di saperlo è cancellare la regola dal
  CSSOM a runtime e confrontare i valori calcolati nelle due viste per i quattro temi. Si può fare,
  ma va fatto una regola per volta e con quella misura in mano — non a vista.
- ~~`app.js` chiama `/api/player-photo`~~ — **la nota era sbagliata**: quella funzione non veniva
  chiamata da nessuno, quindi nessun 404 partiva davvero. Era codice morto, insieme ad altre 13
  funzioni della vecchia catena foto da fonti esterne (SportsDB/Wikidata/Wikipedia/API-Football),
  abbandonata quando si è deciso di usare solo le foto locali verificate a mano. **Rimosse tutte
  il 2026-08-26**: 214 righe.

## Pendenze

- **Mai provato end-to-end in un'asta vera**: login Supabase, più dispositivi, modali critici
  (svincolo, conferma RIC, plusvalenza/recompra, annulla storico), il blocco popup-pendente. È il
  limite noto di tutte le sessioni finora — non ci sono credenziali di test.
- ~~Schermate Strategie, Editor Fasce e Griglia P/A mai guardate nei quattro temi~~ — **fatto** il
  2026-08-26. Strategie ed Editor Fasce usavano già `.card`, quindi un piano ce l'avevano; la
  Griglia P/A no, ed è stata vestita — piano, righe della classifica, tab, toggle e sub-tab (vedi
  sotto). Adesso tutte e tre parlano la lingua dei quattro temi.
- **JaaS è configurato in produzione, ma la chiamata non è ancora stata provata da nessuno.**
  Le tre variabili d'ambiente (`JAAS_APP_ID`, `JAAS_KID`, `JAAS_PRIVATE_KEY`) sono su Hostinger e
  `GET /api/chiamata/config` risponde `attiva:true`, che dal 2026-09-02 significa anche che la
  chiave privata si apre davvero, non solo che c'è scritto qualcosa. Quindi il bottone "🎥
  Chiamata" **è visibile a tutti** in produzione: la prima volta che qualcuno lo preme sarà un
  uso reale, non un test controllato. Se qualcosa non va, fallisce con un avviso e **l'asta non
  ne risente**: sono due connessioni separate.
  **Da provare (l'utente lo farà con la compagna, che è chi gestisce le aste):** due persone, dai
  dispositivi che useranno davvero, chiamata aperta venti minuti. Serve a due cose — che funzioni,
  e soprattutto **che a 5 minuti NON si tagli** (era il muro dell'istanza pubblica). Subito dopo,
  guardare la sezione **Activity** della consola JaaS: dice quanti dispositivi sono stati
  consumati per davvero, e chiude la domanda se le due leghe stanno dentro i 25 gratuiti — finora
  è una stima, non un dato.
- **La videochiamata non è mai stata provata davvero.** Qui non c'è camera né microfono, e non ha
  senso far entrare un partecipante finto in una stanza pubblica. Da provare voi, **non la sera
  dell'asta**: qualità con 12+ persone, tenuta di una sessione lunga sull'istanza pubblica gratuita
  di Jitsi (che non dà nessuna garanzia — è il motivo per cui il fornitore sta in una funzione sola)
  e il permesso del microfono su iPhone, dove il link va aperto in Safari e non nel browser interno
  di WhatsApp.
- **L'apertura vera di una scheda del browser non è mai stata provata** (`window.open` in
  `vista-esterna.js`): il browser integrato usato per la verifica blocca i pop-up sempre, quindi
  di quel ramo si è visto solo l'avviso all'utente. Tutto il resto del modulo è stato provato sul
  codice reale contro un `Window`/`Document` veri. Basta un click sul bottone "⧉ Apri a parte" in
  un browser normale per chiudere questa pendenza.

## Prossimo passo

Aprire un'asta di test reale, idealmente con 2+ dispositivi, e guardare in ordine: la schermata
asta nei quattro temi, i modali di svincolo/plusvalenza/recompra con dati veri (incluso il blocco
popup-pendente), i comportamenti della puja (leva su RILANCIA, drag & drop e Autorellenar in
Anteprima), che l'antiflood da 5 rilanci/secondo non dia fastidio a chi rilancia in fretta davvero
negli ultimi secondi di una puja combattuta, e — nuovo — che con la pagina che scorre la striscia
di puja resti sempre raggiungibile mentre si guardano le Rose, e che il bottone "⧉ Apri a parte"
apra davvero una scheda.

## Regola da non dimenticare: non si nasconde informazione

Per far entrare il nome della squadra in colonne strette era stato messo un
`@container (max-width:250px){ .sq-bottom{display:none} }`: spariva la riga `Tot: n/25 🧤 🔓`.
L'utente se n'è accorto subito. Compattare il layout è legittimo, **eliminare un dato per far
spazio no**: se due informazioni non stanno su una riga, si usa una riga in più. Vale per tutta
l'app, ed è il motivo per cui ogni intervento sul layout ora finisce con un controllo che conta
i dati a schermo a ogni larghezza.
