// ASTA FANTASBOCCHINI — CLIENT v2
const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000
});

const S = {
  astaId: null, miaSquadra: null, isAdmin: false, asta: null,
  filtroRuolo: 'tutti', svincoloSel: new Set(), popupAttivoCli: null,
  attesaConferma: false, timerTotal: 30
};

// ══ SOUND SYSTEM ════════════════════════
let _audioCtx = null;
function _initAudio() { if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
function _beep(freq, dur, type, vol) {
  type = type || 'sine'; vol = vol || 0.3;
  try {
    _initAudio();
    const o = _audioCtx.createOscillator(), g = _audioCtx.createGain();
    o.connect(g); g.connect(_audioCtx.destination);
    o.frequency.value = freq; o.type = type;
    g.gain.setValueAtTime(vol, _audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + dur);
    o.start(); o.stop(_audioCtx.currentTime + dur);
  } catch(e) {}
}
function playSound(t) {
  if (localStorage.getItem('suoni') === '0') return;
  if (t === 'tick')     _beep(800,  0.1,  'square',   0.15);
  else if (t === 'rilancio') _beep(1200, 0.15, 'sine',  0.3);
  else if (t === 'buzzer')   _beep(200,  0.5,  'sawtooth', 0.4);
  else if (t === 'chaching') {
    _beep(880,  0.1,  'sine', 0.4);
    setTimeout(() => _beep(1320, 0.15, 'sine', 0.3),  100);
    setTimeout(() => _beep(1760, 0.2,  'sine', 0.25), 200);
  }
}
window.toggleSuoni = function() {
  const on = localStorage.getItem('suoni') !== '0';
  localStorage.setItem('suoni', on ? '0' : '1');
  const btn = document.getElementById('btn-sound');
  if (btn) { btn.textContent = on ? '🔇' : '🔊'; btn.classList.toggle('muted', on); }
};



// ══ SESSION PERSISTENCE ══════════════════
function salvaSessione() {
  if (!S.astaId || !S.miaSquadra) return;
  localStorage.setItem('asta_session', JSON.stringify({
    astaId: S.astaId, nomeSquadra: S.miaSquadra, isAdmin: S.isAdmin
  }));
}
function cancSessione() { localStorage.removeItem('asta_session'); }
function getSessione() {
  try { return JSON.parse(localStorage.getItem('asta_session') || 'null'); } catch(e) { return null; }
}

// ══ STATO LOCALE ═════════════════════════
function salvaStatoLocale(asta) {
  if (!asta || !asta.id) return;
  try {
    localStorage.setItem('asta_stato_' + asta.id,
      JSON.stringify({ timestamp: new Date().toISOString(), asta }));
  } catch(e) {}
}
function getStatoLocale(id) {
  try { return JSON.parse(localStorage.getItem('asta_stato_' + (id || S.astaId)) || 'null'); } catch(e) { return null; }
}

// ══ EMERGENCY / DISCONNECT ═══════════════
function mostraEmergenza() {
  const el = document.getElementById('screen-emergenza');
  if (el) el.classList.remove('hidden');
}
function nascondiEmergenza() {
  const el = document.getElementById('screen-emergenza');
  if (el) el.classList.add('hidden');
}

// ══ BACKUP DOWNLOAD ══════════════════════
window.downloadBackupJSON = function(fromLocal) {
  let data;
  if (fromLocal || !S.asta) {
    const saved = getStatoLocale();
    if (!saved) return toast('Nessun backup locale disponibile', 'error');
    data = saved;
  } else {
    data = { backup: true, timestamp: new Date().toISOString(), asta: S.asta };
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.href = url; a.download = 'backup-asta-' + ts + '.json';
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  const bm = document.getElementById('backup-menu');
  if (bm) bm.classList.add('hidden');
};

window.downloadBackupExcel = function() {
  const asta = S.asta;
  if (!asta) return toast('Nessun dato disponibile', 'error');
  const XLSX = window.XLSX;
  if (!XLSX) return toast('Libreria Excel non disponibile', 'error');
  const wb = XLSX.utils.book_new();
  // Foglio 1: Riepilogo
  const riepilogo = asta.squadre.map(sq => ({
    'Squadra': sq.nome, 'Crediti': sq.crediti,
    'Giocatori': (sq.rosa||[]).length,
    'Slot RIC usati': sq.slotsRICUsati||0, 'Slot RIC tot': sq.slotsRIC||0,
    'Slot PLUS usati': sq.slotsPLUSUsati||0, 'Slot PLUS tot': sq.slotsPLUS||0,
    'Recompra usata': sq.recompraUsata ? 'Sì' : 'No'
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(riepilogo), 'Riepilogo');
  // Foglio 2: Rose
  const roseRows = [];
  asta.squadre.forEach(sq => (sq.rosa||[]).forEach(g => {
    roseRows.push({ 'Squadra': sq.nome, 'Giocatore': g.nome, 'Ruolo': g.ruolo||'?', 'Prezzo': g.prezzo, 'Tipo': g.tipo||'normale' });
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(roseRows.length ? roseRows : [{}]), 'Rose');
  // Foglio 3: Storico
  const storico = (asta.storico||[]).map((s,i) => ({
    '#': i+1, 'Giocatore': s.giocatore ? s.giocatore.nome : '?',
    'Ruolo': s.giocatore ? (s.giocatore.ruolo||'?') : '?',
    'Prezzo': s.prezzo, 'Squadra': s.squadra||'', 'Tipo': s.tipo||''
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(storico.length ? storico : [{}]), 'Storico');
  // Foglio 4: Liberi
  const liberi = (asta.poolGiocatori||[])
    .filter(g => !g.assegnato && !g.scartato)
    .map(g => ({ 'Giocatore': g.nome, 'Ruolo': g.ruolo||'?', 'Costo': g.costoOriginale, 'Tipo': g.tipo||'NN', 'Squadra orig.': g.squadraOriginale||'' }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(liberi.length ? liberi : [{}]), 'Liberi');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  XLSX.writeFile(wb, 'backup-asta-' + ts + '.xlsx');
  const bm = document.getElementById('backup-menu');
  if (bm) bm.classList.add('hidden');
};

window.downloadBackupEmergenza = function() { downloadBackupJSON(true); };

window.apriMenuBackup = function() {
  const bm = document.getElementById('backup-menu');
  if (bm) bm.classList.toggle('hidden');
};

window.esciDallAsta = function() {
  if (!confirm("Vuoi uscire dall'asta? I dati rimarranno sul server.")) return;
  cancSessione();
  socket.disconnect();
  showScreen('screen-home');
  S.astaId = null; S.miaSquadra = null; S.isAdmin = false; S.asta = null;
  history.replaceState({}, '', '/');
  setTimeout(() => socket.connect(), 500);
};

// ══ RECONNECTION HANDLERS ════════════════
socket.on('connect', () => {
  nascondiEmergenza();
  // Already have an active in-memory session (e.g. reconnect mid-asta): rejoin immediately
  if (S.astaId && S.miaSquadra) {
    socket.emit('join-asta', { astaId: S.astaId, nomeSquadra: S.miaSquadra, isAdmin: S.isAdmin });
    return;
  }
  // Fresh page load: restore any saved session from localStorage and rejoin proactively,
  // regardless of which screen the static HTML marks as active by default.
  const sess = getSessione();
  if (sess && sess.astaId && sess.nomeSquadra) {
    S.astaId = sess.astaId;
    S.miaSquadra = sess.nomeSquadra;
    S.isAdmin = !!sess.isAdmin;
    document.getElementById('lobby-info-asta').textContent = 'Connessione in corso...';
    showScreen('screen-lobby');
    socket.emit('join-asta', { astaId: S.astaId, nomeSquadra: S.miaSquadra, isAdmin: S.isAdmin });
  }
});

socket.on('disconnect', (reason) => {
  if (reason === 'io client disconnect') return; // voluntary exit
  const schermataAsta = document.getElementById('screen-asta');
  const inAsta = schermataAsta && schermataAsta.classList.contains('active');
  if (S.astaId && inAsta) {
    mostraEmergenza();
  }
  if (inAsta) toast('Connessione persa — riconnessione...', 'error');
});

socket.on('reconnect', () => {
  nascondiEmergenza();
  toast('Riconnesso!', 'success');
  // Re-join only if actually in an asta session
  if (S.astaId && S.miaSquadra && S.asta) {
    socket.emit('join-asta', { astaId: S.astaId, nomeSquadra: S.miaSquadra, isAdmin: S.isAdmin });
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (id) {
    document.getElementById('inp-join-id').value = id;
    setTimeout(() => fetchAstaSquadrePerJoin(id), 300);
  }
  // Restore session hint (pre-fill join field if no ID in URL)
  const sess = getSessione();
  if (sess && sess.astaId && !id) {
    document.getElementById('inp-join-id').value = sess.astaId;
    history.replaceState({}, '', '/?id=' + sess.astaId);
    setTimeout(() => fetchAstaSquadrePerJoin(sess.astaId), 400);
  }
  setupHome(); setupLobby(); setupAsta(); setupFilters(); setupTabs();
  // Warn before leaving page if in active asta
  window.addEventListener('beforeunload', (e) => {
    if (S.astaId && S.asta && S.asta.stato === 'in_corso') {
      e.preventDefault(); e.returnValue = '';
    }
  });
});

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

// ════ HOME ════════════════════════════════════

// Fetch squads from the asta and show dropdown
let _joinAstaInfo = null; // caches last fetched asta info (id + adminNome) for the join form
async function fetchAstaSquadrePerJoin(rawId) {
  if (!rawId) return;
  let astaId = rawId.trim();
  if (astaId.includes('id=')) {
    try { astaId = new URL(astaId, window.location.origin).searchParams.get('id'); } catch(e) {}
  }
  if (astaId.length < 8) return;
  const infoEl = document.getElementById('inp-join-asta-info');
  const wrap = document.getElementById('inp-join-nome-wrap');
  try {
    const res = await fetch('/api/asta/' + astaId + '/info');
    if (!res.ok) {
      infoEl.style.display = 'none';
      wrap.innerHTML = '<input type="text" id="inp-join-nome" placeholder="Es: FC Sbocchini">';
      return;
    }
    const asta = await res.json();
    _joinAstaInfo = { astaId, adminNome: asta.adminNome || null };
    if (asta.squadre && asta.squadre.length > 0) {
      // Show dropdown with team names
      const sel = document.createElement('select');
      sel.id = 'inp-join-nome';
      sel.innerHTML = '<option value="">— Scegli la tua squadra —</option>';
      asta.squadre.forEach(sq => {
        const opt = document.createElement('option');
        opt.value = sq.nome;
        const nConn = typeof sq.utenti === 'number' ? sq.utenti : (sq.utenti ? sq.utenti.length : 0);
        opt.textContent = sq.nome + (nConn > 0 ? ' (' + nConn + ' connesso/i)' : '');
        sel.appendChild(opt);
      });
      // Free text option
      const optAlt = document.createElement('option');
      optAlt.value = '__altro__';
      optAlt.textContent = '➕ Altro nome...';
      sel.appendChild(optAlt);
      sel.addEventListener('change', () => {
        if (sel.value === '__altro__') {
          wrap.innerHTML = '<input type="text" id="inp-join-nome" placeholder="Es: FC Sbocchini" autofocus>';
          wrap.querySelector('input').focus();
        }
      });
      wrap.innerHTML = '';
      wrap.appendChild(sel);
      infoEl.textContent = '🏟️ ' + (asta.nome || 'Asta') + ' · ' + asta.squadre.length + ' squadre';
      infoEl.style.display = 'block';
    } else {
      // No pre-defined squads — free text
      wrap.innerHTML = '<input type="text" id="inp-join-nome" placeholder="Es: FC Sbocchini">';
      infoEl.textContent = '🏟️ ' + (asta.nome || 'Asta trovata');
      infoEl.style.display = 'block';
    }
  } catch(e) {
    infoEl.style.display = 'none';
  }
}

function setupHome() {
  const inpTipo = document.getElementById('inp-tipo-asta');
  inpTipo.addEventListener('change', () => {
    document.getElementById('row-sottotipo').style.display = inpTipo.value === 'riparazione' ? 'flex' : 'none';
  });
  const drop = document.getElementById('file-drop');
  const inpJson = document.getElementById('inp-json');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('dragover'); handleJsonFile(e.dataTransfer.files[0]); });
  inpJson.addEventListener('change', () => handleJsonFile(inpJson.files[0]));

  document.getElementById('form-crea-asta').addEventListener('submit', async (e) => {
    e.preventDefault();
    const adminNome = document.getElementById('inp-admin-nome').value.trim();
    if (!adminNome) return toast('Inserisci il tuo nome squadra', 'error');
    const body = {
      nome: document.getElementById('inp-nome').value,
      tipoAsta: document.getElementById('inp-tipo-asta').value,
      sottoTipoRiparazione: document.getElementById('inp-sotto-tipo').value,
      crediti: parseInt(document.getElementById('inp-crediti').value),
      numeroPartecipanti: parseInt(document.getElementById('inp-num-partecipanti').value) || 12,
      timerPrimaChiamata: parseInt(document.getElementById('inp-timer-prima').value),
      timerRilancio: parseInt(document.getElementById('inp-timer-rilancio').value),
      tipoEstrazione: document.getElementById('inp-estrazione').value,
      minimoPortieri: parseInt(document.getElementById('inp-min-por').value),
      minimoMovimento: parseInt(document.getElementById('inp-min-mov').value),
      svincoliTotali: parseInt(document.getElementById('inp-svincoli').value) || 15,
      squadreJson: window._jsonData ? window._jsonData.squadre : null
    };
    try {
      const res = await fetch('/api/asta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.success) {
        S.astaId = data.astaId; S.miaSquadra = adminNome; S.isAdmin = true;
        socket.emit('join-asta', { astaId: S.astaId, nomeSquadra: S.miaSquadra, isAdmin: true }); salvaSessione();
        showScreen('screen-lobby');
        const link = window.location.origin + '/?id=' + S.astaId;
        document.getElementById('lobby-link').textContent = link;
        document.getElementById('lobby-info-asta').textContent = body.nome + ' — ' + (body.tipoAsta === 'iniziale' ? 'Iniziale' : 'Riparazione');
        document.getElementById('lobby-admin-box').classList.remove('hidden');
        document.getElementById('lobby-wait-msg').classList.add('hidden');
        history.replaceState({}, '', '/?id=' + S.astaId);
      }
    } catch (err) { toast('Errore nella creazione', 'error'); }
  });

  // Debounced auto-fetch squads when asta ID is typed
  let _debounceJoin;
  document.getElementById('inp-join-id').addEventListener('input', (e) => {
    clearTimeout(_debounceJoin);
    _debounceJoin = setTimeout(() => fetchAstaSquadrePerJoin(e.target.value), 600);
  });

  document.getElementById('btn-join').addEventListener('click', () => {
    let input = document.getElementById('inp-join-id').value.trim();
    let nome = document.getElementById('inp-join-nome').value.trim();
    if (nome === '__altro__') nome = '';
    if (!input || !nome) return toast('Compila tutti i campi', 'error');
    if (input.includes('id=')) {
      try { input = new URL(input, window.location.origin).searchParams.get('id'); } catch(e) {}
    }
    // Determine real admin status: either we already know it from a saved session,
    // or by comparing the chosen team name against the asta's known adminNome.
    const sessPrev = getSessione();
    const isAdminReale = !!(
      (sessPrev && sessPrev.astaId === input && sessPrev.nomeSquadra === nome && sessPrev.isAdmin) ||
      (_joinAstaInfo && _joinAstaInfo.astaId === input && _joinAstaInfo.adminNome && _joinAstaInfo.adminNome === nome)
    );
    S.astaId = input; S.miaSquadra = nome; S.isAdmin = isAdminReale; S.asta = null;
    socket.emit('join-asta', { astaId: S.astaId, nomeSquadra: S.miaSquadra, isAdmin: isAdminReale }); salvaSessione();
    showScreen('screen-lobby');
    document.getElementById('lobby-info-asta').textContent = 'Connessione in corso...';
    history.replaceState({}, '', '/?id=' + S.astaId);
  });
}

function aggiornaAdminNomeDropdown(data) {
  const wrap = document.getElementById('inp-admin-nome-wrap');
  if (!wrap || !data || !data.squadre || data.squadre.length === 0) return;
  const sel = document.createElement('select');
  sel.id = 'inp-admin-nome'; sel.required = true;
  sel.innerHTML = '<option value="">— Seleziona la tua squadra —</option>';
  data.squadre.forEach(sq => {
    const opt = document.createElement('option');
    opt.value = sq.nome; opt.textContent = sq.nome;
    sel.appendChild(opt);
  });
  wrap.innerHTML = ''; wrap.appendChild(sel);
}

function handleJsonFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      window._jsonData = data;
      renderJsonPreview(data);
      document.getElementById('file-drop-label').textContent = '✅ ' + file.name + ' caricato';
      toast('JSON caricato: ' + (data.squadre ? data.squadre.length : 0) + ' squadre', 'success');
      aggiornaAdminNomeDropdown(data);
    } catch (err) { toast('File JSON non valido', 'error'); }
  };
  reader.readAsText(file);
}

function renderJsonPreview(data) {
  const box = document.getElementById('json-preview');
  if (!data.squadre) { box.classList.add('hidden'); return; }
  box.innerHTML = '<strong>Squadre rilevate (' + data.squadre.length + '):</strong>' +
    data.squadre.map(s => '<div class="sq-item"><span class="sq-nome">' + s.nome + '</span>' +
      '<span>Gic:' + (s.giocatori ? s.giocatori.length : 0) + ' RIC:' + (s.riconferme||0) + ' PLUS:' + (s.plusvalenze||0) + ' | SlotRIC:' + (s.slotRiconferme||0) + ' SlotPLUS:' + (s.slotPlusvalenze||0) + ' | ' + (s.crediti||500) + 'cr</span></div>').join('');
  box.classList.remove('hidden');
}

// ════ LOBBY ═══════════════════════════════════
function setupLobby() {
  document.getElementById('btn-copy-link').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('lobby-link').textContent).then(() => {
      document.getElementById('btn-copy-link').textContent = '✅ Copiato!';
      setTimeout(() => document.getElementById('btn-copy-link').textContent = '📋 Copia', 2000);
    });
  });
  document.getElementById('btn-inizia-asta').addEventListener('click', () => {
    socket.emit('inizia-asta', { astaId: S.astaId });
  });
}

// ════ ASTA SETUP ══════════════════════════════
function setupAsta() {
  // 🔥 RILANCIA sempre +1 rispetto all'offerta attuale
  document.getElementById('btn-rilancio').addEventListener('click', () => inviaRilancioRapido(1));
  // Quick bid: somma direttamente all'offerta attuale
  document.getElementById('btn-quick-5').addEventListener('click', () => inviaRilancioRapido(5));
  document.getElementById('btn-quick-10').addEventListener('click', () => inviaRilancioRapido(10));
  // Offerta manuale: importo esatto scritto dall'utente
  const btnManuale = document.getElementById('btn-rilancio-manuale');
  if (btnManuale) btnManuale.addEventListener('click', inviaRilancioManuale);
  const inpManuale = document.getElementById('inp-rilancio-manuale');
  if (inpManuale) inpManuale.addEventListener('keydown', e => { if (e.key === 'Enter') inviaRilancioManuale(); });

  document.getElementById('btn-estrai').addEventListener('click', () => socket.emit('estrai-giocatore', { astaId: S.astaId }));
  document.getElementById('btn-chiama-manuale').addEventListener('click', () => apriModalChiamaManuale());
  document.getElementById('btn-annulla').addEventListener('click', () => apriModalAnnullaStorico());

  // Conferma / Riapri
  document.getElementById('btn-conferma-assegnazione').addEventListener('click', () => {
    socket.emit('conferma-assegnazione', { astaId: S.astaId }); nascondiConfermaBox();
  });
  document.getElementById('btn-riapri-da-prezzo').addEventListener('click', () => {
    socket.emit('riapri-asta', { astaId: S.astaId, tipo: 'da-prezzo' }); nascondiConfermaBox();
  });
  document.getElementById('btn-riapri-da-uno').addEventListener('click', () => {
    socket.emit('riapri-asta', { astaId: S.astaId, tipo: 'da-uno' }); nascondiConfermaBox();
  });
  document.getElementById('btn-reintroduci').addEventListener('click', () => socket.emit('reintroduci-scartati', { astaId: S.astaId }));
  document.getElementById('btn-mod-timer').addEventListener('click', () => {
    if (S.asta) {
      document.getElementById('inp-mt-prima').value = S.asta.timerPrimaChiamata;
      document.getElementById('inp-mt-rilancio').value = S.asta.timerRilancio;
    }
    openModal('modal-mod-timer');
  });
  document.getElementById('btn-termina').addEventListener('click', () => {
    if (confirm('Terminare l\'asta?')) socket.emit('termina-asta', { astaId: S.astaId });
  });
  document.getElementById('btn-tradeoff').addEventListener('click', () => {
    const sq = getMiaSquadra();
    if (sq) {
      document.getElementById('to-slot-info').textContent = 'RIC disp: ' + (sq.slotsRIC - sq.slotsRICUsati) + ' | PLUS disp: ' + (sq.slotsPLUS - sq.slotsPLUSUsati) + ' (1° protetto)';
      updateTradeoffButtons(sq);
    }
    openModal('modal-tradeoff');
  });
  document.getElementById('btn-mia-rosa').addEventListener('click', () => {
    const sq = getMiaSquadra();
    if (sq) renderMiaRosa(sq);
    openModal('modal-mia-rosa');
  });
  document.getElementById('btn-export-json').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/asta/' + S.astaId + '/export');
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'asta-export.json';
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
      toast('JSON esportato!', 'success');
    } catch(e) { toast('Errore export', 'error'); }
  });
}


