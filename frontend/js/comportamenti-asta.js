// ═══════════════════════════════════════════════════════════════════
// COMPORTAMENTI ASTA
//
// Tre cose che il tema da solo non può fare:
//   1. la fase dell'asta guida il LAYOUT — negli ultimi secondi la
//      schermata si stringe su prezzo, tempo e azione
//   2. "ancora in gioco" — quante squadre possono ancora coprire
//      l'offerta corrente (non il patrimonio: la sopravvivenza a
//      QUESTA puja)
//   3. la leva — RILANCIA si può tenere premuto e l'importo sale
//
// COME SPEGNERLO
//   In console del browser:
//       localStorage.setItem('fantabar_comportamenti', '0')
//   e ricaricare. Per riaccenderlo: removeItem della stessa chiave.
//
// COSA TOCCA E COSA NO
//   (1) e (2) sono additivi e in sola lettura: leggono lo stato che il
//   client già riceve da 'stato-asta' e non cambiano nessuna regola.
//   (3) cambia solo COME si sceglie l'importo. L'evento emesso è lo
//   stesso ('rilancio') con lo stesso payload di sempre, e il server
//   continua a validarlo con calcolaMaxOfferta(): nessuna regola
//   viene aggirata.
//
//   Il TOCCO SINGOLO resta identico a prima: non lo intercettiamo,
//   lo gestisce il click handler originale dell'app (+1). Solo quando
//   si TIENE premuto entriamo in gioco, e in quel caso sopprimiamo il
//   click dell'app per non mandare due rilanci con un gesto solo.
// ═══════════════════════════════════════════════════════════════════
(function () {
  if (localStorage.getItem('fantabar_comportamenti') === '0') return;

  const SOGLIA_MS = 260;   // sotto questa soglia è un tocco, non una tenuta

  let hold = null, holdRaf = null, sopprimiClick = false;

  // NB: in app.js `S` e `socket` sono dichiarati con `const` a livello di
  // script, quindi NON diventano proprieta' di window: vanno letti come
  // identificatori nudi (risolti dalla catena degli scope), con un guard
  // per il caso in cui app.js non sia ancora stato eseguito.
  const chiamata = () => {
    try { return (S && S.asta) ? S.asta.chiamataAttuale : null; }
    catch (e) { return null; }
  };
  const btn = () => document.getElementById('btn-rilancio');

  // il tetto vero: la stessa funzione che l'app usa per l'hint in UI
  function tetto() {
    try {
      if (typeof getMaxOfferta === 'function') {
        const m = getMaxOfferta();
        if (typeof m === 'number' && isFinite(m) && m > 0) return m;
      }
    } catch (e) {}
    return null;
  }

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

  function etichettaLeva() {
    const b = btn(), c = chiamata();
    if (!b || !c) return;
    b.textContent = 'Rilancia';
    b.dataset.tot = (c.offertaAttuale || 0) + 1;
    b.style.setProperty('--carica', 0);
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
        try { marcaFuori(); etichettaLeva(); } catch (e) {}
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

  // ── LA LEVA ────────────────────────────────────────────────────
  function giu(e) {
    const b = btn(), c = chiamata();
    if (!b || b.disabled || !c) return;
    if (typeof canBid === 'function' && !canBid()) return;   // stesso guard dell'app
    hold = { t0: performance.now(), val: (c.offertaAttuale || 0) + 1 };
    const passo = () => {
      if (!hold) return;
      const cc = chiamata();
      if (!cc) return;
      const base = cc.offertaAttuale || 0;
      const dt = (performance.now() - hold.t0) / 1000;
      const extra = dt < 0.25 ? 0 : Math.floor(Math.pow(dt - 0.25, 1.7) * 22);
      const max = tetto();
      hold.val = base + 1 + extra;
      if (max !== null) hold.val = Math.min(max, hold.val);   // mai oltre il consentito
      b.dataset.tot = hold.val;
      const den = Math.max(1, (max !== null ? max : base + 60) - base);
      b.style.setProperty('--carica', Math.min(100, ((hold.val - base) / den) * 100));
      holdRaf = requestAnimationFrame(passo);
    };
    passo();
  }

  function su() {
    if (!hold) return;
    const { t0, val } = hold;
    const durata = performance.now() - t0;
    hold = null;
    cancelAnimationFrame(holdRaf);
    const b = btn(); if (b) b.style.setProperty('--carica', 0);
    const c = chiamata();
    if (!c) return;

    // Tocco breve: non facciamo nulla. Ci pensa il click handler
    // originale dell'app, esattamente come prima di questo modulo.
    if (durata < SOGLIA_MS || val <= (c.offertaAttuale || 0) + 1) return;

    // Tenuta: mandiamo noi l'importo raggiunto e sopprimiamo il click
    // dell'app, altrimenti un solo gesto manderebbe due rilanci.
    if (typeof canBid === 'function' && !canBid()) return;
    sopprimiClick = true;
    setTimeout(() => { sopprimiClick = false; }, 400);
    // stesso evento e stesso payload che usa inviaRilancioRapido()
    socket.emit('rilancio', { astaId: S.astaId, offerta: val });
  }

  document.addEventListener('pointerdown', e => {
    if (e.target.closest && e.target.closest('#btn-rilancio')) giu(e);
  });
  window.addEventListener('pointerup', su);
  window.addEventListener('pointercancel', su);

  // capture: gira PRIMA del listener che l'app ha messo sul bottone
  document.addEventListener('click', e => {
    if (!sopprimiClick) return;
    if (e.target.closest && e.target.closest('#btn-rilancio')) {
      sopprimiClick = false;
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }, true);

  function avvia() {
    aggancia();
    chip();
    try { marcaFuori(); etichettaLeva(); } catch (e) {}
  }

  window.__fantabarComportamenti = { fase, avvia, marcaFuori };
  if (document.readyState === 'complete') setTimeout(avvia, 400);
  else window.addEventListener('load', () => setTimeout(avvia, 400));
})();
