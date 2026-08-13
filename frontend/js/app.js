// ASTA FANTASBOCCHINI — CLIENT v2

// == TEMA CHIARO/SCURO ==================================
// Applicato subito (prima del resto) per evitare flash del tema sbagliato al caricamento.
(function initTema() {
  try {
    if (localStorage.getItem('tema') === 'light') {
      document.documentElement.classList.add('theme-light');
    }
  } catch (e) {}
})();
window.toggleTema = function() {
  const isLight = document.documentElement.classList.toggle('theme-light');
  try { localStorage.setItem('tema', isLight ? 'light' : 'dark'); } catch (e) {}
  document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
    btn.textContent = isLight ? '☀️' : '🌙';
    btn.title = isLight ? 'Passa al tema scuro' : 'Passa al tema chiaro';
    btn.classList.toggle('muted', isLight);
  });
};
function _creaThemeToggleBottoni() {
  const isLight = document.documentElement.classList.contains('theme-light');
  const icon = isLight ? '☀️' : '🌙';
  const titolo = isLight ? 'Passa al tema scuro' : 'Passa al tema chiaro';
  // 1) Dentro alla barra icone dell'header dell'asta live (accanto a suono/impostazioni)
  const headerRight = document.querySelector('.asta-header-right');
  if (headerRight && !headerRight.querySelector('.theme-toggle-btn')) {
    const btn = document.createElement('button');
    btn.className = 'btn-sound theme-toggle-btn';
    btn.type = 'button';
    btn.id = 'btn-theme';
    btn.textContent = icon;
    btn.title = titolo;
    btn.onclick = window.toggleTema;
    const btnSound = document.getElementById('btn-sound');
    if (btnSound && btnSound.parentNode === headerRight) headerRight.insertBefore(btn, btnSound);
    else headerRight.insertBefore(btn, headerRight.firstChild);
  }
  // 2) In ogni header delle schermate home/lobby/strategie (in alto a sinistra, per non
  //    sovrapporsi al link "Esci"/"← Menu" che sta sempre in alto a destra)
  document.querySelectorAll('.home-header').forEach(header => {
    if (header.querySelector('.theme-toggle-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'theme-toggle-home theme-toggle-btn';
    btn.type = 'button';
    btn.textContent = icon;
    btn.title = titolo;
    btn.onclick = window.toggleTema;
    header.appendChild(btn);
  });
}
if (document.body) { _creaThemeToggleBottoni(); }
else { document.addEventListener('DOMContentLoaded', _creaThemeToggleBottoni); }

const socket = io({


  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000
});

const S = {
  astaId: null, miaSquadra: null, isAdmin: false, adminToken: null, asta: null,
  filtroRuolo: 'tutti', filtroStorico: 'tutti', svincoloSel: new Set(), popupAttivoCli: null,
  attesaConferma: false, timerTotal: 30,
  userRole: null, userId: null,
  strategiaAttuale: null, fasceAttuali: [], configGiocatori: new Map(),
  listinoCache: null, editorFiltroRuolo: 'tutti', editorCercaText: '', editorSelezionati: new Set(),
  strategiaAsta: null, liberiNascondiEstratti: false, liberiSoloPreferiti: false, _promptStrategiaAstaId: null
};

// ══ MODALITA' MANUTENZIONE ══════════════════════════════
// Stato letto dal server all'avvio e tenuto sincronizzato via socket ('manutenzione-changed').
// Quando attiva, blocca l'uso dell'app a chiunque non abbia ruolo 'admin' mostrando l'overlay
// #screen-manutenzione (sempre sopra a tutto, stesso pattern di #screen-emergenza).
let _manutenzioneAttiva = false;
function _aggiornaOverlayManutenzione() {
  const overlay = document.getElementById('screen-manutenzione');
  if (!overlay) return;
  const bloccare = _manutenzioneAttiva && S.userRole !== 'admin';
  overlay.classList.toggle('hidden', !bloccare);
}

// ══ SUPABASE (utenti + listino ufficiale) ════════════════
const SUPABASE_URL = 'https://boupigtvlowxajvwkuwr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJvdXBpZ3R2bG93eGFqdndrdXdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3NTA3MDYsImV4cCI6MjEwMDMyNjcwNn0.3GkbaKaJu7_6mZYkavDLAx7cW8qgraSyVKizMPYbXAA';
const supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
  } else if (t === 'manuale') {
    // Suono distinto (doppio "campanello") per segnalare che l'admin ha scelto il giocatore a mano
    _beep(660, 0.12, 'triangle', 0.35);
    setTimeout(() => _beep(990, 0.16, 'triangle', 0.35), 140);
  }
}
window.toggleSuoni = function() {
  const on = localStorage.getItem('suoni') !== '0';
  localStorage.setItem('suoni', on ? '0' : '1');
  const btn = document.getElementById('btn-sound');
  if (btn) { btn.textContent = on ? '🔇' : '🔊'; btn.classList.toggle('muted', on); }
};

// ══ NOTIFICHE BROWSER (avvisano anche se la tab non è in primo piano) ══════
function richiediPermessoNotifiche() {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') Notification.requestPermission();
  } catch (e) {}
}
function mostraNotificaBrowser(titolo, corpo) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (document.hasFocus()) return; // già visibile in app: evita doppio avviso mentre si guarda lo schermo
    const n = new Notification(titolo, { body: corpo, tag: 'asta-chiamata-manuale' });
    n.onclick = () => { try { window.focus(); n.close(); } catch(e) {} };
  } catch (e) {}
}



// ══ SESSION PERSISTENCE ══════════════════
// ══ SIMULAZIONE RUOLO (editor visuale) ══════════════
// Permette di aprire una vista "utente" o "admin" isolata dentro un iframe della
// stessa pagina SENZA leggere/sovrascrivere la sessione reale salvata in localStorage
// dell'utente che sta usando l'editor — così si possono avere entrambi i ruoli aperti
// contemporaneamente senza che si "rubino" la sessione a vicenda.
window._simParams = (function () {
  const p = new URLSearchParams(window.location.search);
  const ruolo = p.get('simRuolo');
  if (!ruolo) return null;
  return {
    ruolo,
    astaId: p.get('simAstaId') || '',
    nome: p.get('simNome') || 'Test',
    adminToken: p.get('simAdminToken') || null
  };
})();

function salvaSessione() {
  if (window._simParams) return; // non toccare mai la sessione reale durante una simulazione
  if (!S.astaId || !S.miaSquadra) return;
  localStorage.setItem('asta_session', JSON.stringify({
    astaId: S.astaId, nomeSquadra: S.miaSquadra, isAdmin: S.isAdmin, adminToken: S.adminToken || null
  }));
}
function cancSessione() {
  if (window._simParams) return; // non toccare mai la sessione reale durante una simulazione
  // Rimuove anche lo stato locale della asta corrente, per evitare che
  // localStorage accumuli all'infinito una copia completa di ogni asta mai giocata.
  if (S.astaId) { try { localStorage.removeItem('asta_stato_' + S.astaId); } catch(e) {} }
  localStorage.removeItem('asta_session');
}
// Pulizia automatica all'avvio: rimuove gli "asta_stato_*" più vecchi di 7 giorni,
// rimasti in localStorage da sessioni passate (prima di questo fix non venivano mai eliminati).
function _puliziaStatoLocaleVecchio() {
  try {
    const ORA = Date.now(), SETTE_GIORNI = 7 * 24 * 60 * 60 * 1000;
    const daRimuovere = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || key.indexOf('asta_stato_') !== 0) continue;
      try {
        const raw = JSON.parse(localStorage.getItem(key));
        const ts = raw && raw.timestamp ? new Date(raw.timestamp).getTime() : 0;
        if (!ts || (ORA - ts) > SETTE_GIORNI) daRimuovere.push(key);
      } catch (e) { daRimuovere.push(key); }
    }
    daRimuovere.forEach(k => localStorage.removeItem(k));
  } catch (e) { /* non-fatal */ }
}
_puliziaStatoLocaleVecchio();
function getSessione() {
  if (window._simParams) {
    const sp = window._simParams;
    if (!sp.astaId) return null;
    return {
      astaId: sp.astaId,
      nomeSquadra: sp.nome,
      isAdmin: sp.ruolo === 'admin',
      adminToken: sp.ruolo === 'admin' ? sp.adminToken : null
    };
  }
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

// ══ BACKUP/EXPORT — funzioni generiche (riusate sia dal menu live sia dallo Storico Esportazioni) ══
function _triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

function _exportAstaJSON(asta, prefix) {
  const data = { backup: true, timestamp: new Date().toISOString(), asta };
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  _triggerBlobDownload(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), prefix + '-' + ts + '.json');
}

function _exportAstaExcel(asta, prefix) {
  const XLSX = window.XLSX;
  if (!XLSX) return toast('Libreria Excel non disponibile', 'error');
  const wb = XLSX.utils.book_new();
  const riepilogo = asta.squadre.map(sq => ({
    'Squadra': sq.nome, 'Crediti': sq.crediti,
    'Giocatori': (sq.rosa||[]).length,
    'Slot RIC usati': sq.slotsRICUsati||0, 'Slot RIC tot': sq.slotsRIC||0,
    'Slot PLUS usati': sq.slotsPLUSUsati||0, 'Slot PLUS tot': sq.slotsPLUS||0,
    'Recompra usati': (sq.recompraUsati||0) + '/' + (sq.recompra!==undefined?sq.recompra:1)
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(riepilogo), 'Riepilogo');
  const roseRows = [];
  asta.squadre.forEach(sq => (sq.rosa||[]).forEach(g => {
    roseRows.push({ 'Squadra': sq.nome, 'Giocatore': g.nome, 'Ruolo': g.ruolo||'?', 'Prezzo': g.prezzo, 'Tipo': g.tipo||'normale' });
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(roseRows.length ? roseRows : [{}]), 'Rose');
  const storico = (asta.storico||[]).map((s,i) => ({
    '#': i+1, 'Giocatore': s.giocatore ? s.giocatore.nome : '?',
    'Ruolo': s.giocatore ? (s.giocatore.ruolo||'?') : '?',
    'Prezzo': s.prezzo, 'Squadra': s.squadra||'', 'Tipo': s.tipo||''
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(storico.length ? storico : [{}]), 'Storico');
  const liberi = (asta.poolGiocatori||[])
    .filter(g => !g.assegnato && !g.scartato)
    .map(g => ({ 'Giocatore': g.nome, 'Ruolo': g.ruolo||'?', 'Costo': g.costoOriginale, 'Tipo': g.tipo||'NN', 'Squadra orig.': g.squadraOriginale||'' }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(liberi.length ? liberi : [{}]), 'Liberi');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  XLSX.writeFile(wb, prefix + '-' + ts + '.xlsx');
}

function _exportAstaFantaleghe(asta, prefix) {
  const rows = [];
  let omessi = 0;
  (asta.storico || []).forEach(s => {
    if (s.tipo === 'scartato' || s.tipo === 'tradeoff') return;
    if (!s.giocatore || !s.squadra) return;
    const id = s.giocatore.idFantaleghe;
    if (id === null || id === undefined || id === '') { omessi++; return; }
    rows.push(s.squadra + ',' + id + ',' + s.prezzo);
  });
  if (!rows.length) {
    toast('Nessuna assegnazione con IdFantaleghe trovata' + (omessi ? ' (' + omessi + ' omessi)' : ''), 'error');
    return;
  }
  const lines = ['$,$,$'].concat(rows).concat(['$,$,$']);
  const csv = lines.join(String.fromCharCode(13,10));
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  _triggerBlobDownload(new Blob([csv], { type: 'text/csv' }), prefix + '-' + (asta.id||'') + '-' + ts + '.csv');
  if (omessi > 0) toast('⚠️ ' + omessi + ' giocatori omessi (IdFantaleghe mancante)', 'error');
  else toast('Fantaleghe CSV scaricato', 'success');
}

function _exportAstaRecap(asta, prefix) {
  const squadre = {};
  const ensure = (nome) => {
    if (!squadre[nome]) squadre[nome] = { conferme: [], plusvalenze: [], recompre: [], svincoli: [] };
    return squadre[nome];
  };
  (asta.squadre || []).forEach(sq => ensure(sq.nome));
  (asta.storico || []).forEach(s => {
    if (s.tipo === 'riconferma' && s.squadra && s.giocatore) {
      ensure(s.squadra).conferme.push({ giocatore: s.giocatore.nome, prezzo: s.prezzo });
    } else if (s.tipo === 'plusvalenza' && s.plusvalenzaA && s.giocatore) {
      ensure(s.plusvalenzaA).plusvalenze.push({ giocatore: s.giocatore.nome, guadagno: s.guadagno || 0 });
    } else if (s.tipo === 'recompra' && s.squadra && s.giocatore) {
      ensure(s.squadra).recompre.push({ giocatore: s.giocatore.nome, prezzo: s.prezzo });
    } else if (s.tipo === 'con_svincolo' && s.squadra && s.svincolati) {
      const dest = ensure(s.squadra);
      s.svincolati.forEach(g => dest.svincoli.push({ giocatore: g.nome }));
    }
  });
  const data = { astaId: asta.id, tipoAsta: asta.tipoAsta, squadre };
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  _triggerBlobDownload(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), prefix + '-' + (asta.id||'') + '-' + ts + '.json');
  toast('Recap scaricato', 'success');
}

// ══ BACKUP DOWNLOAD (asta live, dal menu 💾 Backup) ══════════════
window.downloadBackupJSON = function(fromLocal) {
  let asta;
  if (fromLocal || !S.asta) {
    const saved = getStatoLocale();
    if (!saved) return toast('Nessun backup locale disponibile', 'error');
    asta = saved.asta;
  } else {
    asta = S.asta;
  }
  _exportAstaJSON(asta, 'backup-asta');
  const bm = document.getElementById('backup-menu');
  if (bm) bm.classList.add('hidden');
};

window.downloadBackupExcel = function() {
  if (!S.asta) return toast('Nessun dato disponibile', 'error');
  _exportAstaExcel(S.asta, 'backup-asta');
  const bm = document.getElementById('backup-menu');
  if (bm) bm.classList.add('hidden');
};

window.downloadBackupEmergenza = function() { downloadBackupJSON(true); };

window.downloadFantaleghe = function() {
  if (!S.asta) return toast('Nessun dato disponibile', 'error');
  _exportAstaFantaleghe(S.asta, 'fantaleghe');
  const bm = document.getElementById('backup-menu');
  if (bm) bm.classList.add('hidden');
};

window.downloadRecap = function() {
  if (!S.asta) return toast('Nessun dato disponibile', 'error');
  _exportAstaRecap(S.asta, 'recap');
  const bm = document.getElementById('backup-menu');
  if (bm) bm.classList.add('hidden');
};

window.apriMenuBackup = function() {
  const bm = document.getElementById('backup-menu');
  if (bm) bm.classList.toggle('hidden');
};

// ══ STORICO ESPORTAZIONI (persistente su Supabase, accessibile dalla Home) ══════════════
async function _fetchExportPayload(id) {
  const res = await fetch('/api/exports/' + id);
  if (!res.ok) { toast('Esportazione non trovata (forse è stata cancellata)', 'error'); return null; }
  return res.json();
}

window.apriStoricoEsportazioni = async function() {
  showScreen('screen-menu-principale');
  openModal('modal-storico-esportazioni');
  await _ricaricaStoricoEsportazioni();
};

async function _ricaricaStoricoEsportazioni() {
  const box = document.getElementById('storico-esportazioni-lista');
  if (!box) return;
  box.innerHTML = '<p class="text-muted" style="text-align:center;padding:16px">⏳ Caricamento...</p>';
  try {
    const res = await fetch('/api/exports');
    const lista = await res.json();
    if (!Array.isArray(lista) || !lista.length) {
      box.innerHTML = '<p class="text-muted" style="text-align:center;padding:16px">Nessuna asta conclusa ancora esportata.</p>';
      return;
    }
    box.innerHTML = lista.map(item => {
      const data = new Date(item.createdAt);
      const dataStr = data.toLocaleDateString('it-IT') + ' ' + data.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
      return '<div class="storico-export-item">' +
        '<div class="storico-export-info">' +
          '<div class="storico-export-data">📅 ' + _escHtml(dataStr) + '</div>' +
          '<div class="storico-export-meta">' + _escHtml(item.tipoAsta || '?') + ' · ' + item.numSquadre + ' squadre</div>' +
        '</div>' +
        '<div class="storico-export-actions">' +
          '<button class="bk-btn" onclick="storicoScarica(\'' + item.id + '\',\'json\')">📄 JSON</button>' +
          '<button class="bk-btn" onclick="storicoScarica(\'' + item.id + '\',\'excel\')">📊 Excel</button>' +
          '<button class="bk-btn" onclick="storicoScarica(\'' + item.id + '\',\'fantaleghe\')">📤 Fantaleghe</button>' +
          '<button class="bk-btn" onclick="storicoScarica(\'' + item.id + '\',\'recap\')">📤 Recap</button>' +
          '<button class="bk-btn bk-btn-danger" onclick="storicoElimina(\'' + item.id + '\')">🗑️ Elimina</button>' +
        '</div>' +
      '</div>';
    }).join('');
  } catch (e) {
    box.innerHTML = '<p class="text-muted" style="text-align:center;padding:16px">⚠️ Errore di caricamento</p>';
  }
}

window.storicoScarica = async function(id, formato) {
  const asta = await _fetchExportPayload(id);
  if (!asta) return;
  const prefix = 'storico-' + id.slice(0, 8);
  if (formato === 'json') _exportAstaJSON(asta, prefix);
  else if (formato === 'excel') _exportAstaExcel(asta, prefix);
  else if (formato === 'fantaleghe') _exportAstaFantaleghe(asta, prefix);
  else if (formato === 'recap') _exportAstaRecap(asta, prefix);
};

window.storicoElimina = async function(id) {
  if (!confirm('Eliminare definitivamente questa esportazione? Non potrà essere recuperata.')) return;
  try {
    const res = await fetch('/api/exports/' + id, { method: 'DELETE' });
    if (!res.ok) throw new Error('delete failed');
    toast('Esportazione eliminata', 'success');
    _ricaricaStoricoEsportazioni();
  } catch (e) {
    toast('Errore durante l\'eliminazione', 'error');
  }
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
    socket.emit('join-asta', { astaId: S.astaId, nomeSquadra: S.miaSquadra, isAdmin: S.isAdmin, adminToken: S.adminToken });
    return;
  }
  // Fresh page load: restore any saved session from localStorage and rejoin proactively,
  // regardless of which screen the static HTML marks as active by default.
  const sess = getSessione();
  if (sess && sess.astaId && sess.nomeSquadra) {
    S.astaId = sess.astaId;
    S.miaSquadra = sess.nomeSquadra;
    S.isAdmin = !!sess.isAdmin;
    S.adminToken = sess.adminToken || null;
    document.getElementById('lobby-info-asta').textContent = 'Connessione in corso...';
    showScreen('screen-lobby');
    socket.emit('join-asta', { astaId: S.astaId, nomeSquadra: S.miaSquadra, isAdmin: S.isAdmin, adminToken: S.adminToken });
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
    socket.emit('join-asta', { astaId: S.astaId, nomeSquadra: S.miaSquadra, isAdmin: S.isAdmin, adminToken: S.adminToken });
  }
});

function entraConLinkInvito(id) {
  showScreen('screen-home');
  document.getElementById('inp-join-id').value = id;
  setTimeout(() => fetchAstaSquadrePerJoin(id), 300);
  const creaCard = document.getElementById('form-crea-asta').closest('.card');
  if (creaCard) creaCard.style.display = 'none';
  const header = document.querySelector('#screen-home .home-header');
  if (header) header.style.display = 'none';
  const linkIdGroup = document.getElementById('inp-join-id').closest('.form-group');
  if (linkIdGroup) linkIdGroup.style.display = 'none';
}

// Link "admin" speciale (?id=...&admin=TOKEN): permette di riottenere i privilegi
// di Admin su un secondo dispositivo/browser, senza dover indovinare nulla.
// Va condiviso SOLO dall'admin con se stesso, mai con gli altri partecipanti.
let _urlAdminId = null, _urlAdminToken = null;
document.addEventListener('DOMContentLoaded', async () => {
  richiediPermessoNotifiche();
  try {
    const res = await fetch('/api/admin/manutenzione-status');
    if (res.ok) { const data = await res.json(); _manutenzioneAttiva = !!data.manutenzioneAttiva; }
  } catch (e) { /* non-fatale: l'app resta usabile */ }
  _aggiornaOverlayManutenzione();
  const linkAccessoAdmin = document.getElementById('link-accesso-admin-manutenzione');
  if (linkAccessoAdmin) linkAccessoAdmin.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('screen-manutenzione').classList.add('hidden');
  });
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  const adminParam = params.get('admin');
  if (id && adminParam) {
    _urlAdminId = id; _urlAdminToken = adminParam;
    // Rimuove il token dalla barra degli indirizzi/history per evitare che finisca
    // per errore in uno screenshot o link condiviso.
    history.replaceState({}, '', '/?id=' + id);
  }
  if (id) {
    // Link di invito: login obbligatorio per poter usare le proprie strategie
    const { data } = await supa.auth.getSession();
    if (data && data.session && data.session.user) {
      await applicaUtenteLoggato(data.session.user);
      entraConLinkInvito(id);
    } else {
      S._invitoAstaId = id;
      showScreen('screen-login');
    }
  } else {
    await checkSessioneUtente();
  }
  // Restore session hint (pre-fill join field if no ID in URL)
  const sess = getSessione();
  if (sess && sess.astaId && !id) {
    document.getElementById('inp-join-id').value = sess.astaId;
    history.replaceState({}, '', '/?id=' + sess.astaId);
    setTimeout(() => fetchAstaSquadrePerJoin(sess.astaId), 400);
  }
  function safeSetup(fn) {
    try { fn(); } catch (e) { console.error('[init] errore in ' + (fn.name || 'setup anonimo') + ':', e); }
  }
  [setupHome, setupLobby, setupAsta, setupFilters, setupTabs, setupLogin, setupMenu, setupStrategie, setupEditor, setupStrategiaAsta, setupAnteprima, setupRoseCompatta, setupAstaMobileAccordion, setupRipristinaDaFile].forEach(safeSetup);
  // Warn before leaving page if in active asta
  window.addEventListener('beforeunload', (e) => {
    if (S.astaId && S.asta && S.asta.stato === 'in_corso') {
      e.preventDefault(); e.returnValue = '';
    }
  });
});

// ══ AUTENTICAZIONE UTENTI (Supabase) ═══════════════════
async function checkSessioneUtente() {
  const { data } = await supa.auth.getSession();
  if (data && data.session && data.session.user) {
    await applicaUtenteLoggato(data.session.user);
  } else {
    showScreen('screen-login');
  }
}

function _aggiornaUserEmailBadge(email) {
  const el = document.getElementById('user-email-badge');
  const elInline = document.getElementById('user-email-badge-inline');
  if (email) {
    if (el) { el.textContent = '👤 ' + email; el.classList.remove('hidden'); }
    if (elInline) { elInline.textContent = email; elInline.title = email; elInline.classList.remove('hidden'); }
  } else {
    if (el) { el.textContent = ''; el.classList.add('hidden'); }
    if (elInline) { elInline.textContent = ''; elInline.classList.add('hidden'); }
  }
}

// Completa lato server il profilo (nome/cognome/eta/accettazione Condizioni Closed Beta) se
// l'utente si e' registrato col nuovo flusso: e' un no-op per gli utenti esistenti (che non hanno
// questi dati in user_metadata) e per chi ha gia' completato la sincronizzazione in precedenza —
// vedi POST /api/auth/completa-registrazione in server.js per la logica di validazione/scrittura.
// Non deve mai bloccare il login: eventuali errori vengono solo loggati in console.
async function _completaRegistrazioneSeServe() {
  try {
    const { data: sessData } = await supa.auth.getSession();
    const accessToken = sessData && sessData.session ? sessData.session.access_token : null;
    if (!accessToken) return;
    const res = await fetch('/api/auth/completa-registrazione', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      console.warn('completa-registrazione ha risposto con errore:', res.status, body);
    } else {
      console.log('completa-registrazione:', res.status, body);
    }
  } catch (e) { console.warn('Sincronizzazione profilo registrazione fallita (non bloccante):', e); }
}

async function applicaUtenteLoggato(user) {
  S.userId = user.id;
  S.userEmail = user.email || null;
  _aggiornaUserEmailBadge(S.userEmail);
  _completaRegistrazioneSeServe();
  const { data: profile } = await supa.from('profiles').select('role').eq('id', user.id).single();
  S.userRole = (profile && profile.role) || 'utente';
  document.body.classList.toggle('app-role-admin', S.userRole === 'admin');
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) btnLogout.style.display = 'inline-block';
  const isAdmin = (S.userRole === 'admin');
  const adminCard = document.getElementById('card-listino-admin');
  if (adminCard) adminCard.style.display = isAdmin ? 'block' : 'none';
  const superAdminCard = document.getElementById('card-super-admin');
  if (superAdminCard) superAdminCard.style.display = isAdmin ? 'block' : 'none';
  if (isAdmin) { caricaStatoBackupSuperAdmin(); caricaStatoManutenzioneSuperAdmin(); }
  _aggiornaOverlayManutenzione();
  if (_manutenzioneAttiva && !isAdmin) return; // resta bloccato dall'overlay, non entra nel menu
  caricaMieAste();
  if (S._invitoAstaId) {
    const invitoId = S._invitoAstaId;
    S._invitoAstaId = null;
    entraConLinkInvito(invitoId);
  } else {
    showScreen('screen-menu-principale');
  }
}

// ══ MIE ASTE (Home) ══════════════════════════════════════════
// Mostra le aste create dall'utente loggato ancora "vive" (non terminate), permettendo
// di riprenderle da qualunque dispositivo senza dover conservare nessun link manualmente.
async function caricaMieAste() {
  // Il bottone "Riprendi Asta" (card-mie-aste) e' SEMPRE visibile — cambia solo cosa
  // offre: il "Ripristina da file" c'e' sempre, la lista delle aste live su Supabase
  // appare solo se il backup su Supabase e' attivo E ci sono davvero aste attive.
  const liveWrap = document.getElementById('mie-aste-live-wrap');
  const lista = document.getElementById('lista-mie-aste');
  if (!liveWrap || !lista) return;
  liveWrap.style.display = 'none';
  try {
    const { data: sessData } = await supa.auth.getSession();
    const accessToken = sessData && sessData.session ? sessData.session.access_token : null;
    if (!accessToken) return;

    const resStatus = await fetch('/api/admin/backup-status', { headers: { 'Authorization': 'Bearer ' + accessToken } });
    if (!resStatus.ok) return; // backup Supabase disattivato (o stato sconosciuto): solo "Ripristina da file"
    const statusData = await resStatus.json();
    if (!statusData.backupSupabaseAttivo) return;

    const res = await fetch('/api/mie-aste', { headers: { 'Authorization': 'Bearer ' + accessToken } });
    if (!res.ok) return;
    const aste = await res.json();
    if (!Array.isArray(aste) || aste.length === 0) return;
    liveWrap.style.display = 'block';
    lista.innerHTML = aste.map(a => {
      const nomeEsc = _escHtml(a.nome || 'Asta senza nome');
      const statoLabel = a.stato === 'attesa' ? 'In attesa' : a.stato === 'in_corso' ? 'In corso' : a.stato;
      return '<div class="settings-field" style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px">' +
        '<div><strong>' + nomeEsc + '</strong><br><span class="hint-text">' + statoLabel + ' · ' + (a.numSquadre || 0) + ' squadre</span></div>' +
        '<div style="display:flex;gap:8px">' +
          '<button type="button" class="btn btn-secondary" title="Scarica un backup di questa asta sul tuo dispositivo" onclick="scaricaBackupAsta(\'' + a.astaId + '\')">⬇️</button>' +
          '<button type="button" class="btn btn-primary" onclick="riprendiAsta(\'' + a.astaId + '\')">▶️ Riprendi</button>' +
        '</div>' +
      '</div>';
    }).join('');
  } catch (e) { liveWrap.style.display = 'none'; }
}

window.riprendiAsta = async function(astaId) {
  try {
    const { data: sessData } = await supa.auth.getSession();
    const accessToken = sessData && sessData.session ? sessData.session.access_token : null;
    if (!accessToken) return toast('Devi accedere per riprendere un\'asta', 'error');
    const res = await fetch('/api/asta/' + astaId + '/riprendi', { method: 'POST', headers: { 'Authorization': 'Bearer ' + accessToken } });
    const data = await res.json();
    if (!data.success) return toast(data.error || 'Impossibile riprendere questa asta', 'error');
    S.astaId = data.astaId; S.adminToken = data.adminToken; S.isAdmin = true;
    S.miaSquadra = null;
    salvaSessione();
    window.location.href = window.location.origin + '/?id=' + data.astaId + '&admin=' + data.adminToken;
  } catch (e) { toast('Errore di rete nel riprendere l\'asta', 'error'); }
};

// Scarica un backup completo dell'asta (stesso file usabile poi con "Ripristina da file")
// come seconda via di recupero manuale, indipendente dal backup automatico su Supabase.
window.scaricaBackupAsta = async function(astaId) {
  try {
    const { data: sessData } = await supa.auth.getSession();
    const accessToken = sessData && sessData.session ? sessData.session.access_token : null;
    if (!accessToken) return toast('Devi accedere per scaricare il backup', 'error');
    const res = await fetch('/api/asta/' + astaId + '/mio-backup', { headers: { 'Authorization': 'Bearer ' + accessToken } });
    const data = await res.json();
    if (!res.ok) return toast(data.error || 'Impossibile scaricare il backup', 'error');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    _triggerBlobDownload(new Blob([JSON.stringify(data)], { type: 'application/json' }), 'backup-asta-' + astaId + '-' + ts + '.json');
    toast('Backup scaricato', 'success');
  } catch (e) { toast('Errore di rete nello scaricare il backup', 'error'); }
};

// Ripristina un'asta a partire da un file di backup caricato manualmente (seconda via di
// recupero, se per qualsiasi motivo il backup automatico su Supabase non fosse disponibile).
function setupRipristinaDaFile() {
  const btn = document.getElementById('btn-ripristina-file');
  const inp = document.getElementById('inp-ripristina-file');
  if (!btn || !inp) return;
  btn.addEventListener('click', () => inp.click());
  inp.addEventListener('change', () => {
    const file = inp.files[0];
    inp.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const snap = JSON.parse(e.target.result);
        const { data: sessData } = await supa.auth.getSession();
        const accessToken = sessData && sessData.session ? sessData.session.access_token : null;
        if (!accessToken) return toast('Devi accedere per ripristinare un\'asta', 'error');
        const res = await fetch('/api/asta/ripristina-da-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + accessToken },
          body: JSON.stringify(snap)
        });
        const data = await res.json();
        if (!data.success) return toast(data.error || 'Impossibile ripristinare da questo file', 'error');
        S.astaId = data.astaId; S.adminToken = data.adminToken; S.isAdmin = true;
        S.miaSquadra = null;
        salvaSessione();
        window.location.href = window.location.origin + '/?id=' + data.astaId + '&admin=' + data.adminToken;
      } catch (err) { toast('File non valido', 'error'); }
    };
    reader.readAsText(file);
  });
}

function setupLogin() {
  const btnLogin = document.getElementById('btn-login');
  const btnSignup = document.getElementById('btn-signup');
  const btnLogout = document.getElementById('btn-logout');

  if (btnLogin) btnLogin.addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    errEl.style.display = 'none';
    if (!email || !password) { errEl.textContent = 'Compila tutti i campi'; errEl.style.display = 'block'; return; }
    const { data, error } = await supa.auth.signInWithPassword({ email, password });
    if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return; }
    await applicaUtenteLoggato(data.user);
  });

  const chkTerms = document.getElementById('signup-terms-checkbox');
  if (chkTerms && btnSignup) chkTerms.addEventListener('change', () => {
    btnSignup.disabled = !chkTerms.checked;
    btnSignup.textContent = chkTerms.checked ? 'Registrati' : 'Accetta le condizioni per registrarti';
  });

  const linkCondizioniBeta = document.getElementById('link-condizioni-beta');
  if (linkCondizioniBeta) linkCondizioniBeta.addEventListener('click', (e) => {
    e.preventDefault();
    openModal('modal-condizioni-beta');
  });

  if (btnSignup) btnSignup.addEventListener('click', async () => {
    const nome = document.getElementById('signup-nome').value.trim();
    const cognome = document.getElementById('signup-cognome').value.trim();
    const dataNascita = document.getElementById('signup-data-nascita').value; // 'YYYY-MM-DD' o ''
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const termsAccepted = !!(chkTerms && chkTerms.checked);
    const errEl = document.getElementById('signup-error');
    const okEl = document.getElementById('signup-success');
    errEl.style.display = 'none'; okEl.style.display = 'none';
    if (!nome || !cognome || !email || !password || !dataNascita) { errEl.textContent = 'Compila tutti i campi'; errEl.style.display = 'block'; return; }
    const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
    const nascita = new Date(dataNascita + 'T00:00:00');
    const centoVentAnniFa = new Date(oggi); centoVentAnniFa.setFullYear(oggi.getFullYear() - 120);
    if (isNaN(nascita.getTime()) || nascita > oggi || nascita < centoVentAnniFa) { errEl.textContent = 'Inserisci una data di nascita valida'; errEl.style.display = 'block'; return; }
    if (!termsAccepted) { errEl.textContent = 'Devi accettare le Condizioni di partecipazione alla Closed Beta per registrarti'; errEl.style.display = 'block'; return; }
    const { data, error } = await supa.auth.signUp({
      email, password,
      options: { data: { nome, cognome, dataNascita, termsAccepted: true, termsVersion: '2026-08-08' } }
    });
    if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return; }
    if (data.session) {
      await applicaUtenteLoggato(data.user);
    } else {
      okEl.textContent = 'Registrazione completata. Controlla la tua email per confermare, poi accedi.';
      okEl.style.display = 'block';
    }
  });

  if (btnLogout) btnLogout.addEventListener('click', async () => {
    await supa.auth.signOut();
    S.userRole = null; S.userId = null;
    _aggiornaUserEmailBadge(null);
    document.body.classList.remove('app-role-admin');
    btnLogout.style.display = 'none';
    const adminCard = document.getElementById('card-listino-admin');
    if (adminCard) adminCard.style.display = 'none';
    showScreen('screen-login');
  });

  const btnForgotPassword = document.getElementById('btn-forgot-password');
  if (btnForgotPassword) btnForgotPassword.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('recupero-email').value = document.getElementById('login-email').value.trim();
    document.getElementById('recupero-error').style.display = 'none';
    document.getElementById('recupero-success').style.display = 'none';
    openModal('modal-recupero-password');
  });

  const btnInviaRecupero = document.getElementById('btn-invia-recupero');
  if (btnInviaRecupero) btnInviaRecupero.addEventListener('click', async () => {
    const email = document.getElementById('recupero-email').value.trim();
    const errEl = document.getElementById('recupero-error');
    const okEl = document.getElementById('recupero-success');
    errEl.style.display = 'none'; okEl.style.display = 'none';
    if (!email) { errEl.textContent = 'Inserisci la tua email'; errEl.style.display = 'block'; return; }
    const { error } = await supa.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
    if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return; }
    okEl.textContent = 'Email inviata! Controlla la tua casella di posta e clicca sul link per impostare una nuova password.';
    okEl.style.display = 'block';
  });

  const btnSalvaNuovaPassword = document.getElementById('btn-salva-nuova-password');
  if (btnSalvaNuovaPassword) btnSalvaNuovaPassword.addEventListener('click', async () => {
    const pwd = document.getElementById('nuova-password').value;
    const pwdConferma = document.getElementById('nuova-password-conferma').value;
    const errEl = document.getElementById('nuova-password-error');
    const okEl = document.getElementById('nuova-password-success');
    errEl.style.display = 'none'; okEl.style.display = 'none';
    if (!pwd || pwd.length < 6) { errEl.textContent = 'La password deve avere almeno 6 caratteri'; errEl.style.display = 'block'; return; }
    if (pwd !== pwdConferma) { errEl.textContent = 'Le password non coincidono'; errEl.style.display = 'block'; return; }
    const { error } = await supa.auth.updateUser({ password: pwd });
    if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return; }
    okEl.textContent = 'Password aggiornata! Reindirizzamento in corso...';
    okEl.style.display = 'block';
    setTimeout(async () => {
      closeModal();
      const { data } = await supa.auth.getSession();
      if (data && data.session && data.session.user) {
        await applicaUtenteLoggato(data.session.user);
      } else {
        showScreen('screen-login');
      }
    }, 1500);
  });

  supa.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
      document.getElementById('nuova-password').value = '';
      document.getElementById('nuova-password-conferma').value = '';
      document.getElementById('nuova-password-error').style.display = 'none';
      document.getElementById('nuova-password-success').style.display = 'none';
      openModal('modal-nuova-password');
    }
  });

  const btnChoiceListino = document.getElementById('btn-choice-listino');
  const inpListino = document.getElementById('inp-listino-excel');
  if (btnChoiceListino && inpListino) {
    btnChoiceListino.addEventListener('click', () => inpListino.click());
    inpListino.addEventListener('change', (e) => handleListinoExcelFile(e.target.files[0]));
  }

  const btnSuperAdminChiudiTutte = document.getElementById('btn-super-admin-chiudi-tutte');
  if (btnSuperAdminChiudiTutte) {
    btnSuperAdminChiudiTutte.addEventListener('click', handleSuperAdminChiudiTutteLeAste);
  }

  const chkSuperAdminBackupToggle = document.getElementById('chk-super-admin-backup-toggle');
  if (chkSuperAdminBackupToggle) {
    chkSuperAdminBackupToggle.addEventListener('change', (e) => handleToggleBackupSuperAdmin(e.target.checked));
  }

  const chkSuperAdminManutenzioneToggle = document.getElementById('chk-super-admin-manutenzione-toggle');
  if (chkSuperAdminManutenzioneToggle) {
    chkSuperAdminManutenzioneToggle.addEventListener('change', (e) => handleToggleManutenzioneSuperAdmin(e.target.checked));
  }
}

