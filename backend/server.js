const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use(express.json({ limit: '10mb' }));

// ============ STATE ============
const aste = new Map();
const timers = new Map();

// ============ HELPERS ============
function getSquadra(asta, nome) { return asta.squadre.find(s => s.nome === nome); }
function getSquadraBySocket(asta, socketId) { return asta.squadre.find(s => s.utenti.includes(socketId)); }
function isAdmin(asta, socketId) { return asta.adminSocketIds.includes(socketId); }

function emitToSquadra(astaId, nomeSq, event, data) {
  const asta = aste.get(astaId);
  if (!asta) return;
  const sq = getSquadra(asta, nomeSq);
  if (sq) sq.utenti.forEach(sid => io.to(sid).emit(event, data));
}

function emitToAdmins(astaId, event, data) {
  const asta = aste.get(astaId);
  if (!asta) return;
  asta.adminSocketIds.forEach(sid => io.to(sid).emit(event, data));
}

function broadcastStato(astaId) {
  const asta = aste.get(astaId);
  if (!asta) return;
  // Sanitize: no socket IDs exposed
  const stato = {
    ...asta,
    adminSocketIds: undefined,
    squadre: asta.squadre.map(s => ({
      ...s,
      utenti: undefined,
      numUtenti: s.utenti.length,
      online: s.utenti.length > 0
    }))
  };
  io.to(astaId).emit('stato-asta', stato);
}

// ============ GAME MECHANICS ============

function calcolaMaxOfferta(asta, squadra) {
  if (asta.tipoAsta !== 'riparazione') return squadra.crediti;
  const fattore = asta.fattoreSvincolo || 0.5;
  const svincoliRimanenti = asta.svincoliTotali - (squadra.svincoliUsati || 0);
  if (svincoliRimanenti <= 0) return squadra.crediti;

  const rosaAttuale = squadra.rosa.length;
  const minimoTotale = (asta.minimoPortieri || 0) + (asta.minimoMovimento || 0);
  const slotVuoti = Math.max(0, minimoTotale - rosaAttuale - 1); // -1 per il giocatore che si sta acquistando
  const creditiRiservati = Math.max(0, slotVuoti);

  // Sort by recoverable value desc
  const sorted = [...squadra.rosa].sort((a, b) =>
    Math.floor(b.prezzo * fattore) - Math.floor(a.prezzo * fattore)
  );
  let creditiRecuperabili = 0;
  const maxSvinc = Math.min(svincoliRimanenti, sorted.length);
  for (let i = 0; i < maxSvinc; i++) {
    creditiRecuperabili += Math.floor(sorted[i].prezzo * fattore);
  }
  return Math.max(1, squadra.crediti + creditiRecuperabili - creditiRiservati);
}

function assegnaGiocatoreASquadra(asta, giocatore, squadra, prezzo) {
  giocatore.assegnato = true;
  squadra.rosa.push({ ...giocatore, prezzo, id: giocatore.id });
  squadra.crediti -= prezzo;
}

function avviaChiamata(astaId, giocatore) {
  const asta = aste.get(astaId);
  if (!asta) return;
  giocatore.estratto = true;

  // RIC: offri conferma al proprietario precedente
  if (asta.tipoAsta === 'iniziale' && giocatore.tipo === 'RIC' && giocatore.squadraOriginale) {
    const sqPrec = getSquadra(asta, giocatore.squadraOriginale);
    const haSlot = sqPrec && (sqPrec.slotsRIC - sqPrec.slotsRICUsati) > 0;
    const haCrediti = sqPrec && sqPrec.crediti >= giocatore.costoOriginale;

    if (haSlot && haCrediti) {
      asta.chiamataAttuale = {
        giocatore,
        offertaAttuale: giocatore.costoOriginale,
        squadraOfferente: null,
        proprietarioPrecedente: giocatore.squadraOriginale,
        aspettandoConferma: true,
        proprietarioPrecedenteHaPuntato: false,
        fase: 'conferma',
        timer: 0
      };
      broadcastStato(astaId);
      const popupData = { giocatore, costoConferma: giocatore.costoOriginale, proprietario: giocatore.squadraOriginale };
      emitToSquadra(astaId, giocatore.squadraOriginale, 'popup-ric-conferma', popupData);
      emitToAdmins(astaId, 'popup-ric-conferma-admin', popupData);
      return;
    }
  }

  // Asta normale
  asta.chiamataAttuale = {
    giocatore,
    offertaAttuale: 1,
    squadraOfferente: null,
    proprietarioPrecedente: giocatore.squadraOriginale || null,
    aspettandoConferma: false,
    proprietarioPrecedenteHaPuntato: false,
    fase: 'prima',
    timer: asta.timerPrimaChiamata
  };
  broadcastStato(astaId);
  io.to(astaId).emit('nuova-chiamata', asta.chiamataAttuale);
  startTimer(astaId, 'prima');
}

