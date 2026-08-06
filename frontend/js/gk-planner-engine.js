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
    ballottaggioDelta: 1,      // differenza massima fra i due migliori per considerarla "ballottaggio"
    budgetPortieriPct: 12,     // % massima del budget totale che l'utente e' disposto a investire sui portieri
    budgetAttaccoPct: 40       // % massima del budget totale che l'utente e' disposto a investire sul reparto offensivo
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

  // ── Costo atteso (coste esperado) ────────────────────────────────
  // Somma il FVM/1000 (dal listino ufficiale) dei giocatori rilevanti di una
  // squadra: tutti i "Por" per la modalita' portieri, i ruoli W/T/A/Pc per la
  // modalita' attaccanti (reparto offensivo). FVM/1000 e' gia' calibrato su un
  // budget di riferimento di 1000 crediti, quindi /10 lo converte direttamente
  // in una percentuale di QUALSIASI budget di lega (500, 600, 1000...).
  const RUOLI_ATTACCO = ['w', 't', 'a', 'pc'];
  function ruoliDi(ruolo) {
    return String(ruolo || '').split('/').map(function (r) { return r.trim().toLowerCase(); });
  }
  function costoAttesoSquadra(team, listino, mode) {
    if (!listino || !listino.length) return 0;
    const m = mode === 'attaccanti' ? 'attaccanti' : 'portieri';
    const giocatoriRuolo = listino.filter(function (g) {
      if (!sameTeam(g.squadra_reale, team)) return false;
      const ruoli = ruoliDi(g.ruolo);
      return (m === 'attaccanti')
        ? ruoli.some(function (r) { return RUOLI_ATTACCO.indexOf(r) !== -1; })
        : ruoli.indexOf('por') !== -1;
    });
    if (m === 'portieri') {
      // Portieri: logica invariata — somma del FVM/1000 di TUTTI i portieri della squadra.
      return giocatoriRuolo.reduce(function (sum, g) { return sum + (Number(g.fvm1000) || 0); }, 0);
    }
    // Attaccanti: solo i due giocatori (ruolo W/T/A/Pc) piu' costosi contano, pesati
    // 100% il primo + 40% il secondo — il resto della rosa offensiva non incide. Questo
    // rappresenta il costo dei "big name" che una squadra impone, non un totale di
    // reparto: sommare TUTTI gli attaccanti penalizzava troppo le squadre forti (con
    // tanti buoni attaccanti) rispetto a squadre deboli con pochi giocatori costosi.
    const valori = giocatoriRuolo.map(function (g) { return Number(g.fvm1000) || 0; }).sort(function (a, b) { return b - a; });
    return (valori[0] || 0) * 1 + (valori[1] || 0) * 0.4;
  }
  function costoAttesoGruppo(teams, listino, mode) {
    return teams.reduce(function (sum, t) { return sum + costoAttesoSquadra(t, listino, mode); }, 0);
  }

  // ── Moltiplicatore di penalita'/premio in base allo scostamento dal budget
  //    obiettivo dell'utente. d = quanto il costo atteso supera (o sta sotto)
  //    il target, in proporzione (d=0.3 => 30% oltre il target). Sotto il
  //    target il premio e' piccolo e limitato (+3% al massimo); sopra il
  //    target la penalita' cresce in modo progressivo (non lineare) e arriva
  //    quasi ad azzerare lo score per scostamenti molto grandi. ──
  function round3(v) { return Math.round(v * 1000) / 1000; }
  function moltiplicatoreCosto(costoAttesoPct, budgetTargetPct) {
    if (!budgetTargetPct || budgetTargetPct <= 0) return 1;
    const d = costoAttesoPct / budgetTargetPct - 1;
    if (d <= 0) return round3(1 + 0.03 * clamp(-d / 0.5, 0, 1));
    const penalita = 0.97 * Math.pow(d, 1.08);
    return round3(clamp(1 - penalita, 0.03, 1.03));
  }

  // ── Price Score (0-100, SOLO Attaccanti) — curva continua esponenziale, senza
  //    scalini: d = quanto il costo atteso supera il target, in proporzione (d=0.3
  //    => 30% oltre il target). Entro budget resta a 100 piatto; oltre il target
  //    scende con una progressione che accelera man mano che l'eccesso cresce,
  //    fino a schiacciarsi vicino a 0 per combinazioni molto costose. A differenza
  //    del moltiplicatoreCosto dei Portieri (che scala uno score gia' calcolato),
  //    questo e' un punteggio indipendente combinato dopo con la Quality via pesi. ──
  function priceScoreCurve(costoAttesoPct, budgetTargetPct) {
    if (!budgetTargetPct || budgetTargetPct <= 0) return 100;
    const d = (costoAttesoPct - budgetTargetPct) / budgetTargetPct;
    if (d <= 0) return 100;
    return round1(clamp(100 * Math.exp(-1.5 * Math.pow(d, 1.5)), 0, 100));
  }

  // ── Il valore "assoluto" di priceScoreCurve confronta solo col target configurato,
  //    non con cosa e' REALMENTE raggiungibile in questa lega. Se quasi tutte le
  //    combinazioni superano il target (es. target 40% ma i reparti offensivi buoni
  //    costano tipicamente il 60-100%), quasi tutte finiscono schiacciate in basso e
  //    l'unica squadra anomale-mente economica vince sempre, qualunque sia il
  //    calendario — il Price finisce per schiacciare completamente il Quality.
  //    Come gia' si fa per lo score sportivo (getUniverseRawRange), ristendiamo il
  //    Price Score sull'intera scala 1-100 in base al costo MINIMO e MASSIMO
  //    davvero raggiungibile fra tutte le combinazioni di questa dimensione — cosi'
  //    il fattore prezzo pesa sempre in modo comparabile al fattore qualita',
  //    indipendentemente da quanto il target configurato sia tarato bene o male. ──
  const universeCostCache = new Map();
  function universeCostCacheKey(listino, cfg, size, mode) {
    const fingerprint = listino.length + ':' + listino.reduce(function (s, g) { return s + (Number(g.fvm1000) || 0); }, 0);
    const budgetTargetPct = mode === 'attaccanti' ? cfg.params.budgetAttaccoPct : cfg.params.budgetPortieriPct;
    return size + '|' + mode + '|' + budgetTargetPct + '|' + fingerprint + '|' + Object.keys(cfg.teamStats).sort().join(',');
  }
  function getUniverseCostoRange(listino, cfg, size, mode) {
    const key = universeCostCacheKey(listino, cfg, size, mode);
    if (universeCostCache.has(key)) return universeCostCache.get(key);
    const allTeams = Object.keys(cfg.teamStats);
    const combos = combinazioni(allTeams, size);
    const budgetTargetPct = mode === 'attaccanti' ? cfg.params.budgetAttaccoPct : cfg.params.budgetPortieriPct;
    let min = Infinity, max = -Infinity;
    combos.forEach(function (g) {
      const costoPct = costoAttesoGruppo(g, listino, mode) / 10;
      const raw = priceScoreCurve(costoPct, budgetTargetPct);
      if (raw < min) min = raw;
      if (raw > max) max = raw;
    });
    if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
    const result = { min: min, max: max };
    universeCostCache.set(key, result);
    return result;
  }
  function priceScoreRelativo(costoAttesoPct, budgetTargetPct, listino, cfg, size, mode) {
    const raw = priceScoreCurve(costoAttesoPct, budgetTargetPct);
    const range = getUniverseCostoRange(listino, cfg, size, mode);
    if (range.max === range.min) return 100;
    return round1(clamp(1 + (raw - range.min) * 99 / (range.max - range.min), 1, 100));
  }

  // ── Analisi completa di un gruppo di 2 o 3 squadre ──
  // listino (opzionale): array di giocatori dal Listino Ufficiale (con
  // squadra_reale, ruolo, fvm1000), usato per il fattore costo atteso. Se
  // omesso lo score resta puramente sportivo, come prima di questa funzione.
  function analizzaGruppo(teams, fixtures, config, mode, listino) {
    const cfg = mergeConfig(config);
    const m = mode === 'attaccanti' ? 'attaccanti' : 'portieri';
    const raw = computeRawForGroup(teams, fixtures, cfg, m);
    const range = getUniverseRawRange(fixtures, cfg, teams.length, m);

    let scoreSportivo;
    if (range.max === range.min) scoreSportivo = 50;
    else scoreSportivo = 1 + (raw.rawScore - range.min) * 99 / (range.max - range.min);
    scoreSportivo = round1(clamp(scoreSportivo, 1, 100));

    // Stessa valutazione economica per Portieri e Attaccanti: due punteggi INDIPENDENTI
    // (Quality = qualita' sportiva pura, Price = quanto e' ragionevole il costo, curva
    // continua). Cambia SOLO come si calcola il costo atteso (costoAttesoSquadra sopra):
    // Portieri somma tutti i portieri, Attaccanti pesa solo i due big-name piu' costosi.
    let score = scoreSportivo, costoAtteso = null, costoAttesoPct = null, budgetTargetPct = null;
    let qualityScore = null, priceScore = null;
    if (listino && listino.length) {
      costoAtteso = costoAttesoGruppo(teams, listino, m);
      costoAttesoPct = round1(costoAtteso / 10);
      budgetTargetPct = (m === 'attaccanti') ? cfg.params.budgetAttaccoPct : cfg.params.budgetPortieriPct;
      qualityScore = scoreSportivo;
      priceScore = priceScoreRelativo(costoAttesoPct, budgetTargetPct, listino, cfg, teams.length, m);
      // Il ranking finale (applyRankingQualitaBudget, sotto) ordina SOLO per
      // qualityScore, per Portieri e Attaccanti — il prezzo fa da filtro/spareggio,
      // non da peso continuo — quindi anche "score" (usato per il badge
      // Ottimo/Buono/Discreto/Rischioso) rispecchia solo la qualita'.
      score = qualityScore;
    }

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
      teams: teams, score: score, scoreSportivo: scoreSportivo, livello: livello, confidenza: confidenza,
      confidenzaScore: confidenzaScore,
      costoAtteso: costoAtteso, costoAttesoPct: costoAttesoPct, budgetTargetPct: budgetTargetPct,
      qualityScore: qualityScore, priceScore: priceScore,
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
  function analizzaCoppia(teamA, teamB, fixtures, config, mode, listino) {
    return analizzaGruppo([teamA, teamB], fixtures, config, mode, listino);
  }

  // ── Ranking "a budget" (Portieri E Attaccanti): qualita' sportiva prima, prezzo
  //    solo come filtro secco + spareggio finale, MAI come bonus continuo per
  //    l'economicita'. Sostituisce il blend 60/40 (che faceva salire in classifica
  //    combinazioni mediocri solo perche' economiche) rispondendo a "qual e' la
  //    MIGLIORE combinazione che posso permettermi", non "qual e' la piu' economica". ──
  const SOGLIA_QUALITA_BASE = 80;
  const SOGLIA_QUALITA_MIN = 50;
  const MIN_RISULTATI_QUALITA = 10;
  const TOLLERANZA_BUDGET = 1.15; // 15% di margine oltre il target prima di scartare
  const DELTA_PAREGGIO_QUALITA = 3;

  function applyRankingQualitaBudget(risultati, budgetTargetPct) {
    // Filtro qualita' minima, dinamico: se la soglia base lascia troppo poche
    // combinazioni (lega con giocatori tutti mediocri), si abbassa a scaglioni di
    // 5 punti finche' non ce ne sono abbastanza, cosi' la Griglia non resta mai vuota.
    let soglia = SOGLIA_QUALITA_BASE;
    let perQualita = risultati.filter(function (r) { return r.qualityScore >= soglia; });
    while (perQualita.length < MIN_RISULTATI_QUALITA && soglia > SOGLIA_QUALITA_MIN) {
      soglia -= 5;
      perQualita = risultati.filter(function (r) { return r.qualityScore >= soglia; });
    }
    if (!perQualita.length) perQualita = risultati.slice();

    // Filtro budget secco: scarta chi supera CHIARAMENTE il target (oltre la
    // tolleranza), senza premiare chi costa meno del target. Se nessuna
    // combinazione di qualita' sufficiente rientra nel budget, si ripiega sulle
    // migliori per qualita' comunque (meglio segnalarle come fuori budget che
    // restituire una Griglia vuota senza spiegazione).
    const entroBudget = perQualita.filter(function (r) {
      return !budgetTargetPct || r.costoAttesoPct == null || r.costoAttesoPct <= budgetTargetPct * TOLLERANZA_BUDGET;
    });
    const fuoriBudget = entroBudget.length === 0;
    const finali = entroBudget.length ? entroBudget : perQualita;

    // Ordina SOLO per qualita' sportiva; il prezzo decide solo a parita' (quasi) di
    // qualita' — differenza <= DELTA_PAREGGIO_QUALITA punti.
    finali.sort(function (a, b) {
      const diff = b.qualityScore - a.qualityScore;
      if (Math.abs(diff) <= DELTA_PAREGGIO_QUALITA) return (a.costoAttesoPct || 0) - (b.costoAttesoPct || 0);
      return diff;
    });

    finali.forEach(function (r) { r.fuoriBudget = fuoriBudget; r.sogliaQualitaUsata = soglia; });
    return finali;
  }

  // ── Ranking di tutti i gruppi possibili di dimensione groupSize (2 o 3) ──
  // listino (opzionale): vedi analizzaGruppo — se presente il ranking tiene conto
  // anche del costo atteso, non solo della qualita' sportiva.
  function rankingGruppi(fixtures, config, groupSize, mode, teamsSubset, listino) {
    const cfg = mergeConfig(config);
    const teams = teamsSubset && teamsSubset.length ? teamsSubset : Object.keys(cfg.teamStats);
    const size = (groupSize === 3) ? 3 : 2;
    const gruppi = combinazioni(teams, size);
    const risultati = gruppi.map(function (g) { return analizzaGruppo(g, fixtures, cfg, mode, listino); });
    const m = mode === 'attaccanti' ? 'attaccanti' : 'portieri';
    if (listino && listino.length) {
      const budgetTargetPct = (m === 'attaccanti') ? cfg.params.budgetAttaccoPct : cfg.params.budgetPortieriPct;
      return applyRankingQualitaBudget(risultati, budgetTargetPct);
    }
    risultati.sort(function (a, b) { return b.score - a.score; });
    return risultati;
  }

  // ── Retrocompatibilita': ranking di coppie ──
  function rankingCoppie(fixtures, config, teamsSubset, mode, listino) {
    return rankingGruppi(fixtures, config, 2, mode, teamsSubset, listino);
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
    confrontaCoppie: confrontaCoppie,
    costoAttesoSquadra: costoAttesoSquadra,
    costoAttesoGruppo: costoAttesoGruppo,
    moltiplicatoreCosto: moltiplicatoreCosto,
    priceScoreCurve: priceScoreCurve,
    priceScoreRelativo: priceScoreRelativo,
    getUniverseCostoRange: getUniverseCostoRange
  };
})(typeof window !== 'undefined' ? window : global);
