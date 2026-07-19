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
  attesaConferma: false
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
  if (!confirm('Vuoi uscire dall'asta? I dati rimarranno sul server.')) return;
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
  const schermataHome = document.getElementById('screen-home');
  const sullaHome = !schermataHome || schermataHome.classList.contains('active');
  // Re-join only if we were already in an asta (not creating a new one from home)
  if (!sullaHome && S.astaId && S.miaSquadra) {
    socket.emit('join-asta', { astaId: S.astaId, nomeSquadra: S.miaSquadra, isAdmin: S.isAdmin });
    return;
  }
  // First load: restore session and join
  const sess = getSessione();
  if (sess && sess.astaId && !S.asta && !sullaHome) {
    S.astaId = sess.astaId;
    S.miaSquadra = sess.nomeSquadra;
    S.isAdmin = sess.isAdmin;
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
  drop.addEventListener('click', () => inpJson.click());
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
    S.astaId = input; S.miaSquadra = nome; S.isAdmin = false; S.asta = null;
    socket.emit('join-asta', { astaId: S.astaId, nomeSquadra: S.miaSquadra, isAdmin: false }); salvaSessione();
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
  document.getElementById('btn-rilancio').addEventListener('click', () => {
    if (!S.asta || !S.asta.chiamataAttuale) return;
    const base = S.asta.chiamataAttuale.offertaAttuale;
    const inc = parseInt(document.getElementById('inp-rilancio').value) || 1;
    socket.emit('rilancio', { astaId: S.astaId, offerta: base + inc });
  });
  document.getElementById('btn-minus').addEventListener('click', () => {
    const inp = document.getElementById('inp-rilancio');
    inp.value = Math.max(1, parseInt(inp.value) - 1);
  });
  document.getElementById('btn-plus').addEventListener('click', () => {
    const inp = document.getElementById('inp-rilancio');
    inp.value = parseInt(inp.value) + 1;
  });
  // Quick bid buttons
  document.getElementById('btn-quick-1').addEventListener('click', () => inviaRilancioRapido(1));
  document.getElementById('btn-quick-5').addEventListener('click', () => inviaRilancioRapido(5));
  document.getElementById('btn-quick-10').addEventListener('click', () => inviaRilancioRapido(10));

  document.getElementById('btn-estrai').addEventListener('click', () => socket.emit('estrai-giocatore', { astaId: S.astaId }));
  document.getElementById('btn-chiama-manuale').addEventListener('click', () => openModal('modal-chiama-manuale'));
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

function aggiornaQuickBids() {
  const canB = canBid();
  ['btn-quick-1','btn-quick-5','btn-quick-10'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !canB;
  });
  const btn = document.getElementById('btn-rilancio');
  if (btn) btn.disabled = !canB;
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
      const roseFooter = document.getElementById('rose-footer');
      if (roseFooter) roseFooter.classList.toggle('visible', btn.dataset.tab === 'tab-rose');
    });
  });
  // Live search on Enter
  const rCerca = document.getElementById('rose-cerca');
  if (rCerca) rCerca.addEventListener('keydown', e => { if (e.key === 'Enter') aggiornaFiltroRose(); });
  const rFiltro = document.getElementById('rose-filtro-ruolo');
  if (rFiltro) rFiltro.addEventListener('change', aggiornaFiltroRose);
  // Rose footer actions
  const btnRoseChiama = document.getElementById('btn-rose-chiama');
  if (btnRoseChiama) btnRoseChiama.addEventListener('click', () => {
    if (!S.isAdmin) return toast('Solo l'admin può chiamare', 'error');
    if (S.asta && S.asta.tipoEstrazione === 'manuale') {
      openModal('modal-chiama-manuale');
    } else {
      socket.emit('estrai-giocatore', { astaId: S.astaId });
    }
  });
  const btnRoseAssegna = document.getElementById('btn-rose-assegna');
  if (btnRoseAssegna) btnRoseAssegna.addEventListener('click', () => {
    if (!S.isAdmin) return toast('Solo l'admin può assegnare', 'error');
    if (S.attesaConferma) {
      socket.emit('conferma-assegnazione', { astaId: S.astaId });
      nascondiConfermaBox();
      toast('Assegnazione confermata!', 'success');
    } else {
      toast('Nessuna assegnazione in attesa', 'info');
    }
  });
}

// ════ SOCKET EVENTS ═══════════════════════════
socket.on('stato-asta', (asta) => {
  S.asta = asta;
  salvaStatoLocale(asta);
  renderLobbySquadre(asta.squadre);
  if (asta.stato === 'in_corso' || asta.stato === 'completata') {
    renderBudgetBar(asta.squadre);
    renderStorico(asta.storico);
    renderRose(asta.squadre);
    renderGiocatoriLiberi(asta.poolGiocatori);
    renderMioPanel();
    renderAdminPanel(asta);
  }
  if (!document.getElementById('lobby-link').textContent && S.astaId)
    document.getElementById('lobby-link').textContent = window.location.origin + '/?id=' + S.astaId;
  if (asta.nome) document.getElementById('lobby-info-asta').textContent = asta.nome;
});

socket.on('asta-iniziata', () => {
  showScreen('screen-asta');
  toast('Asta iniziata!', 'success');
  if (S.asta) renderAdminPanel(S.asta);
});

socket.on('nuova-chiamata', (chiamata) => {
  S.attesaConferma = false;
  nascondiConfermaBox();
  renderChiamata(chiamata);
  document.getElementById('rilancio-box').classList.remove('hidden');
  document.getElementById('timer-wrap').classList.remove('hidden');
  document.getElementById('inp-rilancio').value = 1;
  aggiornaQuickBids();
});

socket.on('aggiorna-offerta', (chiamata) => {
  renderChiamata(chiamata);
  flashChiamataCard();
  if (chiamata.squadraOfferente === S.miaSquadra) toast('Offerta accettata!', 'success');
});

socket.on('timer-start', ({ secondi, fase }) => updateTimer(secondi, fase));
socket.on('timer-tick', ({ secondi, fase }) => updateTimer(secondi, fase));

socket.on('giocatore-assegnato', ({ giocatore, prezzo, squadra, tipo, guadagno, plusvalenzaA }) => {
  S.attesaConferma = false;
  nascondiConfermaBox();
  document.getElementById('rilancio-box').classList.add('hidden');
  document.getElementById('timer-wrap').classList.add('hidden');
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

socket.on('attesa-conferma', ({ giocatore, offerta, squadra }) => {
  S.attesaConferma = true;
  document.getElementById('rilancio-box').classList.add('hidden');
  document.getElementById('timer-wrap').classList.add('hidden');
  if (S.isAdmin) {
    const cb = document.getElementById('admin-conferma-box');
    const ab = document.getElementById('admin-actions-box');
    if (cb) { cb.classList.remove('hidden'); }
    if (ab) { ab.classList.add('hidden'); }
    const ci = document.getElementById('conferma-info');
    if (ci) ci.textContent = '🏆 ' + giocatore.nome + ' → ' + squadra + ' @ ' + offerta + 'cr';
  }
  toast('Offerta finale: ' + squadra + ' ' + offerta + 'cr per ' + giocatore.nome, 'info');
  aggiornaQuickBids();
});

socket.on('popup-ric-conferma', ({ giocatore, costoConferma }) => {
  document.getElementById('mrc-giocatore').textContent = giocatore.nome + ' (' + (giocatore.ruolo||'?') + ')';
  document.getElementById('mrc-prezzo').textContent = costoConferma;
  document.getElementById('mrc-tipo-label').textContent = 'RIC — consuma 1 slot riconferma';
  S.popupAttivoCli = { tipo: 'ric-conferma', giocatore };
  openModal('modal-ric-conferma');
});

socket.on('popup-ric-conferma-admin', ({ giocatore, proprietario }) => {
  if (!S.isAdmin) return;
  document.getElementById('popup-override-chi').textContent = proprietario + ' (RIC: ' + giocatore.nome + ')';
  document.getElementById('popup-override-actions').innerHTML =
    '<button class="btn btn-success" onclick="adminRicConferma(\'si\')">Si per ' + proprietario + '</button>' +
    '<button class="btn btn-danger" onclick="adminRicConferma(\'no\')">No per ' + proprietario + '</button>';
  document.getElementById('popup-override-box').classList.remove('hidden');
  S.popupAttivoCli = { tipo: 'ric-conferma-admin', giocatore, proprietario };
});

socket.on('popup-post-asta', (popup) => {
  renderPopupPostAsta(popup);
  S.popupAttivoCli = Object.assign({ tipo: 'post-asta' }, popup);
  openModal('modal-post-asta');
});

socket.on('popup-post-asta-admin', (popup) => {
  if (!S.isAdmin) return;
  document.getElementById('popup-override-chi').textContent = popup.proprietarioPrecedente + ' (' + popup.giocatore.nome + ')';
  let btns = '';
  if (popup.opzioni.plusvalenza) btns += '<button class="btn btn-accent" onclick="adminPostAsta(\'plusvalenza\')">Plusvalenza</button>';
  if (popup.opzioni.recompra) btns += '<button class="btn btn-primary" onclick="adminPostAsta(\'recompra\')">Recompra</button>';
  btns += '<button class="btn btn-secondary" onclick="adminPostAsta(\'niente\')">Niente</button>';
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

socket.on('popup-svincolo-admin', (popup) => {
  if (!S.isAdmin) return;
  document.getElementById('popup-override-chi').textContent = popup.squadraVincitrice + ' (svincolo ' + popup.giocatore.nome + ')';
  document.getElementById('popup-override-actions').innerHTML = '<em class="text-muted">In attesa decisione squadra...</em>';
  document.getElementById('popup-override-box').classList.remove('hidden');
});

// ════ RENDER FUNCTIONS ════════════════════════
function renderBudgetBar(squadre) {
  document.getElementById('budget-bar').innerHTML = squadre.map(sq => {
    const cls = sq.nome === S.miaSquadra ? 'budget-chip mia' :
      sq.crediti < 50 ? 'budget-chip critica' : sq.crediti < 150 ? 'budget-chip bassa' : 'budget-chip';
    return '<div class="' + cls + '" title="' + sq.nome + '">' +
      '<span class="bc-nome">' + (sq.online ? '🟢' : '⚪') + ' ' + sq.nome + '</span>' +
      '<span class="bc-cred">' + sq.crediti + '</span></div>';
  }).join('');
}

function renderChiamata(chiamata) {
  const card = document.getElementById('chiamata-card');
  card.className = 'chiamata-card attiva';
  const g = chiamata.giocatore;
  const ruoloCls = g.ruolo ? 'ruolo-' + g.ruolo : 'ruolo-XX';
  const tipoBadge = g.tipo && g.tipo !== 'NN' ? '<span class="cc-tipo-badge tipo-' + g.tipo + '">' + g.tipo + '</span>' : '';
  const origTxt = g.squadraOriginale && g.tipo !== 'NN' ? '<small class="text-muted">ex: ' + g.squadraOriginale + '</small>' : '';
  const offerenteTxt = chiamata.squadraOfferente
    ? 'Offerta di: <strong>' + chiamata.squadraOfferente + '</strong>'
    : '<span class="chiamata-stato">In attesa 1ª offerta...</span>';
  const offertaDisplay = chiamata.offertaAttuale === 0 ? '—' : chiamata.offertaAttuale;
  const offertaLabel = chiamata.offertaAttuale === 0 ? 'Nessuna offerta' : 'crediti';
  card.innerHTML = '<span class="cc-ruolo-badge ' + ruoloCls + '">' + (g.ruolo||'?') + '</span>' +
    '<p class="cc-nome">' + g.nome + '</p>' + tipoBadge + origTxt +
    '<p class="cc-offerta">' + offertaDisplay + '</p>' +
    '<p class="cc-offerta-label">' + offertaLabel + '</p>' +
    '<p class="cc-offerente">' + offerenteTxt + '</p>';
  aggiornaQuickBids();
}

function canBid() {
  if (!S.asta || !S.asta.chiamataAttuale) return false;
  if (S.attesaConferma) return false;
  const sq = getMiaSquadra();
  return sq && getMaxOfferta() > S.asta.chiamataAttuale.offertaAttuale;
}

function updateTimer(secondi, fase) {
  const el = document.getElementById('timer-display');
  el.textContent = secondi;
  el.className = secondi <= 5 ? 'timer urgente' : 'timer normale';
  document.getElementById('timer-label').textContent = fase === 'prima' ? 'prima offerta' : 'rilancio';
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
  const filtroRuolo = (document.getElementById('rose-filtro-ruolo') || {}).value || '';
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
  let tutti = [...disp.sort((a,b) => a.nome.localeCompare(b.nome)), ...scar.sort((a,b) => a.nome.localeCompare(b.nome))];
  if (S.filtroRuolo !== 'tutti') tutti = tutti.filter(g => g.ruolo === S.filtroRuolo);
  list.innerHTML = tutti.map(g => {
    const sc = g.scartato ? ' scartato' : '';
    const tb = g.tipo && g.tipo !== 'NN' ? '<span class="l-tipo tipo-' + g.tipo + '">' + g.tipo + '</span>' : '';
    const orig = g.squadraOriginale && g.tipo !== 'NN' ? '<span class="l-orig">(ex ' + g.squadraOriginale + ')</span>' : '';
    const click = (!g.scartato && S.isAdmin) ? ' onclick="chiamaLibero(\'' + g.id + '\')"' : '';
    return '<li class="' + sc + '"' + click + '><span class="l-ruolo">' + (g.ruolo||'?') + '</span>' +
      '<span class="l-nome">' + g.nome + '</span>' + orig + tb +
      '<span class="l-costo">' + g.costoOriginale + 'cr' + (g.scartato ? ' ✗' : '') + '</span></li>';
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
  const panel = document.getElementById('admin-panel');
  if (!S.isAdmin) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  const btnEstrai = document.getElementById('btn-estrai');
  if (asta && asta.tipoEstrazione === 'manuale') btnEstrai.classList.remove('hidden');
  else btnEstrai.classList.add('hidden');
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
  hidePoupOverride();
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
  hidePoupOverride();
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
  socket.emit('tradeoff', { astaId: S.astaId, tipo });
};

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

window.confermaChiamataManuale = function() {
  const nome = document.getElementById('inp-cm-nome').value.trim();
  const ruolo = document.getElementById('inp-cm-ruolo').value;
  if (!nome) return toast('Inserisci il nome', 'error');
  socket.emit('chiama-giocatore', { astaId: S.astaId, giocatoreManuale: { nome, ruolo } });
  document.getElementById('inp-cm-nome').value = '';
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
