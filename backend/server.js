const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs   = require('fs');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const app = express();

// ══ SUPABASE (service role — solo backend) ══════════════
const supabaseAdmin = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

async function getRuoloUtente(req) {
  if (!supabaseAdmin) return { error: 'Supabase non configurato sul server', status: 500 };
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return { error: 'Token mancante', status: 401 };
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData || !userData.user) return { error: 'Token non valido', status: 401 };
  const { data: profile, error: profErr } = await supabaseAdmin
    .from('profiles').select('role').eq('id', userData.user.id).single();
  if (profErr || !profile) return { error: 'Profilo utente non trovato', status: 403 };
  return { role: profile.role, userId: userData.user.id };
}

// ══ REGISTRAZIONE — completamento profilo Closed Beta ══════════════
// Il signUp vero e proprio resta lato client (supa.auth.signUp in app.js), perche' l'API pubblica
// di Supabase e' comunque raggiungibile direttamente con la chiave anon: nessun controllo qui
// potrebbe impedire una chiamata diretta a quell'API. Quello che QUESTO endpoint garantisce e' che
// nome/cognome/data di nascita/accettazione condizioni vengano scritti in `profiles` solo dopo una
// validazione server-side indipendente, con timestamp e versione generati sempre dal server, mai
// fidandosi del client. Vedi DECISIONS.md per il ragionamento completo.
const CONDIZIONI_BETA_VERSIONE = '2026-08-08';
const ANNI_MAX_ETA = 120; // limite tecnico di buon senso, non una regola di policy

// NB: nome diverso da getUtenteDaToken (definita più sotto, usata da /api/mie-aste e affini) —
// quella ritorna solo { userId, email } o null, questa ritorna l'oggetto utente completo
// (serve user_metadata per leggere nome/cognome/dataNascita/termsAccepted). Stesso nome avrebbe
// fatto vincere silenziosamente l'ultima dichiarazione in ordine nel file per ENTRAMBI i punti di
// chiamata, con una TypeError a runtime — successo esattamente questo in un deploy precedente.
async function getUtenteCompletoDaToken(req) {
  if (!supabaseAdmin) return { error: 'Supabase non configurato sul server', status: 500 };
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return { error: 'Token mancante', status: 401 };
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data || !data.user) return { error: 'Token non valido', status: 401 };
  return { user: data.user };
}

const server = http.createServer(app);

// ══ ORIGINI CONSENTITE (CORS) ══════════════
// Qui c'era { origin: '*' }: qualunque pagina web poteva aprire un socket verso
// questo server usando il browser di un utente. Non serviva a nessun client reale,
// perche' il frontend e' servito dallo STESSO processo che espone il socket e in
// app.js la connessione si apre con io() senza URL, cioe' same-origin.
//
// La regola e': same-origin sempre ammesso (cosi' il deploy funziona su qualunque
// dominio senza configurare niente), piu' l'eventuale allowlist esplicita in
// ORIGINI_CONSENTITE (lista separata da virgole), piu' i localhost per lo sviluppo.
const ORIGINI_CONSENTITE = (process.env.ORIGINI_CONSENTITE || '')
  .split(',').map(o => o.trim()).filter(Boolean);

// `hosts` sono gli host che il server si vede attribuire: Host e, dietro a un proxy,
// X-Forwarded-Host. Il confronto e' sull'HOSTNAME e non sull'host completo perche' un
// reverse proxy cambia quasi sempre la porta (fuori 443, dentro 3000) e spesso riscrive
// Host con un nome interno lasciando quello vero in X-Forwarded-Host.
//
// Questo dettaglio non e' pedanteria: se il confronto fallisse in produzione, il
// handshake verrebbe rifiutato e NESSUNO potrebbe collegarsi all'asta. Meglio essere
// tolleranti sulla forma dell'host — chi vuole entrare da un dominio diverso resta
// comunque fuori, ed e' l'unica cosa che questo controllo deve impedire.
function origineConsentita(origin, hosts) {
  // Nessun header Origin = richiesta non-browser (curl, health check del provider,
  // app native). Non e' un caso CORS: non c'e' nessun utente da proteggere qui.
  if (!origin) return true;
  if (ORIGINI_CONSENTITE.includes(origin)) return true;
  let nomeOrigine;
  try { nomeOrigine = new URL(origin).hostname; }
  catch (e) { return false; } // Origin malformato
  if (/^(localhost|127\.0\.0\.1)$/.test(nomeOrigine)) return true; // sviluppo
  return (hosts || []).some(h => {
    if (!h) return false;
    // h puo' essere "dominio:porta" oppure una lista "a.com, b.com" (X-Forwarded-Host
    // con piu' proxy in catena): si confronta ogni pezzo, senza porta.
    return String(h).split(',').some(p => p.trim().split(':')[0].toLowerCase() === nomeOrigine.toLowerCase());
  });
}
const opzioniIO = {
  allowRequest: (req, callback) => {
    const ok = origineConsentita(req.headers.origin,
      [req.headers.host, req.headers['x-forwarded-host']]);
    if (!ok) console.warn('[CORS] Handshake socket rifiutato — origin:', req.headers.origin);
    callback(ok ? null : 'origine non consentita', ok);
  }
};
// Header CORS emessi SOLO se e' stata configurata un'allowlist esplicita: senza,
// socket.io non ne emette nessuno e il browser blocca da solo il cross-origin
// (che e' esattamente il comportamento voluto per il caso same-origin reale).
if (ORIGINI_CONSENTITE.length) {
  opzioniIO.cors = { origin: ORIGINI_CONSENTITE, credentials: true };
}
const io = new Server(server, opzioniIO);

// Rete di sicurezza: un errore non gestito in UN singolo handler (es. dati malformati
// mandati da un client) non deve far crashare l'intero processo, cosa che interromperebbe
// TUTTE le aste attive di TUTTI gli utenti contemporaneamente. Logghiamo e continuiamo.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] Errore non gestito (il server continua a funzionare):', err && err.stack || err);
});
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection] Promise rifiutata senza catch (il server continua a funzionare):', err && err.stack || err);
});

app.use(express.static(path.join(__dirname, '..', 'frontend'), {
  setHeaders: (res, filePath) => {
    // Immagini e font cambiano raramente: cache lunga per risparmiare banda.
    // HTML/JS/CSS usano cache-busting (?v=timestamp) o vanno revalidati ad ogni deploy.
    if (/\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    }
  }
}));
// ══ RATE LIMITING ══════════════
// Prima di questo blocco non esisteva NESSUN limite su nessun endpoint: un solo
// client poteva martellare le API (che scrivono su Supabase — vedi l'incidente banda
// di agosto 2026) o mandare corpi da 10MB in ciclo. Tre livelli, dal piu' largo al
// piu' stretto: per IP, per utente al giorno, per evento socket (piu' in basso).

// Hostinger serve l'app dietro a un reverse proxy: senza questo req.ip sarebbe
// SEMPRE l'IP del proxy, quindi tutti gli utenti finirebbero nello stesso contatore
// e il primo che supera la soglia bloccherebbe l'app a tutti gli altri.
app.set('trust proxy', 1);

// Chiave per utente: il campo `sub` del JWT di Supabase, letto SENZA verifica
// crittografica. Va bene per CONTARE le richieste, non e' un controllo di accesso:
// l'autenticazione vera resta getRuoloUtente()/getUtenteDaToken(), che verificano il
// token con Supabase. Verificarlo anche qui costerebbe una chiamata di rete per ogni
// singola richiesta. Chi falsificasse `sub` per sfuggire alla propria quota resterebbe
// comunque soggetto al limite per IP, che non e' falsificabile allo stesso modo.
function chiaveUtenteOIp(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token) {
    try {
      const parti = token.split('.');
      const payload = JSON.parse(Buffer.from(parti[1], 'base64url').toString('utf8'));
      if (payload && payload.sub) return 'u:' + payload.sub;
    } catch (e) { /* token assente o malformato: si ricade sull'IP */ }
  }
  // ipKeyGenerator raggruppa gli IPv6 sulla /56 (il default di express-rate-limit 8),
  // non sulla /64 come diceva prima questo commento. Senza, un singolo utente IPv6
  // avrebbe miliardi di indirizzi e quindi nessun limite effettivo, perche' le privacy
  // extensions gli cambiano gli ultimi 64 bit da sole.
  // Verificato il 2026-08-26 su un indirizzo vero di un telefono in 4G:
  //   2a02:9130:84ab:f570:18cf:58d1:ab7:227f -> 2a02:9130:84ab:f500::/56
  // Lo stesso telefono dopo la rotazione cade nella STESSA chiave; un altro abbonato
  // su una /64 diversa ne prende una sua.
  return 'ip:' + ipKeyGenerator(req.ip);
}

// La finestra "giornaliera" e' di 24h a scorrimento a partire dalla prima richiesta
// della persona, non il giorno di calendario: piu' semplice e senza scalino a mezzanotte.
const UN_GIORNO = 24 * 60 * 60 * 1000;
const QUINDICI_MINUTI = 15 * 60 * 1000;

function creaLimite({ nome, finestra, massimo, messaggio, salta }) {
  return rateLimit({
    windowMs: finestra,
    limit: massimo,
    keyGenerator: chiaveUtenteOIp,
    ...(salta ? { skip: salta } : {}),
    // draft-8 e non draft-7: su una rotta agiscono piu' limiti in cascata (raffica +
    // quota giornaliera + quota specifica) e solo draft-8 sa elencarli tutti insieme.
    // Con draft-7 l'ultimo limite sovrascriveva l'header degli altri, e il client
    // leggeva "ancora 990 richieste" un attimo prima di prendersi un 429.
    standardHeaders: 'draft-8',
    identifier: nome,
    legacyHeaders: false,
    message: { error: messaggio }
  });
}

// ── Dimensionamento: un'asta vera dura 8-9 ore con 12-22 persone collegate ──
//
// Quel carico NON passa di qui: durante l'asta tutto (rilanci, stato, popup) viaggia
// sul WebSocket, e le riconnessioni si limitano a riemettere 'join-asta' sul socket
// senza nessuna chiamata REST. Le rotte /api vengono toccate poche volte per
// caricamento di pagina: stato manutenzione, info asta, qualche foto di fallback.
//
// Il punto delicato e' un altro: le richieste SENZA token vengono contate per IP, e un
// IP puo' essere condiviso per motivi legittimi — due persone della lega sulla stessa
// wifi di casa, e soprattutto un reverse proxy che non inoltrasse l'IP reale, nel qual
// caso TUTTI i partecipanti finirebbero in un unico contatore. Con 22 persone che
// entrano nello stesso momento a inizio asta, una soglia stretta si esaurirebbe proprio
// li'. Le soglie sono percio' generose: restano efficaci contro uno script che martella
// (che le brucia in pochi secondi) ma non possono bloccare una serata vera.
const limiteBurstApi = creaLimite({
  nome: 'raffica-api', finestra: QUINDICI_MINUTI, massimo: 600,
  messaggio: 'Troppe richieste in poco tempo. Riprova tra qualche minuto.',
  salta: eIngressoAsta
});
const limiteGiornalieroApi = creaLimite({
  nome: 'quota-giornaliera', finestra: UN_GIORNO, massimo: 3000,
  messaggio: 'Hai raggiunto il limite giornaliero di richieste. Riprova domani.',
  salta: eIngressoAsta
});

// Le due letture pubbliche che servono per ENTRARE in un'asta hanno un limite loro, piu'
// alto e sganciato dagli altri: sono senza token (quindi contate per IP), non scrivono
// niente e leggono solo dalla memoria. Non devono mai poter chiudere la porta a chi sta
// entrando, che e' esattamente il momento in cui 22 persone bussano insieme.
//
// Si separano con `skip` reciproco e non registrando un handler a parte: dentro a un
// app.use('/api', ...) il next() di una rotta piu' specifica ricadrebbe COMUNQUE nei
// limitatori globali, quindi l'esenzione non varrebbe niente.
// NB: qui req.path e' relativo al mount '/api', percio' '/asta/:id/info' e non
// '/api/asta/:id/info'.
function eIngressoAsta(req) {
  return req.method === 'GET' && (
    req.path === '/admin/manutenzione-status' ||
    /^\/asta\/[^/]+\/info$/.test(req.path)
  );
}
const limiteIngresso = creaLimite({
  nome: 'ingresso-asta', finestra: QUINDICI_MINUTI, massimo: 3000,
  messaggio: 'Troppe richieste in poco tempo. Riprova tra qualche minuto.',
  salta: (req) => !eIngressoAsta(req)
});

app.use('/api', limiteIngresso, limiteBurstApi, limiteGiornalieroApi);

// express.json() viene DOPO i limiti, non prima: altrimenti un client gia' bloccato
// costringerebbe comunque il server a leggere e parsare fino a 10MB di corpo per ogni
// richiesta, solo per riceversi un 429 subito dopo. Cosi' invece il corpo di una
// richiesta oltre soglia non viene nemmeno letto.
app.use(express.json({ limit: '10mb' }));

// Livello 2b — quote giornaliere strette sulle operazioni costose (scrivono su
// Supabase o creano stato nuovo sul server). Si applicano DOPO quelle generali.
const limiteCreazioneAste = creaLimite({
  nome: 'creazione-aste', finestra: UN_GIORNO, massimo: 20,
  messaggio: 'Hai raggiunto il limite di aste creabili in un giorno (20).'
});
const limiteUploadListino = creaLimite({
  nome: 'upload-listino', finestra: UN_GIORNO, massimo: 10,
  messaggio: 'Hai raggiunto il limite di caricamenti del listino in un giorno (10).'
});
const limiteRipristini = creaLimite({
  nome: 'ripristini', finestra: UN_GIORNO, massimo: 30,
  messaggio: 'Troppi ripristini di asta in un giorno. Riprova domani.'
});
// Registrazione: la soglia e' per IP (chi si registra non ha ancora un token), e serve
// a impedire che si creino utenti Supabase in serie da un unico client.
const limiteRegistrazione = creaLimite({
  nome: 'registrazione', finestra: QUINDICI_MINUTI, massimo: 20,
  messaggio: 'Troppi tentativi di registrazione. Riprova tra qualche minuto.'
});

app.post('/api/auth/completa-registrazione', limiteRegistrazione, async (req, res) => {
  // Try/catch esplicito: senza, un'eccezione qui dentro lascerebbe la richiesta del client
  // in attesa per sempre (Express 4 non intercetta automaticamente i reject di una route
  // async), invece di rispondere con un errore visibile.
  try {
    console.log('[completa-registrazione] richiesta ricevuta');
    const { user, error, status } = await getUtenteCompletoDaToken(req);
    if (error) { console.log('[completa-registrazione] getUtenteCompletoDaToken fallito:', error); return res.status(status).json({ error }); }
    console.log('[completa-registrazione] utente verificato:', user.id);

    const { data: profiloEsistente, error: selectErr } = await supabaseAdmin
      .from('profiles').select('terms_accepted').eq('id', user.id).single();
    if (selectErr) console.log('[completa-registrazione] select profilo esistente errore (puo essere normale se 0 righe):', selectErr.message);
    if (profiloEsistente && profiloEsistente.terms_accepted === true) {
      console.log('[completa-registrazione] gia completato in precedenza');
      return res.json({ done: true }); // gia' completato in precedenza, non riscrivere terms_accepted_at
    }

    const meta = user.user_metadata || {};
    if (meta.nome === undefined) {
      console.log('[completa-registrazione] nessun user_metadata.nome, skip (utente vecchio flusso)');
      return res.json({ skipped: true }); // utente registrato col vecchio flusso: nessun dato da sincronizzare
    }

    const nome = typeof meta.nome === 'string' ? meta.nome.trim() : '';
    const cognome = typeof meta.cognome === 'string' ? meta.cognome.trim() : '';
    const dataNascita = typeof meta.dataNascita === 'string' ? new Date(meta.dataNascita + 'T00:00:00Z') : null;
    const termsAccepted = meta.termsAccepted;

    const oggi = new Date(); oggi.setUTCHours(0, 0, 0, 0);
    const limiteMinimo = new Date(oggi); limiteMinimo.setUTCFullYear(oggi.getUTCFullYear() - ANNI_MAX_ETA);

    if (!nome || nome.length > 80) return res.status(400).json({ error: 'Nome non valido' });
    if (!cognome || cognome.length > 80) return res.status(400).json({ error: 'Cognome non valido' });
    if (!dataNascita || isNaN(dataNascita.getTime()) || dataNascita > oggi || dataNascita < limiteMinimo) {
      return res.status(400).json({ error: 'Data di nascita non valida' });
    }
    if (termsAccepted !== true) return res.status(400).json({ error: 'Condizioni di partecipazione alla Closed Beta non accettate' });

    console.log('[completa-registrazione] validazione ok, scrivo su profiles per', user.id);
    const { error: upsertErr } = await supabaseAdmin.from('profiles').upsert({
      id: user.id,
      nome, cognome, data_nascita: meta.dataNascita,
      terms_accepted: true,
      terms_accepted_at: new Date().toISOString(),
      terms_version: CONDIZIONI_BETA_VERSIONE
    }, { onConflict: 'id' });
    if (upsertErr) { console.error('[completa-registrazione] upsert fallito:', upsertErr); return res.status(500).json({ error: 'Errore nel salvataggio del profilo' }); }

    console.log('[completa-registrazione] completato con successo per', user.id);
    res.json({ done: true });
  } catch (e) {
    console.error('[completa-registrazione] eccezione non gestita:', e && e.stack || e);
    res.status(500).json({ error: 'Errore interno' });
  }
});

