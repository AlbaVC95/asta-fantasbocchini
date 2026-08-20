// ═══════════════════════════════════════════════════════════════════
// LA CLESSIDRA
//
// Il cronometro dell'asta non è più un anello di progresso: è una
// clessidra da tavolo, disegnata in SVG — vetro soffiato con i suoi
// riflessi, ghiere e colonnine in ottone, sabbia con la grana e il
// mucchio che si forma in basso.
//
// Da dove viene il livello della sabbia: l'app disegna già l'avanzamento
// del tempo su un cerchio SVG (`#timer-progress`, attributo
// `stroke-dashoffset`). Questo file lo OSSERVA con un MutationObserver
// passivo e ne ricava la frazione rimasta. Non calcola nulla, non
// sostituisce nessuna funzione dell'app, non tocca lo stato di gioco:
// se questo file non venisse caricato, l'asta funzionerebbe identica.
//
// Il vecchio anello resta nel DOM (è la sorgente del dato) ma è nascosto
// da tema-serata.css.
// ═══════════════════════════════════════════════════════════════════
(function () {
  const CIRCONFERENZA = 339.292;   // r=54, come nell'SVG di index.html
  const NS = 'http://www.w3.org/2000/svg';

  // geometria (viewBox 0 0 100 152)
  const CIMA = 17, GOLA_ALTA = 74, GOLA_BASSA = 82, FONDO = 145;

  function disegna() {
    return `
<svg class="clessidra" viewBox="0 0 100 152" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="cls-ottone" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0"   stop-color="#7A5A28"/>
      <stop offset=".18" stop-color="#E8C489"/>
      <stop offset=".42" stop-color="#C9974B"/>
      <stop offset=".62" stop-color="#F0D6A4"/>
      <stop offset=".84" stop-color="#A87C38"/>
      <stop offset="1"   stop-color="#6B4E22"/>
    </linearGradient>
    <linearGradient id="cls-vetro" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0"   stop-color="#ffffff" stop-opacity=".16"/>
      <stop offset=".22" stop-color="#ffffff" stop-opacity=".04"/>
      <stop offset=".55" stop-color="#ffffff" stop-opacity=".015"/>
      <stop offset=".82" stop-color="#ffffff" stop-opacity=".07"/>
      <stop offset="1"   stop-color="#ffffff" stop-opacity=".13"/>
    </linearGradient>
    <linearGradient id="cls-bordo" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0"   stop-color="#ffffff" stop-opacity=".55"/>
      <stop offset=".35" stop-color="#ffffff" stop-opacity=".10"/>
      <stop offset=".75" stop-color="#ffffff" stop-opacity=".14"/>
      <stop offset="1"   stop-color="#ffffff" stop-opacity=".42"/>
    </linearGradient>
    <linearGradient id="cls-sabbia" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0"   stop-color="#FFD79A"/>
      <stop offset=".45" stop-color="#FFB04A"/>
      <stop offset="1"   stop-color="#C4802B"/>
    </linearGradient>
    <!-- la grana: rumore vero, non un motivo di pallini -->
    <filter id="cls-grana" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="3" seed="7" result="n"/>
      <feColorMatrix in="n" type="saturate" values="0" result="g"/>
      <feComponentTransfer in="g" result="g2">
        <feFuncA type="table" tableValues="0 .55"/>
      </feComponentTransfer>
      <feComposite in="g2" in2="SourceGraphic" operator="in" result="grana"/>
      <feBlend in="SourceGraphic" in2="grana" mode="multiply"/>
    </filter>
    <filter id="cls-ombra" x="-40%" y="-20%" width="180%" height="140%">
      <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000" flood-opacity=".55"/>
    </filter>

    <path id="cls-bolla-alta" d="M21,${CIMA} H79 C79,44 60,60 52,${GOLA_ALTA} H48 C40,60 21,44 21,${CIMA} Z"/>
    <path id="cls-bolla-bassa" d="M21,${FONDO} H79 C79,118 60,102 52,${GOLA_BASSA} H48 C40,102 21,118 21,${FONDO} Z"/>
    <clipPath id="cls-clip-alta"><use href="#cls-bolla-alta"/></clipPath>
    <clipPath id="cls-clip-bassa"><use href="#cls-bolla-bassa"/></clipPath>
  </defs>

  <g filter="url(#cls-ombra)">
    <!-- colonnine -->
    <rect x="13.5" y="13" width="4" height="126" rx="2" fill="url(#cls-ottone)"/>
    <rect x="82.5" y="13" width="4" height="126" rx="2" fill="url(#cls-ottone)"/>
    <!-- vetro -->
    <use href="#cls-bolla-alta"  fill="url(#cls-vetro)"/>
    <use href="#cls-bolla-bassa" fill="url(#cls-vetro)"/>
    <!-- sabbia: quella che resta sopra, quella caduta sotto -->
    <g clip-path="url(#cls-clip-alta)">
      <path class="cls-sabbia-alta" fill="url(#cls-sabbia)" filter="url(#cls-grana)" d=""/>
    </g>
    <g clip-path="url(#cls-clip-bassa)">
      <path class="cls-sabbia-bassa" fill="url(#cls-sabbia)" filter="url(#cls-grana)" d=""/>
    </g>
    <!-- il getto -->
    <rect class="cls-getto" x="49.2" y="${GOLA_ALTA}" width="1.6" height="${GOLA_BASSA - GOLA_ALTA + 22}" fill="url(#cls-sabbia)" opacity=".9"/>
    <!-- profilo del vetro, sopra la sabbia -->
    <use href="#cls-bolla-alta"  fill="none" stroke="url(#cls-bordo)" stroke-width="1.5"/>
    <use href="#cls-bolla-bassa" fill="none" stroke="url(#cls-bordo)" stroke-width="1.5"/>
    <!-- riflessi speculari -->
    <path d="M29,23 C27,38 36,50 43,58" fill="none" stroke="#fff" stroke-opacity=".34" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M29,139 C27,124 36,112 43,104" fill="none" stroke="#fff" stroke-opacity=".2" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M71,25 C73,37 68,45 64,51" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="1.4" stroke-linecap="round"/>
    <!-- ghiere -->
    <rect x="8"  y="4"   width="84" height="9" rx="3.5" fill="url(#cls-ottone)"/>
    <rect x="8"  y="139" width="84" height="9" rx="3.5" fill="url(#cls-ottone)"/>
    <rect x="8"  y="5.6" width="84" height="1.4" fill="#fff" opacity=".3"/>
    <rect x="8"  y="140.6" width="84" height="1.4" fill="#fff" opacity=".22"/>
  </g>
</svg>`;
  }

  function avvia() {
    const arco = document.getElementById('timer-progress');
    const box  = document.getElementById('timer-wrap');
    if (!arco || !box || box.querySelector('.clessidra')) return;

    box.insertAdjacentHTML('afterbegin', disegna());
    const alta   = box.querySelector('.cls-sabbia-alta');
    const bassa  = box.querySelector('.cls-sabbia-bassa');
    const getto  = box.querySelector('.cls-getto');

    function aggiorna() {
      // stroke-dashoffset: 0 = tempo pieno, CIRCONFERENZA = scaduto
      const off = parseFloat(arco.style.strokeDashoffset || arco.getAttribute('stroke-dashoffset') || 0);
      const s = Math.max(0, Math.min(1, 1 - (off / CIRCONFERENZA)));

      // sopra: il livello scende e la superficie si incava a imbuto
      const y = CIMA + (1 - s) * (GOLA_ALTA - CIMA);
      const conca = 9 * s;
      alta.setAttribute('d', `M15,${y.toFixed(1)} Q50,${(y + conca).toFixed(1)} 85,${y.toFixed(1)} L85,${GOLA_ALTA + 2} L15,${GOLA_ALTA + 2} Z`);

      // sotto: il mucchio cresce a cono
      const h = FONDO - (1 - s) * (FONDO - GOLA_BASSA - 4);
      const cono = 11 * (1 - s);
      bassa.setAttribute('d', `M15,${FONDO + 2} L85,${FONDO + 2} L85,${h.toFixed(1)} Q50,${(h - cono).toFixed(1)} 15,${h.toFixed(1)} Z`);

      // il getto si spegne quando non c'è più sabbia sopra
      getto.style.opacity = s > 0.005 ? '' : '0';
      box.style.setProperty('--sabbia', s.toFixed(4));
    }

    new MutationObserver(aggiorna).observe(arco, {
      attributes: true,
      attributeFilter: ['style', 'stroke-dashoffset']
    });
    aggiorna();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avvia);
  else avvia();
})();