function inviaRilancioRapido(inc) {
  if (!S.asta || !S.asta.chiamataAttuale) return;
  if (!canBid()) return;
  socket.emit('rilancio', { astaId: S.astaId, offerta: S.asta.chiamataAttuale.offertaAttuale + inc });
}

function inviaRilancioManuale() {
  if (!S.asta || !S.asta.chiamataAttuale) return;
  if (!canBid()) return;
  const inp = document.getElementById('inp-rilancio-manuale');
  if (!inp) return;
  const val = parseInt(inp.value, 10);
  if (isNaN(val) || val <= 0) { toast('Inserisci un importo valido', 'error'); return; }
  socket.emit('rilancio', { astaId: S.astaId, offerta: val });
  inp.value = '';
}

function aggiornaQuickBids() {
  const canB = canBid();
  ['btn-quick-5','btn-quick-10'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !canB;
  });
  const btn = document.getElementById('btn-rilancio');
  if (btn) btn.disabled = !canB;
  const btnM = document.getElementById('btn-rilancio-manuale');
  if (btnM) btnM.disabled = !canB;
  const inpM = document.getElementById('inp-rilancio-manuale');
  if (inpM) inpM.disabled = !canB;
}

function nascondiConfermaBox() {
  S.attesaConferma = false;
  const cb = document.getElementById('admin-conferma-box');
  const ab = document.getElementById('admin-actions-box');
  if (cb) cb.classList.add('hidden');
  if (ab) ab.classList.remove('hidden');
}

