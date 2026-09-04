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

  // I materiali della clessidra (ottone della cornice, sabbia) cambiano per tema — non è
  // un semplice ritinteggio via CSS perché i gradienti sono definiti come stop-color fissi
  // dentro l'SVG stesso (nessuna variabile CSS può capovolgerli). "lavagna" non compare qui:
  // in quel tema la clessidra resta nascosta (vedi tema-serata.css, sezione LAVAGNA AL NEON)
  // e al suo posto torna visibile l'anello al neon originale — non le serve un materiale.
  const MATERIALI = {
    serata: {
      ottone: ['#7A5A28', '#E8C489', '#C9974B', '#F0D6A4', '#A87C38', '#6B4E22'],
      sabbia: ['#FFD79A', '#FFB04A', '#C4802B']
    },
    cuoio: {
      ottone: ['#2B1B10', '#8F5A2C', '#6B4423', '#A87C4E', '#4A2E17', '#2B1B10'],
      sabbia: ['#D9B98C', '#8F5A2C', '#4A2E17']
    },
    // Sala Giochi: la cornice e' il cobalto del cabinato (l'accento strutturale del tema),
    // la sabbia resta l'oro del gettone — il denaro e il tempo che scorre, gli unici due
    // gialli concessi. Nessun ottone: qui e' plastica stampata, non metallo.
    'sala-giochi': {
      ottone: ['#141024', '#5A72F0', '#2440D8', '#8CA0FF', '#1B2FA8', '#141024'],
      sabbia: ['#FFD37A', '#F5B01A', '#C4820A']
    },
    // Il Bar: ottone SPAZZOLATO, non lucidato. La differenza sta tutta
    // nell'ampiezza della scala: "serata" va da #6B4E22 a #F0D6A4 (specchio),
    // qui il salto e' piu' corto, ed e' cosi' che un metallo legge opaco. Il
    // tono e' quello delle cornici del tema (tema-serata.css, sezione IL BAR),
    // perche' la clessidra sta su quel mobile e non deve sembrare in prestito.
    // La sabbia e' l'ambra della lampada (--primary #E4961E), l'unico giallo
    // che questo tema si concede oltre alla luce.
    bar: {
      ottone: ['#5C4423', '#D8B87A', '#B08A45', '#E3CB9A', '#9A7738', '#4E3A1E'],
      sabbia: ['#FFE0AC', '#E4961E', '#9C5F12']
    }
  };

  function applicaMateriale(box) {
    const tema = document.documentElement.getAttribute('data-tema');
    const m = MATERIALI[tema] || MATERIALI.serata;
    const stopsOttone = box.querySelectorAll('#cls-ottone stop');
    const stopsSabbia = box.querySelectorAll('#cls-sabbia stop');
    stopsOttone.forEach((s, i) => { if (m.ottone[i]) s.setAttribute('stop-color', m.ottone[i]); });
    stopsSabbia.forEach((s, i) => { if (m.sabbia[i]) s.setAttribute('stop-color', m.sabbia[i]); });
  }

  function disegnaClessidra() {
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

  // ═══════════════════════════════════════════════════════════════
  // IL BOCCALE (tema "Il Bar")
  //
  // Stessa meccanica della clessidra - si legge la frazione dall'anello e si
  // muove un livello - ma l'oggetto cambia: qui il tempo e' una birra che
  // finisce. Tre cose la fanno leggere come birra e non come "barra verticale
  // ambrata": la SCHIUMA che si affloscia mentre cala (un cappello che regge
  // fino in fondo e' finto), i MERLETTI che restano attaccati al vetro dove il
  // livello e' gia' passato - e' il dettaglio che dice "qualcuno la sta
  // bevendo" - e le BOLLE che salgono solo dentro al liquido.
  //
  // Il liquido usa il gradiente #cls-sabbia: cosi' applicaMateriale() continua
  // a funzionare senza saperne niente, e la birra prende l'ambra del tema.
  // ═══════════════════════════════════════════════════════════════
  const BOC_CIMA = 32, BOC_FONDO = 130;      // livello pieno / vuoto
  const MERLETTI = [48, 68, 88, 107];        // altezze fisse dei merletti sul vetro

  function disegnaBoccale() {
    const bolle = [[34, 0], [44, 1.7], [56, .8], [63, 2.6], [39, 3.4], [52, 4.3]]
      .map(function (b, i) {
        return `<circle class="boc-bolla" cx="${b[0]}" cy="0" r="${1 + (i % 3) * .35}"
                 fill="#fff" opacity=".5" style="animation-delay:${b[1]}s"/>`;
      }).join('');

    const merletti = MERLETTI.map(function (y, i) {
      return `<path class="boc-merletto" data-y="${y}" d="M25,${y} Q37,${y - 2.4} 50,${y}
               Q63,${y + 2.2} 67,${y - 1}" fill="none" stroke="#FFF6E4"
               stroke-opacity="0" stroke-width="${1.7 - i * .22}" stroke-linecap="round"/>`;
    }).join('');

    return `
<svg class="clessidra clessidra--boccale" viewBox="0 0 100 142" xmlns="${NS}" aria-hidden="true">
  <defs>
    <linearGradient id="cls-ottone" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0"   stop-color="#7A5A28"/>
      <stop offset=".18" stop-color="#E8C489"/>
      <stop offset=".42" stop-color="#C9974B"/>
      <stop offset=".62" stop-color="#F0D6A4"/>
      <stop offset=".84" stop-color="#A87C38"/>
      <stop offset="1"   stop-color="#6B4E22"/>
    </linearGradient>
    <linearGradient id="cls-sabbia" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0"   stop-color="#FFD79A"/>
      <stop offset=".45" stop-color="#FFB04A"/>
      <stop offset="1"   stop-color="#C4802B"/>
    </linearGradient>
    <linearGradient id="boc-schiuma" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0"   stop-color="#FFFDF6"/>
      <stop offset=".55" stop-color="#F6EAD2"/>
      <stop offset="1"   stop-color="#DCC9A6"/>
    </linearGradient>
    <linearGradient id="boc-vetro" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0"    stop-color="#ffffff" stop-opacity=".20"/>
      <stop offset=".18"  stop-color="#ffffff" stop-opacity=".05"/>
      <stop offset=".58"  stop-color="#ffffff" stop-opacity=".02"/>
      <stop offset=".84"  stop-color="#ffffff" stop-opacity=".09"/>
      <stop offset="1"    stop-color="#ffffff" stop-opacity=".17"/>
    </linearGradient>
    <linearGradient id="boc-bordo" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0"   stop-color="#ffffff" stop-opacity=".58"/>
      <stop offset=".38" stop-color="#ffffff" stop-opacity=".12"/>
      <stop offset=".78" stop-color="#ffffff" stop-opacity=".16"/>
      <stop offset="1"   stop-color="#ffffff" stop-opacity=".46"/>
    </linearGradient>
    <filter id="boc-ombra" x="-40%" y="-20%" width="180%" height="140%">
      <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000" flood-opacity=".55"/>
    </filter>

    <!-- l'interno del vetro: tutto il liquido vive qui dentro -->
    <path id="boc-dentro" d="M20,19 H68 L64.5,125 Q64.2,129.5 59.8,129.5 H28.2
                             Q23.8,129.5 23.5,125 Z"/>
    <clipPath id="boc-clip"><use href="#boc-dentro"/></clipPath>
    <!-- le bolle salgono solo fin dove arriva la birra -->
    <clipPath id="boc-clip-birra"><rect class="boc-area" x="0" y="0" width="100" height="142"/></clipPath>
  </defs>

  <g filter="url(#boc-ombra)">
    <!-- il manico, dietro al corpo -->
    <path d="M68,46 C88,46 90,56 90,68 C90,82 88,94 68,94" fill="none"
          stroke="url(#boc-vetro)" stroke-width="9" stroke-linecap="round"/>
    <path d="M68,46 C88,46 90,56 90,68 C90,82 88,94 68,94" fill="none"
          stroke="url(#boc-bordo)" stroke-width="1.4" stroke-linecap="round"/>

    <!-- il vetro vuoto -->
    <path d="M16,15 H72 L68.5,127 Q68,133.5 62.5,133.5 H25.5 Q20,133.5 19.5,127 Z"
          fill="url(#boc-vetro)"/>

    <g clip-path="url(#boc-clip)">
      <!-- la birra -->
      <path class="boc-birra" fill="url(#cls-sabbia)" d=""/>
      <!-- le bolle, dentro la birra -->
      <g clip-path="url(#boc-clip-birra)">${bolle}</g>
      <!-- la schiuma, sopra la birra -->
      <path class="boc-schiuma" fill="url(#boc-schiuma)" d=""/>
      <!-- i merletti restano dove il livello e' gia' passato -->
      ${merletti}
    </g>

    <!-- profilo e riflessi, sopra al liquido -->
    <path class="boc-profilo" d="M16,15 H72 L68.5,127 Q68,133.5 62.5,133.5 H25.5 Q20,133.5 19.5,127 Z"
          fill="none" stroke="url(#boc-bordo)" stroke-width="1.6"/>
    <ellipse class="boc-profilo" cx="44" cy="16" rx="28" ry="3.4" fill="none" stroke="url(#boc-bordo)" stroke-width="1.4"/>
    <path d="M27,26 L25.5,120" fill="none" stroke="#fff" stroke-opacity=".26" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M62,30 L61,86"   fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="1.6" stroke-linecap="round"/>
  </g>
</svg>`;
  }

  function legaBoccale(box) {
    const birra    = box.querySelector('.boc-birra');
    const schiuma  = box.querySelector('.boc-schiuma');
    const area     = box.querySelector('.boc-area');
    const merletti = box.querySelectorAll('.boc-merletto');

    return function (s) {
      // il livello scende: pieno a BOC_CIMA, asciutto a BOC_FONDO
      const y = BOC_CIMA + (1 - s) * (BOC_FONDO - BOC_CIMA);
      birra.setAttribute('d', `M10,${y.toFixed(1)} Q44,${(y - 1.4).toFixed(1)} 78,${y.toFixed(1)} L78,140 L10,140 Z`);

      // il cappello si affloscia mentre cala: 13px da piena, un velo alla fine
      const h = 2.5 + 11 * s;
      const t = y - h;
      schiuma.setAttribute('d',
        `M10,${y.toFixed(1)} L10,${(t + 2).toFixed(1)} Q20,${(t - 1.2).toFixed(1)} 30,${(t + 1.4).toFixed(1)}` +
        ` Q40,${(t - 2).toFixed(1)} 50,${(t + 1).toFixed(1)}` +
        ` Q60,${(t - 1.6).toFixed(1)} 70,${(t + 1.8).toFixed(1)}` +
        ` L78,${(t + 2.4).toFixed(1)} L78,${y.toFixed(1)} Z`);

      // le bolle esistono solo sotto il pelo della birra
      area.setAttribute('y', y.toFixed(1));
      area.setAttribute('height', Math.max(0, 142 - y).toFixed(1));

      // un merletto compare quando il livello gli e' passato sotto, e sbiadisce
      // piano: appena scoperto e' bagnato, poi scivola giu'
      merletti.forEach(function (m) {
        const my = parseFloat(m.getAttribute('data-y'));
        const scoperto = y - my;                       // px di vetro liberati sotto al merletto
        const o = scoperto <= 0 ? 0 : Math.min(.34, scoperto / 26) * (1 - Math.min(.55, scoperto / 90));
        m.setAttribute('stroke-opacity', o.toFixed(3));
      });

      box.style.setProperty('--sabbia', s.toFixed(4));
    };
  }

  function legaClessidra(box) {
    const alta  = box.querySelector('.cls-sabbia-alta');
    const bassa = box.querySelector('.cls-sabbia-bassa');
    const getto = box.querySelector('.cls-getto');

    return function (s) {
      // sopra: il livello scende e la superficie si incava a imbuto
      const y = CIMA + (1 - s) * (GOLA_ALTA - CIMA);
      const conca = 9 * s;
      alta.setAttribute('d', `M15,${y.toFixed(1)} Q50,${(y + conca).toFixed(1)} 85,${y.toFixed(1)} L85,${GOLA_ALTA + 2} L15,${GOLA_ALTA + 2} Z`);

      // sotto: il mucchio cresce a cono
      const h = FONDO - (1 - s) * (FONDO - GOLA_BASSA - 4);
      const cono = 11 * (1 - s);
      bassa.setAttribute('d', `M15,${FONDO + 2} L85,${FONDO + 2} L85,${h.toFixed(1)} Q50,${(h - cono).toFixed(1)} 15,${h.toFixed(1)} Z`);

      // il getto si spegne quando non c'e' piu' sabbia sopra
      getto.style.opacity = s > 0.005 ? '' : '0';
      box.style.setProperty('--sabbia', s.toFixed(4));
    };
  }

  // Quale oggetto misura il tempo, tema per tema. "lavagna" e "sala-giochi" non
  // compaiono: li' questo SVG resta nascosto da tema-serata.css e il tempo lo
  // dice l'anello al neon / il display arcade.
  function modelloDi(tema) {
    return tema === 'bar' ? 'boccale' : 'clessidra';
  }

  function avvia() {
    const arco = document.getElementById('timer-progress');
    const box  = document.getElementById('timer-wrap');
    if (!arco || !box || box.querySelector('.clessidra')) return;

    // Il tema puo' cambiare a caldo dal selettore (setTema()), senza reload. Prima
    // bastava ridipingere i materiali; ora due temi usano oggetti DIVERSI (clessidra
    // e boccale), quindi al cambio si rimonta l'SVG e si riagganciano i nodi. Il
    // modello montato si tiene qui: se non cambia, si ridipinge e basta.
    let modello = null;
    let disegnaLivello = function () {};

    // stroke-dashoffset: 0 = tempo pieno, CIRCONFERENZA = scaduto
    function frazione() {
      const off = parseFloat(arco.style.strokeDashoffset || arco.getAttribute('stroke-dashoffset') || 0);
      return Math.max(0, Math.min(1, 1 - (off / CIRCONFERENZA)));
    }
    function aggiorna() { disegnaLivello(frazione()); }

    function monta() {
      const m = modelloDi(document.documentElement.getAttribute('data-tema'));
      if (m === modello) { applicaMateriale(box); return; }
      modello = m;
      const vecchio = box.querySelector('.clessidra');
      if (vecchio) vecchio.remove();
      box.insertAdjacentHTML('afterbegin', m === 'boccale' ? disegnaBoccale() : disegnaClessidra());
      applicaMateriale(box);
      disegnaLivello = m === 'boccale' ? legaBoccale(box) : legaClessidra(box);
      aggiorna();
    }

    monta();
    new MutationObserver(monta).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-tema']
    });
    new MutationObserver(aggiorna).observe(arco, {
      attributes: true,
      attributeFilter: ['style', 'stroke-dashoffset']
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avvia);
  else avvia();
})();