// Carica lo stato attuale del toggle "backup su Supabase" e aggiorna il checkbox di
// conseguenza, così riflette sempre la realtà del server (utile se lo si è disattivato
// da un altro dispositivo/sessione e ci si è scordati di riattivarlo).
async function caricaStatoBackupSuperAdmin() {
  const chk = document.getElementById('chk-super-admin-backup-toggle');
  if (!chk) return;
  try {
    const { data: sessionData } = await supa.auth.getSession();
    const accessToken = sessionData && sessionData.session ? sessionData.session.access_token : null;
    if (!accessToken) return;
    const res = await fetch('/api/admin/backup-status', {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });
    if (!res.ok) return;
    const data = await res.json();
    chk.checked = !!data.backupSupabaseAttivo;
  } catch (e) { /* non-fatale: lascia il checkbox nel suo stato di default */ }
}

async function handleToggleBackupSuperAdmin(attivo) {
  const chk = document.getElementById('chk-super-admin-backup-toggle');
  const statusEl = document.getElementById('super-admin-backup-status');
  const { data: sessionData } = await supa.auth.getSession();
  const accessToken = sessionData && sessionData.session ? sessionData.session.access_token : null;
  if (!accessToken) { toast('Devi accedere per eseguire questa azione', 'error'); if (chk) chk.checked = !attivo; return; }
  try {
    const res = await fetch('/api/admin/toggle-backup', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ attivo })
    });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'Errore durante il cambio di stato', 'error');
      if (chk) chk.checked = !attivo;
      return;
    }
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.textContent = data.backupSupabaseAttivo
        ? 'Backup su Supabase riattivato.'
        : 'Backup su Supabase disattivato (il backup locale su disco resta attivo).';
    }
    toast(data.backupSupabaseAttivo ? 'Backup su Supabase riattivato' : 'Backup su Supabase disattivato', 'success');
  } catch (e) {
    toast('Errore di rete durante il cambio di stato', 'error');
    if (chk) chk.checked = !attivo;
  }
}

// Carica lo stato attuale del toggle "manutenzione" e aggiorna il checkbox di conseguenza
// (stesso motivo del backup: puo' essere stato attivato da un altro dispositivo/sessione).
async function caricaStatoManutenzioneSuperAdmin() {
  const chk = document.getElementById('chk-super-admin-manutenzione-toggle');
  if (!chk) return;
  chk.checked = _manutenzioneAttiva;
}

async function handleToggleManutenzioneSuperAdmin(attiva) {
  const chk = document.getElementById('chk-super-admin-manutenzione-toggle');
  const statusEl = document.getElementById('super-admin-manutenzione-status');
  const { data: sessionData } = await supa.auth.getSession();
  const accessToken = sessionData && sessionData.session ? sessionData.session.access_token : null;
  if (!accessToken) { toast('Devi accedere per eseguire questa azione', 'error'); if (chk) chk.checked = !attiva; return; }
  try {
    const res = await fetch('/api/admin/toggle-manutenzione', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ attiva })
    });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'Errore durante il cambio di stato', 'error');
      if (chk) chk.checked = !attiva;
      return;
    }
    _manutenzioneAttiva = !!data.manutenzioneAttiva;
    _aggiornaOverlayManutenzione();
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.textContent = _manutenzioneAttiva
        ? 'Manutenzione attiva: solo gli Admin possono usare l\'app.'
        : 'Manutenzione disattivata: l\'app e\' di nuovo accessibile a tutti.';
    }
    toast(_manutenzioneAttiva ? 'Modalita\' manutenzione attivata' : 'Modalita\' manutenzione disattivata', 'success');
  } catch (e) {
    toast('Errore di rete durante il cambio di stato', 'error');
    if (chk) chk.checked = !attiva;
  }
}

// Tiene sincronizzato il checkbox su TUTTI i dispositivi/sessioni Admin connessi quando
// uno di loro cambia il toggle (es. Admin A lo disattiva dal telefono, Admin B lo vede
// aggiornarsi da solo sul portatile, senza dover ricaricare la pagina).
socket.on('backup-toggle-changed', ({ backupSupabaseAttivo }) => {
  const chk = document.getElementById('chk-super-admin-backup-toggle');
  if (chk) chk.checked = !!backupSupabaseAttivo;
});

// Applica in tempo reale l'attivazione/disattivazione della manutenzione a TUTTI i
// client connessi (blocca/sblocca subito chi sta gia' usando l'app, senza reload).
socket.on('manutenzione-changed', ({ manutenzioneAttiva }) => {
  _manutenzioneAttiva = !!manutenzioneAttiva;
  _aggiornaOverlayManutenzione();
  const chk = document.getElementById('chk-super-admin-manutenzione-toggle');
  if (chk) chk.checked = _manutenzioneAttiva;
});

async function handleSuperAdminChiudiTutteLeAste() {
  const conferma1 = confirm(
    'ATTENZIONE: stai per chiudere e cancellare TUTTE le aste attualmente aperte, ' +
    'comprese eventuali aste in corso con partecipanti attivi in questo momento.\n\n' +
    'Questa azione e\' IRREVERSIBILE.\n\nVuoi continuare?'
  );
  if (!conferma1) return;
  const conferma2 = confirm(
    'Ultima conferma: sei DAVVERO sicuro di voler chiudere TUTTE le aste aperte adesso?\n\n' +
    'Scrivi "OK" mentalmente e premi Conferma solo se sei certo.'
  );
  if (!conferma2) return;

  const statusEl = document.getElementById('super-admin-status');
  const { data: sessionData } = await supa.auth.getSession();
  const accessToken = sessionData && sessionData.session ? sessionData.session.access_token : null;
  if (!accessToken) return toast('Devi accedere per eseguire questa azione', 'error');

  try {
    if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'Chiusura in corso...'; }
    const res = await fetch('/api/admin/chiudi-tutte-le-aste', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'Errore durante la chiusura delle aste', 'error');
      if (statusEl) statusEl.textContent = 'Errore: ' + (data.error || 'sconosciuto');
      return;
    }
    toast('Chiuse ' + data.chiuse + ' aste', 'success');
    if (statusEl) statusEl.textContent = 'Chiuse ' + data.chiuse + ' aste con successo.';
  } catch (e) {
    toast('Errore di rete durante la chiusura delle aste', 'error');
    if (statusEl) statusEl.textContent = 'Errore di rete.';
  }
}

function handleListinoExcelFile(file) {
  if (!file) return;
  const statusEl = document.getElementById('listino-upload-status');
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (!rows.length) return toast('Il file Excel è vuoto', 'error');

      const norm = s => (s || '').toString().trim().toLowerCase();
      const headers = Object.keys(rows[0]);
      const findCol = (...names) => headers.find(h => names.some(n => norm(h) === norm(n)));

      // Formato Listino Ufficiale Mantra: # Nome | Fuori lista | Sq. | Under | R. | R.MANTRA |
      // PGv | MV | FM | FVM/1000 | QUOT. | FantaSquadra | Costo — usiamo solo le colonne che
      // servono. IMPORTANTE: usiamo sempre R.MANTRA per i ruoli, mai R. (quella è Fantacalcio
      // Classic, questa app è basata esclusivamente su Mantra).
      const colId = findCol('#', 'Id', 'ID');
      const colNome = findCol('Nome', 'Giocatore');
      const colSquadra = findCol('Sq.', 'Squadra');
      const colUnder = findCol('Under');
      const colRuoloMantra = findCol('R.MANTRA', 'R.Mantra', 'RM');
      const colPgv = findCol('PGv');
      const colMv = findCol('MV');
      const colFm = findCol('FM');
      const colFvm1000 = findCol('FVM/1000', 'FVM1000');
      const colQuot = findCol('QUOT.', 'QUOT', 'Quotazione');

      if (!colId || !colNome || !colRuoloMantra) {
        toast('Colonne obbligatorie mancanti nel listino (#, Nome, R.MANTRA)', 'error');
        return;
      }

      const listino = rows.filter(r => r[colId] !== '' && r[colNome]).map(r => {
        const eta = colUnder && r[colUnder] !== '' ? Number(r[colUnder]) : null;
        return {
          id: Number(r[colId]),
          nome: r[colNome],
          ruolo: r[colRuoloMantra],
          squadra_reale: colSquadra ? (r[colSquadra] || null) : null,
          quotazione: colQuot && r[colQuot] !== '' ? Number(r[colQuot]) : null,
          fvm1000: colFvm1000 && r[colFvm1000] !== '' ? Number(r[colFvm1000]) : null,
          eta,
          u21: eta != null && eta <= 21,
          pgv: colPgv && r[colPgv] !== '' ? Number(r[colPgv]) : null,
          mv: colMv && r[colMv] !== '' ? Number(r[colMv]) : null,
          fm: colFm && r[colFm] !== '' ? Number(r[colFm]) : null
        };
      });

      if (!listino.length) return toast('Nessun giocatore valido trovato nel listino', 'error');

      statusEl.style.display = 'block';
      statusEl.textContent = 'Caricamento in corso...';

      const { data: sessData } = await supa.auth.getSession();
      const token = sessData && sessData.session ? sessData.session.access_token : null;

      const res = await fetch('/api/listino/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ listino })
      });
      const out = await res.json();
      if (!res.ok) {
        statusEl.textContent = '❌ ' + (out.error || 'Errore nel caricamento');
        toast(out.error || 'Errore nel caricamento del listino', 'error');
        return;
      }
      statusEl.textContent = '✅ Listino aggiornato: ' + out.totalGiocatori + ' giocatori (' + out.eliminati + ' rimossi)';
      toast('Listino ufficiale aggiornato', 'success');
    } catch (err) {
      toast('Errore nella lettura del file: ' + err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

// ══ WAKE LOCK (schermo sempre acceso durante l'asta live) ══════════════
// Il browser rilascia automaticamente il wake lock quando la tab va in background
// (es. si passa ad un'altra app per un attimo), senza riacquisirlo da solo: bisogna
// rifarne richiesta al ritorno in foreground, altrimenti resta disattivato per il
// resto della sessione anche tornando sulla schermata asta.
let _wakeLock = null;
async function _richiediWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try { _wakeLock = await navigator.wakeLock.request('screen'); }
  catch (e) { /* non-fatale: es. batteria bassa o permesso negato dal sistema */ }
}
function _rilasciaWakeLock() {
  if (_wakeLock) { _wakeLock.release().catch(() => {}); _wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && document.getElementById('screen-asta').classList.contains('active')) {
    _richiediWakeLock();
  }
});

// Torna alla Home con un refresh completo della pagina (non una semplice showScreen).
// Motivo: c'e' stato reale che oggi non si resetta mai tornando al menu (es.
// window._jsonData dell'ultima asta creata/importata, usato per popolare lo
// dropdown "La tua squadra" e il payload di creazione di UNA PROSSIMA asta) — dopo
// aver finito un'asta e crearne una nuova senza ricaricare, restavano visibili nomi
// squadra dell'asta precedente. Un reload vero riparte a stato zero, garantito.
function tornaAllaHome() {
  window.location.href = window.location.origin + '/';
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
  if (id === 'screen-asta') _richiediWakeLock();
  else _rilasciaWakeLock();
  // caricaMieAste() viene chiamata solo al login: se si torna al menu dopo essere
  // usciti da un'asta (es. asta appena conclusa), "Riprendi Asta" resterebbe con la
  // lista vecchia finche' non si ricarica la pagina a mano. Rifacendo qui la fetch
  // ogni volta che si rientra nel menu, la sezione resta sempre aggiornata.
  if (id === 'screen-menu-principale') caricaMieAste();
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
  const btnChoiceExcel = document.getElementById('btn-choice-excel');
  const btnChoiceJson = document.getElementById('btn-choice-json');
  const inpExcelChoice = document.getElementById('inp-excel-choice');
  const btnBackHome = document.getElementById('btn-back-home');
  const btnBackHomeMenu = document.getElementById('btn-back-home-menu');
  if (btnChoiceJson) btnChoiceJson.addEventListener('click', () => showScreen('screen-crea-asta'));
  if (btnChoiceExcel) btnChoiceExcel.addEventListener('click', () => inpExcelChoice.click());
  const btnUsaListino = document.getElementById('btn-usa-listino-ufficiale');
  if (btnUsaListino) btnUsaListino.addEventListener('click', usaListinoUfficialePerNuovaAsta);
  if (inpExcelChoice) inpExcelChoice.addEventListener('change', () => handleExcelFile(inpExcelChoice.files[0]));
  if (btnBackHome) btnBackHome.addEventListener('click', () => showScreen('screen-home'));
  if (btnBackHomeMenu) btnBackHomeMenu.addEventListener('click', tornaAllaHome);
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
      maxGiocatoriPerSquadra: parseInt(document.getElementById('inp-max-gioc').value) || 25,
      svincoliTotali: parseInt(document.getElementById('inp-svincoli').value) || 15,
      squadreJson: window._jsonData ? window._jsonData.squadre : null,
      svincolatiJson: window._jsonData ? window._jsonData.svincolati : null
    };
    try {
      const { data: sessData } = await supa.auth.getSession();
      const accessToken = sessData && sessData.session ? sessData.session.access_token : null;
      if (!accessToken) return toast('Devi accedere con il tuo account per creare un\'asta', 'error');
      const res = await fetch('/api/asta', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + accessToken }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok && !data.success) return toast(data.error || 'Errore nella creazione dell\'asta', 'error');
      if (data.success) {
        S.astaId = data.astaId; S.miaSquadra = adminNome; S.isAdmin = true; S.adminToken = data.adminToken || null;
        socket.emit('join-asta', { astaId: S.astaId, nomeSquadra: S.miaSquadra, isAdmin: true, adminToken: S.adminToken }); salvaSessione();
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
    // Il ruolo di Admin richiede il token segreto (mai il solo nome squadra):
    // - da una sessione salvata in questo stesso browser (il creatore che ricarica/rientra), oppure
    // - da un link "admin" speciale (con ?admin=TOKEN) apertosi in questa pagina.
    const tokenSessione = (sessPrev && sessPrev.astaId === input && sessPrev.nomeSquadra === nome) ? sessPrev.adminToken : null;
    const adminTokenDaUsare = tokenSessione || (_urlAdminToken && _urlAdminId === input ? _urlAdminToken : null);
    const isAdminReale = !!adminTokenDaUsare;
    S.astaId = input; S.miaSquadra = nome; S.isAdmin = isAdminReale; S.adminToken = adminTokenDaUsare; S.asta = null;
    socket.emit('join-asta', { astaId: S.astaId, nomeSquadra: S.miaSquadra, isAdmin: isAdminReale, adminToken: S.adminToken }); salvaSessione();
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

// Crea un'asta partendo dal Listino Ufficiale (Supabase, tabella listino_giocatori):
// tutti i giocatori entrano come svincolati (squadre = []), pronti per essere chiamati,
// senza dover caricare nessun file. Il valore iniziale di ogni giocatore libero è QUOT.
// (quotazione), non un valore ricalcolato — l'utente riempie il resto del form a mano
// come già fa con Excel/JSON.
async function usaListinoUfficialePerNuovaAsta() {
  const btn = document.getElementById('btn-usa-listino-ufficiale');
  const labelOriginale = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Caricamento...'; }
  try {
    const { data, error } = await supa.from('listino_giocatori').select('*').order('nome');
    if (error) throw error;
    if (!data || !data.length) {
      toast('Nessun Listino Ufficiale caricato: chiedi a un Admin di caricarlo prima', 'error');
      return;
    }
    const svincolati = data.map(r => ({
      nome: r.nome,
      ruolo: r.ruolo,
      squadra: r.squadra_reale,
      pgv: r.pgv, mv: r.mv, fm: r.fm,
      fvmp600: r.fvm1000,
      costo: r.quotazione, valore: r.quotazione,
      idFantaleghe: r.id,
      under: r.eta, u21: r.u21,
      quotazione: r.quotazione
    }));
    const data2 = { squadre: [], svincolati };
    window._jsonData = data2;
    const box = document.getElementById('json-preview');
    if (box) {
      box.innerHTML = '<strong>🏆 Listino Ufficiale caricato: ' + svincolati.length + ' giocatori liberi</strong>';
      box.classList.remove('hidden');
    }
    const dropLabel = document.getElementById('file-drop-label');
    if (dropLabel) dropLabel.textContent = '✅ Listino Ufficiale (' + svincolati.length + ' giocatori)';
    aggiornaAdminNomeDropdown(data2);
    toast('Listino Ufficiale caricato: ' + svincolati.length + ' giocatori liberi', 'success');
    showScreen('screen-crea-asta');
  } catch (err) {
    toast('Errore nel caricamento del Listino Ufficiale: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = labelOriginale; }
  }
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

function handleExcelFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (!rows.length) return toast('Il file Excel è vuoto', 'error');

      const norm = s => (s || '').toString().trim().toLowerCase();
      const headers = Object.keys(rows[0]);
      const findCol = (...names) => headers.find(h => names.some(n => norm(h) === norm(n)));

      const colGiocatore = findCol('Giocatore');
      const colSquadra = findCol('Squadra');
      const colRuolo = findCol('Ruolo');
      const colPgv = findCol('PGv');
      const colMv = findCol('MV');
      const colFm = findCol('FM');
      const colFvmp600 = findCol('FVMp600');
      const colQam = findCol('QAM');
      const colFantaSquadra = findCol('FantaSquadra');
      const colCosto = findCol('Costo');
      const colRP = findCol('R/P', 'RP');
      const colId = findCol('#', 'Id', 'ID');

      const obbligatorie = [
        ['Giocatore', colGiocatore], ['Ruolo', colRuolo],
        ['FantaSquadra', colFantaSquadra], ['Costo', colCosto], ['R/P', colRP]
      ];
      const mancanti = obbligatorie.filter(([_, c]) => !c).map(([nome]) => nome);
      if (mancanti.length) {
        return toast('Colonna obbligatoria mancante nell\'Excel: ' + mancanti.join(', '), 'error');
      }

      const giocatoriPerSquadra = {};
      rows.forEach(row => {
        const nome = row[colGiocatore];
        if (!nome) return;
        const fantaSquadra = row[colFantaSquadra] || 'Senza squadra';
        const g = {
          nome,
          squadra: colSquadra && row[colSquadra] !== '' ? row[colSquadra] : null,
          ruolo: row[colRuolo],
          pgv: colPgv && row[colPgv] !== '' ? row[colPgv] : null,
          mv: colMv && row[colMv] !== '' ? row[colMv] : null,
          fm: colFm && row[colFm] !== '' ? row[colFm] : null,
          fvmp600: colFvmp600 && row[colFvmp600] !== '' ? row[colFvmp600] : null,
          qam: colQam && row[colQam] !== '' ? row[colQam] : null,
          tipo: (row[colRP] || 'NN').toString().toUpperCase(),
          costo: row[colCosto] || 1,
          squadraOriginale: fantaSquadra,
          idFantaleghe: colId && row[colId] !== '' ? row[colId] : null
        };
        if (!giocatoriPerSquadra[fantaSquadra]) giocatoriPerSquadra[fantaSquadra] = [];
        giocatoriPerSquadra[fantaSquadra].push(g);
      });

      const squadre = Object.keys(giocatoriPerSquadra).map(nome => ({ nome, giocatori: giocatoriPerSquadra[nome] }));
      if (!squadre.length) return toast('Nessun giocatore valido trovato nel file', 'error');

      const data = { squadre };
      window._jsonData = data;
      renderJsonPreview(data);
      const dropLabel = document.getElementById('file-drop-label');
      if (dropLabel) dropLabel.textContent = '✅ ' + file.name + ' importato (Excel)';
      toast('Excel importato: ' + squadre.length + ' squadre', 'success');
      aggiornaAdminNomeDropdown(data);
      showScreen('screen-crea-asta');
    } catch (err) {
      toast('Errore nella lettura del file Excel: ' + err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function renderJsonPreview(data) {
  const box = document.getElementById('json-preview');
  if (!data.squadre) { box.classList.add('hidden'); return; }
  box.innerHTML = '<strong>Squadre rilevate (' + data.squadre.length + '):</strong>' +
    data.squadre.map(s => '<div class="sq-item"><span class="sq-nome">' + _escHtml(s.nome) + '</span>' +
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
  document.getElementById('btn-assegna-manuale').addEventListener('click', () => apriModalAssegnaManuale());
  const btnScartaAttuale = document.getElementById('btn-scarta-attuale');
  if (btnScartaAttuale) btnScartaAttuale.addEventListener('click', () => {
    if (!S.asta || !S.asta.chiamataAttuale) return;
    if (!confirm('Scartare ' + S.asta.chiamataAttuale.giocatore.nome + ' senza aspettare il timer?')) return;
    socket.emit('scarta-manuale', { astaId: S.astaId });
  });

  // Toggle manuale: se l'admin vuole vedere i bottoni azione anche mentre c'è un popup/conferma in attesa.
  // NOTA: #admin-actions-box viene nascosto con .hidden (display:none!important) da JS quando c'è
  // una conferma in attesa (nascondiConfermaBox/attesa-conferma) — va tolta anche quella classe,
  // altrimenti mostrare solo .admin-btn-grid non ha effetto perché il genitore resta display:none.
  const btnToggleAdminBtns = document.getElementById('btn-toggle-admin-btns');
  if (btnToggleAdminBtns) btnToggleAdminBtns.addEventListener('click', () => {
    const panel = document.getElementById('admin-panel');
    const actionsBox = document.getElementById('admin-actions-box');
    const showing = panel.classList.toggle('force-show-btns');
    if (actionsBox) actionsBox.classList.toggle('hidden', !showing);
  });

  // Pillola flottante compatta (angolo basso-destra) — stessa funzione dei bottoni admin, solo admin
  const pillChiama = document.getElementById('pill-chiama');
  if (pillChiama) pillChiama.addEventListener('click', () => {
    if (!S.isAdmin) return;
    if (S.asta && S.asta.chiamataAttuale) return toast('Chiamata già in corso', 'error');
    apriModalChiamaManuale();
  });
  const pillAssegna = document.getElementById('pill-assegna');
  if (pillAssegna) pillAssegna.addEventListener('click', () => {
    if (!S.isAdmin) return;
    if (S.asta && S.asta.chiamataAttuale) return toast('Chiamata già in corso', 'error');
    apriModalAssegnaManuale();
  });
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
  document.getElementById('btn-reintroduci').addEventListener('click', () => {
    const nScartati = ((S.asta && S.asta.poolGiocatori) || []).filter(g => g.scartato).length;
    if (!nScartati) return toast('Nessun giocatore scartato da reintrodurre', 'info');
    if (!confirm('Reintrodurre TUTTI i ' + nScartati + ' giocatori scartati? Torneranno disponibili per una nuova chiamata.')) return;
    socket.emit('reintroduci-scartati', { astaId: S.astaId });
  });
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
  const btnFineAstaHome = document.getElementById('btn-fine-asta-home');
  if (btnFineAstaHome) btnFineAstaHome.addEventListener('click', tornaAllaHome);
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

// Forza la visibilita' del box di rilancio su mobile (vista utente) con stili
// inline !important via JS: bypassa qualsiasi conflitto tra le tante regole CSS
// storiche su .rilancio-box/.puja-panel-slot che potevano lasciarlo a display:none
// o altezza 0 su alcuni telefoni (es. Samsung Chrome).
function forzaVisibilitaRilancioMobile() {
  const box = document.getElementById('rilancio-box');
  if (!box || S.isAdmin) return;
  const slot = document.getElementById('puja-panel-slot');
  const cardGroup = document.getElementById('card-timer-group');
  const quickRow = box.querySelector('.quick-bids-row');
  const manualRow = box.querySelector('.manual-bid-row');
  const btnRil = document.getElementById('btn-rilancio');
  const strategiaInfo = document.querySelector('#chiamata-card .cc-strategia-info');
  const boxTargets = [box, quickRow, manualRow, btnRil].filter(Boolean);
  const structuralTargets = [slot, cardGroup].filter(Boolean);
  const isMobile = window.innerWidth <= 1200;

  if (!isMobile) {
    // Desktop/tablet: revertire tutto (struttura + box), nessun forzatura JS necessaria.
    [].concat(boxTargets, structuralTargets, strategiaInfo ? [strategiaInfo] : []).forEach(function(el) {
      ['display','visibility','opacity','position','height','max-height','overflow',
       'width','max-width','min-width','flex','flex-direction','flex-wrap','flex-basis',
       'gap','margin-top'].forEach(function(p) { el.style.removeProperty(p); });
    });
    return;
  }

  // ══ Mobile: la struttura (foto/dati giocatore in colonna sopra il timer) va
  // SEMPRE forzata, indipendentemente da rilancio-box essere visibile o nascosto
  // (es. prima offerta, o "aspettando conferma" con rilBox/timerWrap nascosti
  // apposta per congelare la puja). Solo il contenuto interno del box di
  // rilancio dipende dalla sua classe .hidden. ══
  if (slot) {
    slot.style.setProperty('display', 'flex', 'important');
    slot.style.setProperty('flex-direction', 'column', 'important');
    slot.style.setProperty('width', '100%', 'important');
    slot.style.setProperty('max-width', '100%', 'important');
    slot.style.setProperty('overflow', 'visible', 'important');
    slot.style.setProperty('max-height', 'none', 'important');
    slot.style.setProperty('height', 'auto', 'important');
  }
  if (cardGroup) {
    cardGroup.style.setProperty('width', '100%', 'important');
    cardGroup.style.setProperty('flex', 'none', 'important');
    cardGroup.style.setProperty('flex-direction', 'column', 'important');
  }

  if (box.classList.contains('hidden')) {
    // Box di rilancio nascosto apposta (prima offerta senza timer avviato, o
    // aspettando conferma admin): non forzare nulla sul suo contenuto, ma la
    // struttura sopra (slot/cardGroup) resta comunque forzata in colonna.
    boxTargets.forEach(function(el) {
      ['display','visibility','opacity','position','height','max-height','overflow',
       'width','max-width','min-width','flex','flex-direction','flex-wrap','flex-basis',
       'gap','margin-top'].forEach(function(p) { el.style.removeProperty(p); });
    });
  } else {
    // Box di rilancio: sempre sotto, a piena larghezza, mai accanto alla card.
    box.style.setProperty('display', 'flex', 'important');
    box.style.setProperty('flex-direction', 'column', 'important');
    box.style.setProperty('visibility', 'visible', 'important');
    box.style.setProperty('opacity', '1', 'important');
    box.style.setProperty('position', 'static', 'important');
    box.style.setProperty('height', 'auto', 'important');
    box.style.setProperty('max-height', 'none', 'important');
    box.style.setProperty('overflow', 'visible', 'important');
    box.style.setProperty('width', '100%', 'important');
    box.style.setProperty('max-width', '100%', 'important');
    box.style.setProperty('min-width', '0', 'important');
    box.style.setProperty('flex', 'none', 'important');
    box.style.setProperty('gap', '10px', 'important');
    box.style.setProperty('margin-top', '10px', 'important');
    if (quickRow) {
      quickRow.style.setProperty('display', 'flex', 'important');
      quickRow.style.setProperty('flex-direction', 'row', 'important');
      quickRow.style.setProperty('flex-wrap', 'wrap', 'important');
      quickRow.style.setProperty('width', '100%', 'important');
      quickRow.style.setProperty('gap', '8px', 'important');
      Array.prototype.forEach.call(quickRow.querySelectorAll('.btn-quick'), function(b) {
        b.style.setProperty('flex', '1 1 auto', 'important');
        b.style.setProperty('width', 'auto', 'important');
        b.style.setProperty('max-width', '100%', 'important');
      });
    }
    if (btnRil) {
      btnRil.style.setProperty('width', '100%', 'important');
      btnRil.style.setProperty('max-width', '100%', 'important');
    }
    if (manualRow) {
      manualRow.style.setProperty('display', 'flex', 'important');
      manualRow.style.setProperty('flex-direction', 'row', 'important');
      manualRow.style.setProperty('flex-wrap', 'wrap', 'important');
      manualRow.style.setProperty('width', '100%', 'important');
      manualRow.style.setProperty('gap', '8px', 'important');
      const inp = manualRow.querySelector('.inp-rilancio');
      if (inp) { inp.style.setProperty('flex', '1 1 auto', 'important'); inp.style.setProperty('width', 'auto', 'important'); inp.style.setProperty('max-width', '100%', 'important'); }
      const btnM = manualRow.querySelector('.btn-manuale');
      if (btnM) { btnM.style.setProperty('flex', '0 0 auto', 'important'); }
    }
  }

  // Il testo della fascia strategia (.cc-strategia-info) puo' restare collassato
  // su alcuni browser mobile (es. Samsung/Brave Chromium) anche con le regole CSS
  // !important dedicate, per lo stesso motivo documentato sopra per rilancio-box.
  // Va forzato sempre in mobile, indipendentemente dallo stato .hidden di rilancio-box
  // (la fascia non ha relazione con lo stato della puja). Non si cachea il riferimento
  // perche' l'elemento viene rigenerato ad ogni renderChiamata().
  if (strategiaInfo) {
    strategiaInfo.style.setProperty('display', 'block', 'important');
    strategiaInfo.style.setProperty('visibility', 'visible', 'important');
    strategiaInfo.style.setProperty('opacity', '1', 'important');
    strategiaInfo.style.setProperty('height', 'auto', 'important');
    strategiaInfo.style.setProperty('overflow', 'visible', 'important');
    strategiaInfo.style.setProperty('white-space', 'normal', 'important');
    strategiaInfo.style.setProperty('width', '100%', 'important');
    strategiaInfo.style.setProperty('max-width', '100%', 'important');
    void strategiaInfo.offsetHeight;
  }

  const row = document.querySelector('.asta-row-panels');
  if (row) {
    row.style.setProperty('overflow', 'visible', 'important');
    row.style.setProperty('max-height', 'none', 'important');
  }
  const rowPuja = document.querySelector('.asta-row-puja');
  if (rowPuja) {
    rowPuja.style.setProperty('flex-direction', 'column', 'important');
    rowPuja.style.setProperty('width', '100%', 'important');
    rowPuja.style.setProperty('overflow', 'visible', 'important');
  }
}
window.addEventListener('resize', forzaVisibilitaRilancioMobile);

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
  const btnScarta = document.getElementById('btn-scarta-attuale');
  if (btnScarta) btnScarta.disabled = !(S.asta && S.asta.chiamataAttuale);
  forzaVisibilitaRilancioMobile();
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
  const items = (asta.storico || []);
  if (!items.length) {
    lista.innerHTML = '<p class="text-muted">Nessuna assegnazione da annullare</p>';
  } else {
    lista.innerHTML = [...items].reverse().map((item, i) => {
      const realIdx = asta.storico.lastIndexOf(item);
      const g = item.giocatore || {};
      const rb = g.ruolo ? '<span class="storico-ruolo ruolo-' + g.ruolo + '">' + g.ruolo + '</span>' : '';
      return '<div class="annulla-item">' + rb +
        '<span class="annulla-nome">' + _escHtml(g.nome || 'N/D') + '</span>' +
        '<span class="annulla-sq">' + _escHtml(item.squadra || '') + '</span>' +
        '<span class="annulla-prezzo">' + (item.prezzo || 0) + 'cr</span>' +
        '<span class="storico-tipo tipo-tag-' + item.tipo + '">' + item.tipo + '</span>' +
        '<button class="btn btn-danger btn-small" onclick="annullaSpecifica(' + realIdx + ')">' + (item.tipo === 'scartato' ? '↩️ Riapri' : 'Annulla') + '</button>' +
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
  document.querySelectorAll('#tab-liberi .filtro-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#tab-liberi .filtro-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      S.filtroRuolo = btn.dataset.ruolo;
      if (S.asta) renderGiocatoriLiberi(S.asta.poolGiocatori);
    });
  });
  const liberiCerca = document.getElementById('liberi-cerca');
  if (liberiCerca) liberiCerca.addEventListener('input', () => { if (S.asta) renderGiocatoriLiberi(S.asta.poolGiocatori); });
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // Ri-verificato ad ogni click invece di fidarsi solo del listener di resize/matchMedia:
      // se l'utente ha ridimensionato/ruotato il dispositivo senza che quell'evento sia ancora
      // scattato, questo garantisce comunque che #tab-anteprima sia nel posto giusto (drawer
      // desktop o dentro .tabs-panel come tab mobile) PRIMA di decidere come reagire al click.
      _antSyncDrawerLayout();
      const isAnteprimaBtn = btn.dataset.tab === 'tab-anteprima';
      // Su desktop Anteprima resta un drawer laterale indipendente che puo' restare aperto
      // sopra un'altra tab attiva (es. Rose) — non condivide .active con le altre, altrimenti
      // aprirla nasconderebbe il contenuto della tab di sfondo. Su mobile invece l'utente ha
      // chiesto che si comporti come una tab normale (esclusiva con le altre, non un pannello
      // che si apre sotto tutto il resto) — vedi _antSyncDrawerLayout().
      if (isAnteprimaBtn && !_antIsMobile()) { _antToggleDrawer(); return; }
      const drawer = document.getElementById('tab-anteprima');
      if (_antIsMobile() && drawer) drawer.classList.remove('active', 'drawer-open');
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });
  // Live dropdown suggestions while typing + Enter selects first match
  const rCerca = document.getElementById('rose-cerca');
  if (rCerca) {
    rCerca.addEventListener('input', () => _renderRoseDropdown(rCerca.value));
    rCerca.addEventListener('keydown', e => { if (e.key === 'Enter') selezionaPrimoRisultatoRose(); });
    rCerca.addEventListener('focus', () => { if (rCerca.value) _renderRoseDropdown(rCerca.value); });
    document.addEventListener('click', e => {
      const dd = document.getElementById('rose-search-dropdown');
      if (dd && !dd.classList.contains('hidden') && !dd.contains(e.target) && e.target !== rCerca) {
        dd.classList.add('hidden'); dd.innerHTML = '';
      }
    });
  }

  const btnRoseSearchToggle = document.getElementById('btn-rose-search-toggle');
  if (btnRoseSearchToggle) {
    btnRoseSearchToggle.addEventListener('click', () => {
      const row = document.getElementById('rose-search-row');
      const willOpen = row.classList.contains('hidden');
      row.classList.toggle('hidden');
      btnRoseSearchToggle.classList.toggle('open');
      if (willOpen) {
        document.getElementById('rose-cerca').focus();
      }
    });
  }
  const btnRoseSearchClose = document.getElementById('rose-search-close');
  if (btnRoseSearchClose) {
    btnRoseSearchClose.addEventListener('click', () => {
      const row = document.getElementById('rose-search-row');
      row.classList.add('hidden');
      if (btnRoseSearchToggle) btnRoseSearchToggle.classList.remove('open');
      const dd = document.getElementById('rose-search-dropdown');
      if (dd) { dd.classList.add('hidden'); dd.innerHTML = ''; }
    });
  }

  document.querySelectorAll('.storico-filtro-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.storico-filtro-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      S.filtroStorico = btn.dataset.storicoFiltro;
      if (S.asta) renderStorico(S.asta.storico);
    });
  });

}

