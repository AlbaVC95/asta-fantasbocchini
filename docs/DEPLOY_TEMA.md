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
| `frontend/js/comportamenti-asta.js` | **nuovo** | i tre comportamenti nuovi — **spento di default** |
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

> Il tema è già attivo appena sale. I comportamenti no — vedi sotto.

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

## I comportamenti nuovi (opzionali, spenti)

`comportamenti-asta.js` aggiunge tre cose. **Non si accendono da sole.**

Per provarli, in console del browser:

```js
localStorage.setItem('fantabar_comportamenti', '1')   // poi ricarica
localStorage.removeItem('fantabar_comportamenti')     // per spegnerli
```

| Cosa | Rischio | Perché |
|---|---|---|
| **La stanza si stringe** — sotto i 5 secondi il resto della schermata sfoca e resta solo prezzo/tempo/azione | basso | solo CSS guidato da un attributo |
| **"Ancora in gioco"** — quante squadre possono ancora coprire l'offerta | nessuno | additivo, sola lettura, dati che il client già riceve |
| **La leva** — RILANCIA si tiene premuto e l'importo sale | **da provare prima** | vedi sotto |

### Perché la leva va provata prima

Nessuna regola viene aggirata: l'evento emesso resta `'rilancio'` e il server continua a
validare con `calcolaMaxOfferta()`. Il rischio è **d'uso, non di correttezza** — si può
superare l'importo voluto tenendo premuto mezzo secondo di troppo.

Prima di darla alla lega, in un'asta di test: verificare che tenendo premuto a lungo
l'importo si fermi al massimo offribile e che il rilascio mandi esattamente la cifra
mostrata sul tasto.

### Effetto collaterale noto

Con "la stanza si stringe" attiva, negli ultimi 5 secondi i crediti dei rivali si sfocano —
proprio quando potresti volerli guardare. È deliberato, e il contatore "ancora in gioco"
in testata resta leggibile per compensare. Se dà fastidio, è una riga in
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
- Riepilogo squadre: una riga per squadra invece di tre — con 12 squadre sta in
  quattro righe invece di riempire mezza schermata
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
- Il tema chiaro (`html.theme-light`): esiste nel CSS ma non è stato riadattato, quindi
  probabilmente è incoerente. Se qualcuno della lega lo usa, va sistemato o disabilitato

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
