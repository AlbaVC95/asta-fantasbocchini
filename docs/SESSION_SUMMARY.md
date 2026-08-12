# SESSION_SUMMARY.md

Stato attuale del progetto. Questo file va sovrascritto ad ogni task importante — non è uno storico
(per quello c'è `git log`).

## Stato attuale

- Branch `main` pulito, **tutto pushato e in produzione** (Render): ultimo commit il fix
  Max Offerta Portieri/Movimento (vedi sotto), poi `b09fe12` (import/export FantaLab), `4b22006`
  (mockup redesign 3D, tenuto in locale per un po' su richiesta dell'utente, pushato insieme al
  resto in questa sessione), `a70f175`, `2a442d9`, `8e5c3d3`. Migration
  `backend/sql/2026-08-10_strategia_titolarita_commento.sql` già eseguita dall'utente su Supabase.
- **Import/export Strategia in formato Excel FantaLab: implementato, testato con successo in
  produzione con login reale, e pushato.** Vedi sezione dedicata sotto.
- **Fix — Max Offerta non rispettava il minimo Portieri separatamente dal minimo Movimento**
  (segnalato dall'utente con un caso reale): pushato, **non ancora verificato dal vivo con una
  puja reale** (solo verifica logica sull'esempio esatto dell'utente + sintassi/avvio server).
  Vedi sezione dedicata sotto.
- **Nuovo — Contatore "chiamati/totale" nel tab Svincolati**: pushato, verificato via console
  browser con dati finti (nessuna asta live disponibile in sessione per un test reale).
- **3 vulnerabilità di sicurezza Supabase corrette in questa sessione** (segnalate via email di
  alert automatico Supabase + Security Advisors), applicate dall'utente via SQL Editor. Vedi
  sezione dedicata sotto.
- **2 bug reali corretti e già in produzione** (vedi sotto) — Bug 1 verificato con lettura statica
  approfondita del codice (nessun modo pratico di simulare una sessione socket.io multi-utente in
  questo ambiente), Bug 2 verificato con test funzionale reale in browser. **Nessuno dei due è
  stato ancora confermato dall'utente dal vivo in un'asta reale.**
- Redesign 3D Anteprima: **ancora nessuna implementazione**, solo iterazione visiva (v1 → v6),
  mockup salvato nel repo (vedi sotto).

## Import/Export Strategia — formato FantaLab (implementato, testato in produzione, pushato)

Aggiunta la possibilità di importare/esportare una Strategia anche nel formato Excel del tool
esterno "FantaLab" (12 fogli, uno per ruolo Mantra), oltre al JSON nativo che resta invariato.

- **Import** (`frontend/index.html` bottone "📥 Importa da FantaLab (Excel)" nella lista strategie
  + `_importaGiocatoriFantaLabInStrategia()` in `frontend/js/app.js`): riusa lo screen "Nuova
  strategia" esistente per nome/crediti/tipo (il file Excel non li contiene), poi parsa i 12 fogli
  con SheetJS. Matching giocatore per **nome+ruolo** contro `listino_giocatori` (nessun fuzzy
  matching necessario). Le fasce vengono create automaticamente seguendo la gerarchia nota di
  FantaLab (`FANTALAB_FASCIA_ORDINE` in `app.js`). Un giocatore multi-ruolo appare su più fogli con
  la stessa fascia reale solo sul primo e "Non Impostata" sugli altri (comportamento originale di
  FantaLab): in import si prende la fascia reale **indipendentemente dal foglio** in cui compare
  (richiesta esplicita dell'utente — l'app non ha un concetto di "ruolo primario" per la fascia).
- **Export** (`frontend/index.html` bottone "📤 Esporta (FantaLab)" nell'editor +
  `esportaStrategiaFantaLab()` in `app.js`): ricrea i 12 fogli, popolando `Team` da una mappa
  codice→squadra derivata e verificata contro il listino reale (`FANTALAB_TEAM_CODE_TO_SQUADRA`),
  `Quo/MV/FMV` dal Listino Ufficiale. Replica **esattamente** il comportamento FantaLab per i
  multi-ruolo: fascia scritta solo sul foglio del primo ruolo (ordine in
  `listino_giocatori.ruolo`), "Non Impostata" sugli altri.
- Colonne FantaLab senza equivalente nel nostro schema (`PMA, Affidabilità, Integrità, Nota 1-5`)
  vengono ignorate in import e lasciate vuote in export — `strategia_giocatori` non ha campi per
  quei dati.
- **Verificato due volte in produzione con login reale dall'utente**: import del file FantaLab
  reale dell'utente → 497/497 giocatori importati, 0 scartati, tutte le 20 fasce create
  correttamente (confermato via query diretta su Supabase, non solo lato client). Export testato su
  due strategie diverse (una con pochi giocatori configurati manualmente, una con i 497 importati
  da FantaLab): in entrambi i casi il file generato è corretto, incluso il comportamento
  multi-ruolo (verificato sui casi reali Addai e Aboukhlal, entrambi W/A: fascia sul foglio W,
  "Non Impostata" sul foglio A).
- Nota per il futuro: dopo due test dell'utente esistono in produzione due strategie duplicate
  chiamate "Strategia SOS Fanta" (create durante il test) — puramente dati di test dell'utente, non
  un problema del codice; l'utente può eliminarne una dall'editor se vuole.

## Fix — Max Offerta: minimo Portieri e minimo Movimento sono due vincoli separati

Bug reale segnalato dall'utente con un caso concreto: `calcolaMaxOfferta()`
(`backend/server.js`, validazione autoritativa lato server) riservava crediti solo in base al
**totale** `minimoPortieri + minimoMovimento` confrontato con la dimensione della rosa, non alle
due categorie separatamente. Risultato: una squadra che aveva già superato il minimo Movimento ma
non quello Portieri (es. 1 portiere/26 movimento con minimo 3/25) poteva comunque offrire tutti i
crediti residui su un giocatore di movimento, restando poi bloccata a fine asta senza credito per
completare i portieri minimi.

Fix: la funzione ora calcola quanti portieri e quanti giocatori di movimento mancano al minimo
**separatamente**, considerando che il giocatore della chiamata attuale (se noto) riempie la SUA
categoria. Stessa logica duplicata e corretta in `frontend/js/app.js`
(`calcolaMaxOffertaSquadra()`, usata solo per l'hint "Max Xcr" mostrato in UI — la validazione
vera resta lato server) — le due funzioni client duplicate (`getMaxOfferta`/
`calcolaMaxOffertaSquadra`) sono state unificate in una sola per evitare che tornino a
disallinearsi in futuro.

Verificato: il nuovo calcolo riproduce esattamente il numero atteso dall'utente sul suo esempio
reale (1 portiere/26 movimento, minimo 3/25, 4 crediti, chiamata su un giocatore di movimento →
massimo 2, non più 4). Sintassi OK, server riavviato senza errori, app caricata in browser senza
crash. **Non verificato con una puja reale in un'asta live** (richiederebbe una sessione
multi-utente non simulabile in questo ambiente, stesso limite del Bug 1 sopra) — da confermare
alla prossima asta di test.

## Nuovo — Contatore "chiamati/totale" nel tab Svincolati

Richiesta dell'utente: mostrare quanti giocatori del listino sono già stati chiamati (estratti,
a prescindere dall'esito — assegnati o scartati) sul totale del pool dell'asta. Aggiunto
`<p id="liberi-counter">` in `frontend/index.html` (tab Svincolati, sopra la lista), popolato in
`renderGiocatoriLiberi()` (`frontend/js/app.js`) con `pool.filter(g => g.estratto).length + ' / '
+ pool.length`. Verificato via `javascript_tool` nel browser (nessuna asta live in sessione per
un test end-to-end): con un pool finto di 3 giocatori (2 estratti) mostra correttamente
"2 / 3 giocatori chiamati".

## Sicurezza Supabase — 3 fix applicati (email di alert + Security Advisors)

Verificato con `get_advisors` prima e dopo ogni fix. Tutti applicati dall'utente via SQL Editor
del dashboard Supabase (l'`apply_migration` diretto è stato bloccato dal classificatore di
permessi dell'agente su un'operazione DDL di produzione).

1. **`app_settings` aveva RLS completamente disattivato** (ERROR critico, oggetto dell'email di
   alert Supabase): chiunque avesse la chiave anon pubblica (embedded nel frontend) poteva
   leggere/modificare/cancellare via API REST i toggle globali `backup_supabase_attivo` e
   `manutenzione_attiva` (vedi [DECISIONS.md](../DECISIONS.md), "incidente banda agosto 2026" e
   toggle manutenzione), senza passare dall'app. Fix: `ALTER TABLE public.app_settings ENABLE ROW
   LEVEL SECURITY;` (nessuna policy, stesso pattern già usato per `asta_backups`/`asta_exports`/
   `theme_overrides` — solo il backend con service role vi accede, mai il frontend).
2. **`handle_new_user()` (trigger di creazione `profiles` al signup) con `search_path` non
   fissato**: rischio di dirottamento di oggetti referenziati se un `SECURITY DEFINER` non fissa
   il search_path. Fix: `ALTER FUNCTION public.handle_new_user() SET search_path = public,
   pg_temp;`.
3. **`handle_new_user()` invocabile via RPC pubblico** (`/rest/v1/rpc/handle_new_user`) da `anon`/
   `authenticated`: non praticamente sfruttabile (è una funzione `trigger`, Postgres rifiuta di
   eseguirla fuori da un trigger), ma chiuso per buona prassi. Primo tentativo (`REVOKE ... FROM
   anon, authenticated`) non bastava perché l'`EXECUTE` restava concesso a `PUBLIC` (pseudo-ruolo
   di cui `anon`/`authenticated` ereditano i permessi): serviva `REVOKE EXECUTE ON FUNCTION
   public.handle_new_user() FROM PUBLIC;`. Il trigger di signup continua a funzionare invariato
   (essendo `SECURITY DEFINER`, Postgres lo esegue con i privilegi del proprietario della
   funzione indipendentemente da questi grant).

**Residuo, non un problema**: 4 avvisi INFO "RLS enabled, no policy" su `app_settings`,
`asta_backups`, `asta_exports`, `theme_overrides` — pattern intenzionale (accesso solo da
backend via service role, mai dal frontend). **Residuo NON risolvibile sul piano attuale**:
"Leaked Password Protection" disattivata in Auth — l'organizzazione Supabase
(`AlbaVC95's Org`) è sul piano **Free**, e questa funzione richiede il piano **Pro o superiore**
(confermato nella documentazione ufficiale Supabase). Non è un'impostazione DB/SQL né
raggiungibile con l'MCP di Supabase (nessun tool per config Auth) — richiederebbe un upgrade di
piano. Non bloccante (è un WARN informativo, non ERROR).

## Cambi in produzione (dall'ultimo reset di questo file)

1. **Fix — Diritto plusvalenza/recompra perso non persistente** (`backend/server.js`): il flag
   viveva su `chiamataAttuale` (ricreata ad ogni chiamata) invece che in modo persistente, quindi
   veniva "resuscitato" da timer riaperti, aste annullate/ripetute o nuove chiamate dello stesso
   giocatore. Spostato su `giocatore.dirittoRiacquistoPerso`, persistente in `asta.poolGiocatori`.
   Dettagli in [DECISIONS.md](../DECISIONS.md).

2. **Fix — Anteprima non resettata tra aste diverse** (`frontend/js/app.js`): la chiave
   `localStorage` del planner di formazione ora include `S.astaId` (`_antLsKey()`), invece di
   essere fissa per squadra. Nessun cambio alla logica di schieramento/moduli. Dettagli in
   [DECISIONS.md](../DECISIONS.md).

3. *(Sessioni precedenti)* Filtri duplicati in cima a Strategia, Titolarità/Commento per
   giocatore, fix badge U21 in Svincolati — commit `8e5c3d3`.

## Redesign 3D Anteprima — direzione visiva salvata nel repo

Dopo 6 iterazioni di feedback (v1 → v6, ognuna verificata in locale prima di essere mostrata),
la versione finale è salvata come file HTML autonomo (apribile direttamente in un browser, foto
giocatore incluse come base64, nessuna dipendenza esterna):

**[docs/redesign-asta-3d/anteprima-3d-mockup.html](redesign-asta-3d/anteprima-3d-mockup.html)**

Lo storico completo delle iterazioni (cosa è cambiato ad ogni passaggio) e le decisioni di design
da portare nell'implementazione reale (colore carta per ruolo riusando `.badge-ruolo` esistente,
badge ruolo in alto a sinistra con supporto multi-ruolo, foto a piena carta senza margini) sono
documentati in **[docs/REDESIGN_ASTA_3D.md](REDESIGN_ASTA_3D.md)**, sezione "Mockup visivo di
riferimento". **Pushato in produzione** (commit `4b22006`) — resta comunque solo un documento di
design, nessuna implementazione nell'app reale.

