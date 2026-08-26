# Deploy dei temi

Guida operativa per portare online un cambio di tema e per tornare indietro. Pensata per
essere letta a freddo, senza rileggere la conversazione in cui è nata.

Per il *perché* delle scelte vedi [DECISIONS.md](../DECISIONS.md); per lo stato attuale del
progetto [SESSION_SUMMARY.md](SESSION_SUMMARY.md).

---

## Come funziona, in una riga

Un solo foglio (`tema-serata.css`) contiene **quattro temi**. Quale sia attivo lo decide
l'attributo `data-tema` su `<html>`; lo sceglie l'utente dal menu 🎨 e resta in
`localStorage`. Non c'è niente da configurare sul server.

| `data-tema` | Nome | Luce | Accento | Font |
|---|---|---|---|---|
| `serata` (default) | Serata d'Asta | scuro | ambra | Archivo + Space Mono |
| `cuoio` | Cuoio | chiaro | cuoio, verde solo per il denaro | Archivo + Space Mono |
| `lavagna` | Lavagna al Neon | scuro | ciano struttura, magenta brand/denaro | **Caveat + Kalam** (gesso), Pacifico per l'insegna |
| `sala-giochi` | Sala Giochi | chiaro | cobalto, oro solo per il denaro | **Press Start 2P + Silkscreen** |

Le **regole di composizione** (griglie, misure, container query) sono una serie sola valida
per tutti e quattro: da tema a tema cambiano solo le *materie* — colori, fondi, caratteri.

## File coinvolti

| File | Cosa fa |
|---|---|
| `frontend/css/style.css` | il foglio storico: palette in `:root`, layout, tutti i breakpoint |
| `frontend/css/tema-serata.css` | composizione + le materie dei quattro temi. Caricato **dopo** style.css |
| `frontend/js/clessidra.js` | disegna la clessidra del cronometro (SVG). Legge il tempo, non lo calcola |
| `frontend/js/comportamenti-asta.js` | i comportamenti aggiuntivi della puja — **attivi** |
| `frontend/index.html` | carica i font, i fogli e i moduli, e porta i `?v=` |

Backend, Socket.io, Supabase, autenticazione, `calcolaMaxOfferta()`, svincoli, backup:
**mai toccati da un cambio di tema**.

---

## ⚠️ Prima di pushare: i due cache-busting

Sono la causa più probabile di "ho deployato ma non si vede niente".

**1. CSS e JS.** `index.html` li carica con `?v=<timestamp>`. Dopo *qualunque* modifica a
`style.css`, `tema-serata.css`, `app.js`, `clessidra.js` o `comportamenti-asta.js` bisogna
alzare a mano il `?v=` di quel file:

```html
<link rel="stylesheet" href="css/tema-serata.css?v=1787731305818">
```

**2. Le immagini richiamate dai CSS con `url(...)`.** Hostinger serve gli statici con
`cache-control: public, max-age=2592000, immutable`: chi ha già scaricato una di quelle foto
non la richiede più per 30 giorni, **nemmeno con un hard refresh**. Se sostituisci il
contenuto di un file tenendo lo stesso nome (`pizarra-lavagna.jpeg`, `pelota-cuoio.jpeg`,
`fondo-cuoio.jpeg`), alza il `?v=N` in **ogni** punto dove è referenziato:

```bash
grep -n "pizarra-lavagna" frontend/css/*.css
```

## Come si mette online

Il deploy su Hostinger è automatico al push su `main`. Non c'è nessun passo manuale dopo.

```bash
git push
```

## Come si torna indietro

Dal più leggero al più netto.

**1. Spegnere i temi, tenendo l'app** — commenta una riga in `frontend/index.html`:

```html
<!-- <link rel="stylesheet" href="css/tema-serata.css?v=..."> -->
```

Resta la composizione di `style.css`. È il rollback più sicuro: non tocca il gioco.

**2. Annullare gli ultimi commit** — la cronologia è lineare (i merge dei rami di lavoro si
fanno in fast-forward), quindi **non** serve `git revert -m 1`, che vale solo per i merge
commit:

```bash
git revert <hash>        # un commit solo
git revert <da>..<a>     # una serie
git push
```

**3. Se un tema è rotto ma gli altri no** — non serve nessun deploy: chi lo sta usando cambia
tema dal menu 🎨. È il vantaggio di avere l'attributo su `<html>` invece che un build.

---

## Aggiungere o modificare un tema

