// ═══════════════════════════════════════════════════════════════════
// COMPORTAMENTI ASTA
//
// Tre cose che il tema da solo non può fare:
//   1. la fase dell'asta guida il LAYOUT — negli ultimi secondi la
//      schermata si stringe su prezzo, tempo e azione
//   2. "ancora in gioco" — quante squadre possono ancora coprire
//      l'offerta corrente (non il patrimonio: la sopravvivenza a
//      QUESTA puja)
//   3. l'etichetta di RILANCIA, col totale che pagheresti
//
// COME SPEGNERLO
//   In console del browser:
//       localStorage.setItem('fantabar_comportamenti', '0')
//   e ricaricare. Per riaccenderlo: removeItem della stessa chiave.
//
// COSA TOCCA E COSA NO
//   Tutto quello che resta è additivo e in sola lettura: legge lo stato
//   che il client già riceve da 'stato-asta' e non cambia nessuna regola.
//   Il rilancio lo manda sempre e solo il click handler originale
//   dell'app (+1): questo modulo non emette più nessun evento.
//
// LA LEVA, TOLTA
//   Qui c'era una terza cosa: tenendo premuto RILANCIA l'importo saliva.
//   Era voluta, ed è stata rimossa su richiesta dell'utente dopo averla
//   provata sul campo — "una pressione lunga deve valere +1 come una
//   corta". Vale la pena ricordare che il difetto non è emerso a
//   sorpresa: quando la leva è stata scritta si era già messo nero su
//   bianco (DECISIONS.md) che "il rischio è d'uso, non di correttezza:
//   si può superare l'importo voluto tenendo premuto mezzo secondo di
//   troppo". Il rischio si è avverato. Una soglia più alta l'avrebbe
//   solo reso più raro, non impossibile — in un'asta a tempo il gesto
//   che costa crediti deve essere quello che l'utente crede di fare.
// ═══════════════════════════════════════════════════════════════════
(function () {
  if (localStorage.getItem('fantabar_comportamenti') === '0') return;

  // NB: in app.js `S` e `socket` sono dichiarati con `const` a livello di
  // script, quindi NON diventano proprieta' di window: vanno letti come
  // identificatori nudi (risolti dalla catena degli scope), con un guard
  // per il caso in cui app.js non sia ancora stato eseguito.
  const chiamata = () => {
    try { return (S && S.asta) ? S.asta.chiamataAttuale : null; }
    catch (e) { return null; }
  };
  const btn = () => document.getElementById('btn-rilancio');

  function fase(f) {
    document.body.dataset.fase = f;
    document.body.classList.toggle('puja-urgente', f === 'finale');
  }

  // ── "ancora in gioco" ──────────────────────────────────────────
  function chip() {
    const hdr = document.querySelector('.asta-header-right');
    if (!hdr || document.getElementById('vivi-n')) return;
    const d = document.createElement('div');
    d.className = 'vivi-chip';
    d.innerHTML = '<b id="vivi-n">—</b><span>ancora in gioco</span>';
    hdr.insertBefore(d, hdr.firstChild);
  }

  // chi non può più coprire l'offerta esce dal tavolo
  function marcaFuori() {
    const c = chiamata();
    const off = c ? (c.offertaAttuale || 0) : 0;
    let vivi = 0;
    document.querySelectorAll('#budget-bar .sidebar-squadra').forEach(r => {
      const el = r.querySelector('.sq-crediti');
      const cr = el ? (parseInt(el.textContent.replace(/[^\d]/g, ''), 10) || 0) : 0;
      const fuori = off > 0 && cr <= off;
      r.classList.toggle('fuori', fuori);
      if (!fuori) vivi++;
    });
    const v = document.getElementById('vivi-n');
    if (v) v.textContent = vivi;
  }

  // Non e' un residuo della leva: e' quella che scrive l'etichetta del tasto e
  // `data-tot`, cioe' il TOTALE che pagheresti, che i temi mostrano dentro il
  // bottone (e la striscia di puja accanto al suo "+1"). Serve sempre.
  function etichettaRilancia() {
    const b = btn(), c = chiamata();
    if (!b || !c) return;
    b.textContent = 'Rilancia';
    b.dataset.tot = (c.offertaAttuale || 0) + 1;
  }

  // ── agganci alle funzioni vere dell'app ────────────────────────
  // Il tempo lo detta il server: non si simula nulla, si osserva.
  function aggancia() {
    const _t = window.updateTimer;
    if (typeof _t === 'function' && !_t.__fantabar) {
      window.updateTimer = function (secondi) {
        const r = _t.apply(this, arguments);
        // Rosso solo negli ULTIMI 3 SECONDI (richiesta esplicita dell'utente: prima
        // partiva a 4s). Deve restare allineato alla soglia di updateTimer() in
        // app.js, che accende .urgent sul cronometro — se le due divergono, meta'
        // della scena diventa rossa un secondo prima dell'altra.
        try { fase(secondi <= 3 && secondi > 0 ? 'finale' : 'asta'); } catch (e) {}
        return r;
      };
      window.updateTimer.__fantabar = true;
    }
    const _rc = window.renderChiamata;
    if (typeof _rc === 'function' && !_rc.__fantabar) {
      window.renderChiamata = function () {
        const r = _rc.apply(this, arguments);
        try { marcaFuori(); etichettaRilancia(); } catch (e) {}
        return r;
      };
      window.renderChiamata.__fantabar = true;
    }
    const _rb = window.renderBudgetBar;
    if (typeof _rb === 'function' && !_rb.__fantabar) {
      window.renderBudgetBar = function () {
        const r = _rb.apply(this, arguments);
        try { marcaFuori(); } catch (e) {}
        return r;
      };
      window.renderBudgetBar.__fantabar = true;
    }
  }

  function avvia() {
    aggancia();
    chip();
    try { marcaFuori(); etichettaRilancia(); } catch (e) {}
  }

  window.__fantabarComportamenti = { fase, avvia, marcaFuori };
  if (document.readyState === 'complete') setTimeout(avvia, 400);
  else window.addEventListener('load', () => setTimeout(avvia, 400));
})();