function apriModalAnnullaStorico() {
  const asta = S.asta; if (!asta) return;
  const lista = document.getElementById('annulla-storico-lista');
  const items = (asta.storico || []).filter(s => s.tipo !== 'scartato');
  if (!items.length) {
    lista.innerHTML = '<p class="text-muted">Nessuna assegnazione da annullare</p>';
  } else {
    lista.innerHTML = [...items].reverse().map((item, i) => {
      const realIdx = asta.storico.lastIndexOf(item);
      const rb = item.giocatore.ruolo ? '<span class="storico-ruolo ruolo-' + item.giocatore.ruolo + '">' + item.giocatore.ruolo + '</span>' : '';
      return '<div class="annulla-item">' + rb +
        '<span class="annulla-nome">' + item.giocatore.nome + '</span>' +
        '<span class="annulla-sq">' + item.squadra + '</span>' +
        '<span class="annulla-prezzo">' + item.prezzo + 'cr</span>' +
        '<span class="storico-tipo tipo-tag-' + item.tipo + '">' + item.tipo + '</span>' +
        '<button class="btn btn-danger btn-small" onclick="annullaSpecifica(' + realIdx + ')">Annulla</button>' +
        '</div>';
    }).join('');
  }
  openModal('modal-annulla-storico');
}

window.annullaSpecifica = function(index) {
  if (!confirm('Annullare questa assegnazione?')) return;
  socket.emit('annulla-assegnazione-specifica', { astaId: S.astaId, index });
  closeModal();
};

function setupFilters() {
  document.querySelectorAll('.filtro-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filtro-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      S.filtroRuolo = btn.dataset.ruolo;
      if (S.asta) renderGiocatoriLiberi(S.asta.poolGiocatori);
    });
  });
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });
  // Live search on Enter
  const rCerca = document.getElementById('rose-cerca');
  if (rCerca) rCerca.addEventListener('keydown', e => { if (e.key === 'Enter') aggiornaFiltroRose(); });

  // Rose footer actions — bottoni admin rapidi (sempre visibili, floating)
  const btnRoseChiama = document.getElementById('btn-rose-chiama');
  if (btnRoseChiama) btnRoseChiama.addEventListener('click', () => {
    if (!S.isAdmin) return toast("Solo l'admin può chiamare", "error");
    if (S.asta && S.asta.chiamataAttuale) return toast('Chiamata già in corso', 'error');
    apriModalChiamaManuale();
  });
  const btnRoseAssegna = document.getElementById('btn-rose-assegna');
  if (btnRoseAssegna) btnRoseAssegna.addEventListener('click', () => {
    if (!S.isAdmin) return toast("Solo l'admin può assegnare", "error");
    if (S.asta && S.asta.chiamataAttuale) return toast('Chiamata già in corso', 'error');
    apriModalAssegnaManuale();
  });
}