// ════ SOCKET EVENTS ═══════════════════════════
socket.on('stato-asta', (asta) => {
  S.asta = asta;
  salvaStatoLocale(asta);
  // Item 6 fix: auto-hide admin popup-override-box as soon as the pending
  // popup/conferma is resolved server-side (by EITHER admin or the user),
  // instead of relying only on the admin's own manual click.
  const _popupRisolto = !asta.popupAttivo;
  const _ricRisolto = !(asta.chiamataAttuale && asta.chiamataAttuale.aspettandoConferma);
  if (_popupRisolto && _ricRisolto) {
    const pob = document.getElementById('popup-override-box');
    if (pob && !pob.classList.contains('hidden')) pob.classList.add('hidden');
  }
  // Fix: se un altro utente della stessa squadra (o l'admin) ha già risposto al
  // popup (Conferma RIC / Plusvalenza-Recompra / Svincolo), l'operazione è già
  // stata eseguita sul server: chiudi il popup anche per gli altri utenti che
  // lo hanno ancora aperto, invece di lasciarlo bloccato a schermo.
  if (S.popupAttivoCli) {
    const _tipo = S.popupAttivoCli.tipo;
    if (_popupRisolto && (_tipo === 'post-asta' || _tipo === 'svincolo')) {
      closeModal();
    } else if (_ricRisolto && _tipo === 'ric-conferma') {
      closeModal();
    } else if (_popupRisolto && _ricRisolto) {
      S.popupAttivoCli = null;
    }
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
    mostraPromptStrategiaSeNecessario();
  } else if (asta.stato === 'completata') {
    showScreen('screen-fine-asta');
    renderFineAsta();
    // Fix: una volta che l'asta è terminata, rimuoviamo la sessione salvata in
    // localStorage così che un successivo refresh della pagina NON ririagganci
    // automaticamente l'utente a questa asta (già conclusa) — altrimenti, se
    // l'admin crea subito una nuova asta, alcuni utenti che ricaricano la pagina
    // resterebbero bloccati sulla schermata di riepilogo dell'asta vecchia
    // invece di poter entrare/unirsi liberamente a quella nuova.
    cancSessione();
    try { history.replaceState({}, '', '/'); } catch(e) {}
  }
  renderLobbySquadre(asta.squadre);
  if (asta.stato === 'in_corso' || asta.stato === 'completata') {
    renderBudgetBar(asta.squadre);
    renderStorico(asta.storico);
    renderRose(asta.squadre);
    populateAnteprimaSquadre(asta.squadre);
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
  mostraPromptStrategiaSeNecessario();
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

socket.on('chiamata-manuale-avviso', (data) => {
  const nome = data.giocatore ? data.giocatore.nome : 'un giocatore';
  const msg = data.assegnazioneDiretta
    ? '🔨 L\'admin ha assegnato manualmente ' + nome + (data.squadra ? ' a ' + data.squadra : '') + (data.prezzo ? ' (' + data.prezzo + 'cr)' : '')
    : '🔨 Chiamata manuale dell\'admin: ' + nome;
  toast(msg, 'info');
  playSound('manuale');
  mostraNotificaBrowser('Chiamata manuale', msg);
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
  // Deve leggere la posizione di .cc-avatar PRIMA che il resto dell'handler la muti (sotto,
  // card.className/innerHTML) — per questo e' la primissima riga. Puro effetto client-side,
  // nessun evento socket nuovo: 'giocatore-assegnato' arriva gia' a tutti i partecipanti, ma
  // l'animazione della carta volante deve restare riservata a chi si e' aggiudicato il
  // giocatore (richiesta esplicita dell'utente: ogni squadra — admin compreso, che ha sempre
  // una propria squadra all'ingresso in asta — vede l'animazione solo quando vince LEI). Gli
  // altri ricevono comunque il toast con nome/squadra/prezzo poco sotto (gia' esistente,
  // invariato), solo senza l'effetto carta.
  if (squadra === S.miaSquadra) _playAssegnazioneCardFx(giocatore);
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
  const dettaglio = [giocatore.ruolo, giocatore.squadra].filter(Boolean).join(' · ');
  const nomeConDettaglio = dettaglio ? giocatore.nome + ' (' + dettaglio + ')' : giocatore.nome;
  toast(nomeConDettaglio + ' → ' + msg, 'success');
  const card = document.getElementById('chiamata-card');
  card.className = 'chiamata-card assegnata';
  card.innerHTML = '<p class="cc-esito">✅ ' + _escHtml(nomeConDettaglio) + '</p><p class="chiamata-stato">' + _escHtml(msg) + '</p>';
});

socket.on('giocatore-scartato', ({ giocatore }) => {
  document.getElementById('rilancio-box').classList.add('hidden');
  document.getElementById('timer-wrap').classList.add('hidden');
  playSound('buzzer');
  const card = document.getElementById('chiamata-card');
  card.className = 'chiamata-card scartata';
  card.innerHTML = '<p class="chiamata-stato">🚫 ' + _escHtml(giocatore.nome) + ' — scartato</p>';
  toast(giocatore.nome + ' scartato (nessuna offerta)', 'info');
});

socket.on('assegnazione-annullata', (item) => toast('Annullato: ' + (item.giocatore ? item.giocatore.nome : '?'), 'info'));
socket.on('scartati-reintrodotti', ({ count }) => toast(count + ' giocatori reintrodotti', 'success'));
socket.on('tradeoff-ok', () => { closeModal(); toast('Trade-off eseguito!', 'success'); });
socket.on('asta-terminata', () => {
  cancSessione(); showScreen('screen-fine-asta'); renderFineAsta();
  // Fix: rimuove l'id dell'asta terminata dalla barra degli indirizzi, così un
  // refresh successivo non tenta più di riaggangciarsi ad essa (vedi anche il
  // cancSessione() nell'handler stato-asta per il caso ricarica-pagina).
  try { history.replaceState({}, '', '/'); } catch(e) {}
  toast('Asta terminata!', 'success');
  if (S.isAdmin) {
    try { downloadFantaleghe(); } catch(e) { toast('⚠️ Export Fantaleghe fallito, usa il bottone manuale', 'error'); }
    try { downloadRecap(); } catch(e) { toast('⚠️ Export Recap fallito, usa il bottone manuale', 'error'); }
  }
});
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
  document.getElementById('mrc-giocatore').textContent = giocatore.nome + ' (' + (giocatore.ruolo||'?') + ')' + (giocatore.squadra ? ' - ' + giocatore.squadra : '');
  document.getElementById('mrc-prezzo').textContent = costoConferma;
  document.getElementById('mrc-tipo-label').textContent = 'RIC — consuma 1 slot riconferma';
  S.popupAttivoCli = { tipo: 'ric-conferma', giocatore };
  openModal('modal-ric-conferma');
});

socket.on('popup-ric-conferma-admin', function(data) {
  if (!S.isAdmin) return;
  var giocatore = data.giocatore || {}, proprietario = data.proprietario;
  var costo = data.costoConferma || giocatore.costoOriginale || '?';
  document.getElementById('popup-override-chi').textContent = proprietario + ' — RIC: ' + (giocatore.nome || '?') + (giocatore.squadra ? ' [' + giocatore.squadra + ']' : '') + ' (' + costo + 'cr)';
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
  var propOriginale = popup.proprietarioPrecedente || '?';
  // Fix chiarezza: senza il nome della squadra originale, l'admin non capiva a chi si
  // riferisse l'avviso (vedeva solo il vincitore dell'asta, non chi doveva decidere).
  var infoTxt = propOriginale + ' potrebbe riprendersi ' + popup.giocatore.nome + ' (' + tipoLabel + ', ora di ' + popup.squadraVincitrice + ' @ ' + popup.prezzoFinale + 'cr)';
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
  // Prima usava un unico creditiIniziali globale letto da un campo (creditiPerSquadra)
  // che il backend non ha mai inviato — la barra calcolava sempre la % su 500 fisso,
  // sbagliato per qualunque asta con un budget diverso. Ogni squadra ha ora il suo
  // creditiIniziali reale (vedi campiCrediti lato server), diverso se ha importato
  // crediti extra o se l'Admin l'ha corretto.
  const squadreOrdinate = squadre.slice().sort((a, b) => b.crediti - a.crediti);
  document.getElementById('budget-bar').innerHTML = squadreOrdinate.map(sq => {
    const creditiIniziali = sq.creditiIniziali || (S.asta && S.asta.crediti) || 500;
    const pct = Math.round(Math.max(0, sq.crediti / creditiIniziali * 100));
    const isOff = S.asta && S.asta.chiamataAttuale && S.asta.chiamataAttuale.squadraOfferente === sq.nome;
    const cls = ['sidebar-squadra',
      sq.nome === S.miaSquadra ? 'mia-squadra' : '',
      isOff ? 'offerente-attuale' : '',
      sq.crediti < 50 ? 'critica' : ''
    ].filter(Boolean).join(' ');
    const dot  = sq.online ? '🟢' : '⚪';
    const rosaSq = sq.rosa || [];
    const gioc = sq.giocatori ? sq.giocatori.length : rosaSq.length;
    const maxGioc = (S.asta && S.asta.maxGiocatoriPerSquadra) || 25;
    const numPortieri = rosaSq.filter(g => _isPortiere(g.ruolo)).length;
    const barCls = pct <= 15 ? 'crit' : (pct <= 40 ? 'warn' : 'ok');
    return '<div class="' + cls + '">' +
      '<div class="sq-top">' +
        '<span class="sq-dot-online">' + dot + '</span>' +
        '<span class="sq-nome">' + _escHtml(sq.nome) + '</span>' +
        '<span class="sq-crediti">💰 ' + sq.crediti + '</span>' +
      '</div>' +
      '<div class="budget-progress"><div class="budget-progress-fill ' + barCls + '" style="width:' + pct + '%"></div></div>' +
      '<div class="sq-bottom">Tot: ' + gioc + '/' + maxGioc + ' <span class="sq-portieri">🧤 ' + numPortieri + '</span></div>' +
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

function _avatarInitials(nome) {
  if (!nome) return '?';
  const parts = nome.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return nome.trim().substring(0, 2).toUpperCase();
}

function _avatarColor(nome) {
  const str = nome || '?';
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) % 360;
  }
  const hue = Math.abs(hash);
  return 'hsl(' + hue + ',48%,38%)';
}

let _chiamataAvatarVersion = 0;
const _playerPhotoCache = {};

function _teamWords(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(function(w) {
      return w && ['fc','ac','ssc','us','as','calcio','club','ssd','asd','cfc'].indexOf(w) === -1;
    });
}
function _teamMatches(sourceTeam, squadraAssegnata) {
  if (!sourceTeam) return false; // nessuna squadra indicata dalla fonte: non possiamo confermare, si scarta per sicurezza (evita foto di persone omonime sbagliate)
  const aw = _teamWords(sourceTeam), bw = _teamWords(squadraAssegnata);
  if (!aw.length || !bw.length) return false;
  for (let i = 0; i < aw.length; i++) {
    for (let j = 0; j < bw.length; j++) {
      const x = aw[i], y = bw[j];
      if (x.length < 4 || y.length < 4) continue;
      if (x === y || x.indexOf(y) === 0 || y.indexOf(x) === 0) return true;
    }
  }
  return false;
}

// Rileva testi/etichette relative al calcio femminile: usato per scartare foto di omonime
// (es. "Russo A." maschile confuso con una calciatrice femminile con lo stesso cognome).
function _isWomenText(s) {
  const t = (s || '').toLowerCase();
  const kws = ['women', "women's", 'female', 'femminile', 'donne', 'ladies', 'wfc', 'nwsl', 'wsl', 'frauen', 'feminine'];
  for (let i = 0; i < kws.length; i++) { if (t.indexOf(kws[i]) > -1) return true; }
  return false;
}

// Controlla le categorie Wikimedia Commons di un'immagine: restituisce true se la foto
// e' chiaramente scattata durante una gara internazionale (Mondiale, Euro, Olimpiadi, ecc.)
// In quel caso il giocatore indossa la maglia della nazionale, non del club — foto scartata.
function _commonsFileTitle(imageUrl) {
  try {
    var u = new URL(imageUrl);
    var parts = decodeURIComponent(u.pathname).split('/');
    var filename = parts[parts.length - 1];
    // rimuove prefix di dimensione tipo "330px-" generato dai thumbnail
    filename = filename.replace(/^\d+px-/, '');
    return 'File:' + filename.replace(/_/g, ' ');
  } catch(e) { return null; }
}
var _nationalTeamCountries = ['afghanistan','albania','algeria','andorra','angola','argentina','armenia','australia','austria','azerbaijan','bahamas','bahrain','bangladesh','barbados','belarus','belgium','belize','benin','bhutan','bolivia','bosnia and herzegovina','botswana','brazil','brunei','bulgaria','burkina faso','burundi','cambodia','cameroon','canada','cape verde','central african republic','chad','chile','china','colombia','comoros','congo','costa rica','croatia','cuba','cyprus','czech republic','denmark','djibouti','dominica','dominican republic','democratic republic of the congo','ecuador','egypt','el salvador','equatorial guinea','eritrea','estonia','eswatini','ethiopia','fiji','finland','france','gabon','gambia','georgia','germany','ghana','greece','grenada','guatemala','guinea','guinea-bissau','guyana','haiti','honduras','hungary','iceland','india','indonesia','iran','iraq','ireland','israel','italy','ivory coast','jamaica','japan','jordan','kazakhstan','kenya','kiribati','kosovo','kuwait','kyrgyzstan','laos','latvia','lebanon','lesotho','liberia','libya','liechtenstein','lithuania','luxembourg','madagascar','malawi','malaysia','maldives','mali','malta','mauritania','mauritius','mexico','moldova','monaco','mongolia','montenegro','morocco','mozambique','myanmar','namibia','nepal','netherlands','new zealand','nicaragua','niger','nigeria','north korea','north macedonia','norway','oman','pakistan','palestine','panama','papua new guinea','paraguay','peru','philippines','poland','portugal','qatar','romania','russia','rwanda','saint kitts and nevis','saint lucia','samoa','san marino','saudi arabia','senegal','serbia','seychelles','sierra leone','singapore','slovakia','slovenia','solomon islands','somalia','south africa','south korea','south sudan','spain','sri lanka','sudan','suriname','sweden','switzerland','syria','taiwan','tajikistan','tanzania','thailand','togo','tonga','trinidad and tobago','tunisia','turkey','turkmenistan','tuvalu','uganda','ukraine','united arab emirates','united kingdom','england','scotland','wales','northern ireland','united states','uruguay','uzbekistan','vanuatu','venezuela','vietnam','yemen','zambia','zimbabwe'];
function _isCountryName(s) { return _nationalTeamCountries.indexOf(s) > -1; }
function _checkCommonsNotInternational(imageUrl) {
  var title = _commonsFileTitle(imageUrl);
  if (!title) return Promise.resolve(true); // non riusciamo a verificare: accettiamo
  var url = 'https://commons.wikimedia.org/w/api.php?action=query&titles=' +
    encodeURIComponent(title) + '&prop=categories&cllimit=50&format=json&origin=*';
  return fetch(url).then(function(r) { return r.json(); }).then(function(data) {
    var pages = data.query && data.query.pages;
    if (!pages) return true;
    var page = pages[Object.keys(pages)[0]];
    var cats = (page.categories || []).map(function(c) { return c.title.replace(/^Category:/, '').toLowerCase(); });
    var intlKw = ['fifa world cup', 'uefa european championship', 'uefa euro', 'copa america', 'copa américa',
      'africa cup of nations', 'afcon', 'olympic football', 'confederations cup', 'nations league',
      'conmebol', 'concacaf gold cup', 'afc asian cup', 'wcq', 'world cup qualifier'];
    for (var i = 0; i < cats.length; i++) {
      var c = cats[i];
      for (var j = 0; j < intlKw.length; j++) {
        if (c.indexOf(intlKw[j]) > -1) return false; // foto scattata durante un torneo internazionale specifico — scarta
      }
      // Segnali generici di contesto nazionale/internazionale (non legati a un torneo specifico):
      // es. "Iceland national football team", "WikiPortraits at 2026 International Soccer Matches"
      if (c.indexOf('national football team') > -1 || c.indexOf('national soccer team') > -1) return false;
      if (c.indexOf('international') > -1 && (c.indexOf('soccer') > -1 || c.indexOf('football') > -1)) return false;
      var _mvs = c.match(/^(.+?)\s+v(?:s\.?)?\s+(.+?)(?:,\s*\d.*)?$/);
      if (_mvs && _isCountryName(_mvs[1].trim()) && _isCountryName(_mvs[2].trim())) return false; // categoria tipo "PaeseA vs PaeseB, <data>" = foto di nazionali
    }
    return true; // foto ok (contesto di club o neutro)
  }).catch(function() { return true; }); // in caso di errore: accettiamo (evita blocchi inutili)
}

// Fallback finale: se nessuna foto reale del giocatore e' stata trovata, mostra un'illustrazione
// generica con la maglia della squadra assegnata (immagini in /img/teams/), invece dell'avatar con iniziali.

const _teamPhotoFolders = {
  atalanta: 'Atalanta', bologna: 'Bologna', cagliari: 'Cagliari', como: 'Como', fiorentina: 'Fiorentina',
  frosinone: 'Frosinone', genoa: 'Genoa', inter: 'Inter', juventus: 'Juventus', lazio: 'Lazio',
  lecce: 'Lecce', milan: 'Milan', monza: 'Monza', napoli: 'Napoli', parma: 'Parma',
  roma: 'Roma', sassuolo: 'Sassuolo', torino: 'Torino', udinese: 'Udinese', venezia: 'Venezia'
};
let _playerPhotoIndex = null; // { "Atalanta": ["Nome_Cognome.jpg", ...], ... } caricato da data/player_photos_index.json
let _playerPhotoIndexPromise = null;
function _loadPlayerPhotoIndex() {
  if (_playerPhotoIndexPromise) return _playerPhotoIndexPromise;
  _playerPhotoIndexPromise = fetch('data/player_photos_index.json')
    .then(function(r) { return r.json(); })
    .then(function(json) { _playerPhotoIndex = json; return json; })
    .catch(function() { _playerPhotoIndex = {}; return {}; });
  return _playerPhotoIndexPromise;
}
// Normalizza un nome per il confronto: minuscolo, senza accenti, solo lettere/numeri.
// Prima di normalize('NFD') si traslittera esplicitamente le lettere che sono
// unicode base proprio (non decorazione), quindi normalize('NFD') NON le
// convertirebbe in "lettera+accento" separabile e finirebbero cancellate
// invece che traslitterate (es. la "ı" turca senza punto in "Yıldız" -> "Yldz").
function _normalizePhotoName(s) {
  return (s || '').toString()
    .replace(/ı/g, 'i').replace(/İ/g, 'I')
    .replace(/ø/g, 'o').replace(/Ø/g, 'O')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/ł/g, 'l').replace(/Ł/g, 'L')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '');
}
// Mapping esplicito nome-Excel(+squadra) -> file immagine, generato a mano dal
// listino ufficiale. Ha priorita' assoluta sul matching fuzzy sottostante perche'
// e' stato verificato uno per uno (423 giocatori). Caricato da
// data/player_name_overrides.json, chiave = normalizza(nome)+'|'+normalizza(squadra).
let _playerNameOverrides = null;
let _playerNameOverridesPromise = null;
function _loadPlayerNameOverrides() {
  if (_playerNameOverridesPromise) return _playerNameOverridesPromise;
  _playerNameOverridesPromise = fetch('data/player_name_overrides.json')
    .then(function(r) { return r.json(); })
    .then(function(json) { _playerNameOverrides = json; return json; })
    .catch(function() { _playerNameOverrides = {}; return {}; });
  return _playerNameOverridesPromise;
}
// Cerca una foto locale (caricata manualmente) del giocatore, confrontando il nome
// con i file disponibili nella cartella della sua squadra. Fonte prioritaria: e' garantita
// al 100%, senza limiti di quota e senza rischio di maglia sbagliata.
function _tryLocalPhoto(nome, squadra) {
  return _loadPlayerNameOverrides().then(function(overrides) {
    if (overrides && squadra) {
      const key = _normalizePhotoName(nome) + '|' + _normalizePhotoName(squadra);
      if (overrides[key]) return overrides[key];
    }
    return null;
  }).then(function(hit) {
    if (hit) return hit;
    return _loadPlayerPhotoIndex().then(function(idx) {
    if (!idx || !squadra) return null;
    const bw = _teamWords(squadra);
    let folder = null;
    for (let i = 0; i < bw.length; i++) {
      const w = bw[i];
      if (w.length < 4) continue;
      for (const slug in _teamPhotoFolders) {
        if (slug === w || slug.indexOf(w) === 0 || w.indexOf(slug) === 0) { folder = _teamPhotoFolders[slug]; break; }
      }
      if (folder) break;
    }
    if (!folder || !idx[folder]) return null;
    const targetNorm = _normalizePhotoName(nome);
    if (!targetNorm) return null;
    const files = idx[folder];
    // Confronto esatto sul nome normalizzato (senza estensione), poi match
    // "Cognome + iniziale/abbreviazione" (es. "Pessina Mas." -> "Massimo_Pessina.jpg"),
    // poi fallback finale a "contiene".
    let best = null;
    for (let i = 0; i < files.length; i++) {
      const fname = files[i];
      const base = fname.replace(/\.[a-zA-Z]+$/, '');
      const fnorm = _normalizePhotoName(base.replace(/_/g, ' '));
      if (fnorm === targetNorm) { best = fname; break; }
    }
    if (!best) {
      // Il listino a volte scrive "Cognome Iniz." (1 lettera, o 2-4 lettere+punto)
      // invece del nome di battesimo per esteso: es. "Pessina Mas." = Massimo Pessina,
      // "Moro L." = Luca Moro. I file sono "Nome_Cognome.jpg": bisogna confrontare
      // l'ULTIMA parte del file col cognome, e la PRIMA parte del file deve iniziare
      // con l'abbreviazione.
      const words = (nome || '').toString().trim().split(/\s+/).filter(Boolean);
      if (words.length >= 2) {
        const lastWord = words[words.length - 1];
        const abbrevMatch = lastWord.match(/^([A-Za-zÀ-ÿ]{1,4})\.?$/);
        const isAbbrev = !!abbrevMatch && (abbrevMatch[1].length === 1 || (abbrevMatch[1].length >= 2 && lastWord.slice(-1) === '.'));
        if (isAbbrev) {
          const cognomeNorm = _normalizePhotoName(words.slice(0, -1).join(' '));
          const abbrevNorm = _normalizePhotoName(abbrevMatch[1]);
          for (let i = 0; i < files.length; i++) {
            const fname = files[i];
            const base = fname.replace(/\.[a-zA-Z]+$/, '');
            const parts = base.split('_').filter(Boolean);
            if (parts.length < 2) continue;
            const lastPartNorm = _normalizePhotoName(parts[parts.length - 1]);
            const firstPartNorm = _normalizePhotoName(parts[0]);
            if (lastPartNorm === cognomeNorm && firstPartNorm.indexOf(abbrevNorm) === 0) { best = fname; break; }
          }
        }
      }
    }
    if (!best) {
      for (let i = 0; i < files.length; i++) {
        const fname = files[i];
        const base = fname.replace(/\.[a-zA-Z]+$/, '');
        const fnorm = _normalizePhotoName(base.replace(/_/g, ' '));
        if (fnorm.indexOf(targetNorm) > -1 || targetNorm.indexOf(fnorm) > -1) { best = fname; break; }
      }
    }
    if (!best) return null;
    return 'img/players/' + folder + '/' + best;
    });
  }).catch(function() { return null; });
}

const _teamFallbackSlugs = ['atalanta','bologna','cagliari','como','fiorentina','frosinone','genoa','inter','juventus','lazio','lecce','milan','monza','napoli','parma','roma','sassuolo','torino','udinese','venezia'];
function _teamFallbackImage(squadra) {
  if (!squadra) return null;
  const bw = _teamWords(squadra);
  if (!bw.length) return null;
  for (let i = 0; i < _teamFallbackSlugs.length; i++) {
    const slug = _teamFallbackSlugs[i];
    for (let j = 0; j < bw.length; j++) {
      const w = bw[j];
      if (w.length < 4) continue;
      if (slug === w || slug.indexOf(w) === 0 || w.indexOf(slug) === 0) return 'img/teams/' + slug + '.png';
    }
  }
  return null;
}

function _trySportsDB(nome, squadra) {
  const url = 'https://www.thesportsdb.com/api/v1/json/3/searchplayers.php?p=' + encodeURIComponent(nome);
  return fetch(url).then(function(r) { return r.json(); }).then(function(data) {
    const players = data && data.player;
    if (!players || !players.length) return null;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (p.strSport && p.strSport !== 'Soccer') continue;
      if (p.strGender && p.strGender.toLowerCase().indexOf('female') > -1) continue; // scarta calciatrici omonime
      if (_isWomenText(p.strTeam) || _isWomenText(p.strLeague)) continue;
      if (_teamMatches(p.strTeam, squadra)) {
        const img = p.strCutout || p.strThumb || p.strRender;
        if (img) return img;
      }
    }
    return null;
  }).catch(function() { return null; });
}

function _tryWikidata(nome, squadra) {
  const searchUrl = 'https://www.wikidata.org/w/api.php?action=wbsearchentities&search=' +
    encodeURIComponent(nome) + '&language=en&format=json&type=item&limit=5&origin=*';
  return fetch(searchUrl).then(function(r) { return r.json(); }).then(function(data) {
    const ids = (data.search || []).map(function(x) { return x.id; });
    if (!ids.length) return null;
    const values = ids.map(function(id) { return 'wd:' + id; }).join(' ');
    const sparql = 'SELECT ?item ?image ?teamLabel ?occLabel ?sexLabel WHERE { VALUES ?item { ' + values + ' } ' +
      'OPTIONAL { ?item wdt:P18 ?image. } ' +
      'OPTIONAL { ?item wdt:P54 ?team. ?team rdfs:label ?teamLabel. FILTER(LANG(?teamLabel)="en") } ' +
      'OPTIONAL { ?item wdt:P106 ?occ. ?occ rdfs:label ?occLabel. FILTER(LANG(?occLabel)="en") } ' +
      'OPTIONAL { ?item wdt:P21 ?sex. ?sex rdfs:label ?sexLabel. FILTER(LANG(?sexLabel)="en") } }';
    const url = 'https://query.wikidata.org/sparql?query=' + encodeURIComponent(sparql) + '&format=json';
    return fetch(url, { headers: { 'Accept': 'application/sparql-results+json' } })
      .then(function(r2) { return r2.json(); })
      .then(function(data2) {
        const bindings = (data2.results && data2.results.bindings) || [];
        for (let i = 0; i < bindings.length; i++) {
          const b = bindings[i];
          const occ = ((b.occLabel && b.occLabel.value) || '').toLowerCase();
          if (occ.indexOf('football') === -1 && occ.indexOf('soccer') === -1) continue;
          const sex = ((b.sexLabel && b.sexLabel.value) || '').toLowerCase();
          if (sex && sex.indexOf('male') === -1) continue; // esplicitamente non maschile: scarta (evita omonime)
          if (_isWomenText(occ)) continue;
          const team = b.teamLabel && b.teamLabel.value;
          const image = b.image && b.image.value;
          if (!image) continue;
          if (_isWomenText(team)) continue;
          if (_teamMatches(team, squadra)) {
            // Verifica che la foto non sia scattata in un contesto di nazionale (es. Mondiale):
            // in quel caso il club coincide nella carriera ma la maglia mostrata non e' quella del club.
            return _checkCommonsNotInternational(image).then(function(ok) { return ok ? image : null; });
          }
        }
        return null; // rimosso il fallback "nessuna squadra indicata": troppo rischioso, causava foto di persone omonime sbagliate
      });
  }).catch(function() { return null; });
}

function _tryWikipedia(nome, squadra) {
  const searchUrl = 'https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' +
    encodeURIComponent(nome + ' footballer') + '&format=json&srlimit=1&origin=*';
  return fetch(searchUrl)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      const results = data.query && data.query.search;
      if (!results || !results.length) return null;
      const title = results[0].title;
      return fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title))
        .then(function(r2) { return r2.json(); })
        .then(function(summary) {
          const desc = (summary.description || '').toLowerCase();
          const extract = (summary.extract || '').toLowerCase();
          const url = summary.thumbnail && summary.thumbnail.source;
          const isFootballer = desc.indexOf('footballer') > -1 || desc.indexOf('soccer') > -1 || desc.indexOf('calciatore') > -1;
          if (!url || !isFootballer) return null;
          if (_isWomenText(desc) || _isWomenText(extract)) return null; // scarta esplicitamente il calcio femminile (omonime)
          if (!squadra) return url;
          // Verifica il club tramite l'entita' Wikidata collegata alla pagina (sesso + squadra attuale/passata)
          const pageInfoUrl = 'https://en.wikipedia.org/w/api.php?action=query&prop=pageprops&titles=' +
            encodeURIComponent(title) + '&format=json&origin=*';
          return fetch(pageInfoUrl).then(function(r3) { return r3.json(); }).then(function(pdata) {
            const pages = pdata.query && pdata.query.pages;
            const key = pages && Object.keys(pages)[0];
            const qid = key && pages[key].pageprops && pages[key].pageprops.wikibase_item;
            if (!qid) return null; // nessun collegamento Wikidata: non possiamo verificare squadra/sesso, scartiamo per sicurezza
            const sparql = 'SELECT ?sexLabel ?teamLabel WHERE { OPTIONAL { wd:' + qid + ' wdt:P21 ?sex. ?sex rdfs:label ?sexLabel. FILTER(LANG(?sexLabel)="en") } ' +
              'OPTIONAL { wd:' + qid + ' wdt:P54 ?team. ?team rdfs:label ?teamLabel. FILTER(LANG(?teamLabel)="en") } }';
            const wdUrl = 'https://query.wikidata.org/sparql?query=' + encodeURIComponent(sparql) + '&format=json';
            return fetch(wdUrl, { headers: { 'Accept': 'application/sparql-results+json' } })
              .then(function(r4) { return r4.json(); })
              .then(function(wd) {
                const bindings = (wd.results && wd.results.bindings) || [];
                if (!bindings.length) return null;
                const sex = ((bindings[0].sexLabel && bindings[0].sexLabel.value) || '').toLowerCase();
                if (sex && sex.indexOf('male') === -1) return null; // esplicitamente non maschile
                for (let i = 0; i < bindings.length; i++) {
                  const team = bindings[i].teamLabel && bindings[i].teamLabel.value;
                  if (_isWomenText(team)) return null;
                  if (_teamMatches(team, squadra)) {
                    return _checkCommonsNotInternational(url).then(function(ok) { return ok ? url : null; });
                  }
                }
                return null;
              });
          }).catch(function() { return null; });
        });
    })
    .catch(function() { return null; });
}

// Applica un timeout a una promise: se la fonte esterna (SportsDB/Wikidata/Wikipedia)
// e' lenta o irraggiungibile (rete lenta, firewall, blocco del browser), dopo "ms"
// si passa comunque al fallback invece di restare bloccati per sempre senza mostrare nulla.
// Ultima fonte prima del fallback allo scudo: API-Football (proxy sul backend,
// che gestisce la chiave segreta e il limite di 100 richieste/giorno del piano free).
// Ritorna una foto tipo tessera/profilo del giocatore (non foto di partita), quindi
// non serve applicare il filtro anti-nazionale usato per le foto di Wikimedia Commons.
function _tryApiFootball(nome, squadra) {
  return fetch('/api/player-photo?name=' + encodeURIComponent(nome))
    .then(function(r) { return r.json(); })
    .then(function(data) { return (data && data.photo) || null; })
    .catch(function() { return null; });
}

function _withTimeout(promise, ms, fallbackValue) {
  return new Promise(function(resolve) {
    let done = false;
    const timer = setTimeout(function() {
      if (!done) { done = true; resolve(fallbackValue); }
    }, ms);
    Promise.resolve(promise).then(function(v) {
      if (!done) { done = true; clearTimeout(timer); resolve(v); }
    }).catch(function() {
      if (!done) { done = true; clearTimeout(timer); resolve(fallbackValue); }
    });
  });
}

function _loadPlayerPhoto(nome, squadra, version) {
  const cacheKey = nome + '|' + (squadra || '');
  if (Object.prototype.hasOwnProperty.call(_playerPhotoCache, cacheKey)) {
    _applyPlayerPhoto(_playerPhotoCache[cacheKey], version);
    return;
  }
  // Solo foto locali verificate manualmente: mai foto reali da fonti esterne
  // (incoerenti in stile, talvolta sbagliate o obsolete). Se non c'e' un match
  // locale, si usa sempre l'illustrazione generica "unknown".
  _withTimeout(_tryLocalPhoto(nome, squadra), 4000, null)
    .then(function(finalUrl) {
      const url = finalUrl || 'img/players/unknown_anime.jpg';
      _playerPhotoCache[cacheKey] = url;
      _applyPlayerPhoto(url, version);
    })
    .catch(function() {
      const url = 'img/players/unknown_anime.jpg';
      _playerPhotoCache[cacheKey] = url;
      _applyPlayerPhoto(url, version);
    });
}

function _applyPlayerPhoto(url, version) {
  if (!url) return;
  if (version !== _chiamataAvatarVersion) return;
  const avatarEl = document.querySelector('#chiamata-card .cc-avatar');
  if (!avatarEl) return;
  const img = new Image();
  img.onload = function() {
    if (version !== _chiamataAvatarVersion) return;
    avatarEl.innerHTML = '';
    img.className = 'cc-avatar-img';
    avatarEl.appendChild(img);
  };
  img.onerror = function() {};
  img.src = url;
}

