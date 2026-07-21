const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs   = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use(express.json({ limit: '10mb' }));

const aste = new Map();
const timers = new Map();

// ══ BACKUP ══════════════════════════════════
const BACKUP_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(BACKUP_DIR)) { try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch(e) {} }

function saveBackup(asta) {
  if (!asta || !asta.id) return;
  try {
    const snap = { backup: true, timestamp: new Date().toISOString(), asta: JSON.parse(JSON.stringify(asta)) };
    fs.writeFileSync(path.join(BACKUP_DIR, 'backup_asta_' + asta.id + '.json'), JSON.stringify(snap));
  } catch(e) { /* non-fatal */ }
}

function loadBackups() {
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
          console.log('  ♻️  Ripristinata: ' + (data.asta.nome || data.asta.id) + ' (' + data.timestamp + ')');
        }
      } catch(e) { /* skip corrupt file */ }
    });
    if (n > 0) console.log('✅ ' + n + ' asta/e ripristinate da backup');
  } catch(e) { console.error('loadBackups error:', e.message); }
}

// ============ HELPERS ============
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
function calcolaMaxOfferta(asta, squadra) {
  if (asta.tipoAsta === 'iniziale') {
    const minimoTotale = (asta.minimoPortieri || 0) + (asta.minimoMovimento || 0);
    const slotVuoti = Math.max(0, minimoTotale - squadra.rosa.length - 1);
    const creditiRiservati = slotVuoti;
    return Math.max(1, squadra.crediti - creditiRiservati);
  }
  const fattore = asta.fattoreSvincolo || 0.5;
  const svincoliRimanenti = asta.svincoliTotali - (squadra.svincoliUsati || 0);
  if (svincoliRimanenti <= 0) return squadra.crediti;
  const rosaAttuale = squadra.rosa.length;
  const minimoTotale = (asta.minimoPortieri || 0) + (asta.minimoMovimento || 0);
  const slotVuoti = Math.max(0, minimoTotale - rosaAttuale - 1);
  const creditiRiservati = Math.max(0, slotVuoti);
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

function avviaChiamata(astaId, giocatore) {
  const asta = aste.get(astaId); if (!asta) return;
  giocatore.estratto = true;

  // RIC: offri conferma al proprietario precedente
  if (asta.tipoAsta === 'iniziale' && giocatore.tipo === 'RIC' && giocatore.squadraOriginale) {
    const sqPrec = getSquadra(asta, giocatore.squadraOriginale);
    const haSlot = sqPrec && (sqPrec.slotsRIC - sqPrec.slotsRICUsati) > 0;
    const haCrediti = sqPrec && sqPrec.crediti >= giocatore.costoOriginale;
    if (haSlot && haCrediti) {
      asta.chiamataAttuale = {
        giocatore, offertaAttuale: giocatore.costoOriginale, squadraOfferente: null,
        proprietarioPrecedente: giocatore.squadraOriginale, aspettandoConferma: true,
        proprietarioPrecedenteHaPuntato: false, fase: 'conferma', timer: 0
      };
      broadcastStato(astaId);
      const popupData = { giocatore, costoConferma: giocatore.costoOriginale, proprietario: giocatore.squadraOriginale };
      // Show card to ALL players (aspettandoConferma=true suppresses rilancio box on client)
      io.to(astaId).emit('nuova-chiamata', asta.chiamataAttuale);
      emitToSquadra(astaId, giocatore.squadraOriginale, 'popup-ric-conferma', popupData);
      emitToAdmins(astaId, 'popup-ric-conferma-admin', popupData);
      return;
    }
  }

  // Asta normale — prezzo parte da 0 (prima offerta = 1)
  asta.chiamataAttuale = {
    giocatore, offertaAttuale: 0, squadraOfferente: null,
    proprietarioPrecedente: giocatore.squadraOriginale || null,
    aspettandoConferma: false, proprietarioPrecedenteHaPuntato: false,
    fase: 'prima', timer: asta.timerPrimaChiamata
  };
  broadcastStato(astaId);
  io.to(astaId).emit('nuova-chiamata', asta.chiamataAttuale);
  startTimer(astaId, 'prima');
}

function scartaGiocatore(astaId) {
  const asta = aste.get(astaId); if (!asta || !asta.chiamataAttuale) return;
  const { giocatore } = asta.chiamataAttuale;
  giocatore.estratto = true; giocatore.scartato = true;
  asta.storico.push({ giocatore, prezzo: 0, squadra: null, tipo: 'scartato', timestamp: new Date().toISOString() });
  asta.chiamataAttuale = null;
  io.to(astaId).emit('giocatore-scartato', { giocatore });
  broadcastStato(astaId);
}

function chiudiAsta(astaId) {
  const asta = aste.get(astaId); if (!asta || !asta.chiamataAttuale) return;
  const chiamata = asta.chiamataAttuale;
  const { giocatore, offertaAttuale, squadraOfferente } = chiamata;

  // RIC/PLUS post-auction (solo asta iniziale)
  if (asta.tipoAsta === 'iniziale' && giocatore.squadraOriginale && squadraOfferente && squadraOfferente !== giocatore.squadraOriginale) {
    const sqPrec = getSquadra(asta, giocatore.squadraOriginale);
    const prevBid = chiamata.proprietarioPrecedenteHaPuntato;
    if (!prevBid && sqPrec && giocatore.tipo === 'RIC') {
      const hasPLUS = (sqPrec.slotsPLUS - sqPrec.slotsPLUSUsati) > 0;
      const hasRecompra = !sqPrec.recompraUsata;
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
  asta.storico.push({ giocatore, prezzo: offertaAttuale, squadra: squadraOfferente, tipo: 'normale', timestamp: new Date().toISOString() });
  asta.chiamataAttuale = null;
  io.to(astaId).emit('giocatore-assegnato', { giocatore, prezzo: offertaAttuale, squadra: squadraOfferente, tipo: 'normale' });
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
        sq.slotsPLUSUsati = Math.max(0, sq.slotsPLUSUsati - 1);
        const sqPrec = getSquadra(asta, item.plusvalenzaA);
        if (sqPrec) sqPrec.crediti -= (item.guadagno || 0);
      }
      if (item.tipo === 'recompra') sq.recompraUsata = false;
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
app.post('/api/asta', (req, res) => {
  const id = uuidv4();
  const b = req.body;
  const sottoTipo = b.sottoTipoRiparazione || '1';
  const fattoreSvincolo = sottoTipo === '2' ? (1 / 3) : 0.5;

  const asta = {
    id, nome: b.nome || 'Asta FantaSbocchini',
    tipoAsta: b.tipoAsta || 'iniziale', sottoTipoRiparazione: sottoTipo,
    crediti: b.crediti || 500, timerPrimaChiamata: b.timerPrimaChiamata || 7,
    timerRilancio: b.timerRilancio || 5, tipoEstrazione: b.tipoEstrazione || 'manuale',
    minimoPortieri: b.minimoPortieri || 1, minimoMovimento: b.minimoMovimento || 7,
    svincoliTotali: b.svincoliTotali || 15, fattoreSvincolo,
    numeroPartecipanti: b.numeroPartecipanti || 12,
    stato: 'attesa', squadre: [], adminNome: null, adminSocketIds: [],
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
      const squadra = {
        nome: sq.nome,
        crediti: asta.tipoAsta === 'iniziale' ? (sq.crediti !== undefined ? sq.crediti : 0) + asta.crediti : (sq.crediti !== undefined ? sq.crediti : asta.crediti),
        slotsRIC: sq.slotRiconferme || 0,       // CORRETTO: slotRiconferme
        slotsRICUsati: 0,
        slotsPLUS: sq.slotPlusvalenze || 0,     // CORRETTO: slotPlusvalenze
        slotsPLUSUsati: 0,
        recompra: 1, recompraUsata: false,
        svincoliUsati: sq.svincoliUsati || 0,
        giocatoriRICTotali, giocatoriPLUSTotali,
        rosa: [], utenti: []
      };
      if (sq.giocatori) {
        sq.giocatori.forEach(g => {
          const tipo = g.tipo === 'RIC' ? 'RIC' : g.tipo === 'PLUS' ? 'PLUS' : 'NN';
          asta.poolGiocatori.push({
            id: uuidv4(), nome: g.nome, ruolo: g.ruolo || '', tipo,
            costoOriginale: g.costo || 1, valore: g.valore || 0, squadraOriginale: sq.nome,
            estratto: false, assegnato: false, scartato: false,
            // campi extra: non mostrati ancora da nessuna parte, servono per una funzione futura
            squadraSerieA: g.squadraSerieA || null,
            pgv: g.pgv ?? null, mv: g.mv ?? null, fm: g.fm ?? null,
            fvmp600: g.fvmp600 ?? null, qam: g.qam ?? null
          });
        });
      }
      asta.squadre.push(squadra);
    });
  }

  aste.set(id, asta);
  res.json({ success: true, astaId: id, link: `/?id=${id}` });
});

app.get('/api/asta/:id', (req, res) => {
  const asta = aste.get(req.params.id);
  if (!asta) return res.status(404).json({ error: 'Asta non trovata' });
  res.json(asta);
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

app.get('/api/aste', (req, res) => {
  res.json(Array.from(aste.values()).map(a => ({ id: a.id, nome: a.nome, stato: a.stato, tipoAsta: a.tipoAsta })));
});

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
      svincoliUsati: s.svincoliUsati || 0,
      giocatori: s.rosa.map(g => ({ nome: g.nome, ruolo: g.ruolo || '', tipo: g.tipo || 'NN', costo: g.prezzo }))
    }))
  };
  res.setHeader('Content-Disposition', `attachment; filename="asta-export-${asta.id.slice(0,8)}.json"`);
  res.json(exportData);
});

