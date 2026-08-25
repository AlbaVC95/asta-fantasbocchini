# SESSION_SUMMARY.md

Stato corrente del progetto. Questo file è **memoria di lavoro, non storico**: va sovrascritto,
non accumulato. La cronologia sta in `git log`, il *perché* delle scelte in
[DECISIONS.md](../DECISIONS.md), stack e convenzioni in [PROJECT.md](../PROJECT.md).

## Stato attuale

Branch `main`, allineato con `origin/main`. Deploy automatico su Hostinger al push su `main`.
Il giro di sicurezza e il fix delle etichette in Anteprima (vedi sotto) sono **committati e
pushati** il 2026-08-25 (commit `18b0bb9`), quindi in produzione.

**Quattro temi attivi** (`serata` default, `cuoio`, `lavagna`, `sala-giochi`), tutti con lo stesso
pattern (ruoli `--sc-*` in `tema-serata.css` + token base in `style.css`, entrambi con un blocco
`[data-tema="<id>"]`, + una sezione "materie" in fondo a `tema-serata.css`; una riga in `TEMI` in
`app.js` e, se la clessidra resta visibile, una voce in `MATERIALI` di `clessidra.js`).
L'attributo è `data-tema="<id>"` su `<html>`, il selettore è il menu 🎨. Home, Lobby, Strategie,
Editor Fasce, Anteprima e Griglia P/A ereditano i token globali senza regole per schermata.

**Promemoria operativi che non scadono:**

1. **Font-size nella zona puja (`#puja-panel-slot`/`.asta-row-puja`) deve sempre usare `cqw`, mai
   `vw`**: il container "sala" (`#asta-main-col`) si dimezza quando si apre Anteprima senza che la
   finestra cambi — una regola in `vw` resta tarata sulla finestra e può arrivare a rompere il
   layout (nome del giocatore a capo lettera per lettera, bug reale già capitato).
