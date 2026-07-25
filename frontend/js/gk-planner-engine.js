// ══════════════════════════════════════════════════════════════════
// GOALKEEPER PLANNER — motore di analisi (logica pura, senza DOM)
// Modulo indipendente e riusabile: analizza le 38 giornate di Serie A
// per trovare le migliori coppie di portieri (titolare + "scudo").
// Algoritmo proprietario di FantaSbocchini — nessun codice o formula
// di terze parti è stato copiato; solo il concetto ("griglia portieri
// a coppie con calendario e heatmap") è preso come riferimento di UX.
//
// Punto di ingresso globale: window.GKPlanner
// ══════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  // ── Configurazione di default (tutto è modificabile dall'utente) ──
  const DEFAULT_TEAM_STRENGTH = {
    Inter: 92, Napoli: 90, Juventus: 87, Milan: 85, Atalanta: 82, Roma: 78,
    Lazio: 76, Fiorentina: 74, Bologna: 72, Torino: 62, Udinese: 58, Genoa: 56,
    Cagliari: 54, Sassuolo: 52, Lecce: 50, Monza: 44, Parma: 48, Como: 46,
    Venezia: 42, Frosinone: 40
  };

  const DEFAULT_WEIGHTS = {
    coverage: 35,       // % di giornate con almeno un portiere in una partita favorevole
    difficoltaMedia: 25,// media della difficoltà minima per giornata (invertita: più bassa = meglio)
    alternanza: 15,     // quanto si alternano bene casa/fuori tra i due portieri
    giornateCritiche: 15,// penalità per giornate in cui ENTRAMBI hanno partite difficili
    fuoriCasaDoppio: 10  // penalità per giornate in cui ENTRAMBI giocano in trasferta
  };

  const DEFAULT_CONFIG = {
    teamStrength: Object.assign({}, DEFAULT_TEAM_STRENGTH),
    weights: Object.assign({}, DEFAULT_WEIGHTS),
    homeAdvantage: 8,   // bonus (riduzione difficoltà) per chi gioca in casa
    awayPenalty: 6,     // penalità (aumento difficoltà) per chi gioca in trasferta
    ownStrengthFactor: 0.3, // quanto la forza della propria squadra riduce la difficoltà
    sogliaFacile: 35,   // difficoltà <= questa soglia => partita "facile/favorevole"
    sogliaDifficile: 60 // difficoltà > questa soglia => partita "difficile/rischiosa"
  };

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function round1(v) { return Math.round(v * 10) / 10; }

  function mergeConfig(userConfig) {
    const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    if (!userConfig) return cfg;
    if (userConfig.teamStrength) Object.assign(cfg.teamStrength, userConfig.teamStrength);
    if (userConfig.weights) Object.assign(cfg.weights, userConfig.weights);
    ['homeAdvantage', 'awayPenalty', 'ownStrengthFactor', 'sogliaFacile', 'sogliaDifficile'].forEach(function (k) {
      if (typeof userConfig[k] === 'number') cfg[k] = userConfig[k];
    });
    return cfg;
  }

  // ── Difficoltà di una singola partita per il portiere di "team" ──
  // 0 = partita facilissima, 100 = partita durissima.
  function difficoltaPartita(team, opponent, isHome, cfg) {
    const oppStrength = (cfg.teamStrength[opponent] != null) ? cfg.teamStrength[opponent] : 55;
    const ownStrength = (cfg.teamStrength[team] != null) ? cfg.teamStrength[team] : 55;
    const homeAdj = isHome ? -cfg.homeAdvantage : cfg.awayPenalty;
    const raw = (oppStrength * 0.7) - (ownStrength * cfg.ownStrengthFactor) + homeAdj + 15;
    return clamp(round1(raw), 0, 100);
  }

  function livelloDifficolta(diff, cfg) {
    if (diff <= cfg.sogliaFacile) return 'facile';
    if (diff > cfg.sogliaDifficile) return 'difficile';
    return 'media';
  }

  // ── Calendario di una squadra: 38 righe {giornata, opponent, isHome, difficolta, livello} ──
  function calendarioSquadra(team, fixtures, cfg) {
    const out = [];
    fixtures.forEach(function (f) {
      let opponent = null, isHome = null;
      if (f.casa === team) { opponent = f.ospite; isHome = true; }
      else if (f.ospite === team) { opponent = f.casa; isHome = false; }
      if (opponent === null) return;
      const diff = difficoltaPartita(team, opponent, isHome, cfg);
      out.push({
        giornata: f.giornata, opponent: opponent, isHome: isHome,
        difficolta: diff, livello: livelloDifficolta(diff, cfg)
      });
    });
    out.sort(function (a, b) { return a.giornata - b.giornata; });
    return out;
  }

  // ── Analisi completa di una coppia di squadre (portiere A + portiere B) ──
  function analizzaCoppia(teamA, teamB, fixtures, config) {
    const cfg = mergeConfig(config);
    const calA = calendarioSquadra(teamA, fixtures, cfg);
    const calB = calendarioSquadra(teamB, fixtures, cfg);
    const totale = Math.max(calA.length, calB.length) || 38;

    const righe = [];
    let coperte = 0, critiche = 0, entrambiFuori = 0, favorevoliA = 0, favorevoliB = 0;
    let sommaMinDifficolta = 0;
    let sbilanciamentoCasa = 0;
    let facili = 0, medie = 0, difficili = 0, inCasaReco = 0, fuoriCasaReco = 0;

    for (let i = 0; i < totale; i++) {
      const ga = calA[i], gb = calB[i];
      if (!ga || !gb) continue;
      const minDiff = Math.min(ga.difficolta, gb.difficolta);
      sommaMinDifficolta += minDiff;
      const favorevole = minDiff <= cfg.sogliaFacile;
      if (favorevole) coperte++;
      const entrambiDifficili = (ga.livello === 'difficile' && gb.livello === 'difficile');
      if (entrambiDifficili) critiche++;
      if (!ga.isHome && !gb.isHome) entrambiFuori++;

      // Portiere raccomandato: chi ha la partita più facile quella giornata.
      // Se la differenza è minima (<=6 punti) è un vero e proprio ballottaggio.
      const delta = Math.abs(ga.difficolta - gb.difficolta);
      let raccomandato;
      if (delta <= 6) raccomandato = 'ballottaggio';
      else raccomandato = (ga.difficolta < gb.difficolta) ? 'A' : 'B';
      if (raccomandato === 'A') favorevoliA++;
      if (raccomandato === 'B') favorevoliB++;

      // Statistiche sul portiere effettivamente consigliato quella giornata
      // (in caso di ballottaggio si considera quello con la partita più semplice)
      const scelta = (raccomandato === 'B') ? gb : ga;
      if (scelta.livello === 'facile') facili++;
      else if (scelta.livello === 'difficile') difficili++;
      else medie++;
      if (scelta.isHome) inCasaReco++;
      else fuoriCasaReco++;

      if (ga.isHome !== gb.isHome) sbilanciamentoCasa++; // buona alternanza casa/fuori

      righe.push({
        giornata: ga.giornata,
        A: { opponent: ga.opponent, isHome: ga.isHome, difficolta: ga.difficolta, livello: ga.livello },
        B: { opponent: gb.opponent, isHome: gb.isHome, difficolta: gb.difficolta, livello: gb.livello },
        raccomandato: raccomandato,
        criticaDoppia: entrambiDifficili,
        entrambiFuori: !ga.isHome && !gb.isHome
      });
    }

    const n = righe.length || 1;
    const coveragePct = (coperte / n) * 100;
    const difficoltaMediaScore = 100 - clamp((sommaMinDifficolta / n), 0, 100); // più bassa la difficoltà media, più alto il punteggio
    const alternanzaPct = (sbilanciamentoCasa / n) * 100;
    const critichePenalty = 100 - clamp((critiche / n) * 100 * 3, 0, 100); // penalizza forte le coincidenze critiche
    const fuoriCasaPenalty = 100 - clamp((entrambiFuori / n) * 100 * 2, 0, 100);

    const breakdown = {
      coverage: round1(coveragePct),
      difficoltaMedia: round1(difficoltaMediaScore),
      alternanza: round1(alternanzaPct),
      giornateCritiche: round1(critichePenalty),
      fuoriCasaDoppio: round1(fuoriCasaPenalty)
    };

    const w = cfg.weights;
    const pesoTotale = w.coverage + w.difficoltaMedia + w.alternanza + w.giornateCritiche + w.fuoriCasaDoppio;
    const scoreRaw = (
      breakdown.coverage * w.coverage +
      breakdown.difficoltaMedia * w.difficoltaMedia +
      breakdown.alternanza * w.alternanza +
      breakdown.giornateCritiche * w.giornateCritiche +
      breakdown.fuoriCasaDoppio * w.fuoriCasaDoppio
    ) / (pesoTotale * 100);
    const score = round1(scoreRaw * 100);

    let livello;
    if (score >= 85) livello = 'Ottimo';
    else if (score >= 70) livello = 'Buono';
    else if (score >= 55) livello = 'Discreto';
    else livello = 'Rischioso';

    // Confidenza: basata sulla dispersione della difficoltà minima per giornata
    // (calendario più "leggibile" e stabile => confidenza più alta)
    let varSum = 0;
    righe.forEach(function (r) {
      const minD = Math.min(r.A.difficolta, r.B.difficolta);
      varSum += Math.pow(minD - (sommaMinDifficolta / n), 2);
    });
    const stdDev = Math.sqrt(varSum / n);
    const confidenzaScore = clamp(100 - stdDev * 2.2, 30, 99);
    let confidenza;
    if (confidenzaScore >= 75) confidenza = 'Alta';
    else if (confidenzaScore >= 55) confidenza = 'Media';
    else confidenza = 'Bassa';

    const spiegazione = 'Questa coppia garantisce una partita favorevole in ' + coperte + ' delle ' + n +
      ' giornate' + (critiche > 0 ? ', con ' + critiche + ' giornata' + (critiche > 1 ? 'e' : '') + ' critica' + (critiche > 1 ? 'he' : '') + ' in cui entrambi affrontano un avversario forte' : ', senza alcuna giornata in cui entrambi rischiano contemporaneamente') +
      (entrambiFuori > 0 ? ', e coincide con entrambi in trasferta in ' + entrambiFuori + ' occasion' + (entrambiFuori > 1 ? 'i' : 'e') + '.' : ', e non capita mai che entrambi giochino in trasferta nella stessa giornata.');

    return {
      teamA: teamA, teamB: teamB, score: score, livello: livello, confidenza: confidenza,
      confidenzaScore: round1(confidenzaScore),
      breakdown: breakdown, weights: w,
      copertura: coperte, giornateTotali: n, giornateCritiche: critiche, entrambiFuoriCasa: entrambiFuori,
      favorevoliA: favorevoliA, favorevoliB: favorevoliB,
      facili: facili, medie: medie, difficili: difficili,
      inCasaReco: inCasaReco, fuoriCasaReco: fuoriCasaReco,
      spiegazione: spiegazione,
      calendario: righe
    };
  }

  // ── Ranking di tutte le coppie possibili (o di un sottoinsieme di squadre) ──
  function rankingCoppie(fixtures, config, teamsSubset) {
    const cfg = mergeConfig(config);
    const teams = teamsSubset && teamsSubset.length ? teamsSubset : Object.keys(cfg.teamStrength);
    const risultati = [];
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        const analisi = analizzaCoppia(teams[i], teams[j], fixtures, cfg);
        risultati.push(analisi);
      }
    }
    risultati.sort(function (a, b) { return b.score - a.score; });
    return risultati;
  }

  // ── Confronto diretto fra due coppie già analizzate ──
  function confrontaCoppie(analisiA, analisiB) {
    const diffScore = round1(analisiA.score - analisiB.score);
    const diffCopertura = analisiA.copertura - analisiB.copertura;
    const diffCritiche = analisiA.giornateCritiche - analisiB.giornateCritiche;
    const diffFuoriCasa = analisiA.entrambiFuoriCasa - analisiB.entrambiFuoriCasa;
    const vincitore = analisiA.score === analisiB.score ? null : (analisiA.score > analisiB.score ? 'A' : 'B');
    return {
      vincitore: vincitore, diffScore: diffScore, diffCopertura: diffCopertura,
      diffCritiche: diffCritiche, diffFuoriCasa: diffFuoriCasa
    };
  }

  // ── Vista per giornata: le 20 squadre ordinate dalla partita più facile alla più difficile ──
  function vistaGiornata(giornata, fixtures, config) {
    const cfg = mergeConfig(config);
    const teams = Object.keys(cfg.teamStrength);
    const righe = [];
    fixtures.filter(function (f) { return f.giornata === giornata; }).forEach(function (f) {
      const diffCasa = difficoltaPartita(f.casa, f.ospite, true, cfg);
      const diffOspite = difficoltaPartita(f.ospite, f.casa, false, cfg);
      righe.push({ team: f.casa, opponent: f.ospite, isHome: true, difficolta: diffCasa, livello: livelloDifficolta(diffCasa, cfg) });
      righe.push({ team: f.ospite, opponent: f.casa, isHome: false, difficolta: diffOspite, livello: livelloDifficolta(diffOspite, cfg) });
    });
    righe.sort(function (a, b) { return a.difficolta - b.difficolta; });
    return righe;
  }

  global.GKPlanner = {
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    mergeConfig: mergeConfig,
    difficoltaPartita: difficoltaPartita,
    livelloDifficolta: livelloDifficolta,
    calendarioSquadra: calendarioSquadra,
    analizzaCoppia: analizzaCoppia,
    rankingCoppie: rankingCoppie,
    confrontaCoppie: confrontaCoppie,
    vistaGiornata: vistaGiornata
  };
})(typeof window !== 'undefined' ? window : global);