function _getChiamataStrategiaInfoHTML(g) {
  const strat = S.strategiaAsta;
  const cfg = strat ? strat.configByListinoId.get(g.idFantaleghe) : null;
  const haFascia = !!(cfg && cfg.fascia_id && strat.fasceInfo.has(cfg.fascia_id));
  const haTitolarita = !!(cfg && cfg.titolarita);
  const haCommento = !!(cfg && cfg.commento && cfg.commento.trim());
  if (!haFascia && !haTitolarita && !haCommento) {
    return '<p class="cc-strategia-info cc-strategia-vuota">📊 Nessuna fascia assegnata</p>';
  }
  let fasciaHTML = '';
  if (haFascia) {
    const f = strat.fasceInfo.get(cfg.fascia_id);
    const prezzoReale = prezzoRealeStrategia(cfg);
    const prezzoTxt = prezzoReale != null ? (prezzoReale + ' cr') : '—';
    const pctTxt = cfg.percentuale != null ? (' (' + cfg.percentuale + '%)') : '';
    const preferitoTxt = cfg.preferito ? ' ⭐ Preferito' : '';
    fasciaHTML = '<p class="cc-strategia-info" style="border-color:' + f.colore + '">📊 <strong style="color:' + f.colore + '">' + escapeHTML(f.nome) + '</strong> · ' + prezzoTxt + pctTxt + preferitoTxt + '</p>';
  }
  // Titolarità e commento sono di sola lettura qui: si editano solo nell'editor Strategia.
  const titolaritaHTML = haTitolarita
    ? '<p class="cc-strategia-info">' + '★'.repeat(cfg.titolarita) + '☆'.repeat(5 - cfg.titolarita) + ' Titolarità</p>'
    : '';
  const commentoHTML = haCommento
    ? '<p class="cc-strategia-info" title="' + _escAttr(cfg.commento) + '">💬 ' + escapeHTML(cfg.commento) + '</p>'
    : '';
  return fasciaHTML + titolaritaHTML + commentoHTML;
}

function renderChiamata(chiamata) {
  const card = document.getElementById('chiamata-card');
  card.className = 'chiamata-card attiva card-enter';
  const g = chiamata.giocatore;
  const ruoloBadge = _getRuoloBadgeHTML(g.ruolo);
  _chiamataAvatarVersion++;
  const _myAvatarVersion = _chiamataAvatarVersion;
  const tipoBadge = g.tipo && g.tipo !== 'NN' ? '<span class="cc-tipo-badge tipo-' + g.tipo + '">' + g.tipo + '</span>' : '';
  const u21Badge = g.u21 === true ? '<span class="cc-tipo-badge tipo-U21">U21</span>' : '';
  const etaTxt = g.under != null ? '<small class="text-muted cc-eta">' + g.under + ' anni</small>' : '';
  const origTxt = g.squadraOriginale && g.tipo !== 'NN' ? '<small class="text-muted">ex: ' + _escHtml(g.squadraOriginale) + '</small>' : '';
  const clubTxt = g.squadra ? '<span class="cc-club">' + _escHtml(g.squadra) + '</span>' : '';
  const offerenteTxt = chiamata.squadraOfferente
    ? 'Offerta di: <strong>' + _escHtml(chiamata.squadraOfferente) + '</strong>'
    : '<span class="chiamata-stato">In attesa 1ª offerta...</span>';
  const offertaDisplay = chiamata.offertaAttuale === 0 ? '—' : chiamata.offertaAttuale;
  const offertaLabel = chiamata.offertaAttuale === 0 ? 'Nessuna offerta' : 'crediti';
  const attesaBadge = chiamata.aspettandoConferma
    ? '<p class="cc-attesa-badge">⏳ In attesa decisione di <strong>' + _escHtml(chiamata.proprietario || chiamata.giocatore.squadraOriginale || 'squadra') + '</strong></p>'
    : '';
  const manualeBadge = chiamata.manuale
    ? '<p class="cc-manuale-badge">🔨 Manuale Admin</p>'
    : '';
  const _avatarSvg = '<svg viewBox="0 0 100 100" class="cc-avatar-svg"><path d="M29,44 Q26,35 30,28 Q33,21 39,19 Q41,15 47,16 Q50,13 53,16 Q59,15 61,19 Q67,21 70,28 Q74,35 71,44 Q74,48 70,52 Q71,57 68,60 L68,62 C68,70 60,76 50,76 C40,76 32,70 32,62 L32,60 Q29,57 30,52 Q26,48 29,44 Z" fill="#20142f"/><path d="M12,100 L12,88 C12,74 24,63 39,61 L39,66 C39,71 44,75 50,75 C56,75 61,71 61,66 L61,61 C76,63 88,74 88,88 L88,100 Z" fill="#20142f"/></svg>';
  // Vista UTENTE (non-admin): il badge Manuale Admin va sotto l'avatar (dentro cc-header, colonna),
  // cosi non occupa larghezza extra. Vista ADMIN: struttura invariata (badge sopra la card, come sempre).
  const cc_header_html = (!S.isAdmin && window.innerWidth > 1200)
    ? '<div class="cc-header">' +
        '<div class="cc-avatar-utente-col"><div class="cc-avatar">' + _avatarSvg + '</div>' + manualeBadge + '</div>' +
        '<div class="cc-info">' +
          '<div class="cc-nome-row">' + ruoloBadge + '<p class="cc-nome">' + _escHtml(g.nome) + '</p></div>' +
          '<div class="cc-meta">' + clubTxt + tipoBadge + u21Badge + etaTxt + origTxt + '</div>' +
        '</div>' +
      '</div>'
    : manualeBadge +
      '<div class="cc-header">' +
        '<div class="cc-avatar">' + _avatarSvg + '</div>' +
        '<div class="cc-info">' +
          '<div class="cc-nome-row">' + ruoloBadge + '<p class="cc-nome">' + _escHtml(g.nome) + '</p></div>' +
          '<div class="cc-meta">' + clubTxt + tipoBadge + u21Badge + etaTxt + origTxt + '</div>' +
        '</div>' +
      '</div>';
  card.innerHTML =
    cc_header_html +
    '<div class="cc-body">' +
      '<div class="cc-offerta-box">' +
        '<p class="cc-offerta" id="cc-prezzo">' + offertaDisplay + '</p>' +
        '<p class="cc-offerta-label">' + offertaLabel + '</p>' +
      '</div>' +
      '<p class="cc-offerente">' + offerenteTxt + '</p>' +
      attesaBadge +
      _getChiamataStrategiaInfoHTML(g) +
    '</div>';
  aggiornaQuickBids();
  _loadPlayerPhoto(g.nome, g.squadra, _myAvatarVersion);
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
  const frac = Math.max(0, Math.min(1, secondi / total));
  const offset = CIRC * (1 - frac);
  const progress = document.getElementById('timer-progress');
  const numEl    = document.getElementById('timer-display');
  const labelEl  = document.getElementById('timer-label');
  const container = document.getElementById('timer-wrap');
  const ballEl   = document.getElementById('timer-ball');
  const gs = document.getElementById('timer-grad-start');
  const ge = document.getElementById('timer-grad-end');
  if (progress) progress.style.strokeDashoffset = offset;
  if (numEl)    numEl.textContent  = secondi;
  if (labelEl)  labelEl.textContent = fase === 'prima' ? 'prima offerta' : 'rilancio';
  if (ballEl) {
    // Il pallone segue la punta dell'arco del cronometro lungo l'anello (coordinate SVG: centro 60,60 raggio 54)
    const angleRad = (360 * frac) * Math.PI / 180;
    const bx = 60 + 54 * Math.sin(angleRad);
    const by = 60 - 54 * Math.cos(angleRad);
    ballEl.style.left = (bx / 120 * 100) + '%';
    ballEl.style.top  = (by / 120 * 100) + '%';
  }
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

const TRADEOFF_LABELS = {
  'ric-to-plus': 'RIC\u2192PLUS', 'plus-to-ric': 'PLUS\u2192RIC',
  'ric-to-crediti': 'RIC\u219212cr', 'plus-to-crediti': 'PLUS\u21926cr'
};
function aggiornaVisibilitaFiltriStorico() {
  const asta = S.asta;
  const box = document.getElementById('storico-filtri');
  const btnIniziale = document.getElementById('btn-recap-iniziale');
  const btnRip1 = document.getElementById('btn-recap-riparazione1');
  const btnRip2 = document.getElementById('btn-recap-riparazione2');
  if (!asta || !box) return;
  const showIniziale = asta.tipoAsta === 'iniziale';
  const showRip1 = asta.tipoAsta === 'riparazione' && String(asta.sottoTipoRiparazione) === '1';
  const showRip2 = asta.tipoAsta === 'riparazione' && String(asta.sottoTipoRiparazione) === '2';
  if (btnIniziale) btnIniziale.classList.toggle('hidden', !showIniziale);
  if (btnRip1) btnRip1.classList.toggle('hidden', !showRip1);
  if (btnRip2) btnRip2.classList.toggle('hidden', !showRip2);
  box.classList.toggle('hidden', !(showIniziale || showRip1 || showRip2));
}

function renderStorico(storico) {
  aggiornaVisibilitaFiltriStorico();
  const list = document.getElementById('storico-list');
  let items = storico || [];
  const filtro = S.filtroStorico || 'tutti';
  if (filtro === 'recap-iniziale') {
    items = items.filter(s => s.tipo === 'riconferma' || s.tipo === 'plusvalenza' || s.tipo === 'recompra');
  } else if (filtro === 'recap-riparazione') {
    items = items.filter(s => s.tipo === 'con_svincolo');
  }
  if (!items.length) { list.innerHTML = '<li class="text-muted" style="padding:8px">Nessun acquisto</li>'; return; }
  list.innerHTML = [...items].reverse().slice(0, 50).map(s => {
    if (s.tipo === 'tradeoff') return '<li><span class="storico-nome">' + _escHtml(s.squadra) + '</span><span class="storico-tipo tipo-tag-tradeoff">trade-off: ' + _escHtml(TRADEOFF_LABELS[s.tradeoffTipo] || s.tradeoffTipo) + '</span></li>';
    if (s.tipo === 'scartato') return '<li><span class="storico-nome text-muted">' + _escHtml(s.giocatore.nome) + '</span><span class="storico-tipo tipo-tag-scartato">scartato</span></li>';
    const manualeTag = s.manuale ? '<span class="storico-manuale-tag" title="Chiamata/assegnazione manuale dell\'admin">🔨</span>' : '';
    if (s.tipo === 'con_svincolo' && filtro === 'recap-riparazione') {
      const nomi = _escHtml((s.svincolati || []).map(g => g.nome).join(', ') || '—');
      return '<li>' + manualeTag + '<span class="storico-nome">' + _escHtml(s.giocatore.nome) + '</span>' +
        '<span class="storico-sq">' + _escHtml(s.squadra) + '</span>' +
        '<span class="storico-tipo tipo-tag-con_svincolo">svincolati: ' + nomi + '</span></li>';
    }
    return '<li>' + manualeTag + '<span class="storico-nome">' + _escHtml(s.giocatore.nome) + '</span>' +
      '<span class="storico-sq">' + _escHtml(s.squadra) + '</span>' +
      '<span class="storico-prezzo">' + s.prezzo + 'cr</span>' +
      '<span class="storico-tipo tipo-tag-' + s.tipo + '">' + s.tipo + '</span></li>';
  }).join('');
}

function setupAstaMobileAccordion() {
  // Pannelli a fisarmonica per la vista mobile di screen-asta (Riepilogo squadre / Mio team).
  // Su desktop questa classe non ha alcun effetto visivo (nessuna regola CSS fuori dai media query mobile).
  const budgetHdr = document.querySelector('.panel-budget-hdr');
  const budgetPanel = document.querySelector('.panel-budget');
  if (budgetHdr && budgetPanel && !budgetHdr.dataset.accBound) {
    budgetHdr.dataset.accBound = '1';
    budgetHdr.addEventListener('click', () => budgetPanel.classList.toggle('acc-open'));
  }
  const mioHdr = document.querySelector('.mio-panel-header');
  const mioPanel = document.getElementById('mio-panel');
  if (mioHdr && mioPanel && !mioHdr.dataset.accBound) {
    mioHdr.dataset.accBound = '1';
    mioHdr.addEventListener('click', () => mioPanel.classList.toggle('acc-open'));
  }
}

function setupRoseCompatta() {
  const chk = document.getElementById('chk-rose-compatta');
  const panel = document.getElementById('rose-panel');
  if (!chk || !panel) return;
  const saved = localStorage.getItem('ftb_rose_compatta') === '1';
  chk.checked = saved;
  panel.classList.toggle('rose-compatta', saved);
  chk.addEventListener('change', () => {
    localStorage.setItem('ftb_rose_compatta', chk.checked ? '1' : '0');
    panel.classList.toggle('rose-compatta', chk.checked);
  });
}

function renderRose(squadre) {
  if (!squadre) return;
  const chiamata = S.asta && S.asta.chiamataAttuale;
  const squadraAttiva = chiamata && chiamata.squadraOfferente;
  const filtroRuolo = '';

  document.getElementById('rose-panel').innerHTML = squadre.map(sq => {
    const isAttiva = sq.nome === squadraAttiva;
    let giocatori = sq.rosa || [];
    if (filtroRuolo) giocatori = giocatori.filter(g => (g.ruolo||'') === filtroRuolo);
    const portieri = giocatori.filter(g => _isPortiere(g.ruolo));
    const movimento = giocatori.filter(g => !_isPortiere(g.ruolo));
    const ORDINE_RUOLI = ['Dd','Dc','Ds','D','B','M','E','C','T','W','A','Pc'];
    const _ruoloKey = (r) => (r || '').split('/')[0].trim();
    movimento.sort((a, b) => {
      const ia = ORDINE_RUOLI.indexOf(_ruoloKey(a.ruolo));
      const ib = ORDINE_RUOLI.indexOf(_ruoloKey(b.ruolo));
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
    const slotsRow = (S.asta && S.asta.tipoAsta === 'iniziale') ?
      '<div class="rose-col-slots">' +
        '<span class="slot-chip"><span class="slot-main">Max <span class="text-accent">' + calcolaMaxOffertaSquadra(sq) + 'cr</span></span></span>' +
        '<span class="slot-chip' + (((sq.recompra||0) - (sq.recompraUsati||0) <= 0)?' esaurito':'') + '"><span class="slot-main">Recompra <span>' + (sq.recompraUsati||0) + '/' + (sq.recompra!==undefined?sq.recompra:1) + '</span></span></span>' +
        '<span class="slot-chip"><span class="slot-main">RIC <span>' + sq.slotsRICUsati + '/' + sq.slotsRIC + '</span></span></span>' +
        '<span class="slot-chip"><span class="slot-main">PLUS <span>' + sq.slotsPLUSUsati + '/' + sq.slotsPLUS + '</span></span></span>' +
      '</div>' : '';
    return '<div class="rose-col' + (isAttiva ? ' attiva' : '') + '">' +
      '<div class="rose-col-header">' +
        '<span class="rose-col-nome">' + _escHtml(sq.nome) + '</span>' +
        '<span class="rose-col-budget' + (isAttiva ? ' attiva' : '') + '">🪙 ' + sq.crediti + '</span>' +
      '</div>' +
      slotsRow +
      _renderRoseSez('⛳ Por', portieri, 'por', sq.nome) +
      _renderRoseSez('⚡ Mov', movimento, 'mov', sq.nome) +
    '</div>';
  }).join('');
}

function _isPortiere(ruolo) { return ruolo === 'Por' || ruolo === 'P'; }

/* ══════ ANTEPRIMA: simulazione formazioni/moduli (locale, per-browser) ══════ */
const ANTEPRIMA_FORMAZIONI = {
  '3-4-3': [['P'],['DC','DC','DC/B'],['E','M/C','C','E'],['W/A','W/A'],['A/PC']],
  '3-4-1-2': [['P'],['DC','DC','DC/B'],['E','M/C','C','E'],['T'],['A/PC','A/PC']],
  '3-4-2-1': [['P'],['DC','DC','DC/B'],['M','M/C','E','E/W'],['T','T/A'],['A/PC']],
  '3-5-2': [['P'],['DC','DC','DC/B'],['E/W','M','M/C','C','E'],['A/PC','A/PC']],
  '3-5-1-1': [['P'],['DC','DC','DC/B'],['E/W','M','C','M','E/W'],['T/A'],['A/PC']],
  '4-3-3': [['P'],['DD','DC','DC','DS'],['M/C','M','C'],['W/A','W/A'],['A/PC']],
  '4-3-1-2': [['P'],['DD','DC','DC','DS'],['M/C','M','C'],['T'],['T/A/PC','A/PC']],
  '4-4-2': [['P'],['DD','DC','DC','DS'],['E/W','M/C','C','E'],['A/PC','A/PC']],
  '4-1-4-1': [['P'],['DD','DC','DC','DS'],['M'],['E/W','C/T','T','W'],['A/PC']],
  '4-4-1-1': [['P'],['DD','DC','DC','DS'],['E/W','M','C','E/W'],['T/A'],['A/PC']],
  '4-2-3-1': [['P'],['DD','DC','DC','DS'],['M','M/C'],['W/T','T','W/A'],['A/PC']]
};

const ANT_LS_KEY_BASE = 'ftb_anteprima_v1';

// Chiave per-asta (non solo per-squadra): senza S.astaId, entrando in un'asta nuova con una
// squadra dallo stesso nome si erediterebbe la formazione salvata dall'asta precedente, che
// puo' avere una rosa completamente diversa. Il planner resta "locale, per-browser" com'era,
// ma ora riparte vuoto ad ogni asta nuova invece di trascinarsi lo stato della precedente.
function _antLsKey() {
  return ANT_LS_KEY_BASE + '_' + (S.astaId || 'nessuna-asta');
}

function _antLoadAll() {
  try { return JSON.parse(localStorage.getItem(_antLsKey())) || {}; } catch(e) { return {}; }
}
function _antSaveAll(data) {
  try { localStorage.setItem(_antLsKey(), JSON.stringify(data)); } catch(e) {}
}
function _antGetSquadraState(nome) {
  const all = _antLoadAll();
  return all[nome] || { formazione: '4-3-3', slots: {} };
}
function _antSetSquadraState(nome, state) {
  const all = _antLoadAll();
  all[nome] = state;
  _antSaveAll(all);
}
function _antRoleClass(ruolo) {
  const base = (ruolo || '').split('/')[0].trim().toLowerCase();
  return 'ruolo-rose-' + base;
}
// Classe di sfondo per la riga di un giocatore nella sezione "Rose", basata
// sul suo PRIMO ruolo reale (stesso raggruppamento a 5 colori già usato per i
// badge dei ruoli: Por=giallo, Dd/Ds/Dc/D/B=verde, M/C/E=azzurro, T/W=viola, A/Pc=rosso).
function _roseRowRoleClass(ruolo) {
  const r = (ruolo || '').split('/')[0].trim().toUpperCase();
  if (r === 'POR' || r === 'P') return 'rose-riga-por';
  if (['DD','DS','DC','D','B'].includes(r)) return 'rose-riga-verde';
  if (['M','C','E'].includes(r)) return 'rose-riga-azzurro';
  if (['T','W'].includes(r)) return 'rose-riga-viola';
  if (['A','PC'].includes(r)) return 'rose-riga-rosso';
  return '';
}
// Verifica se un giocatore può occupare uno slot di modulo in Anteprima, in
// base ai ruoli REALI del giocatore (evita di poter piazzare un giocatore in
// una posizione non compatibile, es. un Dc puro in uno slot Attaccante).
// Entrambi i ruoli (slot e giocatore) possono contenere più opzioni separate
// da "/" (es. slot "DC/B", giocatore "C/W"): basta UNA corrispondenza in comune.
// Restituisce il ruolo REALE del giocatore (nella sua grafia originale, es. 'T' da 'W/T')
// che corrisponde allo slot in cui lo si sta per piazzare, cosi' nel selettore si mostra
// sempre il ruolo pertinente alla posizione, non semplicemente il primo ruolo del giocatore.
function _ruoloCorrispondente(ruoloSlot, ruoloGiocatore) {
  const norm = (r) => (r || '').split('/').map(x => x.trim()).filter(Boolean);
  const slotRolesUpper = norm(ruoloSlot).map(x => x.toUpperCase());
  const gioRoles = norm(ruoloGiocatore);
  const match = gioRoles.find(r => {
    const ru = r.toUpperCase() === 'POR' ? 'P' : r.toUpperCase();
    return slotRolesUpper.includes(ru);
  });
  return match || gioRoles[0] || ruoloGiocatore || 'NN';
}
function _ruoliCompatibili(ruoloSlot, ruoloGiocatore) {
  const norm = (r) => (r || '').split('/').map(x => x.trim().toUpperCase()).map(x => x === 'POR' ? 'P' : x).filter(Boolean);
  const slotRoles = norm(ruoloSlot);
  const gioRoles = norm(ruoloGiocatore);
  if (slotRoles.length === 0 || gioRoles.length === 0) return true;
  return slotRoles.some(sr => gioRoles.includes(sr));
}

// 250 (non 220): sotto questa soglia, misurato che anche con wrap su 4 righe un cognome
// eccezionalmente lungo (es. "Kvaratskhelia") non ci sta piu' nell'etichetta — l'utente ha
// chiesto esplicitamente che i nomi non vengano mai tagliati, quindi lo zoom minimo e' stato
// alzato quel poco che basta a garantirlo sempre (verificato via scrollHeight>clientHeight
// su tutti gli 11 moduli).
const ANT_PITCH_SIZE_MIN = 250;
const ANT_PITCH_SIZE_MAX = 460;
const ANT_PITCH_SIZE_STEP = 30;
const ANT_PITCH_SIZE_DEFAULT = 300;

function _antApplyPitchSize(px) {
  const pitch = document.getElementById('ant-pitch');
  if (pitch) pitch.style.setProperty('--ant-pitch-size', px + 'px');
}

function _antGetPitchSize() {
  const raw = parseInt(localStorage.getItem('antPitchSize'), 10);
  if (!raw || isNaN(raw)) return ANT_PITCH_SIZE_DEFAULT;
  return Math.min(ANT_PITCH_SIZE_MAX, Math.max(ANT_PITCH_SIZE_MIN, raw));
}

function _antSetPitchSize(px) {
  const clamped = Math.min(ANT_PITCH_SIZE_MAX, Math.max(ANT_PITCH_SIZE_MIN, px));
  localStorage.setItem('antPitchSize', String(clamped));
  _antApplyPitchSize(clamped);
}

// Toggle animazione assegnazione carta: solo locale (localStorage, come antPitchSize
// sopra), non sincronizzato tra partecipanti — l'animazione stessa e' gia' puramente
// client-side (vedi commento su _playAssegnazioneCardFx), quindi ogni browser decide
// per se' se mostrarla, senza toccare backend/socket/stato asta. Default: attiva.
function _antGetFxAbilitata() {
  return localStorage.getItem('antFxAbilitata') !== 'false';
}

function _antSetFxAbilitata(attiva) {
  localStorage.setItem('antFxAbilitata', attiva ? 'true' : 'false');
}

// Stessa soglia del breakpoint CSS "mobile" gia' usato altrove per Anteprima
// (.asta-live-layout{display:block}, vedi style.css).
function _antIsMobile() {
  return window.matchMedia('(max-width:760px)').matches;
}

// Su desktop #tab-anteprima resta un drawer laterale (figlio di .asta-live-layout, si affianca
// a .asta-main-col). Su mobile, richiesta esplicita dell'utente: deve comportarsi come una tab
// normale del pannello (esclusiva con le altre, non un drawer che si espande sotto tutto il
// resto della pagina) — per ottenerlo lo si sposta DAVVERO dentro .tabs-panel, cosi' eredita lo
// stesso flusso/scroll delle altre .tab-content invece di richiedere CSS duplicato apposta.
// La classe .ant-drawer-as-tab (solo mobile, vedi style.css) sostituisce le regole del drawer
// desktop con quelle di una tab normale SOLO quando l'elemento vive li'. Richiamata all'avvio e
// ad ogni resize/cambio orientamento che attraversa la soglia dei 760px.
function _antSyncDrawerLayout() {
  const drawer = document.getElementById('tab-anteprima');
  const tabsPanel = document.querySelector('.tabs-panel');
  const liveLayout = document.getElementById('asta-live-layout');
  if (!drawer || !tabsPanel || !liveLayout) return;
  if (_antIsMobile()) {
    if (drawer.parentElement !== tabsPanel) tabsPanel.appendChild(drawer);
    drawer.classList.add('ant-drawer-as-tab');
    drawer.classList.remove('drawer-open');
  } else {
    if (drawer.parentElement !== liveLayout) liveLayout.appendChild(drawer);
    drawer.classList.remove('ant-drawer-as-tab', 'active');
  }
}

// Apre/chiude il drawer Anteprima (classe .drawer-open su #tab-anteprima.ant-drawer, vedi
// style.css) — sostituisce il vecchio meccanismo .active di setupTabs() SOLO per questa tab,
// cosi' puo' restare aperto sopra Rose/Storico/altre tab senza nasconderle. Solo desktop, vedi
// _antSyncDrawerLayout() sopra per il comportamento mobile.
function _antToggleDrawer() {
  const drawer = document.getElementById('tab-anteprima');
  if (!drawer) return;
  drawer.classList.toggle('drawer-open');
}

// Sotto-tab interne "Vista campo 3D" / "Vista lista" — meccanismo indipendente da setupTabs()
// (stesso pattern gia' usato nel progetto per le sotto-tab di Griglia P/A, .gki-subtabs).
function _antSetupSubtabs() {
  document.querySelectorAll('.ant-subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ant-subtab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.ant-subview').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      const view = document.getElementById('ant-view-' + btn.dataset.antview);
      if (view) view.classList.add('active');
    });
  });
}

function setupAnteprima() {
  const selSquadra = document.getElementById('ant-squadra-select');
  const selModulo = document.getElementById('ant-modulo-select');
  const btnReset = document.getElementById('ant-reset-btn');
  const btnZoomIn = document.getElementById('ant-zoom-in');
  const btnZoomOut = document.getElementById('ant-zoom-out');
  const btnDrawerClose = document.getElementById('ant-drawer-close');
  if (btnDrawerClose) btnDrawerClose.addEventListener('click', _antToggleDrawer);
  _antSetupSubtabs();
  _antSyncDrawerLayout();
  // matchMedia 'change' invece di window.resize: e' l'evento pensato apposta per reagire
  // all'attraversamento di una soglia CSS (qui i 760px), scatta in modo affidabile anche su
  // rotazione dispositivo — un resize listener generico puo' non scattare in tempo utile.
  const _antMql = window.matchMedia('(max-width:760px)');
  if (_antMql.addEventListener) _antMql.addEventListener('change', _antSyncDrawerLayout);
  else if (_antMql.addListener) _antMql.addListener(_antSyncDrawerLayout); // fallback Safari vecchi
  if (!selSquadra || !selModulo) return;

  _antApplyPitchSize(_antGetPitchSize());
  if (btnZoomIn) {
    btnZoomIn.addEventListener('click', () => {
      _antSetPitchSize(_antGetPitchSize() + ANT_PITCH_SIZE_STEP);
    });
  }
  if (btnZoomOut) {
    btnZoomOut.addEventListener('click', () => {
      _antSetPitchSize(_antGetPitchSize() - ANT_PITCH_SIZE_STEP);
    });
  }

  selSquadra.addEventListener('change', () => {
    const nome = selSquadra.value;
    const state = _antGetSquadraState(nome);
    selModulo.value = state.formazione;
    renderAnteprimaPitch();
  });
  selModulo.addEventListener('change', () => {
    const nome = selSquadra.value;
    if (!nome) return;
    const state = _antGetSquadraState(nome);
    if (state.formazione !== selModulo.value) {
      state.formazione = selModulo.value;
      state.slots = {};
      _antSetSquadraState(nome, state);
    }
    renderAnteprimaPitch();
  });
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      const nome = selSquadra.value;
      if (!nome) return;
      if (!confirm('Svuotare tutti gli slot per ' + nome + '?')) return;
      const state = _antGetSquadraState(nome);
      state.slots = {};
      _antSetSquadraState(nome, state);
      renderAnteprimaPitch();
    });
  }
}

function populateAnteprimaSquadre(squadre) {
  const selSquadra = document.getElementById('ant-squadra-select');
  const selModulo = document.getElementById('ant-modulo-select');
  if (!selSquadra || !selModulo || !squadre) return;
  const prevVal = selSquadra.value;
  selSquadra.innerHTML = squadre.map(sq => '<option value="' + _escAttr(sq.nome) + '">' + _escHtml(sq.nome) + '</option>').join('');
  if (prevVal && squadre.some(sq => sq.nome === prevVal)) {
    selSquadra.value = prevVal;
  } else if (S.miaSquadra && squadre.some(sq => sq.nome === S.miaSquadra)) {
    // Preseleziona la squadra dell'utente stesso (richiesta esplicita: aprendo Anteprima si
    // vede subito la propria formazione) invece della prima della lista — solo quando non
    // c'e' gia' una scelta precedente da ricordare, cosi' se l'utente sta consultando
    // l'Anteprima di un'altra squadra questa non gli viene rimessa sotto ad ogni aggiornamento.
    selSquadra.value = S.miaSquadra;
  }
  if (selSquadra.value) {
    const state = _antGetSquadraState(selSquadra.value);
    selModulo.value = state.formazione;
  }
  renderAnteprimaPitch();
}

// Coordinate fisse (left%, top%) per ogni slot di ogni modulo, calibrate per
// riprodurre la disposizione reale di un campo tattico (stile schema "Mantra"),
// invece di una griglia generica a righe/colonne equidistanti che risultava
// poco realistica (es. mediano unico sovrapposto al cerchio di centrocampo).
// La struttura rispecchia esattamente quella di ANTEPRIMA_FORMAZIONI (stesso
// numero di righe e colonne per ogni modulo).
// NOTA overlap (requisito UI: nessuna carta deve mai coprirne un'altra): le righe con
// giocatori sulla stessa X di quella immediatamente sopra/sotto (es. portiere e difensore
// centrale nei moduli a 3, o un centrocampista esattamente sotto un difensore) restavano
// troppo vicine verticalmente e le carte si sovrapponevano — verificato misurando
// getBoundingClientRect() delle carte renderizzate in tutti gli 11 moduli. Le coordinate
// sotto sono state solo diradate (piu' spazio verticale, X leggermente disallineate tra
// righe adiacenti) per eliminare le sovrapposizioni: stesso numero di righe/colonne di
// ANTEPRIMA_FORMAZIONI per ogni modulo, nessun cambio alla logica Mantra.
// Y "a fasce" (invariato il numero di righe/colonne per modulo, solo la profondita'):
// con card a dimensione fissa rispetto al campo (vedi .size-pitch/.ant-slot3d-empty, in
// cqw), un gap verticale inferiore al ~20% dell'altezza campo produce quasi sempre
// sovrapposizione quando due ruoli di righe adiacenti condividono una X simile (es.
// portiere/difensore centrale, playmaker/trequartista) — misurato su tutti gli 11 moduli
// con getBoundingClientRect(). Le fasce sotto usano gap ~21-23%, il massimo che ci sta
// nello spazio verticale disponibile per 4 o 5 righe.
const ANT_Y5 = [4, 25, 48, 71, 94];   // moduli a 5 righe (schieramento+portiere)
const ANT_Y4 = [4, 27, 58, 93];       // moduli a 4 righe (centrocampo/attacco piu' larghi)
const ANT_LAYOUT = {
  '3-4-3': [
    [[50, ANT_Y5[0]]],
    [[24, ANT_Y5[1]], [40, ANT_Y5[1]], [76, ANT_Y5[1]]],
    [[15, ANT_Y5[2]], [38, ANT_Y5[2]], [62, ANT_Y5[2]], [85, ANT_Y5[2]]],
    [[24, ANT_Y5[3]], [76, ANT_Y5[3]]],
    [[50, ANT_Y5[4]]]
  ],
  '3-4-1-2': [
    [[50, ANT_Y5[0]]],
    [[24, ANT_Y5[1]], [40, ANT_Y5[1]], [76, ANT_Y5[1]]],
    [[15, ANT_Y5[2]], [38, ANT_Y5[2]], [62, ANT_Y5[2]], [85, ANT_Y5[2]]],
    [[50, ANT_Y5[3]]],
    [[36, ANT_Y5[4]], [64, ANT_Y5[4]]]
  ],
  '3-4-2-1': [
    [[50, ANT_Y5[0]]],
    [[24, ANT_Y5[1]], [40, ANT_Y5[1]], [76, ANT_Y5[1]]],
    [[16, ANT_Y5[2]], [45, ANT_Y5[2]], [72, ANT_Y5[2]], [88, ANT_Y5[2]]],
    [[38, ANT_Y5[3]], [64, ANT_Y5[3]]],
    [[50, ANT_Y5[4]]]
  ],
  '3-5-2': [
    [[50, ANT_Y4[0]]],
    [[24, ANT_Y4[1]], [40, ANT_Y4[1]], [76, ANT_Y4[1]]],
    [[10, ANT_Y4[2]], [32, ANT_Y4[2]], [50, ANT_Y4[2]], [68, ANT_Y4[2]], [90, ANT_Y4[2]]],
    [[36, ANT_Y4[3]], [64, ANT_Y4[3]]]
  ],
  '3-5-1-1': [
    [[50, ANT_Y5[0]]],
    [[24, ANT_Y5[1]], [40, ANT_Y5[1]], [76, ANT_Y5[1]]],
    [[10, ANT_Y5[2]], [32, ANT_Y5[2]], [50, ANT_Y5[2]], [68, ANT_Y5[2]], [90, ANT_Y5[2]]],
    [[50, ANT_Y5[3]]],
    [[50, ANT_Y5[4]]]
  ],
  '4-3-3': [
    [[50, ANT_Y5[0]]],
    [[16, ANT_Y5[1]], [38, ANT_Y5[1]], [62, ANT_Y5[1]], [84, ANT_Y5[1]]],
    [[28, ANT_Y5[2]], [50, ANT_Y5[2]], [72, ANT_Y5[2]]],
    [[22, ANT_Y5[3]], [78, ANT_Y5[3]]],
    [[50, ANT_Y5[4]]]
  ],
  '4-3-1-2': [
    [[50, ANT_Y5[0]]],
    [[16, ANT_Y5[1]], [38, ANT_Y5[1]], [62, ANT_Y5[1]], [84, ANT_Y5[1]]],
    [[28, ANT_Y5[2]], [50, ANT_Y5[2]], [72, ANT_Y5[2]]],
    [[50, ANT_Y5[3]]],
    [[36, ANT_Y5[4]], [64, ANT_Y5[4]]]
  ],
  '4-4-2': [
    [[50, ANT_Y4[0]]],
    [[16, ANT_Y4[1]], [38, ANT_Y4[1]], [62, ANT_Y4[1]], [84, ANT_Y4[1]]],
    [[14, ANT_Y4[2]], [34, ANT_Y4[2]], [66, ANT_Y4[2]], [86, ANT_Y4[2]]],
    [[36, ANT_Y4[3]], [64, ANT_Y4[3]]]
  ],
  '4-1-4-1': [
    [[50, ANT_Y5[0]]],
    [[16, ANT_Y5[1]], [38, ANT_Y5[1]], [62, ANT_Y5[1]], [84, ANT_Y5[1]]],
    [[50, ANT_Y5[2]]],
    [[14, ANT_Y5[3]], [38, ANT_Y5[3]], [62, ANT_Y5[3]], [86, ANT_Y5[3]]],
    [[50, ANT_Y5[4]]]
  ],
  '4-4-1-1': [
    [[50, ANT_Y5[0]]],
    [[16, ANT_Y5[1]], [38, ANT_Y5[1]], [62, ANT_Y5[1]], [84, ANT_Y5[1]]],
    [[26, ANT_Y5[2]], [42, ANT_Y5[2]], [58, ANT_Y5[2]], [74, ANT_Y5[2]]],
    [[50, ANT_Y5[3]]],
    [[50, ANT_Y5[4]]]
  ],
  '4-2-3-1': [
    [[50, ANT_Y5[0]]],
    [[16, ANT_Y5[1]], [38, ANT_Y5[1]], [62, ANT_Y5[1]], [84, ANT_Y5[1]]],
    [[30, ANT_Y5[2]], [70, ANT_Y5[2]]],
    [[20, ANT_Y5[3]], [50, ANT_Y5[3]], [80, ANT_Y5[3]]],
    [[50, ANT_Y5[4]]]
  ]
};