// ════ SOCKET EVENTS ═══════════════════════════
socket.on('stato-asta', (asta) => {
  S.asta = asta;
  salvaStatoLocale(asta);
  // Item 6 fix: auto-hide admin popup-override-box as soon as the pending
  // popup/conferma is resolved server-side (by EITHER admin or the user),
  // instead of relying only on the admin's own manual click.
  if (!asta.popupAttivo && !(asta.chiamataAttuale && asta.chiamataAttuale.aspettandoConferma)) {
    const pob = document.getElementById('popup-override-box');
    if (pob && !pob.classList.contains('hidden')) pob.classList.add('hidden');
    S.popupAttivoCli = null;
  }
  // Navigate to the correct screen based on authoritative server state.
  if (asta.stato === 'attesa') {
    showScreen('screen-lobby');
    // Show/hide admin controls depending on whether this client is the admin.
    const adminBox = document.getElementById('lobby-admin-box');
    const waitMsg  = document.getElementById('lobby-wait-msg');
    if (S.isAdmin) {
      if (adminBox) adminBox.classList.remove('hidden');
      if (waitMsg)  waitMsg.classList.add('hidden');
    } else {
      if (adminBox) adminBox.classList.add('hidden');
      if (waitMsg)  waitMsg.classList.remove('hidden');
    }
  } else if (asta.stato === 'in_corso') {
    showScreen('screen-asta');
  } else if (asta.stato === 'completata') {
    showScreen('screen-fine-asta');
    renderFineAsta();
  }
  renderLobbySquadre(asta.squadre);
  if (asta.stato === 'in_corso' || asta.stato === 'completata') {
    renderBudgetBar(asta.squadre);
    renderStorico(asta.storico);
    renderRose(asta.squadre);
    renderGiocatoriLiberi(asta.poolGiocatori);
    renderMioPanel();
    renderAdminPanel(asta);
  }
  // Always update lobby link (needed on reconnect, not just on first join).
  if (S.astaId) {
    const linkEl = document.getElementById('lobby-link');
    if (linkEl) linkEl.textContent = window.location.origin + '/?id=' + S.astaId;
  }
  if (asta.nome) document.getElementById('lobby-info-asta').textContent = asta.nome;
});

socket.on('asta-iniziata', () => {
  showScreen('screen-asta');
  toast('Asta iniziata!', 'success');
  if (S.asta) renderAdminPanel(S.asta);
});

socket.on('nuova-chiamata', (chiamata) => {
  S.attesaConferma = false;
  if (S.asta) S.asta.chiamataAttuale = chiamata;
  nascondiConfermaBox();
  renderChiamata(chiamata);
  const timerWrap = document.getElementById('timer-wrap');
  const rilBox    = document.getElementById('rilancio-box');
  if (chiamata.aspettandoConferma) {
    // RIC waiting — show card but NOT rilancio box (bid frozen)
    if (rilBox)    rilBox.classList.add('hidden');
    if (timerWrap) timerWrap.classList.add('hidden');
  } else {
    if (rilBox)    rilBox.classList.remove('hidden');
    if (timerWrap) timerWrap.classList.remove('hidden');
  }
  aggiornaQuickBids();
  const card = document.getElementById('chiamata-card');
  setTimeout(function() { if (card) card.classList.remove('card-enter'); }, 600);
});

socket.on('aggiorna-offerta', (chiamata) => {
  if (S.asta) S.asta.chiamataAttuale = chiamata;
  renderChiamata(chiamata);
  flashChiamataCard();
  // Price bump animation
  const prezzoEl = document.getElementById('cc-prezzo');
  if (prezzoEl) { prezzoEl.classList.remove('price-bump'); void prezzoEl.offsetWidth; prezzoEl.classList.add('price-bump'); setTimeout(function(){ prezzoEl.classList.remove('price-bump'); }, 400); }
  if (chiamata.squadraOfferente === S.miaSquadra) toast('Offerta accettata!', 'success');
  else playSound('rilancio');
});

socket.on('timer-start', ({ secondi, fase }) => { S.timerTotal = secondi; updateTimer(secondi, fase); });
socket.on('timer-tick', ({ secondi, fase }) => updateTimer(secondi, fase));

socket.on('giocatore-assegnato', ({ giocatore, prezzo, squadra, tipo, guadagno, plusvalenzaA }) => {
  S.attesaConferma = false;
  nascondiConfermaBox();
  document.getElementById('rilancio-box').classList.add('hidden');
  document.getElementById('timer-wrap').classList.add('hidden');
  // Confetti 🎉
  if (typeof confetti !== 'undefined') confetti({ particleCount: 80, spread: 60, origin: { y: 0.7 } });
  playSound('chaching');
  let msg = tipo === 'riconferma' ? ('Riconfermato da ' + squadra + ' a ' + prezzo + 'cr') :
    tipo === 'plusvalenza' ? (squadra + ' + ' + plusvalenzaA + ' +' + guadagno + 'cr plusvalenza') :
    tipo === 'recompra' ? (squadra + ' recompra ' + prezzo + 'cr') :
    tipo === 'con_svincolo' ? (squadra + ' ' + prezzo + 'cr (svincolo)') :
    (squadra + ' ' + prezzo + 'cr');
  toast(giocatore.nome + ' → ' + msg, 'success');
  const card = document.getElementById('chiamata-card');
  card.className = 'chiamata-card assegnata';
  card.innerHTML = '<p class="cc-esito">✅ ' + giocatore.nome + '</p><p class="chiamata-stato">' + msg + '</p>';
});

socket.on('giocatore-scartato', ({ giocatore }) => {
  document.getElementById('rilancio-box').classList.add('hidden');
  document.getElementById('timer-wrap').classList.add('hidden');
  playSound('buzzer');
  const card = document.getElementById('chiamata-card');
  card.className = 'chiamata-card scartata';
  card.innerHTML = '<p class="chiamata-stato">🚫 ' + giocatore.nome + ' — deserto</p>';
  toast(giocatore.nome + ' deserto (nessuna offerta)', 'info');
});

socket.on('assegnazione-annullata', (item) => toast('Annullato: ' + (item.giocatore ? item.giocatore.nome : '?'), 'info'));
socket.on('scartati-reintrodotti', ({ count }) => toast(count + ' giocatori reintrodotti', 'success'));
socket.on('tradeoff-ok', () => { closeModal(); toast('Trade-off eseguito!', 'success'); });
socket.on('asta-terminata', () => { cancSessione(); showScreen('screen-fine-asta'); renderFineAsta(); toast('Asta terminata!', 'success'); });
socket.on('errore', ({ msg }) => {
  toast(msg, 'error');
  // If asta not found (stale session), clear localStorage session
  if (msg && (msg.includes('non trovata') || msg.includes('non trovato'))) {
    cancSessione();
    S.astaId = null; S.miaSquadra = null; S.asta = null;
  }
});

socket.on('attesa-conferma', (chiamata) => {
  // Server sends the full chiamataAttuale object (fields: giocatore, offertaAttuale, squadraOfferente)
  if (S.asta) S.asta.chiamataAttuale = chiamata;
  const giocatore = chiamata.giocatore || {};
  const offerta   = chiamata.offertaAttuale || chiamata.offerta || 0;
  const squadra   = chiamata.squadraOfferente || chiamata.squadra || null;
  S.attesaConferma = true;
  document.getElementById('rilancio-box').classList.add('hidden');
  document.getElementById('timer-wrap').classList.add('hidden');
  if (S.isAdmin) {
    const cb = document.getElementById('admin-conferma-box');
    const ab = document.getElementById('admin-actions-box');
    if (cb) cb.classList.remove('hidden');
    if (ab) ab.classList.add('hidden');
    const ci  = document.getElementById('conferma-info');
    const rl  = document.getElementById('riapri-prezzo-label');
    if (rl)  rl.textContent = offerta;
    if (ci)  ci.textContent = squadra
      ? '🏆 ' + (giocatore.nome || '?') + ' → ' + squadra + ' @ ' + offerta + 'cr'
      : '⚠️ ' + (giocatore.nome || '?') + ' — nessuna offerta';
  }
  const toastMsg = squadra
    ? 'Offerta finale: ' + squadra + ' ' + offerta + 'cr per ' + (giocatore.nome || '?')
    : (giocatore.nome || '?') + ' — nessuna offerta, admin decide';
  toast(toastMsg, 'info');
  aggiornaQuickBids();
});

socket.on('popup-ric-conferma', ({ giocatore, costoConferma }) => {
  document.getElementById('mrc-giocatore').textContent = giocatore.nome + ' (' + (giocatore.ruolo||'?') + ')';
  document.getElementById('mrc-prezzo').textContent = costoConferma;
  document.getElementById('mrc-tipo-label').textContent = 'RIC — consuma 1 slot riconferma';
  S.popupAttivoCli = { tipo: 'ric-conferma', giocatore };
  openModal('modal-ric-conferma');
});

