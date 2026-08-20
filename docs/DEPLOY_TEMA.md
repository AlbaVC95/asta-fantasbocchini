# Deploy del tema "Serata d'Asta"

Guida operativa per portare online il nuovo tema. Pensata per essere letta a freddo,
senza rileggere la conversazione in cui è nato.

Per il *perché* delle scelte vedi [DECISIONS.md](../DECISIONS.md).

---

## Cosa cambia, in una riga

L'identità visiva passa da viola-neon-oro (che sembrava un'app di scommesse) a una sala
di sera con una sola lampada accesa. **Nessuna regola di gioco è stata toccata.**

## File coinvolti

| File | Stato | Cosa fa |
|---|---|---|
| `frontend/css/style.css` | modificato (solo il blocco `:root`) | la palette. Cambiano i valori, i nomi delle variabili restano identici |
| `frontend/css/tema-serata.css` | **nuovo** | la composizione: scena della puja, griglia squadre, schede, vista Admin |
| `frontend/js/clessidra.js` | **nuovo** | disegna la clessidra e le legge il livello. Sempre attivo, ma solo cosmetico |
| `frontend/js/comportamenti-asta.js` | **nuovo** | i tre comportamenti nuovi — **attivi** |
| `frontend/index.html` | modificato (4 righe) | carica i font nuovi, il foglio del tema, la clessidra, il modulo |

Backend, Socket.io, Supabase, autenticazione, `calcolaMaxOfferta()`, svincoli, backup:
**non toccati**. Nessun file in `backend/` è stato modificato.

### Sulla clessidra: perché è JavaScript e perché è sicura

Il cronometro non è più un anello ma una clessidra in SVG (vetro con riflessi,
ghiere in ottone, sabbia con la grana, mucchio che cresce in basso). Il CSS da solo
non può sapere quanta sabbia resta, quindi serve un file JS — ma quel file **non
calcola niente**: osserva con un `MutationObserver` passivo l'attributo
`stroke-dashoffset` che l'app già scrive sul vecchio anello, e ne ricava la
frazione. Non sostituisce né avvolge nessuna funzione dell'app, non tocca lo stato
di gioco, non parla col server. Se `clessidra.js` non venisse caricato, l'asta
funzionerebbe identica (si vedrebbe l'anello vecchio, nascosto dal CSS).

---

## Come si mette online

Il deploy su Hostinger è automatico al push su `main`. Quindi:

```bash
git checkout main
git merge claude/fantabar-visual-directions-64b4h6
git push origin main
```

Da lì Hostinger fa il resto. Non serve altro.

> Tema e comportamenti sono entrambi attivi appena sale.

## Come si torna indietro

Tre livelli, dal più leggero al più netto.

**1. Spegnere solo il tema, lasciando tutto il resto** — commenta una riga in
`frontend/index.html`:

```html
<!-- <link rel="stylesheet" href="css/tema-serata.css?v=..."> -->
```

Torna la composizione vecchia, resta la palette nuova.

**2. Tornare del tutto all'aspetto precedente** — oltre alla riga sopra, ripristina il
blocco `:root` di `style.css`:

```bash
git checkout <commit-precedente> -- frontend/css/style.css
```

**3. Annullare tutto** — il merge è un commit solo:

```bash
git revert -m 1 <hash-del-merge>
git push origin main
```

---

## I comportamenti nuovi (attivi)

`comportamenti-asta.js` aggiunge tre cose, ed e' **acceso**.

Per spegnerlo, in console del browser:

```js
localStorage.setItem('fantabar_comportamenti', '0')   // poi ricarica
localStorage.removeItem('fantabar_comportamenti')     // per riaccenderlo
```

| Cosa | Rischio | Perche' |
|---|---|---|
| **La stanza si stringe** — sotto i 5 secondi il resto della schermata sfoca e resta solo prezzo/tempo/azione | basso | solo CSS guidato da un attributo |
| **"Ancora in gioco"** — quante squadre possono ancora coprire l'offerta | nessuno | additivo, sola lettura, dati che il client gia' riceve |
| **La leva** — RILANCIA si tiene premuto e l'importo sale | contenuto (vedi sotto) | il tocco singolo resta identico a prima |

### Come si comporta la leva, esattamente

- **Tocco breve** (< 260 ms): il modulo **non fa nulla**. Il rilancio lo manda il
  click handler originale dell'app, `inviaRilancioRapido(1)`, come sempre.
- **Tenuta**: l'importo sale accelerando; al rilascio parte un `socket.emit('rilancio')`
  con lo stesso identico payload dell'app (`{ astaId, offerta }`), e il click dell'app
  viene soppresso in fase di capture — cosi' **un gesto = un rilancio, mai due**.
- L'importo e' limitato da `getMaxOfferta()`, la stessa funzione che l'app usa per
  l'hint in UI: tenendo premuto all'infinito ci si ferma al massimo consentito.
- Prima di emettere si passa da `canBid()`, lo stesso guard dell'app.

Il server continua comunque a validare ogni rilancio con `calcolaMaxOfferta()`:
il limite lato client e' comodita', non sicurezza.

### Effetto collaterale noto

Con "la stanza si stringe", negli ultimi 5 secondi i crediti dei rivali si sfocano —
proprio quando potresti volerli guardare. E' deliberato, e il contatore "ancora in
gioco" in testata resta leggibile per compensare. Se da' fastidio, e' una riga in
`tema-serata.css`: cerca `[data-fase="finale"] .panel-budget`.

---

## Cosa è stato verificato e cosa no

**Verificato** (app reale servita da `npm run dev`, CSS letto dal disco, stato di gioco
sintetico iniettato in console — nessuna finta):

- Schermata asta, vista partecipante — desktop e mobile
- Schermata asta, vista Admin
- Home, lobby, fine asta
- Un modale (`Mia rosa`): contrasto corretto, fondo `#191411` su testo `#F2EADE`
- Con 6 e con 12 squadre: la griglia orizzontale regge in entrambi i casi
- Nessun errore JavaScript in console
- La clessidra con la sabbia piena, a metà e agli ultimi secondi: il livello segue
  il tempo reale dell'app (letto dall'anello nascosto), il getto si spegne a sabbia
  finita, sotto i 5 secondi la sabbia diventa rossa e il getto accelera
