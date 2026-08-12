# Redesign 3D del tool Asta — IMPLEMENTATO su branch `redesign/asta-3d`, non in produzione

**Stato: implementato e verificato in locale sul branch `redesign/asta-3d` (non mergiato su
`main`, non in produzione).** Branch di backup del punto di partenza:
`backup/pre-redesign-asta-3d`. Vedi [docs/SESSION_SUMMARY.md](SESSION_SUMMARY.md) per lo stato
sessione-per-sessione e cosa manca ancora prima di un eventuale merge.

Nasce dallo studio di fattibilità richiesto dall'utente (agosto 2026) su un redesign visivo del
tab "Anteprima" durante l'Asta: campo 3D isometrico, carte giocatore 3D, pannello Anteprima come
drawer laterale, animazione di assegnazione visibile a tutti i partecipanti. Il piano di
implementazione dettagliato (file critici, architettura, checklist QA) resta in
`/Users/alba/.claude/plans/bright-swimming-parnas.md`.

Riferimento visivo: mockup fornito dall'utente (stile "carte da collezione" + campo 3D con
formazione, pannello destro con dropdown "Tutte le squadre").

## Mockup visivo di riferimento (direzione finale raggiunta)

**[docs/redesign-asta-3d/anteprima-3d-mockup.html](redesign-asta-3d/anteprima-3d-mockup.html)** —
file HTML autonomo (apribile direttamente in un browser, nessuna dipendenza esterna, foto
giocatore incluse come base64) che mostra la direzione visiva concordata con l'utente dopo 6
iterazioni di feedback nella sessione del 2026-08-11. Non è codice dell'app, solo un prototipo
statico per referenza — vedi "Fasi di implementazione" sotto per come si collegherà ai dati reali.