socket.on('popup-ric-conferma-admin', function(data) {
  if (!S.isAdmin) return;
  var giocatore = data.giocatore || {}, proprietario = data.proprietario;
  var costo = data.costoConferma || giocatore.costoOriginale || '?';
  document.getElementById('popup-override-chi').textContent = proprietario + ' — RIC: ' + (giocatore.nome || '?') + ' (' + costo + 'cr)';
  document.getElementById('popup-override-actions').innerHTML =
    '<button class="btn btn-success" data-ric="si" onclick="adminRicConferma(this.dataset.ric)">✅ Sì — confermato</button>' +
    '<button class="btn btn-danger" data-ric="no" onclick="adminRicConferma(this.dataset.ric)">❌ No — passa all\'asta</button>';
  document.getElementById('popup-override-box').classList.remove('hidden');
  S.popupAttivoCli = { tipo: 'ric-conferma-admin', giocatore: giocatore, proprietario: proprietario };
});

socket.on('popup-post-asta', (popup) => {
  renderPopupPostAsta(popup);
  S.popupAttivoCli = Object.assign({ tipo: 'post-asta' }, popup);
  openModal('modal-post-asta');
});

socket.on('popup-post-asta-admin', function(popup) {
  if (!S.isAdmin) return;
  var g = Math.max(0, popup.prezzoFinale - popup.giocatore.costoOriginale);
  var tipoLabel = popup.tipo === 'post-asta-ric' ? 'RIC' : 'PLUS';
  var infoTxt = tipoLabel + ' — ' + popup.giocatore.nome + ' → ' + popup.squadraVincitrice + ' @ ' + popup.prezzoFinale + 'cr';
  if (popup.opzioni.plusvalenza) infoTxt += ' | Plus +' + g + 'cr';
  if (popup.opzioni.recompra) infoTxt += ' | Recompra ' + (popup.prezzoFinale + 1) + 'cr';
  document.getElementById('popup-override-chi').textContent = infoTxt;
  var btns = '';
  if (popup.opzioni.plusvalenza) btns += '<button class="btn btn-accent" data-scelta="plusvalenza" onclick="adminPostAsta(this.dataset.scelta)">💰 Plus (+' + g + 'cr)</button>';
  if (popup.opzioni.recompra)   btns += '<button class="btn btn-primary" data-scelta="recompra" onclick="adminPostAsta(this.dataset.scelta)">🔄 Recompra (' + (popup.prezzoFinale + 1) + 'cr)</button>';
  btns += '<button class="btn btn-secondary" data-scelta="niente" onclick="adminPostAsta(this.dataset.scelta)">Niente</button>';
  document.getElementById('popup-override-actions').innerHTML = btns;
  document.getElementById('popup-override-box').classList.remove('hidden');
  S.popupAttivoCli = Object.assign({ tipo: 'post-asta-admin' }, popup);
});

socket.on('popup-svincolo', (popupData) => {
  S.svincoloSel.clear();
  S.popupAttivoCli = Object.assign({ tipo: 'svincolo' }, popupData);
  renderPopupSvincolo(popupData);
  openModal('modal-svincolo');
});

socket.on('popup-svincolo-admin', function(popup) {
  if (!S.isAdmin) return;
  document.getElementById('popup-override-chi').textContent = popup.squadraVincitrice + ' sta decidendo su ' + popup.giocatore.nome + '...';
  document.getElementById('popup-override-actions').innerHTML = '<em class="text-muted">⏳ In attesa della scelta della squadra...</em>';
  document.getElementById('popup-override-box').classList.remove('hidden');
});

// ════ RENDER FUNCTIONS ════════════════════════
function renderBudgetBar(squadre) {
  const creditiIniziali = S.asta ? (S.asta.creditiPerSquadra || 500) : 500;
  document.getElementById('budget-bar').innerHTML = squadre.map(sq => {
    const pct = Math.round(Math.max(0, sq.crediti / creditiIniziali * 100));
    const isOff = S.asta && S.asta.chiamataAttuale && S.asta.chiamataAttuale.squadraOfferente === sq.nome;
    const cls = ['sidebar-squadra',
      sq.nome === S.miaSquadra ? 'mia-squadra' : '',
      isOff ? 'offerente-attuale' : '',
      sq.crediti < 50 ? 'critica' : ''
    ].filter(Boolean).join(' ');
    const dot  = sq.online ? '🟢' : '⚪';
    const gioc = sq.giocatori ? sq.giocatori.length : ((sq.rosa || []).length);
    return '<div class="' + cls + '">' +
      '<div class="sq-top">' +
        '<span class="sq-dot-online">' + dot + '</span>' +
        '<span class="sq-nome">' + sq.nome + '</span>' +
        '<span class="sq-crediti">💰 ' + sq.crediti + '</span>' +
      '</div>' +
      '<div class="budget-progress"><div class="budget-progress-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="sq-bottom">🏆 ' + gioc + ' giocatori</div>' +
    '</div>';
  }).join('');
}

function _getRuoloBadgeHTML(ruolo) {
  const r = ruolo || 'XX';
  return r.split('/').map(function(x) {
    x = x.trim();
    return '<span class="badge-ruolo r-' + x + '">' + x + '</span>';
  }).join('');
}

function renderChiamata(chiamata) {
  const card = document.getElementById('chiamata-card');
  card.className = 'chiamata-card attiva card-enter';
  const g = chiamata.giocatore;
  const ruoloBadge = _getRuoloBadgeHTML(g.ruolo);
  const tipoBadge = g.tipo && g.tipo !== 'NN' ? '<span class="cc-tipo-badge tipo-' + g.tipo + '">' + g.tipo + '</span>' : '';
  const origTxt = g.squadraOriginale && g.tipo !== 'NN' ? '<small class="text-muted">ex: ' + g.squadraOriginale + '</small>' : '';
  const offerenteTxt = chiamata.squadraOfferente
    ? 'Offerta di: <strong>' + chiamata.squadraOfferente + '</strong>'
    : '<span class="chiamata-stato">In attesa 1ª offerta...</span>';
  const offertaDisplay = chiamata.offertaAttuale === 0 ? '—' : chiamata.offertaAttuale;
  const offertaLabel = chiamata.offertaAttuale === 0 ? 'Nessuna offerta' : 'crediti';
  const attesaBadge = chiamata.aspettandoConferma
    ? '<p class="cc-attesa-badge">⏳ In attesa decisione di <strong>' + (chiamata.proprietario || chiamata.giocatore.squadraOriginale || 'squadra') + '</strong></p>'
    : '';
  card.innerHTML =
    '<div class="cc-header">' +
      ruoloBadge +
      '<div class="cc-info">' +
        '<p class="cc-nome">' + g.nome + '</p>' +
        '<div class="cc-meta">' + tipoBadge + origTxt + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="cc-body">' +
      '<p class="cc-offerta" id="cc-prezzo">' + offertaDisplay + '</p>' +
      '<p class="cc-offerta-label">' + offertaLabel + '</p>' +
      '<p class="cc-offerente">' + offerenteTxt + '</p>' +
      attesaBadge +
    '</div>';
  aggiornaQuickBids();
}

function canBid() {
  if (!S.asta || !S.asta.chiamataAttuale) return false;
  if (S.attesaConferma) return false;
  const sq = getMiaSquadra();
  return sq && getMaxOfferta() > S.asta.chiamataAttuale.offertaAttuale;
}

function updateTimer(secondi, fase) {
  const total = S.timerTotal || secondi || 10;
  const CIRC = 339.292;
  const offset = CIRC * (1 - Math.max(0, secondi) / total);
  const progress = document.getElementById('timer-progress');
  const numEl    = document.getElementById('timer-display');
  const labelEl  = document.getElementById('timer-label');
  const container = document.getElementById('timer-wrap');
  const gs = document.getElementById('timer-grad-start');
  const ge = document.getElementById('timer-grad-end');
  if (progress) progress.style.strokeDashoffset = offset;
  if (numEl)    numEl.textContent  = secondi;
  if (labelEl)  labelEl.textContent = fase === 'prima' ? 'prima offerta' : 'rilancio';
  if (secondi <= 5) {
    container && container.classList.add('urgent');
    if (gs) gs.setAttribute('stop-color', '#ff1744');
    if (ge) ge.setAttribute('stop-color', '#ff6b6b');
    playSound('tick');
  } else if (secondi <= 10) {
    container && container.classList.remove('urgent');
    if (gs) gs.setAttribute('stop-color', '#ffb800');
    if (ge) ge.setAttribute('stop-color', '#ff9500');
  } else {
    container && container.classList.remove('urgent');
    if (gs) gs.setAttribute('stop-color', '#00e676');
    if (ge) ge.setAttribute('stop-color', '#00b0ff');
  }
}

function flashChiamataCard() {
  const card = document.getElementById('chiamata-card');
  card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
}

function renderStorico(storico) {
  const list = document.getElementById('storico-list');
  if (!storico || !storico.length) { list.innerHTML = '<li class="text-muted" style="padding:8px">Nessun acquisto</li>'; return; }
  list.innerHTML = [...storico].reverse().slice(0, 50).map(s => {
    if (s.tipo === 'scartato') return '<li><span class="storico-nome text-muted">' + s.giocatore.nome + '</span><span class="storico-tipo tipo-tag-scartato">deserto</span></li>';
    return '<li><span class="storico-nome">' + s.giocatore.nome + '</span>' +
      '<span class="storico-sq">' + s.squadra + '</span>' +
      '<span class="storico-prezzo">' + s.prezzo + 'cr</span>' +
      '<span class="storico-tipo tipo-tag-' + s.tipo + '">' + s.tipo + '</span></li>';
  }).join('');
}