- L'insegna al neon (accensione a scatti e poi fissa) in testata e sulla Home
- Riepilogo squadre: due righe per squadra invece di tre (riga 1: pallino, nome, crediti;
  riga 2: `Tot: n/25`, portieri, svincoli). È una griglia a due righe fisse, non un flex che
  va a capo, così l'altezza è identica per tutte le squadre e a cedere è solo il nome, con i
  puntini. Misurato con 12 squadre a 2000/1440/1100/430px, vista Admin e partecipante:
  nome e conteggi sempre visibili, nessun dato tagliato
- I sei `display:none` del tema colpiscono solo pseudo-elementi decorativi (il riflesso
  dorato, il glow, il pallone del cronometro, l'emoji del logo) — nessuno nasconde
  qualcosa di funzionale

**NON verificato** — da guardare al primo giro vero:

- Un'asta live reale con login Supabase e più dispositivi (limite noto di tutte le
  sessioni: non erano disponibili credenziali di test)
- I modali critici con dati veri: **svincolo**, conferma RIC, plusvalenza/recompra,
  annulla storico
- Le schermate Strategie, Editor Fasce, Anteprima, Griglia P/A: ereditano la palette
  dalle variabili ma non sono state guardate una per una
- L'asta live vera con Anteprima aperta su piu' dispositivi (il reflow e' verificato in locale)

## Tema chiaro — "Mattina al banco"

Riadattato: bianco per i piani, argento e grigio perla per l'ombra, ottone per l'unico
accento (lo stesso metallo della lampada del tema scuro, spento). Non c'e' piu' viola da
nessuna parte.

I colori del tema strutturale sono ora **ruoli** (`--sc-testo`, `--sc-ambra`, `--sc-carta`…)
definiti due volte in `tema-serata.css`: `:root` per la sera, `html.theme-light` per il
giorno. Le regole di composizione restano una serie sola. Le materie che non si possono
capovolgere con una variabile — i fondi a gradiente, il vetro della clessidra, l'insegna —
hanno la loro versione chiara nella sezione "MATTINA AL BANCO" in fondo al foglio.

Contrasto misurato su tutti i testi della schermata asta: nessuno sotto 4.5:1 (3:1 per i
corpi grandi). Nel tema **scuro** invece il grigio piu' tenue (`--sc-tenue`, `#6E645A`)
resta a 3.4:1 su testi da 9-10px: e' cosi' da quando il tema e' online, non e' una
regressione, ma se da fastidio si schiarisce cambiando una riga.

**Perdita di informazione nota**: su mobile il tema nasconde `.cc-strategia-info` (l'info
di fascia della Strategia sulla carta chiamata). È l'unico `display:none` che tocca
contenuto vero, non decorazione. Cerca `cc-strategia-info` in `tema-serata.css` per
rimetterla.

---

## Se qualcosa si rompe

Il sospetto numero uno è la specificità CSS: `style.css` difende la zona puja con circa 40
regole `!important` sparse su tutti i breakpoint, e `tema-serata.css` deve vincerle usando
`html body #puja-panel-slot` + `!important`. Se a una certa larghezza qualcosa torna viola
o si scompone, è quasi certamente un breakpoint di `style.css` non coperto.

Ripulire quelle regole è il lavoro successivo naturale — **volutamente non fatto adesso**,
per non mescolare un refactor rischioso con una modifica estetica.