const aste = new Map();
const timers = new Map();

// ══ BACKUP ══════════════════════════════════
const BACKUP_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(BACKUP_DIR)) { try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch(e) {} }

// Map che tiene traccia dell'ultimo hash del contenuto (asta) salvato su Supabase per ogni asta_id:
// evita di ricaricare su Supabase (consumo di banda "Service-Initiated") lo stesso backup identico
// ogni 30s se nel frattempo non e' cambiato nulla (es. asta in pausa, nessuna offerta nuova).
const _ultimoBackupHash = new Map();

// Toggle globale (Super Admin) per disattivare temporaneamente l'upload dei backup su
// Supabase durante le prove/test, senza perdere il backup locale su disco come rete di
// sicurezza. Persistito nella tabella "app_settings" di Supabase (non solo in RAM), cosi'
// sopravvive a QUALSIASI riavvio/deploy del processo Render. Di default attivo, cosi' il
// comportamento resta invariato finche' non lo si disattiva esplicitamente.
let backupSupabaseAttivo = true;
async function loadBackupSupabaseAttivo() {
  if (!supabaseAdmin) return;
  try {
    const { data, error } = await supabaseAdmin.from('app_settings').select('value').eq('id', 'backup_supabase_attivo').maybeSingle();
    if (!error && data && typeof data.value === 'boolean') backupSupabaseAttivo = data.value;
  } catch (e) { /* non-fatale: resta il default (true) */ }
}
async function persistBackupSupabaseAttivo(valore) {
  if (!supabaseAdmin) return;
  try {
    await supabaseAdmin.from('app_settings').upsert({ id: 'backup_supabase_attivo', value: valore, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  } catch (e) { console.error('[persistBackupSupabaseAttivo] errore (non-fatale):', e.message); }
}

// Toggle globale (Admin) per mostrare a TUTTI gli utenti non-Admin una schermata di
// "app in manutenzione" che blocca l'uso dell'app, utile mentre si fanno modifiche in
// produzione senza che qualcuno inizi/continui un'asta nel frattempo. Persistito in
// "app_settings" come il toggle backup, cosi' sopravvive a riavvii/deploy. Di default
// disattivo.
let manutenzioneAttiva = false;
async function loadManutenzioneAttiva() {
  if (!supabaseAdmin) return;
  try {
    const { data, error } = await supabaseAdmin.from('app_settings').select('value').eq('id', 'manutenzione_attiva').maybeSingle();
    if (!error && data && typeof data.value === 'boolean') manutenzioneAttiva = data.value;
  } catch (e) { /* non-fatale: resta il default (false) */ }
}
async function persistManutenzioneAttiva(valore) {
  if (!supabaseAdmin) return;
  try {
    await supabaseAdmin.from('app_settings').upsert({ id: 'manutenzione_attiva', value: valore, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  } catch (e) { console.error('[persistManutenzioneAttiva] errore (non-fatale):', e.message); }
}

function saveBackup(asta) {
  if (!asta || !asta.id) return;
  try {
    const astaJson = JSON.stringify(asta);
    const snap = { backup: true, timestamp: new Date().toISOString(), asta: JSON.parse(astaJson) };
    fs.writeFileSync(path.join(BACKUP_DIR, 'backup_asta_' + asta.id + '.json'), JSON.stringify(snap));
    const hash = crypto.createHash('sha1').update(astaJson).digest('hex');
    if (_ultimoBackupHash.get(asta.id) === hash) return;
    _ultimoBackupHash.set(asta.id, hash);
    if (backupSupabaseAttivo) saveBackupSupabase(asta, snap);
  } catch(e) { /* non-fatal */ }
}

// Salva il backup anche su Supabase (Postgres persistente), così sopravvive a QUALSIASI
// riavvio del processo Render (crash, deploy, manutenzione) — non solo al risveglio da sleep.
// Fire-and-forget: non blocca mai il flusso principale, eventuali errori vengono solo loggati.
function saveBackupSupabase(asta, snap) {
  if (!supabaseAdmin || !asta || !asta.id) return;
  supabaseAdmin.from('asta_backups')
    .upsert({ asta_id: asta.id, payload: snap, updated_at: new Date().toISOString() }, { onConflict: 'asta_id' })
    .then(({ error }) => { if (error) console.error('[saveBackupSupabase] errore (non-fatale):', error.message); })
    .catch(e => console.error('[saveBackupSupabase] eccezione (non-fatale):', e.message));
}

// Salva un export permanente dell'asta conclusa nello "Storico Esportazioni", visibile dalla
// Home a chiunque (indipendentemente dal dispositivo/browser usato), e sopravvive a riavvii
// del server. Non sovrascrive nulla: ogni asta terminata crea una nuova riga (id generato da
// Postgres), così l'admin può cancellare singole voci senza toccare le altre.
function saveExportSupabase(asta) {
  if (!supabaseAdmin || !asta || !asta.id) return;
  supabaseAdmin.from('asta_exports')
    .insert({ asta_id: asta.id, tipo_asta: asta.tipoAsta || null, payload: JSON.parse(JSON.stringify(asta)) })
    .then(({ error }) => { if (error) console.error('[saveExportSupabase] errore (non-fatale):', error.message); })
    .catch(e => console.error('[saveExportSupabase] eccezione (non-fatale):', e.message));
}

// Elimina il backup "asta in corso" quando l'asta è terminata: a quel punto esiste già
// una copia definitiva in asta_exports (Storico Esportazioni), quindi il backup non serve
// più a nessuno (nessuno "riprenderà" un'asta già conclusa) — evita che asta_backups
// accumuli righe orfane per ogni asta mai giocata.
function deleteBackupSupabase(astaId) {
  if (!supabaseAdmin || !astaId) return;
  supabaseAdmin.from('asta_backups').delete().eq('asta_id', astaId)
    .then(({ error }) => { if (error) console.error('[deleteBackupSupabase] errore (non-fatale):', error.message); })
    .catch(e => console.error('[deleteBackupSupabase] eccezione (non-fatale):', e.message));
}

async function loadBackups() {
  // 1) Priorità a Supabase: è l'unica fonte che sopravvive a un riavvio completo del container.
  if (supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin.from('asta_backups').select('asta_id, payload, updated_at');
      if (error) {
        console.error('[loadBackups] Errore lettura Supabase (non-fatale, uso solo backup locale):', error.message);
      } else if (data) {
        let n = 0;
        data.forEach(row => {
          try {
            const snap = row.payload;
            if (snap && snap.backup && snap.asta && snap.asta.id && !aste.has(snap.asta.id)) {
              snap.asta.adminSocketIds = [];
              snap.asta.squadre.forEach(s => { s.utenti = []; s.online = false; });
              aste.set(snap.asta.id, snap.asta);
              n++;
              console.log('  ☁️  Ripristinata da Supabase: ' + (snap.asta.nome || snap.asta.id) + ' (' + row.updated_at + ')');
            }
          } catch(e) { /* skip corrupt row */ }
        });
        if (n > 0) console.log('✅ ' + n + ' asta/e ripristinate da Supabase');
      }
    } catch(e) { console.error('[loadBackups] Eccezione Supabase (non-fatale, uso solo backup locale):', e.message); }
  }
  // 2) Fallback su disco locale — utile in sviluppo locale o se Supabase non è configurato,
  //    e come seconda rete di sicurezza (dedup automatico: !aste.has() salta ciò già ripristinato sopra).
  try {
    if (!fs.existsSync(BACKUP_DIR)) return;
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('backup_asta_') && f.endsWith('.json'));
    let n = 0;
    files.forEach(file => {
      try {
        const raw = fs.readFileSync(path.join(BACKUP_DIR, file), 'utf-8');
        const data = JSON.parse(raw);
        if (data.backup && data.asta && data.asta.id && !aste.has(data.asta.id)) {
          // Restore arrays that may have been serialized
          data.asta.adminSocketIds = [];
          data.asta.squadre.forEach(s => { s.utenti = []; s.online = false; });
          aste.set(data.asta.id, data.asta);
          n++;
          console.log('  ♻️  Ripristinata da disco locale: ' + (data.asta.nome || data.asta.id) + ' (' + data.timestamp + ')');
        }
      } catch(e) { /* skip corrupt file */ }
    });
    if (n > 0) console.log('✅ ' + n + ' asta/e ripristinate da disco locale');
  } catch(e) { console.error('loadBackups error:', e.message); }
}

// ============ HELPERS ============
// Costruisce i campi legati ai crediti di una squadra al momento della creazione (asta
// o join in lobby). "creditiImportati" e' la base fissa (crediti gia' posseduti da un
// import Excel/JSON, es. riporto stagione precedente) e non cambia mai dopo la
// creazione. "creditiConfigurati" e' la parte "a manopola" (di norma = asta.crediti),
// modificabile in seguito dall'Admin per QUESTA squadra via "admin-update-crediti".
// "creditiIniziali" = creditiImportati + creditiConfigurati e' il budget di riferimento
// STABILE (non scende con gli acquisti, a differenza di "crediti") usato per calcolare
// i prezzi percentuali di una Strategia applicata durante l'asta.
function campiCrediti(creditiImportati, creditiConfigurati) {
  const iniziali = (creditiImportati || 0) + (creditiConfigurati || 0);
  return { crediti: iniziali, creditiImportati: creditiImportati || 0, creditiConfigurati: creditiConfigurati || 0, creditiIniziali: iniziali };
}

function isPortiere(ruolo) { return ruolo === 'Por' || ruolo === 'P'; }
function getSquadra(asta, nome) { return asta.squadre.find(s => s.nome === nome); }
function getSquadraBySocket(asta, socketId) { return asta.squadre.find(s => s.utenti.includes(socketId)); }
function isAdmin(asta, socketId) { return asta.adminSocketIds.includes(socketId); }

function emitToSquadra(astaId, nomeSq, event, data) {
  const asta = aste.get(astaId); if (!asta) return;
  const sq = getSquadra(asta, nomeSq);
  if (sq) sq.utenti.forEach(sid => io.to(sid).emit(event, data));
}
function emitToAdmins(astaId, event, data) {
  const asta = aste.get(astaId); if (!asta) return;
  asta.adminSocketIds.forEach(sid => io.to(sid).emit(event, data));
}

function broadcastStato(astaId, doBackup) {
  const asta = aste.get(astaId); if (!asta) return;
  if (doBackup && asta.stato !== 'attesa') saveBackup(asta);
  const stato = {
    // svincoliVietati e' un Set (diventerebbe {} vuoto via JSON, nessun client deve leggerlo
    // comunque: e' solo un gate server-side sul rilancio) — escluso esplicitamente come
    // adminSocketIds, invece di lasciarlo spargere involontariamente nel payload.
    ...asta, adminSocketIds: undefined, svincoliVietati: undefined,
    squadre: asta.squadre.map(s => ({
      ...s, utenti: undefined, numUtenti: s.utenti.length, online: s.utenti.length > 0
    }))
  };
  io.to(astaId).emit('stato-asta', stato);
}

// ============ GAME MECHANICS ============
// I minimi Portieri/Movimento sono due vincoli SEPARATI, non un totale unico: riservare
// crediti solo in base al totale (minimoPortieri + minimoMovimento - rosa.length) permette
// di svuotare una delle due categorie se l'altra e' gia' oltre il suo minimo (es. squadra con
// tanti giocatori di movimento ma un solo portiere continuava a poter offrire tutti i crediti
// residui, restando poi bloccata a fine asta senza poter completare i portieri minimi). Il
// "giocatore" attualmente chiamato conta verso la SUA categoria (Por o movimento), le altre
// categorie restano comunque riservate per il loro minimo.
// Recupero crediti da uno svincolo: arrotondamento NORMALE (non floor) del prezzo per il
// fattore di riparazione, con un pavimento di 1 credito garantito (nessuno svincolo puo'
// mai fruttare 0, nemmeno un giocatore costato 1cr in Riparazione 2 dove 1*1/3 arrotonda a
// 0). Math.round in JS arrotonda .5 sempre per eccesso (1.5->2, 2.5->3), coerente con gli
// esempi forniti per Riparazione 1 (fattore 0.5).
function calcolaRecuperoSvincolo(prezzo, fattore) {
  return Math.max(1, Math.round(prezzo * fattore));
}

// Liste rosa ordinate per valore di svincolo (prezzo*fattoreSvincolo) decrescente, separate
// per categoria, con prefix-sum: permette di calcolare in O(1) "quanto si recupera liberando
// i top-N di una categoria", usato sia per la Massima Offerta sia per il piano minimo post-
// vittoria (vedi sotto) senza riordinare la rosa ad ogni combinazione testata.
function costruisciListeOrdinateSvincolo(asta, squadra) {
  const fattore = asta.fattoreSvincolo || 0.5;
  const valore = g => calcolaRecuperoSvincolo(g.prezzo, fattore);
  const portieri = squadra.rosa.filter(g => isPortiere(g.ruolo)).slice().sort((a, b) => valore(b) - valore(a));
  const movimento = squadra.rosa.filter(g => !isPortiere(g.ruolo)).slice().sort((a, b) => valore(b) - valore(a));
  const prefixPor = [0]; portieri.forEach(g => prefixPor.push(prefixPor[prefixPor.length - 1] + valore(g)));
  const prefixMov = [0]; movimento.forEach(g => prefixMov.push(prefixMov[prefixMov.length - 1] + valore(g)));
  return { portieri, movimento, prefixPor, prefixMov };
}

// Massima Offerta in riparazione: cerca su tutte le combinazioni (p portieri, m movimento da
// liberare, p+m <= svincoliRimanenti) quella che MASSIMIZZA crediti recuperabili meno crediti
// riservati per i minimi — la riserva e' calcolata SIMULANDO la rimozione di p/m giocatori
// dalla rosa attuale prima di confrontare col minimo, non sulla rosa cosi' com'e' oggi:
// altrimenti si ignora che liberare giocatori per pagare l'offerta puo' far scendere sotto i
// minimi. Non forza l'uso di tutti gli svincoli disponibili: un ultimo svincolo che costa piu'
// in riserva di quanto recupera in crediti non viene scelto (si cerca il MASSIMO, non si
// assume k=svincoliRimanenti). kRoster e' un vincolo DURO (a differenza dei minimi, che sono
// solo una riserva "morbida" sui crediti): se la rosa e' gia' al tetto
// asta.maxGiocatoriPerSquadra serve fare spazio per forza, altrimenti l'offerta e' impossibile
// a prescindere dai crediti disponibili.
function calcolaPianoSvincoloOttimale(asta, squadra, giocatore, svincoliRimanenti, capMax) {
  const { portieri, movimento, prefixPor, prefixMov } = costruisciListeOrdinateSvincolo(asta, squadra);
  const minimoPortieri = asta.minimoPortieri || 0;
  const minimoMovimento = asta.minimoMovimento || 0;
  const portieriAttuali = portieri.length, movimentoAttuali = movimento.length;
  const ePortiere = giocatore ? isPortiere(giocatore.ruolo) : null;
  const kRoster = Math.max(0, (squadra.rosa.length + 1) - capMax);
  if (kRoster > svincoliRimanenti) return { possibile: false, maxOfferta: 0, valoreGrezzo: -Infinity };

  let best = null;
  const maxP = Math.min(portieriAttuali, svincoliRimanenti);
  for (let p = 0; p <= maxP; p++) {
    const mMax = Math.min(movimentoAttuali, svincoliRimanenti - p);
    for (let m = Math.max(0, kRoster - p); m <= mMax; m++) {
      const creditiRecuperabili = prefixPor[p] + prefixMov[m];
      const portieriDopo = portieriAttuali - p + (ePortiere === true ? 1 : 0);
      const movimentoDopo = movimentoAttuali - m + (ePortiere === false ? 1 : 0);
      const creditiRiservati = Math.max(0, minimoPortieri - portieriDopo) + Math.max(0, minimoMovimento - movimentoDopo);
      const valoreNetto = creditiRecuperabili - creditiRiservati;
      if (!best || valoreNetto > best.valoreNetto) best = { p, m, valoreNetto };
    }
  }
  if (!best) return { possibile: false, maxOfferta: 0, valoreGrezzo: -Infinity };
  const valoreGrezzo = squadra.crediti + best.valoreNetto;
  // BUG REALE trovato e corretto (vedi DECISIONS.md): qui c'era un pavimento
  // "Math.max(1, valoreGrezzo)" che garantiva SEMPRE almeno 1 credito di offerta consentita,
  // anche quando valoreGrezzo e' negativo — cioe' quando anche la MIGLIOR strategia futura non
  // basta a coprire il deficit. calcolaMaxOfferta() delega direttamente a questo valore per
  // bloccare i rilanci: un pavimento a 1 permetteva quindi di vincere un'offerta "fantasma" da
  // 1 credito in uno stato gia' senza via d'uscita (verificaCapacitaRecupero lo avrebbe
  // rilevato come irrecuperabile, ma calcolaMaxOfferta non era mai arrivato a chiamarla per
  // bloccare la puja in tempo — le due funzioni erano disallineate). Nessun test dei 10
  // scenari mandatori copriva questo ramo perche' verificaCapacitaRecupero era stata testata
  // separatamente, mai il valore di ritorno di calcolaMaxOfferta in uno scenario con
  // valoreGrezzo negativo. Il pavimento corretto e' 0 (nessuna offerta consentita), non 1.
  return { possibile: true, maxOfferta: Math.max(0, valoreGrezzo), valoreGrezzo };
}

// Rileva uno stato SENZA VIA D'USCITA: dopo un'operazione, verifica se esiste ancora
// QUALUNQUE strategia futura (con gli svincoli/crediti che restano) capace di raggiungere i
// minimi Portieri/Movimento — non se li raggiunge gia' subito, solo se un percorso resta
// possibile (stessa convenzione "1 credito riservato = 1 giocatore mancante" gia' usata in
// tutto il sistema). Se anche la MIGLIOR strategia futura lascia un deficit di crediti,
// l'operazione va bloccata: altrimenti la squadra resterebbe sotto i minimi per sempre, senza
// nessuna possibilita' di recupero — bug reale osservato (squadra Adriano&Federico, riparazione
// 18/19 agosto: 0 crediti, 0 svincoli, 0 portieri su un minimo di 3, nessuna via d'uscita).
function verificaCapacitaRecupero(asta, squadraSimulata, svincoliRimanenti, capMax) {
  const piano = calcolaPianoSvincoloOttimale(asta, squadraSimulata, null, Math.max(0, svincoliRimanenti), capMax);
  return piano.possibile && piano.valoreGrezzo >= 0;
}

// Post-vittoria: numero MINIMO di giocatori da liberare per completare legalmente
// l'operazione — coprire il debito di crediti E fare spazio in rosa se serve (due vincoli
// DURI). I minimi Portieri/Movimento restano solo un criterio di spareggio tra piani con lo
// stesso numero di svincoli (la rosa PUO' scendere temporaneamente sotto i minimi dopo uno
// svincolo, non e' mai un motivo per bloccarlo). Riusata sia per aprire/popolare il popup di
// svincolo sia per validare lato server cosa l'allenatore ha davvero scelto — mai fidarsi
// solo del client, stesso principio gia' applicato al timer d'asta.
function calcolaSvincoliMinimiPerVittoria(asta, squadra, giocatore, prezzoFinale, capMax) {
  const svincoliRimanenti = asta.svincoliTotali - (squadra.svincoliUsati || 0);
  const { portieri, movimento, prefixPor, prefixMov } = costruisciListeOrdinateSvincolo(asta, squadra);
  const portieriAttuali = portieri.length, movimentoAttuali = movimento.length;
  const creditoGap = Math.max(0, prezzoFinale - squadra.crediti);
  const kRoster = Math.max(0, (squadra.rosa.length + 1) - capMax);
  if (kRoster > svincoliRimanenti) return { possibile: false, creditoGap, kRoster, svincoliRimanenti };

  const minimoPortieri = asta.minimoPortieri || 0;
  const minimoMovimento = asta.minimoMovimento || 0;
  const ePortiere = giocatore ? isPortiere(giocatore.ruolo) : null;
  let best = null;
  const maxP = Math.min(portieriAttuali, svincoliRimanenti);
  for (let p = 0; p <= maxP; p++) {
    const mMax = Math.min(movimentoAttuali, svincoliRimanenti - p);
    for (let m = Math.max(0, kRoster - p); m <= mMax; m++) {
      const creditiRecuperabili = prefixPor[p] + prefixMov[m];
      if (creditiRecuperabili < creditoGap) continue;
      const k = p + m;
      const portieriDopo = portieriAttuali - p + (ePortiere === true ? 1 : 0);
      const movimentoDopo = movimentoAttuali - m + (ePortiere === false ? 1 : 0);
      const creditiRiservati = Math.max(0, minimoPortieri - portieriDopo) + Math.max(0, minimoMovimento - movimentoDopo);
      if (!best || k < best.k || (k === best.k && creditiRiservati < best.creditiRiservati)) {
        best = { p, m, k, creditiRiservati };
      }
    }
  }
  if (!best) return { possibile: false, creditoGap, kRoster, svincoliRimanenti };
  return {
    possibile: true, minSvincoli: best.k, creditoGap, kRoster, svincoliRimanenti,
    suggerimento: {
      portieriDaLiberare: portieri.slice(0, best.p).map(g => g.id),
      movimentoDaLiberare: movimento.slice(0, best.m).map(g => g.id)
    }
  };
}

// Tetto TOTALE rosa (portieri+movimento) e minimi per categoria: vedi commento sopra per il
// perche' i minimi sono due riserve separate. In 'iniziale' il tetto rosa blocca subito
// l'offerta (nessun modo di liberare spazio in questo tipo di asta). In 'riparazione' il
// tetto NON blocca subito se restano svincoli disponibili — la squadra potrebbe liberare
// spazio dopo aver vinto (vedi calcolaSvincoliMinimiPerVittoria) — quindi la decisione si
// delega a calcolaPianoSvincoloOttimale, che include gia' questo vincolo (kRoster).
function calcolaMaxOfferta(asta, squadra, giocatore) {
  const capMax = asta.maxGiocatoriPerSquadra || 25;

  if (asta.tipoAsta === 'iniziale') {
    if (squadra.rosa.length >= capMax) return 0;
    const minimoPortieri = asta.minimoPortieri || 0;
    const minimoMovimento = asta.minimoMovimento || 0;
    const portieriAttuali = squadra.rosa.filter(g => isPortiere(g.ruolo)).length;
    const movimentoAttuali = squadra.rosa.length - portieriAttuali;
    const ePortiere = giocatore ? isPortiere(giocatore.ruolo) : null;
    const portieriDopo = portieriAttuali + (ePortiere === true ? 1 : 0);
    const movimentoDopo = movimentoAttuali + (ePortiere === false ? 1 : 0);
    const creditiRiservati = Math.max(0, minimoPortieri - portieriDopo) + Math.max(0, minimoMovimento - movimentoDopo);
    return Math.max(1, squadra.crediti - creditiRiservati);
  }

  // BUG REALE trovato e corretto (vedi DECISIONS.md): esisteva qui un ramo speciale
  // "if (svincoliRimanenti <= 0) return squadra.crediti" che restituiva i crediti CRUDI,
  // ignorando del tutto la riserva per i minimi Portieri/Movimento — permetteva di spendere
  // fino all'ultimo credito anche restando sotto i minimi, senza NESSUNA possibilita' futura
  // di recuperare (lo svincolo, unica fonte di nuovi crediti in riparazione, era gia'
  // esaurito). calcolaPianoSvincoloOttimale gestisce GIA' correttamente il caso
  // svincoliRimanenti<=0 da solo (i limiti del ciclo collassano a un'unica combinazione
  // p=0,m=0: nessun recupero possibile, solo riserva sui minimi correnti) — delegare sempre
  // a lei, senza scorciatoie, elimina il bug e lascia un solo percorso/una sola fonte di
  // verita' per il calcolo.
  const svincoliRimanenti = Math.max(0, asta.svincoliTotali - (squadra.svincoliUsati || 0));
  const piano = calcolaPianoSvincoloOttimale(asta, squadra, giocatore, svincoliRimanenti, capMax);
  return piano.maxOfferta;
}

function assegnaGiocatoreASquadra(asta, giocatore, squadra, prezzo, usatoSlotRIC) {
  giocatore.assegnato = true;
  const tipoFinale = usatoSlotRIC ? 'PLUS' : (prezzo >= 20 ? 'NN' : 'RIC');
  squadra.rosa.push({ ...giocatore, prezzo, id: giocatore.id, tipo: tipoFinale });
  squadra.crediti -= prezzo;
}

function avviaChiamata(astaId, giocatore, manuale) {
  const asta = aste.get(astaId); if (!asta) return;
  giocatore.estratto = true;

  // RIC: offri conferma al proprietario precedente
  if (asta.tipoAsta === 'iniziale' && giocatore.tipo === 'RIC' && giocatore.squadraOriginale) {
    const sqPrec = getSquadra(asta, giocatore.squadraOriginale);
    const haSlot = sqPrec && (sqPrec.slotsRIC - sqPrec.slotsRICUsati) > 0;
    const haCrediti = sqPrec && sqPrec.crediti >= giocatore.costoOriginale;
    const haSpazio = sqPrec && sqPrec.rosa.length < (asta.maxGiocatoriPerSquadra || 25);
    if (haSlot && haCrediti && haSpazio) {
      asta.chiamataAttuale = {
        giocatore, offertaAttuale: giocatore.costoOriginale, squadraOfferente: null,
        proprietarioPrecedente: giocatore.squadraOriginale, aspettandoConferma: true,
        fase: 'conferma', timer: 0, manuale: !!manuale
      };
      broadcastStato(astaId);
      const popupData = { giocatore, costoConferma: giocatore.costoOriginale, proprietario: giocatore.squadraOriginale };
      // Show card to ALL players (aspettandoConferma=true suppresses rilancio box on client)
      io.to(astaId).emit('nuova-chiamata', asta.chiamataAttuale);
      emitToSquadra(astaId, giocatore.squadraOriginale, 'popup-ric-conferma', popupData);
      emitToAdmins(astaId, 'popup-ric-conferma-admin', popupData);
      if (manuale) io.to(astaId).emit('chiamata-manuale-avviso', { giocatore });
      return;
    }
  }

  // Asta normale — prezzo parte da 0 (prima offerta = 1)
  asta.chiamataAttuale = {
    giocatore, offertaAttuale: 0, squadraOfferente: null,
    proprietarioPrecedente: giocatore.squadraOriginale || null,
    aspettandoConferma: false,
    fase: 'prima', timer: asta.timerPrimaChiamata, manuale: !!manuale
  };
  broadcastStato(astaId);
  io.to(astaId).emit('nuova-chiamata', asta.chiamataAttuale);
  if (manuale) io.to(astaId).emit('chiamata-manuale-avviso', { giocatore });
  startTimer(astaId, 'prima');
}

function scartaGiocatore(astaId) {
  const asta = aste.get(astaId); if (!asta || !asta.chiamataAttuale) return;
  const { giocatore } = asta.chiamataAttuale;
  giocatore.estratto = true; giocatore.scartato = true;
  asta.storico.push({ giocatore, prezzo: 0, squadra: null, tipo: 'scartato', timestamp: new Date().toISOString() });
  asta.chiamataAttuale = null;
  io.to(astaId).emit('giocatore-scartato', { giocatore });
  broadcastStato(astaId, true);
}

function chiudiAsta(astaId) {
  const asta = aste.get(astaId); if (!asta || !asta.chiamataAttuale) return;
  const chiamata = asta.chiamataAttuale;
  const { giocatore, offertaAttuale, squadraOfferente } = chiamata;

  // RIC/PLUS post-auction (solo asta iniziale)
  if (asta.tipoAsta === 'iniziale' && giocatore.squadraOriginale && squadraOfferente && squadraOfferente !== giocatore.squadraOriginale) {
    const sqPrec = getSquadra(asta, giocatore.squadraOriginale);
    // Persistente su giocatore (non sulla chiamata, che viene ricreata ad ogni ri-chiamata/
    // riapertura): una volta che il proprietario precedente ha punteggiato su questo giocatore,
    // il diritto a plusvalenza/recompra resta perso per tutta l'asta, a prescindere da timer
    // scaduti, riaperture, annullamenti o nuove estrazioni dello stesso giocatore.
    const prevBid = !!giocatore.dirittoRiacquistoPerso;
    if (!prevBid && sqPrec && giocatore.tipo === 'RIC') {
      const hasPLUS = (sqPrec.slotsPLUS - sqPrec.slotsPLUSUsati) > 0;
      const hasRecompra = (sqPrec.recompra - sqPrec.recompraUsati) > 0 && sqPrec.rosa.length < (asta.maxGiocatoriPerSquadra || 25);
      if (hasPLUS || hasRecompra) {
        asta.popupAttivo = { tipo: 'post-asta-ric', giocatore, prezzoFinale: offertaAttuale, squadraVincitrice: squadraOfferente, proprietarioPrecedente: giocatore.squadraOriginale, opzioni: { plusvalenza: hasPLUS, recompra: hasRecompra } };
        asta.chiamataAttuale = null;
        emitToSquadra(astaId, giocatore.squadraOriginale, 'popup-post-asta', asta.popupAttivo);
        emitToAdmins(astaId, 'popup-post-asta-admin', asta.popupAttivo);
        broadcastStato(astaId); return;
      }
    }
    if (!prevBid && sqPrec && giocatore.tipo === 'PLUS') {
      const hasPLUS = (sqPrec.slotsPLUS - sqPrec.slotsPLUSUsati) > 0;
      if (hasPLUS) {
        asta.popupAttivo = { tipo: 'post-asta-plus', giocatore, prezzoFinale: offertaAttuale, squadraVincitrice: squadraOfferente, proprietarioPrecedente: giocatore.squadraOriginale, opzioni: { plusvalenza: true, recompra: false } };
        asta.chiamataAttuale = null;
        emitToSquadra(astaId, giocatore.squadraOriginale, 'popup-post-asta', asta.popupAttivo);
        emitToAdmins(astaId, 'popup-post-asta-admin', asta.popupAttivo);
        broadcastStato(astaId); return;
      }
    }
  }

  // Svincolo (riparazione): scatta se manca il credito PER PAGARE l'offerta O manca lo
  // spazio in rosa rispetto al tetto configurato — non solo per crediti insufficienti come
  // prima, perche' altrimenti una squadra al tetto non potrebbe mai completare una vittoria
  // anche avendo svincoli disponibili per fare posto (vedi calcolaMaxOfferta).
  if (asta.tipoAsta === 'riparazione' && squadraOfferente) {
    const sq = getSquadra(asta, squadraOfferente);
    const capMax = asta.maxGiocatoriPerSquadra || 25;
    if (sq) {
      const creditoGap = Math.max(0, offertaAttuale - sq.crediti);
      const kRoster = Math.max(0, (sq.rosa.length + 1) - capMax);
      if (creditoGap > 0 || kRoster > 0) {
        const piano = calcolaSvincoliMinimiPerVittoria(asta, sq, giocatore, offertaAttuale, capMax);
        if (!piano.possibile) {
          // Non dovrebbe accadere se calcolaMaxOfferta ha fatto il suo lavoro (puo' capitare
          // solo con un'assegnazione manuale che ignora i limiti) — si blocca l'operazione
          // invece di lasciare crediti negativi o la rosa oltre il tetto senza modo di
          // rientrare. chiamataAttuale NON viene toccata: l'admin puo' riprovare.
          emitToAdmins(astaId, 'errore-svincolo-impossibile', {
            giocatore, offertaAttuale, squadraOfferente,
            motivo: `Anche liberando tutti gli svincoli residui (${piano.svincoliRimanenti}) non basta a completare l'operazione (debito ${piano.creditoGap}cr, ${piano.kRoster} slot da liberare per il tetto rosa).`
          });
          return;
        }
        asta.popupAttivo = {
          tipo: 'svincolo', giocatore, prezzoFinale: offertaAttuale, squadraVincitrice: squadraOfferente,
          differenza: creditoGap, svincoliRimanenti: piano.svincoliRimanenti,
          roomGap: kRoster, minSvincoli: piano.minSvincoli, suggerimento: piano.suggerimento
        };
        asta.chiamataAttuale = null;
        emitToSquadra(astaId, squadraOfferente, 'popup-svincolo', { ...asta.popupAttivo, rosa: sq.rosa, fattoreSvincolo: asta.fattoreSvincolo || 0.5 });
        // Stesso payload arricchito della squadra (rosa+fattoreSvincolo): l'Admin deve poter
        // eseguire lo svincolo anche lui come backup, non solo vedere un messaggio di attesa
        // (esegui-svincolo accetta gia' l'Admin indipendentemente dalla squadra proprietaria).
        emitToAdmins(astaId, 'popup-svincolo-admin', { ...asta.popupAttivo, rosa: sq.rosa, fattoreSvincolo: asta.fattoreSvincolo || 0.5 });
        broadcastStato(astaId); return;
      }
    }
  }

  // Assegnazione normale
  const sqVincitrice = getSquadra(asta, squadraOfferente);
  if (sqVincitrice) assegnaGiocatoreASquadra(asta, giocatore, sqVincitrice, offertaAttuale);
  asta.storico.push({ giocatore, prezzo: offertaAttuale, squadra: squadraOfferente, tipo: 'normale', manuale: !!chiamata.manuale, timestamp: new Date().toISOString() });
  asta.chiamataAttuale = null;
  io.to(astaId).emit('giocatore-assegnato', { giocatore, prezzo: offertaAttuale, squadra: squadraOfferente, tipo: 'normale', manuale: !!chiamata.manuale });
  broadcastStato(astaId, true);
}

// Helper: annulla item di storico
function _annullaItem(asta, index) {
  const item = asta.storico[index]; if (!item) return;
  asta.storico.splice(index, 1);
  if (item.tipo === 'scartato') {
    const g = asta.poolGiocatori.find(p => p.id === item.giocatore.id || p.nome === item.giocatore.nome);
    if (g) { g.estratto = false; g.scartato = false; }
  } else {
    const sq = getSquadra(asta, item.squadra);
    if (sq) {
      sq.crediti += item.prezzo;
      const idx = sq.rosa.findIndex(g => g.id === item.giocatore.id || g.nome === item.giocatore.nome);
      if (idx !== -1) sq.rosa.splice(idx, 1);
      if (item.tipo === 'riconferma') sq.slotsRICUsati = Math.max(0, sq.slotsRICUsati - 1);
      if (item.tipo === 'plusvalenza') {
        const sqPrec = getSquadra(asta, item.plusvalenzaA);
        if (sqPrec) {
          sqPrec.crediti -= (item.guadagno || 0);
          sqPrec.slotsPLUSUsati = Math.max(0, sqPrec.slotsPLUSUsati - 1);
        }
      }
      if (item.tipo === 'recompra') sq.recompraUsati = Math.max(0, (sq.recompraUsati || 0) - 1);
      // Asta di riparazione: un acquisto "con_svincolo" aveva anche liberato uno o piu'
      // giocatori per finanziarlo (item.svincolati, salvato da 'esegui-svincolo' con lo
      // snapshot completo del giocatore + creditiRecuperati) — annullare l'acquisto senza
      // disfare anche quella parte lascerebbe crediti gonfiati, slot svincolo non restituiti
      // e quei giocatori persi fuori rosa per sempre. Rollback completo dell'operazione.
      if (item.tipo === 'con_svincolo' && Array.isArray(item.svincolati)) {
        item.svincolati.forEach(sv => {
          sq.crediti -= (sv.creditiRecuperati || 0);
          sq.svincoliUsati = Math.max(0, (sq.svincoliUsati || 0) - 1);
          const { creditiRecuperati, ...giocatoreOriginale } = sv;
          sq.rosa.push(giocatoreOriginale);
          asta.svincoliVietati.delete(sq.nome + '|' + sv.id);
          const gSvincolato = asta.poolGiocatori.find(p => p.id === sv.id);
          if (gSvincolato) { gSvincolato.estratto = true; gSvincolato.assegnato = true; gSvincolato.scartato = false; }
        });
      }
    }
    const g = asta.poolGiocatori.find(p => p.id === item.giocatore.id || p.nome === item.giocatore.nome);
    if (g) { g.estratto = false; g.assegnato = false; g.scartato = false; }
  }
}

// ============ TIMER ============
function startTimer(astaId, fase) {
  clearTimer(astaId);
  const asta = aste.get(astaId); if (!asta || !asta.chiamataAttuale) return;
  const durata = fase === 'prima' ? asta.timerPrimaChiamata : asta.timerRilancio;
  asta.chiamataAttuale.timer = durata;
  asta.chiamataAttuale.fase = fase;
  io.to(astaId).emit('timer-start', { secondi: durata, fase });

  const interval = setInterval(() => {
    const a = aste.get(astaId);
    if (!a || !a.chiamataAttuale) { clearTimer(astaId); return; }
    a.chiamataAttuale.timer--;
    io.to(astaId).emit('timer-tick', { secondi: a.chiamataAttuale.timer, fase: a.chiamataAttuale.fase });
    if (a.chiamataAttuale.timer <= 0) {
      clearTimer(astaId);
      a.chiamataAttuale.fase = 'attesa-conferma';
      io.to(astaId).emit('attesa-conferma', a.chiamataAttuale);
      broadcastStato(astaId);
    }
  }, 1000);
  timers.set(astaId, interval);
}
function resetTimer(astaId, fase) { startTimer(astaId, fase); }
function clearTimer(astaId) {
  if (timers.has(astaId)) { clearInterval(timers.get(astaId)); timers.delete(astaId); }
}

// ============ API REST ============
app.post('/api/asta', limiteCreazioneAste, async (req, res) => {
  // Creare un'asta richiede login (Supabase Auth): l'asta viene associata al creatore
  // (creatorUserId/creatorEmail), così può ritrovarla in "Mie aste" da qualunque dispositivo,
  // senza dover conservare manualmente nessun link/token.
  if (!supabaseAdmin) return res.status(500).json({ error: 'Supabase non configurato sul server' });
  const authHeader = req.headers.authorization || '';
  const authToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!authToken) return res.status(401).json({ error: "Devi effettuare il login per creare un'asta" });
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(authToken);
  if (userErr || !userData || !userData.user) return res.status(401).json({ error: 'Sessione non valida, effettua di nuovo il login' });

  const id = uuidv4();
  const b = req.body;
  const sottoTipo = b.sottoTipoRiparazione || '1';
  const fattoreSvincolo = sottoTipo === '2' ? (1 / 3) : 0.5;

  // Il Listino Ufficiale produce sempre squadre vuote (tutti i giocatori diventano
  // svincolati) — un'asta di riparazione partirebbe senza alcuna rosa pregressa da cui
  // svincolare, uno scenario che non ha senso per questo tipo di asta.
  if (b.tipoAsta === 'riparazione' && b.fonteListino) {
    return res.status(400).json({ error: "Non è possibile creare un'asta di riparazione a partire dal Listino Ufficiale: nessuna squadra avrebbe una rosa da cui svincolare" });
  }

  // Token segreto generato server-side: solo chi lo possiede può ottenere i
  // privilegi di Admin su questa asta (in join-asta). Non viene MAI restituito
  // da /api/asta/:id/info (che è pubblico), solo nella risposta di creazione,
  // così che solo il creatore (e chi lui sceglie di invitare come co-admin) lo conosca.
  const adminToken = uuidv4();
  const asta = {
    id, nome: b.nome || 'Asta FantaSbocchini',
    tipoAsta: b.tipoAsta || 'iniziale', sottoTipoRiparazione: sottoTipo,
    crediti: b.crediti || 500, timerPrimaChiamata: b.timerPrimaChiamata || 7,
    timerRilancio: b.timerRilancio || 5, tipoEstrazione: b.tipoEstrazione || 'manuale',
    minimoPortieri: b.minimoPortieri || 1, minimoMovimento: b.minimoMovimento || 7,
    maxGiocatoriPerSquadra: b.maxGiocatoriPerSquadra || 25,
    svincoliTotali: b.svincoliTotali || 15, fattoreSvincolo,
    numeroPartecipanti: b.numeroPartecipanti || 12,
    stato: 'attesa', squadre: [], adminNome: null, adminSocketIds: [], adminToken,
    creatorUserId: userData.user.id, creatorEmail: userData.user.email || null,
    poolGiocatori: [], chiamataAttuale: null, popupAttivo: null,
    // Riparazione: chi ha svincolato un giocatore non puo' ripujarlo se ri-estratto nella
    // STESSA asta (blocco squadra+giocatore, non un blocco globale sul giocatore — le altre
    // squadre restano libere). Ambito solo questa asta, non sopravvive a export/reimport.
    svincoliVietati: new Set(),
    storico: [], createdAt: new Date().toISOString()
  };

  if (b.squadreJson && Array.isArray(b.squadreJson)) {
    b.squadreJson.forEach(sq => {
      let giocatoriRICTotali = 0, giocatoriPLUSTotali = 0;
      if (sq.giocatori) {
        sq.giocatori.forEach(g => {
          if (g.tipo === 'RIC') giocatoriRICTotali++;
          else if (g.tipo === 'PLUS') giocatoriPLUSTotali++;
        });
      }
      // "iniziale": la base importata (sq.crediti, es. riporto stagione precedente) si
      // somma sempre ai crediti configurati per l'asta. "riparazione": se sq.crediti e'
      // definito rappresenta gia' il totale (non c'e' una base separata da sommare) —
      // stesso comportamento di prima, solo espresso tramite creditiImportati/Configurati
      // cosi' campiCrediti() puo' calcolare anche creditiIniziali in entrambi i casi.
      const cc = asta.tipoAsta === 'iniziale'
        ? campiCrediti(sq.crediti !== undefined ? sq.crediti : 0, asta.crediti)
        : campiCrediti(0, sq.crediti !== undefined ? sq.crediti : asta.crediti);
      const squadra = {
        nome: sq.nome,
        ...cc,
        slotsRIC: sq.slotRiconferme || 0,       // CORRETTO: slotRiconferme
        slotsRICUsati: 0,
        slotsPLUS: sq.slotPlusvalenze || 0,     // CORRETTO: slotPlusvalenze
        slotsPLUSUsati: 0,
        recompra: (sq.recompra !== undefined ? sq.recompra : 1), recompraUsati: 0,
        svincoliUsati: sq.svincoliUsati || 0,
        giocatoriRICTotali, giocatoriPLUSTotali,
        rosa: [], utenti: []
      };
      if (sq.giocatori) {
        sq.giocatori.forEach(g => {
          const tipo = g.tipo === 'RIC' ? 'RIC' : g.tipo === 'PLUS' ? 'PLUS' : 'NN';
          // Riparazione: nel file il giocatore ha già una fantasquadra assegnata (sq.nome) —
          // resta lì, non torna tra i chiamabili. Solo chi nel file risulta davvero senza
          // squadra (blocco svincolatiJson sotto) può essere chiamato/assegnato in asta.
          const giaAssegnatoInRiparazione = asta.tipoAsta === 'riparazione';
          const giocatoreObj = {
            id: uuidv4(), nome: g.nome, ruolo: g.ruolo || '', tipo,
            costoOriginale: g.costo || 1, valore: g.valore || 0, squadraOriginale: sq.nome,
            estratto: giaAssegnatoInRiparazione, assegnato: giaAssegnatoInRiparazione, scartato: false,
            // campi extra: club reale (mostrato in Puja/confirma) + statistiche non mostrate ancora da nessuna parte, servono per una funzione futura
            squadra: g.squadra || null,
            pgv: g.pgv ?? null, mv: g.mv ?? null, fm: g.fm ?? null,
            fvmp600: g.fvmp600 ?? null, qam: g.qam ?? null,
            idFantaleghe: g.idFantaleghe ?? null,
            under: g.under ?? null, u21: !!g.u21,
            quotazione: g.quotazione ?? null
          };
          asta.poolGiocatori.push(giocatoreObj);
          if (giaAssegnatoInRiparazione) squadra.rosa.push({ ...giocatoreObj, prezzo: giocatoreObj.costoOriginale });
        });
      }
      asta.squadre.push(squadra);
    });
  }

  if (b.svincolatiJson && Array.isArray(b.svincolatiJson)) {
    b.svincolatiJson.forEach(g => {
      asta.poolGiocatori.push({
        id: uuidv4(), nome: g.nome, ruolo: g.ruolo || '', tipo: 'NN',
        costoOriginale: g.costo || 1, valore: g.valore || 0, squadraOriginale: null,
        estratto: false, assegnato: false, scartato: false,
        squadra: g.squadra || null,
        pgv: g.pgv ?? null, mv: g.mv ?? null, fm: g.fm ?? null,
        fvmp600: g.fvmp600 ?? null, qam: g.qam ?? null,
        idFantaleghe: g.idFantaleghe ?? null,
        under: g.under ?? null, u21: !!g.u21,
        quotazione: g.quotazione ?? null
      });
    });
  }

  aste.set(id, asta);
  res.json({ success: true, astaId: id, link: `/?id=${id}`, adminToken });
});

// ══ LISTINO UFFICIALE (solo Admin) ══════════════════════
app.post('/api/listino/upload', limiteUploadListino, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Supabase non configurato sul server' });
  const auth = await getRuoloUtente(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  if (auth.role !== 'admin') return res.status(403).json({ error: 'Solo un Admin può caricare il listino ufficiale' });

  const listino = req.body && req.body.listino;
  if (!Array.isArray(listino) || !listino.length) {
    return res.status(400).json({ error: 'Listino vuoto o non valido' });
  }

  try {
    const nuoveRighe = listino
      .filter(r => r && r.id != null && r.nome)
      .map(r => ({
        id: Number(r.id),
        nome: String(r.nome),
        ruolo: r.ruolo || null,
        squadra_reale: r.squadra_reale || null,
        quotazione: r.quotazione != null ? Number(r.quotazione) : null,
        fvm1000: r.fvm1000 != null ? Number(r.fvm1000) : null,
        eta: r.eta != null ? Number(r.eta) : null,
        u21: !!r.u21,
        pgv: r.pgv != null ? Number(r.pgv) : null,
        mv: r.mv != null ? Number(r.mv) : null,
        fm: r.fm != null ? Number(r.fm) : null
      }));

    const nuoviIds = new Set(nuoveRighe.map(r => r.id));

    const { data: esistenti, error: selErr } = await supabaseAdmin.from('listino_giocatori').select('id');
    if (selErr) throw selErr;

    const idsAEliminare = (esistenti || []).filter(e => !nuoviIds.has(e.id)).map(e => e.id);

    if (idsAEliminare.length) {
      const { error: delErr } = await supabaseAdmin.from('listino_giocatori').delete().in('id', idsAEliminare);
      if (delErr) throw delErr;
      // Grazie a "on delete cascade" su strategia_giocatori.giocatore_id,
      // questo rimuove automaticamente le configurazioni di questi giocatori da TUTTE le strategie.
    }

    const { error: upsertErr } = await supabaseAdmin.from('listino_giocatori').upsert(nuoveRighe, { onConflict: 'id' });
    if (upsertErr) throw upsertErr;
    // I giocatori già esistenti mantengono intatte le loro righe in strategia_giocatori (non toccata qui).
    // I giocatori nuovi non hanno ancora riga in strategia_giocatori: il frontend li tratta come
    // fascia "Non assegnati", senza prezzo/percentuale/preferito (Fase 2).

    res.json({ ok: true, totalGiocatori: nuoveRighe.length, eliminati: idsAEliminare.length });
  } catch (err) {
    console.error('Errore upload listino:', err.message);
    res.status(500).json({ error: 'Errore nel salvataggio del listino: ' + err.message });
  }
});

// ══ GOALKEEPER PLANNER — calendario personalizzato (caricato dall'Admin) ══
// Il calendario reale della Serie A puo' essere caricato una volta disponibile,
// sostituendo il calendario placeholder generato via round-robin. Salvato lato
// server cosi' che TUTTI gli utenti dell'app vedano subito lo stesso calendario.
const GK_CALENDARIO_FILE = path.join(BACKUP_DIR, 'gk_planner_calendario_custom.json');

// ══ Keepalive Supabase ══════════════════════════════════
// Endpoint pensato per essere chiamato periodicamente da un monitor esterno
// (es. UptimeRobot) ogni pochi giorni. Fa una query minima e leggera al DB
// così il progetto Supabase free non accumula mai 7 giorni di inattività
// consecutiva e non viene mai messo in pausa automaticamente.
app.get('/api/keepalive-supabase', async (req, res) => {
  if (!supabaseAdmin) return res.json({ ok: false, reason: 'supabase-not-configured' });
  try {
    const { error } = await supabaseAdmin.from('asta_backups').select('asta_id').limit(1);
    if (error) return res.json({ ok: false, reason: error.message });
    return res.json({ ok: true, timestamp: new Date().toISOString() });
  } catch (e) {
    return res.json({ ok: false, reason: e.message });
  }
});

// Health-check pensato per un monitor esterno (es. UptimeRobot, keyword monitoring su
// "ALERT"): segnala un numero anomalo di aste attive in memoria (soglia empirica, il
// normale utilizzo raramente supera poche aste contemporanee). Un numero anomalo e' il
// sintomo tipico di aste "zombie" abbandonate che si autosalvano ogni 30s consumando
// banda verso Supabase (vedi incidente banda agosto 2026).
const SOGLIA_ASTE_ATTIVE = 8;
app.get('/api/health/banda', (req, res) => {
  const attive = [...aste.values()].filter(a => a.stato !== 'completata');
  const zombie = attive.filter(a => !a.chiamataAttuale);
  const status = zombie.length >= SOGLIA_ASTE_ATTIVE ? 'ALERT' : 'OK';
  res.json({
    status,
    asteAttiveTotali: attive.length,
    asteZombieSospette: zombie.length,
    soglia: SOGLIA_ASTE_ATTIVE,
    // Diagnostica per il rate limiting: e' l'IP che il server VEDE per chi chiama.
    // Serve a verificare in produzione che il reverse proxy inoltri l'IP reale del
    // client (app.set('trust proxy', 1) piu' sopra). Aprendo questa rotta da due
    // dispositivi su reti diverse si devono leggere DUE ip diversi: se ne compare uno
    // solo, tutti i partecipanti condividono lo stesso contatore e le soglie per IP
    // vanno riviste. Non e' un dato sensibile: a ciascuno mostra il proprio.
    ip: req.ip,
    timestamp: new Date().toISOString()
  });
});


app.get('/api/gk-planner/calendario', async (req, res) => {
  // Fonte di verita': Supabase (persiste tra i deploy, che azzerano il disco locale).
  // Il file locale funge solo da cache rapida all'interno dello stesso processo.
  try {
    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin.from('theme_overrides').select('styles').eq('id', 'gk_planner_calendario').single();
      if (!error && data && data.styles && data.styles.partite) {
        try { fs.writeFileSync(GK_CALENDARIO_FILE, JSON.stringify(data.styles)); } catch (e) {}
        return res.json(data.styles);
      }
    }
  } catch (e) { /* fallback sotto */ }
  try {
    if (fs.existsSync(GK_CALENDARIO_FILE)) {
      const data = JSON.parse(fs.readFileSync(GK_CALENDARIO_FILE, 'utf-8'));
      return res.json(data);
    }
  } catch (e) { /* fallback sotto */ }
  res.status(404).json({ custom: false });
});