## Tasks pendenti

- **Verificare dal vivo il fix Max Offerta Portieri/Movimento** in un'asta di test reale: portare
  una squadra a un solo portiere ma oltre il minimo di movimento, controllare che l'offerta
  massima proposta sui giocatori di movimento lasci abbastanza crediti per completare i portieri
  minimi.
- **Verificare dal vivo il Bug 1** in un'asta di test reale: far puntare il proprietario
  precedente sul proprio ex giocatore, far scadere/riaprire il timer (o annullare e ri-estrarre
  lo stesso giocatore), controllare che il popup plusvalenza/recompra NON venga più offerto.
- **Verificare dal vivo il Bug 2**: terminare un'asta, entrare in una nuova con una squadra dallo
  stesso nome, aprire Anteprima e controllare che parta vuota.
- Test end-to-end titolarità/commento con login reale (pendente da sessioni precedenti, non
  ancora confermato dall'utente).
- Opzionale: eliminare la strategia "Strategia SOS Fanta" duplicata creata durante i test
  dell'import FantaLab (due copie identiche in produzione, dati di test).
- Redesign 3D: nessuna implementazione avviata, resta puramente di design — quando si deciderà di
  procedere, il mockup salvato + `docs/REDESIGN_ASTA_3D.md` contengono tutto il necessario per
  ripartire senza dover ricostruire il contesto da questa conversazione.

## Prossimo passo consigliato

Verificare dal vivo i due bug fix (plusvalenza/recompra e Anteprima) in un'asta di test prima del
prossimo utilizzo reale della lega — impattano direttamente le regole dell'asta e non sono ancora
stati confermati dall'utente in una situazione reale.