2. **I 3 file con righe LF-only** (`frontend/js/app.js`, `frontend/index.html`,
   `frontend/css/style.css`) non vanno mai editati con l'Edit tool standard — vedi PROJECT.md per
   il procedimento (script Python, verificare lo stile di fine riga ESATTO del punto
   d'inserimento, non assumerlo uniforme, e ricontare le righe LF-only prima e dopo).
3. **Per usare una foto vera** (non un'imitazione CSS) serve che sia l'utente a salvarla su disco
   e dire il nome del file: nessun tool di Claude Code può esportare un'immagine incollata in
   chat. Poi si copia in `frontend/img/backgrounds/` e si referenzia con `url(...)` + `?v=N`
   manuale (Hostinger serve gli statici con cache `immutable` di 30gg).
4. **Non vale più il vecchio promemoria "se un colore non torna, controlla `theme_overrides`"**:
   l'Editor Visuale di Stile che scriveva quella riga è stato eliminato (vedi sotto). La riga
   `default` resta nel database, vuota, ma nessuno la legge più.

Per portare online o tornare indietro: **[docs/DEPLOY_TEMA.md](DEPLOY_TEMA.md)** — attenzione, è
fermo al vecchio toggle binario chiaro/scuro e alla palette chiara precedente, va riscritto per i
quattro temi prima del prossimo deploy importante.

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

## Cambi recenti — il cabinato diventa un disegno SVG (2026-08-25)

Dopo due giri respinti dall'utente ("si vede molto uguale"), il mobile e' stato rifatto come
**disegno SVG sovrapposto alla foto**, con la finestra dello schermo ritagliata a buco. I
gradienti CSS non potevano bastare: sanno fare bande e pallini, non la SAGOMA (spalle
arrotondate, bisel del monitor, cruscotto che sporge, sportello dei gettoni), ed e' la sagoma a
far riconoscere una macchina da sala giochi.

Il ritratto **cresce in altezza** (rapporto 100:166): su un cabinato vero lo schermo e' ~60% del
frontale, quindi nel riquadro di prima la faccia sarebbe scesa al ~38%. Cosi' invece la finestra
resta grande quanto la foto di prima (135x183 contro 138x177). Solo in altezza — allargarlo
avrebbe richiesto di toccare il `padding-left` di `.chiamata-card` in ogni breakpoint.

Niente misure per breakpoint: `aspect-ratio` lega l'altezza alla larghezza e la foto si posiziona
con percentuali di `inset`. Tre trappole CSS incontrate lungo la strada (percentuali di padding
che si misurano sul contenitore, `width:auto` sugli `<img>` assoluti, un ID che batte le classi
nel solo ramo Admin) sono documentate in [DECISIONS.md](../DECISIONS.md).

**Verificato** a 1:1: cabinato in Admin e utente a tutte le larghezze di colonna, foto sempre
dentro la finestra, nessun ritaglio, i tre temi non-arcade intatti (178x226), cabinato spento e
rapporto originale ripristinato sotto i 700px.

## Cambi recenti — cabinato piu' elaborato (2026-08-25)

Su richiesta dell'utente il cabinato attorno al ritratto e' ora una macchina da sala giochi vera:
lampadine sull'insegna, griglia dell'altoparlante, schermo a tubo catodico con righe di scansione
e vignettatura, leva con piastra e riflesso, tasti bombati, gettoniera, zoccolo, montanti.

**Struttura invertita rispetto al primo tentativo**: il mobile ESSENZIALE e' la regola base (Admin
e utente), il dettaglio ricco si aggiunge solo in `@container sala (min-width:1201px)`. Motivo
misurato: col dettaglio ovunque, la faccia scendeva al 48% dell'area sulla scatola da 112px e al
51% su quella dell'Admin. Ora sta al **58-61% a ogni misura**. La lista degli strati ricchi vive
in un solo punto, non duplicata fra le due viste.

**Verificato** a 1:1 in browser: dettaglio completo solo sulla carta grande, essenziale altrove,
cabinato spento sotto i 700px di finestra, i tre temi non-arcade intatti (padding 0).

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

## Cambi recenti — cabinato attorno al ritratto in "sala-giochi" (2026-08-25)

Richiesta dell'utente: cornice a forma di macchina da sala giochi attorno alla foto del giocatore,
senza occupare piu' spazio. Solo il ritratto della carta di puja (Admin e Partecipante), non le
miniature. Marquise a tacche d'oro, montanti cobalto, cruscotto con leva a sinistra e tre tasti a
destra — otto strati di `background`, perche' `::before`/`::after` di `.cc-avatar` sono gia' usati
dal tema. Costruito **verso l'interno** (`box-sizing:border-box` + `padding`): la scatola esterna
resta identica in tutti e quattro i temi, a rimpicciolirsi e' solo la foto.

**Errore ripetuto e corretto**: le soglie erano su `@media`, ma il ritratto rimpicciolisce per
`@container sala` — stesso sbaglio del Riepilogo squadre poche ore prima. Con le soglie giuste la
foto resta al 61-68% dell'area a ogni misura invece di scendere al 54%. Sotto i ~70px il cabinato
si spegne del tutto. **Attenzione**: ispezionarlo col `zoom` del browser inganna (il `zoom`
rimpicciolisce anche il container e fa scattare le soglie strette) — vedi DECISIONS.md.

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

## Cambi recenti — pastiglia del nome in Anteprima (2026-08-25)

Segnalato dall'utente sul tema "sala-giochi": il cartellino bianco dietro al nome del giocatore
non copriva tutto il nome. **Non era un difetto del tema**: `.ant-slot3d-label` era larga quanto
la carta e sempre uguale (`left:0;width:100%`) mentre il testo, in uno span `width:auto` con
etichetta a `overflow:visible`, cambiava larghezza col nome — quindi il difetto c'era in tutti e
quattro i temi, ma su prato chiaro con bordo nero si vedeva e su fondo scuro no. Corretto con una
regola sola (`width:max-content` + `left:50%` + `translateX(-50%)`, ristretta con
`:has(.ant-slot3d-name-txt)` per non toccare i badge degli slot vuoti). Dettagli e metodo in
[DECISIONS.md](../DECISIONS.md).

**Verificato** in browser reale, riproducendo prima il bug e misurandolo: pastiglia fissa a
42.3px contro nomi fino a 62.5px (CARNISECCHI sbordava di 20.2px); dopo la correzione lo sbordo
è **zero su tutti gli 11 nomi**, in tutti e quattro i temi, a 980px e a 371px, senza nessuna
sovrapposizione fra etichette vicine. Diff: 24 righe aggiunte, 0 rimosse.

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
   non una svista. Copre pero' una minaccia diversa (vedi DECISIONS.md) — la leva ancora
   disponibile e gratuita sono i **Rate Limits di Supabase Auth** (pannello -> Authentication ->
   Rate Limits), che sono l'unica difesa sul login: `signInWithPassword`/`signUp` vanno dal
   browser DIRETTAMENTE a Supabase e non passano mai dal rate limiting del backend.
2. Dopo il primo deploy, controllare i log per righe `[CORS] Handshake socket rifiutato` — se ne
   compaiono con l'origine legittima del sito, impostare `ORIGINI_CONSENTITE` su Hostinger.
3. Le quote in memoria si azzerano a ogni riavvio/deploy: è voluto, non un bug.

## Debito tecnico riconosciuto (non pagato di proposito)

- `style.css` difende la zona puja con ~40 regole `!important` su tutti i breakpoint, quindi
  `tema-serata.css` deve vincerle con `html body #puja-panel-slot` + `!important`. Ripulirle è il
  lavoro successivo naturale, tenuto fuori dagli interventi estetici per non mescolare un refactor
  rischioso con un cambio di aspetto. Nello stesso giro si può togliere il blocco
  `@media (min-width:901px)` in fondo a `style.css` (commit `039206b`).
- `app.js` chiama `/api/player-photo`, una rotta che **non esiste** nel backend: la richiesta cade
  sempre in 404 e si passa al fallback successivo della catena foto. Funziona per caso, andrebbe
  tolta o implementata.

## Pendenze

- **Mai provato end-to-end in un'asta vera**: login Supabase, più dispositivi, modali critici
  (svincolo, conferma RIC, plusvalenza/recompra, annulla storico), il blocco popup-pendente. È il
  limite noto di tutte le sessioni finora — non ci sono credenziali di test.
- Schermate Strategie, Editor Fasce e Griglia P/A: ereditano la palette ma non sono state guardate
  una per una in tutti e quattro i temi.
- [docs/DEPLOY_TEMA.md](DEPLOY_TEMA.md) descrive ancora il vecchio toggle binario — da riscrivere.
- Ripristinare `.cc-strategia-info` su mobile: è l'unico `display:none` del tema che tocca
  contenuto vero e non decorazione.
- Nel tema **scuro** il grigio più tenue (`--sc-tenue`) resta a 3.4:1 su testi da 9-10px. È così
  da quando il tema è online, non è una regressione, ma si schiarisce con una riga.

## Prossimo passo

Aprire un'asta di test reale, idealmente con 2+ dispositivi, e guardare in ordine: la schermata
asta nei quattro temi, i modali di svincolo/plusvalenza/recompra con dati veri (incluso il blocco
popup-pendente), i comportamenti della puja (leva su RILANCIA, drag & drop e Autorellenar in
Anteprima) e — nuovo — che l'antiflood da 5 rilanci/secondo non dia fastidio a chi rilancia in
fretta davvero, durante gli ultimi secondi di una puja combattuta.

## Regola da non dimenticare: non si nasconde informazione

Per far entrare il nome della squadra in colonne strette era stato messo un
`@container (max-width:250px){ .sq-bottom{display:none} }`: spariva la riga `Tot: n/25 🧤 🔓`.
L'utente se n'è accorto subito. Compattare il layout è legittimo, **eliminare un dato per far
spazio no**: se due informazioni non stanno su una riga, si usa una riga in più. Vale per tutta
l'app, ed è il motivo per cui ogni intervento sul layout ora finisce con un controllo che conta
i dati a schermo a ogni larghezza.