function scartaGiocatore(astaId) {
  const asta = aste.get(astaId);
  if (!asta || !asta.chiamataAttuale) return;
  const { giocatore } = asta.chiamataAttuale;
  giocatore.estratto = true;
  giocatore.scartato = true;
  asta.storico.push({ giocatore, prezzo: 0, squadra: null, tipo: 'scartato', timestamp: new Date().toISOString() });
  asta.chiamataAttuale = null;
  io.to(astaId).emit('giocatore-scartato', { giocatore });
  broadcastStato(astaId);
}

function chiudiAsta(astaId) {
  const asta = aste.get(astaId);
  if (!asta || !asta.chiamataAttuale) return;
  const chiamata = asta.chiamataAttuale;
  const { giocatore, offertaAttuale, squadraOfferente } = chiamata;

  // RIC/PLUS post-auction mechanics (solo asta iniziale)
  if (asta.tipoAsta === 'iniziale' && giocatore.squadraOriginale && squadraOfferente && squadraOfferente !== giocatore.squadraOriginale) {
    const sqPrec = getSquadra(asta, giocatore.squadraOriginale);
    const prevBid = chiamata.proprietarioPrecedenteHaPuntato;

    if (!prevBid && sqPrec && giocatore.tipo === 'RIC') {
      const hasPLUS = (sqPrec.slotsPLUS - sqPrec.slotsPLUSUsati) > 0;
      const hasRecompra = !sqPrec.recompraUsata;
      if (hasPLUS || hasRecompra) {
        asta.popupAttivo = {
          tipo: 'post-asta-ric',
          giocatore, prezzoFinale: offertaAttuale, squadraVincitrice: squadraOfferente,
          proprietarioPrecedente: giocatore.squadraOriginale,
          opzioni: { plusvalenza: hasPLUS, recompra: hasRecompra }
        };
        asta.chiamataAttuale = null;
        emitToSquadra(astaId, giocatore.squadraOriginale, 'popup-post-asta', asta.popupAttivo);
        emitToAdmins(astaId, 'popup-post-asta-admin', asta.popupAttivo);
        broadcastStato(astaId);
        return;
      }
    }

    if (!prevBid && sqPrec && giocatore.tipo === 'PLUS') {
      const hasPLUS = (sqPrec.slotsPLUS - sqPrec.slotsPLUSUsati) > 0;
      if (hasPLUS) {
        asta.popupAttivo = {
          tipo: 'post-asta-plus',
          giocatore, prezzoFinale: offertaAttuale, squadraVincitrice: squadraOfferente,
          proprietarioPrecedente: giocatore.squadraOriginale,
          opzioni: { plusvalenza: true, recompra: false }
        };
        asta.chiamataAttuale = null;
        emitToSquadra(astaId, giocatore.squadraOriginale, 'popup-post-asta', asta.popupAttivo);
        emitToAdmins(astaId, 'popup-post-asta-admin', asta.popupAttivo);
        broadcastStato(astaId);
        return;
      }
    }
  }

  // Svincolo (riparazione): il vincitore non ha crediti sufficienti
  if (asta.tipoAsta === 'riparazione' && squadraOfferente) {
    const sq = getSquadra(asta, squadraOfferente);
    if (sq && offertaAttuale > sq.crediti) {
      const svincoliRimanenti = asta.svincoliTotali - (sq.svincoliUsati || 0);
      asta.popupAttivo = {
        tipo: 'svincolo',
        giocatore, prezzoFinale: offertaAttuale, squadraVincitrice: squadraOfferente,
        differenza: offertaAttuale - sq.crediti,
        svincoliRimanenti
      };
      asta.chiamataAttuale = null;
      emitToSquadra(astaId, squadraOfferente, 'popup-svincolo', {
        ...asta.popupAttivo,
        rosa: sq.rosa,
        fattoreSvincolo: asta.fattoreSvincolo || 0.5
      });
      emitToAdmins(astaId, 'popup-svincolo-admin', asta.popupAttivo);
      broadcastStato(astaId);
      return;
    }
  }

  // Assegnazione normale
  const sqVincitrice = getSquadra(asta, squadraOfferente);
  if (sqVincitrice) assegnaGiocatoreASquadra(asta, giocatore, sqVincitrice, offertaAttuale);
  asta.storico.push({ giocatore, prezzo: offertaAttuale, squadra: squadraOfferente, tipo: 'normale', timestamp: new Date().toISOString() });
  asta.chiamataAttuale = null;
  io.to(astaId).emit('giocatore-assegnato', { giocatore, prezzo: offertaAttuale, squadra: squadraOfferente, tipo: 'normale' });
  broadcastStato(astaId);
}