Storia delle iterazioni (ognuna verificata in locale prima di essere mostrata all'utente):
1. Prima resa "stile FIFA": foto reali (illustrazioni "anime" già in `frontend/img/players/`),
   campo con luci da stadio.
2. Tolta la fascia colorata/rating in cima alla carta; ruolo/nome/squadra impilati in basso;
   carte sul campo rimpicciolite (nella v2 "affondavano" nel prato); stadio con torri faro e
   cielo notturno.
3. Foto meno ritagliata; ruolo spostato in un badge in alto a sinistra sopra la foto, che mostra
   la stringa intera anche con più ruoli (es. "DC/B", "M/C", "A/PC") — importante perché molti
   giocatori reali hanno più ruoli Mantra compatibili.
4. Foto a piena carta da bordo a bordo, zero margini laterali (`background-size:cover` su tutta
   l'altezza — le foto sorgente, 260×334px, hanno proporzioni molto vicine a quelle della carta).
5. Meno zoom mantenendo la piena larghezza (`background-size:100% auto` invece di `cover`): si
   vede l'immagine per intero (spalle comprese), il piccolo spazio residuo in basso si perde
   nell'overlay scuro del nome — **questa è la versione salvata nel file sopra.**

Decisioni di design confermate da portare nell'implementazione reale:
- Colore/tier della carta per **ruolo** (non per titolarità): riusa 1:1 la palette già esistente
  di `.badge-ruolo` in `style.css` (giallo Por, verde Dd/Ds/Dc/D/B, azzurro M/C/E, viola T/W,
  rosso A/Pc) — nessuna palette nuova da inventare.
- Badge ruolo in alto a sinistra sopra la foto, testo libero (mai troncare una stringa con più
  ruoli).
- Nessuna fascia/banner colorato pieno in cima alla carta: la foto domina, il colore di ruolo
  vive nel bordo/badge, non in uno sfondo pieno.
- Foto a piena larghezza carta, `background-size:100% auto` (non `cover`), per zero margini
  laterali e zero ritaglio verticale eccessivo.

## Decisione di scope (confermata con l'utente)

Il pannello "Anteprima" **fonde due concetti oggi separati**:
1. Il planner di formazione attuale (`localStorage`, personale, non sincronizzato) — dove l'utente
   pensa di schierare i propri giocatori.
2. La rosa realmente vinta in asta (dato già esistente e già sincronizzato in tempo reale, oggi
   mostrato altrove) — chi ha *davvero* comprato ogni giocatore.

Il nuovo pannello deve mostrare entrambe le cose in un'unica vista 3D, con un dropdown per
scegliere la squadra da guardare (propria o altrui, sola lettura per le altrui).

## Cosa NON cambia (vincolo assoluto)

- `_ruoliCompatibili()` / `_ruoloCorrispondente()` — [frontend/js/app.js:2889-2913](../frontend/js/app.js#L2889):
  logica di compatibilità R.MANTRA, funzioni pure (stringa ruolo → boolean/stringa). Riusate
  identiche, senza toccarne una riga.
- Il flusso socket `giocatore-assegnato`: emesso da `backend/server.js` in 6 punti (452, 1098,
  1202, 1166 riconferma, 1193 plusvalenza, 1198 recompra, 1235 con_svincolo) verso
  `io.to(astaId).emit(...)` — **già raggiunge tutti i partecipanti**, nessun cambio al backend o
  al contratto socket è necessario per l'animazione "vista da tutti".
- Il parsing del ruolo R.MANTRA in fase di import listino (`app.js` ~1044-1069) — non toccato.
- Persistenza, autenticazione, regole d'asta, timer server-autoritativo — fuori scope per
  definizione (redesign puramente visivo, vedi `CLAUDE.md`/regole generali del progetto).

## Cosa cambia

| Oggi | Domani |
|---|---|
| `#ant-pitch` — div 2D con gradienti, slot posizionati in % ([style.css:1382-1414](../frontend/css/style.css#L1382), `ANT_LAYOUT` in [app.js:3009-3085](../frontend/js/app.js#L3009)) | Campo con prospettiva 3D (CSS `perspective`/`rotateX`, no libreria nuova) |
| `renderAnteprimaPitch()` ([app.js:3087-3119](../frontend/js/app.js#L3087)) scrive `innerHTML` con div nome+ruolo | Stessa funzione, nuovo template: carta 3D (foto, nome, ruolo, squadra — stesso dato, altra resa) |
| Click su slot → `_antOpenPicker()` ([app.js:3121-3197](../frontend/js/app.js#L3121)) | Stesso meccanismo di apertura, nuova veste visiva del picker |
| Tab fissa `#tab-anteprima` ([index.html:890-903](../frontend/index.html#L890), toggle generico in `setupTabs()` [app.js:1807-1815](../frontend/js/app.js#L1807)) | Drawer laterale: si estrae il nodo dal flusso tab, si controlla con una classe propria (`.drawer-open`) invece di `.active` — `renderAnteprimaPitch`/`_antOpenPicker` non cambiano |
| Stato 100% locale (`_antGetSquadraState`/`_antSetSquadraState`, [app.js:2864-2872](../frontend/js/app.js#L2864)) | Stato locale invariato **+** nuova lettura, sola andata, della rosa reale già sincronizzata (per il dropdown "altre squadre") |
| Handler `giocatore-assegnato` ([app.js:1988-2007](../frontend/js/app.js#L1988)) tocca solo `#chiamata-card` | Stesso handler, **in aggiunta** dispara l'animazione di volo carta verso lo stemma squadra vincitrice |
| Nessuna animazione 3D in `style.css` (nessun `perspective`/`rotateX`/`translate3d`) | Nuovo blocco CSS dedicato, riusando lo stesso linguaggio di `@keyframes` già esistente (`card-enter`, `rilancio-flash`, ecc. — [style.css:219-263](../frontend/css/style.css#L219)) |

## Design system (riuso dei token esistenti, nessuna palette nuova)

Il tema scuro viola/oro dell'app è già definito in `:root` di `frontend/css/style.css` — il
redesign lo eredita, non lo sostituisce:

- Sfondo campo/profondità: `--bg-abyss` `#0a0518`, `--bg-main` `#150c2b`, `--bg-card` `#1e1140`
- Accento primario (bordi carta, hover): `--primary` `#8b5cf6` / `--primary-glow`
- Accento "premio"/CTA (stemma squadra vincitrice, glow di assegnazione): `--gold` `#ffb300` /
  `--gold-glow`
- Stato positivo (slot compatibile col ruolo selezionato): `--success` `#00e0a0`
- Testo: `--text-primary` `#f3eefe`, `--text-muted` `#7c6a9c`
- Font: `--font-display` (Outfit) per nomi/titoli carta, `--font-main` (Inter) per meta-dati,
  `--font-mono` (JetBrains Mono) per numeri (quotazione, FVM, crediti)

## Componenti nuovi

**Campo 3D** — contenitore con `perspective: 1200px`, superficie inclinata `rotateX(~50deg)`,
texture erba a strisce alternate (gradiente ripetuto, nessuna immagine esterna), linee di
campo/area in CSS. Gli slot mantengono le stesse coordinate `ANT_LAYOUT` esistenti, riproiettate
nello spazio 3D.

**Carta giocatore 3D** — `transform-style: preserve-3d`, leggero tilt su hover/drag, ombra
proiettata che si stacca dal campo per dare sensazione di profondità. Vedi mockup sopra per la
resa finale: foto a piena carta (`background-size:100% auto`, niente margini laterali), badge
ruolo in alto a sinistra (stringa intera, supporta più ruoli), nome+squadra in overlay in basso,
colore per ruolo riusando `.badge-ruolo` esistente. Aggiunta di titolarità (⭐, vedi feature del
2026-08-10) come badge sulla carta, visto che il dato ora esiste per giocatore — non ancora
inserita nel mockup visivo, da aggiungere in fase di implementazione.

**Drawer Anteprima** — pannello che scivola da destra, dropdown "Tutte le squadre" (propria +
sola lettura delle altrui), stesso campo 3D dentro, le altre 3 sotto-tab (Lista giocatori,
Riepilogo squadre, ecc. — verificare quali esistono realmente prima di implementare) restano
sotto, come suggerito dall'utente guardando il mockup.

**Animazione di assegnazione** — sequenza breve (0.5-1s) agganciata al gia' esistente handler di
`giocatore-assegnato`: la carta si stacca dalla card di chiamata, vola verso lo stemma della
squadra vincitrice con un effetto glow, sparisce; il drawer (se aperto) e la rosa si aggiornano
subito dopo. Nessun nuovo evento socket: è pura reazione client-side a un evento che already
arriva a tutti.

## Rischi

- **Basso** per la logica R.Mantra/asta: completamente disaccoppiata dal render (vedi sopra).
- **Medio** per regressioni visive/UX: l'Asta si usa dal vivo con persone reali durante le
  aste — qualunque bug di layout durante una puja è visibile a tutti in un momento critico.
- **Complessità maggiore del previsto** nel fondere planner locale + rosa reale nello stesso
  pannello: va deciso a implementazione come distinguere visivamente "quello che pensi di fare"
  da "quello che hai già".
- Performance CSS 3D su mobile di fascia bassa (l'app è mobile-first): va verificato con test
  reali su device, non solo desktop.

## Strategia di test sicura (concordata con l'utente)

Il progetto si deploya via `git push` su un repo collegato a Render (non FTP/cartelle
`public_html`), quindi:
1. Nuovo branch dedicato, es. `redesign/asta-3d` — mai lavorare direttamente su `main`.
2. Eventuale secondo servizio Render puntato su quel branch, per avere una URL di preview separata
   dalla produzione usata dagli utenti reali.
3. Merge su `main` solo dopo checklist QA completa (sotto) — mai forzare in produzione un redesign
   non testato durante un'asta reale.

## Checklist QA — stato dopo l'implementazione (branch `redesign/asta-3d`)

Verificato in locale (browser automatizzato, dati simulati — nessuna asta live reale
disponibile in sessione):

- [x] Campo 3D: leggibile su mobile (bottom-sheet) e desktop (drawer laterale), verificato a
  375px e 1280px
- [x] Carte: foto/nome/ruolo/squadra visibili e leggibili (foto reale caricata correttamente
  dalla stessa pipeline di `.cc-avatar`); titolarità **non ancora aggiunta alla carta** (nota
  già presente nel mockup originale, resta un miglioramento futuro, fuori dai 7 requisiti
  espliciti dell'utente per questo giro)
- [x] Picker (click su slot): stesso comportamento di oggi, filtro `_ruoliCompatibili` invariato
  — verificato che uno slot "C" mostra solo giocatori compatibili
- [x] Drawer: apertura/chiusura non nasconde le altre tab (Rose resta attiva dietro, verificato)
- [x] Animazione assegnazione: verificata la meccanica (posizione di partenza corretta, cleanup,
  tetto di 3 cloni simultanei, skip con `prefers-reduced-motion`) — **non verificata visivamente
  a schermo intero ne' in multiplayer reale**, limite dell'ambiente di test automatizzato
- [ ] Animazione: non rallenta/blocca il prossimo giro di chiamata — da confermare dal vivo
- [x] `prefers-reduced-motion`: verificato che disattiva la creazione del clone
- [x] Nessuna regressione nelle altre tab/sotto-tab esistenti (Storico/Rose/Svincolati/Griglia
  P/A testate una per una dopo le modifiche a `setupTabs()`)
- [ ] Dropdown "Tutte le squadre": **nota** — il comportamento non è cambiato rispetto a prima
  del redesign (si può scegliere/modificare qualunque squadra dal planner locale, non solo la
  propria); non era una restrizione già esistente nell'app originale, quindi non è stata
  aggiunta ora per non introdurre logica nuova non richiesta esplicitamente
- [ ] Test su device Android reale fascia media/bassa — non eseguibile in questo ambiente
- [ ] Multiplayer reale (2+ utenti, 2+ dispositivi) — non eseguibile in questo ambiente

## Fasi di implementazione — tutte completate sul branch `redesign/asta-3d`

1. ~~Branch + eventuale servizio Render di preview~~ → branch `redesign/asta-3d` creato da
   `main`, più `backup/pre-redesign-asta-3d` come rete di sicurezza. Nessun servizio di preview
   separato creato (il progetto è ora su Hostinger, non Render — vedi sessione migrazione):
   test fatto in locale con `npm run dev`.
2. Design system CSS — fatto (`frontend/css/style.css`, nuovo blocco "REDESIGN 3D — ANTEPRIMA")
3. Campo 3D + carte collegati ai dati reali direttamente (saltato lo stadio intermedio "dati
   statici di prova": il rischio era basso avendo verificato `ANT_LAYOUT` già corretto)
4. `ANT_LAYOUT`/`_ruoliCompatibili`/picker esistenti — riusati senza modifiche, verificato
5. Rosa reale collegata (dropdown "Tutte le squadre", stesso comportamento di prima — vedi nota
   sopra)
6. Animazione di assegnazione agganciata a `giocatore-assegnato` — fatto
7. QA in locale completata dove possibile in questo ambiente (vedi checklist sopra); **QA su
   device reali e merge su `main` restano da fare, con l'utente**
