// ═══════════════════════════════════════════════════════════════════
// COMPORTAMENTI ASTA — modulo opzionale, SPENTO DI DEFAULT
//
// Aggiunge tre cose che il tema da solo non fa:
//   1. la fase dell'asta guida il LAYOUT (negli ultimi secondi la
//      schermata si stringe su prezzo/tempo/azione)
//   2. "ancora in gioco": quante squadre possono ancora coprire
//      l'offerta corrente
//   3. la leva: RILANCIA si tiene premuto e l'importo sale
//
// COME ACCENDERLO
//   In console, o in un <script> prima di questo file:
//       localStorage.setItem('fantabar_comportamenti', '1')
//   e ricaricare. Per spegnerlo: removeItem della stessa chiave.
//
// COSA TOCCA E COSA NO
//   (1) e (2) sono additivi e in sola lettura: non cambiano nessuna
//   regola di gioco, leggono solo lo stato che il client gia' riceve.
//   (3) CAMBIA come si sceglie l'importo del rilancio. L'evento
//   emesso resta lo stesso ('rilancio') e il server continua a
//   validare con calcolaMaxOfferta(): nessuna regola viene aggirata.
//   Il rischio e' d'uso, non di correttezza — si puo' superare
//   l'importo voluto tenendo premuto mezzo secondo di troppo.
//   Per questo il modulo nasce spento: va provato in un'asta di
//   test prima di darlo alla lega.
// ═══════════════════════════════════════════════════════════════════
(function () {
  if (localStorage.getItem('fantabar_comportamenti') !== '1') return;

// ═══════════════════════════════════════════════════════════════
// I COMPORTAMENTI NUOVI, montati SOPRA l'app reale di FantaBar.
// Non sostituisce nulla: riusa le funzioni vere dell'app
// (renderChiamata, renderBudgetBar, updateTimer) e aggiunge
// tre cose che oggi non esistono:
//   1. la fase dell'asta guida il layout, non solo il colore
//   2. "ancora in gioco": chi può ancora coprire QUESTA offerta
//   3. la leva: si tiene premuta, non si clicca
// Nessun file dell'app modificato.
// ═══════════════════════════════════════════════════════════════
  function attiva(opts) {
  opts = opts || {};
  const RIDOTTO = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mioMax = () => {
    try { return (typeof getMaxOfferta === 'function') ? getMaxOfferta() : 999; }
    catch (e) { return 999; }
  };
  let sec, tot = 9, loop = null, hold = null, holdRaf = null, finita = false;

  // ── "ancora in gioco": va in testata, accanto ai comandi ──
  const hdr = document.querySelector('.asta-header-right');
  if (hdr && !document.getElementById('vivi-n')) {
    const d = document.createElement('div');
    d.className = 'vivi-chip';
    d.innerHTML = '<b id="vivi-n">—</b><span>ancora in gioco</span>';
    hdr.insertBefore(d, hdr.firstChild);
  }

  const chiamata = () => S.asta && S.asta.chiamataAttuale;
  const btn = () => document.getElementById('btn-rilancio');

  function fase(f) {
    document.body.dataset.fase = f;
    document.body.classList.toggle('puja-urgente', f === 'finale');
  }

  // ── chi non può più coprire l'offerta esce dal tavolo ──
  function marcaFuori() {
    const off = chiamata() ? chiamata().offertaAttuale : 0;
    let vivi = 0;
    document.querySelectorAll('#budget-bar .sidebar-squadra').forEach(r => {
      const el = r.querySelector('.sq-crediti');
      const cr = el ? parseInt(el.textContent.replace(/[^\d]/g, ''), 10) || 0 : 0;
      const fuori = cr <= off;
      r.classList.toggle('fuori', fuori);
      if (!fuori) vivi++;
    });
    if (mioMax() > off) vivi++;
    const v = document.getElementById('vivi-n');
    if (v) v.textContent = vivi;
  }

  function ripristinaLeva() {
    const b = btn();
    if (!b) return;
    b.textContent = 'Rilancia';
    b.dataset.tot = (chiamata().offertaAttuale + 1);
    b.style.setProperty('--carica', 0);
  }

  // Nell'app reale il tempo lo detta il SERVER: qui non si simula nulla,
  // ci si aggancia a updateTimer(), che l'app chiama a ogni tick ricevuto.
  const _updateTimer = window.updateTimer;
  window.updateTimer = function (secondi, faseTimer) {
    const r = _updateTimer.apply(this, arguments);
    try {
      if (secondi <= 4 && secondi > 0) fase('finale');
      else if (secondi > 4) fase('asta');
    } catch (e) {}
    return r;
  };

  // e a renderChiamata(), che l'app chiama a ogni cambio di offerta
  const _renderChiamata = window.renderChiamata;
  window.renderChiamata = function (c) {
    const r = _renderChiamata.apply(this, arguments);
    try { marcaFuori(); ripristinaLeva(); } catch (e) {}
    return r;
  };

  const _renderBudgetBar = window.renderBudgetBar;
  window.renderBudgetBar = function (sq) {
    const r = _renderBudgetBar.apply(this, arguments);
    try { marcaFuori(); } catch (e) {}
    return r;
  };

  function assegna() { fase('assegnato'); }

  // ── LA LEVA: tenere premuto fa salire l'offerta ──
  function giu(e) {
    const b = btn();
    if (!b || b.disabled || finita) return;
    e.preventDefault();
    hold = { t0: performance.now(), val: chiamata().offertaAttuale + 1 };
    const step = () => {
      if (!hold) return;
      const dt = (performance.now() - hold.t0) / 1000;
      const extra = dt < 0.25 ? 0 : Math.floor(Math.pow(dt - 0.25, 1.7) * 22);
      hold.val = Math.min(mioMax(), chiamata().offertaAttuale + 1 + extra);
      b.dataset.tot = hold.val;
      const base = chiamata().offertaAttuale;
      const pct = Math.min(100, ((hold.val - base) / Math.max(1, mioMax() - base)) * 100);
      b.style.setProperty('--carica', pct);
      holdRaf = requestAnimationFrame(step);
    };
    step();
  }
  function su() {
    if (!hold) return;
    const val = hold.val;
    hold = null;
    cancelAnimationFrame(holdRaf);
    const b = btn(); if (b) b.style.setProperty('--carica', 0);
    if (val > chiamata().offertaAttuale) {
      // stesso evento e stessa validazione server di sempre
      socket.emit('rilancio', { astaId: S.astaId, squadra: S.miaSquadra, offerta: val });
    }
  }

  document.addEventListener('pointerdown', e => {
    if (e.target.closest && e.target.closest('#btn-rilancio')) giu(e);
  });
  window.addEventListener('pointerup', su);
  window.addEventListener('pointercancel', su);

  // ── avvio: si aggancia e basta, non pilota nulla ──
  function avvia() {
    try { marcaFuori(); ripristinaLeva(); } catch (e) {}
  }

  window.__fantabarComportamenti = { fase, avvia };
  if (document.readyState === 'complete') setTimeout(avvia, 600);
  else window.addEventListener('load', () => setTimeout(avvia, 600));
  return 'attivo';
  }

  attiva({});
})();