Un tema è fatto di cinque pezzi, tutti obbligatori:

1. **I ruoli colore** — un blocco `html[data-tema="<id>"]{ --sc-*: … }` in cima a
   `tema-serata.css` (accanto agli altri tre).
2. **I token base** — il corrispondente blocco `[data-tema="<id>"]` in `style.css`.
3. **Le materie** — una sezione in fondo a `tema-serata.css`: fondi, bordi, ombre, e tutto
   ciò che una variabile non può capovolgere da sola.
4. **La voce nel menu** — una riga in `TEMI` dentro `app.js`.
5. **La clessidra** — se resta visibile, una voce in `MATERIALI` di `clessidra.js`: i
   gradienti SVG hanno gli `stop-color` fissi, il CSS non li raggiunge.

### Se il tema cambia anche i caratteri

Due cose in più, ed è facile dimenticarle:

- **Aggiungi la famiglia al `<link>` di Google Fonts** in `index.html`. Se manca, il browser
  ripiega in silenzio su un fallback e sembra che il CSS non funzioni.
- **Non basta ridefinire `--font-main` / `--font-display`.** Il foglio di tema riscrive
  `'Archivo'` e `'Space Mono'` a mano dentro ~43 regole con `!important`, che nessuna
  variabile raggiunge: per quelle serve un elenco esplicito di selettori, prefissato con
  `html[data-tema="<id>"]` per vincere di specificità. Vedi come lo fanno `lavagna` e
  `sala-giochi`.
- **`--font-mono` non si tocca**: il link da copiare (`.link-text`), le colonne numeriche
  della Griglia P/A e i `<code>` usano il monospazio per allineamento, non per estetica.
- **Misura la larghezza prima di adottare un carattere in una vista densa.** Silkscreen
  applicato a tutto aveva allargato tre colonne delle Rose del 36%, cioè meno squadre a
  schermo. Il metodo è in DECISIONS.md.

### Regole che valgono per tutti i temi

- **Nella zona puja le font-size si scrivono in `cqw`, mai in `vw`.** Il container "sala"
  (`#asta-main-col`) si dimezza quando si apre Anteprima *senza che la finestra cambi*: una
  regola in `vw` resta tarata sulla finestra e arriva a spezzare il nome del giocatore
  lettera per lettera. È già successo.
- **Una soglia responsive deve misurare la scatola che contiene davvero il testo**, non un
  antenato che le somiglia. Tre bug con la stessa radice: il Riepilogo squadre in Admin, il
  cabinato di Sala Giochi (`@media` invece di `@container`) e il nome del giocatore a 1280px
  (misurava la sala invece della carta).
- **Non si nasconde un dato per fare spazio.** Se due informazioni non stanno su una riga, si
  usa una riga in più. Compattare è legittimo, eliminare no.
- **Se aggiungi una regola "più giusta" per un selettore che esiste già altrove nel file,
  cancella quella vecchia.** La specificità CSS non rispetta l'ordine di lettura: un ramo più
  specifico in una regola più vecchia continua a vincere. È già costato un bug invisibile in
  sola vista Partecipante.
- **`tema-serata.css` è interamente a LF** e va tenuto così (convertito il 2026-08-26 in un
  commit di sole fine riga). `app.js`, `index.html` e `style.css` hanno invece righe miste:
  vedi [PROJECT.md](../PROJECT.md) prima di editarli.

---

## Il modulo dei comportamenti (attivo)

`comportamenti-asta.js` aggiunge tre cose ed è **acceso**. Per spegnerlo, da console del
browser:

```js
localStorage.setItem('fantabar_comportamenti', '0')   // poi ricarica
localStorage.removeItem('fantabar_comportamenti')     // per riaccenderlo
```

| Cosa | Rischio | Perché |
|---|---|---|
| **La stanza si stringe** — negli ultimi secondi il resto della schermata sfoca e restano prezzo, tempo e azione | basso | solo CSS guidato da un attributo |
| **"Ancora in gioco"** — quante squadre possono ancora coprire l'offerta | nessuno | additivo, sola lettura, su dati che il client già riceve |
| **La leva** — RILANCIA si tiene premuto e l'importo sale | contenuto (vedi sotto) | il tocco singolo resta identico a prima |

### Come si comporta la leva, esattamente

- **Tocco breve** (< 260 ms): il modulo **non fa nulla**. Il rilancio lo manda il click
  handler originale dell'app, `inviaRilancioRapido(1)`, come sempre.
