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
    return fetch('data/gk_planner_calendario.json').then(function (r) { return r.json(); }).then(function (d) {
      GKUI.fixtures = d.partite;
      return d.partite;
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
        '<div class="gk-summary-score">' +
          '<div class="gk-summary-score-num" style="color:' + scoreColor + '">' + d.score + '</div>' +
          '<div class="gk-summary-score-label">Compatibilità · ' + d.livello + '</div>' +
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
    let rowA = '<div class="gk-heatmap-row-label">' + teamA.substring(0, 3).toUpperCase() + '</div>';
    let rowB = '<div class="gk-heatmap-row-label">' + teamB.substring(0, 3).toUpperCase() + '</div>';
    let rowReco = '<div class="gk-heatmap-row-label">Consiglio</div>';
    d.calendario.forEach(function (r) {
      header += '<div class="gk-heat-header-cell">G' + r.giornata + '</div>';
      const titleA = r.A.opponent + ' (' + (r.A.isHome ? 'C' : 'F') + ')';
      const titleB = r.B.opponent + ' (' + (r.B.isHome ? 'C' : 'F') + ')';
      rowA += '<div class="gk-heat-cell gk-heat-' + r.A.livello + (r.raccomandato === 'A' ? ' gk-heat-reco' : '') + '" title="' + titleA + '">' + r.A.opponent.substring(0, 3) + '</div>';
      rowB += '<div class="gk-heat-cell gk-heat-' + r.B.livello + (r.raccomandato === 'B' ? ' gk-heat-reco' : '') + '" title="' + titleB + '">' + r.B.opponent.substring(0, 3) + '</div>';
      const recoLabel = r.raccomandato === 'A' ? teamA.substring(0, 3) : (r.raccomandato === 'B' ? teamB.substring(0, 3) : '⚖');
      const recoLivello = r.raccomandato === 'A' ? r.A.livello : (r.raccomandato === 'B' ? r.B.livello : 'media');
      rowReco += '<div class="gk-heat-cell gk-heat-' + recoLivello + '" title="Consigliato: ' + recoLabel + '">' + recoLabel + '</div>';
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGKPlanner);
  } else {
    initGKPlanner();
  }
})();