// Foto carta 3D: nuovo consumatore della STESSA cache/ricerca gia' usata per .cc-avatar in
// Puja (_playerPhotoCache/_tryLocalPhoto, vedi sopra ~L2554) — non tocca quelle funzioni,
// scrive/legge la stessa cache condivisa cosi' una foto gia' risolta in Puja e' istantanea
// anche qui (e viceversa). _applyPlayerPhoto esistente non e' riusabile perche' e' agganciata
// in modo fisso a #chiamata-card .cc-avatar (vedi commento li'), da qui un piccolo omologo.
function _antApplyCardPhoto(el, nome, squadra) {
  const cacheKey = nome + '|' + (squadra || '');
  if (Object.prototype.hasOwnProperty.call(_playerPhotoCache, cacheKey)) {
    el.style.backgroundImage = "url('" + _playerPhotoCache[cacheKey] + "')";
    return;
  }
  _withTimeout(_tryLocalPhoto(nome, squadra), 4000, null).then(function(finalUrl) {
    const url = finalUrl || 'img/players/unknown_anime.jpg';
    _playerPhotoCache[cacheKey] = url;
    if (document.body.contains(el)) el.style.backgroundImage = "url('" + url + "')";
  }).catch(function() {
    _playerPhotoCache[cacheKey] = 'img/players/unknown_anime.jpg';
  });
}

// Carta 3D per un giocatore reale (panchina o campo) — riusa _getRuoloBadgeHTML() (badge per
// ruolo, mai troncato, gia' usato altrove) e _roseRowRoleClass() (stesso raggruppamento a 5
// colori gia' usato per le righe di Rose) per il colore d'accento, nessuna palette nuova.
function _antCardHTML(g, size, onPitch) {
  const accentClass = _roseRowRoleClass(g.ruolo);
  const sizeClass = size === 'xl' ? 'size-xl' : (onPitch ? 'size-pitch' : 'size-bench');
  const stato = onPitch ? 'on-pitch' : 'in-bench';
  let html = '<div class="ant-card ' + stato + ' ' + sizeClass + ' ' + accentClass + '" data-nome="' + _escAttr(g.nome) + '">' +
    '<div class="ant-card-photo"></div>' +
    '<div class="ant-card-role">' + _getRuoloBadgeHTML(g.ruolo) + '</div>';
  if (!onPitch) {
    // Il nome vive in uno <span> interno NON posizionato, dentro al div assoluto solo per il
    // posizionamento — necessario per il wrap multi-riga della carta XL (vedi CSS
    // .ant-card-name-txt): display:-webkit-box (per -webkit-line-clamp) non funziona se
    // applicato direttamente a un elemento position:absolute, va sull'elemento interno.
    html += '<div class="ant-card-fade"></div><div class="ant-card-name"><span class="ant-card-name-txt">' + _escHtml(g.nome) + '</span></div>';
  }
  html += '</div>';
  return html;
}

// Animazione di assegnazione: carta che esce da .cc-avatar (Puja), zoom veloce al centro,
// picco 3D, drop verso il basso, ~1-1.2s. Overlay puramente client-side (nessun evento socket
// nuovo, 'giocatore-assegnato' arriva gia' a tutti — vedi handler sopra), non tocca il DOM
// interno di #chiamata-card: legge solo la posizione di .cc-avatar con getBoundingClientRect()
// e lavora su un clone separato dentro #assegnazione-fx-layer (fuori da .tabs-panel apposta,
// vedi style.css). Tetto di 3 cloni simultanei: assegnazioni manuali rapide non devono accumulare.
let _antFxCloniAttivi = 0;
const ANT_FX_MAX_CLONI = 3;
function _playAssegnazioneCardFx(giocatore) {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!_antGetFxAbilitata()) return;
  const layer = document.getElementById('assegnazione-fx-layer');
  const avatarEl = document.querySelector('#chiamata-card .cc-avatar');
  if (!layer || !avatarEl || !giocatore) return;
  if (_antFxCloniAttivi >= ANT_FX_MAX_CLONI) return;

  const srcRect = avatarEl.getBoundingClientRect();
  if (!srcRect.width || !srcRect.height) return;

  const wrap = document.createElement('div');
  wrap.className = 'assegnazione-fx-card';
  wrap.style.left = srcRect.left + 'px';
  wrap.style.top = srcRect.top + 'px';
  wrap.style.width = srcRect.width + 'px';
  wrap.style.height = srcRect.height + 'px';
  wrap.innerHTML = _antCardHTML(giocatore, 'xl', false);
  const cardEl = wrap.firstElementChild;
  if (cardEl) {
    cardEl.style.width = '100%';
    cardEl.style.height = '100%';
    cardEl.style.boxShadow = '0 20px 50px rgba(0,0,0,.6), 0 0 40px var(--gold-glow,rgba(255,179,0,.5))';
  }
  layer.appendChild(wrap);
  _antApplyCardPhoto(wrap.querySelector('.ant-card-photo'), giocatore.nome, giocatore.squadra);
  const fxNameTxt = wrap.querySelector('.ant-card-name-txt');
  if (fxNameTxt) _antFitTestoLabel(fxNameTxt, 96);

  const cx = window.innerWidth / 2, cy = window.innerHeight * 0.42;
  const srcCx = srcRect.left + srcRect.width / 2, srcCy = srcRect.top + srcRect.height / 2;
  const dx = cx - srcCx, dy = cy - srcCy;
  const scalePeak = Math.max(2.2, 220 / srcRect.width);

  _antFxCloniAttivi++;
  const anim = wrap.animate([
    { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1, offset: 0 },
    { transform: 'translate(' + (dx * 0.6) + 'px,' + (dy * 0.6) + 'px) scale(' + (scalePeak * 0.8) + ') rotate(-3deg)', opacity: 1, offset: .18 },
    { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + scalePeak + ') rotate(0deg)', opacity: 1, offset: .32 },
    // Hold: stessa posizione/scala per un lungo tratto, cosi' carta/avatar/nome restano
    // leggibili al centro schermo invece di attraversarlo di corsa (richiesta esplicita
    // dell'utente, durata totale portata da ~1.1s a ~3s).
    { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + scalePeak + ') rotate(0deg)', opacity: 1, offset: .68 },
    { transform: 'translate(' + dx + 'px,' + (dy + 30) + 'px) scale(' + (scalePeak * 0.92) + ') rotate(2deg)', opacity: 1, offset: .85 },
    { transform: 'translate(' + dx + 'px,' + (dy + 160) + 'px) scale(' + (scalePeak * 0.6) + ') rotate(0deg)', opacity: 0, offset: 1 }
  ], { duration: 3000, easing: 'cubic-bezier(.3,.7,.3,1)' });
  const cleanup = () => { _antFxCloniAttivi = Math.max(0, _antFxCloniAttivi - 1); wrap.remove(); };
  anim.onfinish = cleanup;
  anim.oncancel = cleanup;
}

// Panchina: derivata al volo (rosa reale meno chi e' gia' piazzato nel planner locale) — zero
// nuovo stato persistito, zero cambio allo schema salvato in localStorage da _antSetSquadraState.
// Chiamata da renderAnteprimaPitch(), quindi si aggiorna automaticamente ad ogni giro gia'
// esistente di populateAnteprimaSquadre() (a sua volta gia' chiamata dall'handler 'stato-asta'
// dopo ogni giocatore-assegnato) — "compare in panchina appena vinto" senza nessun nuovo aggancio.
function _antRenderPanchina(nomeSquadra) {
  const panchina = document.getElementById('ant-panchina');
  if (!panchina) return;
  const squadra = ((S.asta && S.asta.squadre) || []).find(sq => sq.nome === nomeSquadra);
  const rosa = (squadra && squadra.rosa) || [];
  const state = _antGetSquadraState(nomeSquadra);
  const assegnati = new Set(Object.keys(state.slots).map(k => state.slots[k]));
  const disponibili = rosa.filter(g => !assegnati.has(g.nome));
  let html = '<div class="ant-panchina-hdr"><span class="ant-panchina-title">🪑 Panchina</span><span class="ant-panchina-count">' + disponibili.length + '</span></div>';
  if (!disponibili.length) {
    html += '<div class="ant-panchina-empty">Nessun giocatore in panchina</div>';
  } else {
    html += '<div class="ant-panchina-grid">' + disponibili.map(g => _antCardHTML(g, null, false)).join('') + '</div>';
  }
  panchina.innerHTML = html;
  panchina.querySelectorAll('.ant-card[data-nome]').forEach(el => {
    const g = disponibili.find(x => x.nome === el.dataset.nome);
    if (g) _antApplyCardPhoto(el.querySelector('.ant-card-photo'), g.nome, g.squadra);
  });
}

// Sotto-tab "Vista lista" — stessi dati di rosa/state gia' usati per campo+panchina, solo una
// resa piatta alternativa (utile su schermi piccoli o per scorrere l'intera rosa velocemente).
function _antRenderLista(nomeSquadra) {
  const lista = document.getElementById('ant-lista-giocatori');
  if (!lista) return;
  const squadra = ((S.asta && S.asta.squadre) || []).find(sq => sq.nome === nomeSquadra);
  const rosa = (squadra && squadra.rosa) || [];
  if (!nomeSquadra || !rosa.length) {
    lista.innerHTML = '<li class="text-muted" style="padding:8px">Nessun giocatore</li>';
    return;
  }
  const state = _antGetSquadraState(nomeSquadra);
  const schierati = new Set(Object.keys(state.slots).map(k => state.slots[k]));
  lista.innerHTML = rosa.map(g => {
    const inCampo = schierati.has(g.nome);
    return '<li>' + _getRuoloBadgeHTML(g.ruolo) +
      '<span class="ant-lista-nome">' + _escHtml(g.nome) + '</span>' +
      '<span class="ant-lista-slot">' + (inCampo ? '⚽ In campo' : '🪑 Panchina') + '</span>' +
    '</li>';
  }).join('');
}

function _antRenderVuoto() {
  const pitch = document.getElementById('ant-pitch');
  if (pitch) pitch.innerHTML = '';
  const panchina = document.getElementById('ant-panchina');
  if (panchina) panchina.innerHTML = '';
  const lista = document.getElementById('ant-lista-giocatori');
  if (lista) lista.innerHTML = '';
}

// Riduce il font-size di un'etichetta finche' il suo contenuto (riga singola, mai a capo) non
// entra nella larghezza disponibile — richiesta esplicita dell'utente: nome sempre su una riga
// sola, mai tagliato, mai sovrapposto al vicino. Uno spazio fisso in CSS non basta perche' la
// larghezza realmente disponibile varia da riga a riga e da modulo a modulo (vedi
// _antFitEtichetteCampo sotto), quindi si misura sul DOM reale invece di stimarla.
function _antFitTestoLabel(el, maxWidthPx) {
  el.style.maxWidth = maxWidthPx + 'px';
  let fontPx = 9;
  el.style.fontSize = fontPx + 'px';
  while (el.scrollWidth > maxWidthPx && fontPx > 5) {
    fontPx -= 0.5;
    el.style.fontSize = fontPx + 'px';
  }
}

// Per ogni riga del campo, misura la distanza REALE (getBoundingClientRect, dopo il render —
// tiene conto automaticamente della prospettiva 3D, che rende i gap in percentuale diversi in
// pixel a seconda della profondita' della riga) tra gli slot vicini e restringe il nome di
// ognuno finche' non entra in quello spazio, senza mai invadere quello del vicino. I ruoli sugli
// slot vuoti (badge, non testo libero) non sono toccati: non hanno questo problema.
function _antFitEtichetteCampo(pitch) {
  const perRiga = {};
  pitch.querySelectorAll('.ant-slot3d').forEach(el => {
    const ri = el.dataset.slotkey.split('-')[0];
    (perRiga[ri] = perRiga[ri] || []).push(el);
  });
  Object.values(perRiga).forEach(elsRiga => {
    const conCentro = elsRiga.map(el => {
      const r = el.getBoundingClientRect();
      return { el, cx: r.left + r.width / 2 };
    }).sort((a, b) => a.cx - b.cx);
    conCentro.forEach((item, idx) => {
      const nameTxt = item.el.querySelector('.ant-slot3d-name-txt');
      if (!nameTxt) return;
      let gapPx = Infinity;
      if (idx > 0) gapPx = Math.min(gapPx, item.cx - conCentro[idx - 1].cx);
      if (idx < conCentro.length - 1) gapPx = Math.min(gapPx, conCentro[idx + 1].cx - item.cx);
      if (!isFinite(gapPx)) gapPx = 120;
      _antFitTestoLabel(nameTxt, Math.max(24, gapPx - 6));
    });
  });
}

function renderAnteprimaPitch() {
  const pitch = document.getElementById('ant-pitch');
  const selSquadra = document.getElementById('ant-squadra-select');
  const selModulo = document.getElementById('ant-modulo-select');
  if (!pitch || !selSquadra || !selModulo) return;
  pitch.classList.add('ant-pitch3d');
  const nomeSquadra = selSquadra.value;
  if (!nomeSquadra) { _antRenderVuoto(); return; }
  const modulo = selModulo.value;
  const rows = ANTEPRIMA_FORMAZIONI[modulo];
  if (!rows) { _antRenderVuoto(); return; }
  const state = _antGetSquadraState(nomeSquadra);
  const layout = ANT_LAYOUT[modulo];
  const squadra = ((S.asta && S.asta.squadre) || []).find(sq => sq.nome === nomeSquadra);
  const rosa = (squadra && squadra.rosa) || [];
  // Bordo neon + bracket agli angoli (stile HUD/tech) — puramente decorativo, .ant-pitch3d-border
  // esisteva gia' in CSS ma senza markup: aggiunto qui perche' pitch.innerHTML viene rigenerato
  // ad ogni render, non puo' vivere come elemento statico in index.html.
  let html = '<div class="ant-pitch3d-border">' +
    '<span class="ant-pitch-corner ant-pitch-corner-tl"></span>' +
    '<span class="ant-pitch-corner ant-pitch-corner-tr"></span>' +
    '<span class="ant-pitch-corner ant-pitch-corner-bl"></span>' +
    '<span class="ant-pitch-corner ant-pitch-corner-br"></span>' +
  '</div>';
  rows.forEach((row, ri) => {
    const nCols = row.length;
    row.forEach((ruolo, ci) => {
      const coords = layout && layout[ri] && layout[ri][ci];
      const left = coords ? coords[0] : (nCols === 1 ? 50 : 12 + ci * (76 / (nCols - 1)));
      const top = coords ? coords[1] : (rows.length === 1 ? 50 : 8 + ri * (84 / (rows.length - 1)));
      const slotKey = ri + '-' + ci;
      const nomeGiocatore = state.slots[slotKey];
      const filled = !!nomeGiocatore;
      const g = filled ? rosa.find(x => x.nome === nomeGiocatore) : null;
      html += '<div class="ant-slot3d' + (filled ? ' filled' : '') + '" data-slotkey="' + slotKey + '" data-ruolo="' + _escAttr(ruolo) + '" style="top:' + top + '%;left:' + left + '%">';
      if (g) {
        // Ombra di contatto: elemento piatto sul piano del campo (NON contro-ruotato come la
        // carta) — e' il segnale visivo che vende la sensazione "la carta sta in piedi sopra
        // il prato", altrimenti anche con la matrice 3D corretta le foto piatte leggono come
        // adagiate sul campo invece che ritte.
        html += '<div class="ant-slot3d-shadow"></div>' + _antCardHTML(g, null, true) + '<div class="ant-slot3d-label"><span class="ant-slot3d-name-txt">' + _escHtml(g.nome) + '</span></div>';
      } else if (filled) {
        // Giocatore assegnato allo slot ma non piu' in rosa (es. annullato dopo lo schieramento): fallback "fantasma", mai un crash.
        html += '<div class="ant-slot3d-shadow"></div><div class="ant-card on-pitch size-pitch placeholder">?</div><div class="ant-slot3d-label"><span class="ant-slot3d-name-txt">' + _escHtml(nomeGiocatore) + '</span></div>';
      } else {
        html += '<div class="ant-slot3d-empty">+</div><div class="ant-slot3d-label">' + _getRuoloBadgeHTML(ruolo) + '</div>';
      }
      html += '</div>';
    });
  });
  pitch.innerHTML = html;
  pitch.querySelectorAll('.ant-slot3d').forEach(el => {
    el.addEventListener('click', (e) => _antOpenPicker(e.currentTarget, nomeSquadra));
  });
  pitch.querySelectorAll('.ant-card[data-nome]').forEach(el => {
    const g = rosa.find(x => x.nome === el.dataset.nome);
    if (g) _antApplyCardPhoto(el.querySelector('.ant-card-photo'), g.nome, g.squadra);
  });
  _antFitEtichetteCampo(pitch);
  _antRenderPanchina(nomeSquadra);
  _antRenderLista(nomeSquadra);
}

function _antOpenPicker(slotEl, nomeSquadra) {
  const picker = document.getElementById('ant-picker');
  if (!picker) return;
  const squadra = ((S.asta && S.asta.squadre) || []).find(sq => sq.nome === nomeSquadra);
  const rosa = (squadra && squadra.rosa) || [];
  const slotKey = slotEl.dataset.slotkey;
  const state = _antGetSquadraState(nomeSquadra);
  const assegnatiAltrove = new Set(Object.keys(state.slots).filter(k => k !== slotKey).map(k => state.slots[k]));
  const ruoloSlot = slotEl.dataset.ruolo;
  const disponibili = rosa.filter(g => !assegnatiAltrove.has(g.nome) && _ruoliCompatibili(ruoloSlot, g.ruolo));

  let html = '<div class="ant-picker-hdr">Scegli giocatore</div>';
  if (disponibili.length === 0) {
    html += '<div class="ant-picker-empty">Nessun giocatore disponibile</div>';
  } else {
    html += disponibili.map(g => {
      const ruoloMostrato = _ruoloCorrispondente(ruoloSlot, g.ruolo);
      return '<div class="ant-picker-item" data-nome="' + _escAttr(g.nome) + '">' +
        '<span class="rose-badge ' + _antRoleClass(ruoloMostrato) + '">' + _escHtml(ruoloMostrato) + '</span>' +
        '<span>' + _escHtml(g.nome) + '</span>' +
      '</div>';
    }).join('');
  }
  if (state.slots[slotKey]) {
    html += '<div class="ant-picker-remove" data-action="remove">✕ Rimuovi</div>';
  }
  picker.innerHTML = html;
  picker.classList.remove('hidden');

  // Posiziona il picker usando le dimensioni REALI misurate dopo il render
  // (non una stima fissa), così non finisce mai fuori dallo schermo, anche
  // con nomi lunghi o su schermi piccoli/mobile.
  // Il picker e' position:absolute rispetto al contenitore #tab-anteprima (non piu' position:fixed
  // rispetto al viewport), perche' l'antenato .tabs-panel usa backdrop-filter, che crea un nuovo
  // containing block per gli elementi fixed: le coordinate calcolate con getBoundingClientRect()
  // (relative al viewport) finivano quindi disallineate rispetto alla posizione reale del click.
  const containerEl = picker.parentElement;
  const containerRect = containerEl.getBoundingClientRect();
  const rect = slotEl.getBoundingClientRect();
  const pRect = picker.getBoundingClientRect();
  const pW = pRect.width || 220, pH = pRect.height || 280;
  let left = rect.left - containerRect.left + containerEl.scrollLeft;
  let top = rect.bottom - containerRect.top + containerEl.scrollTop + 4;
  const maxLeft = containerEl.scrollLeft + containerRect.width - pW - 8;
  if (left > maxLeft) left = maxLeft;
  const viewportBottomInContainer = containerEl.scrollTop + (window.innerHeight - containerRect.top) - 8;
  if (top + pH > viewportBottomInContainer) {
    top = (rect.top - containerRect.top + containerEl.scrollTop) - pH - 4;
  }
  picker.style.left = Math.max(4, left) + 'px';
  picker.style.top = Math.max(4, top) + 'px';

  picker.querySelectorAll('.ant-picker-item').forEach(item => {
    item.addEventListener('click', () => {
      const nome = item.dataset.nome;
      const st = _antGetSquadraState(nomeSquadra);
      st.slots[slotKey] = nome;
      _antSetSquadraState(nomeSquadra, st);
      picker.classList.add('hidden');
      renderAnteprimaPitch();
    });
  });
  const removeBtn = picker.querySelector('.ant-picker-remove');
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      const st = _antGetSquadraState(nomeSquadra);
      delete st.slots[slotKey];
      _antSetSquadraState(nomeSquadra, st);
      picker.classList.add('hidden');
      renderAnteprimaPitch();
    });
  }

  setTimeout(() => {
    document.addEventListener('click', _antCloseHandler);
  }, 0);
}

function _antCloseHandler(e) {
  const picker = document.getElementById('ant-picker');
  if (!picker) return;
  if (!picker.contains(e.target) && !(e.target.closest && e.target.closest('.ant-slot, .ant-slot3d'))) {
    picker.classList.add('hidden');
    document.removeEventListener('click', _antCloseHandler);
  }
}