function renderRose(squadre) {
  if (!squadre) return;
  const chiamata = S.asta && S.asta.chiamataAttuale;
  const squadraAttiva = chiamata && chiamata.squadraOfferente;
  const filtroRuolo = '';
  const cercaTesto = ((document.getElementById('rose-cerca') || {}).value || '').toLowerCase().trim();

  document.getElementById('rose-panel').innerHTML = squadre.map(sq => {
    const isAttiva = sq.nome === squadraAttiva;
    let giocatori = sq.rosa || [];
    if (filtroRuolo) giocatori = giocatori.filter(g => (g.ruolo||'') === filtroRuolo);
    if (cercaTesto) giocatori = giocatori.filter(g => g.nome.toLowerCase().includes(cercaTesto));
    const portieri = giocatori.filter(g => _isPortiere(g.ruolo));
    const movimento = giocatori.filter(g => !_isPortiere(g.ruolo));
    return '<div class="rose-col' + (isAttiva ? ' attiva' : '') + '">' +
      '<div class="rose-col-header">' +
        '<span class="rose-col-nome">' + sq.nome + '</span>' +
        '<span class="rose-col-budget' + (isAttiva ? ' attiva' : '') + '">🪙 ' + sq.crediti + '</span>' +
      '</div>' +
      _renderRoseSez('⛳ Por', portieri, 'por', sq.nome) +
      _renderRoseSez('⚡ Mov', movimento, 'mov', sq.nome) +
    '</div>';
  }).join('');
}

function _isPortiere(ruolo) { return ruolo === 'Por' || ruolo === 'P'; }

function _renderRoseSez(titolo, giocatori, tipo, sqNome) {
  const secId = 'rsec-' + tipo + '-' + sqNome.replace(/\W/g,'');
  const collapsed = window._roseCollapsed && window._roseCollapsed[secId];
  return '<div class="rose-section ' + tipo + '">' +
    '<div class="rose-sec-hdr' + (collapsed ? ' collapsed' : '') + '" onclick="_toggleRoseSec(this,\'' + secId + '\')">' +
      '<span>' + titolo + ' <small>(' + giocatori.length + ')</small></span>' +
      '<span class="rose-arrow">' + (collapsed ? '▸' : '▾') + '</span>' +
    '</div>' +
    '<div class="rose-sec-body' + (collapsed ? ' collapsed' : '') + '">' +
      (giocatori.length === 0
        ? '<div class="rose-empty">—</div>'
        : giocatori.map(g => {
            const r = (g.ruolo || 'NN').toLowerCase();
            return '<div class="rose-player">' +
              '<span class="rose-badge ruolo-rose-' + r + '">' + (g.ruolo||'?') + '</span>' +
              '<span class="rose-nome">' + g.nome + '</span>' +
              '<span class="rose-prezzo">🪙' + g.prezzo + '</span>' +
            '</div>';
          }).join('')
      ) +
    '</div>' +
  '</div>';
}

window._roseCollapsed = {};
window._toggleRoseSec = function(hdrEl, secId) {
  window._roseCollapsed[secId] = !window._roseCollapsed[secId];
  hdrEl.classList.toggle('collapsed', !!window._roseCollapsed[secId]);
  const body = hdrEl.nextElementSibling;
  if (body) body.classList.toggle('collapsed', !!window._roseCollapsed[secId]);
  const arrow = hdrEl.querySelector('.rose-arrow');
  if (arrow) arrow.textContent = window._roseCollapsed[secId] ? '▸' : '▾';
};

window.aggiornaFiltroRose = function() {
  if (S.asta && S.asta.squadre) renderRose(S.asta.squadre);
};

function renderGiocatoriLiberi(pool) {
  const list = document.getElementById('liberi-list');
  if (!pool) { list.innerHTML = ''; return; }
  const disp = pool.filter(g => !g.estratto && !g.assegnato && !g.scartato);
  const scar = pool.filter(g => g.scartato);
  // Ordina per Valore Algoritmico decrescente (fallback: costo, poi nome)
  const byValore = (a, b) => {
    const va = a.valore || 0, vb = b.valore || 0;
    if (vb !== va) return vb - va;
    const ca = a.costoOriginale || 0, cb = b.costoOriginale || 0;
    if (cb !== ca) return cb - ca;
    return a.nome.localeCompare(b.nome);
  };
  let tutti = [...disp.sort(byValore), ...scar.sort(byValore)];
  if (S.filtroRuolo !== 'tutti') tutti = tutti.filter(g => {
    const ruoli = (g.ruolo || '').split(/[\/,]/).map(function(x){ return x.trim().toLowerCase(); });
    return ruoli.includes(S.filtroRuolo.toLowerCase());
  });
  list.innerHTML = tutti.map(g => {
    const sc = g.scartato ? ' scartato' : '';
    const tipoLabel = g.tipo || 'NN';
    const tb = '<span class="l-tipo-badge tipo-' + tipoLabel + '">' + tipoLabel + '</span>';
    const orig = g.squadraOriginale ? '<span class="l-orig">ex ' + g.squadraOriginale + '</span>' : '';
    const click = (!g.scartato && S.isAdmin) ? ' onclick="chiamaLibero(\'' + g.id + '\')"' : '';
    const haValore = g.valore !== undefined && g.valore !== null && g.valore !== 0;
    const valoreHTML = haValore
      ? '<div class="l-valore-wrap"><span class="l-valore">' + g.valore + '</span><span class="l-valore-label">Valore</span></div>'
      : '';
    return '<li class="' + sc + '"' + click + '>' + _getRuoloBadgeHTML(g.ruolo) +
      '<span class="l-nome">' + g.nome + '</span>' + tb + orig + valoreHTML +
      '<span class="l-costo">' + g.costoOriginale + 'cr' + (g.scartato ? ' \u2717' : '') + '</span></li>';
  }).join('') || '<li class="text-muted" style="padding:8px">Nessun giocatore</li>';
}

window.chiamaLibero = function(id) {
  if (!S.isAdmin || (S.asta && S.asta.chiamataAttuale)) return toast('Chiamata in corso', 'error');
  socket.emit('chiama-giocatore', { astaId: S.astaId, giocatoreId: id });
};

function renderMioPanel() {
  const sq = getMiaSquadra();
  if (!sq) return;
  document.getElementById('mio-panel').classList.remove('hidden');
  document.getElementById('mio-panel-nome').textContent = sq.nome;
  document.getElementById('mio-crediti-badge').textContent = '💰 ' + sq.crediti;
  const counter = document.getElementById('mio-slot-counter');
  if (S.asta && S.asta.tipoAsta === 'iniziale') {
    counter.classList.remove('hidden');
    const rD = sq.slotsRIC - sq.slotsRICUsati, pD = sq.slotsPLUS - sq.slotsPLUSUsati;
    const ricTot = sq.giocatoriRICTotali || sq.slotsRIC;
    const plusTot = sq.giocatoriPLUSTotali || sq.slotsPLUS;
    counter.innerHTML =
      '<span class="slot-chip' + (rD===0?' esaurito':'') + '">RIC <span>' + sq.slotsRICUsati + '/' + sq.slotsRIC + '</span> <small class="slot-sub">(' + ricTot + ' da estrarre)</small></span>' +
      '<span class="slot-chip' + (pD===0?' esaurito':'') + '">PLUS <span>' + sq.slotsPLUSUsati + '/' + sq.slotsPLUS + '</span> <small class="slot-sub">(' + plusTot + ' da estrarre)</small></span>' +
      '<span class="slot-chip' + (sq.recompraUsata?' esaurito':'') + '">Recompra <span>' + (sq.recompraUsata?'usata':'✓') + '</span></span>' +
      '<span class="slot-chip">Max <span class="text-accent">' + getMaxOfferta() + 'cr</span></span>';
    document.getElementById('btn-tradeoff').classList.remove('hidden');
  } else if (S.asta && S.asta.tipoAsta === 'riparazione') {
    counter.classList.remove('hidden');
    const sR = S.asta.svincoliTotali - (sq.svincoliUsati || 0);
    counter.innerHTML =
      '<span class="slot-chip' + (sR<=0?' esaurito':'') + '">Svincoli <span>' + sR + '/' + S.asta.svincoliTotali + '</span></span>' +
      '<span class="slot-chip">Max <span class="text-accent">' + getMaxOfferta() + 'cr</span></span>';
  }
}

function renderAdminPanel(asta) {
  applyLayoutRuolo();
  const panel = document.getElementById('admin-panel');
  if (!S.isAdmin) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  const btnEstrai = document.getElementById('btn-estrai');
  if (asta && asta.tipoEstrazione === 'manuale') btnEstrai.classList.remove('hidden');
  else btnEstrai.classList.add('hidden');
}

