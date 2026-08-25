# SESSION_SUMMARY.md

Stato corrente del progetto. Questo file è **memoria di lavoro, non storico**: va sovrascritto,
non accumulato. La cronologia sta in `git log`, il *perché* delle scelte in
[DECISIONS.md](../DECISIONS.md), stack e convenzioni in [PROJECT.md](../PROJECT.md).

## Stato attuale

Branch `main`, allineato con `origin/main`. Deploy automatico su Hostinger al push su `main`.

**Quattro temi attivi**, tutti con lo stesso pattern (ruoli `--sc-*` in `tema-serata.css` + token
base in `style.css`, entrambi con un blocco `[data-tema="<id>"]`, + una sezione "materie" in fondo a
`tema-serata.css`; una riga in `TEMI` in `app.js` e, se la clessidra resta visibile, una voce in
`MATERIALI` di `clessidra.js`):

- **`serata`** (scuro, default) — lampada ambra su sala scura.
- **`cuoio`** (chiaro, caldo) — banco di cuoio e pergamena, foto reali; verde bosco SOLO per le
  cifre di credito.
- **`lavagna`** (scuro) — lavagna nera e gesso (foto vera), cornice in ottone, ciano = struttura,
  magenta = brand + denaro.
- **`sala-giochi`** (chiaro, freddo) — cabinato anni '90: carta bianca a retino, inchiostro spesso,
  ombre dure (`6px 6px 0`, mai sfocate), font a pixel. Cobalto = accento strutturale, oro gettone =
  solo denaro, ciliegia = allarme **e** tasto RILANCIA (unica deroga alla regola "rosso = solo
  stato", vedi DECISIONS.md). Nessuna immagine nuova: tutto in gradienti CSS.

L'attributo e' `data-tema="<id>"` su `<html>`, il selettore e' il menu 🎨 (`.tema-picker*`, regole
scritte solo su token base, quindi valgono anche per i temi futuri). I token globali di `style.css`
cascano da soli su Home, Lobby, Strategie, Editor Fasce, Anteprima e Griglia P/A per tutti e quattro
i temi, senza regole per schermata. L'Anteprima (campo 3D) e' coperta in tutti e quattro i temi.

**Promemoria operativi che non scadono:**

1. **Se un colore "non torna" in NESSUN tema, controllare prima la tabella Supabase
   `theme_overrides`** (riga `id='default'`), non la cache ne' il tema: un "Editor Visuale di Stile"
   nascosto (`?editor=CHIAVE`, `backend/server.js` ~1837-1866) salva override CSS globali per tutti
   gli utenti, iniettati dopo entrambi i fogli. Gia' successo una volta (bottoni viola, 2026-08-05),
   svuotata con `update theme_overrides set styles='{}' where id='default'`.
