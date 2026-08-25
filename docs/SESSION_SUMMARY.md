# SESSION_SUMMARY.md

Stato corrente del progetto. Questo file è **memoria di lavoro, non storico**: va sovrascritto,
non accumulato. La cronologia sta in `git log`, il *perché* delle scelte in
[DECISIONS.md](../DECISIONS.md), stack e convenzioni in [PROJECT.md](../PROJECT.md).

## Stato attuale

Branch `main`. Deploy automatico su Hostinger al push su `main`. **Le modifiche di sicurezza
descritte qui sotto sono nel working tree e non sono ancora state committate né deployate.**

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

1. Attivare a mano nel pannello Supabase la **protezione password compromesse (HaveIBeenPwned)**,
   unico rilievo di sicurezza rimasto e non risolvibile da codice.
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
