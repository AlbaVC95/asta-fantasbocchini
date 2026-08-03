// ══════════════════════════════════════════════════════════════════
// GRIGLIA PORTIERI/ATTACCANTI — motore di analisi (logica pura, senza DOM)
// Modulo indipendente e riusabile: analizza le 38 giornate di Serie A
// per trovare le migliori combinazioni (2 o 3 giocatori) di portieri
// o attaccanti. Algoritmo proprietario di FantaSbocchini.
//
// v2 — Algoritmo proprio (non piu' basato su FantaLab): ogni squadra ha
// due valori indipendenti Attacco/Difesa in scala 1-10. La difficolta'
// di una partita si calcola come differenza diretta fra la propria
// statistica e quella dell'avversario, con bonus/malus campo. Le
// giornate vengono classificate in facile / media / difficile /
// molto difficile, e il punteggio finale di un gruppo (2 o 3 squadre)
// premia le giornate favorevoli e penalizza quelle rischiose, incluse
// le giornate "critiche" in cui TUTTI i membri del gruppo affrontano
// contemporaneamente una partita difficile o molto difficile.
//
// Il punteggio finale viene normalizzato in scala 1-100 con un min-max
// calcolato sull'intero universo delle combinazioni possibili (stesso
// groupSize + mode), cosi' la Griglia usa sempre tutta la gamma di
// colori disponibile, indipendentemente dai pesi configurati.
//
// Punto di ingresso globale: window.GKPlanner
// ══════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  // ── Statistiche di default per squadra: Attacco e Difesa separati ──
  // Scala 1-10 diretta (nessuna conversione interna). Valori derivati
  // dai default storici di FantaLab (unico riferimento mantenuto).
  const DEFAULT_TEAM_STATS = {
    Atalanta:   { attacco: 8,  difesa: 8  }, Bologna:   { attacco: 8,  difesa: 7  },
    Cagliari:   { attacco: 5,  difesa: 5  }, Como:      { attacco: 10, difesa: 9  },
    Fiorentina: { attacco: 6,  difesa: 6  }, Frosinone: { attacco: 5,  difesa: 4  },
    Genoa:      { attacco: 8,  difesa: 6  }, Inter:     { attacco: 10, difesa: 10 },
    Juventus:   { attacco: 9,  difesa: 9  }, Lazio:     { attacco: 7,  difesa: 8  },
    Lecce:      { attacco: 4,  difesa: 5  }, Milan:     { attacco: 9,  difesa: 9  },
    Monza:      { attacco: 4,  difesa: 4  }, Napoli:    { attacco: 9,  difesa: 9  },
    Parma:      { attacco: 4,  difesa: 5  }, Roma:      { attacco: 9,  difesa: 10 },
    Sassuolo:   { attacco: 6,  difesa: 5  }, Torino:    { attacco: 5,  difesa: 4  },
    Udinese:    { attacco: 6,  difesa: 6  }, Venezia:   { attacco: 5,  difesa: 4  }
  };

  // ── Parametri configurabili del nuovo algoritmo ──
  const DEFAULT_PARAMS = {
    sogliaFacile: 3,           // diff > questa soglia => "facile"
    sogliaDifficile: -3,       // diff < questa soglia (e non molto difficile) => "difficile"
    sogliaMoltoDifficile: -6,  // diff <= questa soglia => "molto difficile"
    homeBonus: 1,              // bonus diff per chi gioca in casa
    awayPenalty: 1,            // malus diff per chi gioca in trasferta
    puntiFacile: 3,            // punti guadagnati per ogni giornata "facile" del gruppo
    puntiMedia: 1,             // punti guadagnati per ogni giornata "media" del gruppo
    malusDifficile: 4,         // punti persi per ogni giornata "difficile" del gruppo
    malusMoltoDifficile: 7,    // punti persi per ogni giornata "molto difficile" del gruppo
    malusCriticaComune: 5,     // punti persi extra se TUTTI i membri hanno partita difficile/molto difficile la stessa giornata
    ballottaggioDelta: 1       // differenza massima fra i due migliori per considerarla "ballottaggio"
  };

  const DEFAULT_CONFIG = {
    teamStats: JSON.parse(JSON.stringify(DEFAULT_TEAM_STATS)),
    params: Object.assign({}, DEFAULT_PARAMS)
  };

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function round1(v) { return Math.round(v * 10) / 10; }

  // ── Normalizza la configurazione utente, con retrocompatibilita' per i
  //    vecchi formati (teamStrength singolo valore, teamStats in scala
  //    30-99, weights del vecchio algoritmo — questi ultimi vengono
  //    semplicemente ignorati perche' il nuovo algoritmo non li usa) ──
  function mergeConfig(userConfig) {
    const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    if (!userConfig) return cfg;
    let uc = userConfig;
    if (uc.teamStrength && !uc.teamStats) {
      const migrated = {};
      Object.keys(uc.teamStrength).forEach(function (t) {
        migrated[t] = { attacco: uc.teamStrength[t], difesa: uc.teamStrength[t] };
      });
      uc = Object.assign({}, uc, { teamStats: migrated });
    }
    if (uc.teamStats) {
      Object.keys(uc.teamStats).forEach(function (t) {
        if (!cfg.teamStats[t]) cfg.teamStats[t] = { attacco: 5, difesa: 5 };
        const stat = uc.teamStats[t] || {};
        ['attacco', 'difesa'].forEach(function (k) {
          let v = stat[k];
          if (typeof v !== 'number' || isNaN(v)) return;
          // Retrocompatibilita': i vecchi valori erano in scala 30-99.
          if (v > 10) v = 1 + (v - 30) * 9 / 69;
          cfg.teamStats[t][k] = clamp(Math.round(v), 1, 10);
        });
      });
    }
    if (uc.params) {
      Object.keys(DEFAULT_PARAMS).forEach(function (k) {
        if (typeof uc.params[k] === 'number' && !isNaN(uc.params[k])) cfg.params[k] = uc.params[k];
      });
    }
    return cfg;
  }

  // ── Ricerca case-insensitive di una squadra in teamStats ──
  function findTeamStat(team, cfg) {
    if (cfg.teamStats[team]) return cfg.teamStats[team];
    const lower = String(team).toLowerCase();
    const key = Object.keys(cfg.teamStats).find(function (k) { return k.toLowerCase() === lower; });
    return key ? cfg.teamStats[key] : null;
  }

  function getStat(team, stat, cfg) {
    const s = findTeamStat(team, cfg);
    if (!s) return 5;
    return (stat === 'attacco') ? s.attacco : s.difesa;
  }

  // ── Difficolta' di una singola partita per il giocatore di "team" ──
  // mode 'portieri'    -> diff = Difesa(propria) - Attacco(avversario) + bonus campo
  // mode 'attaccanti'  -> diff = Attacco(proprio) - Difesa(avversario) + bonus campo
  // Valori piu' alti = partita piu' favorevole (l'opposto della vecchia scala 0-100).
  function difficoltaPartita(team, opponent, isHome, cfg, mode) {
    const m = mode === 'attaccanti' ? 'attaccanti' : 'portieri';
    const ownStat = (m === 'attaccanti') ? getStat(team, 'attacco', cfg) : getStat(team, 'difesa', cfg);
    const oppStat = (m === 'attaccanti') ? getStat(opponent, 'difesa', cfg) : getStat(opponent, 'attacco', cfg);
    const fieldAdj = isHome ? cfg.params.homeBonus : -cfg.params.awayPenalty;
    return round1(ownStat - oppStat + fieldAdj);
  }

  const LIVELLO_RANK = { facile: 3, media: 2, difficile: 1, molto_difficile: 0 };

  function livelloDifficolta(diff, cfg) {
    const p = cfg.params;
    if (diff > p.sogliaFacile) return 'facile';
    if (diff <= p.sogliaMoltoDifficile) return 'molto_difficile';
    if (diff < p.sogliaDifficile) return 'difficile';
    return 'media';
  }

  // ── Calendario di una squadra: righe {giornata, opponent, isHome, difficolta, livello} ──
  function sameTeam(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }

  function calendarioSquadra(team, fixtures, config, mode) {
    const cfg = mergeConfig(config);
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

  // ── Calcolo "grezzo" (non normalizzato) di un gruppo di 2 o 3 squadre ──
  // Per ogni giornata si considera la MIGLIOR categoria fra i membri del
  // gruppo (si "gioca" chi ha la partita piu' favorevole quella settimana).
  function computeRawForGroup(teams, fixtures, cfg, mode) {
    const calendari = teams.map(function (t) { return calendarioSquadra(t, fixtures, cfg, mode); });
    const totale = Math.max.apply(null, calendari.map(function (c) { return c.length; })) || 38;

    const righe = [];
    let facili = 0, medie = 0, difficili = 0, moltoDifficili = 0, critiche = 0, tuttiFuori = 0;
    let inCasaReco = 0, fuoriCasaReco = 0;
    const recoConteggio = teams.map(function () { return 0; });
    const bestVals = [];

    for (let i = 0; i < totale; i++) {
      const partite = calendari.map(function (c) { return c[i]; });
      if (partite.some(function (p) { return !p; })) continue;

      const difficolte = partite.map(function (p) { return p.difficolta; });
      const ranks = partite.map(function (p) { return LIVELLO_RANK[p.livello]; });

      let bestIdx = 0;
      for (let k = 1; k < difficolte.length; k++) if (difficolte[k] > difficolte[bestIdx]) bestIdx = k;
      const ordinati = difficolte.slice().sort(function (a, b) { return b - a; });
      const delta = (ordinati.length > 1) ? (ordinati[0] - ordinati[1]) : 99;
      const raccomandato = (delta <= cfg.params.ballottaggioDelta) ? 'ballottaggio' : bestIdx;
      if (typeof raccomandato === 'number') recoConteggio[raccomandato]++;

      const scelta = partite[bestIdx];
      bestVals.push(scelta.difficolta);
      if (scelta.livello === 'facile') facili++;
      else if (scelta.livello === 'media') medie++;
      else if (scelta.livello === 'difficile') difficili++;
      else moltoDifficili++;
      if (scelta.isHome) inCasaReco++; else fuoriCasaReco++;

      const tutteRischiose = ranks.every(function (r) { return r <= LIVELLO_RANK.difficile; });
      if (tutteRischiose) critiche++;

      const tutteFuori = partite.every(function (p) { return !p.isHome; });
      if (tutteFuori) tuttiFuori++;

      righe.push({
        giornata: partite[0].giornata,
        squadre: teams.map(function (t, idx) {
          return { team: t, opponent: partite[idx].opponent, isHome: partite[idx].isHome, difficolta: partite[idx].difficolta, livello: partite[idx].livello };
        }),
        raccomandato: raccomandato,
        criticaDoppia: tutteRischiose,
        tuttiFuoriCasa: tutteFuori
      });
    }

    const n = righe.length || 1;
    const p = cfg.params;
    const rawScore = facili * p.puntiFacile + medie * p.puntiMedia
      - difficili * p.malusDifficile - moltoDifficili * p.malusMoltoDifficile
      - critiche * p.malusCriticaComune;

    const mean = bestVals.reduce(function (s, v) { return s + v; }, 0) / n;
    const varSum = bestVals.reduce(function (s, v) { return s + Math.pow(v - mean, 2); }, 0);
    const stdDev = Math.sqrt(varSum / n);

    return {
      rawScore: rawScore, righe: righe, n: n,
      facili: facili, medie: medie, difficili: difficili, moltoDifficili: moltoDifficili,
      critiche: critiche, tuttiFuori: tuttiFuori,
      inCasaReco: inCasaReco, fuoriCasaReco: fuoriCasaReco,
      recoConteggio: recoConteggio, stdDev: stdDev
    };
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

  // ── Cache dell'universo di riferimento per la normalizzazione min-max.
  //    Calcolato una sola volta per (dimensione gruppo + modalita' +
  //    parametri + statistiche squadre + numero di partite), poi
  //    riutilizzato per tutte le chiamate successive con la stessa
  //    configurazione (es. durante un intero rankingGruppi). ──
  const universeCache = new Map();

  function universeCacheKey(fixtures, cfg, size, mode) {
    return JSON.stringify({ size: size, mode: mode, params: cfg.params, teamStats: cfg.teamStats, fLen: fixtures.length });
  }

  function getUniverseRawRange(fixtures, cfg, size, mode) {
    const key = universeCacheKey(fixtures, cfg, size, mode);
    if (universeCache.has(key)) return universeCache.get(key);
    const allTeams = Object.keys(cfg.teamStats);
    const combos = combinazioni(allTeams, size);
    let min = Infinity, max = -Infinity;
    combos.forEach(function (g) {
      const r = computeRawForGroup(g, fixtures, cfg, mode).rawScore;
      if (r < min) min = r;
      if (r > max) max = r;
    });
    if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
    const result = { min: min, max: max };
    universeCache.set(key, result);
    return result;
  }

  // ── Analisi completa di un gruppo di 2 o 3 squadre ──
  function analizzaGruppo(teams, fixtures, config, mode) {
    const cfg = mergeConfig(config);
    const m = mode === 'attaccanti' ? 'attaccanti' : 'portieri';
    const raw = computeRawForGroup(teams, fixtures, cfg, m);
    const range = getUniverseRawRange(fixtures, cfg, teams.length, m);

    let score;
    if (range.max === range.min) score = 50;
    else score = 1 + (raw.rawScore - range.min) * 99 / (range.max - range.min);
    score = round1(clamp(score, 1, 100));

    let livello;
    if (score >= 85) livello = 'Ottimo';
    else if (score >= 70) livello = 'Buono';
    else if (score >= 55) livello = 'Discreto';
    else livello = 'Rischioso';

    const confidenzaScore = clamp(round1(100 - raw.stdDev * 6), 30, 99);
    let confidenza;
    if (confidenzaScore >= 75) confidenza = 'Alta';
    else if (confidenzaScore >= 55) confidenza = 'Media';
    else confidenza = 'Bassa';

    const n = raw.n;
    const breakdown = {
      facili: round1((raw.facili / n) * 100),
      medie: round1((raw.medie / n) * 100),
      difficili: round1((raw.difficili / n) * 100),
      moltoDifficili: round1((raw.moltoDifficili / n) * 100)
    };

    const nomiGruppo = teams.join(' + ');
    const spiegazione = 'Questo gruppo (' + nomiGruppo + ') garantisce una partita favorevole in ' + raw.facili + ' delle ' + n +
      ' giornate' + (raw.critiche > 0 ? ', con ' + raw.critiche + ' giornata' + (raw.critiche > 1 ? 'e' : '') + ' critica' + (raw.critiche > 1 ? 'he' : '') + ' in cui tutti affrontano un avversario forte' : ', senza alcuna giornata in cui tutti rischiano contemporaneamente') +
      (raw.moltoDifficili > 0 ? ', e presenta ' + raw.moltoDifficili + ' giornata' + (raw.moltoDifficili > 1 ? 'e' : '') + ' molto difficile' + (raw.moltoDifficili > 1 ? 'i' : '') + '.' : '.') +
      (raw.tuttiFuori > 0 ? ' Coincide con tutti in trasferta in ' + raw.tuttiFuori + ' occasion' + (raw.tuttiFuori > 1 ? 'i' : 'e') + '.' : ' Non capita mai che tutti giochino in trasferta nella stessa giornata.');

    return {
      teams: teams, score: score, livello: livello, confidenza: confidenza,
      confidenzaScore: confidenzaScore,
      breakdown: breakdown, params: cfg.params,
      copertura: raw.facili, giornateTotali: n, giornateCritiche: raw.critiche, tuttiFuoriCasa: raw.tuttiFuori,
      recoConteggio: raw.recoConteggio,
      facili: raw.facili, medie: raw.medie, difficili: raw.difficili, moltoDifficili: raw.moltoDifficili,
      inCasaReco: raw.inCasaReco, fuoriCasaReco: raw.fuoriCasaReco,
      spiegazione: spiegazione,
      calendario: raw.righe,
      mode: m
    };
  }

  // ── Retrocompatibilita': analisi di una coppia (wrapper di analizzaGruppo) ──
  function analizzaCoppia(teamA, teamB, fixtures, config, mode) {
    return analizzaGruppo([teamA, teamB], fixtures, config, mode);
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

  // ── Retrocompatibilita': ranking di coppie ──
  function rankingCoppie(fixtures, config, teamsSubset, mode) {
    return rankingGruppi(fixtures, config, 2, mode, teamsSubset);
  }

  // ── Confronto diretto fra due gruppi gia' analizzati (dimensioni anche diverse) ──
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
    DEFAULT_PARAMS: DEFAULT_PARAMS,
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