function _escAttr(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Escapa una stringa per inserirla in modo sicuro dentro un attributo HTML (tra doppi apici)
// che contiene a sua volta un letterale JS tra apici singoli, es: onclick="fn('...')".
// Senza questo, un nome squadra scelto liberamente da un partecipante (nessuna validazione)
// potrebbe chiudere l'attributo o la stringa JS ed eseguire codice arbitrario nel browser
// dell'admin (XSS memorizzato) — vedi audit sicurezza agosto 2026.
function _escJsAttr(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _renderRoseSez(titolo, giocatori, tipo, sqNome) {
  sqNome = sqNome || '';
  const secId = 'rsec-' + tipo + '-' + sqNome.replace(/\W/g,'');
  const collapsed = window._roseCollapsed && window._roseCollapsed[secId];
  return '<div class="rose-section ' + tipo + '">' +
    '<div class="rose-sec-hdr' + (collapsed ? ' collapsed' : '') + '" data-secid="' + secId + '" onclick="_toggleRoseSec(this,\'' + secId + '\')">' +
      '<span>' + titolo + ' <small>(' + giocatori.length + ')</small></span>' +
      '<span class="rose-arrow">' + (collapsed ? '▸' : '▾') + '</span>' +
    '</div>' +
    '<div class="rose-sec-body' + (collapsed ? ' collapsed' : '') + '">' +
      (giocatori.length === 0
        ? '<div class="rose-empty">—</div>'
        : giocatori.map(g => {
            const ruoloBadgeHTML = (g.ruolo || 'NN').split('/').map(function(x) {
              x = x.trim();
              return '<span class="rose-badge ruolo-rose-' + x.toLowerCase() + '">' + x + '</span>';
            }).join('');
            return '<div class="rose-player ' + _roseRowRoleClass(g.ruolo) + '" data-rose-nome="' + _escAttr(g.nome) + '" data-rose-squadra="' + _escAttr(sqNome) + '">' +
              ruoloBadgeHTML +
              '<span class="rose-nome">' + _escHtml(g.nome) + '</span>' +
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

function _getAllRosaFlat() {
  const squadre = (S.asta && S.asta.squadre) || [];
  const out = [];
  squadre.forEach(sq => (sq.rosa || []).forEach(g => out.push({ nome: g.nome, ruolo: g.ruolo, squadra: sq.nome })));
  return out;
}

window._renderRoseDropdown = function(query) {
  const dd = document.getElementById('rose-search-dropdown');
  if (!dd) return;
  const q = (query || '').toLowerCase().trim();
  if (!q) { dd.classList.add('hidden'); dd.innerHTML = ''; return; }
  const matches = _getAllRosaFlat().filter(p => p.nome.toLowerCase().includes(q)).slice(0, 10);
  if (!matches.length) {
    dd.innerHTML = '<div class="rose-search-empty">Nessun giocatore trovato</div>';
    dd.classList.remove('hidden');
    return;
  }
  dd.innerHTML = matches.map(p =>
    '<div class="rose-search-item" data-item-nome="' + _escAttr(p.nome) + '" data-item-squadra="' + _escAttr(p.squadra) + '">' +
      '<span>' + _escAttr(p.nome) + '</span>' +
      '<span class="rose-search-item-sq">' + _escAttr(p.squadra) + '</span>' +
    '</div>'
  ).join('');
  dd.classList.remove('hidden');
};

document.addEventListener('click', function(e) {
  const item = e.target.closest && e.target.closest('.rose-search-item');
  if (item && item.dataset.itemNome !== undefined) {
    selezionaGiocatoreRose(item.dataset.itemNome, item.dataset.itemSquadra);
  }
});

window.selezionaGiocatoreRose = function(nome, squadra) {
  const dd = document.getElementById('rose-search-dropdown');
  if (dd) { dd.classList.add('hidden'); dd.innerHTML = ''; }
  const row = document.getElementById('rose-search-row');
  if (row) row.classList.add('hidden');
  const toggle = document.getElementById('btn-rose-search-toggle');
  if (toggle) toggle.classList.remove('open');
  const input = document.getElementById('rose-cerca');
  if (input) input.value = '';

  let target = null;
  document.querySelectorAll('.rose-player').forEach(el => {
    if (el.dataset.roseNome === nome && el.dataset.roseSquadra === squadra) target = el;
  });
  if (!target) { toast('Giocatore non trovato nella rosa', 'error'); return; }

  const secBody = target.closest('.rose-sec-body');
  if (secBody && secBody.classList.contains('collapsed')) {
    const hdr = secBody.previousElementSibling;
    if (hdr && hdr.classList.contains('rose-sec-hdr')) _toggleRoseSec(hdr, hdr.dataset.secid || '');
  }
  target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  target.classList.remove('highlight-flash');
  void target.offsetWidth;
  target.classList.add('highlight-flash');
  setTimeout(() => target.classList.remove('highlight-flash'), 1800);
};

window.selezionaPrimoRisultatoRose = function() {
  const input = document.getElementById('rose-cerca');
  const val = ((input && input.value) || '').toLowerCase().trim();
  if (!val) return;
  const match = _getAllRosaFlat().find(p => p.nome.toLowerCase().includes(val));
  if (match) selezionaGiocatoreRose(match.nome, match.squadra);
  else toast('Nessun giocatore trovato', 'error');
};

window.aggiornaFiltroRose = function() {
  if (S.asta && S.asta.squadre) renderRose(S.asta.squadre);
};

function renderGiocatoriLiberi(pool) {
  const list = document.getElementById('liberi-list');
  const counter = document.getElementById('liberi-counter');
  if (!pool) { list.innerHTML = ''; if (counter) counter.textContent = ''; return; }
  if (counter) {
    const chiamati = pool.filter(g => g.estratto).length;
    counter.textContent = chiamati + ' / ' + pool.length + ' giocatori chiamati';
  }
  const cercaTesto = ((document.getElementById('liberi-cerca') || {}).value || '').toLowerCase().trim();
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
  const strat = S.strategiaAsta;
  const byFasciaStrategia = (a, b) => {
    const ca = strat.configByListinoId.get(a.idFantaleghe);
    const cb = strat.configByListinoId.get(b.idFantaleghe);
    const oa = (ca && ca.fascia_id && strat.fasceOrdine.has(ca.fascia_id)) ? strat.fasceOrdine.get(ca.fascia_id) : 9999;
    const ob = (cb && cb.fascia_id && strat.fasceOrdine.has(cb.fascia_id)) ? strat.fasceOrdine.get(cb.fascia_id) : 9999;
    if (oa !== ob) return oa - ob;
    const pa = ca ? (prezzoRealeStrategia(ca) ?? -1) : -1;
    const pb = cb ? (prezzoRealeStrategia(cb) ?? -1) : -1;
    if (pb !== pa) return pb - pa;
    return byValore(a, b);
  };
  const comparatore = strat ? byFasciaStrategia : byValore;
  let tutti = [...disp.sort(comparatore), ...(S.liberiNascondiEstratti ? [] : scar.sort(comparatore))];
  if (cercaTesto) tutti = tutti.filter(g => g.nome.toLowerCase().includes(cercaTesto));
  if (S.filtroRuolo !== 'tutti') tutti = tutti.filter(g => {
    const ruoli = (g.ruolo || '').split(/[\/,]/).map(function(x){ return x.trim().toLowerCase(); });
    return ruoli.includes(S.filtroRuolo.toLowerCase());
  });
  if (strat && S.liberiSoloPreferiti) tutti = tutti.filter(g => {
    const cfg = strat.configByListinoId.get(g.idFantaleghe);
    return cfg && cfg.preferito;
  });
  list.innerHTML = tutti.map(g => {
    const sc = g.scartato ? ' scartato' : '';
    const tipoLabel = g.tipo || 'NN';
    const tb = '<span class="l-tipo-badge tipo-' + tipoLabel + '">' + tipoLabel + '</span>';
    const u21Badge = g.u21 === true ? '<span class="l-tipo-badge tipo-U21">U21</span>' : '';
    const orig = g.squadraOriginale ? '<span class="l-orig">ex ' + _escHtml(g.squadraOriginale) + '</span>' : '';
    const club = g.squadra ? '<span class="l-orig">' + _escHtml(g.squadra) + '</span>' : '';
    const click = (!g.scartato && S.isAdmin) ? ' onclick="chiamaLibero(\'' + g.id + '\')"' : '';
    const haValore = g.valore !== undefined && g.valore !== null && g.valore !== 0;
    const valoreHTML = haValore
      ? '<div class="l-valore-wrap"><span class="l-valore">' + g.valore + '</span><span class="l-valore-label">Valore</span></div>'
      : '';
    const quotHTML = g.quotazione != null
      ? '<div class="l-valore-wrap"><span class="l-valore">' + g.quotazione + '</span><span class="l-valore-label">Quot.</span></div>'
      : '';
    const stratHTML = _getLiberiStrategiaBadgeHTML(g);
    return '<li class="' + sc + '"' + click + '>' + _getRuoloBadgeHTML(g.ruolo) +
      '<span class="l-nome">' + _escHtml(g.nome) + '</span>' + tb + u21Badge + club + orig + quotHTML + valoreHTML + stratHTML +
      (g.scartato ? '<span class="l-scartato-tag">Scartato</span>' : '') +
      '<span class="l-costo">' + g.costoOriginale + 'cr' + (g.scartato ? ' \u2717' : '') + '</span></li>';
  }).join('') || '<li class="text-muted" style="padding:8px">Nessun giocatore</li>';
}

function _getLiberiStrategiaBadgeHTML(g) {
  const strat = S.strategiaAsta;
  if (!strat) return '';
  const cfg = strat.configByListinoId.get(g.idFantaleghe);
  if (!cfg) return '';
  const titolaritaTxt = cfg.titolarita ? ('★'.repeat(cfg.titolarita)) : '';
  if (!cfg.fascia_id || !strat.fasceInfo.has(cfg.fascia_id)) {
    // Nessuna fascia assegnata: mostra comunque la titolarità, se impostata, senza il
    // badge fascia (che ha bisogno del colore/nome fascia per esistere).
    return titolaritaTxt ? '<span class="l-strategia-badge">' + titolaritaTxt + '</span>' : '';
  }
  const f = strat.fasceInfo.get(cfg.fascia_id);
  const preferitoStar = cfg.preferito ? ' ⭐' : '';
  const prezzoReale = prezzoRealeStrategia(cfg);
  const prezzoTxt = prezzoReale != null ? (' \u00b7 ' + prezzoReale + 'cr') : '';
  const titolaritaSuffix = titolaritaTxt ? (' ' + titolaritaTxt) : '';
  return '<span class="l-strategia-badge" style="border-color:' + f.colore + ';color:' + f.colore + '">' + escapeHTML(f.nome) + prezzoTxt + preferitoStar + titolaritaSuffix + '</span>';
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
      '<span class="slot-chip' + (rD===0?' esaurito':'') + '"><span class="slot-main">RIC <span>' + sq.slotsRICUsati + '/' + sq.slotsRIC + '</span></span><small class="slot-sub">(' + ricTot + ' da estrarre)</small></span>' +
      '<span class="slot-chip' + (pD===0?' esaurito':'') + '"><span class="slot-main">PLUS <span>' + sq.slotsPLUSUsati + '/' + sq.slotsPLUS + '</span></span><small class="slot-sub">(' + plusTot + ' da estrarre)</small></span>' +
      '<span class="slot-chip' + (((sq.recompra||0) - (sq.recompraUsati||0) <= 0)?' esaurito':'') + '"><span class="slot-main">Recompra <span>' + (sq.recompraUsati||0) + '/' + (sq.recompra!==undefined?sq.recompra:1) + '</span></span></span>' +
      '<span class="slot-chip"><span class="slot-main">Max <span class="text-accent">' + getMaxOfferta() + 'cr</span></span></span>';
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
  const btnCfg = document.getElementById('btn-admin-config');
  if (!S.isAdmin) { panel.classList.add('hidden'); if (btnCfg) btnCfg.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  if (btnCfg) btnCfg.classList.remove('hidden');
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
  forzaVisibilitaRilancioMobile();
}

function renderLobbySquadre(squadre) {
  const ul = document.getElementById('lobby-squadre');
  if (!ul) return;
  ul.innerHTML = squadre.map(s =>
    '<li><span class="sq-dot ' + (s.online?'online':'offline') + '">●</span><strong>' + _escHtml(s.nome) + '</strong>' +
    '<span class="text-muted" style="font-size:0.75rem">' + (s.online?'(online)':'(offline)') + ' | ' + s.crediti + 'cr</span></li>').join('');
}

function renderFineAsta() {
  const asta = S.asta; if (!asta) return;
  document.getElementById('riepilogo-asta').innerHTML = asta.squadre.map(sq =>
    '<div class="riepilogo-card"><h3><span>' + _escHtml(sq.nome) + '</span><span class="rc-crediti">💰 ' + sq.crediti + 'cr</span></h3>' +
    (asta.tipoAsta === 'iniziale' ? '<p class="rc-slot">RIC ' + sq.slotsRICUsati + '/' + sq.slotsRIC + ' | PLUS ' + sq.slotsPLUSUsati + '/' + sq.slotsPLUS + ' | Recompra: ' + ((sq.recompraUsati||0) + '/' + (sq.recompra!==undefined?sq.recompra:1)) + '</p>' : '') +
    '<table><thead><tr><th>Giocatore</th><th>Ruolo</th><th>Tipo</th><th>Prezzo</th></tr></thead><tbody>' +
    (sq.rosa.map(g => '<tr><td>' + _escHtml(g.nome) + '</td><td>' + (g.ruolo||'?') + '</td><td>' + (g.tipo||'NN') + '</td><td>' + g.prezzo + 'cr</td></tr>').join('') ||
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
      '<div class="sv-item-info"><div class="sv-item-nome">' + _escHtml(g.nome) + '</div>' +
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
  const hayValore = disp.some(g => g.valore);
  const ORDINE_RUOLI_LIB = ['Por','P','Dd','Dc','Ds','D','B','M','E','C','T','W','A','Pc'];
  disp = disp.sort((a, b) => {
    if (hayValore) return (b.valore || 0) - (a.valore || 0);
    const ra = ORDINE_RUOLI_LIB.indexOf((a.ruolo || '').split('/')[0].trim());
    const rb = ORDINE_RUOLI_LIB.indexOf((b.ruolo || '').split('/')[0].trim());
    if (ra !== rb) return (ra === -1 ? 999 : ra) - (rb === -1 ? 999 : rb);
    return (a.nome || '').localeCompare(b.nome || '');
  });
  lista.innerHTML = disp.slice(0, 80).map(g => {
    const orig = g.squadraOriginale ? ' · ex ' + _escHtml(g.squadraOriginale) : '';
    return '<div class="cm-item" onclick="chiamaDaModale(\'' + g.id + '\')">' +
      _getRuoloBadgeHTML(g.ruolo) +
      '<span class="cm-item-nome">' + _escHtml(g.nome) + '</span>' +
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
    sel.innerHTML = S.asta.squadre.map(sq => '<option value="' + _escAttr(sq.nome) + '">' + _escHtml(sq.nome) + ' (💰' + sq.crediti + ')</option>').join('');
  }
  document.getElementById('inp-am-prezzo').value = 1;
  renderAssegnaManualeLista();
  openModal('modal-assegna-manuale');
};
window.renderAssegnaManualeLista = function() {
  const lista = document.getElementById('am-lista');
  if (!lista || !S.asta) return;
  const testo = (document.getElementById('inp-am-search').value || '').toLowerCase().trim();
  let disp = (S.asta.poolGiocatori || []).filter(g => !g.assegnato && (!g.estratto || g.scartato));
  if (testo) disp = disp.filter(g => g.nome.toLowerCase().includes(testo));
  const hayValore = disp.some(g => g.valore);
  const ORDINE_RUOLI_LIB = ['Por','P','Dd','Dc','Ds','D','B','M','E','C','T','W','A','Pc'];
  disp = disp.sort((a, b) => {
    if (hayValore) return (b.valore || 0) - (a.valore || 0);
    const ra = ORDINE_RUOLI_LIB.indexOf((a.ruolo || '').split('/')[0].trim());
    const rb = ORDINE_RUOLI_LIB.indexOf((b.ruolo || '').split('/')[0].trim());
    if (ra !== rb) return (ra === -1 ? 999 : ra) - (rb === -1 ? 999 : rb);
    return (a.nome || '').localeCompare(b.nome || '');
  });
  lista.innerHTML = disp.slice(0, 80).map(g => {
    const sel = S.amSelezionato === g.id ? ' selected' : '';
    const orig = g.squadraOriginale ? ' · ex ' + _escHtml(g.squadraOriginale) : '';
    return '<div class="cm-item' + sel + '" onclick="selezionaGiocatoreAssegna(\'' + g.id + '\')">' +
      _getRuoloBadgeHTML(g.ruolo) +
      '<span class="cm-item-nome">' + _escHtml(g.nome) + '</span>' +
      '<span class="cm-item-info">' + (g.tipo && g.tipo !== 'NN' ? g.tipo + ' · ' : '') + (g.costoOriginale || 0) + 'cr' + orig + (g.scartato ? ' · ✗ scartato' : '') + '</span>' +
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

window.apriModalAdminConfig = function() {
  if (!S.asta || !S.isAdmin) return;
  document.getElementById('inp-ac-timer-prima').value = S.asta.timerPrimaChiamata;
  document.getElementById('inp-ac-timer-rilancio').value = S.asta.timerRilancio;
  document.getElementById('inp-ac-min-portieri').value = S.asta.minimoPortieri;
  document.getElementById('inp-ac-min-movimento').value = S.asta.minimoMovimento;
  document.getElementById('inp-ac-max-gioc').value = S.asta.maxGiocatoriPerSquadra || 25;
  const chkFx = document.getElementById('chk-ac-fx-assegnazione');
  if (chkFx) chkFx.checked = _antGetFxAbilitata();
  const lista = document.getElementById('ac-crediti-lista');
  lista.innerHTML = (S.asta.squadre || []).map(sq => {
    const nomeEsc = _escJsAttr(sq.nome);
    // Il campo mostra/modifica i crediti CONFIGURATI dalla lega per questa squadra
    // (non il saldo attuale, che scende con gli acquisti): si somma sempre alla base
    // importata fissa (creditiImportati, es. riporto stagione precedente) per dare il
    // budget totale reale. Se la squadra viene da un import con crediti gia' propri,
    // lo si vede accanto tra parentesi come promemoria.
    const configuratiVal = sq.creditiConfigurati != null ? sq.creditiConfigurati : sq.crediti;
    const importatiHint = sq.creditiImportati ? (' <span class="hint-text">(+' + sq.creditiImportati + ' importati = ' + (sq.creditiIniziali != null ? sq.creditiIniziali : sq.crediti) + ' tot.)</span>') : '';
    return '<div class="settings-team-card">' +
      '<div class="settings-team-nome">' + _escHtml(sq.nome) + '</div>' +
      '<div class="settings-team-fields">' +
        '<div class="settings-field"><label>Crediti configurati' + importatiHint + '</label>' +
        '<input type="number" min="0" value="' + configuratiVal + '" onblur="confermaAdminCrediti(\'' + nomeEsc + '\', this.value)"></div>' +
        '<div class="settings-field"><label>Slot RIC</label>' +
        '<input type="number" min="0" value="' + (sq.slotsRIC || 0) + '" onblur="confermaAdminSlot(\'' + nomeEsc + '\', this.value, null, null)"></div>' +
        '<div class="settings-field"><label>Slot PLUS</label>' +
        '<input type="number" min="0" value="' + (sq.slotsPLUS || 0) + '" onblur="confermaAdminSlot(\'' + nomeEsc + '\', null, this.value, null)"></div>' +
        '<div class="settings-field"><label>Recompra</label>' +
        '<input type="number" min="0" value="' + (sq.recompra !== undefined ? sq.recompra : 1) + '" onblur="confermaAdminSlot(\'' + nomeEsc + '\', null, null, this.value)"></div>' +
      '</div>' +
    '</div>';
  }).join('');
  openModal('modal-admin-config');
};

window.copiaLinkAdmin = function() {
  if (!S.astaId || !S.adminToken) return toast('Link Admin non disponibile in questa sessione', 'error');
  const link = window.location.origin + '/?id=' + S.astaId + '&admin=' + S.adminToken;
  navigator.clipboard.writeText(link).then(() => {
    toast('Link Admin copiato! Non condividerlo con i partecipanti.', 'success');
  }).catch(() => toast('Errore nella copia del link', 'error'));
};

window.confermaAdminConfig = function() {
  socket.emit('admin-update-config', {
    astaId: S.astaId,
    timerPrimaChiamata: parseInt(document.getElementById('inp-ac-timer-prima').value),
    timerRilancio: parseInt(document.getElementById('inp-ac-timer-rilancio').value),
    minimoPortieri: parseInt(document.getElementById('inp-ac-min-portieri').value),
    minimoMovimento: parseInt(document.getElementById('inp-ac-min-movimento').value),
    maxGiocatoriPerSquadra: parseInt(document.getElementById('inp-ac-max-gioc').value) || 25
  });
  // Solo locale (localStorage), non fa parte della config asta lato server: l'animazione
  // e' gia' un effetto puramente client-side, vedi _antGetFxAbilitata sopra.
  const chkFx = document.getElementById('chk-ac-fx-assegnazione');
  if (chkFx) _antSetFxAbilitata(chkFx.checked);
  toast('Impostazioni aggiornate', 'success');
};

window.confermaAdminCrediti = function(squadraNome, crediti) {
  socket.emit('admin-update-crediti', { astaId: S.astaId, squadraNome, crediti: parseInt(crediti) });
  toast('Crediti di ' + squadraNome + ' aggiornati', 'success');
};

window.confermaAdminSlot = function(squadraNome, slotsRIC, slotsPLUS, recompra) {
  const payload = { astaId: S.astaId, squadraNome };
  if (slotsRIC !== null) payload.slotsRIC = parseInt(slotsRIC);
  if (slotsPLUS !== null) payload.slotsPLUS = parseInt(slotsPLUS);
  if (recompra !== null) payload.recompra = parseInt(recompra);
  socket.emit('admin-update-slot', payload);
  toast('Slot di ' + squadraNome + ' aggiornati', 'success');
};

function renderMiaRosa(sq) {
  document.getElementById('mr-title').textContent = 'Rosa di ' + sq.nome;
  const lista = document.getElementById('mr-lista');
  if (!sq.rosa.length) { lista.innerHTML = '<p class="text-muted">Nessun giocatore</p>'; return; }
  const ORDINE_RUOLI = ['Por','P','Dd','Dc','Ds','D','B','M','E','C','T','W','A','Pc'];
  const _ruoloKey = (r) => (r || '').split('/')[0].trim();
  const rosaOrdinata = [...sq.rosa].sort((a, b) => {
    const ia = ORDINE_RUOLI.indexOf(_ruoloKey(a.ruolo));
    const ib = ORDINE_RUOLI.indexOf(_ruoloKey(b.ruolo));
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
  lista.innerHTML = rosaOrdinata.map(g => '<div class="mr-item">' +
    _getRuoloBadgeHTML(g.ruolo) + '<span class="mr-nome">' + _escHtml(g.nome) + '</span>' +
    (g.tipo && g.tipo !== 'NN' ? '<span class="mr-tipo tipo-' + g.tipo + '">' + g.tipo + '</span>' : '') +
    '<span class="mr-prezzo">' + g.prezzo + 'cr</span></div>').join('');
}

// ════ UTILS ═══════════════════════════════════
function getMiaSquadra() {
  if (!S.asta || !S.miaSquadra) return null;
  return S.asta.squadre.find(s => s.nome === S.miaSquadra) || null;
}

// Budget di riferimento STABILE della mia squadra (non scende con gli acquisti, a
// differenza di sq.crediti): creditiImportati (base fissa) + creditiConfigurati
// (modificabile dall'Admin). Usato per ricalcolare i prezzi percentuali di una
// Strategia sempre aggiornati al budget vero, anche se l'Admin lo corregge a meta' asta.
function budgetRealeSquadra() {
  const sq = getMiaSquadra();
  if (sq && sq.creditiIniziali != null) return sq.creditiIniziali;
  if (S.asta && S.asta.crediti) return S.asta.crediti;
  return (S.strategiaAsta && S.strategiaAsta.crediti_totali) || 0;
}

// Prezzo reale di un giocatore secondo la Strategia applicata, ricalcolato al volo sul
// budget corrente (vedi budgetRealeSquadra). Fallback al prezzo assoluto salvato solo
// se la riga non ha una percentuale (dato storico/legacy).
function prezzoRealeStrategia(cfg) {
  if (!cfg) return null;
  if (cfg.percentuale != null) {
    const budget = budgetRealeSquadra();
    return budget ? Math.max(1, Math.round(cfg.percentuale / 100 * budget)) : cfg.prezzo;
  }
  return cfg.prezzo;
}

// I minimi Portieri/Movimento sono due vincoli SEPARATI, non un totale unico (stessa
// motivazione e stessa formula di calcolaMaxOfferta() in backend/server.js — deve restare
// sincronizzata, e' solo un hint UI, la validazione autoritativa e' lato server). Il
// giocatore della chiamata attuale (se c'e') conta verso la SUA categoria; se non c'e' nessuna
// chiamata attiva si riservano comunque entrambi i minimi per intero (caso conservativo).
function calcolaMaxOffertaSquadra(sq) {
  if (!sq || !S.asta) return 0;
  const chiamata = S.asta.chiamataAttuale;
  const giocatore = chiamata ? chiamata.giocatore : null;
  const minimoPortieri = S.asta.minimoPortieri || 0;
  const minimoMovimento = S.asta.minimoMovimento || 0;
  const portieriAttuali = sq.rosa.filter(g => _isPortiere(g.ruolo)).length;
  const movimentoAttuali = sq.rosa.length - portieriAttuali;
  const ePortiere = giocatore ? _isPortiere(giocatore.ruolo) : null;
  const portieriDopo = portieriAttuali + (ePortiere === true ? 1 : 0);
  const movimentoDopo = movimentoAttuali + (ePortiere === false ? 1 : 0);
  const creditiRiservati = Math.max(0, minimoPortieri - portieriDopo) + Math.max(0, minimoMovimento - movimentoDopo);

  if (S.asta.tipoAsta === 'iniziale') {
    return Math.max(1, sq.crediti - creditiRiservati);
  }
  const fattore = S.asta.fattoreSvincolo || 0.5;
  const svinR = S.asta.svincoliTotali - (sq.svincoliUsati || 0);
  if (svinR <= 0) return sq.crediti;
  const sorted = [...sq.rosa].sort((a, b) => Math.floor(b.prezzo * fattore) - Math.floor(a.prezzo * fattore));
  let recup = 0;
  for (let i = 0; i < Math.min(svinR, sorted.length); i++) recup += Math.floor(sorted[i].prezzo * fattore);
  return Math.max(1, sq.crediti + recup - creditiRiservati);
}

function getMaxOfferta() {
  return calcolaMaxOffertaSquadra(getMiaSquadra());
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

// Escapa caratteri HTML pericolosi da qualsiasi stringa inserita via innerHTML
// (nomi squadra scelti liberamente dagli utenti, nomi giocatori dal listino, ecc.)
// per evitare XSS. Usare SEMPRE per dati non generati da noi prima di innerHTML.
function _escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function toast(msg, tipo) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast ' + (tipo || 'info');
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => { try { container.removeChild(el); } catch(e){} }, 3200);
}

// ══════════════════════════════════════════════════════════
// FASE 2 — STRATEGIE DI ASTA
// ══════════════════════════════════════════════════════════

const FASCIA_COLORI_DEFAULT = ['#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#0ea5e9'];

// ══ Import/Export formato FantaLab (tool esterno di preparazione asta) ══
// Ordine dei fogli nel file Excel FantaLab: uno per ruolo Mantra.
const FANTALAB_RUOLI_SHEET = ['Por', 'Dc', 'B', 'Ds', 'Dd', 'E', 'M', 'C', 'W', 'T', 'A', 'Pc'];
// Gerarchia delle fasce FantaLab osservata nel file di riferimento (dalla migliore alla
// peggiore): usata per ordinare le fasce create in import. "Non Impostata" non è una fascia
// vera, indica solo "nessuna fascia assegnata in questo ruolo" (vedi gestione multi-ruolo sotto).
const FANTALAB_FASCIA_ORDINE = [
  'SUPER TOP', 'TOP', 'SEMITOP', 'SOTTO AI SEMITOP', 'FASCIA ALTA', 'JOLLY 1ª FASCIA',
  'POSSIBILI SORPRESE', 'FASCIA MEDIA', 'INFORTUNATI', 'SCOMMESSE', 'SOPRA AI LOW COST',
  'JOLLY 2ª FASCIA', 'LOW COST 1ª FASCIA', 'LOW COST 2ª FASCIA', 'LEGHE NUMEROSE',
  'JOLLY 3ª FASCIA', 'JOLLY 4ª FASCIA', 'A RISCHIO', 'DA EVITARE', 'MERCATO'
];
// Mappa codice squadra (colonna "Team" di FantaLab) -> nome squadra_reale del Listino Ufficiale,
// derivata incrociando il file FantaLab di riferimento con il Listino attuale (match nome+ruolo).
const FANTALAB_TEAM_CODE_TO_SQUADRA = {
  ATA: 'Atalanta', BOL: 'Bologna', CAG: 'Cagliari', COM: 'Como', FIO: 'Fiorentina',
  FRO: 'Frosinone', GEN: 'Genoa', INT: 'Inter', JUV: 'Juventus', LAZ: 'Lazio',
  LEC: 'Lecce', MIL: 'Milan', MON: 'Monza', NAP: 'Napoli', PAR: 'Parma',
  ROM: 'Roma', SAS: 'Sassuolo', TOR: 'Torino', UDI: 'Udinese', VEN: 'Venezia'
};
const FANTALAB_SQUADRA_TO_TEAM_CODE = Object.fromEntries(
  Object.entries(FANTALAB_TEAM_CODE_TO_SQUADRA).map(([code, sq]) => [sq, code])
);
function _normNomeFantaLab(s) {
  return (s || '').toString().trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}
let _pendingImportFantaLabFile = null;

function setupMenu() {
  const btnStrategie = document.getElementById('btn-menu-strategie');
  const btnAsta = document.getElementById('btn-menu-asta');
  const btnLogoutMenu = document.getElementById('btn-logout-menu');
  if (btnStrategie) btnStrategie.addEventListener('click', () => { showScreen('screen-strategie-lista'); caricaStrategie(); });
  if (btnAsta) btnAsta.addEventListener('click', () => showScreen('screen-home'));
  if (btnLogoutMenu) btnLogoutMenu.addEventListener('click', async () => {
    await supa.auth.signOut();
    S.userRole = null; S.userId = null;
    _aggiornaUserEmailBadge(null);
    showScreen('screen-login');
  });
}

function setupStrategie() {
  const btnBackListaMenu = document.getElementById('btn-back-lista-menu');
  const btnNuovaStrategia = document.getElementById('btn-nuova-strategia');
  const btnBackFormLista = document.getElementById('btn-back-form-lista');
  const btnCreaStrategia = document.getElementById('btn-crea-strategia');
  const btnImportaStrategia = document.getElementById('btn-importa-strategia');
  const inpImportaStrategia = document.getElementById('inp-importa-strategia');
  const btnImportaStrategiaFantaLab = document.getElementById('btn-importa-strategia-fantalab');
  const inpImportaStrategiaFantaLab = document.getElementById('inp-importa-strategia-fantalab');

  if (btnBackListaMenu) btnBackListaMenu.addEventListener('click', tornaAllaHome);

  if (btnImportaStrategia && inpImportaStrategia) {
    btnImportaStrategia.addEventListener('click', () => inpImportaStrategia.click());
    inpImportaStrategia.addEventListener('change', () => {
      const file = inpImportaStrategia.files[0];
      inpImportaStrategia.value = '';
      if (file) importaStrategiaDaFile(file);
    });
  }

  if (btnImportaStrategiaFantaLab && inpImportaStrategiaFantaLab) {
    btnImportaStrategiaFantaLab.addEventListener('click', () => inpImportaStrategiaFantaLab.click());
    inpImportaStrategiaFantaLab.addEventListener('change', () => {
      const file = inpImportaStrategiaFantaLab.files[0];
      inpImportaStrategiaFantaLab.value = '';
      if (!file) return;
      _pendingImportFantaLabFile = file;
      document.getElementById('strategia-form-nome').value = file.name.replace(/\.(xlsx|xls)$/i, '');
      document.getElementById('strategia-form-crediti').value = '';
      document.getElementById('strategia-form-tipo').value = 'iniziale';
      document.getElementById('strategia-form-error').style.display = 'none';
      document.querySelector('#screen-strategia-form .home-title').textContent = 'Nuova strategia da FantaLab';
      showScreen('screen-strategia-form');
    });
  }

  if (btnNuovaStrategia) btnNuovaStrategia.addEventListener('click', () => {
    _pendingImportFantaLabFile = null;
    document.getElementById('strategia-form-nome').value = '';
    document.getElementById('strategia-form-crediti').value = '';
    document.getElementById('strategia-form-tipo').value = 'iniziale';
    document.getElementById('strategia-form-error').style.display = 'none';
    document.querySelector('#screen-strategia-form .home-title').textContent = 'Nuova strategia';
    showScreen('screen-strategia-form');
  });

  if (btnBackFormLista) btnBackFormLista.addEventListener('click', () => {
    _pendingImportFantaLabFile = null;
    showScreen('screen-strategie-lista');
  });

  if (btnCreaStrategia) btnCreaStrategia.addEventListener('click', async () => {
    const nome = document.getElementById('strategia-form-nome').value.trim();
    const crediti = parseInt(document.getElementById('strategia-form-crediti').value, 10);
    const tipo = document.getElementById('strategia-form-tipo').value;
    const errEl = document.getElementById('strategia-form-error');
    errEl.style.display = 'none';
    if (!nome) { errEl.textContent = 'Inserisci un nome per la strategia'; errEl.style.display = 'block'; return; }
    if (!crediti || crediti <= 0) { errEl.textContent = 'Inserisci un numero di crediti valido'; errEl.style.display = 'block'; return; }

    const { data: strategia, error } = await supa.from('strategie').insert({
      user_id: S.userId, nome, crediti_totali: crediti, tipo_asta: tipo
    }).select().single();
    if (error) { errEl.textContent = 'Errore: ' + error.message; errEl.style.display = 'block'; return; }

    if (_pendingImportFantaLabFile) {
      const file = _pendingImportFantaLabFile;
      _pendingImportFantaLabFile = null;
      try {
        const esito = await _importaGiocatoriFantaLabInStrategia(file, strategia);
        toast('Strategia importata da FantaLab: ' + esito.importati + ' giocatori (' + esito.scartati + ' non trovati nel Listino)', 'success');
      } catch (err) {
        toast('Errore nell\'importazione da FantaLab: ' + (err.message || err), 'error');
      }
    } else {
      const fasceDefault = ['Fascia 1', 'Fascia 2', 'Fascia 3', 'Fascia 4', 'Fascia 5'].map((n, i) => ({
        strategia_id: strategia.id, nome: n, colore: FASCIA_COLORI_DEFAULT[i], ordine: i
      }));
      await supa.from('fasce').insert(fasceDefault);
    }

    await apriEditorStrategia(strategia.id);
  });
}

async function caricaStrategie() {
  const container = document.getElementById('lista-strategie');
  container.innerHTML = '<p class="hint-text">Caricamento...</p>';
  const { data, error } = await supa.from('strategie').select('*').order('created_at', { ascending: false });
  if (error) { container.innerHTML = '<p class="hint-text">Errore nel caricamento delle strategie</p>'; return; }
  if (!data || !data.length) { container.innerHTML = '<p class="hint-text">Nessuna strategia creata. Premi "+ Nuova strategia" per iniziare.</p>'; return; }

  const tipoLabel = { iniziale: 'Asta iniziale', riparazione1: 'Riparazione 1', riparazione2: 'Riparazione 2' };
  container.innerHTML = data.map(s => (
    '<div class="strategia-row" data-id="' + s.id + '">' +
      '<div class="strategia-row-info">' +
        '<div class="strategia-row-nome">' + escapeHTML(s.nome) + '</div>' +
        '<div class="strategia-row-meta">' + (tipoLabel[s.tipo_asta] || s.tipo_asta) + ' · ' + s.crediti_totali + ' crediti</div>' +
      '</div>' +
      '<button type="button" class="btn btn-secondary btn-small strategia-apri-btn" data-id="' + s.id + '">Apri</button>' +
    '</div>'
  )).join('');

  container.querySelectorAll('.strategia-apri-btn').forEach(btn => {
    btn.addEventListener('click', () => apriEditorStrategia(btn.dataset.id));
  });
}

function escapeHTML(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}

// ══ EDITOR STRATEGIA ══════════════════════════════════════

async function caricaListinoCache() {
  if (S.listinoCache) return S.listinoCache;
  const { data, error } = await supa.from('listino_giocatori').select('*').order('nome');
  S.listinoCache = (!error && data) ? data : [];
  return S.listinoCache;
}

async function apriEditorStrategia(strategiaId) {
  const { data: strategia, error } = await supa.from('strategie').select('*').eq('id', strategiaId).single();
  if (error || !strategia) { toast('Errore nel caricamento della strategia', 'error'); return; }
  S.strategiaAttuale = strategia;

  const { data: fasce } = await supa.from('fasce').select('*').eq('strategia_id', strategiaId).order('ordine');
  S.fasceAttuali = (fasce || []).map(f => ({ id: f.id, nome: f.nome, colore: f.colore, ordine: f.ordine }));

  const { data: sg } = await supa.from('strategia_giocatori').select('*').eq('strategia_id', strategiaId);
  S.configGiocatori = new Map();
  (sg || []).forEach(row => {
    S.configGiocatori.set(row.giocatore_id, {
      fascia_id: row.fascia_id, prezzo: row.prezzo, percentuale: row.percentuale, preferito: row.preferito,
      titolarita: row.titolarita, commento: row.commento
    });
  });

  await caricaListinoCache();

  S.editorFiltroRuolo = 'tutti';
  S.editorCercaText = '';
  S.editorSortCampo = 'prezzo';
  S.editorSortDir = 'desc';
  S.editorSelezionati.clear();
  // Reset di entrambe le copie (in cima alla pagina e sopra "Non assegnati"): sono
  // sincronizzate tra loro, vedi wireEditorFiltriTop() in setupEditor().
  document.querySelectorAll('.editor-cerca-input').forEach(i => { i.value = ''; });
  document.querySelectorAll('.editor-filtro-ruolo-group .filtro-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.ruolo === 'tutti');
  });
  document.querySelectorAll('.editor-ordina-campo-select').forEach(s => { s.value = 'prezzo'; });
  document.querySelectorAll('.editor-ordina-dir-btn').forEach(b => { b.dataset.dir = 'desc'; b.textContent = '↓ Decrescente'; });

  const tipoLabel = { iniziale: 'Asta iniziale', riparazione1: 'Riparazione 1', riparazione2: 'Riparazione 2' };
  document.getElementById('editor-strategia-nome').textContent = strategia.nome;
  document.getElementById('editor-strategia-info').textContent =
    (tipoLabel[strategia.tipo_asta] || strategia.tipo_asta) + ' · ' + strategia.crediti_totali + ' crediti';

  renderEditorFasce();
  showScreen('screen-strategia-editor');
}

function sincronizzaPrezzoPercentuale(giocatoreId, campo, valore) {
  const crediti = S.strategiaAttuale ? S.strategiaAttuale.crediti_totali : 0;
  let cfg = S.configGiocatori.get(giocatoreId);
  if (!cfg) { cfg = { fascia_id: null, prezzo: null, percentuale: null, preferito: false, titolarita: null, commento: null }; S.configGiocatori.set(giocatoreId, cfg); }

  if (campo === 'prezzo') {
    const prezzo = valore === '' ? null : Math.max(0, Math.round(Number(valore)));
    cfg.prezzo = prezzo;
    cfg.percentuale = (prezzo != null && crediti > 0) ? Math.round((prezzo / crediti) * 1000) / 10 : null;
  } else {
    const pct = valore === '' ? null : Math.max(0, Number(valore));
    cfg.percentuale = pct;
    cfg.prezzo = (pct != null && crediti > 0) ? Math.round((pct / 100) * crediti) : null;
  }

  const pInput = document.querySelector('.giocatore-prezzo[data-giocatore="' + giocatoreId + '"]');
  const qInput = document.querySelector('.giocatore-percentuale[data-giocatore="' + giocatoreId + '"]');
  if (pInput && campo !== 'prezzo') pInput.value = cfg.prezzo != null ? cfg.prezzo : '';
  if (qInput && campo !== 'percentuale') qInput.value = cfg.percentuale != null ? cfg.percentuale : '';
}

function renderEditorFasce() {
  const container = document.getElementById('editor-fasce-container');
  const nonAssegnatiContainer = document.getElementById('editor-non-assegnati-container');
  const listino = S.listinoCache || [];
  const cerca = (S.editorCercaText || '').trim().toLowerCase();
  const ruoloFiltro = S.editorFiltroRuolo || 'tutti';

  // Cerca/filtro ruolo si applicano a TUTTI i giocatori, sia nelle Fasce che nei Non
  // assegnati: un giocatore che non soddisfa il filtro selezionato sparisce ovunque,
  // cosi' cercare/filtrare mostra sempre solo i giocatori pertinenti indipendentemente
  // da dove si trovano.
  const passaFiltro = (g) => {
    if (cerca && !g.nome.toLowerCase().includes(cerca)) return false;
    if (ruoloFiltro !== 'tutti') {
      const ruoli = (g.ruolo || '').split('/').map(r => r.trim());
      if (!ruoli.includes(ruoloFiltro)) return false;
    }
    return true;
  };

  const fasceOrdinate = S.fasceAttuali.slice().sort((a, b) => a.ordine - b.ordine);
  const gruppi = fasceOrdinate.map(f => ({ fascia: f, giocatori: [] }));
  const nonAssegnati = { fascia: null, giocatori: [] };
  const fasceIds = new Set(fasceOrdinate.map(f => f.id));

  listino.forEach(g => {
    if (!passaFiltro(g)) return;
    const cfg = S.configGiocatori.get(g.id);
    const fasciaId = cfg ? cfg.fascia_id : null;
    if (fasciaId && fasceIds.has(fasciaId)) {
      gruppi.find(gr => gr.fascia.id === fasciaId).giocatori.push(g);
    } else {
      nonAssegnati.giocatori.push(g);
    }
  });

  // Ordinamento scelto dall'utente (Prezzo/FVM1000/QUOT, crescente o decrescente),
  // applicato uniformemente a tutti i gruppi (Fasce comprese).
  const sortCampo = S.editorSortCampo || 'prezzo';
  const sortDir = S.editorSortDir === 'asc' ? 1 : -1; // asc: crescente, desc (default): decrescente
  const valoreOrdinamento = (g) => {
    if (sortCampo === 'fvm1000') return g.fvm1000;
    if (sortCampo === 'quotazione') return g.quotazione;
    return (S.configGiocatori.get(g.id) || {}).prezzo;
  };
  const cmp = (a, b) => {
    const va = valoreOrdinamento(a), vb = valoreOrdinamento(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;   // i valori mancanti vanno sempre in fondo
    if (vb == null) return -1;
    return (va - vb) * sortDir;
  };
  gruppi.forEach(gr => gr.giocatori.sort(cmp));
  nonAssegnati.giocatori.sort(cmp);

  const opzioniFascia = fasceOrdinate.map(f => '<option value="' + f.id + '">' + escapeHTML(f.nome) + '</option>').join('')
    + '<option value="">Non assegnati</option>';

  const renderRigaGiocatore = (g) => {
    const cfg = S.configGiocatori.get(g.id) || { fascia_id: null, prezzo: null, percentuale: null, preferito: false, titolarita: null, commento: null };
    const selezionato = S.editorSelezionati.has(g.id);
    const u21Badge = g.u21 === true ? '<span class="cc-tipo-badge tipo-U21">U21</span>' : '';
    const titolaritaLabel = cfg.titolarita ? ('⭐' + cfg.titolarita) : '☆';
    const haCommento = !!(cfg.commento && cfg.commento.trim());
    return (
      '<div class="editor-player-row' + (selezionato ? ' selezionato' : '') + '" data-giocatore="' + g.id + '">' +
        '<input type="checkbox" class="editor-player-check" data-giocatore="' + g.id + '"' + (selezionato ? ' checked' : '') + '>' +
        '<img class="editor-player-avatar" data-photo-nome="' + _escAttr(g.nome) + '" data-photo-squadra="' + _escAttr(g.squadra_reale || '') + '" src="img/players/unknown_anime.jpg" alt="">' +
        _getRuoloBadgeHTML(g.ruolo) +
        '<span class="editor-player-nome" title="' + _escAttr(g.nome) + '">' + escapeHTML(g.nome) + '</span>' +
        '<span class="editor-player-squadra" title="' + _escAttr(g.squadra_reale || '') + '">' + escapeHTML(g.squadra_reale || '') + '</span>' +
        '<span class="editor-player-fvm">FVM ' + (g.fvm1000 != null ? g.fvm1000 : '-') + '</span>' +
        '<span class="editor-player-quot">Q ' + (g.quotazione != null ? g.quotazione : '-') + '</span>' +
        '<input type="number" class="giocatore-prezzo" data-giocatore="' + g.id + '" placeholder="Prezzo" min="0" value="' + (cfg.prezzo != null ? cfg.prezzo : '') + '">' +
        '<input type="number" class="giocatore-percentuale" data-giocatore="' + g.id + '" placeholder="%" min="0" step="0.1" value="' + (cfg.percentuale != null ? cfg.percentuale : '') + '">' +
        '<button type="button" class="editor-preferito-btn ' + (cfg.preferito ? 'active' : '') + '" data-giocatore="' + g.id + '">' + (cfg.preferito ? '★' : '☆') + '</button>' +
        '<button type="button" class="editor-titolarita-btn' + (cfg.titolarita ? ' active' : '') + '" data-giocatore="' + g.id + '" title="Titolarità">' + titolaritaLabel + '</button>' +
        '<button type="button" class="editor-commento-btn' + (haCommento ? ' active' : '') + '" data-giocatore="' + g.id + '" title="' + (haCommento ? _escAttr(cfg.commento) : 'Aggiungi commento') + '">💬</button>' +
        u21Badge +
        '<select class="editor-fascia-select" data-giocatore="' + g.id + '">' + opzioniFascia.replace(
          'value="' + (cfg.fascia_id || '') + '"', 'value="' + (cfg.fascia_id || '') + '" selected'
        ) + '</select>' +
      '</div>'
    );
  };

  const renderGruppo = (fascia, giocatori) => {
    const colore = fascia ? fascia.colore : '#666';
    const nome = fascia ? fascia.nome : 'Non assegnati';
    const idAttr = fascia ? fascia.id : 'non-assegnati';
    const azioniFascia = fascia ? (
      '<input type="text" class="fascia-nome-input" data-fascia="' + fascia.id + '" value="' + escapeHTML(fascia.nome) + '">' +
      '<input type="color" class="fascia-colore-input" data-fascia="' + fascia.id + '" value="' + fascia.colore + '">' +
      '<button type="button" class="fascia-up-btn" data-fascia="' + fascia.id + '" title="Sposta su">↑</button>' +
      '<button type="button" class="fascia-down-btn" data-fascia="' + fascia.id + '" title="Sposta giù">↓</button>' +
      '<button type="button" class="fascia-del-btn" data-fascia="' + fascia.id + '" title="Elimina fascia">🗑️</button>'
    ) : '<span class="fascia-nome-fissa">' + nome + '</span>';

    return (
      '<div class="fascia-section" data-fascia-section="' + idAttr + '">' +
        '<div class="fascia-header" style="border-left:4px solid ' + colore + '">' + azioniFascia +
          '<span class="fascia-count">' + giocatori.length + '</span>' +
        '</div>' +
        '<div class="fascia-players">' + (giocatori.length ? giocatori.map(renderRigaGiocatore).join('') : '<p class="hint-text">Nessun giocatore</p>') + '</div>' +
      '</div>'
    );
  };

  container.innerHTML = gruppi.map(gr => renderGruppo(gr.fascia, gr.giocatori)).join('');
  if (nonAssegnatiContainer) nonAssegnatiContainer.innerHTML = renderGruppo(null, nonAssegnati.giocatori);

  wireEditorEventiRiga(container);
  _loadEditorAvatars(container);
  if (nonAssegnatiContainer) {
    wireEditorEventiRiga(nonAssegnatiContainer);
    _loadEditorAvatars(nonAssegnatiContainer);
  }
  aggiornaBulkBar();
}

function _loadEditorAvatars(container) {
  container.querySelectorAll('.editor-player-avatar[data-photo-nome]').forEach(img => {
    const nome = img.getAttribute('data-photo-nome');
    const squadra = img.getAttribute('data-photo-squadra');
    _withTimeout(_tryLocalPhoto(nome, squadra), 4000, null).then(function(url) {
      const finalUrl = url || 'img/players/unknown_anime.jpg';
      const test = new Image();
      test.onload = function() { img.src = finalUrl; };
      test.onerror = function() { img.src = 'img/players/unknown_anime.jpg'; };
      test.src = finalUrl;
    }).catch(function() { img.src = 'img/players/unknown_anime.jpg'; });
  });
}

function wireEditorEventiRiga(container) {
  container.querySelectorAll('.editor-player-check').forEach(chk => {
    chk.addEventListener('change', () => {
      const gid = Number(chk.dataset.giocatore);
      if (chk.checked) S.editorSelezionati.add(gid); else S.editorSelezionati.delete(gid);
      const row = chk.closest('.editor-player-row');
      if (row) row.classList.toggle('selezionato', chk.checked);
      aggiornaBulkBar();
    });
  });

  container.querySelectorAll('.editor-preferito-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const gid = Number(btn.dataset.giocatore);
      let cfg = S.configGiocatori.get(gid);
      if (!cfg) { cfg = { fascia_id: null, prezzo: null, percentuale: null, preferito: false, titolarita: null, commento: null }; S.configGiocatori.set(gid, cfg); }
      cfg.preferito = !cfg.preferito;
      btn.classList.toggle('active', cfg.preferito);
      btn.textContent = cfg.preferito ? '★' : '☆';
    });
  });

  container.querySelectorAll('.editor-titolarita-btn').forEach(btn => {
    btn.addEventListener('click', () => apriModalTitolarita(Number(btn.dataset.giocatore)));
  });

  container.querySelectorAll('.editor-commento-btn').forEach(btn => {
    btn.addEventListener('click', () => apriModalCommento(Number(btn.dataset.giocatore)));
  });

  container.querySelectorAll('.editor-fascia-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const gid = Number(sel.dataset.giocatore);
      let cfg = S.configGiocatori.get(gid);
      if (!cfg) { cfg = { fascia_id: null, prezzo: null, percentuale: null, preferito: false, titolarita: null, commento: null }; S.configGiocatori.set(gid, cfg); }
      cfg.fascia_id = sel.value || null;
      renderEditorFasce();
    });
  });

  container.querySelectorAll('.giocatore-prezzo').forEach(inp => {
    inp.addEventListener('input', () => sincronizzaPrezzoPercentuale(Number(inp.dataset.giocatore), 'prezzo', inp.value));
  });
  container.querySelectorAll('.giocatore-percentuale').forEach(inp => {
    inp.addEventListener('input', () => sincronizzaPrezzoPercentuale(Number(inp.dataset.giocatore), 'percentuale', inp.value));
  });

  container.querySelectorAll('.fascia-nome-input').forEach(inp => {
    inp.addEventListener('input', () => {
      const f = S.fasceAttuali.find(x => String(x.id) === inp.dataset.fascia);
      if (f) f.nome = inp.value;
    });
  });
  container.querySelectorAll('.fascia-colore-input').forEach(inp => {
    inp.addEventListener('input', () => {
      const f = S.fasceAttuali.find(x => String(x.id) === inp.dataset.fascia);
      if (f) { f.colore = inp.value; renderEditorFasce(); }
    });
  });
  container.querySelectorAll('.fascia-up-btn').forEach(btn => {
    btn.addEventListener('click', () => spostaFascia(btn.dataset.fascia, -1));
  });
  container.querySelectorAll('.fascia-down-btn').forEach(btn => {
    btn.addEventListener('click', () => spostaFascia(btn.dataset.fascia, 1));
  });
  container.querySelectorAll('.fascia-del-btn').forEach(btn => {
    btn.addEventListener('click', () => eliminaFasciaLocale(btn.dataset.fascia));
  });
}

// ── Titolarità (1-5 stelle) e Commento libero per giocatore — dati personali della
// Strategia dell'utente (stesso pattern/tabella di preferito/prezzo/percentuale), editabili
// solo qui nell'editor; in Asta vengono mostrati in sola lettura (vedi
// _getChiamataStrategiaInfoHTML e _getLiberiStrategiaBadgeHTML). ──
let _modalGiocatoreId = null;

function _nomeGiocatorePerId(gid) {
  const g = (S.listinoCache || []).find(x => x.id === gid);
  return g ? g.nome : ('#' + gid);
}

function _aggiornaRigaTitolarita(gid, valore) {
  document.querySelectorAll('.editor-titolarita-btn[data-giocatore="' + gid + '"]').forEach(btn => {
    btn.classList.toggle('active', !!valore);
    btn.textContent = valore ? ('⭐' + valore) : '☆';
  });
}

function renderTitolaritaStars(valore) {
  const wrap = document.getElementById('mt-stars');
  wrap.innerHTML = [1, 2, 3, 4, 5].map(n =>
    '<button type="button" class="titolarita-star-btn' + (n <= valore ? ' active' : '') + '" data-n="' + n + '">' + (n <= valore ? '★' : '☆') + '</button>'
  ).join('');
  wrap.querySelectorAll('.titolarita-star-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const n = Number(btn.dataset.n);
      let cfg = S.configGiocatori.get(_modalGiocatoreId);
      if (!cfg) { cfg = { fascia_id: null, prezzo: null, percentuale: null, preferito: false, titolarita: null, commento: null }; S.configGiocatori.set(_modalGiocatoreId, cfg); }
      cfg.titolarita = n;
      renderTitolaritaStars(n);
      _aggiornaRigaTitolarita(_modalGiocatoreId, n);
    });
  });
}

function apriModalTitolarita(gid) {
  _modalGiocatoreId = gid;
  const cfg = S.configGiocatori.get(gid) || {};
  document.getElementById('mt-nome-giocatore').textContent = _nomeGiocatorePerId(gid);
  renderTitolaritaStars(cfg.titolarita || 0);
  openModal('modal-titolarita');
}

window.rimuoviTitolarita = function() {
  if (_modalGiocatoreId == null) return;
  const cfg = S.configGiocatori.get(_modalGiocatoreId);
  if (cfg) cfg.titolarita = null;
  renderTitolaritaStars(0);
  _aggiornaRigaTitolarita(_modalGiocatoreId, 0);
};

function apriModalCommento(gid) {
  _modalGiocatoreId = gid;
  const cfg = S.configGiocatori.get(gid) || {};
  document.getElementById('mc-nome-giocatore').textContent = _nomeGiocatorePerId(gid);
  document.getElementById('mc-testo').value = cfg.commento || '';
  openModal('modal-commento');
}

window.salvaCommentoModal = function() {
  if (_modalGiocatoreId == null) return;
  const testo = document.getElementById('mc-testo').value.trim();
  let cfg = S.configGiocatori.get(_modalGiocatoreId);
  if (!cfg) { cfg = { fascia_id: null, prezzo: null, percentuale: null, preferito: false, titolarita: null, commento: null }; S.configGiocatori.set(_modalGiocatoreId, cfg); }
  cfg.commento = testo || null;
  document.querySelectorAll('.editor-commento-btn[data-giocatore="' + _modalGiocatoreId + '"]').forEach(btn => {
    btn.classList.toggle('active', !!cfg.commento);
    btn.title = cfg.commento || 'Aggiungi commento';
  });
  closeModal();
};

// ── Azioni in blocco sui giocatori selezionati (checkbox su ogni riga, sia nelle
//    Fasce che nei Non assegnati) — pensate per essere veloci: seleziona N giocatori
//    (anche cercandoli per nome) e spostali tutti in una fascia o dai loro tutti lo
//    stesso prezzo/percentuale in un colpo solo, invece di riga per riga. ──
const BULK_FASCIA_NON_MODIFICARE = '__non_modificare__';
const BULK_FASCIA_NON_ASSEGNATI = '__non_assegnati__';

function aggiornaBulkBar() {
  const bar = document.getElementById('editor-bulk-bar');
  const countEl = document.getElementById('editor-bulk-count');
  const fasciaSel = document.getElementById('editor-bulk-fascia');
  const chipsEl = document.getElementById('editor-bulk-chips');
  if (!bar || !countEl || !fasciaSel || !chipsEl) return;
  const n = S.editorSelezionati.size;
  bar.classList.toggle('hidden', n === 0);
  if (n === 0) return;
  countEl.textContent = n + (n === 1 ? ' selezionato' : ' selezionati');

  const fasceOrdinate = (S.fasceAttuali || []).slice().sort((a, b) => a.ordine - b.ordine);
  const valorePrecedente = fasciaSel.value;
  fasciaSel.innerHTML = '<option value="' + BULK_FASCIA_NON_MODIFICARE + '">— Non modificare fascia —</option>'
    + fasceOrdinate.map(f => '<option value="' + f.id + '">' + escapeHTML(f.nome) + '</option>').join('')
    + '<option value="' + BULK_FASCIA_NON_ASSEGNATI + '">Non assegnati</option>';
  if (valorePrecedente && [...fasciaSel.options].some(o => o.value === valorePrecedente)) fasciaSel.value = valorePrecedente;

  // Lista dei giocatori selezionati (per nome, con la X per togliere singolarmente
  // una selezione sbagliata senza dover deselezionare tutto e ricominciare).
  const listino = S.listinoCache || [];
  const nomiPerId = new Map(listino.map(g => [g.id, g.nome]));
  chipsEl.innerHTML = [...S.editorSelezionati].map(gid =>
    '<span class="editor-bulk-chip">' + escapeHTML(nomiPerId.get(gid) || ('#' + gid)) +
      '<button type="button" class="editor-bulk-chip-rm" data-giocatore="' + gid + '" title="Togli dalla selezione">×</button>' +
    '</span>'
  ).join('');
  chipsEl.querySelectorAll('.editor-bulk-chip-rm').forEach(btn => {
    btn.addEventListener('click', () => {
      S.editorSelezionati.delete(Number(btn.dataset.giocatore));
      const row = document.querySelector('.editor-player-check[data-giocatore="' + btn.dataset.giocatore + '"]');
      if (row) { row.checked = false; const r = row.closest('.editor-player-row'); if (r) r.classList.remove('selezionato'); }
      aggiornaBulkBar();
    });
  });
}

// Un solo bottone applica insieme fascia (se scelta) e prezzo/percentuale (se
// compilato) a tutti i selezionati, invece di due azioni separate — meno click.
function applicaBulkAzione() {
  const fasciaSel = document.getElementById('editor-bulk-fascia');
  const campoSel = document.getElementById('editor-bulk-campo');
  const valoreInp = document.getElementById('editor-bulk-valore');
  if (!fasciaSel || !campoSel || !valoreInp || !S.editorSelezionati.size) return;

  const cambiaFascia = fasciaSel.value !== BULK_FASCIA_NON_MODIFICARE;
  const cambiaValore = valoreInp.value !== '';
  if (!cambiaFascia && !cambiaValore) {
    return toast('Scegli una fascia e/o inserisci un valore da applicare', 'error');
  }

  const fasciaId = fasciaSel.value === BULK_FASCIA_NON_ASSEGNATI ? null : fasciaSel.value;
  const campo = campoSel.value;
  S.editorSelezionati.forEach(gid => {
    if (cambiaFascia) {
      let cfg = S.configGiocatori.get(gid);
      if (!cfg) { cfg = { fascia_id: null, prezzo: null, percentuale: null, preferito: false, titolarita: null, commento: null }; S.configGiocatori.set(gid, cfg); }
      cfg.fascia_id = fasciaId;
    }
    if (cambiaValore) sincronizzaPrezzoPercentuale(gid, campo, valoreInp.value);
  });

  const n = S.editorSelezionati.size;
  S.editorSelezionati.clear();
  fasciaSel.value = BULK_FASCIA_NON_MODIFICARE;
  valoreInp.value = '';
  renderEditorFasce();
  toast('Modifiche applicate a ' + n + ' giocatori', 'success');
}

function bulkSelezionaTuttiRisultati() {
  const container = document.getElementById('editor-non-assegnati-container');
  if (!container) return;
  container.querySelectorAll('.editor-player-check').forEach(chk => {
    S.editorSelezionati.add(Number(chk.dataset.giocatore));
  });
  renderEditorFasce();
}

function bulkDeselezionaTutti() {
  S.editorSelezionati.clear();
  renderEditorFasce();
}

function spostaFascia(fasciaId, direzione) {
  const ordinate = S.fasceAttuali.slice().sort((a, b) => a.ordine - b.ordine);
  const idx = ordinate.findIndex(f => String(f.id) === String(fasciaId));
  const altro = idx + direzione;
  if (idx < 0 || altro < 0 || altro >= ordinate.length) return;
  const tmp = ordinate[idx].ordine;
  ordinate[idx].ordine = ordinate[altro].ordine;
  ordinate[altro].ordine = tmp;
  renderEditorFasce();
}

function eliminaFasciaLocale(fasciaId) {
  if (!confirm('Eliminare questa fascia? I giocatori assegnati passeranno a "Non assegnati".')) return;
  S.fasceAttuali = S.fasceAttuali.filter(f => String(f.id) !== String(fasciaId));
  S.configGiocatori.forEach(cfg => { if (String(cfg.fascia_id) === String(fasciaId)) cfg.fascia_id = null; });
  renderEditorFasce();
}

function setupEditor() {
  const btnBack = document.getElementById('btn-back-editor-lista');
  const btnAggiungiFascia = document.getElementById('btn-aggiungi-fascia');
  const btnSalva = document.getElementById('btn-salva-strategia');
  const btnEsporta = document.getElementById('btn-esporta-strategia');
  const btnEsportaFantaLab = document.getElementById('btn-esporta-strategia-fantalab');
  const btnElimina = document.getElementById('btn-elimina-strategia');

  if (btnBack) btnBack.addEventListener('click', () => showScreen('screen-strategie-lista'));

  if (btnAggiungiFascia) btnAggiungiFascia.addEventListener('click', () => {
    const maxOrdine = S.fasceAttuali.reduce((m, f) => Math.max(m, f.ordine), -1);
    S.fasceAttuali.push({
      id: 'new-' + Date.now(),
      nome: 'Fascia ' + (S.fasceAttuali.length + 1),
      colore: FASCIA_COLORI_DEFAULT[S.fasceAttuali.length % FASCIA_COLORI_DEFAULT.length],
      ordine: maxOrdine + 1
    });
    renderEditorFasce();
  });

  // Ricerca/filtro ruolo/ordinamento esistono in due copie identiche nella pagina (in
  // cima e sopra "Non assegnati", vedi index.html): ogni handler aggiorna lo stato
  // condiviso in S e poi rispecchia il nuovo valore su TUTTE le copie, cosi' restano
  // sempre sincronizzate indipendentemente da quale l'utente ha usato.
  document.querySelectorAll('.editor-cerca-input').forEach(inp => {
    inp.addEventListener('input', () => {
      S.editorCercaText = inp.value;
      document.querySelectorAll('.editor-cerca-input').forEach(i => { if (i !== inp) i.value = inp.value; });
      renderEditorFasce();
    });
  });

  document.querySelectorAll('.editor-filtro-ruolo-group .filtro-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const ruolo = btn.dataset.ruolo;
      document.querySelectorAll('.editor-filtro-ruolo-group .filtro-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.ruolo === ruolo);
      });
      S.editorFiltroRuolo = ruolo;
      renderEditorFasce();
    });
  });

  document.querySelectorAll('.editor-ordina-campo-select').forEach(sel => {
    sel.addEventListener('change', () => {
      S.editorSortCampo = sel.value;
      document.querySelectorAll('.editor-ordina-campo-select').forEach(s => { s.value = sel.value; });
      renderEditorFasce();
    });
  });
  document.querySelectorAll('.editor-ordina-dir-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const nuovaDir = S.editorSortDir === 'asc' ? 'desc' : 'asc';
      S.editorSortDir = nuovaDir;
      document.querySelectorAll('.editor-ordina-dir-btn').forEach(b => {
        b.dataset.dir = nuovaDir;
        b.textContent = nuovaDir === 'asc' ? '↑ Crescente' : '↓ Decrescente';
      });
      renderEditorFasce();
    });
  });

  const btnSelezionaTutti = document.getElementById('editor-seleziona-tutti-risultati');
  if (btnSelezionaTutti) btnSelezionaTutti.addEventListener('click', bulkSelezionaTuttiRisultati);
  const btnBulkApplica = document.getElementById('editor-bulk-applica');
  if (btnBulkApplica) btnBulkApplica.addEventListener('click', applicaBulkAzione);
  const btnBulkDeseleziona = document.getElementById('editor-bulk-deseleziona');
  if (btnBulkDeseleziona) btnBulkDeseleziona.addEventListener('click', bulkDeselezionaTutti);

  if (btnSalva) btnSalva.addEventListener('click', salvaStrategia);
  if (btnEsporta) btnEsporta.addEventListener('click', esportaStrategia);
  if (btnEsportaFantaLab) btnEsportaFantaLab.addEventListener('click', esportaStrategiaFantaLab);
  if (btnElimina) btnElimina.addEventListener('click', eliminaStrategia);
}