2. **Per usare una foto vera** (non un'imitazione CSS) serve che sia l'utente a salvarla su disco e
   dire il nome del file: nessun tool di Claude Code puo' esportare un'immagine incollata in chat.
   Poi si copia in `frontend/img/backgrounds/` e si referenzia con `url(...)` + `?v=N` manuale
   (Hostinger serve gli statici con cache `immutable` di 30gg — senza bump del `?v=` un cambio
   foto resta invisibile a chi l'ha gia' visitata, vedi PROJECT.md).
3. **Font-size nella zona puja (`#puja-panel-slot`/`.asta-row-puja`) deve sempre usare `cqw`, mai
   `vw`**: il container "sala" (`#asta-main-col`) si dimezza quando si apre Anteprima senza che la
   finestra cambi — una regola in `vw` resta tarata sulla finestra e puo' arrivare a rompere il
   layout (nome del giocatore a capo lettera per lettera, bug reale gia' capitato).
4. **I 3 file con righe LF-only** (`frontend/js/app.js`, `frontend/index.html`,
   `frontend/css/style.css`) non vanno mai editati con l'Edit tool standard — vedi PROJECT.md per
   il procedimento (script Python, verificare lo stile di fine riga ESATTO del punto d'inserimento,
   non assumerlo uniforme).

Per portare online o tornare indietro: **[docs/DEPLOY_TEMA.md](DEPLOY_TEMA.md)** — attenzione, e'
fermo al vecchio toggle binario chiaro/scuro e alla palette chiara precedente, va riscritto per i
quattro temi prima del prossimo deploy importante.

## Cambi recenti

- **Quarto tema "Sala Giochi"** (chiaro, da cabinato arcade) implementato in una sessione
  parallela e unito a `main` via rebase (due giri: prima il tema base, poi copertura di
  `.admin-conferma-box`, `#mio-panel` in vista Admin, e il campo 3D di Anteprima — gli unici tre
  punti che nessun tema toccava). Dettagli tecnici e decisioni non ovvie in
  [DECISIONS.md](../DECISIONS.md). **Non verificato da questa sessione**: asta vera, modali,
  Griglia P/A, Strategie con questo tema; drag&drop/Autorellenar/accordion sotto sono stati
  verificati su `serata`/`cuoio`/`lavagna` e a campione su `sala-giochi` (nessuna regressione
  trovata, ma non un giro di verifica completo).
- **Accordion Riepilogo squadre/Mio team**: default sempre-espanso sia in Admin che Utente
  (l'utente vuole vederli subito, li stringe lui se vuole — classe `acc-open` col significato
  invertito tra i due ruoli, commentato nel CSS). **Bug reale trovato e corretto**: su mobile
  l'Utente non riusciva MAI a richiudere questi due pannelli — due regole incondizionate in
  `tema-serata.css` (`display:grid !important` per il layout a griglia desktop) avevano piu'
  specificita' delle regole mobile in `style.css` e vincevano sempre. Risolto alzando la
  specificita' delle regole mobile, senza toccare il layout desktop.
- **Anteprima — drag & drop + "Autorellenar"** (richiesta esplicita dell'utente, specifica
  dettagliata su piu' turni): trascina un giocatore dalla Panchina al campo, dal campo alla
  Panchina, o tra due slot (sposta/scambia con validazione del ruolo in entrambe le direzioni) —
  alternativa al click esistente su `_antOpenPicker`, mai toccato. Bottone Autorellenar riempie
  solo gli slot vuoti processando le linee del campo dalla piu' difensiva alla piu' offensiva
  (`P → DS/DC/B/DD → M → C/E → W/T → A/PC`), assegnando ogni volta il candidato compatibile di
  valore piu' alto — un giocatore multi-ruolo (es. `DD/E`) viene cosi' considerato prima per la
  sua linea piu' difensiva. **Bug corretto dopo il primo rilascio**: il valore di riferimento
  usava solo `fm` (spesso assente a seconda di come e' stato importato il listino), scegliendo
  di fatto quasi a caso — sostituito con una catena `quotazione → valore → fm → mv` (mai il
  prezzo pagato, scartato esplicitamente: dipende da troppi fattori estranei alla qualita' del
  giocatore). Aggiunta anche la colonna QUOT. mancante nel secondo importatore Excel (roster di
  lega esistente, riparazione).
- **Bug di logica (non di tema): l'asta proseguiva mentre una squadra aveva uno svincolo o una
  decisione (plusvalenza/recompra) pendente** — il bottone NASCONDI nel popup di svincolo chiude
  solo la vista, ma l'Admin poteva comunque continuare a chiamare giocatori nel frattempo.
  Aggiunto un controllo su `asta.popupAttivo` in `estrai-giocatore`/`chiama-giocatore`/
  `assegna-manuale` (`backend/server.js`), stesso pattern gia' usato per `chiamataAttuale`.
  **Non testato end-to-end con 2 client reali** (nessuna asta di test disponibile).

Storico completo dei redesign dei temi (Cuoio, Lavagna, Anteprima, orologio, texture) e dei bug
di specificita' CSS trovati lungo il percorso: `git log`, oltre 20 commit tra fine agosto 2026.

## Debito tecnico riconosciuto (non pagato di proposito)

`style.css` difende la zona puja con ~40 regole `!important` su tutti i breakpoint, quindi
`tema-serata.css` deve vincerle con `html body #puja-panel-slot` + `!important`. Ripulirle è il
lavoro successivo naturale, tenuto fuori dagli interventi estetici per non mescolare un
refactor rischioso con un cambio di aspetto. Nello stesso giro si può togliere il blocco
`@media (min-width:901px)` in fondo a `style.css` (commit `039206b`, lavoro di un altro
strumento): è ridondante da quando il tema ridisegna la stessa zona con specificità più alta.

## Pendenze

- **Mai provato end-to-end in un'asta vera**: login Supabase, più dispositivi, modali critici
  (svincolo, conferma RIC, plusvalenza/recompra, annulla storico), il blocco popup-pendente sopra.
  È il limite noto di tutte le sessioni finora — non ci sono credenziali di test.
- Schermate Strategie, Editor Fasce e Griglia P/A: ereditano la palette ma non sono state
  guardate una per una in tutti e quattro i temi.
- [docs/DEPLOY_TEMA.md](DEPLOY_TEMA.md) descrive ancora il vecchio toggle binario e la palette
  chiara precedente — da riscrivere per i 4 temi/selettore prima del prossimo deploy importante.
- Ripristinare `.cc-strategia-info` su mobile: è l'unico `display:none` del tema che tocca
  contenuto vero e non decorazione.
- Nel tema **scuro** il grigio più tenue (`--sc-tenue`) resta a 3.4:1 su testi da 9-10px. È così
  da quando il tema è online, non è una regressione, ma si schiarisce con una riga.

## Prossimo passo

Aprire un'asta di test reale, idealmente con 2+ dispositivi, e guardare in ordine: la schermata
asta nei quattro temi, i modali di svincolo/plusvalenza/recompra con dati veri (incluso il nuovo
blocco popup-pendente), e i comportamenti della puja (leva su RILANCIA, drag & drop e
Autorellenar in Anteprima).

## Regola da non dimenticare: non si nasconde informazione

Per far entrare il nome della squadra in colonne strette era stato messo un
`@container (max-width:250px){ .sq-bottom{display:none} }`: spariva la riga `Tot: n/25 🧤 🔓`.
L'utente se n'è accorto subito. Compattare il layout è legittimo, **eliminare un dato per far
spazio no**: se due informazioni non stanno su una riga, si usa una riga in più. Vale per tutta
l'app, ed è il motivo per cui ogni intervento sul layout ora finisce con un controllo che conta
i dati a schermo a ogni larghezza.
