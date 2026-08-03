// ══════════════════════════════════════════════════════════════════
// GRIGLIA PORTIERI/ATTACCANTI — livello UI
// ══════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const GKUI = {
    fixtures: null,
    config: null,
    calendarioInfo: null,
    mode: 'portieri',
    rankCache: {}
  };

  const STORAGE_KEY = 'gkPlannerConfig_v1';
  const MODE_KEY = 'gkPlannerMode_v1';

  function teamSlug(t) { return t.toLowerCase(); }
  function teamBadge(t) { return '<img src="img/teams/' + teamSlug(t) + '.png" alt="" onerror="this.style.display=\'none\'">'; }

  function renderScoreGauge(score, colorVar) {
    const r = 52, circ = 2 * Math.PI * r, pct = Math.max(0, Math.min(100, score)) / 100;
    const offset = circ * (1 - pct);
    return '<div class="gk-gauge"><svg viewBox="0 0 120 120" class="gk-gauge-svg">' +
      '<circle cx="60" cy="60" r="' + r + '" class="gk-gauge-track"></circle>' +
      '<circle cx="60" cy="60" r="' + r + '" class="gk-gauge-fill" style="stroke:' + colorVar + ';stroke-dasharray:' + circ.toFixed(1) + ';stroke-dashoffset:' + offset.toFixed(1) + '"></circle>' +
      '</svg><div class="gk-gauge-center"><div class="gk-gauge-num" style="color:' + colorVar + '">' + score + '</div><div class="gk-gauge-max">/100</div></div></div>';
  }

  function loadConfigLocal() {
    try { const s = localStorage.getItem(STORAGE_KEY); if (s) return GKPlanner.mergeConfig(JSON.parse(s)); } catch (e) {}
    return GKPlanner.mergeConfig(null);
  }
  // Carica la configurazione dell'utente: prova prima Supabase (sincronizzata tra dispositivi
  // per utenti loggati), poi ricade su localStorage se non loggato o in caso di errore.
  function loadConfig() {
    const local = loadConfigLocal();
    try {
      if (typeof supa !== 'undefined' && typeof S !== 'undefined' && S.userId) {
        return supa.from('gk_planner_config').select('config').eq('user_id', S.userId).single()
          .then(function (res) {
            if (res && res.data && res.data.config) {
              const merged = GKPlanner.mergeConfig(res.data.config);
              try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch (e) {}
              return merged;
            }
            return local;
          })
          .catch(function () { return local; });
      }
    } catch (e) {}
    return Promise.resolve(local);
  }
  // Salva sempre in localStorage (istantaneo) e, se l'utente e' loggato, sincronizza
  // anche su Supabase in background cosi' la configurazione e' condivisa tra dispositivi.
  function saveConfig(cfg) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch (e) {}
    try {
      if (typeof supa !== 'undefined' && typeof S !== 'undefined' && S.userId) {
        supa.from('gk_planner_config').upsert({ user_id: S.userId, config: cfg, updated_at: new Date().toISOString() }).then(function () {}).catch(function () {});
      }
    } catch (e) {}
  }
  function loadMode() { try { const s = localStorage.getItem(MODE_KEY); if (s === 'attaccanti' || s === 'portieri') return s; } catch (e) {} return 'portieri'; }
  function saveMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch (e) {} }

  function loadFixtures() {
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
    GKUI.mode = loadMode();
    if (GKUI.fixtures) return Promise.resolve();
    return loadFixtures().then(function () { return loadConfig(); }).then(function (cfg) { GKUI.config = cfg; });
  }

  function recompute() { GKUI.rankCache = {}; }

  function getRanking(groupSize) {
    const key = GKUI.mode + '-' + groupSize;
    if (!GKUI.rankCache[key]) {
      GKUI.rankCache[key] = GKPlanner.rankingGruppi(GKUI.fixtures, GKUI.config, groupSize, GKUI.mode);
    }
    return GKUI.rankCache[key];
  }

  function getPairScoreMap() {
    const key = GKUI.mode + '-pairmap';
    if (!GKUI.rankCache[key]) {
      const list = getRanking(2);
      const map = {};
      list.forEach(function (p) {
        const k = p.teams.slice().sort().join('|');
        map[k] = p;
      });
      GKUI.rankCache[key] = map;
    }
    return GKUI.rankCache[key];
  }

  function scoreToColor(score, lo, hi) {
    const t = Math.max(0, Math.min(1, (score - lo) / (hi - lo || 1)));
    const c1 = [42, 26, 88];
    const c2 = [0, 224, 160];
    const r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
    const g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
    const b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
    return { css: 'rgb(' + r + ',' + g + ',' + b + ')', t: t };
  }

  function renderGrid() {
    const container = document.getElementById('gk-grid-scroll');
    if (!container) return;
    const teams = Object.keys(GKUI.config.teamStats).sort();
    const map = getPairScoreMap();
    const scores = Object.keys(map).map(function (k) { return map[k].score; });
    if (!scores.length) { container.innerHTML = ''; return; }
    const lo = Math.min.apply(null, scores), hi = Math.max.apply(null, scores);
    let html = '<div class="gk-grid" style="grid-template-columns:84px repeat(' + teams.length + ',44px)">';
    html += '<div class="gk-grid-corner"></div>';
    teams.forEach(function (t) { html += '<div class="gk-grid-col-header" title="' + t + '">' + teamBadge(t) + '</div>'; });
    teams.forEach(function (rowTeam) {
      html += '<div class="gk-grid-row-label">' + teamBadge(rowTeam) + '<span>' + rowTeam.substring(0, 3).toUpperCase() + '</span></div>';
      teams.forEach(function (colTeam) {
        if (rowTeam === colTeam) { html += '<div class="gk-grid-cell gk-grid-cell-diag"></div>'; return; }
        const key = [rowTeam, colTeam].sort().join('|');
        const entry = map[key];
        if (!entry) { html += '<div class="gk-grid-cell"></div>'; return; }
        const col = scoreToColor(entry.score, lo, hi);
        const fg = col.t > 0.55 ? '#04120a' : '#f3eefe';
        html += '<div class="gk-grid-cell" style="background:' + col.css + ';color:' + fg + '" data-teams="' + rowTeam + '|' + colTeam + '" title="' + rowTeam + ' + ' + colTeam + ': ' + Math.round(entry.score) + '">' + Math.round(entry.score) + '</div>';
      });
    });
    html += '</div>';
    container.innerHTML = html;
    container.querySelectorAll('.gk-grid-cell[data-teams]').forEach(function (cell) {
      cell.addEventListener('click', function () {
        const teams2 = cell.getAttribute('data-teams').split('|');
        setTeamsToPicker('gk-detail', teams2);
        renderDetail(teams2, 'gk-detail-content');
        switchView('detail');
      });
    });
    const legendRange = document.getElementById('gk-grid-legend-range');
    if (legendRange) legendRange.textContent = 'Punteggi da ' + Math.round(lo) + ' a ' + Math.round(hi) + ' su 100.';
  }

  function applyModeToggleUI() {
    document.querySelectorAll('.gk-mode-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-gk-mode') === GKUI.mode);
    });
    document.querySelectorAll('.gk-header-sub-dynamic').forEach(function (el) {
      el.textContent = GKUI.mode === 'attaccanti'
        ? 'Le migliori combinazioni di attaccanti per le 38 giornate di Serie A'
        : 'Le migliori combinazioni di portieri per le 38 giornate di Serie A';
    });
  }

  function setMode(mode) {
    GKUI.mode = (mode === 'attaccanti') ? 'attaccanti' : 'portieri';
    saveMode(GKUI.mode);
    recompute();
    applyModeToggleUI();
    refreshVisibleViews();
  }

  function refreshVisibleViews() {
    document.querySelectorAll('.gk-ranking-subtabs').forEach(function (nav) {
      const listId = nav.getAttribute('data-rank-list');
      const activeBtn = nav.querySelector('.gk-subtab.active') || nav.querySelector('.gk-subtab');
      if (activeBtn && listId && document.getElementById(listId)) {
        renderRanking(listId, parseInt(activeBtn.getAttribute('data-ranksub'), 10));
      }
    });
    const gridView = document.getElementById('gk-view-grid');
    if (gridView && gridView.classList.contains('active')) { renderGrid(); }
  }

  function switchView(view) {
    document.querySelectorAll('#gk-tabs .gk-tab').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-gk-view') === view); });
    document.querySelectorAll('#screen-gk-planner .gk-view').forEach(function (v) { v.classList.toggle('active', v.id === 'gk-view-' + view); });
    if (view === 'ranking') renderRanking('gk-ranking-list', 2);
    if (view === 'config') renderConfig();
    if (view === 'grid') renderGrid();
  }

  // ── RANKING ──
  function renderRanking(containerId, groupSize) {
    const list = document.getElementById(containerId);
    if (!list) return;
    const size = (groupSize === 3) ? 3 : 2;
    const ranking = getRanking(size).slice(0, 10);
    let html = '';
    ranking.forEach(function (p, i) {
      const pos = i + 1;
      const posClass = pos === 1 ? 'top1' : (pos === 2 ? 'top2' : (pos === 3 ? 'top3' : ''));
      const teamsHtml = p.teams.map(function (t) { return '<span class="gk-rank-team-badge">' + teamBadge(t) + t + '</span>'; }).join('<span class="gk-rank-plus">+</span>');
      html += '<div class="gk-rank-card" data-teams="' + p.teams.join('|') + '">' +
        '<div class="gk-rank-pos ' + posClass + '">' + pos + '</div>' +
        '<div class="gk-rank-teams">' + teamsHtml + '</div>' +
        '<div class="gk-rank-score"><div class="gk-rank-score-num">' + p.score + '</div>' +
        '<div class="gk-rank-score-lvl gk-lvl-' + p.livello + '">' + p.livello + '</div>' +
        '<div class="gk-rank-conf">Confidenza: ' + p.confidenza + '</div></div></div>';
    });
    list.innerHTML = html || '<p class="gk-view-intro">Nessun dato disponibile.</p>';
    const isInline = containerId.indexOf('gki-') === 0;
    const detailPrefix = isInline ? 'gki-detail' : 'gk-detail';
    const detailContentId = isInline ? 'gki-detail-content' : 'gk-detail-content';
    list.querySelectorAll('.gk-rank-card').forEach(function (card) {
      card.addEventListener('click', function () {
        const teams = card.getAttribute('data-teams').split('|');
        setTeamsToPicker(detailPrefix, teams);
        renderDetail(teams, detailContentId);
        if (!isInline) {
          // scroll to detail view in full-screen mode
          switchView('detail');
        } else {
          // switch to analisi subtab in inline mode
          var analisiBtn = document.querySelector('.gki-subtabs .gki-subtab[data-gki-view="analisi"]');
          if (analisiBtn) analisiBtn.click();
        }
      });
    });
  }

  function populateTeamSelects() {
    const teams = Object.keys(GKUI.config.teamStats).sort();
    const opts = teams.map(function (t) { return '<option value="' + t + '">' + t + '</option>'; }).join('');
    document.querySelectorAll('.gk-team-select').forEach(function (el) { el.innerHTML = opts; });
    function setIdx(id, idx) { const el = document.getElementById(id); if (el) el.selectedIndex = idx % teams.length; }
    setIdx('gk-detail-teamA', 0); setIdx('gk-detail-teamB', 1); setIdx('gk-detail-teamC', 2);
    setIdx('gki-detail-teamA', 0); setIdx('gki-detail-teamB', 1); setIdx('gki-detail-teamC', 2);
    setIdx('gk-cmp-a-teamA', 0); setIdx('gk-cmp-a-teamB', 1); setIdx('gk-cmp-a-teamC', 2);
    setIdx('gk-cmp-b-teamA', 3); setIdx('gk-cmp-b-teamB', 4); setIdx('gk-cmp-b-teamC', 5);
    setIdx('gki-cmp-a-teamA', 0); setIdx('gki-cmp-a-teamB', 1); setIdx('gki-cmp-a-teamC', 2);
    setIdx('gki-cmp-b-teamA', 3); setIdx('gki-cmp-b-teamB', 4); setIdx('gki-cmp-b-teamC', 5);
    document.querySelectorAll('.gk-team-select').forEach(function (el) { updateTeamCardBadgeFromSelect(el); });
  }

  function updateTeamCardBadgeFromSelect(selectEl) {
    const badgeId = selectEl.getAttribute('data-badge');
    if (!badgeId) return;
    const badge = document.getElementById(badgeId);
    if (badge) badge.innerHTML = teamBadge(selectEl.value);
  }

  function wireAdd3(addBtnId, removeBtnId, wrapId) {
    const addBtn = document.getElementById(addBtnId);
    const removeBtn = document.getElementById(removeBtnId);
    const wrap = document.getElementById(wrapId);
    if (!addBtn || !wrap) return;
    addBtn.addEventListener('click', function () { wrap.classList.remove('hidden'); addBtn.classList.add('hidden'); });
    if (removeBtn) removeBtn.addEventListener('click', function () { wrap.classList.add('hidden'); addBtn.classList.remove('hidden'); });
  }

  function readTeamsFromPicker(prefix) {
    const a = document.getElementById(prefix + '-teamA');
    const b = document.getElementById(prefix + '-teamB');
    const cWrap = document.getElementById(prefix + '-teamC-wrap');
    const c = document.getElementById(prefix + '-teamC');
    if (!a || !b) return [];
    const teams = [a.value, b.value];
    if (cWrap && !cWrap.classList.contains('hidden') && c && c.value) teams.push(c.value);
    return teams;
  }

  function setTeamsToPicker(prefix, teams) {
    const a = document.getElementById(prefix + '-teamA');
    const b = document.getElementById(prefix + '-teamB');
    const c = document.getElementById(prefix + '-teamC');
    const cWrap = document.getElementById(prefix + '-teamC-wrap');
    const addBtn = document.getElementById('btn-' + prefix + '-add3');
    if (a) a.value = teams[0];
    if (b) b.value = teams[1];
    if (teams.length > 2 && c) {
      c.value = teams[2];
      if (cWrap) cWrap.classList.remove('hidden');
      if (addBtn) addBtn.classList.add('hidden');
    } else {
      if (cWrap) cWrap.classList.add('hidden');
      if (addBtn) addBtn.classList.remove('hidden');
    }
    [a, b, c].forEach(function (el) { if (el) updateTeamCardBadgeFromSelect(el); });
  }

  // ── ANALISI GRUPPO (2 o 3 squadre) ──
  function renderDetail(teams, containerId) {
    const targetId = containerId || 'gk-detail-content';
    const el = document.getElementById(targetId);
    if (!el) return;
    const filled = teams.filter(function (t) { return t; });
    const distinct = new Set(filled);
    if (filled.length < 2 || distinct.size !== filled.length) {
      el.innerHTML = '<p class="gk-view-intro">Scegli squadre diverse tra loro e premi "Analizza".</p>';
      return;
    }
    const d = GKPlanner.analizzaGruppo(filled, GKUI.fixtures, GKUI.config, GKUI.mode);
    const scoreColor = d.livello === 'Ottimo' ? 'var(--success)' : d.livello === 'Buono' ? 'var(--primary-bright)' : d.livello === 'Discreto' ? 'var(--gold-bright)' : 'var(--danger)';

    let html = '<div class="gk-summary-card gk-summary-fancy">' +
      '<div class="gk-summary-fancy-gauge">' + renderScoreGauge(d.score, scoreColor) + '</div>' +
      '<div class="gk-mini-stats-grid">' +
        '<div class="gk-mini-row">' +
          '<div class="gk-mini-stat gk-mini-stat-facile"><span class="gk-mini-stat-num">' + d.facili + '</span><span class="gk-mini-stat-lbl">facili</span></div>' +
          '<div class="gk-mini-stat gk-mini-stat-media"><span class="gk-mini-stat-num">' + d.medie + '</span><span class="gk-mini-stat-lbl">medie</span></div>' +
          '<div class="gk-mini-stat gk-mini-stat-difficile"><span class="gk-mini-stat-num">' + d.difficili + '</span><span class="gk-mini-stat-lbl">difficili</span></div>' +
          '<div class="gk-mini-stat gk-mini-stat-molto-difficile"><span class="gk-mini-stat-num">' + d.moltoDifficili + '</span><span class="gk-mini-stat-lbl">molto diff.</span></div>' +
        '</div>' +
        '<div class="gk-mini-row">' +
          '<div class="gk-mini-stat"><span class="gk-mini-stat-num">' + d.inCasaReco + '</span><span class="gk-mini-stat-lbl">in casa</span></div>' +
          '<div class="gk-mini-stat"><span class="gk-mini-stat-num">' + d.fuoriCasaReco + '</span><span class="gk-mini-stat-lbl">fuori casa</span></div>' +
        '</div>' +
      '</div></div>' +
      '<div class="gk-summary-card">' +
        '<p class="gk-summary-explain">&#128161; ' + d.spiegazione + '</p>' +
        '<div class="gk-breakdown">' + renderBreakdownItems(d.breakdown) + '</div>' +
        '<div class="gk-stats-row">' +
          '<div class="gk-stat-box"><div class="gk-stat-num">' + d.copertura + '/' + d.giornateTotali + '</div><div class="gk-stat-lbl">Giornate coperte</div></div>' +
          '<div class="gk-stat-box"><div class="gk-stat-num">' + d.giornateCritiche + '</div><div class="gk-stat-lbl">Giornate critiche</div></div>' +
          '<div class="gk-stat-box"><div class="gk-stat-num">' + d.tuttiFuoriCasa + '</div><div class="gk-stat-lbl">Tutti fuori casa</div></div>' +
          '<div class="gk-stat-box"><div class="gk-stat-num">' + d.confidenza + '</div><div class="gk-stat-lbl">Confidenza (' + d.confidenzaScore + '%)</div></div>' +
        '</div>' +
      '</div>';
    html += renderHeatmap(d);
    el.innerHTML = html;
  }

  function renderBreakdownItems(breakdown) {
    const labels = { facili: 'Giornate facili', medie: 'Giornate medie', difficili: 'Giornate difficili', moltoDifficili: 'Giornate molto difficili' };
    let html = '';
    Object.keys(breakdown).forEach(function (k) {
      const v = breakdown[k];
      html += '<div class="gk-breakdown-item"><div class="gk-breakdown-label">' + (labels[k] || k) + '</div>' +
        '<div class="gk-breakdown-bar"><div class="gk-breakdown-bar-fill" style="width:' + v + '%"></div></div>' +
        '<div class="gk-breakdown-val">' + v + '%</div></div>';
    });
    return html;
  }

  // ── Heatmap corretta: grid-template-columns esplicito per allineamento perfetto ──
  function renderHeatmap(d) {
    const teams = d.teams;
    const nG = d.calendario.length;
    const gridStyle = 'grid-template-columns:70px repeat(' + nG + ',34px)';
    let header = '<div class="gk-heat-header-cell gk-heat-corner"></div>';
    const rowsArr = teams.map(function (t) {
      return '<div class="gk-heatmap-row-label">' + teamBadge(t) + '<span>' + t.substring(0, 3).toUpperCase() + '</span></div>';
    });

    d.calendario.forEach(function (r) {
      header += '<div class="gk-heat-header-cell">G' + r.giornata + '</div>';
      r.squadre.forEach(function (sq, idx) {
        const isReco = (r.raccomandato === idx);
        rowsArr[idx] += '<div class="gk-heat-cell gk-heat-' + sq.livello + (isReco ? ' gk-heat-reco' : '') + '" title="' + sq.opponent + ' (' + (sq.isHome ? 'C' : 'F') + ')">' + teamBadge(sq.opponent) + '<span>' + sq.opponent.substring(0, 3).toUpperCase() + '</span></div>';
      });
    });

    return '<div class="gk-heatmap-wrap">' +
      '<div class="gk-heatmap" style="' + gridStyle + '">' + header + rowsArr.join('') + '</div>' +
      '<div class="gk-heat-legend">' +
        '<span><i style="background:linear-gradient(135deg,#4ee39a,#00c37a)"></i> Facile</span>' +
        '<span><i style="background:linear-gradient(135deg,#ffd166,#ffab00)"></i> Media</span>' +
        '<span><i style="background:linear-gradient(135deg,#ff6b6b,#e8283e)"></i> Difficile</span>' +
        '<span><i style="background:linear-gradient(135deg,#a3001e,#4a0009)"></i> Molto difficile</span>' +
        '<span>Bordo bianco = titolare consigliato quella giornata</span>' +
      '</div></div>';
  }

  // ── CONFRONTO (qualsiasi combinazione di dimensioni) ──
  function renderCompare(prefixA, prefixB, containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const teamsA = readTeamsFromPicker(prefixA).filter(function (t) { return t; });
    const teamsB = readTeamsFromPicker(prefixB).filter(function (t) { return t; });
    const distinctA = new Set(teamsA), distinctB = new Set(teamsB);
    if (teamsA.length < 2 || teamsB.length < 2 || distinctA.size !== teamsA.length || distinctB.size !== teamsB.length) {
      el.innerHTML = '<p class="gk-view-intro">Ogni gruppo deve avere almeno 2 squadre diverse tra loro.</p>';
      return;
    }
    const dA = GKPlanner.analizzaGruppo(teamsA, GKUI.fixtures, GKUI.config, GKUI.mode);
    const dB = GKPlanner.analizzaGruppo(teamsB, GKUI.fixtures, GKUI.config, GKUI.mode);
    const cmp = GKPlanner.confrontaGruppi(dA, dB);
    const winnerLabel = cmp.vincitore === 'A' ? teamsA.join('+') : (cmp.vincitore === 'B' ? teamsB.join('+') : 'Parita');
    function bar(lbl, vA, vB, maxV) {
      const wA = Math.round((vA / maxV) * 100), wB = Math.round((vB / maxV) * 100);
      return '<div class="gk-compare-bar-row"><span class="gk-compare-bar-label">' + lbl + '</span>' +
        '<div class="gk-compare-bar-track"><div class="gk-compare-bar-fill side-a" style="width:' + wA + '%"></div>' +
        '<div class="gk-compare-bar-fill side-b" style="width:' + wB + '%"></div></div></div>';
    }
    el.innerHTML = '<div class="gk-compare-result"><div class="gk-summary-card">' +
      '<p style="text-align:center;font-weight:700;color:var(--gold-bright)">&#127942; Vince: ' + winnerLabel + '</p>' +
      '<div class="gk-compare-bars">' +
        bar('Punteggio', dA.score, dB.score, 100) +
        bar('Giornate coperte', dA.copertura, dB.copertura, dA.giornateTotali) +
        bar('Giornate critiche (inv.)', dA.giornateTotali - dA.giornateCritiche, dB.giornateTotali - dB.giornateCritiche, dA.giornateTotali) +
        bar('Doppia trasferta (inv.)', dA.giornateTotali - dA.tuttiFuoriCasa, dB.giornateTotali - dB.tuttiFuoriCasa, dA.giornateTotali) +
      '</div></div></div>';
  }

  // ── IMPOSTAZIONI ──

  function renderConfig() {
    updateGkImportStatusText();
    const cfg = GKUI.config;
    const paramMeta = {
      sogliaFacile: { label: 'Soglia "facile" (diff &gt;)', min: 0, max: 9, step: 1 },
      sogliaDifficile: { label: 'Soglia "difficile" (diff &lt;)', min: -9, max: 0, step: 1 },
      sogliaMoltoDifficile: { label: 'Soglia "molto difficile" (diff &lt;=)', min: -9, max: 0, step: 1 },
      ballottaggioDelta: { label: 'Margine ballottaggio', min: 0, max: 5, step: 1 },
      puntiFacile: { label: 'Punti per giornata facile', min: 0, max: 10, step: 1 },
      puntiMedia: { label: 'Punti per giornata media', min: 0, max: 10, step: 1 },
      malusDifficile: { label: 'Malus giornata difficile', min: 0, max: 15, step: 1 },
      malusMoltoDifficile: { label: 'Malus giornata molto difficile', min: 0, max: 15, step: 1 },
      malusCriticaComune: { label: 'Malus giornata critica (tutti a rischio)', min: 0, max: 15, step: 1 }
    };
    let wHtml = '';
    Object.keys(paramMeta).forEach(function (k) {
      const meta = paramMeta[k];
      const v = cfg.params[k];
      wHtml += '<div class="gk-config-row"><label>' + meta.label + '</label><input type="range" min="' + meta.min + '" max="' + meta.max + '" step="' + meta.step + '" value="' + v + '" data-param="' + k + '"><span class="gk-config-val">' + v + '</span></div>';
    });
    document.getElementById('gk-config-weights').innerHTML = wHtml;
    document.getElementById('gk-config-home').innerHTML =
      '<div class="gk-config-row"><label>Bonus casa</label><input type="range" min="0" max="5" step="1" value="' + cfg.params.homeBonus + '" id="gk-cfg-home"><span class="gk-config-val">' + cfg.params.homeBonus + '</span></div>' +
      '<div class="gk-config-row"><label>Penalita fuori casa</label><input type="range" min="0" max="5" step="1" value="' + cfg.params.awayPenalty + '" id="gk-cfg-away"><span class="gk-config-val">' + cfg.params.awayPenalty + '</span></div>';
    let sHtml = '';
    Object.keys(cfg.teamStats).sort().forEach(function (t) {
      const s = cfg.teamStats[t];
      sHtml += '<div class="gk-strength-item gk-strength-item-dual">' +
        '<label class="gk-strength-team-label">' + teamBadge(t) + ' ' + t + '</label>' +
        '<div class="gk-strength-dual-row"><span class="gk-strength-dual-tag">&#9876;&#65039; Attacco</span>' +
          '<input type="range" min="1" max="10" step="1" value="' + s.attacco + '" data-team="' + t + '" data-stat="attacco">' +
          '<span class="gk-config-val">' + s.attacco + '</span></div>' +
        '<div class="gk-strength-dual-row"><span class="gk-strength-dual-tag">&#128737;&#65039; Difesa</span>' +
          '<input type="range" min="1" max="10" step="1" value="' + s.difesa + '" data-team="' + t + '" data-stat="difesa">' +
          '<span class="gk-config-val">' + s.difesa + '</span></div></div>';
    });
    document.getElementById('gk-config-strength').innerHTML = sHtml;
    document.querySelectorAll('#gk-config-weights input[type=range],#gk-config-home input[type=range]').forEach(function (inp) {
      inp.addEventListener('input', function () { inp.nextElementSibling.textContent = inp.value; });
    });
    document.querySelectorAll('#gk-config-strength input[type=range]').forEach(function (inp) {
      inp.addEventListener('input', function () { inp.parentElement.querySelector('.gk-config-val').textContent = inp.value; });
    });
  }
 ── Se una vista Analisi/Confronto ha gia' un risultato mostrato, la aggiorna
  //    subito con la nuova configurazione (evita di dover premere di nuovo "Analizza") ──
  function refreshOpenDetailAndCompareViews() {
    [['gk-detail', 'gk-detail-content'], ['gki-detail', 'gki-detail-content']].forEach(function (pair) {
      var contentEl = document.getElementById(pair[1]);
      if (contentEl && contentEl.innerHTML.trim()) {
        renderDetail(readTeamsFromPicker(pair[0]), pair[1]);
      }
    });
    [['gk-cmp-a', 'gk-cmp-b', 'gk-compare-content'], ['gki-cmp-a', 'gki-cmp-b', 'gki-compare-content']].forEach(function (t) {
      var contentEl = document.getElementById(t[2]);
      if (contentEl && contentEl.innerHTML.trim()) {
        renderCompare(t[0], t[1], t[2]);
      }
    });
  }

  function applyConfigFromForm() {
    const cfg = JSON.parse(JSON.stringify(GKUI.config));
    document.querySelectorAll('#gk-config-weights input[type=range]').forEach(function (inp) { cfg.params[inp.getAttribute('data-param')] = parseInt(inp.value, 10); });
    cfg.params.homeBonus = parseInt(document.getElementById('gk-cfg-home').value, 10);
    cfg.params.awayPenalty = parseInt(document.getElementById('gk-cfg-away').value, 10);
    document.querySelectorAll('#gk-config-strength input[type=range]').forEach(function (inp) {
      const team = inp.getAttribute('data-team'), stat = inp.getAttribute('data-stat');
      if (!cfg.teamStats[team]) cfg.teamStats[team] = { attacco: 5, difesa: 5 };
      cfg.teamStats[team][stat] = parseInt(inp.value, 10);
    });
    GKUI.config = GKPlanner.mergeConfig(cfg);
    saveConfig(GKUI.config);
    recompute();
    refreshOpenDetailAndCompareViews();
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

  // ── Import calendario (solo Admin) ──
  let _gkPendingCalendario = null;

  function updateGkImportStatusText() {
    const el = document.getElementById('gk-import-status-text');
    if (!el) return;
    if (GKUI.calendarioInfo && GKUI.calendarioInfo.custom) {
      const data = GKUI.calendarioInfo.caricatoIl ? new Date(GKUI.calendarioInfo.caricatoIl).toLocaleString('it-IT') : '';
      el.textContent = 'In uso: calendario reale caricato' + (data ? ' il ' + data : '') + '. Puoi sostituirlo caricando un nuovo file.';
    } else {
      el.textContent = "Attualmente in uso: calendario generato automaticamente (placeholder). Carica il calendario reale (Excel o JSON) non appena disponibile.";
    }
  }

  function normalizeParsedPartite(rows) {
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
    if (!colGiornata || !colCasa || !colOspite) return null;
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
        if (typeof toast === 'function') toast(partite.length + ' partite lette. Premi "Carica calendario" per confermare.', 'success');
      } catch (err) {
        if (typeof toast === 'function') toast('Errore: ' + err.message, 'error');
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
      if (!res.ok) { if (typeof toast === 'function') toast(out.error || 'Errore nel caricamento', 'error'); return; }
      if (typeof toast === 'function') toast('Calendario aggiornato: ' + out.totalPartite + ' partite su ' + out.giornateTotali + ' giornate', 'success');
      document.getElementById('gk-import-filename').textContent = '';
      document.getElementById('btn-gk-carica-calendario').disabled = true;
      _gkPendingCalendario = null;
      await loadFixtures(); recompute(); updateGkImportStatusText();
    } catch (err) { if (typeof toast === 'function') toast('Errore di rete: ' + err.message, 'error'); }
  }

  async function ripristinaCalendarioPlaceholder() {
    try {
      const { data: sessData } = await supa.auth.getSession();
      const token = sessData && sessData.session ? sessData.session.access_token : null;
      const res = await fetch('/api/gk-planner/calendario', { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token } });
      const out = await res.json();
      if (!res.ok) { if (typeof toast === 'function') toast(out.error || 'Errore nel ripristino', 'error'); return; }
      if (typeof toast === 'function') toast('Ripristinato il calendario placeholder', 'success');
      await loadFixtures(); recompute(); updateGkImportStatusText();
    } catch (err) { if (typeof toast === 'function') toast('Errore di rete: ' + err.message, 'error'); }
  }

  // ── Inizializzazione ──
  function initGKPlanner() {
    const btnMenu = document.getElementById('btn-menu-gk-planner');
    const btnBack = document.getElementById('btn-back-gk');
    if (btnMenu) btnMenu.addEventListener('click', function () {
      ensureData().then(function () { populateTeamSelects(); recompute(); applyModeToggleUI(); showScreen('screen-gk-planner'); switchView('ranking'); });
    });
    if (btnBack) btnBack.addEventListener('click', function () { showScreen('screen-menu-principale'); });

    const btnHelp = document.getElementById('btn-gk-help');
    if (btnHelp) btnHelp.addEventListener('click', function () { openModal('modal-gk-help'); });

    document.querySelectorAll('#gk-tabs .gk-tab').forEach(function (tab) {
      tab.addEventListener('click', function () { switchView(tab.getAttribute('data-gk-view')); });
    });

    // Toggle globale Portieri/Attaccanti
    document.querySelectorAll('.gk-mode-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { setMode(btn.getAttribute('data-gk-mode')); });
    });

    // Sub-tab Ranking: Coppie / Terzetti
    document.querySelectorAll('.gk-ranking-subtabs').forEach(function (nav) {
      const listId = nav.getAttribute('data-rank-list');
      nav.querySelectorAll('.gk-subtab').forEach(function (btn) {
        btn.addEventListener('click', function () {
          nav.querySelectorAll('.gk-subtab').forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          renderRanking(listId, parseInt(btn.getAttribute('data-ranksub'), 10));
        });
      });
    });

    // Cambio badge su ogni select
    document.addEventListener('change', function (e) {
      if (e.target && e.target.classList && e.target.classList.contains('gk-team-select')) {
        updateTeamCardBadgeFromSelect(e.target);
      }
    });

    // Slot opzionale 3a squadra
    wireAdd3('btn-gk-detail-add3',  'btn-gk-detail-remove3',  'gk-detail-teamC-wrap');
    wireAdd3('btn-gki-detail-add3', 'btn-gki-detail-remove3', 'gki-detail-teamC-wrap');
    wireAdd3('btn-gk-cmp-a-add3',   'btn-gk-cmp-a-remove3',   'gk-cmp-a-teamC-wrap');
    wireAdd3('btn-gk-cmp-b-add3',   'btn-gk-cmp-b-remove3',   'gk-cmp-b-teamC-wrap');
    wireAdd3('btn-gki-cmp-a-add3',  'btn-gki-cmp-a-remove3',  'gki-cmp-a-teamC-wrap');
    wireAdd3('btn-gki-cmp-b-add3',  'btn-gki-cmp-b-remove3',  'gki-cmp-b-teamC-wrap');

    const btnAnalizza = document.getElementById('btn-gk-analizza');
    if (btnAnalizza) btnAnalizza.addEventListener('click', function () { renderDetail(readTeamsFromPicker('gk-detail'), 'gk-detail-content'); });

    const btnConfronta = document.getElementById('btn-gk-confronta');
    if (btnConfronta) btnConfronta.addEventListener('click', function () { renderCompare('gk-cmp-a', 'gk-cmp-b', 'gk-compare-content'); });

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

    // ── Tab inline "Portieri/Attaccanti" nella schermata Asta ──
    const btnPortieriTab = document.querySelector('.tab-btn[data-tab="tab-portieri"]');
    if (btnPortieriTab) btnPortieriTab.addEventListener('click', function () {
      ensureData().then(function () { populateTeamSelects(); recompute(); applyModeToggleUI(); renderRanking('gki-ranking-list', 2); });
    });

    const btnGkiAnalizza = document.getElementById('btn-gki-analizza');
    if (btnGkiAnalizza) btnGkiAnalizza.addEventListener('click', function () { renderDetail(readTeamsFromPicker('gki-detail'), 'gki-detail-content'); });

    const btnGkiConfronta = document.getElementById('btn-gki-confronta');
    if (btnGkiConfronta) btnGkiConfronta.addEventListener('click', function () { renderCompare('gki-cmp-a', 'gki-cmp-b', 'gki-compare-content'); });

    // Sub-tab interne della tab Asta (Ranking/Analisi/Confronto)
    document.querySelectorAll('.gki-subtabs .gki-subtab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const target = btn.getAttribute('data-gki-view');
        document.querySelectorAll('.gki-subtabs .gki-subtab').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        document.querySelectorAll('#tab-portieri .gki-view').forEach(function (v) { v.classList.toggle('active', v.id === 'gki-view-' + target); });
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGKPlanner);
  } else {
    initGKPlanner();
  }
})();