// ══ LAYOUT RUOLO: 2 righe per non-admin (puja nella riga 1), 3 righe compatte per admin ══
function applyLayoutRuolo() {
  const slot = document.getElementById('puja-panel-slot');
  const rowPuja = document.querySelector('.asta-row-puja');
  const cardGroup = document.getElementById('card-timer-group');
  const rilancioBox = document.getElementById('rilancio-box');
  if (!slot || !rowPuja || !cardGroup || !rilancioBox) return;
  if (S.isAdmin) {
    if (cardGroup.parentElement !== rowPuja) rowPuja.appendChild(cardGroup);
    if (rilancioBox.parentElement !== rowPuja) rowPuja.appendChild(rilancioBox);
    slot.classList.add('hidden');
    document.body.classList.add('layout-admin');
    document.body.classList.remove('layout-partecipante');
  } else {
    if (cardGroup.parentElement !== slot) slot.appendChild(cardGroup);
    if (rilancioBox.parentElement !== slot) slot.appendChild(rilancioBox);
    slot.classList.remove('hidden');
    document.body.classList.add('layout-partecipante');
    document.body.classList.remove('layout-admin');
  }
}

function renderLobbySquadre(squadre) {
  const ul = document.getElementById('lobby-squadre');
  if (!ul) return;
  ul.innerHTML = squadre.map(s =>
    '<li><span class="sq-dot ' + (s.online?'online':'offline') + '">●</span><strong>' + s.nome + '</strong>' +
    '<span class="text-muted" style="font-size:0.75rem">' + (s.online?'(online)':'(offline)') + ' | ' + s.crediti + 'cr</span></li>').join('');
}

function renderFineAsta() {
  const asta = S.asta; if (!asta) return;
  document.getElementById('riepilogo-asta').innerHTML = asta.squadre.map(sq =>
    '<div class="riepilogo-card"><h3><span>' + sq.nome + '</span><span class="rc-crediti">💰 ' + sq.crediti + 'cr</span></h3>' +
    (asta.tipoAsta === 'iniziale' ? '<p class="rc-slot">RIC ' + sq.slotsRICUsati + '/' + sq.slotsRIC + ' | PLUS ' + sq.slotsPLUSUsati + '/' + sq.slotsPLUS + ' | Recompra: ' + (sq.recompraUsata?'usata':'no') + '</p>' : '') +
    '<table><thead><tr><th>Giocatore</th><th>Ruolo</th><th>Tipo</th><th>Prezzo</th></tr></thead><tbody>' +
    (sq.rosa.map(g => '<tr><td>' + g.nome + '</td><td>' + (g.ruolo||'?') + '</td><td>' + (g.tipo||'NN') + '</td><td>' + g.prezzo + 'cr</td></tr>').join('') ||
      '<tr><td colspan="4" class="text-muted">Nessun giocatore</td></tr>') +
    '</tbody></table></div>').join('');
}

// ════ POPUPS ══════════════════════════════════
window.rispostaRicConferma = function(risposta) {
  socket.emit('risposta-ric-conferma', { astaId: S.astaId, risposta });
  closeModal(); hidePoupOverride();
};

window.adminRicConferma = function(risposta) {
  socket.emit('risposta-ric-conferma', { astaId: S.astaId, risposta });
  closeModal(); hidePoupOverride();
};

function renderPopupPostAsta(popup) {
  document.getElementById('mpa-title').textContent = popup.tipo === 'post-asta-ric' ? 'RIC — Scegli opzione' : 'PLUS — Scegli opzione';
  document.getElementById('mpa-giocatore').textContent = popup.giocatore.nome;
  document.getElementById('mpa-vincitore').textContent = popup.squadraVincitrice;
  document.getElementById('mpa-prezzo').textContent = popup.prezzoFinale;
  const g = Math.max(0, popup.prezzoFinale - popup.giocatore.costoOriginale);
  let html = '';
  if (popup.opzioni.plusvalenza) html += '<button class="btn btn-accent" onclick="rispostaPostAsta(\'plusvalenza\')">Plusvalenza (+' + g + 'cr)</button>';
  if (popup.opzioni.recompra) html += '<button class="btn btn-primary" onclick="rispostaPostAsta(\'recompra\')">Recompra (' + (popup.prezzoFinale+1) + 'cr)</button>';
  html += '<button class="btn btn-secondary" onclick="rispostaPostAsta(\'niente\')">Niente — va bene</button>';
  document.getElementById('mpa-opzioni').innerHTML = html;
}

window.rispostaPostAsta = function(scelta) {
  socket.emit('risposta-post-asta', { astaId: S.astaId, scelta });
  closeModal(); hidePoupOverride();
};

window.adminPostAsta = function(scelta) {
  socket.emit('risposta-post-asta', { astaId: S.astaId, scelta });
  closeModal(); hidePoupOverride();
};

function updateTradeoffButtons(sq) {
  const rD = sq.slotsRIC - sq.slotsRICUsati, pD = sq.slotsPLUS - sq.slotsPLUSUsati;
  const rT = Math.max(0, rD - 1), pT = Math.max(0, pD - 1);
  document.getElementById('to-r2p').disabled = rT < 1;
  document.getElementById('to-p2r').disabled = pT < 3;
  document.getElementById('to-r2c').disabled = rT < 1;
  document.getElementById('to-p2c').disabled = pT < 1;
}

window.eseguiTradeoff = function(tipo) {
  const labels = {
    'ric-to-plus':    '1 slot RIC  →  2 slot PLUS',
    'plus-to-ric':    '3 slot PLUS  →  1 slot RIC',
    'ric-to-crediti': '1 slot RIC  →  12 crediti',
    'plus-to-crediti':'1 slot PLUS  →  6 crediti'
  };
  if (!confirm('Eseguire il Trade-off?\n\n' + (labels[tipo] || tipo) + '\n\nQuesta operazione è irreversibile.')) return;
  socket.emit('tradeoff', { astaId: S.astaId, tipo });
  closeModal();
};

socket.on('tradeoff-usato', function({ nomeSquadra, tipo }) {
  const labels = {
    'ric-to-plus':    '1 RIC → 2 PLUS',
    'plus-to-ric':    '3 PLUS → 1 RIC',
    'ric-to-crediti': '1 RIC → 12cr',
    'plus-to-crediti':'1 PLUS → 6cr'
  };
  toast('⚡ ' + nomeSquadra + ' ha usato Trade-off: ' + (labels[tipo] || tipo), 'info');
});

function renderPopupSvincolo(popupData) {
  document.getElementById('sv-giocatore').textContent = popupData.giocatore.nome;
  document.getElementById('sv-prezzo').textContent = popupData.prezzoFinale;
  const sq = getMiaSquadra();
  document.getElementById('sv-crediti').textContent = sq ? sq.crediti : 0;
  document.getElementById('sv-diff').textContent = popupData.differenza;
  document.getElementById('sv-svincoli-rem').textContent = 'Svincoli rimanenti: ' + popupData.svincoliRimanenti;
  const fattore = popupData.fattoreSvincolo || 0.5;
  document.getElementById('sv-lista').innerHTML = (popupData.rosa || []).map(g => {
    const recup = Math.floor(g.prezzo * fattore);
    return '<div class="sv-item" id="svi-' + g.id + '" onclick="toggleSvincolo(\'' + g.id + '\',' + recup + ')">' +
      '<input type="checkbox" id="svc-' + g.id + '" onclick="event.stopPropagation();toggleSvincolo(\'' + g.id + '\',' + recup + ')">' +
      '<div class="sv-item-info"><div class="sv-item-nome">' + g.nome + '</div>' +
      '<div class="sv-item-detail">' + (g.ruolo||'?') + ' — ' + g.prezzo + 'cr</div></div>' +
      '<span class="sv-item-recup">+' + recup + 'cr</span></div>';
  }).join('');
  aggiornaTotaleSvincolo(popupData.differenza);
}

window.toggleSvincolo = function(id, crediti) {
  const cb = document.getElementById('svc-' + id);
  const item = document.getElementById('svi-' + id);
  if (S.svincoloSel.has(id)) {
    S.svincoloSel.delete(id);
    if (cb) cb.checked = false;
    if (item) item.classList.remove('selezionato');
  } else {
    S.svincoloSel.add(id);
    if (cb) cb.checked = true;
    if (item) item.classList.add('selezionato');
  }
  aggiornaTotaleSvincolo(S.popupAttivoCli ? S.popupAttivoCli.differenza : 0);
};

function aggiornaTotaleSvincolo(differenza) {
  const popup = S.popupAttivoCli; if (!popup) return;
  const fattore = popup.fattoreSvincolo || 0.5;
  let recupero = 0;
  S.svincoloSel.forEach(id => {
    const g = (popup.rosa || []).find(r => r.id === id);
    if (g) recupero += Math.floor(g.prezzo * fattore);
  });
  const debito = Math.max(0, differenza - recupero);
  document.getElementById('sv-recupero').textContent = recupero;
  document.getElementById('sv-debito').textContent = debito;
  document.getElementById('btn-sv-conferma').disabled = debito > 0;
}