async function salvaStrategia() {
  const statusEl = document.getElementById('editor-save-status');
  const strategia = S.strategiaAttuale;
  if (!strategia) return;
  statusEl.style.display = 'block';
  statusEl.textContent = 'Salvataggio in corso...';

  try {
    await supa.from('strategie').update({
      nome: strategia.nome, crediti_totali: strategia.crediti_totali, tipo_asta: strategia.tipo_asta
    }).eq('id', strategia.id);

    const { data: fasceEsistenti } = await supa.from('fasce').select('id').eq('strategia_id', strategia.id);
    const idEsistenti = new Set((fasceEsistenti || []).map(f => f.id));
    const idAttuali = new Set(S.fasceAttuali.filter(f => typeof f.id === 'string' && !f.id.startsWith('new-')).map(f => f.id));
    const idDaEliminare = [...idEsistenti].filter(id => !idAttuali.has(id));
    if (idDaEliminare.length) await supa.from('fasce').delete().in('id', idDaEliminare);

    for (const f of S.fasceAttuali) {
      if (typeof f.id === 'string' && f.id.startsWith('new-')) {
        const { data: nuova, error } = await supa.from('fasce').insert({
          strategia_id: strategia.id, nome: f.nome, colore: f.colore, ordine: f.ordine
        }).select().single();
        if (error) throw error;
        const vecchioId = f.id;
        f.id = nuova.id;
        S.configGiocatori.forEach(cfg => { if (cfg.fascia_id === vecchioId) cfg.fascia_id = nuova.id; });
      } else {
        await supa.from('fasce').update({ nome: f.nome, colore: f.colore, ordine: f.ordine }).eq('id', f.id);
      }
    }

    await supa.from('strategia_giocatori').delete().eq('strategia_id', strategia.id);
    const righe = [];
    S.configGiocatori.forEach((cfg, giocatoreId) => {
      const haValore = cfg.fascia_id || cfg.prezzo != null || cfg.percentuale != null || cfg.preferito
        || cfg.titolarita != null || (cfg.commento && cfg.commento.trim());
      if (haValore) {
        righe.push({
          strategia_id: strategia.id, giocatore_id: giocatoreId,
          fascia_id: cfg.fascia_id || null, prezzo: cfg.prezzo, percentuale: cfg.percentuale,
          preferito: !!cfg.preferito, titolarita: cfg.titolarita || null, commento: cfg.commento || null
        });
      }
    });
    if (righe.length) await supa.from('strategia_giocatori').insert(righe);

    statusEl.textContent = '✅ Strategia salvata';
    toast('Strategia salvata correttamente', 'success');
    renderEditorFasce();
  } catch (err) {
    statusEl.textContent = '❌ Errore nel salvataggio: ' + (err.message || err);
    toast('Errore nel salvataggio della strategia', 'error');
  }
  setTimeout(() => { statusEl.style.display = 'none'; }, 3500);
}

async function eliminaStrategia() {
  const strategia = S.strategiaAttuale;
  if (!strategia) return;
  if (!confirm('Eliminare definitivamente la strategia "' + strategia.nome + '"?')) return;
  const { error } = await supa.from('strategie').delete().eq('id', strategia.id);
  if (error) { toast('Errore nella cancellazione', 'error'); return; }
  toast('Strategia eliminata', 'success');
  showScreen('screen-strategie-lista');
  caricaStrategie();
}

// ══ ESPORTA / IMPORTA STRATEGIA (JSON, per ricostruirla su un'altra installazione) ══
// L'export usa lo stato in memoria (S.fasceAttuali/S.configGiocatori), lo stesso che
// userebbe "Salva strategia" — non serve aver salvato prima. Le fasce vengono
// riferite per INDICE (non per id Supabase, specifico di questa installazione) cosi'
// l'import puo' ricrearle e riassociare i giocatori corretti in un database diverso.
function esportaStrategia() {
  const strategia = S.strategiaAttuale;
  if (!strategia) return;
  const fasceOrdinate = S.fasceAttuali.slice().sort((a, b) => a.ordine - b.ordine);
  const indiceFascia = new Map(fasceOrdinate.map((f, i) => [f.id, i]));
  const listinoPerId = new Map((S.listinoCache || []).map(g => [g.id, g]));

  const giocatori = [];
  S.configGiocatori.forEach((cfg, giocatoreId) => {
    const haValore = cfg.fascia_id || cfg.prezzo != null || cfg.percentuale != null || cfg.preferito
      || cfg.titolarita != null || (cfg.commento && cfg.commento.trim());
    if (!haValore) return;
    const g = listinoPerId.get(giocatoreId);
    giocatori.push({
      giocatore_id: giocatoreId,
      nome: g ? g.nome : null, // solo per leggibilita' del file, non usato in fase di import
      fascia_index: (cfg.fascia_id != null && indiceFascia.has(cfg.fascia_id)) ? indiceFascia.get(cfg.fascia_id) : null,
      prezzo: cfg.prezzo, percentuale: cfg.percentuale, preferito: !!cfg.preferito,
      titolarita: cfg.titolarita || null, commento: cfg.commento || null
    });
  });

  const data = {
    formato: 'strategia-fantasbocchini', versione: 1, timestamp: new Date().toISOString(),
    strategia: { nome: strategia.nome, tipo_asta: strategia.tipo_asta, crediti_totali: strategia.crediti_totali },
    fasce: fasceOrdinate.map(f => ({ nome: f.nome, colore: f.colore })),
    giocatori
  };
  const nomeFile = strategia.nome.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'strategia';
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  _triggerBlobDownload(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'strategia-' + nomeFile + '-' + ts + '.json');
  toast('Strategia esportata', 'success');
}

// Crea una NUOVA strategia dal JSON esportato — non tocca mai strategie esistenti.
// I giocatori il cui giocatore_id non esiste piu' nel Listino Ufficiale attuale
// vengono semplicemente ignorati (listino aggiornato/diverso da un'altra lega).
async function importaStrategiaDaFile(file) {
  const statusEl = document.getElementById('importa-strategia-status');
  const mostraStato = (msg, isError) => {
    if (!statusEl) return;
    statusEl.style.display = 'block';
    statusEl.textContent = msg;
    statusEl.style.color = isError ? 'var(--danger,#ff4d4d)' : '';
  };

  const reader = new FileReader();
  reader.onload = async (e) => {
    let data;
    try { data = JSON.parse(e.target.result); } catch (err) { mostraStato('❌ File non valido', true); return; }
    if (!data || !data.strategia || !Array.isArray(data.fasce)) { mostraStato('❌ File non valido: formato strategia non riconosciuto', true); return; }

    mostraStato('Importazione in corso...');
    try {
      const { data: strategia, error: errStrategia } = await supa.from('strategie').insert({
        user_id: S.userId, nome: data.strategia.nome, crediti_totali: data.strategia.crediti_totali, tipo_asta: data.strategia.tipo_asta
      }).select().single();
      if (errStrategia) throw errStrategia;

      const fasceInsert = data.fasce.map((f, i) => ({
        strategia_id: strategia.id, nome: f.nome, colore: f.colore, ordine: i
      }));
      let fasceCreate = [];
      if (fasceInsert.length) {
        const { data: fc, error: errFasce } = await supa.from('fasce').insert(fasceInsert).select();
        if (errFasce) throw errFasce;
        fasceCreate = fc;
      }
      // L'indice nell'array esportato deve corrispondere alla fascia con lo stesso
      // "ordine" appena assegnato (0, 1, 2, ...), non all'ordine di ritorno di Supabase.
      const fasceOrdinate = fasceCreate.slice().sort((a, b) => a.ordine - b.ordine);

      await caricaListinoCache();
      const listinoIds = new Set((S.listinoCache || []).map(g => g.id));

      const righe = [];
      (data.giocatori || []).forEach(gi => {
        if (gi.giocatore_id == null || !listinoIds.has(gi.giocatore_id)) return;
        const fascia = (gi.fascia_index != null) ? fasceOrdinate[gi.fascia_index] : null;
        righe.push({
          strategia_id: strategia.id, giocatore_id: gi.giocatore_id,
          fascia_id: fascia ? fascia.id : null, prezzo: gi.prezzo, percentuale: gi.percentuale,
          preferito: !!gi.preferito, titolarita: gi.titolarita || null, commento: gi.commento || null
        });
      });
      if (righe.length) await supa.from('strategia_giocatori').insert(righe);

      mostraStato('✅ Strategia importata');
      toast('Strategia importata correttamente', 'success');
      await apriEditorStrategia(strategia.id);
    } catch (err) {
      mostraStato('❌ Errore nell\'importazione: ' + (err.message || err), true);
      toast('Errore nell\'importazione della strategia', 'error');
    }
  };
  reader.readAsText(file);
}

// ══ IMPORT/EXPORT STRATEGIA — formato FantaLab (tool esterno) ══
// FantaLab esporta un file Excel con un foglio per ruolo Mantra (vedi FANTALAB_RUOLI_SHEET).
// Nome+Ruolo bastano per matchare in modo affidabile contro il Listino Ufficiale (verificato
// sul file di riferimento: nessuna riga orfana), quindi non serve fuzzy matching sul nome.
// Un giocatore multi-ruolo appare su più fogli: FantaLab assegna la fascia vera solo al PRIMO
// ruolo del giocatore, "Non Impostata" agli altri — in import non replichiamo quella distinzione
// (non abbiamo un concetto di "ruolo primario" per la fascia), quindi prendiamo semplicemente la
// prima fascia reale trovata tra tutti i fogli in cui compare, indipendentemente dal foglio.
async function _importaGiocatoriFantaLabInStrategia(file, strategia) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  await caricaListinoCache();
  const listino = S.listinoCache || [];
  const byNomeRuolo = new Map();
  listino.forEach(g => {
    (g.ruolo || '').split('/').forEach(r => {
      byNomeRuolo.set(_normNomeFantaLab(g.nome) + '|' + r, g);
    });
  });

  const norm = s => (s || '').toString().trim().toLowerCase();
  const merged = new Map(); // giocatore_id -> { fascia, prezzo, titolarita, commento }
  let scartati = 0;

  FANTALAB_RUOLI_SHEET.forEach(ruolo => {
    const sheet = wb.Sheets[ruolo];
    if (!sheet) return;
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const findCol = (...names) => headers.find(h => names.some(n => norm(h) === norm(n)));
    const colNome = findCol('Nome');
    const colFascia = findCol('Fascia');
    const colPrezzo = findCol('Prezzo');
    const colTitolarita = findCol('Titolarità', 'Titolarita');
    const colCommento = findCol('Commento');
    if (!colNome) return;

    rows.forEach(r => {
      const nome = r[colNome];
      if (!nome) return;
      const g = byNomeRuolo.get(_normNomeFantaLab(nome) + '|' + ruolo);
      if (!g) { scartati++; return; }

      const fasciaGrezza = colFascia ? String(r[colFascia] || '').trim() : '';
      const fasciaReale = (fasciaGrezza && fasciaGrezza !== 'Non Impostata') ? fasciaGrezza : null;
      const prezzoVal = colPrezzo && r[colPrezzo] !== '' ? Number(r[colPrezzo]) : null;
      const titolaritaVal = colTitolarita && r[colTitolarita] !== '' ? Math.max(1, Math.min(5, Number(r[colTitolarita]))) : null;
      const commentoVal = colCommento && String(r[colCommento]).trim() ? String(r[colCommento]).trim() : null;

      const existing = merged.get(g.id);
      if (!existing) {
        merged.set(g.id, { fascia: fasciaReale, prezzo: prezzoVal, titolarita: titolaritaVal, commento: commentoVal });
      } else if (!existing.fascia && fasciaReale) {
        existing.fascia = fasciaReale;
      }
    });
  });

  // Crea le fasce nell'ordine gerarchico noto di FantaLab; fasce non riconosciute (nomi
  // personalizzati dall'utente in FantaLab) vengono aggiunte in coda, in ordine di comparsa.
  const fasceUsate = new Set();
  merged.forEach(v => { if (v.fascia) fasceUsate.add(v.fascia); });
  const fasceOrdinate = FANTALAB_FASCIA_ORDINE.filter(f => fasceUsate.has(f));
  fasceUsate.forEach(f => { if (!fasceOrdinate.includes(f)) fasceOrdinate.push(f); });

  let fasceCreate = [];
  if (fasceOrdinate.length) {
    const fasceInsert = fasceOrdinate.map((nome, i) => ({
      strategia_id: strategia.id, nome, colore: FASCIA_COLORI_DEFAULT[i % FASCIA_COLORI_DEFAULT.length], ordine: i
    }));
    const { data: fc, error } = await supa.from('fasce').insert(fasceInsert).select();
    if (error) throw error;
    fasceCreate = fc;
  }
  const fasciaIdByNome = new Map(fasceCreate.map(f => [f.nome, f.id]));

  const righe = [];
  merged.forEach((v, giocatoreId) => {
    righe.push({
      strategia_id: strategia.id, giocatore_id: giocatoreId,
      fascia_id: v.fascia ? (fasciaIdByNome.get(v.fascia) || null) : null,
      prezzo: v.prezzo, percentuale: null, preferito: false,
      titolarita: v.titolarita, commento: v.commento
    });
  });
  if (righe.length) {
    const { error } = await supa.from('strategia_giocatori').insert(righe);
    if (error) throw error;
  }

  return { importati: righe.length, scartati };
}

// Esporta la strategia corrente (S.strategiaAttuale/S.fasceAttuali/S.configGiocatori, lo stesso
// stato che userebbe "Salva strategia") in un file Excel nel formato FantaLab, cosi' puo' essere
// re-importato in quello strumento. Un giocatore multi-ruolo compare su ogni foglio di ruolo che
// gli compete (stesso comportamento del file FantaLab originale): la fascia viene scritta solo
// sul foglio del suo PRIMO ruolo (l'ordine in cui compare in listino_giocatori.ruolo), sugli
// altri fogli risulta "Non Impostata" — replica esattamente quanto osservato nel file di
// riferimento (es. Di Lorenzo Dd/E: fascia reale solo su Dd, "Non Impostata" su E).
function esportaStrategiaFantaLab() {
  const strategia = S.strategiaAttuale;
  if (!strategia) return;
  const fasciaNomeById = new Map((S.fasceAttuali || []).map(f => [f.id, f.nome]));
  const listinoPerId = new Map((S.listinoCache || []).map(g => [g.id, g]));

  const righePerRuolo = new Map(FANTALAB_RUOLI_SHEET.map(r => [r, []]));
  S.configGiocatori.forEach((cfg, giocatoreId) => {
    const haValore = cfg.fascia_id || cfg.prezzo != null || cfg.percentuale != null || cfg.preferito
      || cfg.titolarita != null || (cfg.commento && cfg.commento.trim());
    if (!haValore) return;
    const g = listinoPerId.get(giocatoreId);
    if (!g) return;

    const ruoli = (g.ruolo || '').split('/').filter(r => righePerRuolo.has(r));
    if (!ruoli.length) return;
    const fasciaReale = cfg.fascia_id ? (fasciaNomeById.get(cfg.fascia_id) || null) : null;
    const teamCode = FANTALAB_SQUADRA_TO_TEAM_CODE[g.squadra_reale] || '';
    const ruoloColonna = ruoli.join(', ');

    ruoli.forEach((ruolo, i) => {
      righePerRuolo.get(ruolo).push({
        'Obiett.': '', 'Fascia': (i === 0 && fasciaReale) ? fasciaReale : 'Non Impostata',
        'Ruolo': ruoloColonna, 'Team': teamCode, 'Nome': g.nome,
        'Prezzo': cfg.prezzo != null ? cfg.prezzo : '', 'PMA': '',
        'Quo': g.quotazione != null ? g.quotazione : '',
        'Titolarità': cfg.titolarita != null ? cfg.titolarita : '',
        'Affidabilità': '', 'Integrità': '', 'Commento': cfg.commento || '',
        'Nota 1': '', 'Nota 2': '', 'Nota 3': '', 'Nota 4': '', 'Nota 5': '',
        'MV': g.mv != null ? g.mv : '', 'FMV': g.fm != null ? g.fm : ''
      });
    });
  });

  const wb = XLSX.utils.book_new();
  FANTALAB_RUOLI_SHEET.forEach(ruolo => {
    const righe = righePerRuolo.get(ruolo).sort((a, b) => (Number(b.Prezzo) || 0) - (Number(a.Prezzo) || 0));
    const ws = XLSX.utils.json_to_sheet(righe, {
      header: ['Obiett.', 'Fascia', 'Ruolo', 'Team', 'Nome', 'Prezzo', 'PMA', 'Quo', 'Titolarità',
        'Affidabilità', 'Integrità', 'Commento', 'Nota 1', 'Nota 2', 'Nota 3', 'Nota 4', 'Nota 5', 'MV', 'FMV']
    });
    XLSX.utils.book_append_sheet(wb, ws, ruolo);
  });

  const nomeFile = strategia.nome.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'strategia';
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  XLSX.writeFile(wb, 'strategia-' + nomeFile + '-fantalab-' + ts + '.xlsx');
  toast('Strategia esportata in formato FantaLab', 'success');
}

// ══════════════════════════════════════════════════════════
// FASE 3 — INTEGRAZIONE STRATEGIE NEL FLUSSO DELL'ASTA
// ══════════════════════════════════════════════════════════

async function caricaStrategieCompatibili(tipoAsta) {
  const { data, error } = await supa.from('strategie').select('*').eq('tipo_asta', tipoAsta).order('created_at', { ascending: false });
  return (!error && data) ? data : [];
}

// Le strategie salvano tipo_asta come 'iniziale' | 'riparazione1' | 'riparazione2', mentre
// l'asta ha 'iniziale' | 'riparazione' + sottoTipoRiparazione separato — bisogna ricomporli
// per far combaciare il confronto, altrimenti nessuna strategia di riparazione risulta mai compatibile.
function _tipoAstaPerStrategia(asta) {
  if (asta.tipoAsta === 'riparazione') return 'riparazione' + (String(asta.sottoTipoRiparazione) === '2' ? '2' : '1');
  return asta.tipoAsta;
}

function _strategiaSalvataKey(astaId) { return 'ftb_strategia_sel_' + astaId; }
function _getStrategiaSalvata(astaId) {
  try { return localStorage.getItem(_strategiaSalvataKey(astaId)) || null; } catch(e) { return null; }
}
function _salvaStrategiaSelezionata(astaId, strategiaId) {
  try { localStorage.setItem(_strategiaSalvataKey(astaId), strategiaId); } catch(e) {}
}
function _rimuoviStrategiaSalvata(astaId) {
  try { localStorage.removeItem(_strategiaSalvataKey(astaId)); } catch(e) {}
}

async function mostraPromptStrategiaSeNecessario() {
  if (!S.asta || !S.astaId || !S.userId) return;
  if (S._promptStrategiaAstaId === S.astaId) return;
  S._promptStrategiaAstaId = S.astaId;
  // Se l'utente aveva già applicato una strategia in questa asta in una sessione precedente
  // (salvata in localStorage), la ripristiniamo automaticamente e silenziosamente, invece di
  // perderla ad ogni refresh/riconnessione (bug: badge fascia che spariva dopo un reload).
  const strategiaSalvataId = _getStrategiaSalvata(S.astaId);
  if (strategiaSalvataId && !S.strategiaAsta) {
    const ok = await selezionaStrategiaAsta(strategiaSalvataId, true);
    if (ok) return;
  }
  const strategie = await caricaStrategieCompatibili(_tipoAstaPerStrategia(S.asta));
  if (!strategie.length) return;
  apriModalStrategia(strategie);
}

