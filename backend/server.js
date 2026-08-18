const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs   = require('fs');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

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
const io = new Server(server, { cors: { origin: '*' } });

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
app.use(express.json({ limit: '10mb' }));

app.post('/api/auth/completa-registrazione', async (req, res) => {
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
    ...asta, adminSocketIds: undefined,
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
function calcolaMaxOfferta(asta, squadra, giocatore) {
  // Tetto TOTALE rosa (portieri+movimento sommati), separato dai minimi per categoria
  // sopra: se la squadra ha gia' raggiunto/superato il tetto non puo' fare offerte,
  // qualunque sia la composizione. Bloccato qui (non nell'handler 'rilancio') cosi'
  // resta l'unico punto di verita', coerente col controllo gia' esistente offerta > maxOff.
  if (squadra.rosa.length >= (asta.maxGiocatoriPerSquadra || 25)) return 0;
  const minimoPortieri = asta.minimoPortieri || 0;
  const minimoMovimento = asta.minimoMovimento || 0;
  const portieriAttuali = squadra.rosa.filter(g => isPortiere(g.ruolo)).length;
  const movimentoAttuali = squadra.rosa.length - portieriAttuali;
  const ePortiere = giocatore ? isPortiere(giocatore.ruolo) : null;
  const portieriDopo = portieriAttuali + (ePortiere === true ? 1 : 0);
  const movimentoDopo = movimentoAttuali + (ePortiere === false ? 1 : 0);
  const creditiRiservati = Math.max(0, minimoPortieri - portieriDopo) + Math.max(0, minimoMovimento - movimentoDopo);

  if (asta.tipoAsta === 'iniziale') {
    return Math.max(1, squadra.crediti - creditiRiservati);
  }
  const fattore = asta.fattoreSvincolo || 0.5;
  const svincoliRimanenti = asta.svincoliTotali - (squadra.svincoliUsati || 0);
  if (svincoliRimanenti <= 0) return squadra.crediti;
  const sorted = [...squadra.rosa].sort((a, b) => Math.floor(b.prezzo * fattore) - Math.floor(a.prezzo * fattore));
  let creditiRecuperabili = 0;
  const maxSvinc = Math.min(svincoliRimanenti, sorted.length);
  for (let i = 0; i < maxSvinc; i++) creditiRecuperabili += Math.floor(sorted[i].prezzo * fattore);
  return Math.max(1, squadra.crediti + creditiRecuperabili - creditiRiservati);
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

  // Svincolo (riparazione)
  if (asta.tipoAsta === 'riparazione' && squadraOfferente) {
    const sq = getSquadra(asta, squadraOfferente);
    if (sq && offertaAttuale > sq.crediti) {
      const svincoliRimanenti = asta.svincoliTotali - (sq.svincoliUsati || 0);
      asta.popupAttivo = { tipo: 'svincolo', giocatore, prezzoFinale: offertaAttuale, squadraVincitrice: squadraOfferente, differenza: offertaAttuale - sq.crediti, svincoliRimanenti };
      asta.chiamataAttuale = null;
      emitToSquadra(astaId, squadraOfferente, 'popup-svincolo', { ...asta.popupAttivo, rosa: sq.rosa, fattoreSvincolo: asta.fattoreSvincolo || 0.5 });
      emitToAdmins(astaId, 'popup-svincolo-admin', asta.popupAttivo);
      broadcastStato(astaId); return;
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
app.post('/api/asta', async (req, res) => {
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
app.post('/api/listino/upload', async (req, res) => {
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
app.get('/api/exports', async (req, res) => {
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
  if (!supabaseAdmin) return res.status(500).json({ error: 'Supabase non configurato sul server' });
  try {
    const { data, error } = await supabaseAdmin.from('asta_exports').select('payload').eq('id', req.params.id).single();
    if (error || !data) return res.status(404).json({ error: 'Esportazione non trovata' });
    res.json(data.payload);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/exports/:id', async (req, res) => {
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
    const disp = asta.poolGiocatori.filter(g => !g.estratto && !g.assegnato && !g.scartato);
    if (disp.length === 0) return socket.emit('errore', { msg: 'Nessun giocatore disponibile' });
    avviaChiamata(astaId, disp[Math.floor(Math.random() * disp.length)]);
  });

  socket.on('chiama-giocatore', ({ astaId, giocatoreId, giocatoreManuale }) => {
    const asta = aste.get(astaId);
    if (!asta || asta.stato !== 'in_corso' || !isAdmin(asta, socket.id)) return;
    if (asta.chiamataAttuale) return socket.emit('errore', { msg: 'Chiamata già in corso' });
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
    const fattore = asta.fattoreSvincolo || 0.5;
    let creditiRecuperati = 0; const svincolati = [];
    giocatoriIds.forEach(gId => {
      const idx = squadra.rosa.findIndex(g => g.id === gId); if (idx === -1) return;
      const g = squadra.rosa.splice(idx, 1)[0];
      const credRecup = Math.floor(g.prezzo * fattore); creditiRecuperati += credRecup;
      svincolati.push({ ...g, creditiRecuperati: credRecup });
      squadra.svincoliUsati = (squadra.svincoliUsati || 0) + 1;
      const gPool = asta.poolGiocatori.find(p => p.id === gId);
      if (gPool) { gPool.estratto = false; gPool.assegnato = false; gPool.scartato = false; }
      else asta.poolGiocatori.push({ id: gId, nome: g.nome, ruolo: g.ruolo || '', tipo: 'NN', costoOriginale: g.prezzo, valore: g.valore || 0, squadraOriginale: null, estratto: false, assegnato: false, scartato: false, quotazione: g.quotazione ?? null });
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

  socket.on('admin-update-config', ({ astaId, timerPrimaChiamata, timerRilancio, minimoPortieri, minimoMovimento, maxGiocatoriPerSquadra }) => {
    const asta = aste.get(astaId);
    if (!asta || !isAdmin(asta, socket.id)) return;
    if (timerPrimaChiamata !== undefined) asta.timerPrimaChiamata = Math.max(1, parseInt(timerPrimaChiamata) || asta.timerPrimaChiamata);
    if (timerRilancio !== undefined) asta.timerRilancio = Math.max(1, parseInt(timerRilancio) || asta.timerRilancio);
    if (minimoPortieri !== undefined) asta.minimoPortieri = Math.max(0, parseInt(minimoPortieri) || 0);
    if (minimoMovimento !== undefined) asta.minimoMovimento = Math.max(0, parseInt(minimoMovimento) || 0);
    if (maxGiocatoriPerSquadra !== undefined) asta.maxGiocatoriPerSquadra = Math.max(1, parseInt(maxGiocatoriPerSquadra) || asta.maxGiocatoriPerSquadra || 25);
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
app.post('/api/asta/:id/riprendi', async (req, res) => {
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
app.post('/api/asta/ripristina-da-file', async (req, res) => {
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

// ══════ EDITOR VISUALE DI STILE (Fase 1) ══════
// Chiave segreta semplice per proteggere il salvataggio (solo il proprietario la conosce).
// Usata come query param ?editorKey=... sia per leggere sia per salvare.
const THEME_EDITOR_SECRET = 'fasce-editor-2026-vc95';

app.get('/api/theme', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.json({ styles: {} });
    const { data, error } = await supabaseAdmin.from('theme_overrides').select('styles').eq('id', 'default').single();
    if (error) return res.json({ styles: {} });
    res.json({ styles: (data && data.styles) || {} });
  } catch (e) {
    res.json({ styles: {} });
  }
});

app.post('/api/theme', async (req, res) => {
  try {
    const key = req.query.editorKey || (req.body && req.body.editorKey);
    if (key !== THEME_EDITOR_SECRET) return res.status(403).json({ error: 'Chiave editor non valida' });
    if (!supabaseAdmin) return res.status(500).json({ error: 'Supabase non configurato' });
    const styles = (req.body && req.body.styles) || {};
    const { error } = await supabaseAdmin.from('theme_overrides')
      .upsert({ id: 'default', styles, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