window.confermaSvincolo = function() {
  socket.emit('esegui-svincolo', { astaId: S.astaId, giocatoriIds: [...S.svincoloSel] });
  closeModal(); hidePoupOverride();
};

// ══ MODALE CHIAMA MANUALE (ricerca live + filtro ruolo) ══════
S.cmFiltroRuolo = 'tutti';
window.apriModalChiamaManuale = function() {
  S.cmFiltroRuolo = 'tutti';
  document.querySelectorAll('#cm-filtri-ruolo .filtro-btn').forEach(b => b.classList.toggle('active', b.dataset.ruolo === 'tutti'));
  const inp = document.getElementById('inp-cm-search'); if (inp) inp.value = '';
  renderChiamaManualeLista();
  openModal('modal-chiama-manuale');
};
window.setCmFiltroRuolo = function(btn, ruolo) {
  S.cmFiltroRuolo = ruolo;
  document.querySelectorAll('#cm-filtri-ruolo .filtro-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderChiamaManualeLista();
};
window.renderChiamaManualeLista = function() {
  const lista = document.getElementById('cm-lista');
  if (!lista || !S.asta) return;
  const testo = (document.getElementById('inp-cm-search').value || '').toLowerCase().trim();
  let disp = (S.asta.poolGiocatori || []).filter(g => !g.estratto && !g.assegnato && !g.scartato);
  if (S.cmFiltroRuolo !== 'tutti') {
    disp = disp.filter(g => (g.ruolo || '').split('/').map(x => x.trim().toLowerCase()).includes(S.cmFiltroRuolo.toLowerCase()));
  }
  if (testo) disp = disp.filter(g => g.nome.toLowerCase().includes(testo));
  disp = disp.sort((a, b) => (b.valore || 0) - (a.valore || 0));
  lista.innerHTML = disp.slice(0, 80).map(g => {
    const orig = g.squadraOriginale ? ' · ex ' + g.squadraOriginale : '';
    return '<div class="cm-item" onclick="chiamaDaModale(\'' + g.id + '\')">' +
      _getRuoloBadgeHTML(g.ruolo) +
      '<span class="cm-item-nome">' + g.nome + '</span>' +
      '<span class="cm-item-info">' + (g.tipo && g.tipo !== 'NN' ? g.tipo + ' · ' : '') + (g.costoOriginale || 0) + 'cr' + orig + '</span>' +
    '</div>';
  }).join('') || '<p class="text-muted" style="padding:8px">Nessun giocatore trovato</p>';
};
window.chiamaDaModale = function(id) {
  if (!S.isAdmin) return toast("Solo l'admin può chiamare", "error");
  if (S.asta && S.asta.chiamataAttuale) return toast('Chiamata già in corso', 'error');
  socket.emit('chiama-giocatore', { astaId: S.astaId, giocatoreId: id });
  closeModal();
};

// ══ MODALE ASSEGNA MANUALE (senza puja) ══════
S.amSelezionato = null;
window.apriModalAssegnaManuale = function() {
  S.amSelezionato = null;
  const inp = document.getElementById('inp-am-search'); if (inp) inp.value = '';
  const sel = document.getElementById('inp-am-squadra');
  if (sel && S.asta) {
    sel.innerHTML = S.asta.squadre.map(sq => '<option value="' + sq.nome + '">' + sq.nome + ' (💰' + sq.crediti + ')</option>').join('');
  }
  document.getElementById('inp-am-prezzo').value = 1;
  renderAssegnaManualeLista();
  openModal('modal-assegna-manuale');
};
window.renderAssegnaManualeLista = function() {
  const lista = document.getElementById('am-lista');
  if (!lista || !S.asta) return;
  const testo = (document.getElementById('inp-am-search').value || '').toLowerCase().trim();
  let disp = (S.asta.poolGiocatori || []).filter(g => !g.estratto && !g.assegnato && !g.scartato);
  if (testo) disp = disp.filter(g => g.nome.toLowerCase().includes(testo));
  disp = disp.sort((a, b) => (b.valore || 0) - (a.valore || 0));
  lista.innerHTML = disp.slice(0, 80).map(g => {
    const sel = S.amSelezionato === g.id ? ' selected' : '';
    const orig = g.squadraOriginale ? ' · ex ' + g.squadraOriginale : '';
    return '<div class="cm-item' + sel + '" onclick="selezionaGiocatoreAssegna(\'' + g.id + '\')">' +
      _getRuoloBadgeHTML(g.ruolo) +
      '<span class="cm-item-nome">' + g.nome + '</span>' +
      '<span class="cm-item-info">' + (g.tipo && g.tipo !== 'NN' ? g.tipo + ' · ' : '') + (g.costoOriginale || 0) + 'cr' + orig + '</span>' +
    '</div>';
  }).join('') || '<p class="text-muted" style="padding:8px">Nessun giocatore trovato</p>';
};
window.selezionaGiocatoreAssegna = function(id) {
  S.amSelezionato = id;
  const g = S.asta && S.asta.poolGiocatori.find(p => p.id === id);
  if (g) document.getElementById('inp-am-prezzo').value = g.costoOriginale || 1;
  renderAssegnaManualeLista();
};
window.confermaAssegnaManuale = function() {
  if (!S.isAdmin) return toast("Solo l'admin può assegnare", "error");
  if (!S.amSelezionato) return toast('Seleziona un giocatore', 'error');
  const squadra = document.getElementById('inp-am-squadra').value;
  const prezzo = parseInt(document.getElementById('inp-am-prezzo').value) || 1;
  if (!squadra) return toast('Seleziona una squadra', 'error');
  socket.emit('assegna-manuale', { astaId: S.astaId, giocatoreId: S.amSelezionato, squadraNome: squadra, prezzo });
  closeModal();
};

window.confermaModTimer = function() {
  socket.emit('modifica-timer', {
    astaId: S.astaId,
    timerPrimaChiamata: parseInt(document.getElementById('inp-mt-prima').value),
    timerRilancio: parseInt(document.getElementById('inp-mt-rilancio').value)
  });
  closeModal(); toast('Timer aggiornato', 'success');
};

function renderMiaRosa(sq) {
  document.getElementById('mr-title').textContent = 'Rosa di ' + sq.nome;
  const lista = document.getElementById('mr-lista');
  if (!sq.rosa.length) { lista.innerHTML = '<p class="text-muted">Nessun giocatore</p>'; return; }
  lista.innerHTML = sq.rosa.map(g => '<div class="mr-item">' +
    '<span class="mr-ruolo">' + (g.ruolo||'?') + '</span><span class="mr-nome">' + g.nome + '</span>' +
    (g.tipo && g.tipo !== 'NN' ? '<span class="mr-tipo tipo-' + g.tipo + '">' + g.tipo + '</span>' : '') +
    '<span class="mr-prezzo">' + g.prezzo + 'cr</span></div>').join('');
}

// ════ UTILS ═══════════════════════════════════
function getMiaSquadra() {
  if (!S.asta || !S.miaSquadra) return null;
  return S.asta.squadre.find(s => s.nome === S.miaSquadra) || null;
}

function getMaxOfferta() {
  const sq = getMiaSquadra();
  if (!sq || !S.asta) return 0;
  if (S.asta.tipoAsta === 'iniziale') return sq.crediti;
  const fattore = S.asta.fattoreSvincolo || 0.5;
  const svinR = S.asta.svincoliTotali - (sq.svincoliUsati || 0);
  if (svinR <= 0) return sq.crediti;
  const sorted = [...sq.rosa].sort((a, b) => Math.floor(b.prezzo * fattore) - Math.floor(a.prezzo * fattore));
  let recup = 0;
  for (let i = 0; i < Math.min(svinR, sorted.length); i++) recup += Math.floor(sorted[i].prezzo * fattore);
  const minTot = (S.asta.minimoPortieri || 0) + (S.asta.minimoMovimento || 0);
  return Math.max(1, sq.crediti + recup - Math.max(0, minTot - sq.rosa.length - 1));
}

function openModal(id) {
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById(id).classList.remove('hidden');
}

window.closeModal = function() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  S.popupAttivoCli = null;
};

window.closeModalOnOverlay = function(e) {
  if (e.target.id !== 'modal-overlay') return;
  if (S.popupAttivoCli && ['ric-conferma','post-asta','svincolo'].includes(S.popupAttivoCli.tipo)) return;
  closeModal();
};

function hidePoupOverride() {
  document.getElementById('popup-override-box').classList.add('hidden');
  document.getElementById('popup-override-actions').innerHTML = '';
}

function toast(msg, tipo) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast ' + (tipo || 'info');
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => { try { container.removeChild(el); } catch(e){} }, 3200);
}