// ============ WEBSOCKET ============
io.on('connection', (socket) => {
  console.log(`[WS] Connesso: ${socket.id}`);

  socket.on('join-asta', ({ astaId, nomeSquadra, isAdmin: adminFlag }) => {
    const asta = aste.get(astaId);
    if (!asta) return socket.emit('errore', { msg: 'Asta non trovata' });
    socket.join(astaId); socket.astaId = astaId; socket.nomeSquadra = nomeSquadra;

    let squadra = getSquadra(asta, nomeSquadra);
    if (!squadra) {
      if (asta.squadre.length >= asta.numeroPartecipanti) {
        return socket.emit('errore', { msg: `Partecipanti al massimo (${asta.numeroPartecipanti})` });
      }
      squadra = {
        nome: nomeSquadra, crediti: asta.crediti,
        slotsRIC: 0, slotsRICUsati: 0, slotsPLUS: 0, slotsPLUSUsati: 0,
        recompra: 1, recompraUsata: false, svincoliUsati: 0,
        giocatoriRICTotali: 0, giocatoriPLUSTotali: 0, rosa: [], utenti: []
      };
      asta.squadre.push(squadra);
    }
    if (!squadra.utenti.includes(socket.id)) squadra.utenti.push(socket.id);

    if (adminFlag || (asta.adminNome && asta.adminNome === nomeSquadra)) {
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
    avviaChiamata(astaId, giocatore);
  });

  socket.on('assegna-manuale', ({ astaId, giocatoreId, squadraNome, prezzo }) => {
    const asta = aste.get(astaId);
    if (!asta || asta.stato !== 'in_corso' || !isAdmin(asta, socket.id)) return;
    if (asta.chiamataAttuale) return socket.emit('errore', { msg: 'Chiamata già in corso, termina prima' });
    const giocatore = asta.poolGiocatori.find(g => g.id === giocatoreId && !g.assegnato && (!g.estratto || g.scartato));
    const squadra = getSquadra(asta, squadraNome);
    if (!giocatore) return socket.emit('errore', { msg: 'Giocatore non trovato o non disponibile' });
    if (!squadra) return socket.emit('errore', { msg: 'Squadra non trovata' });
    const p = Math.max(1, parseInt(prezzo) || 1);
    if (squadra.crediti < p) return socket.emit('errore', { msg: 'Crediti insufficienti per questa squadra' });
    giocatore.estratto = true;
    assegnaGiocatoreASquadra(asta, giocatore, squadra, p);
    asta.storico.push({ giocatore, prezzo: p, squadra: squadra.nome, tipo: 'normale', timestamp: new Date().toISOString() });
    io.to(astaId).emit('giocatore-assegnato', { giocatore, prezzo: p, squadra: squadra.nome, tipo: 'normale' });
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
    const maxOff = calcolaMaxOfferta(asta, sq);
    if (offerta > maxOff) return socket.emit('errore', { msg: `Massimo consentito: ${maxOff} crediti` });
    if (asta.tipoAsta === 'iniziale' && offerta > sq.crediti) return socket.emit('errore', { msg: `Crediti insufficienti (hai ${sq.crediti})` });
    if (sq.nome === chiamata.proprietarioPrecedente) chiamata.proprietarioPrecedenteHaPuntato = true;
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
      asta.chiamataAttuale.proprietarioPrecedenteHaPuntato = false;
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
      broadcastStato(astaId);
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
      assegnaGiocatoreASquadra(asta, giocatore, sqPrec, prezzoRecompra); sqPrec.recompraUsata = true;
      asta.storico.push({ giocatore, prezzo: prezzoRecompra, squadra: popup.proprietarioPrecedente, tipo: 'recompra', timestamp: new Date().toISOString() });
      io.to(astaId).emit('giocatore-assegnato', { giocatore, prezzo: prezzoRecompra, squadra: popup.proprietarioPrecedente, tipo: 'recompra' });
    } else {
      assegnaGiocatoreASquadra(asta, giocatore, sqVinc, prezzoFinale);
      asta.storico.push({ giocatore, prezzo: prezzoFinale, squadra: squadraVincitrice, tipo: 'normale', timestamp: new Date().toISOString() });
      io.to(astaId).emit('giocatore-assegnato', { giocatore, prezzo: prezzoFinale, squadra: squadraVincitrice, tipo: 'normale' });
    }
    broadcastStato(astaId);
    if (asta.tipoEstrazione === 'casuale') {
      setTimeout(() => { const disp = asta.poolGiocatori.filter(g => !g.estratto && !g.assegnato && !g.scartato); if (disp.length > 0) avviaChiamata(astaId, disp[Math.floor(Math.random() * disp.length)]); }, 2000);
    }
  });

  socket.on('esegui-svincolo', ({ astaId, giocatoriIds }) => {
    const asta = aste.get(astaId);
    if (!asta || !asta.popupAttivo || asta.popupAttivo.tipo !== 'svincolo') return;
    const popup = asta.popupAttivo;
    const sq = getSquadraBySocket(asta, socket.id); const admin = isAdmin(asta, socket.id);
    if (!admin && (!sq || sq.nome !== popup.squadraVincitrice)) return;
    const squadra = getSquadra(asta, popup.squadraVincitrice);
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
      else asta.poolGiocatori.push({ id: gId, nome: g.nome, ruolo: g.ruolo || '', tipo: 'NN', costoOriginale: g.prezzo, valore: g.valore || 0, squadraOriginale: null, estratto: false, assegnato: false, scartato: false });
    });
    squadra.crediti += creditiRecuperati;
    assegnaGiocatoreASquadra(asta, popup.giocatore, squadra, popup.prezzoFinale);
    asta.popupAttivo = null;
    asta.storico.push({ giocatore: popup.giocatore, prezzo: popup.prezzoFinale, squadra: popup.squadraVincitrice, tipo: 'con_svincolo', svincolati, timestamp: new Date().toISOString() });
    io.to(astaId).emit('giocatore-assegnato', { giocatore: popup.giocatore, prezzo: popup.prezzoFinale, squadra: popup.squadraVincitrice, tipo: 'con_svincolo' });
    broadcastStato(astaId);
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
    broadcastStato(astaId); socket.emit('tradeoff-ok');
    io.to(astaId).emit('tradeoff-usato', { nomeSquadra: sq.nome, tipo });
  });

  socket.on('admin-update-config', ({ astaId, timerPrimaChiamata, timerRilancio, minimoPortieri, minimoMovimento }) => {
    const asta = aste.get(astaId);
    if (!asta || !isAdmin(asta, socket.id)) return;
    if (timerPrimaChiamata !== undefined) asta.timerPrimaChiamata = Math.max(1, parseInt(timerPrimaChiamata) || asta.timerPrimaChiamata);
    if (timerRilancio !== undefined) asta.timerRilancio = Math.max(1, parseInt(timerRilancio) || asta.timerRilancio);
    if (minimoPortieri !== undefined) asta.minimoPortieri = Math.max(0, parseInt(minimoPortieri) || 0);
    if (minimoMovimento !== undefined) asta.minimoMovimento = Math.max(0, parseInt(minimoMovimento) || 0);
    broadcastStato(astaId);
  });

  socket.on('admin-update-crediti', ({ astaId, squadraNome, crediti }) => {
    const asta = aste.get(astaId);
    if (!asta || !isAdmin(asta, socket.id)) return;
    const sq = getSquadra(asta, squadraNome);
    if (!sq) return socket.emit('errore', { msg: 'Squadra non trovata' });
    sq.crediti = Math.max(0, parseInt(crediti) || 0);
    broadcastStato(astaId);
  });

  socket.on('admin-update-slot', ({ astaId, squadraNome, slotsRIC, slotsPLUS }) => {
    const asta = aste.get(astaId);
    if (!asta || !isAdmin(asta, socket.id)) return;
    const sq = getSquadra(asta, squadraNome);
    if (!sq) return socket.emit('errore', { msg: 'Squadra non trovata' });
    if (slotsRIC !== undefined) sq.slotsRIC = Math.max(0, parseInt(slotsRIC) || 0);
    if (slotsPLUS !== undefined) sq.slotsPLUS = Math.max(0, parseInt(slotsPLUS) || 0);
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
    broadcastStato(astaId); socket.emit('scartati-reintrodotti', { count });
  });

  socket.on('termina-asta', ({ astaId }) => {
    const asta = aste.get(astaId);
    if (!asta || !isAdmin(asta, socket.id)) return;
    clearTimer(astaId); asta.stato = 'completata'; asta.chiamataAttuale = null;
    broadcastStato(astaId, true); io.to(astaId).emit('asta-terminata', { astaId });
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
app.get('/api/asta/:id/backup', (req, res) => {
  const asta = aste.get(req.params.id);
  if (asta) {
    return res.json({ backup: true, timestamp: new Date().toISOString(), asta });
  }
  const file = path.join(BACKUP_DIR, 'backup_asta_' + req.params.id + '.json');
  if (fs.existsSync(file)) {
    try { return res.json(JSON.parse(fs.readFileSync(file, 'utf-8'))); } catch(e) {}
  }
  res.status(404).json({ error: 'Backup non trovato' });
});

app.get('/api/backup-list', (req, res) => {
  try {
    const files = fs.existsSync(BACKUP_DIR)
      ? fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('backup_asta_'))
      : [];
    const list = files.map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, f), 'utf-8'));
        return { id: d.asta.id, nome: d.asta.nome, timestamp: d.timestamp, stato: d.asta.stato };
      } catch(e) { return null; }
    }).filter(Boolean);
    res.json(list);
  } catch(e) { res.json([]); }
});

// Auto-save every 30s
setInterval(() => {
  aste.forEach(asta => { if (asta.stato !== 'attesa') saveBackup(asta); });
}, 30000);

// Load backups at startup
loadBackups();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('\n🎯 Asta FantaSbocchini v2 — Server attivo');
  console.log('   http://localhost:' + PORT + '\n');
});