app.post('/api/gk-planner/calendario', async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Supabase non configurato sul server' });
  const auth = await getRuoloUtente(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  if (auth.role !== 'admin') return res.status(403).json({ error: 'Solo un Admin può caricare il calendario' });

  const partite = req.body && req.body.partite;
  if (!Array.isArray(partite) || !partite.length) {
    return res.status(400).json({ error: 'Calendario vuoto o non valido' });
  }

  const righeValide = partite.filter(p =>
    p && Number.isInteger(p.giornata) && p.giornata >= 1 && p.giornata <= 60 &&
    typeof p.casa === 'string' && p.casa.trim() && typeof p.ospite === 'string' && p.ospite.trim() &&
    p.casa.trim() !== p.ospite.trim()
  );
  if (righeValide.length < partite.length * 0.9) {
    return res.status(400).json({ error: 'Troppe righe non valide nel file (controlla le colonne Giornata / Casa / Ospite)' });
  }

  try {
    const payload = {
      custom: true,
      stagione: (req.body.stagione || 'personalizzata'),
      caricatoIl: new Date().toISOString(),
      giornate_totali: Math.max.apply(null, righeValide.map(p => p.giornata)),
      partite: righeValide.map(p => ({ giornata: p.giornata, casa: p.casa.trim(), ospite: p.ospite.trim() }))
    };
    const { error: upsertErr } = await supabaseAdmin.from('theme_overrides')
      .upsert({ id: 'gk_planner_calendario', styles: payload, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (upsertErr) return res.status(500).json({ error: 'Errore nel salvataggio del calendario su Supabase: ' + upsertErr.message });
    try { fs.writeFileSync(GK_CALENDARIO_FILE, JSON.stringify(payload)); } catch (e) {}
    res.json({ ok: true, totalPartite: payload.partite.length, giornateTotali: payload.giornate_totali });
  } catch (err) {
    console.error('Errore salvataggio calendario GK Planner:', err.message);
    res.status(500).json({ error: 'Errore nel salvataggio del calendario: ' + err.message });
  }
});

app.delete('/api/gk-planner/calendario', async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Supabase non configurato sul server' });
  const auth = await getRuoloUtente(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  if (auth.role !== 'admin') return res.status(403).json({ error: 'Solo un Admin può ripristinare il calendario' });
  try {
    const { error: delErr } = await supabaseAdmin.from('theme_overrides').delete().eq('id', 'gk_planner_calendario');
    if (delErr) return res.status(500).json({ error: 'Errore nel ripristino del calendario su Supabase: ' + delErr.message });
    if (fs.existsSync(GK_CALENDARIO_FILE)) fs.unlinkSync(GK_CALENDARIO_FILE);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Errore nel ripristino del calendario: ' + err.message });
  }
});


app.get('/api/asta/:id/info', (req, res) => {
  const asta = aste.get(req.params.id);
  if (!asta) return res.status(404).json({ error: 'Asta non trovata' });
  res.json({
    id: asta.id, nome: asta.nome, tipoAsta: asta.tipoAsta, stato: asta.stato, crediti: asta.crediti,
    squadre: asta.squadre.map(s => ({ nome: s.nome, utenti: s.utenti ? s.utenti.length : 0 })),
    adminNome: asta.adminNome || null
  });
});

// Campi extra (squadra reale, statistiche, idFantaleghe, under/u21) presenti sui
// giocatori del pool fin dall'import iniziale (Excel/JSON/Listino Ufficiale) — vanno
// riportati anche nell'export, altrimenti si perdono ad ogni "giro" di reimport
// (es. asta di riparazione della stagione dopo), rompendo l'export Fantaleghe
// successivo (richiede idFantaleghe) e tutte le statistiche mostrate nell'asta.
function campiExtraGiocatorePerExport(g) {
  return {
    squadra: g.squadra || null, pgv: g.pgv ?? null, mv: g.mv ?? null, fm: g.fm ?? null,
    fvmp600: g.fvmp600 ?? null, qam: g.qam ?? null, idFantaleghe: g.idFantaleghe ?? null,
    under: g.under ?? null, u21: !!g.u21, quotazione: g.quotazione ?? null
  };
}

app.get('/api/asta/:id/export', (req, res) => {
  const asta = aste.get(req.params.id);
  if (!asta) return res.status(404).json({ error: 'Asta non trovata' });
  const anno = new Date().getFullYear();
  const exportData = {
    lega: 'FantaSbocchini', stagione: `${anno}/${anno + 1}`, tipoAsta: asta.tipoAsta,
    // Il tetto configurato (non l'uso, gia' esportato sotto come svincoliUsati per squadra)
    // va esportato cosi' il tetto cumulativo tra Riparazione 1 e Riparazione 2 sopravvive
    // al reimport invece di ripartire ogni volta dal default.
    svincoliTotali: asta.svincoliTotali,
    squadre: asta.squadre.map(s => ({
      nome: s.nome, crediti: s.crediti,
      slotRiconferme: Math.max(0, s.slotsRIC - s.slotsRICUsati),
      slotPlusvalenze: Math.max(0, s.slotsPLUS - s.slotsPLUSUsati),
      // Come slotRiconferme/slotPlusvalenze: si riporta quanto RESTA, non il totale
      // configurato, cosi' al reimport si riparte esattamente da dove si era rimasti.
      recompra: Math.max(0, (s.recompra != null ? s.recompra : 1) - (s.recompraUsati || 0)),
      svincoliUsati: s.svincoliUsati || 0,
      giocatori: s.rosa.map(g => ({
        nome: g.nome, ruolo: g.ruolo || '', tipo: g.tipo || 'NN', costo: g.prezzo, valore: g.valore ?? null,
        ...campiExtraGiocatorePerExport(g)
      }))
    })),
    // I giocatori mai assegnati (liberi, anche se "scartati" in QUESTA asta — scartato
    // e' uno stato specifico dell'asta che finisce qui, non deve seguirli) vanno
    // esportati come svincolati: altrimenti reimportando per una nuova asta si perde
    // interamente il pool di giocatori disponibili, e bisognerebbe ricaricare da zero
    // il Listino Ufficiale o un Excel per riaverli.
    svincolati: asta.poolGiocatori.filter(g => !g.assegnato).map(g => ({
      nome: g.nome, ruolo: g.ruolo || '', tipo: 'NN', costo: g.valore || 1, valore: g.valore ?? null,
      ...campiExtraGiocatorePerExport(g)
    }))
  };
  res.setHeader('Content-Disposition', `attachment; filename="asta-export-${asta.id.slice(0,8)}.json"`);
  res.json(exportData);
});

// ══ STORICO ESPORTAZIONI (persistente su Supabase) ══════════════
// Lista leggera (solo metadati, senza il payload completo) per popolare velocemente
// la schermata "Storico Esportazioni" dalla Home.
// SICUREZZA: queste tre rotte erano completamente aperte — chiunque conoscesse l'URL
// poteva elencare, scaricare e soprattutto CANCELLARE per sempre lo storico delle aste
// concluse di tutta la lega con una sola richiesta. Ora la lettura richiede il login
// (lo storico si apre comunque solo dal menu principale, cioe' a utente gia' loggato)
// e la cancellazione richiede il ruolo 'admin'.
app.get('/api/exports', async (req, res) => {
  const utente = await getUtenteDaToken(req);
  if (!utente) return res.status(401).json({ error: 'Login richiesto' });
  if (!supabaseAdmin) return res.json([]);
  try {
    const { data, error } = await supabaseAdmin
      .from('asta_exports')
      .select('id, asta_id, tipo_asta, created_at, payload')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const lista = (data || []).map(row => ({
      id: row.id, astaId: row.asta_id, tipoAsta: row.tipo_asta, createdAt: row.created_at,
      numSquadre: (row.payload && row.payload.squadre) ? row.payload.squadre.length : 0
    }));
    res.json(lista);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Payload completo di una singola esportazione (usato per generare JSON/Excel/Fantaleghe/Recap
// lato client, riusando esattamente la stessa logica già usata per l'export "a caldo").
app.get('/api/exports/:id', async (req, res) => {
  const utente = await getUtenteDaToken(req);
  if (!utente) return res.status(401).json({ error: 'Login richiesto' });
  if (!supabaseAdmin) return res.status(500).json({ error: 'Supabase non configurato sul server' });
  try {
    const { data, error } = await supabaseAdmin.from('asta_exports').select('payload').eq('id', req.params.id).single();
    if (error || !data) return res.status(404).json({ error: 'Esportazione non trovata' });
    res.json(data.payload);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/exports/:id', async (req, res) => {
  const auth = await getRuoloUtente(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  if (auth.role !== 'admin') return res.status(403).json({ error: 'Solo un Admin puo\' cancellare una esportazione' });
  if (!supabaseAdmin) return res.status(500).json({ error: 'Supabase non configurato sul server' });
  try {
    const { error } = await supabaseAdmin.from('asta_exports').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Diagnostica/pulizia aste "zombie": aste create ma mai avviate o rimaste bloccate
// (nessuna chiamataAttuale) da piu' di N ore. Utile per individuare/rimuovere in un click
// aste di test dimenticate, che altrimenti continuerebbero ad autosalvarsi ogni 30s su
// Supabase consumando banda (vedi incidente banda agosto 2026).
app.get('/api/admin/aste-zombie', async (req, res) => {
  const auth = await getRuoloUtente(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  if (auth.role !== 'admin') return res.status(403).json({ error: 'Solo un Admin puo\' vedere le aste zombie' });
  const ora = Date.now();
  const risultato = [];
  aste.forEach((asta, id) => {
    const creataMs = asta.createdAt ? new Date(asta.createdAt).getTime() : 0;
    const oreVita = creataMs ? (ora - creataMs) / (60 * 60 * 1000) : null;
    const abbandonata = asta.stato !== 'completata' && !asta.chiamataAttuale;
    if (abbandonata) {
      risultato.push({ id, nome: asta.nome, stato: asta.stato, oreVita: oreVita != null ? Math.round(oreVita * 10) / 10 : null });
    }
  });
  res.json(risultato);
});

app.post('/api/admin/pulisci-aste-zombie', async (req, res) => {
  const auth = await getRuoloUtente(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  if (auth.role !== 'admin') return res.status(403).json({ error: 'Solo un Admin puo\' pulire le aste zombie' });
  const rimosse = [];
  aste.forEach((asta, id) => {
    const abbandonata = asta.stato !== 'completata' && !asta.chiamataAttuale;
    if (abbandonata) {
      clearTimer(id);
      aste.delete(id);
      _ultimoBackupHash.delete(id);
      deleteBackupSupabase(id);
      rimosse.push(id);
    }
  });
  res.json({ ok: true, rimosse: rimosse.length, ids: rimosse });
});

// Endpoint riservato agli Admin: chiude e cancella TUTTE le aste attualmente
// aperte (attive o non), sia in memoria che nel backup su Supabase. Azione
// irreversibile: da usare solo per una pulizia generale voluta esplicitamente,
// non e' un'operazione automatica.
app.post('/api/admin/chiudi-tutte-le-aste', async (req, res) => {
  const auth = await getRuoloUtente(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  if (auth.role !== 'admin') return res.status(403).json({ error: 'Solo un Admin puo\' chiudere tutte le aste' });
  const chiuse = [];
  aste.forEach((asta, id) => {
    try { io.to(id).emit('asta-terminata', { astaId: id, motivo: 'Chiusa da un Admin' }); } catch (e) {}
    clearTimer(id);
    aste.delete(id);
    _ultimoBackupHash.delete(id);
    deleteBackupSupabase(id);
    chiuse.push(id);
  });
  res.json({ ok: true, chiuse: chiuse.length, ids: chiuse });
});

// Permette agli Admin di leggere/modificare lo stato del toggle "backup su Supabase",
// utile durante test/prove per non generare traffico e righe inutili su Supabase.
// Il backup locale su disco (rete di sicurezza contro crash del processo) resta sempre attivo.
// Lettura aperta a QUALSIASI utente loggato (non solo Admin): serve anche alla schermata
// "Riprendi Asta" del menu principale, per decidere se proporre il ripristino da Supabase
// oltre a quello da file — non e' un dato sensibile, e' solo un feature flag.
app.get('/api/admin/backup-status', async (req, res) => {
  const utente = await getUtenteDaToken(req);
  if (!utente) return res.status(401).json({ error: 'Login richiesto' });
  res.json({ backupSupabaseAttivo });
});
app.post('/api/admin/toggle-backup', async (req, res) => {
  const auth = await getRuoloUtente(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  if (auth.role !== 'admin') return res.status(403).json({ error: 'Solo un Admin puo\' modificare lo stato del backup' });
  backupSupabaseAttivo = !!(req.body && req.body.attivo);
  await persistBackupSupabaseAttivo(backupSupabaseAttivo);
  // Notifica in tempo reale tutti gli Admin connessi (non solo chi ha premuto il toggle),
  // così il checkbox resta sincronizzato su ogni dispositivo/sessione senza dover ricaricare.
  io.emit('backup-toggle-changed', { backupSupabaseAttivo });
  res.json({ ok: true, backupSupabaseAttivo });
});

// Lettura dello stato "manutenzione": volutamente APERTA a chiunque, senza login,
// perche' deve poter bloccare la schermata di login stessa per gli utenti non-Admin,
// prima ancora che si autentichino. Non e' un dato sensibile, e' solo un feature flag.
app.get('/api/admin/manutenzione-status', (req, res) => {
  res.json({ manutenzioneAttiva });
});
app.post('/api/admin/toggle-manutenzione', async (req, res) => {
  const auth = await getRuoloUtente(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  if (auth.role !== 'admin') return res.status(403).json({ error: 'Solo un Admin puo\' modificare lo stato di manutenzione' });
  manutenzioneAttiva = !!(req.body && req.body.attiva);
  await persistManutenzioneAttiva(manutenzioneAttiva);
  // Notifica in tempo reale tutti i client connessi, cosi' chi sta gia' usando l'app
  // viene bloccato subito (o sbloccato) senza dover ricaricare la pagina.
  io.emit('manutenzione-changed', { manutenzioneAttiva });
  res.json({ ok: true, manutenzioneAttiva });
});

// ============ WEBSOCKET ============
io.on('connection', (socket) => {
  console.log(`[WS] Connesso: ${socket.id}`);

  // ══ ANTIFLOOD SUGLI EVENTI SOCKET ══
  // Non esisteva nessun limite: un client scriptato poteva inondare l'asta di
  // 'rilancio' e far ripartire il timer all'infinito, rendendo di fatto impossibile
  // chiudere un'assegnazione. Finestra scorrevole di 1 secondo, contata per socket.
  // I contatori stanno SULL'oggetto socket, non in una Map globale: spariscono da soli
  // alla disconnessione, senza il rischio di fuga di memoria gia' visto altrove.
  const EVENTI_AL_SECONDO = 15;    // azioni normali (admin che clicca in fretta, join, ecc.)
  // 10 e non 5: in una puja combattuta si martella il tasto, e ogni tocco e' un rilancio
  // da un credito. A 5/s le pulsazioni in eccesso venivano scartate e la persona rilanciava
  // MENO di quanto credeva, potendo perdere il giocatore — in un'asta vera di 8-9 ore con
  // 22 persone e' un caso che capita. La tenuta prolungata del tasto non c'entra: emette un
  // solo evento al rilascio (vedi 'leva' in comportamenti-asta.js), non un flusso.
  const RILANCI_AL_SECONDO = 10;
  socket.use((packet, next) => {
    const evento = packet[0];
    const massimo = evento === 'rilancio' ? RILANCI_AL_SECONDO : EVENTI_AL_SECONDO;
    const ora = Date.now();
    if (!socket._afInizio || ora - socket._afInizio >= 1000) {
      socket._afInizio = ora; socket._afConteggio = {};
    }
    const n = (socket._afConteggio[evento] || 0) + 1;
    socket._afConteggio[evento] = n;
    if (n > massimo) {
      // Si SCARTA il pacchetto invece di passare un errore a next(): next(err) fa
      // emettere un evento 'error' che il client non gestisce e che puo' chiudere la
      // connessione, buttando fuori dall'asta chi ha soltanto cliccato troppo in fretta.
      if (n === massimo + 1) socket.emit('errore', { msg: 'Stai andando troppo veloce, aspetta un attimo' });
      return;
    }
    next();
  });

  socket.on('join-asta', ({ astaId, nomeSquadra, isAdmin: adminFlag, adminToken }) => {
    const asta = aste.get(astaId);
    if (!asta) return socket.emit('errore', { msg: 'Asta non trovata' });
    socket.join(astaId); socket.astaId = astaId; socket.nomeSquadra = nomeSquadra;

    let squadra = getSquadra(asta, nomeSquadra);
    if (!squadra) {
      if (asta.squadre.length >= asta.numeroPartecipanti) {
        return socket.emit('errore', { msg: `Partecipanti al massimo (${asta.numeroPartecipanti})` });
      }
      squadra = {
        nome: nomeSquadra, ...campiCrediti(0, asta.crediti),
        slotsRIC: 0, slotsRICUsati: 0, slotsPLUS: 0, slotsPLUSUsati: 0,
        recompra: 1, recompraUsati: 0, svincoliUsati: 0,
        giocatoriRICTotali: 0, giocatoriPLUSTotali: 0, rosa: [], utenti: []
      };
      asta.squadre.push(squadra);
    }
    if (!squadra.utenti.includes(socket.id)) squadra.utenti.push(socket.id);

    // SICUREZZA: i privilegi di Admin richiedono SEMPRE il token segreto generato
    // alla creazione dell'asta — non basta più dichiararsi admin (isAdmin:true) o
    // indovinare/conoscere il nome della squadra admin (che era pubblico via /info).
    const tokenValido = !!(adminToken && asta.adminToken && adminToken === asta.adminToken);
    if (tokenValido && (adminFlag || asta.adminNome === nomeSquadra)) {
      if (!asta.adminSocketIds.includes(socket.id)) asta.adminSocketIds.push(socket.id);
      if (!asta.adminNome) asta.adminNome = nomeSquadra;
    }
    broadcastStato(astaId);

    // Resend active popups
    if (asta.popupAttivo && asta.popupAttivo.proprietarioPrecedente === nomeSquadra) {
      if (asta.popupAttivo.tipo === 'post-asta-ric' || asta.popupAttivo.tipo === 'post-asta-plus')
        socket.emit('popup-post-asta', asta.popupAttivo);
      else if (asta.popupAttivo.tipo === 'svincolo' && asta.popupAttivo.squadraVincitrice === nomeSquadra) {
        const sq = getSquadra(asta, nomeSquadra);
        socket.emit('popup-svincolo', { ...asta.popupAttivo, rosa: sq ? sq.rosa : [], fattoreSvincolo: asta.fattoreSvincolo || 0.5 });
      }
    }
    if (asta.chiamataAttuale && asta.chiamataAttuale.aspettandoConferma && asta.chiamataAttuale.proprietarioPrecedente === nomeSquadra) {
      socket.emit('popup-ric-conferma', { giocatore: asta.chiamataAttuale.giocatore, costoConferma: asta.chiamataAttuale.giocatore.costoOriginale, proprietario: nomeSquadra });
    }
    if (asta.chiamataAttuale && asta.chiamataAttuale.fase === 'attesa-conferma' && isAdmin(asta, socket.id)) {
      socket.emit('attesa-conferma', asta.chiamataAttuale);
    }
    // Fix: se il client si (ri)connette mentre una chiamata è già in corso in
    // fase di puja normale (non conferma RIC, non attesa-conferma admin), il
    // client non riceve mai l'evento 'nuova-chiamata' iniziale (viene emesso
    // solo quando la chiamata PARTE), quindi la card e il box di rilancio
    // restano nascosti e l'utente non può fare offerte finché non ne parte
    // una nuova. Ri-emettiamo lo stato della chiamata attiva solo a questo socket.
    if (asta.chiamataAttuale && !asta.chiamataAttuale.aspettandoConferma && asta.chiamataAttuale.fase !== 'attesa-conferma') {
      socket.emit('nuova-chiamata', asta.chiamataAttuale);
      if (asta.chiamataAttuale.timer != null) {
        socket.emit('timer-tick', { secondi: asta.chiamataAttuale.timer, fase: asta.chiamataAttuale.fase });
      }
    }
  });

  socket.on('inizia-asta', ({ astaId }) => {
    const asta = aste.get(astaId);
    if (!asta || !isAdmin(asta, socket.id)) return;
    asta.stato = 'in_corso'; broadcastStato(astaId, true); io.to(astaId).emit('asta-iniziata');
    if (asta.tipoEstrazione === 'casuale') {
      setTimeout(() => {
        const disp = asta.poolGiocatori.filter(g => !g.estratto && !g.assegnato && !g.scartato);
        if (disp.length > 0) avviaChiamata(astaId, disp[Math.floor(Math.random() * disp.length)]);
      }, 2000);
    }
  });

  socket.on('estrai-giocatore', ({ astaId }) => {
    const asta = aste.get(astaId);
    if (!asta || asta.stato !== 'in_corso' || !isAdmin(asta, socket.id)) return;
    if (asta.chiamataAttuale) return socket.emit('errore', { msg: 'Chiamata già in corso' });
    // Una decisione pendente (svincolo per pagare l'offerta vinta, o plusvalenza/recompra del
    // proprietario precedente) blocca l'estrazione: altrimenti l'asta continua mentre una
    // squadra deve ancora liberare crediti/spazio che non ha, o un diritto non e' stato
    // ancora esercitato — segnalato dall'utente, la chiamata successiva non deve MAI partire
    // prima che questa sia risolta (dal giocatore o dall'Admin per suo conto).
    if (asta.popupAttivo) return socket.emit('errore', { msg: 'C\'è una decisione in sospeso (svincolo o conferma) da risolvere prima di continuare' });
    const disp = asta.poolGiocatori.filter(g => !g.estratto && !g.assegnato && !g.scartato);
    if (disp.length === 0) return socket.emit('errore', { msg: 'Nessun giocatore disponibile' });
    avviaChiamata(astaId, disp[Math.floor(Math.random() * disp.length)]);
  });

  socket.on('chiama-giocatore', ({ astaId, giocatoreId, giocatoreManuale }) => {
    const asta = aste.get(astaId);
    if (!asta || asta.stato !== 'in_corso' || !isAdmin(asta, socket.id)) return;
    if (asta.chiamataAttuale) return socket.emit('errore', { msg: 'Chiamata già in corso' });
    if (asta.popupAttivo) return socket.emit('errore', { msg: 'C\'è una decisione in sospeso (svincolo o conferma) da risolvere prima di continuare' });
    let giocatore;
    if (giocatoreId) {
      giocatore = asta.poolGiocatori.find(g => g.id === giocatoreId && !g.estratto && !g.assegnato && !g.scartato);
    } else if (giocatoreManuale) {
      giocatore = { id: uuidv4(), nome: giocatoreManuale.nome, ruolo: giocatoreManuale.ruolo || '', tipo: 'NN', costoOriginale: 1, squadraOriginale: null, estratto: false, assegnato: false, scartato: false };
      asta.poolGiocatori.push(giocatore);
    }
    if (!giocatore) return socket.emit('errore', { msg: 'Giocatore non trovato' });
    avviaChiamata(astaId, giocatore, true);
  });

  socket.on('assegna-manuale', ({ astaId, giocatoreId, squadraNome, prezzo }) => {
    const asta = aste.get(astaId);
    if (!asta || asta.stato !== 'in_corso' || !isAdmin(asta, socket.id)) return;
    if (asta.chiamataAttuale) return socket.emit('errore', { msg: 'Chiamata già in corso, termina prima' });
    if (asta.popupAttivo) return socket.emit('errore', { msg: 'C\'è una decisione in sospeso (svincolo o conferma) da risolvere prima di continuare' });
    const giocatore = asta.poolGiocatori.find(g => g.id === giocatoreId && !g.assegnato && (!g.estratto || g.scartato));
    const squadra = getSquadra(asta, squadraNome);
    if (!giocatore) return socket.emit('errore', { msg: 'Giocatore non trovato o non disponibile' });
    if (!squadra) return socket.emit('errore', { msg: 'Squadra non trovata' });
    if (squadra.rosa.length >= (asta.maxGiocatoriPerSquadra || 25)) return socket.emit('errore', { msg: `Squadra già al limite massimo di ${asta.maxGiocatoriPerSquadra} giocatori` });
    const p = Math.max(1, parseInt(prezzo) || 1);
    if (squadra.crediti < p) return socket.emit('errore', { msg: 'Crediti insufficienti per questa squadra' });
    giocatore.estratto = true;
    assegnaGiocatoreASquadra(asta, giocatore, squadra, p);
    asta.storico.push({ giocatore, prezzo: p, squadra: squadra.nome, tipo: 'normale', manuale: true, timestamp: new Date().toISOString() });
    io.to(astaId).emit('giocatore-assegnato', { giocatore, prezzo: p, squadra: squadra.nome, tipo: 'normale', manuale: true });
    io.to(astaId).emit('chiamata-manuale-avviso', { giocatore, squadra: squadra.nome, prezzo: p, assegnazioneDiretta: true });
    broadcastStato(astaId, true);
  });

  socket.on('rilancio', ({ astaId, offerta }) => {
    const asta = aste.get(astaId);
    if (!asta || !asta.chiamataAttuale || asta.chiamataAttuale.aspettandoConferma) return;
    if (asta.chiamataAttuale.fase === 'attesa-conferma') return socket.emit('errore', { msg: 'In attesa di conferma admin' });
    const sq = getSquadraBySocket(asta, socket.id);
    if (!sq) return socket.emit('errore', { msg: 'Non sei in questa asta' });
    const chiamata = asta.chiamataAttuale;
    // Riparazione: chi ha svincolato questo giocatore in questa asta non puo' ripujarlo se
    // ri-estratto — le altre squadre restano libere di farlo (vedi popolamento in
    // esegui-svincolo). Solo sul rilancio a tempo, non su assegna-manuale.
    if (asta.tipoAsta === 'riparazione' && asta.svincoliVietati.has(sq.nome + '|' + chiamata.giocatore.id)) {
      return socket.emit('errore', { msg: 'Hai già svincolato questo giocatore in questa asta: non puoi ripujarlo' });
    }
    offerta = parseInt(offerta);
    const minOfferta = Math.max(1, chiamata.offertaAttuale + (chiamata.offertaAttuale === 0 ? 1 : 1));
    if (offerta < minOfferta) return socket.emit('errore', { msg: `Offerta minima: ${minOfferta} crediti` });
    const maxOff = calcolaMaxOfferta(asta, sq, chiamata.giocatore);
    if (offerta > maxOff) return socket.emit('errore', { msg: `Massimo consentito: ${maxOff} crediti` });
    if (asta.tipoAsta === 'iniziale' && offerta > sq.crediti) return socket.emit('errore', { msg: `Crediti insufficienti (hai ${sq.crediti})` });
    if (sq.nome === chiamata.proprietarioPrecedente) chiamata.giocatore.dirittoRiacquistoPerso = true;
    chiamata.offertaAttuale = offerta; chiamata.squadraOfferente = sq.nome;
    io.to(astaId).emit('aggiorna-offerta', chiamata);
    resetTimer(astaId, 'rilancio');
  });

  // Admin: conferma assegnazione dopo timer
  socket.on('conferma-assegnazione', ({ astaId }) => {
    const asta = aste.get(astaId);
    if (!asta || !isAdmin(asta, socket.id)) return;
    if (!asta.chiamataAttuale || asta.chiamataAttuale.fase !== 'attesa-conferma') return socket.emit('errore', { msg: 'Nessuna assegnazione in attesa' });
    if (!asta.chiamataAttuale.squadraOfferente) { scartaGiocatore(astaId); return; }
    chiudiAsta(astaId);
  });

  // Admin: riapri asta dopo timer
  socket.on('riapri-asta', ({ astaId, tipo }) => {
    const asta = aste.get(astaId);
    if (!asta || !isAdmin(asta, socket.id)) return;
    if (!asta.chiamataAttuale || asta.chiamataAttuale.fase !== 'attesa-conferma') return;
    if (tipo === 'da-uno') {
      asta.chiamataAttuale.offertaAttuale = 0;
      asta.chiamataAttuale.squadraOfferente = null;
      // NB: il diritto a plusvalenza/recompra eventualmente gia' perso (giocatore.
      // dirittoRiacquistoPerso) NON va resettato qui: riaprire l'asta azzera solo l'offerta
      // corrente, non "cancella" il fatto che il proprietario precedente avesse gia' punteggiato.
      io.to(astaId).emit('nuova-chiamata', asta.chiamataAttuale);
      startTimer(astaId, 'prima');
    } else {
      // Riapri dal prezzo attuale, timer rilancio
      asta.chiamataAttuale.fase = 'rilancio';
      asta.chiamataAttuale.aspettandoConferma = false;
      io.to(astaId).emit('nuova-chiamata', asta.chiamataAttuale);
      startTimer(astaId, 'rilancio');
    }
    broadcastStato(astaId);
  });

  socket.on('risposta-ric-conferma', ({ astaId, risposta }) => {
    const asta = aste.get(astaId);
    if (!asta || !asta.chiamataAttuale || !asta.chiamataAttuale.aspettandoConferma) return;
    const sq = getSquadraBySocket(asta, socket.id);
    const admin = isAdmin(asta, socket.id);
    const chiamata = asta.chiamataAttuale;
    if (!admin && (!sq || sq.nome !== chiamata.proprietarioPrecedente)) return;
    clearTimer(astaId); chiamata.aspettandoConferma = false;
    if (risposta === 'si') {
      const squadra = getSquadra(asta, chiamata.proprietarioPrecedente);
      assegnaGiocatoreASquadra(asta, chiamata.giocatore, squadra, chiamata.giocatore.costoOriginale, true);
      squadra.slotsRICUsati++;
      asta.storico.push({ giocatore: chiamata.giocatore, prezzo: chiamata.giocatore.costoOriginale, squadra: chiamata.proprietarioPrecedente, tipo: 'riconferma', timestamp: new Date().toISOString() });
      asta.chiamataAttuale = null;
      io.to(astaId).emit('giocatore-assegnato', { giocatore: chiamata.giocatore, prezzo: chiamata.giocatore.costoOriginale, squadra: chiamata.proprietarioPrecedente, tipo: 'riconferma' });
      broadcastStato(astaId, true);
      if (asta.tipoEstrazione === 'casuale') {
        setTimeout(() => { const disp = asta.poolGiocatori.filter(g => !g.estratto && !g.assegnato && !g.scartato); if (disp.length > 0) avviaChiamata(astaId, disp[Math.floor(Math.random() * disp.length)]); }, 2000);
      }
    } else {
      chiamata.offertaAttuale = 0; chiamata.squadraOfferente = null;
      io.to(astaId).emit('nuova-chiamata', chiamata);
      broadcastStato(astaId); startTimer(astaId, 'prima');
    }
  });

  socket.on('risposta-post-asta', ({ astaId, scelta }) => {
    const asta = aste.get(astaId);
    if (!asta || !asta.popupAttivo) return;
    const popup = asta.popupAttivo;
    const sq = getSquadraBySocket(asta, socket.id); const admin = isAdmin(asta, socket.id);
    if (!admin && (!sq || sq.nome !== popup.proprietarioPrecedente)) return;
    asta.popupAttivo = null;
    const { giocatore, prezzoFinale, squadraVincitrice } = popup;
    const sqPrec = getSquadra(asta, popup.proprietarioPrecedente);
    const sqVinc = getSquadra(asta, squadraVincitrice);
    if (scelta === 'plusvalenza' && sqPrec) {
      assegnaGiocatoreASquadra(asta, giocatore, sqVinc, prezzoFinale);
      const guadagno = Math.max(0, prezzoFinale - giocatore.costoOriginale);
      sqPrec.crediti += guadagno; sqPrec.slotsPLUSUsati++;
      asta.storico.push({ giocatore, prezzo: prezzoFinale, squadra: squadraVincitrice, tipo: 'plusvalenza', plusvalenzaA: popup.proprietarioPrecedente, guadagno, timestamp: new Date().toISOString() });
      io.to(astaId).emit('giocatore-assegnato', { giocatore, prezzo: prezzoFinale, squadra: squadraVincitrice, tipo: 'plusvalenza', guadagno, plusvalenzaA: popup.proprietarioPrecedente });
    } else if (scelta === 'recompra' && sqPrec) {
      const prezzoRecompra = prezzoFinale + 1;
      assegnaGiocatoreASquadra(asta, giocatore, sqPrec, prezzoRecompra); sqPrec.recompraUsati = (sqPrec.recompraUsati || 0) + 1;
      asta.storico.push({ giocatore, prezzo: prezzoRecompra, squadra: popup.proprietarioPrecedente, tipo: 'recompra', timestamp: new Date().toISOString() });
      io.to(astaId).emit('giocatore-assegnato', { giocatore, prezzo: prezzoRecompra, squadra: popup.proprietarioPrecedente, tipo: 'recompra' });
    } else {
      assegnaGiocatoreASquadra(asta, giocatore, sqVinc, prezzoFinale);
      asta.storico.push({ giocatore, prezzo: prezzoFinale, squadra: squadraVincitrice, tipo: 'normale', timestamp: new Date().toISOString() });
      io.to(astaId).emit('giocatore-assegnato', { giocatore, prezzo: prezzoFinale, squadra: squadraVincitrice, tipo: 'normale' });
    }
    broadcastStato(astaId, true);
    if (asta.tipoEstrazione === 'casuale') {
      setTimeout(() => { const disp = asta.poolGiocatori.filter(g => !g.estratto && !g.assegnato && !g.scartato); if (disp.length > 0) avviaChiamata(astaId, disp[Math.floor(Math.random() * disp.length)]); }, 2000);
    }
  });

  socket.on('esegui-svincolo', ({ astaId, giocatoriIds }) => {
    const asta = aste.get(astaId);
    if (!asta || !asta.popupAttivo || asta.popupAttivo.tipo !== 'svincolo') return;
    if (!Array.isArray(giocatoriIds)) return socket.emit('errore', { msg: 'Lista giocatori non valida' });
    const popup = asta.popupAttivo;
    const sq = getSquadraBySocket(asta, socket.id); const admin = isAdmin(asta, socket.id);
    if (!admin && (!sq || sq.nome !== popup.squadraVincitrice)) return;
    const squadra = getSquadra(asta, popup.squadraVincitrice);
    if (!squadra) return socket.emit('errore', { msg: 'Squadra non trovata' });
    const capMax = asta.maxGiocatoriPerSquadra || 25;
    const fattore = asta.fattoreSvincolo || 0.5;

    // Validazioni server-side — prima erano assenti (il client poteva mandare 0 giocatori,
    // piu' del consentito, o non coprire il debito): mai fidarsi del client, stesso
    // principio gia' applicato al timer d'asta.
    const idsUnici = [...new Set(giocatoriIds)];
    const scelti = idsUnici.map(id => squadra.rosa.find(g => g.id === id)).filter(Boolean);
    if (scelti.length !== idsUnici.length) {
      return socket.emit('errore', { msg: 'Uno o più giocatori selezionati non sono più in rosa' });
    }
    const svincoliRimanenti = asta.svincoliTotali - (squadra.svincoliUsati || 0);
    if (scelti.length > svincoliRimanenti) {
      return socket.emit('errore', { msg: `Puoi liberare al massimo ${svincoliRimanenti} giocatori (svincoli rimanenti)` });
    }
    // Ricalcolo fresco: mai fidarsi di popup.differenza, congelata al momento dell'apertura
    // del popup — i crediti squadra potrebbero essere cambiati nel frattempo (es. l'Admin ha
    // corretto i crediti con admin-update-crediti mentre il popup era aperto).
    const creditiRecuperabiliScelti = scelti.reduce((s, g) => s + calcolaRecuperoSvincolo(g.prezzo, fattore), 0);
    const creditoGap = Math.max(0, popup.prezzoFinale - squadra.crediti);
    if (creditiRecuperabiliScelti < creditoGap) {
      return socket.emit('errore', { msg: `I crediti recuperati (${creditiRecuperabiliScelti}) non coprono il debito di ${creditoGap} crediti` });
    }
    const kRoster = Math.max(0, (squadra.rosa.length + 1) - capMax);
    if (scelti.length < kRoster) {
      return socket.emit('errore', { msg: `Devi liberare almeno ${kRoster} giocatori per rientrare nel limite di ${capMax} per rosa` });
    }
    const check = calcolaSvincoliMinimiPerVittoria(asta, squadra, popup.giocatore, popup.prezzoFinale, capMax);
    if (!check.possibile) {
      return socket.emit('errore', { msg: 'Operazione non eseguibile: nemmeno tutti gli svincoli disponibili basterebbero. Contatta l\'Admin.' });
    }
    // Anche se QUESTA selezione copre il debito/spazio richiesti, potrebbe comunque lasciare
    // la squadra senza alcuna via d'uscita per i minimi (es. liberare l'ultimo portiere
    // quando bastava liberare un movimento) — simula lo stato risultante e verifica che resti
    // una strategia futura valida PRIMA di committare (bug reale osservato altrimenti: 0
    // crediti, 0 svincoli, 0 portieri, nessuna possibilita' di recupero).
    const rosaSimulata = squadra.rosa.filter(g => !scelti.find(s => s.id === g.id))
      .concat([{ ...popup.giocatore, prezzo: popup.prezzoFinale }]);
    const squadraSimulata = { rosa: rosaSimulata, crediti: squadra.crediti + creditiRecuperabiliScelti - popup.prezzoFinale };
    const svincoliRimanentiDopo = svincoliRimanenti - scelti.length;
    if (!verificaCapacitaRecupero(asta, squadraSimulata, svincoliRimanentiDopo, capMax)) {
      return socket.emit('errore', { msg: 'Questa selezione lascerebbe la squadra senza alcuna possibilità di recupero dei minimi Portieri/Movimento. Scegli una combinazione diversa (libera meno giocatori, o giocatori diversi).' });
    }


    let creditiRecuperati = 0; const svincolati = [];
    scelti.forEach(g => {
      const idx = squadra.rosa.findIndex(x => x.id === g.id);
      squadra.rosa.splice(idx, 1);
      const credRecup = calcolaRecuperoSvincolo(g.prezzo, fattore); creditiRecuperati += credRecup;
      svincolati.push({ ...g, creditiRecuperati: credRecup });
      squadra.svincoliUsati = (squadra.svincoliUsati || 0) + 1;
      // Chi ha appena svincolato questo giocatore non puo' ripujarlo se ri-estratto in
      // questa stessa asta (vedi check in 'rilancio') — le altre squadre restano libere.
      asta.svincoliVietati.add(squadra.nome + '|' + g.id);
      const gPool = asta.poolGiocatori.find(p => p.id === g.id);
      if (gPool) { gPool.estratto = false; gPool.assegnato = false; gPool.scartato = false; }
      else asta.poolGiocatori.push({ id: g.id, nome: g.nome, ruolo: g.ruolo || '', tipo: 'NN', costoOriginale: g.prezzo, valore: g.valore || 0, squadraOriginale: null, estratto: false, assegnato: false, scartato: false, quotazione: g.quotazione ?? null });
    });
    squadra.crediti += creditiRecuperati;
    assegnaGiocatoreASquadra(asta, popup.giocatore, squadra, popup.prezzoFinale);
    asta.popupAttivo = null;
    asta.storico.push({ giocatore: popup.giocatore, prezzo: popup.prezzoFinale, squadra: popup.squadraVincitrice, tipo: 'con_svincolo', svincolati, timestamp: new Date().toISOString() });
    io.to(astaId).emit('giocatore-assegnato', { giocatore: popup.giocatore, prezzo: popup.prezzoFinale, squadra: popup.squadraVincitrice, tipo: 'con_svincolo' });
    broadcastStato(astaId, true);
  });

  socket.on('tradeoff', ({ astaId, tipo }) => {
    const asta = aste.get(astaId);
    if (!asta || asta.tipoAsta !== 'iniziale') return;
    const sq = getSquadraBySocket(asta, socket.id);
    if (!sq) return socket.emit('errore', { msg: 'Non sei in questa asta' });
    const ricDisp = sq.slotsRIC - sq.slotsRICUsati, plusDisp = sq.slotsPLUS - sq.slotsPLUSUsati;
    const ricTrad = Math.max(0, ricDisp - 1), plusTrad = Math.max(0, plusDisp - 1);
    switch (tipo) {
      case 'ric-to-plus': if (ricTrad < 1) return socket.emit('errore', { msg: 'Nessun slot RIC cedibile' }); sq.slotsRIC--; sq.slotsPLUS += 2; break;
      case 'plus-to-ric': if (plusTrad < 3) return socket.emit('errore', { msg: 'Servono almeno 3 slot PLUS cedibili' }); sq.slotsPLUS -= 3; sq.slotsRIC++; break;
      case 'ric-to-crediti': if (ricTrad < 1) return socket.emit('errore', { msg: 'Nessun slot RIC cedibile' }); sq.slotsRIC--; sq.crediti += 12; break;
      case 'plus-to-crediti': if (plusTrad < 1) return socket.emit('errore', { msg: 'Nessun slot PLUS cedibile' }); sq.slotsPLUS--; sq.crediti += 6; break;
      default: return socket.emit('errore', { msg: 'Tipo trade-off non valido' });
    }
    asta.storico.push({ tipo: 'tradeoff', squadra: sq.nome, tradeoffTipo: tipo, timestamp: new Date().toISOString() });
    broadcastStato(astaId, true); socket.emit('tradeoff-ok');
    io.to(astaId).emit('tradeoff-usato', { nomeSquadra: sq.nome, tipo });
  });

  socket.on('admin-update-config', ({ astaId, timerPrimaChiamata, timerRilancio, minimoPortieri, minimoMovimento, maxGiocatoriPerSquadra, svincoliTotali }) => {
    const asta = aste.get(astaId);
    if (!asta || !isAdmin(asta, socket.id)) return;
    if (timerPrimaChiamata !== undefined) asta.timerPrimaChiamata = Math.max(1, parseInt(timerPrimaChiamata) || asta.timerPrimaChiamata);
    if (timerRilancio !== undefined) asta.timerRilancio = Math.max(1, parseInt(timerRilancio) || asta.timerRilancio);
    if (minimoPortieri !== undefined) asta.minimoPortieri = Math.max(0, parseInt(minimoPortieri) || 0);
    if (minimoMovimento !== undefined) asta.minimoMovimento = Math.max(0, parseInt(minimoMovimento) || 0);
    if (maxGiocatoriPerSquadra !== undefined) asta.maxGiocatoriPerSquadra = Math.max(1, parseInt(maxGiocatoriPerSquadra) || asta.maxGiocatoriPerSquadra || 25);
    if (svincoliTotali !== undefined) asta.svincoliTotali = Math.max(0, parseInt(svincoliTotali) || 0);
    broadcastStato(astaId);
  });

  socket.on('admin-update-crediti', ({ astaId, squadraNome, crediti }) => {
    const asta = aste.get(astaId);
    if (!asta || !isAdmin(asta, socket.id)) return;
    const sq = getSquadra(asta, squadraNome);
    if (!sq) return socket.emit('errore', { msg: 'Squadra non trovata' });
    // Il valore inserito dall'Admin e' la parte "configurata" per questa squadra (vedi
    // campiCrediti sopra), NON il saldo in tempo reale: si somma sempre alla base
    // importata fissa (creditiImportati), e la differenza rispetto al vecchio totale
    // viene applicata al saldo corrente per preservare quanto gia' speso, invece di
    // sovrascriverlo — cosi' un ritocco a meta' asta non azzera gli acquisti fatti.
    const nuovoConfigurati = Math.max(0, parseInt(crediti) || 0);
    const nuovoTotale = (sq.creditiImportati || 0) + nuovoConfigurati;
    const delta = nuovoTotale - (sq.creditiIniziali != null ? sq.creditiIniziali : nuovoTotale);
    sq.creditiConfigurati = nuovoConfigurati;
    sq.creditiIniziali = nuovoTotale;
    sq.crediti = Math.max(0, sq.crediti + delta);
    broadcastStato(astaId);
  });

  socket.on('admin-update-slot', ({ astaId, squadraNome, slotsRIC, slotsPLUS, recompra }) => {
    const asta = aste.get(astaId);
    if (!asta || !isAdmin(asta, socket.id)) return;
    const sq = getSquadra(asta, squadraNome);
    if (!sq) return socket.emit('errore', { msg: 'Squadra non trovata' });
    if (slotsRIC !== undefined) sq.slotsRIC = Math.max(0, parseInt(slotsRIC) || 0);
    if (slotsPLUS !== undefined) sq.slotsPLUS = Math.max(0, parseInt(slotsPLUS) || 0);
    if (recompra !== undefined) sq.recompra = Math.max(0, parseInt(recompra) || 0);
    broadcastStato(astaId);
  });

  socket.on('annulla-assegnazione', ({ astaId }) => {
    const asta = aste.get(astaId);
    if (!asta || !isAdmin(asta, socket.id)) return;
    if (!asta.storico.length) return socket.emit('errore', { msg: 'Nessuna assegnazione da annullare' });
    _annullaItem(asta, asta.storico.length - 1);
    broadcastStato(astaId, true); io.to(astaId).emit('assegnazione-annullata', {});
  });

  socket.on('annulla-assegnazione-specifica', ({ astaId, index }) => {
    const asta = aste.get(astaId);
    if (!asta || !isAdmin(asta, socket.id)) return;
    if (index < 0 || index >= asta.storico.length) return socket.emit('errore', { msg: 'Indice non valido' });
    // Asta di riparazione: ogni estrazione modifica lo stato (crediti/rosa/slot svincolo) di
    // quelle successive — annullarne una nel mezzo lascerebbe lo stato incoerente. Si puo'
    // annullare solo a ritroso, un'estrazione alla volta. Asta iniziale invariata.
    if (asta.tipoAsta === 'riparazione' && index !== asta.storico.length - 1) {
      return socket.emit('errore', { msg: 'In Asta di riparazione puoi annullare solo l\'estrazione più recente' });
    }
    const item = asta.storico[index];
    _annullaItem(asta, index);
    broadcastStato(astaId, true); io.to(astaId).emit('assegnazione-annullata', { giocatore: item.giocatore });
  });

  socket.on('scarta-manuale', ({ astaId }) => {
    const asta = aste.get(astaId);
    if (!asta || !isAdmin(asta, socket.id)) return;
    if (!asta.chiamataAttuale) return socket.emit('errore', { msg: 'Nessuna chiamata attiva' });
    clearTimer(astaId);
    scartaGiocatore(astaId);
  });

  socket.on('reintroduci-scartati', ({ astaId }) => {
    const asta = aste.get(astaId);
    if (!asta || !isAdmin(asta, socket.id)) return;
    let count = 0;
    asta.poolGiocatori.forEach(g => { if (g.scartato) { g.scartato = false; g.estratto = false; count++; } });
    broadcastStato(astaId, true); socket.emit('scartati-reintrodotti', { count });
  });

  socket.on('termina-asta', ({ astaId }) => {
    const asta = aste.get(astaId);
    if (!asta || !isAdmin(asta, socket.id)) return;
    // Validazione finale (solo riparazione: 'iniziale' non ha un meccanismo di svincolo per
    // "aggiustare" una rosa incompleta, quindi lo stesso controllo non avrebbe un'azione
    // correttiva disponibile). Il tetto massimo e' gia' garantito continuamente durante
    // l'asta da calcolaMaxOfferta/esegui-svincolo — ricontrollato qui solo per difesa in
    // profondita', non dovrebbe mai scattare in pratica.
    if (asta.tipoAsta === 'riparazione') {
      const minimoPortieri = asta.minimoPortieri || 0;
      const minimoMovimento = asta.minimoMovimento || 0;
      const capMax = asta.maxGiocatoriPerSquadra || 25;
      const squadreNonConformi = asta.squadre.filter(sq => {
        const portieriSq = sq.rosa.filter(g => isPortiere(g.ruolo)).length;
        const movimentoSq = sq.rosa.length - portieriSq;
        return portieriSq < minimoPortieri || movimentoSq < minimoMovimento || sq.rosa.length > capMax;
      });
      if (squadreNonConformi.length) {
        return socket.emit('errore', {
          msg: `Non puoi terminare l'asta: ${squadreNonConformi.map(sq => sq.nome).join(', ')} non rispetta ancora i minimi Portieri/Movimento o il tetto rosa configurati. Sistema la rosa (es. admin-update-crediti) prima di chiudere.`
        });
      }
    }
    clearTimer(astaId); asta.stato = 'completata'; asta.chiamataAttuale = null;
    saveExportSupabase(asta);
    // NB: niente backup=true qui — l'asta è conclusa, il backup verrà eliminato subito sotto,
    // quindi salvarlo prima causerebbe una race condition (upsert asincrono che potrebbe
    // completarsi DOPO la delete, ricreando la riga con stato "completata" per sempre).
    broadcastStato(astaId); io.to(astaId).emit('asta-terminata', { astaId });
    deleteBackupSupabase(astaId);
    // Rete di sicurezza contro la race condition descritta sopra: se un autosave dei 30s
    // era già "in volo" (avviato pochi istanti prima di questo terminare) e completa DOPO
    // la delete qui sopra, ricreerebbe per sempre una riga fantasma in asta_backups con lo
    // stato precedente ("in corso"), facendo apparire l'asta come ancora attiva nella Home
    // anche se in realtà è già conclusa. Ripetendo la delete due volte in differita, con
    // margine ampio rispetto a qualsiasi upsert in ritardo, la riga fantasma viene rimossa.
    setTimeout(() => deleteBackupSupabase(astaId), 8000);
    setTimeout(() => deleteBackupSupabase(astaId), 20000);
  });

  socket.on('modifica-timer', ({ astaId, timerPrimaChiamata, timerRilancio }) => {
    const asta = aste.get(astaId);
    if (!asta || !isAdmin(asta, socket.id)) return;
    if (timerPrimaChiamata > 0) asta.timerPrimaChiamata = parseInt(timerPrimaChiamata);
    if (timerRilancio > 0) asta.timerRilancio = parseInt(timerRilancio);
    broadcastStato(astaId);
  });

  socket.on('disconnect', () => {
    if (socket.astaId) {
      const asta = aste.get(socket.astaId);
      if (asta) {
        const sq = asta.squadre.find(s => s.utenti.includes(socket.id));
        if (sq) sq.utenti = sq.utenti.filter(id => id !== socket.id);
        asta.adminSocketIds = asta.adminSocketIds.filter(id => id !== socket.id);
        broadcastStato(socket.astaId);
      }
    }
  });
});

// ══ BACKUP API ══════════════════════════════
// NB: GET /api/asta/:id/backup e GET /api/backup-list sono stati rimossi (agosto 2026):
// esponevano l'adminToken completo (e la lista di TUTTE le aste) senza alcuna autenticazione,
// permettendo a chiunque conoscesse l'ID di un'asta di ottenere pieno controllo admin su di
// essa. Nessuna parte del frontend li utilizzava. Le funzioni equivalenti e sicure (con verifica
// del creatore loggato) sono /api/asta/:id/mio-backup e /api/mie-aste, piu' sotto.

// ══ MIE ASTE / RIPRENDI (login richiesto) ══════════════════════
// Helper: valida il token Bearer e ritorna { userId, email } oppure null.
async function getUtenteDaToken(req) {
  if (!supabaseAdmin) return null;
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data || !data.user) return null;
  return { userId: data.user.id, email: data.user.email || null };
}

// Ripristina in memoria un'asta da uno snapshot di backup (stesso identico comportamento
// usato in loadBackups all'avvio del server), senza toccare le aste già attive.
function ripristinaAstaInMemoria(snap) {
  if (!snap || !snap.asta || !snap.asta.id) return null;
  if (aste.has(snap.asta.id)) return aste.get(snap.asta.id);
  snap.asta.adminSocketIds = [];
  (snap.asta.squadre || []).forEach(s => { s.utenti = []; s.online = false; });
  aste.set(snap.asta.id, snap.asta);
  return snap.asta;
}

// Elenco leggero delle aste (in corso, non ancora terminate) create dall'utente loggato,
// da mostrare nella sezione "Mie aste" della Home. Fonte: Supabase asta_backups, filtrando
// per creatorUserId dentro al payload (nessuna nuova colonna necessaria).
app.get('/api/mie-aste', async (req, res) => {
  const utente = await getUtenteDaToken(req);
  if (!utente) return res.status(401).json({ error: 'Login richiesto' });
  if (!supabaseAdmin) return res.json([]);
  try {
    const { data, error } = await supabaseAdmin
      .from('asta_backups')
      .select('asta_id, payload, updated_at')
      .filter('payload->asta->>creatorUserId', 'eq', utente.userId);
    if (error) return res.status(500).json({ error: error.message });
    const lista = (data || []).map(row => {
      const a = row.payload && row.payload.asta;
      if (!a) return null;
      // Se il processo ha ancora l'asta viva in memoria, il SUO stato è quello vero e
      // aggiornato; il payload salvato su Supabase potrebbe invece essere una riga
      // "fantasma" risorta da una race condition di autosave (vedi commento in
      // 'termina-asta'), quindi diamo sempre precedenza allo stato in memoria quando c'è.
      const live = aste.get(a.id);
      const statoReale = live ? live.stato : a.stato;
      if (statoReale === 'completata') return null; // asta già conclusa: non mostrarla come "in corso"
      return {
        astaId: a.id, nome: a.nome, stato: statoReale, tipoAsta: a.tipoAsta,
        numSquadre: (a.squadre || []).length, updatedAt: row.updated_at,
        inMemoria: !!live
      };
    }).filter(Boolean);
    res.json(lista);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Riprende un'asta del creatore loggato: se è già viva nel processo, ritorna semplicemente
// il suo adminToken attuale (nessuna modifica). Se non è in memoria (server riavviato/crash),
// la ricostruisce dal backup Supabase e genera un NUOVO adminToken (invalida il precedente),
// senza mai disconnettere gli altri partecipanti eventualmente già collegati.
app.post('/api/asta/:id/riprendi', limiteRipristini, async (req, res) => {
  const utente = await getUtenteDaToken(req);
  if (!utente) return res.status(401).json({ error: 'Login richiesto' });
  if (!supabaseAdmin) return res.status(500).json({ error: 'Supabase non configurato sul server' });
  const astaId = req.params.id;

  let asta = aste.get(astaId);
  if (asta) {
    if (asta.creatorUserId !== utente.userId) return res.status(403).json({ error: 'Non sei il creatore di questa asta' });
    return res.json({ success: true, astaId: asta.id, adminToken: asta.adminToken, ricostruita: false });
  }

  try {
    const { data, error } = await supabaseAdmin.from('asta_backups').select('payload').eq('asta_id', astaId).single();
    if (error || !data || !data.payload) return res.status(404).json({ error: 'Nessun backup trovato per questa asta' });
    const snap = data.payload;
    if (!snap.asta || snap.asta.creatorUserId !== utente.userId) return res.status(403).json({ error: 'Non sei il creatore di questa asta' });
    asta = ripristinaAstaInMemoria(snap);
    if (!asta) return res.status(500).json({ error: 'Backup corrotto, impossibile ripristinare' });
    asta.adminToken = uuidv4();
    saveBackup(asta);
    res.json({ success: true, astaId: asta.id, adminToken: asta.adminToken, ricostruita: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Scarica lo snapshot completo dell'asta (stesso formato usato internamente per il backup)
// per permettere al creatore di conservare una propria copia locale, da poter ri-uploadare
// in seguito con /api/asta/ripristina-da-file se il backup automatico su Supabase non fosse
// disponibile per qualsiasi motivo. Solo il creatore dell'asta può scaricarlo.
app.get('/api/asta/:id/mio-backup', async (req, res) => {
  const utente = await getUtenteDaToken(req);
  if (!utente) return res.status(401).json({ error: 'Login richiesto' });
  const astaId = req.params.id;

  let asta = aste.get(astaId);
  let snap;
  if (asta) {
    if (asta.creatorUserId !== utente.userId) return res.status(403).json({ error: 'Non sei il creatore di questa asta' });
    snap = { backup: true, timestamp: new Date().toISOString(), asta: JSON.parse(JSON.stringify(asta)) };
  } else {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Supabase non configurato sul server' });
    try {
      const { data, error } = await supabaseAdmin.from('asta_backups').select('payload').eq('asta_id', astaId).single();
      if (error || !data || !data.payload) return res.status(404).json({ error: 'Nessun backup trovato per questa asta' });
      snap = data.payload;
      if (!snap.asta || snap.asta.creatorUserId !== utente.userId) return res.status(403).json({ error: 'Non sei il creatore di questa asta' });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }
  // Rimuove dal file scaricato i dati sensibili non necessari per un ripristino:
  // l'adminToken darebbe controllo completo dell'asta a chiunque avesse il file, e non
  // serve comunque perché /api/asta/ripristina-da-file ne genera sempre uno nuovo.
  const snapSicuro = JSON.parse(JSON.stringify(snap));
  if (snapSicuro.asta) {
    delete snapSicuro.asta.adminToken;
    delete snapSicuro.asta.creatorEmail;
    delete snapSicuro.asta.adminSocketIds;
  }
  res.setHeader('Content-Disposition', 'attachment; filename="backup-asta-' + astaId + '.json"');
  res.json(snapSicuro);
});

// Ripristina un'asta a partire da un file di backup caricato manualmente dal creatore
// (seconda via di recupero, indipendente dal backup automatico su Supabase). Il file deve
// essere esattamente uno scaricato tramite /api/asta/:id/mio-backup (stesso formato).
// Per sicurezza, viene verificato che l'asta contenuta nel file appartenga davvero
// all'utente loggato, prima di rimetterla in memoria e generare un nuovo adminToken.
app.post('/api/asta/ripristina-da-file', limiteRipristini, async (req, res) => {
  const utente = await getUtenteDaToken(req);
  if (!utente) return res.status(401).json({ error: 'Login richiesto' });
  try {
    const snap = req.body;
    if (!snap || !snap.asta || !snap.asta.id) return res.status(400).json({ error: 'File non valido: struttura asta mancante' });
    if (snap.asta.creatorUserId !== utente.userId) return res.status(403).json({ error: 'Questo file non appartiene a un\'asta creata da te' });

    let asta = aste.get(snap.asta.id);
    if (asta) {
      if (asta.creatorUserId !== utente.userId) return res.status(403).json({ error: 'Non sei il creatore di questa asta' });
      return res.json({ success: true, astaId: asta.id, adminToken: asta.adminToken, ricostruita: false });
    }

    asta = ripristinaAstaInMemoria(snap);
    if (!asta) return res.status(500).json({ error: 'File corrotto, impossibile ripristinare' });
    asta.adminToken = uuidv4();
    saveBackup(asta);
    res.json({ success: true, astaId: asta.id, adminToken: asta.adminToken, ricostruita: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════ EDITOR VISUALE DI STILE — RIMOSSO ══════
// Qui vivevano GET/POST /api/theme e la costante THEME_EDITOR_SECRET, una chiave
// segreta scritta in chiaro nel codice e quindi pubblica su GitHub: chiunque leggesse
// il repository poteva riscrivere il CSS globale iniettato a TUTTI gli utenti
// dell'app (e' esattamente il meccanismo dell'incidente dei bottoni viola).
// L'editor non veniva piu' usato, quindi e' stato eliminato invece che protetto.
// NB: la tabella Supabase `theme_overrides` NON e' stata toccata perche' ospita anche
// la riga `gk_planner_calendario` (il calendario reale del GK Planner, piu' sopra).
// La riga `default` resta li' dentro, vuota ({}), ormai senza nessun lettore.

// Auto-save every 30s — esclude 'attesa' (nulla da salvare) e 'completata' (il backup di
// un'asta conclusa viene eliminato esplicitamente in termina-asta: risalvarlo qui ogni 30s
// lo farebbe reapparire per sempre come riga orfana in asta_backups).
setInterval(() => {
  aste.forEach(asta => { if (asta.stato !== 'attesa' && asta.stato !== 'completata') saveBackup(asta); });
}, 30000);

// Pulizia periodica della memoria: senza questo, ogni asta creata (anche quelle
// abbandonate o terminate da tempo) resterebbe per sempre nella Map "aste" finché
// il processo non viene riavviato. Le astre terminate da più di 24h, o comunque
// create da più di 30 giorni (a prescindere dallo stato), vengono rimosse dalla
// memoria — il backup su disco resta comunque disponibile in data/backup_asta_*.json.
const UN_GIORNO_MS = 24 * 60 * 60 * 1000;
const TRENTA_GIORNI_MS = 30 * UN_GIORNO_MS;
setInterval(() => {
  const ora = Date.now();
  aste.forEach((asta, id) => {
    const creataMs = asta.createdAt ? new Date(asta.createdAt).getTime() : 0;
    const eta = creataMs ? (ora - creataMs) : 0;
    const daRimuovere = (asta.stato === 'completata' && eta > UN_GIORNO_MS) || eta > TRENTA_GIORNI_MS;
    if (daRimuovere) {
      clearTimer(id);
      aste.delete(id);
      _ultimoBackupHash.delete(id); // evita una piccola fuga di memoria: senza questo, la Map
      // continuerebbe a crescere di una entry per ogni asta rimossa da qui, per sempre.
      console.log('[cleanup] Asta rimossa dalla memoria (inattiva):', id);
    }
  });
}, 60 * 60 * 1000); // ogni ora

// Pulizia di riga "fantasma" in asta_backups: se un'asta è già presente in asta_exports
// (prova definitiva che è stata terminata correttamente con /termina-asta), ma esiste
// ANCORA una riga corrispondente in asta_backups, significa che una race condition tra
// l'autosave dei 30s e la delete di fine-asta l'ha risuscitata (vedi commento in
// 'termina-asta'). La rimuoviamo qui, una volta ad ogni avvio del server, così un'asta
// già conclusa non appare più erroneamente come "in corso" nella Home di nessuno.
async function puliziaBackupFantasma() {
  if (!supabaseAdmin) return;
  try {
    const { data: exports, error: expErr } = await supabaseAdmin.from('asta_exports').select('asta_id');
    if (expErr || !exports || !exports.length) return;
    const idsTerminate = new Set(exports.map(r => r.asta_id));
    const { data: backups, error: bkErr } = await supabaseAdmin.from('asta_backups').select('asta_id');
    if (bkErr || !backups || !backups.length) return;
    const daPulire = backups.map(r => r.asta_id).filter(id => idsTerminate.has(id));
    if (!daPulire.length) return;
    console.log('[puliziaBackupFantasma] Rimuovo', daPulire.length, 'backup fantasma di aste già concluse:', daPulire.join(', '));
    for (const id of daPulire) deleteBackupSupabase(id);
  } catch (e) {
    console.error('[puliziaBackupFantasma] errore (non-fatale):', e.message);
  }
}

/* ══════════════════════════════════════════════════════════════════
   VIDEOCHIAMATA (JaaS) — configurazione e firma del token

   Additivo: due rotte nuove, niente toccato di quello che c'era. Non
   sfiora backup, autenticazione dell'asta ne' timer.

   Perche' serve il backend per una cosa che vive nel browser: JaaS non
   apre le sue stanze a chiunque, vuole un JWT firmato con una chiave
   privata RSA. Quella chiave e' l'unico segreto vero di tutto questo, e
   sta SOLO in una variabile d'ambiente. Il precedente e' scritto in
   DECISIONS.md: THEME_EDITOR_SECRET era una stringa in chiaro nel
   backend, quindi pubblica su GitHub, ed era l'unica protezione di una
   rotta che riscriveva il CSS di tutti. Non si ripete.

   Si firma con il `crypto` che Node ha gia' in casa, senza aggiungere
   nessuna dipendenza: RS256 e' una firma RSA-SHA256 su
   base64url(header).base64url(payload), e Buffer sa fare il base64.

   La rotta del token RICHIEDE IL LOGIN, e non e' burocrazia: il piano
   gratuito di JaaS conta 25 dispositivi al mese, quindi un endpoint
   aperto sarebbe una quota che chiunque puo' bruciare. Chi e' in
   un'asta e' gia' loggato con Supabase.
   ══════════════════════════════════════════════════════════════════ */

function chiavePrivataJaas() {
  let k = process.env.JAAS_PRIVATE_KEY || '';
  if (!k) return null;
  // Le variabili d'ambiente non conservano gli a capo. Si accettano due
  // forme, cosi' non c'e' un modo "sbagliato" di incollarla: la chiave
  // con i \n scritti a mano, oppure tutta in base64 (piu' comoda).
  if (k.indexOf('BEGIN') === -1) {
    try { k = Buffer.from(k, 'base64').toString('utf8'); } catch (e) { return null; }
  }
  k = k.replace(/\\n/g, '\n');
  return k.indexOf('BEGIN') === -1 ? null : k;
}

function jaasConfigurato() {
  return !!(process.env.JAAS_APP_ID && process.env.JAAS_KID && chiavePrivataJaas());
}

function base64urlJaas(dato) {
  return Buffer.from(dato).toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function firmaTokenJaas(dati) {
  const appId = process.env.JAAS_APP_ID;
  const ora = Math.floor(Date.now() / 1000);
  const testa = { alg: 'RS256', kid: process.env.JAAS_KID, typ: 'JWT' };
  const corpo = {
    aud: 'jitsi',
    iss: 'chat',
    sub: appId,
    room: dati.stanza,
    // 12 ore: un'asta ne dura 8-9, e il token si chiede al momento di
    // entrare, quindi copre la serata da qualunque punto ci si unisca.
    nbf: ora - 10,
    exp: ora + 12 * 60 * 60,
    context: {
      user: {
        id: dati.userId || '',
        name: dati.nome || 'Ospite',
        email: dati.email || '',
        moderator: 'false'
      },
      features: {
        livestreaming: 'false',
        recording: 'false',
        transcription: 'false',
        'outbound-call': 'false'
      }
    }
  };
  const a = base64urlJaas(JSON.stringify(testa));
  const b = base64urlJaas(JSON.stringify(corpo));
  const firma = crypto.createSign('RSA-SHA256').update(a + '.' + b).end().sign(chiavePrivataJaas());
  return a + '.' + b + '.' + base64urlJaas(firma);
}

// Pubblica e senza dati sensibili: l'AppID non e' un segreto (viaggia
// nell'URL dello script e nel nome della stanza). Serve al client per
// sapere se il bottone della chiamata deve esistere: finche' le variabili
// d'ambiente non ci sono, risponde `attiva:false` e il bottone non compare.
app.get('/api/chiamata/config', (req, res) => {
  if (!jaasConfigurato()) return res.json({ attiva: false });
  res.json({ attiva: true, dominio: '8x8.vc', appId: process.env.JAAS_APP_ID });
});

app.get('/api/chiamata/token', async (req, res) => {
  if (!jaasConfigurato()) return res.status(503).json({ error: 'Videochiamata non configurata' });
  const utente = await getUtenteDaToken(req);
  if (!utente) return res.status(401).json({ error: 'Serve il login' });
  // Solo lettere e cifre: il nome della stanza finisce dentro al claim
  // `room` del JWT e nell'URL della conferenza.
  const stanza = String(req.query.stanza || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 80);
  if (!stanza) return res.status(400).json({ error: 'Stanza mancante' });
  const nome = String(req.query.nome || '').slice(0, 60);
  try {
    res.json({ jwt: firmaTokenJaas({ stanza, nome, userId: utente.userId, email: utente.email }) });
  } catch (e) {
    console.error('[chiamata] firma del token fallita:', e.message);
    res.status(500).json({ error: 'Firma del token fallita' });
  }
});

// Load backups at startup
loadBackups().catch(e => console.error('[loadBackups] fatale (non-fatale per il server, l\'asta parte comunque vuota):', e.message));
loadBackupSupabaseAttivo().catch(e => console.error('[loadBackupSupabaseAttivo] fatale (non-fatale, resta il default true):', e.message));
loadManutenzioneAttiva().catch(e => console.error('[loadManutenzioneAttiva] fatale (non-fatale, resta il default false):', e.message));
puliziaBackupFantasma().catch(e => console.error('[puliziaBackupFantasma] fatale (non-fatale):', e.message));

const PORT = process.env.PORT || 3000;
// Bind esplicito su tutte le interfacce: di default Node fa gia' bind su 0.0.0.0,
// ma renderlo esplicito evita ambiguita' dietro reverse proxy di hosting diversi da Render.
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n🎯 Asta FantaSbocchini v2 — Server attivo');
  console.log('   http://localhost:' + PORT + '\n');
});
