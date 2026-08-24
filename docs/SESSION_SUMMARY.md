# SESSION_SUMMARY.md

Stato corrente del progetto. Questo file è **memoria di lavoro, non storico**: va sovrascritto,
non accumulato. La cronologia sta in `git log`, il *perché* delle scelte in
[DECISIONS.md](../DECISIONS.md), stack e convenzioni in [PROJECT.md](../PROJECT.md).

## Stato attuale

Branch `main`, non ancora pushato con l'ultimo cambio (vedi sotto). Su Hostinger il deploy è
automatico al push su `main`, quindi **quello che c'è su `main` è quello che è online**.

L'app gira col tema **"Serata d'Asta"** in due versioni: sera (default, lampada ambra su sala
scura, invariata) e mattina (`html.theme-light`, ora **"Cuoio"**: banco di cuoio e pergamena
ispirato a un mockup fornito dall'utente ("PuntBar") — cuoio scuro per testata/cornici,
pergamena chiara per i piani, verde bosco riservato SOLO alle cifre di credito/offerta. Sostituisce
interamente la versione precedente "Mattina al banco" (bianco/argento/ottone). I colori del tema
strutturale sono ruoli (`--sc-testo`, `--sc-ambra`, `--sc-carta`…) definiti due volte in
`tema-serata.css`: `:root` (sera) e `html.theme-light` (mattina/cuoio) — più i token globali
condivisi da tutte le schermate in `style.css` (`html.theme-light{--bg-card,--primary,--gold,
--success,--text-primary...}`), che ora cascano lo stesso linguaggio cuoio/pergamena/verde su
Home, Lobby, Strategie, Editor Fasce, Anteprima e Griglia P/A senza bisogno di regole dedicate
per ciascuna.

Per portare online, tornare indietro, o sapere cosa è stato verificato e cosa no:
**[docs/DEPLOY_TEMA.md](DEPLOY_TEMA.md)** (non ancora aggiornato col redesign "Cuoio" — il
meccanismo di rollback a 3 livelli descritto lì resta valido, ma la sezione "Tema chiaro" descrive
ancora la vecchia palette bianco/argento).

## Cambi recenti

- **Tema chiaro ridisegnato da zero ("Cuoio"), su richiesta esplicita dell'utente con mockup di
  riferimento**: testata (`.asta-header`/`.home-header`) diventata una barra in cuoio scuro con
  testo crema (`Instrument Serif`, già caricato per l'insegna scura, riusato qui) anche se il resto
  della pagina è chiaro; tavolo della puja e `.chiamata-card`/`#puja-panel-slot` con cornice doppia
  cuoio+pergamena; `.cc-avatar` da cerchio ad angoli smussati con cornice a più livelli (SOLO
  bordo/forma, dimensioni invariate — vedi "Carta XL animazione" sotto, stesso vincolo);
  `.cc-offerta`/`.cc-offerta-box`/`.sq-crediti` in verde bosco (`#2F6B3F`), l'unico verde del tema
  e riservato al denaro; tabs (`.tabs-nav`) diventate una striscia verde con testo crema; riepilogo
  squadre solo ricolorato, griglia a due righe della sessione precedente non toccata; aggiunta prima
  regola `html.theme-light .ant-card{...}` (Anteprima non aveva mai avuto un override chiaro).
  Contrasto verificato via script (non a occhio): tutte le coppie testo/sfondo chiave ≥4.9:1
  (ink/secondary/verde/cuoio-pieno/crema-su-cuoio), nessun debito nuovo tipo quello già noto nel
  tema scuro. Verificato nel browser (dati sintetici via console, iniettati chiamando
  `applyLayoutRuolo()`/`renderChiamata()`/`renderBudgetBar()` direttamente — nessuna asta reale
  disponibile) in vista Partecipante e Admin, desktop e mobile (375px); tema scuro ricontrollato
  dopo il cambio, invariato pixel per pixel. **Non verificato**: Anteprima con giocatori reali
  piazzati sul campo (il drawer si apre e la cornice `.ant-card` è scritta, ma non è stata vista
  renderizzata con carte vere — servirebbe uno stato sintetico più elaborato), Griglia P/A (eredita
  i token ma non è stata guardata), modali (svincolo, conferma RIC, ecc. — stesso limite di sempre,
  nessuna asta reale disponibile).
- **Bug preesistente scoperto e corretto durante questo lavoro** (non introdotto da questo cambio):
  `html body .card{background:linear-gradient(rgba(25,20,17,.9),...)!important}` in
  `tema-serata.css` non era scoperto per tema — le card di Home/Login/Lobby/Fine asta restavano
  sempre scure ANCHE nel vecchio tema chiaro "Mattina al banco". Aggiunta la mancante
  `html.theme-light body .card{...}` (pergamena) accanto alle altre regole "Porta d'ingresso".

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
- Schermate Strategie, Editor Fasce, Anteprima e Griglia P/A: ereditano la palette ma non sono
  state guardate una per una, in nessuno dei due temi.
- Ripristinare `.cc-strategia-info` su mobile: è l'unico `display:none` del tema che tocca
  contenuto vero e non decorazione.
- Nel tema **scuro** il grigio più tenue (`--sc-tenue`) resta a 3.4:1 su testi da 9-10px. È così
  da quando il tema è online, non è una regressione, ma si schiarisce con una riga.

## Prossimo passo

Aprire un'asta di test reale, idealmente con 2+ dispositivi, e guardare in ordine: la schermata
asta (sera e mattina), i modali di svincolo con dati veri, e infine i comportamenti della puja
(la leva su RILANCIA).

## Regola da non dimenticare: non si nasconde informazione

Per far entrare il nome della squadra in colonne strette era stato messo un
`@container (max-width:250px){ .sq-bottom{display:none} }`: spariva la riga `Tot: n/25 🧤 🔓`.
L'utente se n'è accorto subito. Compattare il layout è legittimo, **eliminare un dato per far
spazio no**: se due informazioni non stanno su una riga, si usa una riga in più. Vale per tutta
l'app, ed è il motivo per cui ogni intervento sul layout ora finisce con un controllo che conta
i dati a schermo a ogni larghezza.
