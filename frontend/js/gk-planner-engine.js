// ══════════════════════════════════════════════════════════════════
// GRIGLIA PORTIERI/ATTACCANTI — motore di analisi (logica pura, senza DOM)
// Modulo indipendente e riusabile: analizza le 38 giornate di Serie A
// per trovare le migliori combinazioni (2 o 3 giocatori) di portieri
// o attaccanti. Algoritmo proprietario di FantaSbocchini.
//
// Punto di ingresso globale: window.GKPlanner
// ══════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  // ── Statistiche di default per squadra: Attacco e Difesa separati ──
  // Valori aggiornati (scala interna 30-99, corrispondente a slider utente 1-10)
  const DEFAULT_TEAM_STATS = {
    Atalanta:   { attacco: 84, difesa: 84 }, Bologna:   { attacco: 84, difesa: 76 },
    Cagliari:   { attacco: 61, difesa: 61 }, Como:      { attacco: 99, difesa: 91 },
    Fiorentina: { attacco: 68, difesa: 68 }, Frosinone: { attacco: 61, difesa: 53 },
    Genoa:      { attacco: 84, difesa: 68 }, Inter:     { attacco: 99, difesa: 99 },
    Juventus:   { attacco: 91, difesa: 91 }, Lazio:     { attacco: 76, difesa: 84 },
    Lecce:      { attacco: 53, difesa: 61 }, Milan:     { attacco: 91, difesa: 91 },
    Monza:      { attacco: 53, difesa: 53 }, Napoli:    { attacco: 91, difesa: 91 },
    Parma:      { attacco: 53, difesa: 61 }, Roma:      { attacco: 91, difesa: 99 },
    Sassuolo:   { attacco: 68, difesa: 61 }, Torino:    { attacco: 61, difesa: 53 },
    Udinese:    { attacco: 68, difesa: 68 }, Venezia:   { attacco: 61, difesa: 53 }
  };

  const DEFAULT_WEIGHTS = {
    coverage: 38,       // % di giornate con almeno un titolare in una partita favorevole
    difficoltaMedia: 22,// media della difficoltà minima per giornata (invertita: più bassa = meglio)
    alternanza: 10,     // quanto si alternano bene casa/fuori i giocatori del gruppo
    giornateCritiche: 30// penalità per giornate in cui TUTTI hanno partite difficili
  };

  const DEFAULT_CONFIG = {
    teamStats: JSON.parse(JSON.stringify(DEFAULT_TEAM_STATS)),
    weights: Object.assign({}, DEFAULT_WEIGHTS),
    homeAdvantage: 8,   // bonus (riduzione difficoltà) per chi gioca in casa
    awayPenalty: 8,     // penalità (aumento difficoltà) per chi gioca in trasferta
    ownStrengthFactor: 0.25, // quanto la propria statistica riduce la difficoltà
    sogliaFacile: 62,   // difficoltà <= questa soglia => partita "facile/favorevole"
    sogliaDifficile: 80 // difficoltà > questa soglia => partita "difficile/rischiosa"
  };

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function round1(v) { return Math.round(v * 10) / 10; }

  // ── Normalizza la configurazione utente, con retrocompatibilità per il
  //    vecchio formato "teamStrength" (valore unico per squadra) ──
  function mergeConfig(userConfig) {
    const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    if (!userConfig) return cfg;
    if (userConfig.teamStrength && !userConfig.teamStats) {
      const migrated = {};
      Object.keys(userConfig.teamStrength).forEach(function (t) {
        migrated[t] = { attacco: userConfig.teamStrength[t], difesa: userConfig.teamStrength[t] };
      });
      userConfig = Object.assign({}, userConfig, { teamStats: migrated });
    }
    if (userConfig.teamStats) {
      Object.keys(userConfig.teamStats).forEach(function (t) {
        if (!cfg.teamStats[t]) cfg.teamStats[t] = { attacco: 55, difesa: 55 };
        Object.assign(cfg.teamStats[t], userConfig.teamStats[t]);
      });
    }
    if (userConfig.weights) Object.assign(cfg.weights, userConfig.weights);
    delete cfg.weights.fuoriCasaDoppio; // rimosso: fattore ridondante con "alternanza" (retrocompatibilita' config vecchie)
    ['homeAdvantage', 'awayPenalty', 'ownStrengthFactor', 'sogliaFacile', 'sogliaDifficile'].forEach(function (k) {
      if (typeof userConfig[k] === 'number') cfg[k] = userConfig[k];
    });
    return cfg;
  }

  // ── Ricerca case-insensitive di una squadra in teamStats: evita che nomi con
  //    maiuscole/minuscole diverse nel calendario (es. "como" vs "Como") vengano
  //    ignorati silenziosamente dal motore di calcolo. ──
  function findTeamStat(team, cfg) {
    if (cfg.teamStats[team]) return cfg.teamStats[team];
    const lower = String(team).toLowerCase();
    const key = Object.keys(cfg.teamStats).find(function (k) { return k.toLowerCase() === lower; });
    return key ? cfg.teamStats[key] : null;
  }

  function getStat(team, stat, cfg) {
    const s = findTeamStat(team, cfg);
    if (!s) return 55;
    return (stat === 'attacco') ? s.attacco : s.difesa;
  }

  // ── Difficoltà di una singola partita per il giocatore di "team", nel modo scelto ──
  // mode 'portieri'    -> difficolta = f(Attacco_avversario, Difesa_propria)
  // mode 'attaccanti'  -> difficolta = f(Difesa_avversario, Attacco_proprio)
  // 0 = partita facilissima, 100 = partita durissima.
  function difficoltaPartita(team, opponent, isHome, cfg, mode) {
    const m = mode === 'attaccanti' ? 'attaccanti' : 'portieri';
    const oppStat = (m === 'attaccanti') ? getStat(opponent, 'difesa', cfg) : getStat(opponent, 'attacco', cfg);
    const ownStat = (m === 'attaccanti') ? getStat(team, 'attacco', cfg) : getStat(team, 'difesa', cfg);
    const homeAdj = isHome ? -cfg.homeAdvantage : cfg.awayPenalty;
    const raw = (oppStat * 0.7) - (ownStat * cfg.ownStrengthFactor) + homeAdj + 15;
    return clamp(round1(raw), 0, 100);
  }

  function livelloDifficolta(diff, cfg) {
    if (diff <= cfg.sogliaFacile) return 'facile';
    if (diff > cfg.sogliaDifficile) return 'difficile';
    return 'media';
  }

  // ── Calendario di una squadra: 38 righe {giornata, opponent, isHome, difficolta, livello} ──
  function sameTeam(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }

  function calendarioSquadra(team, fixtures, cfg, mode) {
    const out = [];
    fixtures.forEach(function (f) {
      let opponent = null, isHome = null;
      if (sameTeam(f.casa, team)) { opponent = f.ospite; isHome = true; }
      else if (sameTeam(f.ospite, team)) { opponent = f.casa; isHome = false; }
      if (opponent === null) return;
      const diff = difficoltaPartita(team, opponent, isHome, cfg, mode);
      out.push({
        giornata: f.giornata, opponent: opponent, isHome: isHome,
        difficolta: diff, livello: livelloDifficolta(diff, cfg)
      });
    });
    out.sort(function (a, b) { return a.giornata - b.giornata; });
    return out;
  }

  // ── Analisi completa di un gruppo di 2 o 3 squadre ──
  function analizzaGruppo(teams, fixtures, config, mode) {
    const cfg = mergeConfig(config);
    const m = mode === 'attaccanti' ? 'attaccanti' : 'portieri';
    const calendari = teams.map(function (t) { return calendarioSquadra(t, fixtures, cfg, m); });
    const totale = Math.max.apply(null, calendari.map(function (c) { return c.length; })) || 38;

    const righe = [];
    let coperte = 0, critiche = 0, tuttiFuori = 0;
    let sommaMinDifficolta = 0, sbilanciamentoCasa = 0;
    let facili = 0, medie = 0, difficili = 0, inCasaReco = 0, fuoriCasaReco = 0;
    const recoConteggio = teams.map(function () { return 0; });

    for (let i = 0; i < totale; i++) {
      const partite = calendari.map(function (c) { return c[i]; });
      if (partite.some(function (p) { return !p; })) continue;

      const difficolte = partite.map(function (p) { return p.difficolta; });
      const minDiff = Math.min.apply(null, difficolte);
      sommaMinDifficolta += minDiff;
      if (minDiff <= cfg.sogliaFacile) coperte++;

      const tutteDifficili = partite.every(function (p) { return p.livello === 'difficile'; });
      if (tutteDifficili) critiche++;

      const tutteFuori = partite.every(function (p) { return !p.isHome; });
      if (tutteFuori) tuttiFuori++;

      // Trova il migliore (indice) e verifica ballottaggio (differenza minima <=6 col secondo migliore)
      let bestIdx = 0;
      for (let k = 1; k < difficolte.length; k++) if (difficolte[k] < difficolte[bestIdx]) bestIdx = k;
      const ordinati = difficolte.slice().sort(function (a, b) { return a - b; });
      const delta = (ordinati.length > 1) ? (ordinati[1] - ordinati[0]) : 99;
      const raccomandato = (delta <= 6) ? 'ballottaggio' : bestIdx;

      if (typeof raccomandato === 'number') recoConteggio[raccomandato]++;

      const scelta = (typeof raccomandato === 'number') ? partite[raccomandato] : partite[bestIdx];
      if (scelta.livello === 'facile') facili++;
      else if (scelta.livello === 'difficile') difficili++;
      else medie++;
      if (scelta.isHome) inCasaReco++; else fuoriCasaReco++;

      // Alternanza: buona se non tutti i giocatori del gruppo giocano nella stessa condizione (tutti in casa o tutti fuori)
      const tuttiCasa = partite.every(function (p) { return p.isHome; });
      if (!tuttiCasa && !tutteFuori) sbilanciamentoCasa++;

      righe.push({
        giornata: partite[0].giornata,
        squadre: teams.map(function (t, idx) {
          return { team: t, opponent: partite[idx].opponent, isHome: partite[idx].isHome, difficolta: partite[idx].difficolta, livello: partite[idx].livello };
        }),
        raccomandato: raccomandato, // indice numerico oppure 'ballottaggio'
        criticaDoppia: tutteDifficili,
        tuttiFuoriCasa: tutteFuori
      });
    }

    const n = righe.length || 1;
    const coveragePct = (coperte / n) * 100;
    const difficoltaMediaScore = 100 - clamp((sommaMinDifficolta / n), 0, 100);
    const alternanzaPct = (sbilanciamentoCasa / n) * 100;
    const critichePenalty = 100 - clamp((critiche / n) * 100 * 3, 0, 100);

    const breakdown = {
      coverage: round1(coveragePct),
      difficoltaMedia: round1(difficoltaMediaScore),
      alternanza: round1(alternanzaPct),
      giornateCritiche: round1(critichePenalty)
    };

    const w = cfg.weights;
    const pesoTotale = w.coverage + w.difficoltaMedia + w.alternanza + w.giornateCritiche;
    const scoreRaw = (
      breakdown.coverage * w.coverage +
      breakdown.difficoltaMedia * w.difficoltaMedia +
      breakdown.alternanza * w.alternanza +
      breakdown.giornateCritiche * w.giornateCritiche
    ) / (pesoTotale * 100);
    const score = round1(scoreRaw * 100);

    let livello;
    if (score >= 85) livello = 'Ottimo';
    else if (score >= 70) livello = 'Buono';
    else if (score >= 55) livello = 'Discreto';
    else livello = 'Rischioso';

    let varSum = 0;
    righe.forEach(function (r) {
      const minD = Math.min.apply(null, r.squadre.map(function (s) { return s.difficolta; }));
      varSum += Math.pow(minD - (sommaMinDifficolta / n), 2);
    });
    const stdDev = Math.sqrt(varSum / n);
    const confidenzaScore = clamp(100 - stdDev * 2.2, 30, 99);
    let confidenza;
    if (confidenzaScore >= 75) confidenza = 'Alta';
    else if (confidenzaScore >= 55) confidenza = 'Media';
    else confidenza = 'Bassa';

    const nomiGruppo = teams.join(' + ');
    const spiegazione = 'Questo gruppo (' + nomiGruppo + ') garantisce una partita favorevole in ' + coperte + ' delle ' + n +
      ' giornate' + (critiche > 0 ? ', con ' + critiche + ' giornata' + (critiche > 1 ? 'e' : '') + ' critica' + (critiche > 1 ? 'he' : '') + ' in cui tutti affrontano un avversario forte' : ', senza alcuna giornata in cui tutti rischiano contemporaneamente') +
      (tuttiFuori > 0 ? ', e coincide con tutti in trasferta in ' + tuttiFuori + ' occasion' + (tuttiFuori > 1 ? 'i' : 'e') + '.' : ', e non capita mai che tutti giochino in trasferta nella stessa giornata.');

    return {
      teams: teams, score: score, livello: livello, confidenza: confidenza,
      confidenzaScore: round1(confidenzaScore),
      breakdown: breakdown, weights: w,
      copertura: coperte, giornateTotali: n, giornateCritiche: critiche, tuttiFuoriCasa: tuttiFuori,
      recoConteggio: recoConteggio,
      facili: facili, medie: medie, difficili: difficili,
      inCasaReco: inCasaReco, fuoriCasaReco: fuoriCasaReco,
      spiegazione: spiegazione,
      calendario: righe,
      mode: m
    };
  }

  // ── Retrocompatibilità: analisi di una coppia (wrapper di analizzaGruppo) ──
  function analizzaCoppia(teamA, teamB, fixtures, config, mode) {
    return analizzaGruppo([teamA, teamB], fixtures, config, mode);
  }

  function combinazioni(arr, k) {
    const risultati = [];
    function ricorsivo(start, combo) {
      if (combo.length === k) { risultati.push(combo.slice()); return; }
      for (let i = start; i < arr.length; i++) {
        combo.push(arr[i]);
        ricorsivo(i + 1, combo);
        combo.pop();
      }
    }
    ricorsivo(0, []);
    return risultati;
  }

  // ── Ranking di tutti i gruppi possibili di dimensione groupSize (2 o 3) ──
  function rankingGruppi(fixtures, config, groupSize, mode, teamsSubset) {
    const cfg = mergeConfig(config);
    const teams = teamsSubset && teamsSubset.length ? teamsSubset : Object.keys(cfg.teamStats);
    const size = (groupSize === 3) ? 3 : 2;
    const gruppi = combinazioni(teams, size);
    const risultati = gruppi.map(function (g) { return analizzaGruppo(g, fixtures, cfg, mode); });
    risultati.sort(function (a, b) { return b.score - a.score; });
    return risultati;
  }

  // ── Retrocompatibilità: ranking di coppie ──
  function rankingCoppie(fixtures, config, teamsSubset, mode) {
    return rankingGruppi(fixtures, config, 2, mode, teamsSubset);
  }

  // ── Confronto diretto fra due gruppi già analizzati (dimensioni anche diverse) ──
  function confrontaGruppi(analisiA, analisiB) {
    const diffScore = round1(analisiA.score - analisiB.score);
    const diffCopertura = analisiA.copertura - analisiB.copertura;
    const diffCritiche = analisiA.giornateCritiche - analisiB.giornateCritiche;
    const diffFuoriCasa = analisiA.tuttiFuoriCasa - analisiB.tuttiFuoriCasa;
    const vincitore = analisiA.score === analisiB.score ? null : (analisiA.score > analisiB.score ? 'A' : 'B');
    return {
      vincitore: vincitore, diffScore: diffScore, diffCopertura: diffCopertura,
      diffCritiche: diffCritiche, diffFuoriCasa: diffFuoriCasa
    };
  }

  function confrontaCoppie(analisiA, analisiB) { return confrontaGruppi(analisiA, analisiB); }

  global.GKPlanner = {
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    mergeConfig: mergeConfig,
    difficoltaPartita: difficoltaPartita,
    livelloDifficolta: livelloDifficolta,
    calendarioSquadra: calendarioSquadra,
    analizzaGruppo: analizzaGruppo,
    analizzaCoppia: analizzaCoppia,
    rankingGruppi: rankingGruppi,
    rankingCoppie: rankingCoppie,
    confrontaGruppi: confrontaGruppi,
    confrontaCoppie: confrontaCoppie
  };
})(typeof window !== 'undefined' ? window : global);