- **Tenuta**: l'importo sale accelerando; al rilascio parte un `socket.emit('rilancio')` con
  lo stesso identico payload dell'app (`{ astaId, offerta }`), e il click dell'app viene
  soppresso in fase di capture — così **un gesto = un rilancio, mai due**.
- L'importo è limitato da `getMaxOfferta()`, la stessa funzione che l'app usa per l'hint in
  UI, e prima di emettere si passa da `canBid()`, lo stesso guard dell'app.

Il server continua comunque a validare ogni rilancio con `calcolaMaxOfferta()`: il limite
lato client è comodità, non sicurezza.

### Le soglie del finale sono due, e sono diverse apposta

Il **rosso** scatta a 3 secondi, il **ticchettio sonoro** a 5. Non è una svista: è stato
confermato esplicitamente. Non "allinearle" credendo di correggere un bug.

### Effetto collaterale accettato

Con "la stanza si stringe" i crediti dei rivali si sfocano proprio negli ultimi secondi. È
deliberato, e il contatore "ancora in gioco" in testata resta leggibile per compensare. Se dà
fastidio è una riga in `tema-serata.css`: cerca `[data-fase="finale"] .panel-budget`.

### Sulla clessidra: perché è JavaScript e perché è sicura

Il CSS da solo non può sapere quanta sabbia resta, quindi serve un file JS — ma quel file
**non calcola niente**: osserva con un `MutationObserver` passivo l'attributo
`stroke-dashoffset` che l'app già scrive sul vecchio anello, e ne ricava la frazione. Non
sostituisce né avvolge nessuna funzione dell'app, non tocca lo stato di gioco, non parla col
server. Se `clessidra.js` non venisse caricato, l'asta funzionerebbe identica.

---

## Perdite di informazione note

- Su mobile il tema nasconde `.cc-strategia-info` (l'info di fascia della Strategia sulla
  carta chiamata). È l'unico `display:none` che tocca contenuto vero e non decorazione:
  cerca `cc-strategia-info` in `tema-serata.css` per rimetterla.

## Contrasto

Nel tema **scuro** il grigio più tenue (`--sc-tenue`, `#6E645A`) resta a 3.4:1 su testi da
9-10px. È così da quando il tema è online, non è una regressione, ma si schiarisce con una
riga. Gli altri tre temi sono stati misurati sopra 4.5:1 (3:1 per i corpi grandi).

## Per chi fa da admin durante l'asta

Se qualcuno dice **"ho premuto in tempo e non è passato"**, il rilancio è arrivato al server dopo
lo scadere del timer e viene respinto: non c'è nessuna finestra di tolleranza, e chi lo subisce non
vede il motivo — vede solo che ha perso il giocatore.

Il rimedio esiste già ed è il tasto **"Riapri asta"**, che rimette in gioco il giocatore *dal prezzo
attuale* o *da 1*. Usalo senza pensarci troppo: è lì per questo.

Quanto sia frequente dipende dalla rete di chi gioca, non dalla distanza. Fra Spagna, Italia e UK la
differenza di latenza fra i partecipanti è nell'ordine dei 30ms su una finestra di 1000 — sepolta
sotto il tempo di reazione umano, che varia molto di più. Quindi il caso vero non è la geografia: è
la sfuriata occasionale del wifi di casa. Se dopo un'asta vera risultasse frequente, allora avrebbe
senso valutare una finestra di tolleranza lato server (~400ms) nel gestore `rilancio`; farlo prima
significherebbe cambiare una regola di gioco per un problema mai osservato.

## Se qualcosa si rompe

Il sospetto numero uno è la **specificità CSS**: `style.css` difende la zona puja con circa
40 regole `!important` sparse su tutti i breakpoint, e `tema-serata.css` deve vincerle usando
`html body #puja-panel-slot` + `!important`. Se a una certa larghezza qualcosa si scompone, è
quasi certamente un breakpoint di `style.css` non coperto.

E non diagnosticare leggendo il CSS a occhio — la duplicazione storica del file lo rende
inaffidabile. Il modo certo per sapere quale regola vince davvero è iterare
`document.styleSheets` / `cssRules` nel browser reale e confrontare gli indici delle regole
che matchano `el.matches(selectorText)`.

Ripulire quelle `!important` è il lavoro successivo naturale — **volutamente non fatto**, per
non mescolare un refactor rischioso con una modifica estetica.
