# CLAUDE.md

Istruzioni permanenti per Claude Code su questo repository. Questo file contiene solo il *come*
lavorare — per il *cosa* (stack, struttura) vedi [PROJECT.md](PROJECT.md), per l'architettura tecnica
[ARCHITECTURE.md](ARCHITECTURE.md), per le decisioni tecniche importanti [DECISIONS.md](DECISIONS.md),
per lo stato attuale del progetto [docs/SESSION_SUMMARY.md](docs/SESSION_SUMMARY.md).

## Protocollo di memoria tecnica

Il progetto mantiene 4 documenti stabili oltre a questo file:

| File | Contiene | Non contiene |
|---|---|---|
| [PROJECT.md](PROJECT.md) | stack, struttura cartelle, comandi, convenzioni stabili | task, bug, cambi temporanei |
| [ARCHITECTURE.md](ARCHITECTURE.md) | moduli, stato, auth, flusso dati | task, cronologia |
| [DECISIONS.md](DECISIONS.md) | decisioni tecniche importanti e il perché | task, cronologia |
| [docs/SESSION_SUMMARY.md](docs/SESSION_SUMMARY.md) | stato attuale, cambi recenti, pendenze, prossimo passo | storico completo (va sovrascritto) |

Quando aggiorni questi file:
- non sostituire un file intero se non serve: riorganizza, elimina duplicati, integra solo ciò che
  manca;
- mantienili brevi — sono memoria di lavoro, non documentazione esaustiva;
- non scriverci mai task temporanei (quelli vivono nella conversazione/nei Task del tool, non qui).

## Come lavorare in questo progetto

- **Prima di ogni task**, consulta prima PROJECT.md/ARCHITECTURE.md/DECISIONS.md/SESSION_SUMMARY.md
  invece di riesplorare il codice da zero.
- Non ripetere analisi di parti del progetto già documentate in questi file — fidati della
  documentazione a meno che il codice osservato la contraddica (in quel caso correggi la
  documentazione, non solo il codice).
- Non aprire file inutilmente. Esplora in modo progressivo: apri prima i file strettamente necessari
  al task, allarga la ricerca solo se serve.
- Preferisci modificare il minor numero possibile di file per risolvere un task.

## Come implementare

- Cambi piccoli e mirati; riusa codice esistente; mantieni l'architettura attuale.
- Evita refactoring non richiesti.
- Se un task richiede molti cambi o tocca più moduli, presenta prima un piano ed aspetta conferma
  dell'utente prima di implementare.

## Convenzioni del codice

- Commenti e nomi di variabili/funzioni sono in **italiano** in tutto il progetto (`asta`, `squadra`,
  `giocatore`, `crediti`, `rilancio`, ecc.) — non tradurre in inglese.
- I commenti nel codice spesso spiegano il *perché* di scelte non ovvie (race condition, incidenti
  passati, fix di memory leak): leggerli prima di modificare quella logica. Le decisioni più
  significative sono anche riassunte in [DECISIONS.md](DECISIONS.md).
- Non ci sono script di test, lint o build in questo progetto — non proporli né aspettarsi che
  esistano.

## Quando chiedere conferma

- Prima di modifiche architetturali o che toccano più moduli contemporaneamente (vedi sopra, "Come
  implementare").
- Prima di modificare la logica di backup/persistenza Supabase o le regole di autenticazione/ruoli
  (vedi [ARCHITECTURE.md](ARCHITECTURE.md)) — sono aree con incidenti/race condition noti documentati
  in [DECISIONS.md](DECISIONS.md).
- Prima di azioni distruttive o irreversibili (vedi le regole generali di sicurezza dell'agente).

## Al termine di un task importante

1. Aggiorna subito [docs/SESSION_SUMMARY.md](docs/SESSION_SUMMARY.md) con lo stato risultante
   (sovrascrivilo, non accumulare storico).
2. Aggiorna [DECISIONS.md](DECISIONS.md) solo se è stata presa una nuova decisione tecnica rilevante.
3. Aggiorna [PROJECT.md](PROJECT.md) o [ARCHITECTURE.md](ARCHITECTURE.md) solo se il progetto è
   cambiato in modo permanente (nuovo modulo, nuova dipendenza, cambio di struttura).
