// ══════════════════════════════════════════════════════════════════
// GOALKEEPER PLANNER — livello UI (collegato a GKPlanner, il motore
// puro senza DOM definito in gk-planner-engine.js). Segue lo stesso
// stile del resto dell'app (funzioni + innerHTML, nessun framework).
// ══════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const GKUI = {
    fixtures: null,
    config: null,
    ranking: null,
    lastDetail: null,
    currentRound: 1
  };

  const STORAGE_KEY = 'gkPlannerConfig_v1';

  function teamSlug(team) { return team.toLowerCase(); }
  function renderScoreGauge(score, colorVar) {
    const r = 52;
    const circ = 2 * Math.PI * r;
    const pct = Math.max(0, Math.min(100, score)) / 100;
    const offset = circ * (1 - pct);
    return '<div class="gk-gauge">' +
      '<svg viewBox="0 0 120 120" class="gk-gauge-svg">' +
        '<circle cx="60" cy="60" r="' + r + '" class="gk-gauge-track"></circle>' +
        '<circle cx="60" cy="60" r="' + r + '" class="gk-gauge-fill" style="stroke:' + colorVar + ';stroke-dasharray:' + circ.toFixed(1) + ';stroke-dashoffset:' + offset.toFixed(1) + '"></circle>' +
      '</svg>' +
      '<div class="gk-gauge-center">' +
        '<div class="gk-gauge-num" style="color:' + colorVar + '">' + score + '</div>' +
        '<div class="gk-gauge-max">/100</div>' +
      '</div>' +
    '</div>';
  }

  function teamBadge(team) { return '<img src="img/teams/' + teamSlug(team) + '.png" alt="" onerror="this.style.display=\'none\'">'; }

  function loadConfig() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return GKPlanner.mergeConfig(JSON.parse(saved));
    } catch (e) {}
    return GKPlanner.mergeConfig(null);
  }
  function saveConfig(cfg) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch (e) {}
  }

  function loadFixtures() {
    // Priorita': calendario personalizzato caricato da un Admin (salvato lato server, condiviso
    // da tutti gli utenti). Se non presente, si usa il calendario placeholder incluso nell'app.
    return fetch('/api/gk-planner/calendario').then(function (r) {
      if (!r.ok) throw new Error('no-custom');
      return r.json();
    }).then(function (d) {
      GKUI.fixtures = d.partite;
      GKUI.calendarioInfo = { custom: true, stagione: d.stagione, caricatoIl: d.caricatoIl };
      return d.partite;
    }).catch(function () {
      return fetch('data/gk_planner_calendario.json').then(function (r) { return r.json(); }).then(function (d) {
        GKUI.fixtures = d.partite;
        GKUI.calendarioInfo = { custom: false };
        return d.partite;
      });
    });
  }

  function ensureData() {
    if (GKUI.fixtures) return Promise.resolve();
    return loadFixtures().then(function () {
      GKUI.config = loadConfig();
    });
  }

  function recompute() {
    GKUI.ranking = GKPlanner.rankingCoppie(GKUI.fixtures, GKUI.config);
  }

  // ── Navigazione tra le viste interne ──
  function switchView(view) {
    document.querySelectorAll('.gk-tab').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-gk-view') === view); });
    document.querySelectorAll('.gk-view').forEach(function (v) { v.classList.toggle('active', v.id === 'gk-view-' + view); });
    if (view === 'ranking') renderRanking();
    if (view === 'round') renderRound();
    if (view === 'config') renderConfig();
  }

  // ── RANKING ──
  function renderRanking() {
    if (!GKUI.ranking) recompute();
    const list = document.getElementById('gk-ranking-list');
    const top = GKUI.ranking.slice(0, 40);
    let html = '';
    top.forEach(function (p, i) {
      const pos = i + 1;
      const posClass = pos === 1 ? 'top1' : (pos === 2 ? 'top2' : (pos === 3 ? 'top3' : ''));
      html += '<div class="gk-rank-card" data-team-a="' + p.teamA + '" data-team-b="' + p.teamB + '">' +
        '<div class="gk-rank-pos ' + posClass + '">' + pos + '</div>' +
        '<div class="gk-rank-teams">' +
          '<span class="gk-rank-team-badge">' + teamBadge(p.teamA) + p.teamA + '</span>' +
          '<span class="gk-rank-plus">+</span>' +
          '<span class="gk-rank-team-badge">' + teamBadge(p.teamB) + p.teamB + '</span>' +
        '</div>' +
        '<div class="gk-rank-score">' +
          '<div class="gk-rank-score-num">' + p.score + '</div>' +
          '<div class="gk-rank-score-lvl gk-lvl-' + p.livello + '">' + p.livello + '</div>' +
          '<div class="gk-rank-conf">Confidenza: ' + p.confidenza + '</div>' +
        '</div>' +
      '</div>';
    });
    list.innerHTML = html;
    list.querySelectorAll('.gk-rank-card').forEach(function (card) {
      card.addEventListener('click', function () {
        const a = card.getAttribute('data-team-a'), b = card.getAttribute('data-team-b');
        document.getElementById('gk-detail-teamA').value = a;
        document.getElementById('gk-detail-teamB').value = b;
        switchView('detail');
        renderDetail(a, b);
      });
    });
  }

  // ── Popolamento select squadre ──
  function populateTeamSelects() {
    const teams = Object.keys(GKUI.config.teamStrength).sort();
    const opts = teams.map(function (t) { return '<option value="' + t + '">' + t + '</option>'; }).join('');
    ['gk-detail-teamA', 'gk-detail-teamB', 'gk-cmp-a-teamA', 'gk-cmp-a-teamB', 'gk-cmp-b-teamA', 'gk-cmp-b-teamB'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = opts;
    });
    document.getElementById('gk-detail-teamB').selectedIndex = 1;
    document.getElementById('gk-cmp-a-teamB').selectedIndex = 1;
    document.getElementById('gk-cmp-b-teamA').selectedIndex = 2;
    document.getElementById('gk-cmp-b-teamB').selectedIndex = 3;
  }

  // ── ANALISI COPPIA ──
  function renderDetail(teamA, teamB) {
    if (!teamA || !teamB || teamA === teamB) {
      document.getElementById('gk-detail-content').innerHTML = '<p class="gk-view-intro">Scegli due squadre diverse e premi "Analizza".</p>';
      return;
    }
    const d = GKPlanner.analizzaCoppia(teamA, teamB, GKUI.fixtures, GKUI.config);
    GKUI.lastDetail = d;
    const scoreColor = d.livello === 'Ottimo' ? 'var(--success)' : d.livello === 'Buono' ? 'var(--primary-bright)' : d.livello === 'Discreto' ? 'var(--gold-bright)' : 'var(--danger)';

    let html = '<div class="gk-summary-card">' +
      '<div class="gk-summary-top">' +
        '<div class="gk-rank-teams">' +
          '<span class="gk-rank-team-badge" style="font-size:1rem">' + teamBadge(teamA) + teamA + '</span>' +
          '<span class="gk-pair-plus">+</span>' +
          '<span class="gk-rank-team-badge" style="font-size:1rem">' + teamBadge(teamB) + teamB + '</span>' +
        '</div>' +
        renderScoreGauge(d.score, scoreColor) +
        '<div class="gk-mini-stats">' +
          '<div class="gk-mini-stat gk-mini-stat-facile"><span class="gk-mini-stat-num">' + d.facili + '</span><span class="gk-mini-stat-lbl">facili</span></div>' +
          '<div class="gk-mini-stat gk-mini-stat-media"><span class="gk-mini-stat-num">' + d.medie + '</span><span class="gk-mini-stat-lbl">medie</span></div>' +
          '<div class="gk-mini-stat gk-mini-stat-difficile"><span class="gk-mini-stat-num">' + d.difficili + '</span><span class="gk-mini-stat-lbl">difficili</span></div>' +
          '<div class="gk-mini-stat"><span class="gk-mini-stat-num">' + d.inCasaReco + '</span><span class="gk-mini-stat-lbl">in casa</span></div>' +
          '<div class="gk-mini-stat"><span class="gk-mini-stat-num">' + d.fuoriCasaReco + '</span><span class="gk-mini-stat-lbl">fuori casa</span></div>' +
        '</div>' +
      '</div>' +
      '<p class="gk-summary-explain">💡 ' + d.spiegazione + '</p>' +
      '<div class="gk-breakdown">' + renderBreakdownItems(d.breakdown) + '</div>' +
      '<div class="gk-stats-row">' +
        '<div class="gk-stat-box"><div class="gk-stat-num">' + d.copertura + '/' + d.giornateTotali + '</div><div class="gk-stat-lbl">Giornate coperte</div></div>' +
        '<div class="gk-stat-box"><div class="gk-stat-num">' + d.giornateCritiche + '</div><div class="gk-stat-lbl">Giornate critiche</div></div>' +
        '<div class="gk-stat-box"><div class="gk-stat-num">' + d.entrambiFuoriCasa + '</div><div class="gk-stat-lbl">Entrambi fuori casa</div></div>' +
        '<div class="gk-stat-box"><div class="gk-stat-num">' + d.confidenza + '</div><div class="gk-stat-lbl">Confidenza (' + d.confidenzaScore + '%)</div></div>' +
      '</div>' +
    '</div>';

    html += renderHeatmap(d, teamA, teamB);
    html += renderGiornateList(d, teamA, teamB);

    document.getElementById('gk-detail-content').innerHTML = html;
  }

  function renderBreakdownItems(breakdown) {
    const labels = {
      coverage: 'Copertura calendario', difficoltaMedia: 'Dificoltà media (inv.)',
      alternanza: 'Alternanza casa/fuori', giornateCritiche: 'Giornate critiche (inv.)',
      fuoriCasaDoppio: 'Doppia trasferta (inv.)'
    };
    let html = '';
    Object.keys(breakdown).forEach(function (k) {
      const v = breakdown[k];
      html += '<div class="gk-breakdown-item">' +
        '<div class="gk-breakdown-label">' + (labels[k] || k) + '</div>' +
        '<div class="gk-breakdown-bar"><div class="gk-breakdown-bar-fill" style="width:' + v + '%"></div></div>' +
        '<div class="gk-breakdown-val">' + v + '%</div>' +
      '</div>';
    });
    return html;
  }

  function renderHeatmap(d, teamA, teamB) {
    let header = '<div class="gk-heat-header-cell"></div>';
    let rowA = '<div class="gk-heatmap-row-label">' + teamBadge(teamA) + '<span>' + teamA.substring(0, 3).toUpperCase() + '</span></div>';
    let rowB = '<div class="gk-heatmap-row-label">' + teamBadge(teamB) + '<span>' + teamB.substring(0, 3).toUpperCase() + '</span></div>';
    let rowReco = '<div class="gk-heatmap-row-label"><span>⭐ Consiglio</span></div>';
    d.calendario.forEach(function (r) {
      header += '<div class="gk-heat-header-cell">G' + r.giornata + '</div>';
      const titleA = r.A.opponent + ' (' + (r.A.isHome ? 'C' : 'F') + ')';
      const titleB = r.B.opponent + ' (' + (r.B.isHome ? 'C' : 'F') + ')';
      rowA += '<div class="gk-heat-cell gk-heat-' + r.A.livello + (r.raccomandato === 'A' ? ' gk-heat-reco' : '') + '" title="' + titleA + '">' + teamBadge(r.A.opponent) + '</div>';
      rowB += '<div class="gk-heat-cell gk-heat-' + r.B.livello + (r.raccomandato === 'B' ? ' gk-heat-reco' : '') + '" title="' + titleB + '">' + teamBadge(r.B.opponent) + '</div>';
      const recoOpponent = r.raccomandato === 'A' ? r.A.opponent : (r.raccomandato === 'B' ? r.B.opponent : null);
      const recoLabel = r.raccomandato === 'A' ? teamA.substring(0, 3) : (r.raccomandato === 'B' ? teamB.substring(0, 3) : '⚖');
      const recoLivello = r.raccomandato === 'A' ? r.A.livello : (r.raccomandato === 'B' ? r.B.livello : 'media');
      rowReco += '<div class="gk-heat-cell gk-heat-' + recoLivello + '" title="Consigliato: ' + recoLabel + '">' + (recoOpponent ? teamBadge(recoOpponent) : '<span class="gk-heat-ballot">⚖</span>') + '</div>';
    });
    return '<div class="gk-heatmap-wrap">' +
      '<div class="gk-heatmap">' + header + rowA + rowB + rowReco + '</div>' +
      '<div class="gk-heat-legend">' +
        '<span><i style="background:linear-gradient(135deg,#4ee39a,#00c37a)"></i> Facile</span>' +
        '<span><i style="background:linear-gradient(135deg,#ffd166,#ffab00)"></i> Media</span>' +
        '<span><i style="background:linear-gradient(135deg,#ff6b6b,#e8283e)"></i> Difficile</span>' +
        '<span>Il riquadro con il bordo interno bianco è il portiere titolare consigliato</span>' +
      '</div>' +
    '</div>';
  }

  function renderGiornateList(d, teamA, teamB) {
    let html = '<div class="gk-giornate-list">';
    d.calendario.forEach(function (r) {
      const recoText = r.raccomandato === 'A' ? teamA : (r.raccomandato === 'B' ? teamB : 'Ballottaggio');
      const recoClass = r.raccomandato === 'A' ? 'reco-A' : (r.raccomandato === 'B' ? 'reco-B' : 'reco-ballottaggio');
      html += '<div class="gk-giornata-row' + (r.criticaDoppia ? ' critica' : '') + '">' +
        '<span class="gk-giornata-num">G' + r.giornata + '</span>' +
        '<span class="gk-giornata-match">' + teamA + ' vs ' + r.A.opponent + (r.A.isHome ? ' (C)' : ' (F)') +
          ' · ' + teamB + ' vs ' + r.B.opponent + (r.B.isHome ? ' (C)' : ' (F)') + '</span>' +
        '<span class="gk-giornata-reco ' + recoClass + '">' + recoText + '</span>' +
      '</div>';
    });
    return html + '</div>';
  }

  // ── CONFRONTO ──
  function renderCompare() {
    const a1 = document.getElementById('gk-cmp-a-teamA').value, a2 = document.getElementById('gk-cmp-a-teamB').value;
    const b1 = document.getElementById('gk-cmp-b-teamA').value, b2 = document.getElementById('gk-cmp-b-teamB').value;
    if (a1 === a2 || b1 === b2) {
      document.getElementById('gk-compare-content').innerHTML = '<p class="gk-view-intro">Ogni coppia deve avere due squadre diverse.</p>';
      return;
    }
    const dA = GKPlanner.analizzaCoppia(a1, a2, GKUI.fixtures, GKUI.config);
    const dB = GKPlanner.analizzaCoppia(b1, b2, GKUI.fixtures, GKUI.config);
    const cmp = GKPlanner.confrontaCoppie(dA, dB);
    const winnerLabel = cmp.vincitore === 'A' ? (a1 + ' + ' + a2) : (cmp.vincitore === 'B' ? (b1 + ' + ' + b2) : 'Parità');

    function bar(labelText, valA, valB, maxVal) {
      const wA = Math.round((valA / maxVal) * 100), wB = Math.round((valB / maxVal) * 100);
      return '<div class="gk-compare-bar-row">' +
        '<span class="gk-compare-bar-label">' + labelText + '</span>' +
        '<div class="gk-compare-bar-track"><div class="gk-compare-bar-fill side-a" style="width:' + wA + '%"></div>' +
        '<div class="gk-compare-bar-fill side-b" style="width:' + wB + '%"></div></div>' +
      '</div>';
    }

    let html = '<div class="gk-compare-result">' +
      '<div class="gk-summary-card">' +
        '<p style="text-align:center;font-weight:700;color:var(--gold-bright)">🏆 Vince: ' + winnerLabel + '</p>' +
        '<div class="gk-compare-bars">' +
          bar('Punteggio', dA.score, dB.score, 100) +
          bar('Giornate coperte', dA.copertura, dB.copertura, 38) +
          bar('Giornate critiche (inv.)', 38 - dA.giornateCritiche, 38 - dB.giornateCritiche, 38) +
          bar('Doppia trasferta (inv.)', 38 - dA.entrambiFuoriCasa, 38 - dB.entrambiFuoriCasa, 38) +
        '</div>' +
      '</div>' +
    '</div>';
    document.getElementById('gk-compare-content').innerHTML = html;
  }

  // ── VISTA GIORNATA ──
  function renderRound() {
    document.getElementById('gk-round-label').textContent = 'Giornata ' + GKUI.currentRound;
    document.getElementById('gk-round-slider').value = GKUI.currentRound;
    const rows = GKPlanner.vistaGiornata(GKUI.currentRound, GKUI.fixtures, GKUI.config);
    let html = '<div class="gk-round-teams">';
    rows.forEach(function (r, i) {
      const badgeBg = r.livello === 'facile' ? 'rgba(0,224,160,.18)' : (r.livello === 'difficile' ? 'rgba(255,56,96,.18)' : 'rgba(255,179,0,.18)');
      const badgeColor = r.livello === 'facile' ? 'var(--success)' : (r.livello === 'difficile' ? 'var(--danger)' : 'var(--gold-bright)');
      html += '<div class="gk-round-team-row">' +
        '<span class="gk-round-team-pos">' + (i + 1) + '</span>' +
        teamBadge(r.team) +
        '<span class="gk-round-team-name">' + r.team + '</span>' +
        '<span class="gk-round-team-opp">vs ' + r.opponent + (r.isHome ? ' (Casa)' : ' (Fuori)') + '</span>' +
        '<span class="gk-round-diff-badge" style="background:' + badgeBg + ';color:' + badgeColor + '">' + r.difficolta + '</span>' +
      '</div>';
    });
    html += '</div>';
    document.getElementById('gk-round-content').innerHTML = html;
  }

  // ── IMPOSTAZIONI ──
  function renderConfig() {
    updateGkImportStatusText();
    const cfg = GKUI.config;
    const weightLabels = {
      coverage: 'Copertura calendario', difficoltaMedia: 'Difficoltà media',
      alternanza: 'Alternanza casa/fuori', giornateCritiche: 'Giornate critiche',
      fuoriCasaDoppio: 'Doppia trasferta'
    };
    let wHtml = '';
    Object.keys(cfg.weights).forEach(function (k) {
      wHtml += '<div class="gk-config-row">' +
        '<label>' + weightLabels[k] + '</label>' +
        '<input type="range" min="0" max="50" value="' + cfg.weights[k] + '" data-weight="' + k + '">' +
        '<span class="gk-config-val">' + cfg.weights[k] + '</span>' +
      '</div>';
    });
    document.getElementById('gk-config-weights').innerHTML = wHtml;

    document.getElementById('gk-config-home').innerHTML =
      '<div class="gk-config-row"><label>Bonus casa</label><input type="range" min="0" max="20" value="' + cfg.homeAdvantage + '" id="gk-cfg-home"><span class="gk-config-val">' + cfg.homeAdvantage + '</span></div>' +
      '<div class="gk-config-row"><label>Penalità fuori casa</label><input type="range" min="0" max="20" value="' + cfg.awayPenalty + '" id="gk-cfg-away"><span class="gk-config-val">' + cfg.awayPenalty + '</span></div>';

    let sHtml = '';
    Object.keys(cfg.teamStrength).sort().forEach(function (t) {
      sHtml += '<div class="gk-strength-item"><label>' + t + ' <span class="gk-config-val">' + cfg.teamStrength[t] + '</span></label>' +
        '<input type="range" min="30" max="99" value="' + cfg.teamStrength[t] + '" data-team="' + t + '"></div>';
    });
    document.getElementById('gk-config-strength').innerHTML = sHtml;

    document.querySelectorAll('#gk-config-weights input[type=range]').forEach(function (inp) {
      inp.addEventListener('input', function () { inp.nextElementSibling.textContent = inp.value; });
    });
    document.querySelectorAll('#gk-config-home input[type=range]').forEach(function (inp) {
      inp.addEventListener('input', function () { inp.nextElementSibling.textContent = inp.value; });
    });
    document.querySelectorAll('#gk-config-strength input[type=range]').forEach(function (inp) {
      inp.addEventListener('input', function () { inp.previousElementSibling ? null : null; inp.parentElement.querySelector('.gk-config-val').textContent = inp.value; });
    });
  }

  function applyConfigFromForm() {
    const cfg = JSON.parse(JSON.stringify(GKUI.config));
    document.querySelectorAll('#gk-config-weights input[type=range]').forEach(function (inp) {
      cfg.weights[inp.getAttribute('data-weight')] = parseInt(inp.value, 10);
    });
    cfg.homeAdvantage = parseInt(document.getElementById('gk-cfg-home').value, 10);
    cfg.awayPenalty = parseInt(document.getElementById('gk-cfg-away').value, 10);
    document.querySelectorAll('#gk-config-strength input[type=range]').forEach(function (inp) {
      cfg.teamStrength[inp.getAttribute('data-team')] = parseInt(inp.value, 10);
    });
    GKUI.config = GKPlanner.mergeConfig(cfg);
    saveConfig(GKUI.config);
    recompute();
    if (typeof toast === 'function') toast('Impostazioni applicate, analisi ricalcolata', 'success');
    switchView('ranking');
  }

  function resetConfig() {
    GKUI.config = GKPlanner.mergeConfig(null);
    saveConfig(GKUI.config);
    recompute();
    renderConfig();
    if (typeof toast === 'function') toast('Impostazioni ripristinate ai valori di default', 'success');
  }

  // ── IMPORTAZIONE CALENDARIO (Admin) ──
  // Permette all'Admin di caricare il calendario reale della Serie A (Excel o JSON)
  // non appena disponibile, sostituendo il calendario placeholder. Salvato lato server,
  // quindi visibile immediatamente a tutti gli utenti dell'app (non solo a chi lo carica).
  let _gkPendingCalendario = null;

  function updateGkImportStatusText() {
    const el = document.getElementById('gk-import-status-text');
    if (!el) return;
    if (GKUI.calendarioInfo && GKUI.calendarioInfo.custom) {
      const data = GKUI.calendarioInfo.caricatoIl ? new Date(GKUI.calendarioInfo.caricatoIl).toLocaleString('it-IT') : '';
      el.textContent = '✅ In uso: calendario reale caricato' + (data ? ' il ' + data : '') + '. Puoi sostituirlo caricando un nuovo file.';
    } else {
      el.textContent = 'Attualmente in uso: calendario generato automaticamente (placeholder). Carica il calendario reale (Excel o JSON) non appena disponibile — verrà usato da tutti gli utenti dell\'app.';
    }
  }

  function normalizeParsedPartite(rows) {
    // Rows possono venire da Excel (oggetti con colonne libere) o da JSON ({partite:[...]}).
    const norm = function (s) { return (s || '').toString().trim().toLowerCase(); };
    if (!rows.length) return [];
    const headers = Object.keys(rows[0]);
    const findCol = function () {
      const names = Array.prototype.slice.call(arguments);
      return headers.find(function (h) { return names.some(function (n) { return norm(h) === norm(n); }); });
    };
    const colGiornata = findCol('Giornata', 'Giorn', 'GG', 'Round');
    const colCasa = findCol('Casa', 'Home', 'Squadra Casa');
    const colOspite = findCol('Ospite', 'Away', 'Squadra Ospite', 'Trasferta');
    if (!colGiornata || !colCasa || !colOspite) return null; // colonne mancanti
    return rows.map(function (r) {
      return { giornata: parseInt(r[colGiornata], 10), casa: String(r[colCasa] || '').trim(), ospite: String(r[colOspite] || '').trim() };
    }).filter(function (p) { return p.giornata && p.casa && p.ospite; });
  }

  function handleGkCalendarioFile(file) {
    if (!file) return;
    const statusEl = document.getElementById('gk-import-filename');
    const btnCarica = document.getElementById('btn-gk-carica-calendario');
    statusEl.textContent = file.name;
    btnCarica.disabled = true;
    _gkPendingCalendario = null;

    const isJson = /\.json$/i.test(file.name);
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        let partite;
        if (isJson) {
          const parsed = JSON.parse(e.target.result);
          partite = Array.isArray(parsed) ? parsed : parsed.partite;
          if (!Array.isArray(partite)) throw new Error('Il file JSON deve contenere un array "partite"');
        } else {
          const wb = XLSX.read(e.target.result, { type: 'array' });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
          partite = normalizeParsedPartite(rows);
          if (partite === null) throw new Error('Colonne mancanti: servono Giornata, Casa, Ospite');
        }
        if (!partite || !partite.length) throw new Error('Nessuna partita valida trovata nel file');
        _gkPendingCalendario = partite;
        btnCarica.disabled = false;
        if (typeof toast === 'function') toast(partite.length + ' partite lette dal file, premi "Carica calendario" per confermare', 'success');
      } catch (err) {
        if (typeof toast === 'function') toast('Errore nella lettura del file: ' + err.message, 'error');
      }
    };
    if (isJson) reader.readAsText(file); else reader.readAsArrayBuffer(file);
  }

  async function confermaCaricaCalendario() {
    if (!_gkPendingCalendario || !_gkPendingCalendario.length) return;
    try {
      const { data: sessData } = await supa.auth.getSession();
      const token = sessData && sessData.session ? sessData.session.access_token : null;
      const res = await fetch('/api/gk-planner/calendario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ partite: _gkPendingCalendario })
      });
      const out = await res.json();
      if (!res.ok) {
        if (typeof toast === 'function') toast(out.error || 'Errore nel caricamento del calendario', 'error');
        return;
      }
      if (typeof toast === 'function') toast('Calendario aggiornato: ' + out.totalPartite + ' partite su ' + out.giornateTotali + ' giornate', 'success');
      document.getElementById('gk-import-filename').textContent = '';
      document.getElementById('btn-gk-carica-calendario').disabled = true;
      _gkPendingCalendario = null;
      await loadFixtures();
      recompute();
      updateGkImportStatusText();
    } catch (err) {
      if (typeof toast === 'function') toast('Errore di rete durante il caricamento: ' + err.message, 'error');
    }
  }

  async function ripristinaCalendarioPlaceholder() {
    try {
      const { data: sessData } = await supa.auth.getSession();
      const token = sessData && sessData.session ? sessData.session.access_token : null;
      const res = await fetch('/api/gk-planner/calendario', {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const out = await res.json();
      if (!res.ok) {
        if (typeof toast === 'function') toast(out.error || 'Errore nel ripristino', 'error');
        return;
      }
      if (typeof toast === 'function') toast('Ripristinato il calendario placeholder', 'success');
      await loadFixtures();
      recompute();
      updateGkImportStatusText();
    } catch (err) {
      if (typeof toast === 'function') toast('Errore di rete: ' + err.message, 'error');
    }
  }

  // ── Inizializzazione ──
  function initGKPlanner() {
    const btnMenu = document.getElementById('btn-menu-gk-planner');
    const btnBack = document.getElementById('btn-back-gk');
    if (btnMenu) btnMenu.addEventListener('click', function () {
      ensureData().then(function () {
        populateTeamSelects();
        recompute();
        showScreen('screen-gk-planner');
        switchView('ranking');
      });
    });
    if (btnBack) btnBack.addEventListener('click', function () { showScreen('screen-menu-principale'); });

    const btnHelp = document.getElementById('btn-gk-help');
    if (btnHelp) btnHelp.addEventListener('click', function () { openModal('modal-gk-help'); });

    document.querySelectorAll('.gk-tab').forEach(function (tab) {
      tab.addEventListener('click', function () { switchView(tab.getAttribute('data-gk-view')); });
    });

    const btnAnalizza = document.getElementById('btn-gk-analizza');
    if (btnAnalizza) btnAnalizza.addEventListener('click', function () {
      renderDetail(document.getElementById('gk-detail-teamA').value, document.getElementById('gk-detail-teamB').value);
    });

    const btnConfronta = document.getElementById('btn-gk-confronta');
    if (btnConfronta) btnConfronta.addEventListener('click', renderCompare);

    const sliderRound = document.getElementById('gk-round-slider');
    if (sliderRound) sliderRound.addEventListener('input', function () { GKUI.currentRound = parseInt(sliderRound.value, 10); renderRound(); });
    const btnPrev = document.getElementById('btn-gk-round-prev');
    if (btnPrev) btnPrev.addEventListener('click', function () { GKUI.currentRound = Math.max(1, GKUI.currentRound - 1); renderRound(); });
    const btnNext = document.getElementById('btn-gk-round-next');
    if (btnNext) btnNext.addEventListener('click', function () { GKUI.currentRound = Math.min(38, GKUI.currentRound + 1); renderRound(); });

    const btnApply = document.getElementById('btn-gk-apply-config');
    if (btnApply) btnApply.addEventListener('click', applyConfigFromForm);
    const btnReset = document.getElementById('btn-gk-reset-config');
    if (btnReset) btnReset.addEventListener('click', resetConfig);

    const inpCalFile = document.getElementById('inp-gk-calendario-file');
    if (inpCalFile) inpCalFile.addEventListener('change', function () { handleGkCalendarioFile(inpCalFile.files[0]); });
    const btnCarica = document.getElementById('btn-gk-carica-calendario');
    if (btnCarica) btnCarica.addEventListener('click', confermaCaricaCalendario);
    const btnRipristina = document.getElementById('btn-gk-ripristina-calendario');
    if (btnRipristina) btnRipristina.addEventListener('click', ripristinaCalendarioPlaceholder);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGKPlanner);
  } else {
    initGKPlanner();
  }
})();