function apriModalStrategia(strategie) {
  const lista = document.getElementById('strategia-modal-lista');
  const tipoLabel = { iniziale: 'Asta iniziale', riparazione1: 'Riparazione 1', riparazione2: 'Riparazione 2' };
  let html = strategie.map(s => (
    '<button type="button" class="strategia-modal-item" data-id="' + s.id + '">' +
      '<span class="strategia-modal-item-nome">' + escapeHTML(s.nome) + '</span>' +
      '<span class="strategia-modal-item-meta">' + (tipoLabel[s.tipo_asta] || s.tipo_asta) + ' · ' + s.crediti_totali + ' crediti</span>' +
    '</button>'
  )).join('');
  if (S.strategiaAsta) {
    html = '<button type="button" class="strategia-modal-item strategia-modal-item-rimuovi" data-id="">❌ Nessuna (rimuovi strategia attiva)</button>' + html;
  }
  lista.innerHTML = html;
  lista.querySelectorAll('.strategia-modal-item').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.id) selezionaStrategiaAsta(btn.dataset.id);
      else rimuoviStrategiaAsta();
    });
  });
  openModal('modal-strategia');
}

async function selezionaStrategiaAsta(strategiaId, silent) {
  const { data: strategia, error } = await supa.from('strategie').select('*').eq('id', strategiaId).single();
  if (error || !strategia) { if (!silent) toast('Errore nel caricamento della strategia', 'error'); return false; }

  const { data: fasce } = await supa.from('fasce').select('*').eq('strategia_id', strategiaId).order('ordine');
  const { data: sg } = await supa.from('strategia_giocatori').select('*').eq('strategia_id', strategiaId);

  const fasceInfo = new Map();
  const fasceOrdine = new Map();
  (fasce || []).forEach(f => { fasceInfo.set(f.id, { nome: f.nome, colore: f.colore, ordine: f.ordine }); fasceOrdine.set(f.id, f.ordine); });

  // Il prezzo NON si ricalcola qui una volta sola: si tiene solo la percentuale, e il
  // prezzo reale si calcola al volo ad ogni render (vedi prezzoRealeStrategia()) usando
  // il budget corrente della squadra. Così, se l'Admin corregge i crediti di una squadra
  // a meta' asta, i prezzi mostrati si aggiornano da soli al prossimo "stato-asta",
  // senza dover riapplicare la strategia.
  const configByListinoId = new Map();
  (sg || []).forEach(row => {
    configByListinoId.set(row.giocatore_id, {
      fascia_id: row.fascia_id, prezzo: row.prezzo, percentuale: row.percentuale, preferito: row.preferito,
      titolarita: row.titolarita, commento: row.commento
    });
  });

  S.strategiaAsta = { id: strategia.id, nome: strategia.nome, crediti_totali: strategia.crediti_totali, fasceInfo, fasceOrdine, configByListinoId };
  if (S.astaId) _salvaStrategiaSelezionata(S.astaId, strategia.id);

  const btnApplica = document.getElementById('btn-applica-strategia');
  if (btnApplica) { btnApplica.textContent = '📊 ' + strategia.nome + ' ▾'; btnApplica.classList.add('liberi-strategia-attiva-btn'); }

  if (!silent) {
    closeModal();
    toast('Strategia "' + strategia.nome + '" applicata', 'success');
  }
  if (S.asta) {
    renderGiocatoriLiberi(S.asta.poolGiocatori);
    if (S.asta.chiamataAttuale) renderChiamata(S.asta.chiamataAttuale);
  }
  return true;
}

function rimuoviStrategiaAsta() {
  S.strategiaAsta = null;
  if (S.astaId) _rimuoviStrategiaSalvata(S.astaId);
  const btnApplica = document.getElementById('btn-applica-strategia');
  if (btnApplica) { btnApplica.textContent = '📊 Applica strategia'; btnApplica.classList.remove('liberi-strategia-attiva-btn'); }
  closeModal();
  toast('Strategia rimossa', 'info');
  if (S.asta) {
    renderGiocatoriLiberi(S.asta.poolGiocatori);
    if (S.asta.chiamataAttuale) renderChiamata(S.asta.chiamataAttuale);
  }
}

function setupStrategiaAsta() {
  const btnApplica = document.getElementById('btn-applica-strategia');
  const toggleNascondi = document.getElementById('toggle-nascondi-estratti');
  const toggleSoloPreferiti = document.getElementById('toggle-solo-preferiti');

  if (btnApplica) btnApplica.addEventListener('click', async () => {
    if (!S.asta) return;
    const strategie = await caricaStrategieCompatibili(_tipoAstaPerStrategia(S.asta));
    if (!strategie.length && !S.strategiaAsta) { toast('Non hai strategie compatibili con questo tipo di asta', 'info'); return; }
    apriModalStrategia(strategie);
  });

  if (toggleNascondi) toggleNascondi.addEventListener('click', () => {
    S.liberiNascondiEstratti = !S.liberiNascondiEstratti;
    toggleNascondi.classList.toggle('active', S.liberiNascondiEstratti);
    if (S.asta) renderGiocatoriLiberi(S.asta.poolGiocatori);
  });

  if (toggleSoloPreferiti) toggleSoloPreferiti.addEventListener('click', () => {
    S.liberiSoloPreferiti = !S.liberiSoloPreferiti;
    toggleSoloPreferiti.classList.toggle('active', S.liberiSoloPreferiti);
    if (S.asta) renderGiocatoriLiberi(S.asta.poolGiocatori);
  });
}

// ══════════════════════════════════════════════════════════════
// EDITOR VISUALE DI STILE (Fase 1) — attivabile con ?editor=CHIAVE
// ══════════════════════════════════════════════════════════════
(function () {
  const params = new URLSearchParams(window.location.search);
  const editorKey = params.get('editor');
  const modoEditorDisponibile = !!editorKey;

  let editorAttivo = false;
  let elementoSelezionato = null;
  let overlayHover = null;
  let styleSheetOverride = null; // <style> dinamico con le regole salvate
  let overridesCorrenti = {};    // { 'selettore css': { proprieta: valore, ... }, ... }
  const historyUndo = [];

  function selettoreDi(el) {
    // Genera un selettore stabile basato su classi (ignora id generati runtime se possibile)
    if (el.id && !/^\d/.test(el.id)) return '#' + el.id;
    if (el.className) {
      const classi = el.className.split(' ').filter(c => c && !c.startsWith('hidden')).slice(0, 2);
      if (classi.length) return '.' + classi.join('.');
    }
    return el.tagName.toLowerCase();
  }

  function creaStylesheetOverride() {
    styleSheetOverride = document.createElement('style');
    styleSheetOverride.id = 'editor-overrides-style';
    document.head.appendChild(styleSheetOverride);
  }

  // Le proprietà che iniziano con "_" sono pseudo-proprietà interne che vengono combinate
  // in un\'unica regola CSS "transform" — così spostare/ruotare/scalare un elemento con
  // 3 slider indipendenti non sovrascrive gli altri (transform accetta solo 1 valore).
  function costruisciTransformCss(props) {
    const parti = [];
    if (props['_translateX'] || props['_translateY']) {
      parti.push(`translate(${props['_translateX'] || '0px'}, ${props['_translateY'] || '0px'})`);
    }
    if (props['_rotate']) parti.push(`rotate(${props['_rotate']})`);
    if (props['_scale']) parti.push(`scale(${props['_scale']})`);
    return parti.length ? parti.join(' ') : null;
  }

  function applicaOverridesAlDOM() {
    if (!styleSheetOverride) creaStylesheetOverride();
    let css = '';
    Object.keys(overridesCorrenti).forEach(sel => {
      const props = overridesCorrenti[sel];
      const transformCss = costruisciTransformCss(props);
      const propsCss = Object.keys(props)
        .filter(p => !p.startsWith('_'))
        .map(p => `${p}:${props[p]} !important;`).join('');
      const transformDecl = transformCss ? `transform:${transformCss} !important;` : '';
      css += `${sel}{${propsCss}${transformDecl}}\n`;
    });
    styleSheetOverride.textContent = css;
  }

  async function caricaOverridesSalvati() {
    try {
      const r = await fetch('/api/theme');
      const j = await r.json();
      overridesCorrenti = j.styles || {};
      applicaOverridesAlDOM();
    } catch (e) { console.warn('Editor: impossibile caricare theme', e); }
  }

  async function salvaOverrides() {
    try {
      const r = await fetch('/api/theme?editorKey=' + encodeURIComponent(editorKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ styles: overridesCorrenti, editorKey })
      });
      const j = await r.json();
      if (j.success) mostraToast('✅ Stile salvato per tutti gli utenti');
      else mostraToast('❌ Errore: ' + (j.error || 'salvataggio falito'));
    } catch (e) { mostraToast('❌ Errore di rete nel salvataggio'); }
  }

  function mostraToast(msg) {
    if (typeof window.toast === 'function') { window.toast(msg); return; }
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#222;color:#fff;padding:10px 18px;border-radius:8px;z-index:99999;font-size:.85rem';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  function rendiTrascinabile(panel, maniglia) {
    let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
    maniglia.style.cursor = 'grab';
    maniglia.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return; // non avviare drag se si clicca un bottone della maniglia
      dragging = true;
      const r = panel.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY; startLeft = r.left; startTop = r.top;
      panel.style.right = 'auto'; panel.style.left = startLeft + 'px'; panel.style.top = startTop + 'px';
      maniglia.style.cursor = 'grabbing';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      let nx = startLeft + dx, ny = startTop + dy;
      nx = Math.max(0, Math.min(window.innerWidth - 60, nx));
      ny = Math.max(0, Math.min(window.innerHeight - 40, ny));
      panel.style.left = nx + 'px';
      panel.style.top = ny + 'px';
    });
    document.addEventListener('mouseup', () => { dragging = false; maniglia.style.cursor = 'grab'; });
  }

  function creaPannelloControlli() {
    const panel = document.createElement('div');
    panel.id = 'editor-panel-controlli';
    panel.style.cssText = `
      position:fixed;top:60px;right:12px;width:270px;max-height:min(70vh, calc(100vh - 140px));
      display:flex;flex-direction:column;
      background:#1c1c2e;border:2px solid #ffb300;border-radius:12px;
      z-index:100000;font-family:sans-serif;color:#eee;box-shadow:0 8px 30px rgba(0,0,0,.5);
      display:none;`;
    panel.innerHTML = `
      <div id="editor-panel-maniglia" style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid #333;flex-shrink:0">
        <strong style="font-size:.9rem">✥ 🎨 Elemento selezionato</strong>
        <div style="display:flex;gap:6px">
          <button id="editor-minimizza-pannello" style="background:none;border:none;color:#fff;font-size:1rem;cursor:pointer">➖</button>
          <button id="editor-chiudi-pannello" style="background:none;border:none;color:#fff;font-size:1.1rem;cursor:pointer">✕</button>
        </div>
      </div>
      <div id="editor-panel-corpo" style="padding:14px;overflow-y:auto;flex:1;min-height:0">
        <div id="editor-selettore-label" style="font-size:.7rem;color:#aaa;margin-bottom:10px;word-break:break-all"></div>
        <div id="editor-controlli-lista" style="display:flex;flex-direction:column;gap:8px;font-size:.78rem"></div>
        <div style="margin-top:12px;display:flex;gap:6px">
          <button id="editor-btn-annulla-elemento" style="flex:1;padding:6px;background:#444;border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:.75rem">↩ Reset elemento</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    rendiTrascinabile(panel, document.getElementById('editor-panel-maniglia'));
    let minimizzato = false;
    document.getElementById('editor-minimizza-pannello').onclick = () => {
      minimizzato = !minimizzato;
      document.getElementById('editor-panel-corpo').style.display = minimizzato ? 'none' : 'block';
      document.getElementById('editor-minimizza-pannello').textContent = minimizzato ? '⬆' : '➖';
    };
    document.getElementById('editor-chiudi-pannello').onclick = () => deselezionaElemento();
    document.getElementById('editor-btn-annulla-elemento').onclick = () => {
      if (!elementoSelezionato) return;
      const sel = selettoreDi(elementoSelezionato);
      delete overridesCorrenti[sel];
      applicaOverridesAlDOM();
      renderControlliPer(elementoSelezionato);
    };
    return panel;
  }

  // Controlli organizzati in categorie pieghevoli. I prop che iniziano con "_" sono
  // pseudo-proprietà combinate in transform (vedi costruisciTransformCss).
  const CATEGORIE_CONTROLLI = [
    { titolo: '↕️ Sposta (senza rompere il layout)', apertoDiDefault: true, controlli: [
      { label: 'Sposta orizzontale (px)', prop: '_translateX', tipo: 'slider', min: -200, max: 200, unit: 'px', step: 1 },
      { label: 'Sposta verticale (px)', prop: '_translateY', tipo: 'slider', min: -200, max: 200, unit: 'px', step: 1 },
      { label: 'Ruota (gradi)', prop: '_rotate', tipo: 'slider', min: -180, max: 180, unit: 'deg', step: 1 },
      { label: 'Scala (zoom)', prop: '_scale', tipo: 'slider', min: 0.3, max: 2, unit: '', step: 0.05 },
    ]},
    { titolo: '📐 Dimensioni', apertoDiDefault: true, controlli: [
      { label: 'Larghezza (px)', prop: 'width', tipo: 'slider', min: 0, max: 800, unit: 'px', step: 1 },
      { label: 'Altezza (px)', prop: 'height', tipo: 'slider', min: 0, max: 600, unit: 'px', step: 1 },
      { label: 'Larghezza minima (px)', prop: 'min-width', tipo: 'slider', min: 0, max: 400, unit: 'px', step: 1 },
    ]},
    { titolo: '📦 Spaziatura', apertoDiDefault: false, controlli: [
      { label: 'Padding interno (px)', prop: 'padding', tipo: 'slider', min: 0, max: 80, unit: 'px', step: 1 },
      { label: 'Margine esterno (px)', prop: 'margin', tipo: 'slider', min: 0, max: 80, unit: 'px', step: 1 },
      { label: 'Spazio tra elementi (gap, px)', prop: 'gap', tipo: 'slider', min: 0, max: 60, unit: 'px', step: 1 },
    ]},
    { titolo: '🎨 Colori', apertoDiDefault: false, controlli: [
      { label: 'Colore sfondo', prop: 'background-color', tipo: 'color' },
      { label: 'Colore testo', prop: 'color', tipo: 'color' },
      { label: 'Colore bordo', prop: 'border-color', tipo: 'color' },
    ]},
    { titolo: '🔤 Tipografia', apertoDiDefault: false, controlli: [
      { label: 'Dimensione testo (px)', prop: 'font-size', tipo: 'slider', min: 8, max: 48, unit: 'px', step: 1 },
      { label: 'Spaziatura lettere (px)', prop: 'letter-spacing', tipo: 'slider', min: -2, max: 10, unit: 'px', step: 0.5 },
      { label: 'Altezza riga', prop: 'line-height', tipo: 'slider', min: 0.8, max: 2.5, unit: '', step: 0.05 },
      { label: 'Grassetto', prop: 'font-weight', tipo: 'select', opzioni: [['', 'Normale'], ['700', 'Grassetto'], ['300', 'Sottile'], ['900', 'Extra bold']] },
      { label: 'Corsivo', prop: 'font-style', tipo: 'select', opzioni: [['', 'No'], ['italic', 'Sì']] },
      { label: 'Maiuscole/minuscole', prop: 'text-transform', tipo: 'select', opzioni: [['', 'Predefinito'], ['uppercase', 'MAIUSCOLE'], ['lowercase', 'minuscole'], ['capitalize', 'Iniziali Maiuscole']] },
      { label: 'Allineamento testo', prop: 'text-align', tipo: 'select', opzioni: [['', 'Predefinito'], ['left', 'Sinistra'], ['center', 'Centro'], ['right', 'Destra']] },
      { label: 'Sottolineato', prop: 'text-decoration', tipo: 'select', opzioni: [['', 'No'], ['underline', 'Sì'], ['line-through', 'Barrato']] },
    ]},
    { titolo: '🖼️ Bordi', apertoDiDefault: false, controlli: [
      { label: 'Angoli arrotondati (px)', prop: 'border-radius', tipo: 'slider', min: 0, max: 60, unit: 'px', step: 1 },
      { label: 'Spessore bordo (px)', prop: 'border-width', tipo: 'slider', min: 0, max: 10, unit: 'px', step: 1 },
      { label: 'Stile bordo', prop: 'border-style', tipo: 'select', opzioni: [['solid', 'Continuo'], ['dashed', 'Tratteggiato'], ['dotted', 'Puntinato'], ['double', 'Doppio'], ['none', 'Nessuno']] },
    ]},
    { titolo: '✨ Effetti', apertoDiDefault: false, controlli: [
      { label: 'Ombra', prop: 'box-shadow', tipo: 'select', opzioni: [['', 'Nessuna'], ['0 2px 8px rgba(0,0,0,.35)', 'Leggera'], ['0 6px 20px rgba(0,0,0,.5)', 'Media'], ['0 0 30px rgba(255,179,0,.5)', 'Bagliore dorato'], ['0 0 30px rgba(77,163,255,.6)', 'Bagliore blu']] },
      { label: 'Opacità', prop: 'opacity', tipo: 'slider', min: 0.1, max: 1, unit: '', step: 0.05 },
      { label: 'Sfocatura (blur, px)', prop: 'filter', tipo: 'select', opzioni: [['', 'Nessuna'], ['blur(2px)', 'Leggera'], ['blur(5px)', 'Media'], ['grayscale(1)', 'Bianco e nero'], ['brightness(1.3)', 'Più luminoso'], ['brightness(.7)', 'Più scuro']] },
      { label: 'Cursore al passaggio', prop: 'cursor', tipo: 'select', opzioni: [['', 'Predefinito'], ['pointer', 'Manina (cliccabile)'], ['grab', 'Mano aperta'], ['not-allowed', 'Non permesso']] },
    ]},
    { titolo: '🎬 Animazione', apertoDiDefault: false, controlli: [
      { label: 'Animazione', prop: 'animation', tipo: 'select', opzioni: [
        ['', 'Nessuna'],
        ['editor-anim-pulse 1.6s ease-in-out infinite', 'Pulsazione'],
        ['editor-anim-bounce 1.2s ease-in-out infinite', 'Rimbalzo'],
        ['editor-anim-shake .5s ease-in-out infinite', 'Vibrazione'],
        ['editor-anim-glow 2s ease-in-out infinite', 'Bagliore pulsante'],
        ['editor-anim-fadein .6s ease-out 1', 'Apparizione (una volta)'],
      ] },
      { label: 'Transizione fluida', prop: 'transition', tipo: 'select', opzioni: [['', 'Nessuna (cambi scattosi)'], ['all .2s ease', 'Rapida'], ['all .5s ease', 'Media'], ['all 1s ease', 'Lenta']] },
    ]},
  ];

  function parseNumero(v, fallback) {
    if (!v) return fallback;
    const n = parseFloat(String(v).replace(/[^\d.-]/g, ''));
    return isNaN(n) ? fallback : n;
  }

  function renderControlliPer(el) {
    const sel = selettoreDi(el);
    document.getElementById('editor-selettore-label').textContent = sel;
    const lista = document.getElementById('editor-controlli-lista');
    lista.innerHTML = '';
    const valoriAttuali = overridesCorrenti[sel] || {};

    CATEGORIE_CONTROLLI.forEach((cat, catIdx) => {
      const catWrap = document.createElement('div');
      catWrap.style.cssText = 'margin-bottom:6px;border:1px solid #333;border-radius:8px;overflow:hidden';
      const contenutoId = `editor-cat-corpo-${catIdx}`;
      catWrap.innerHTML = `
        <div class="editor-cat-header" style="padding:8px 10px;background:#26263c;cursor:pointer;display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:.78rem">
          <span>${cat.titolo}</span><span class="editor-cat-freccia">${cat.apertoDiDefault ? '▾' : '▸'}</span>
        </div>
        <div id="${contenutoId}" style="padding:10px;display:flex;flex-direction:column;gap:8px;${cat.apertoDiDefault ? '' : 'display:none'}"></div>
      `;
      lista.appendChild(catWrap);
      const header = catWrap.querySelector('.editor-cat-header');
      const corpo = catWrap.querySelector(`#${contenutoId}`);
      header.addEventListener('click', () => {
        const aperto = corpo.style.display !== 'none';
        corpo.style.display = aperto ? 'none' : 'flex';
        catWrap.querySelector('.editor-cat-freccia').textContent = aperto ? '▸' : '▾';
      });

      cat.controlli.forEach(c => {
        const wrap = document.createElement('div');
        const val = valoriAttuali[c.prop] || '';
        if (c.tipo === 'color') {
          wrap.innerHTML = `<label style="display:block;margin-bottom:2px;font-size:.75rem">${c.label}</label>
            <input type="color" data-prop="${c.prop}" value="${val && val.startsWith('#') ? val : '#ffffff'}" style="width:100%;height:28px;border:none;border-radius:4px;cursor:pointer">`;
        } else if (c.tipo === 'select') {
          const opts = c.opzioni.map(o => `<option value="${o[0]}" ${val === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('');
          wrap.innerHTML = `<label style="display:block;margin-bottom:2px;font-size:.75rem">${c.label}</label>
            <select data-prop="${c.prop}" style="width:100%;padding:5px;border-radius:4px;border:1px solid #555;background:#111;color:#fff;font-size:.78rem">${opts}</select>`;
        } else { // slider
          const attuale = parseNumero(val, 0);
          wrap.innerHTML = `<label style="display:flex;justify-content:space-between;margin-bottom:2px;font-size:.75rem"><span>${c.label}</span><span data-valore-di="${c.prop}">${val || '0' + (c.unit || '')}</span></label>
            <input type="range" data-prop="${c.prop}" data-unit="${c.unit}" min="${c.min}" max="${c.max}" step="${c.step}" value="${attuale}" style="width:100%">`;
        }
        corpo.appendChild(wrap);
        const input = wrap.querySelector('input, select');
        input.addEventListener('input', () => {
          const prop = input.dataset.prop;
          let value = input.value;
          if (input.type === 'range') {
            const unit = input.dataset.unit || '';
            value = value + unit;
            const lbl = wrap.querySelector(`[data-valore-di="${prop}"]`);
            if (lbl) lbl.textContent = value;
          }
          if (!overridesCorrenti[sel]) overridesCorrenti[sel] = {};
          const valoreVuoto = (prop.startsWith('_') && (value === '0px' || value === '0deg' || value === '1'));
          if (value && !valoreVuoto) overridesCorrenti[sel][prop] = value;
          else delete overridesCorrenti[sel][prop];
          applicaOverridesAlDOM();
        });
      });
    });
  }

  function creaTiratoriRedimensiona(el) {
    rimuoviTiratori();
    const posizioni = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    posizioni.forEach(pos => {
      const t = document.createElement('div');
      t.className = 'editor-tiratore editor-tiratore-' + pos;
      t.dataset.pos = pos;
      document.body.appendChild(t);
      t.addEventListener('mousedown', (e) => iniziaResize(e, el, pos));
    });
    posizionaTiratori(el);
  }

  function rimuoviTiratori() {
    document.querySelectorAll('.editor-tiratore').forEach(t => t.remove());
  }

  function posizionaTiratori(el) {
    const r = el.getBoundingClientRect();
    const mappa = {
      nw: [r.left, r.top], n: [r.left + r.width / 2, r.top], ne: [r.right, r.top],
      e: [r.right, r.top + r.height / 2], se: [r.right, r.bottom], s: [r.left + r.width / 2, r.bottom],
      sw: [r.left, r.bottom], w: [r.left, r.top + r.height / 2]
    };
    document.querySelectorAll('.editor-tiratore').forEach(t => {
      const [x, y] = mappa[t.dataset.pos];
      t.style.left = (x - 5) + 'px';
      t.style.top = (y - 5) + 'px';
    });
  }

  function iniziaResize(e, el, pos) {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const r = el.getBoundingClientRect();
    const startW = r.width, startH = r.height;
    function onMove(ev) {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      let nuovaW = startW, nuovaH = startH;
      if (pos.includes('e')) nuovaW = Math.max(20, startW + dx);
      if (pos.includes('w')) nuovaW = Math.max(20, startW - dx);
      if (pos.includes('s')) nuovaH = Math.max(20, startH + dy);
      if (pos.includes('n')) nuovaH = Math.max(20, startH - dy);
      const sel = selettoreDi(el);
      if (!overridesCorrenti[sel]) overridesCorrenti[sel] = {};
      if (pos !== 'n' && pos !== 's') overridesCorrenti[sel]['width'] = Math.round(nuovaW) + 'px';
      if (pos !== 'e' && pos !== 'w') overridesCorrenti[sel]['height'] = Math.round(nuovaH) + 'px';
      applicaOverridesAlDOM();
      posizionaTiratori(el);
      renderControlliPer(el);
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function selezionaElemento(el) {
    elementoSelezionato = el;
    el.classList.add('editor-elemento-selezionato');
    const panel = document.getElementById('editor-panel-controlli');
    panel.style.display = 'flex';
    renderControlliPer(el);
    creaTiratoriRedimensiona(el);
  }

  function deselezionaElemento() {
    if (elementoSelezionato) elementoSelezionato.classList.remove('editor-elemento-selezionato');
    elementoSelezionato = null;
    rimuoviTiratori();
    const panel = document.getElementById('editor-panel-controlli');
    if (panel) panel.style.display = 'none';
  }

  function onMouseOver(e) {
    if (!editorAttivo) return;
    if (e.target.closest('#editor-panel-controlli, #editor-toolbar')) return;
    if (overlayHover) overlayHover.classList.remove('editor-elemento-hover');
    overlayHover = e.target;
    overlayHover.classList.add('editor-elemento-hover');
  }

  function onClick(e) {
    if (!editorAttivo) return;
    if (e.target.closest('#editor-panel-controlli, #editor-toolbar')) return;
    e.preventDefault();
    e.stopPropagation();
    if (elementoSelezionato) elementoSelezionato.classList.remove('editor-elemento-selezionato');
    selezionaElemento(e.target);
  }

  function attivaEditor() {
    editorAttivo = true;
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('click', onClick, true);
    document.body.classList.add('editor-modo-attivo');
    mostraToast('🎨 Modo editor ATTIVO — clicca su un elemento per modificarlo');
  }

  function disattivaEditor() {
    editorAttivo = false;
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('click', onClick, true);
    document.body.classList.remove('editor-modo-attivo');
    if (overlayHover) overlayHover.classList.remove('editor-elemento-hover');
    deselezionaElemento();
    mostraToast('Modo editor disattivato');
  }

  function costruisciUrlSimulazioneDa(ruolo, astaId, nome, larghezza) {
    const p = new URLSearchParams();
    p.set('editor', editorKey);
    if (astaId) {
      p.set('simRuolo', ruolo);
      p.set('simAstaId', astaId);
      p.set('simNome', nome || 'Test');
      if (ruolo === 'admin' && S.adminToken) p.set('simAdminToken', S.adminToken);
    }
    return window.location.origin + window.location.pathname + '?' + p.toString();
  }

  function apriFinestraSimulata(larghezza, etichetta) {
    const ruolo = document.getElementById('editor-form-ruolo').value;
    const astaId = document.getElementById('editor-form-astaid').value.trim();
    const nome = document.getElementById('editor-form-nome').value.trim() || 'Test Utente';
    const url = costruisciUrlSimulazioneDa(ruolo, astaId, nome, larghezza);
    // Apre una VERA finestra separata del browser (non un iframe) — così non c'è
    // sovrapposizione con la toolbar/pannello della finestra principale, e puoi
    // ridimensionarla/spostarla come qualsiasi altra finestra.
    const altezza = Math.min(900, Math.round(larghezza * 1.5));
    const win = window.open(url, 'editor_vista_' + ruolo, `width=${larghezza + 40},height=${altezza},resizable=yes,scrollbars=yes`);
    if (!win) mostraToast('⚠️ Il browser ha bloccato il popup — consenti i popup per questo sito');
    else mostraToast(`✅ Finestra "${etichetta}" (${ruolo}) aperta`);
  }

  function apriFormScegliVista(larghezza, etichetta) {
    let modal = document.getElementById('editor-form-vista-modal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'editor-form-vista-modal';
    modal.style.cssText = `
      position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:200000;
      background:#1c1c2e;border:2px solid #ffb300;border-radius:12px;padding:16px;
      box-shadow:0 8px 30px rgba(0,0,0,.6);font-family:sans-serif;color:#fff;font-size:.8rem;
      display:flex;flex-direction:column;gap:8px;width:320px;`;
    const astaIdAttuale = S.astaId || '';
    modal.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <strong>👁 Apri vista: ${etichetta} (${larghezza}px)</strong>
        <button id="editor-form-chiudi" style="background:none;border:none;color:#fff;font-size:1.1rem;cursor:pointer">✕</button>
      </div>
      <label style="color:#aaa">Ruolo da simulare</label>
      <select id="editor-form-ruolo" style="padding:6px;border-radius:6px;border:1px solid #555;background:#111;color:#fff">
        <option value="utente">👤 Utente (partecipante)</option>
        <option value="admin">👑 Admin</option>
      </select>
      <label style="color:#aaa">ID Asta</label>
      <input id="editor-form-astaid" type="text" value="${astaIdAttuale}" placeholder="es. ABC123" style="padding:6px;border-radius:6px;border:1px solid #555;background:#111;color:#fff">
      <label style="color:#aaa">Nome squadra di test</label>
      <input id="editor-form-nome" type="text" value="Test Utente" style="padding:6px;border-radius:6px;border:1px solid #555;background:#111;color:#fff">
      <button id="editor-form-apri" style="margin-top:6px;padding:9px;border-radius:8px;border:none;background:#4dff88;color:#111;font-weight:700;cursor:pointer">🪟 Apri in nuova finestra</button>
      <div style="color:#999;font-size:.68rem">Si aprirà una finestra separata del browser — non tocca la tua sessione reale, puoi tenerle aperte insieme.</div>
    `;
    document.body.appendChild(modal);
    document.getElementById('editor-form-chiudi').onclick = () => modal.remove();
    document.getElementById('editor-form-apri').onclick = () => { apriFinestraSimulata(larghezza, etichetta); modal.remove(); };
  }

  function creaToolbar() {
    const bar = document.createElement('div');
    bar.id = 'editor-toolbar';
    bar.style.cssText = `
      position:fixed;bottom:16px;right:16px;z-index:100001;
      display:flex;flex-wrap:wrap;gap:8px;max-width:340px;justify-content:flex-end;
      background:#1c1c2e;padding:8px;border-radius:16px;
      border:2px solid #ffb300;box-shadow:0 4px 20px rgba(0,0,0,.5);`;
    bar.innerHTML = `
      <button id="editor-toggle-btn" style="padding:8px 16px;border-radius:20px;border:none;background:#ffb300;color:#111;font-weight:700;cursor:pointer;font-size:.8rem">🎨 Modo Edizione</button>
      <button id="editor-salva-btn" style="padding:8px 16px;border-radius:20px;border:none;background:#4dff88;color:#111;font-weight:700;cursor:pointer;font-size:.8rem">💾 Salva</button>
      <button id="editor-reset-tutto-btn" style="padding:8px 16px;border-radius:20px;border:none;background:#ff5555;color:#111;font-weight:700;cursor:pointer;font-size:.8rem">🗑 Reset tutto</button>
      <div style="width:100%;display:flex;gap:6px;justify-content:flex-end;margin-top:2px">
        <button id="editor-vista-desktop" style="padding:6px 10px;border-radius:14px;border:none;background:#333;color:#fff;cursor:pointer;font-size:.72rem">💻 Desktop</button>
        <button id="editor-vista-tablet" style="padding:6px 10px;border-radius:14px;border:none;background:#333;color:#fff;cursor:pointer;font-size:.72rem">📱 Tablet</button>
        <button id="editor-vista-mobile" style="padding:6px 10px;border-radius:14px;border:none;background:#333;color:#fff;cursor:pointer;font-size:.72rem">📱 Móbile</button>
      </div>
    `;
    document.body.appendChild(bar);
    document.getElementById('editor-toggle-btn').onclick = () => {
      if (editorAttivo) disattivaEditor(); else attivaEditor();
    };
    document.getElementById('editor-salva-btn').onclick = salvaOverrides;
    document.getElementById('editor-reset-tutto-btn').onclick = () => {
      if (!confirm('Ripristinare TUTTI gli stili personalizzati? Questa azione non può essere annullata (a meno di non aver ancora salvato).')) return;
      overridesCorrenti = {};
      applicaOverridesAlDOM();
      deselezionaElemento();
    };
    document.getElementById('editor-vista-desktop').onclick = () => apriFormScegliVista(1280, 'Desktop');
    document.getElementById('editor-vista-tablet').onclick = () => apriFormScegliVista(768, 'Tablet');
    document.getElementById('editor-vista-mobile').onclick = () => apriFormScegliVista(390, 'Móbile');
  }

  function iniettaCSSEditor() {
    const s = document.createElement('style');
    s.textContent = `
      body.editor-modo-attivo * { cursor: crosshair !important; }
      .editor-elemento-hover { outline: 2px dashed #4da3ff !important; outline-offset: 1px; }
      .editor-elemento-selezionato { outline: 3px solid #ffb300 !important; outline-offset: 1px; }
      .editor-tiratore {
        position: fixed; width: 10px; height: 10px; background: #ffb300;
        border: 2px solid #111; border-radius: 50%; z-index: 100002; cursor: pointer;
      }
      .editor-tiratore-n, .editor-tiratore-s { cursor: ns-resize; }
      .editor-tiratore-e, .editor-tiratore-w { cursor: ew-resize; }
      .editor-tiratore-nw, .editor-tiratore-se { cursor: nwse-resize; }
      .editor-tiratore-ne, .editor-tiratore-sw { cursor: nesw-resize; }
    `;
    document.head.appendChild(s);
    window.addEventListener('scroll', () => { if (elementoSelezionato) posizionaTiratori(elementoSelezionato); }, true);
    window.addEventListener('resize', () => { if (elementoSelezionato) posizionaTiratori(elementoSelezionato); });
  }

  function iniettaKeyframesAnimazioni() {
    // Le @keyframes devono esistere per TUTTI i visitatori (non solo per l'editor),
    // altrimenti le animazioni salvate non si vedrebbero per gli utenti normali.
    const s = document.createElement('style');
    s.id = 'editor-keyframes-globali';
    s.textContent = `
      @keyframes editor-anim-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.06); } }
      @keyframes editor-anim-bounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
      @keyframes editor-anim-shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-3px); } 75% { transform: translateX(3px); } }
      @keyframes editor-anim-glow { 0%,100% { filter: drop-shadow(0 0 2px currentColor); } 50% { filter: drop-shadow(0 0 12px currentColor); } }
      @keyframes editor-anim-fadein { 0% { opacity: 0; transform: translateY(6px); } 100% { opacity: 1; transform: translateY(0); } }
    `;
    document.head.appendChild(s);
  }

  function init() {
    iniettaKeyframesAnimazioni(); // sempre, per tutti i visitatori
    caricaOverridesSalvati(); // applica gli stili salvati per TUTTI gli utenti
    if (!modoEditorDisponibile) return; // toolbar/pannello solo per chi ha la chiave editor
    iniettaCSSEditor();
    creaToolbar();
    creaPannelloControlli();
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
})();