// ============ TIMER ============
function startTimer(astaId, fase) {
  clearTimer(astaId);
  const asta = aste.get(astaId);
  if (!asta || !asta.chiamataAttuale) return;
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
      if (fase === 'prima' && !a.chiamataAttuale.squadraOfferente) {
        scartaGiocatore(astaId);
      } else {
        chiudiAsta(astaId);
      }
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

  // Determina fattore svincolo
  const sottoTipo = b.sottoTipoRiparazione || '1';
  const fattoreSvincolo = sottoTipo === '2' ? (1 / 3) : 0.5;

  const asta = {
    id,
    nome: b.nome || 'Asta FantaSbocchini',
    tipoAsta: b.tipoAsta || 'iniziale',
    sottoTipoRiparazione: sottoTipo,
    crediti: b.crediti || 500,
    timerPrimaChiamata: b.timerPrimaChiamata || 7,
    timerRilancio: b.timerRilancio || 5,
    tipoEstrazione: b.tipoEstrazione || 'manuale',
    minimoPortieri: b.minimoPortieri || 1,
    minimoMovimento: b.minimoMovimento || 7,
    svincoliTotali: b.svincoliTotali || 15,
    fattoreSvincolo,
    stato: 'attesa',
    squadre: [],
    adminNome: null,
    adminSocketIds: [],
    poolGiocatori: [],
    chiamataAttuale: null,
    popupAttivo: null,
    storico: [],
    createdAt: new Date().toISOString()
  };

  // Parse squadre da JSON import
  if (b.squadreJson && Array.isArray(b.squadreJson)) {
    b.squadreJson.forEach(sq => {
      const squadra = {
        nome: sq.nome,
        crediti: sq.crediti !== undefined ? sq.crediti : asta.crediti,
        slotsRIC: sq.riconferme || 0,
        slotsRICUsati: 0,
        slotsPLUS: sq.plusvalenze || 0,
        slotsPLUSUsati: 0,
        recompra: 1,
        recompraUsata: false,
        svincoliUsati: sq.svincoliUsati || 0,
        rosa: [],
        utenti: []
      };

      if (sq.giocatori) {
        sq.giocatori.forEach(g => {
          const tipo = g.tipo === 'RIC' ? 'RIC' : g.tipo === 'PLUS' ? 'PLUS' : 'NN';
          asta.poolGiocatori.push({
            id: uuidv4(),
            nome: g.nome,
            ruolo: g.ruolo || '',
            tipo,
            costoOriginale: g.costo || 1,
            squadraOriginale: sq.nome,
            estratto: false,
            assegnato: false,
            scartato: false
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

// Public info endpoint — sanitized, no socket IDs exposed
app.get('/api/asta/:id/info', (req, res) => {
  const asta = aste.get(req.params.id);
  if (!asta) return res.status(404).json({ error: 'Asta non trovata' });
  res.json({
    id: asta.id,
    nome: asta.nome,
    tipoAsta: asta.tipoAsta,
    stato: asta.stato,
    crediti: asta.crediti,
    squadre: asta.squadre.map(s => ({
      nome: s.nome,
      utenti: s.utenti ? s.utenti.length : 0  // count only, no IDs
    }))
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
    lega: 'FantaSbocchini',
    stagione: `${anno}/${anno + 1}`,
    tipoAsta: asta.tipoAsta,
    squadre: asta.squadre.map(s => ({
      nome: s.nome,
      crediti: s.crediti,
      riconferme: Math.max(0, s.slotsRIC - s.slotsRICUsati),
      plusvalenze: Math.max(0, s.slotsPLUS - s.slotsPLUSUsati),
      svincoliUsati: s.svincoliUsati || 0,
      giocatori: s.rosa.map(g => ({
        nome: g.nome,
        ruolo: g.ruolo || '',
        tipo: g.tipo || 'NN',
        costo: g.prezzo
      }))
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

    socket.join(astaId);
    socket.astaId = astaId;
    socket.nomeSquadra = nomeSquadra;

    let squadra = getSquadra(asta, nomeSquadra);
    if (!squadra) {
      squadra = {
        nome: nomeSquadra,
        crediti: asta.crediti,
        slotsRIC: 0, slotsRICUsati: 0,
        slotsPLUS: 0, slotsPLUSUsati: 0,
        recompra: 1, recompraUsata: false,
        svincoliUsati: 0,
        rosa: [], utenti: []
      };
      asta.squadre.push(squadra);
    }
    if (!squadra.utenti.includes(socket.id)) squadra.utenti.push(socket.id);

    // Admin tracking
    if (adminFlag || (asta.adminNome && asta.adminNome === nomeSquadra)) {
      if (!asta.adminSocketIds.includes(socket.id)) asta.adminSocketIds.push(socket.id);
      if (!asta.adminNome) asta.adminNome = nomeSquadra;
    }

    broadcastStato(astaId);

    // Se c'è un popup attivo per questa squadra, reinvialo
    if (asta.popupAttivo && asta.popupAttivo.proprietarioPrecedente === nomeSquadra) {
      if (asta.popupAttivo.tipo === 'post-asta-ric' || asta.popupAttivo.tipo === 'post-asta-plus') {
        socket.emit('popup-post-asta', asta.popupAttivo);
      } else if (asta.popupAttivo.tipo === 'svincolo' && asta.popupAttivo.squadraVincitrice === nomeSquadra) {
        const sq = getSquadra(asta, nomeSquadra);
        socket.emit('popup-svincolo', { ...asta.popupAttivo, rosa: sq ? sq.rosa : [], fattoreSvincolo: asta.fattoreSvincolo || 0.5 });
      }
    }
    if (asta.chiamataAttuale && asta.chiamataAttuale.aspettandoConferma &&
        asta.chiamataAttuale.proprietarioPrecedente === nomeSquadra) {
      socket.emit('popup-ric-conferma', {
        giocatore: asta.chiamataAttuale.giocatore,
        costoConferma: asta.chiamataAttuale.giocatore.costoOriginale,
        proprietario: nomeSquadra
      });
    }
  });

  socket.on('inizia-asta', ({ astaId }) => {
    const asta = aste.get(astaId);
    if (!asta || !isAdmin(asta, socket.id)) return;
    asta.stato = 'in_corso';
    broadcastStato(astaId);
    io.to(astaId).emit('asta-iniziata');
    // Auto-estrai se casuale
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
      giocatore = {
        id: uuidv4(),
        nome: giocatoreManuale.nome,
        ruolo: giocatoreManuale.ruolo || '',
        tipo: 'NN',
        costoOriginale: 1,
        squadraOriginale: null,
        estratto: false, assegnato: false, scartato: false
      };
      asta.poolGiocatori.push(giocatore);
    }
    if (!giocatore) return socket.emit('errore', { msg: 'Giocatore non trovato' });
    avviaChiamata(astaId, giocatore);
  });

  socket.on('rilancio', ({ astaId, offerta }) => {
    const asta = aste.get(astaId);
    if (!asta || !asta.chiamataAttuale || asta.chiamataAttuale.aspettandoConferma) return;

    const sq = getSquadraBySocket(asta, socket.id);
    if (!sq) return socket.emit('errore', { msg: 'Non sei in questa asta' });

    const chiamata = asta.chiamataAttuale;
    offerta = parseInt(offerta);

    if (offerta <= chiamata.offertaAttuale) return socket.emit('errore', { msg: `Offerta deve essere > ${chiamata.offertaAttuale}` });

    // Controlla max
    const maxOff = calcolaMaxOfferta(asta, sq);
    if (offerta > maxOff) return socket.emit('errore', { msg: `Massimo consentito: ${maxOff} crediti` });
    if (asta.tipoAsta === 'iniziale' && offerta > sq.crediti) return socket.emit('errore', { msg: `Crediti insufficienti (hai ${sq.crediti})` });

    if (sq.nome === chiamata.proprietarioPrecedente) chiamata.proprietarioPrecedenteHaPuntato = true;

    chiamata.offertaAttuale = offerta;
    chiamata.squadraOfferente = sq.nome;

    io.to(astaId).emit('aggiorna-offerta', chiamata);

    // Switch to rilancio timer (or reset it)
    resetTimer(astaId, 'rilancio');
  });

  socket.on('risposta-ric-conferma', ({ astaId, risposta }) => {
    const asta = aste.get(astaId);
    if (!asta || !asta.chiamataAttuale || !asta.chiamataAttuale.aspettandoConferma) return;
    const sq = getSquadraBySocket(asta, socket.id);
    const admin = isAdmin(asta, socket.id);
    const chiamata = asta.chiamataAttuale;
    if (!admin && (!sq || sq.nome !== chiamata.proprietarioPrecedente)) return;

    clearTimer(astaId);
    chiamata.aspettandoConferma = false;

    if (risposta === 'si') {
      const squadra = getSquadra(asta, chiamata.proprietarioPrecedente);
      assegnaGiocatoreASquadra(asta, chiamata.giocatore, squadra, chiamata.giocatore.costoOriginale);
      squadra.slotsRICUsati++;
      asta.storico.push({
        giocatore: chiamata.giocatore, prezzo: chiamata.giocatore.costoOriginale,
        squadra: chiamata.proprietarioPrecedente, tipo: 'riconferma', timestamp: new Date().toISOString()
      });
      asta.chiamataAttuale = null;
      io.to(astaId).emit('giocatore-assegnato', {
        giocatore: chiamata.giocatore, prezzo: chiamata.giocatore.costoOriginale,
        squadra: chiamata.proprietarioPrecedente, tipo: 'riconferma'
      });
      broadcastStato(astaId);
      if (asta.tipoEstrazione === 'casuale') {
        setTimeout(() => {
          const disp = asta.poolGiocatori.filter(g => !g.estratto && !g.assegnato && !g.scartato);
          if (disp.length > 0) avviaChiamata(astaId, disp[Math.floor(Math.random() * disp.length)]);
        }, 2000);
      }
    } else {
      chiamata.offertaAttuale = 1;
      chiamata.squadraOfferente = null;
      io.to(astaId).emit('nuova-chiamata', chiamata);
      broadcastStato(astaId);
      startTimer(astaId, 'prima');
    }
  });

  socket.on('risposta-post-asta', ({ astaId, scelta }) => {
    const asta = aste.get(astaId);
    if (!asta || !asta.popupAttivo) return;
    const popup = asta.popupAttivo;
    const sq = getSquadraBySocket(asta, socket.id);
    const admin = isAdmin(asta, socket.id);
    if (!admin && (!sq || sq.nome !== popup.proprietarioPrecedente)) return;

    asta.popupAttivo = null;
    const { giocatore, prezzoFinale, squadraVincitrice } = popup;
    const sqPrec = getSquadra(asta, popup.proprietarioPrecedente);
    const sqVinc = getSquadra(asta, squadraVincitrice);

    if (scelta === 'plusvalenza' && sqPrec) {
      assegnaGiocatoreASquadra(asta, giocatore, sqVinc, prezzoFinale);
      const guadagno = Math.max(0, prezzoFinale - giocatore.costoOriginale);
      sqPrec.crediti += guadagno;
      sqPrec.slotsPLUSUsati++;
      asta.storico.push({ giocatore, prezzo: prezzoFinale, squadra: squadraVincitrice, tipo: 'plusvalenza', plusvalenzaA: popup.proprietarioPrecedente, guadagno, timestamp: new Date().toISOString() });
      io.to(astaId).emit('giocatore-assegnato', { giocatore, prezzo: prezzoFinale, squadra: squadraVincitrice, tipo: 'plusvalenza', guadagno, plusvalenzaA: popup.proprietarioPrecedente });

    } else if (scelta === 'recompra' && sqPrec) {
      const prezzoRecompra = prezzoFinale + 1;
      assegnaGiocatoreASquadra(asta, giocatore, sqPrec, prezzoRecompra);
      sqPrec.recompraUsata = true;
      asta.storico.push({ giocatore, prezzo: prezzoRecompra, squadra: popup.proprietarioPrecedente, tipo: 'recompra', timestamp: new Date().toISOString() });
      io.to(astaId).emit('giocatore-assegnato', { giocatore, prezzo: prezzoRecompra, squadra: popup.proprietarioPrecedente, tipo: 'recompra' });

    } else { // niente
      assegnaGiocatoreASquadra(asta, giocatore, sqVinc, prezzoFinale);
      asta.storico.push({ giocatore, prezzo: prezzoFinale, squadra: squadraVincitrice, tipo: 'normale', timestamp: new Date().toISOString() });
      io.to(astaId).emit('giocatore-assegnato', { giocatore, prezzo: prezzoFinale, squadra: squadraVincitrice, tipo: 'normale' });
    }

    broadcastStato(astaId);
    if (asta.tipoEstrazione === 'casuale') {
      setTimeout(() => {
        const disp = asta.poolGiocatori.filter(g => !g.estratto && !g.assegnato && !g.scartato);
        if (disp.length > 0) avviaChiamata(astaId, disp[Math.floor(Math.random() * disp.length)]);
      }, 2000);
    }
  });

  socket.on('esegui-svincolo', ({ astaId, giocatoriIds }) => {
    const asta = aste.get(astaId);
    if (!asta || !asta.popupAttivo || asta.popupAttivo.tipo !== 'svincolo') return;
    const popup = asta.popupAttivo;
    const sq = getSquadraBySocket(asta, socket.id);
    const admin = isAdmin(asta, socket.id);
    if (!admin && (!sq || sq.nome !== popup.squadraVincitrice)) return;

    const squadra = getSquadra(asta, popup.squadraVincitrice);
    const fattore = asta.fattoreSvincolo || 0.5;
    let creditiRecuperati = 0;
    const svincolati = [];

    giocatoriIds.forEach(gId => {
      const idx = squadra.rosa.findIndex(g => g.id === gId);
      if (idx === -1) return;
      const g = squadra.rosa.splice(idx, 1)[0];
      const credRecup = Math.floor(g.prezzo * fattore);
      creditiRecuperati += credRecup;
      svincolati.push({ ...g, creditiRecuperati: credRecup });
      squadra.svincoliUsati = (squadra.svincoliUsati || 0) + 1;

      // Reintroduci nel pool
      const gPool = asta.poolGiocatori.find(p => p.id === gId);
      if (gPool) { gPool.estratto = false; gPool.assegnato = false; gPool.scartato = false; }
      else asta.poolGiocatori.push({ id: gId, nome: g.nome, ruolo: g.ruolo || '', tipo: 'NN', costoOriginale: g.prezzo, squadraOriginale: null, estratto: false, assegnato: false, scartato: false });
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

    const ricDisp = sq.slotsRIC - sq.slotsRICUsati;
    const plusDisp = sq.slotsPLUS - sq.slotsPLUSUsati;
    const ricTrad = Math.max(0, ricDisp - 1);
    const plusTrad = Math.max(0, plusDisp - 1);

    switch (tipo) {
      case 'ric-to-plus':
        if (ricTrad < 1) return socket.emit('errore', { msg: 'Nessun slot RIC cedibile (proteggi il 1°)' });
        sq.slotsRIC--; sq.slotsPLUS += 2; break;
      case 'plus-to-ric':
        if (plusTrad < 3) return socket.emit('errore', { msg: 'Servono almeno 3 slot PLUS cedibili' });
        sq.slotsPLUS -= 3; sq.slotsRIC++; break;
      case 'ric-to-crediti':
        if (ricTrad < 1) return socket.emit('errore', { msg: 'Nessun slot RIC cedibile (proteggi il 1°)' });
        sq.slotsRIC--; sq.crediti += 12; break;
      case 'plus-to-crediti':
        if (plusTrad < 1) return socket.emit('errore', { msg: 'Nessun slot PLUS cedibile (proteggi il 1°)' });
        sq.slotsPLUS--; sq.crediti += 6; break;
      default: return socket.emit('errore', { msg: 'Tipo trade-off non valido' });
    }

    broadcastStato(astaId);
    socket.emit('tradeoff-ok');
  });

  socket.on('annulla-assegnazione', ({ astaId }) => {
    const asta = aste.get(astaId);
    if (!asta || !isAdmin(asta, socket.id)) return;
    if (!asta.storico.length) return socket.emit('errore', { msg: 'Nessuna assegnazione da annullare' });

    const ultima = asta.storico.pop();
    if (ultima.tipo === 'scartato') {
      const g = asta.poolGiocatori.find(p => p.id === ultima.giocatore.id || p.nome === ultima.giocatore.nome);
      if (g) { g.estratto = false; g.scartato = false; }
    } else {
      const sq = getSquadra(asta, ultima.squadra);
      if (sq) {
        sq.crediti += ultima.prezzo;
        const idx = sq.rosa.findIndex(g => g.id === ultima.giocatore.id || g.nome === ultima.giocatore.nome);
        if (idx !== -1) sq.rosa.splice(idx, 1);
        // Gestisci slot
        if (ultima.tipo === 'riconferma') sq.slotsRICUsati = Math.max(0, sq.slotsRICUsati - 1);
        if (ultima.tipo === 'plusvalenza') {
          sq.slotsPLUSUsati = Math.max(0, sq.slotsPLUSUsati - 1);
          const sqPrec = getSquadra(asta, ultima.plusvalenzaA);
          if (sqPrec) sqPrec.crediti -= (ultima.guadagno || 0);
        }
        if (ultima.tipo === 'recompra') sq.recompraUsata = false;
      }
      const g = asta.poolGiocatori.find(p => p.id === ultima.giocatore.id || p.nome === ultima.giocatore.nome);
      if (g) { g.estratto = false; g.assegnato = false; g.scartato = false; }
    }

    broadcastStato(astaId);
    io.to(astaId).emit('assegnazione-annullata', ultima);
  });

  socket.on('reintroduci-scartati', ({ astaId }) => {
    const asta = aste.get(astaId);
    if (!asta || !isAdmin(asta, socket.id)) return;
    let count = 0;
    asta.poolGiocatori.forEach(g => {
      if (g.scartato) { g.scartato = false; g.estratto = false; count++; }
    });
    broadcastStato(astaId);
    socket.emit('scartati-reintrodotti', { count });
  });

  socket.on('termina-asta', ({ astaId }) => {
    const asta = aste.get(astaId);
    if (!asta || !isAdmin(asta, socket.id)) return;
    clearTimer(astaId);
    asta.stato = 'completata';
    asta.chiamataAttuale = null;
    broadcastStato(astaId);
    io.to(astaId).emit('asta-terminata', { astaId });
  });

  socket.on('modifica-timer', ({ astaId, timerPrimaChiamata, timerRilancio }) => {
    const asta = aste.get(astaId);
    if (!asta || !isAdmin(asta, socket.id)) return;
    if (timerPrimaChiamata > 0) asta.timerPrimaChiamata = parseInt(timerPrimaChiamata);
    if (timerRilancio > 0) asta.timerRilancio = parseInt(timerRilancio);
    broadcastStato(astaId);
  });

  socket.on('disconnect', () => {
    console.log(`[WS] Disconnesso: ${socket.id}`);
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

// ============ START ============
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎯 Asta FantaSbocchini — Server attivo`);
  console.log(`   http://localhost:${PORT}\n`);
});
