// ═══════════════════════════════════════════════════════════════════
// IL CRONOMETRO DEL CABINATO — solo tema "sala-giochi"
//
// Un display a sette segmenti con la barra del tempo sotto, al posto
// della clessidra: in una sala giochi un orologio a sabbia non c'entra
// niente, e le due letture (esatta e a colpo d'occhio) si dicono in
// lingua arcade.
//
// Da dove vengono i dati — questo file NON calcola il tempo, come la
// clessidra:
//   - le cifre le legge da `#timer-display`, che l'app scrive gia';
//   - la frazione rimasta la ricava da `#timer-progress`
//     (`stroke-dashoffset`), lo stesso identico dato da cui la clessidra
//     ricava il livello della sabbia. L'anello e' nascosto da CSS in
//     tutti i temi ma resta nel DOM proprio per questo: e' la sorgente.
// Se questo file non venisse caricato, l'asta funzionerebbe identica.
//
// Due cose che sembrano dettagli e non lo sono:
//
// 1. I SEGMENTI SPENTI SI VEDONO. E' quello che distingue un display
//    vero da un numero colorato: su un pannello a LED l'otto completo e'
//    sempre li', appena percettibile, e le cifre sono i segmenti accesi
//    sopra quel fantasma. E' anche il motivo per cui le tre celle
//    restano SEMPRE tre: sotto i 100 secondi la prima non si accende, ma
//    il suo fantasma resta e il pannello non cambia larghezza. Un
//    display che si allarga e si stringe non e' un display.
//
// 2. IL COLORE SEGUE LE SOGLIE CHE GIA' ESISTONO: rosso da 3 secondi,
//    ambra da 10, verde sopra. Sono le stesse di `updateTimer()` in
//    app.js (che accende `.urgent`) e di `fase()` in
//    comportamenti-asta.js (che accende `body.puja-urgente`). Se qui se
//    ne inventassero altre, meta' della scena diventerebbe rossa in un
//    momento e meta' in un altro — l'errore e' gia' documentato in
//    DECISIONS.md a proposito del rosso a 3 secondi.
//    Il ticchettio sonoro parte da 5 e NON si tocca: e' un avviso
//    diverso, con una soglia sua, e sta dov'e'.
// ═══════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  var CIRCONFERENZA = 339.292;   // r=54, come l'SVG dell'anello in index.html
  var CELLE = 3;                 // il timer arriva a 120s (inp-timer-prima, max=120)

  // Le sette lastre di una cifra, nel sistema di riferimento della cella
  // (34 x 58). Nomi standard dei segmenti:
  //      aaa
  //     f   b
  //      ggg
  //     e   c
  //      ddd
  var T = 6;                     // spessore
  function orizzontale(y, x0, x1) {
    var m = T / 2;
    return [[x0 + m, y - m], [x1 - m, y - m], [x1, y], [x1 - m, y + m], [x0 + m, y + m], [x0, y]];
  }
  function verticale(x, y0, y1) {
    var m = T / 2;
    return [[x - m, y0 + m], [x, y0], [x + m, y0 + m], [x + m, y1 - m], [x, y1], [x - m, y1 - m]];
  }
  var SEGMENTI = {
    a: orizzontale(4, 6, 28),
    b: verticale(29, 7, 26),
    c: verticale(29, 32, 51),
    d: orizzontale(54, 6, 28),
    e: verticale(5, 32, 51),
    f: verticale(5, 7, 26),
    g: orizzontale(29, 6, 28)
  };
  // Quali segmenti accende ogni cifra.
  var CIFRE = {
    '0': 'abcdef', '1': 'bc',    '2': 'abged', '3': 'abgcd', '4': 'fgbc',
    '5': 'afgcd',  '6': 'afgedc', '7': 'abc',  '8': 'abcdefg', '9': 'abcdfg'
  };

  var ORDINE = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

  // Verde finche' c'e' tempo, ambra a 10, rosso a 3: le soglie dell'app.
  function coloreDi(secondi) {
    if (secondi <= 3)  return '#FF2D2D';
    if (secondi <= 10) return '#FFC61E';
    return '#3DF07A';
  }

  function punti(p) {
    return p.map(function (c) { return c[0] + ',' + c[1]; }).join(' ');
  }

  function disegnaCella(i) {
    var x = 10 + i * 38;
    var s = '<g transform="translate(' + x + ',10)">';
    for (var k = 0; k < ORDINE.length; k++) {
      var nome = ORDINE[k];
      // Due poligoni sovrapposti per segmento: il fantasma sempre acceso a
      // bassissima opacita', e sopra quello vero che si accende e si spegne.
      // Cosi' l'otto completo resta sempre leggibile in trasparenza, come su
      // un pannello a LED spento.
      s += '<polygon class="arc-ghost" points="' + punti(SEGMENTI[nome]) + '"/>';
      s += '<polygon class="arc-seg" data-cella="' + i + '" data-seg="' + nome +
           '" points="' + punti(SEGMENTI[nome]) + '"/>';
    }
    return s + '</g>';
  }

  var BLOCCHI = 12;   // le tacche della barra del tempo

  function disegnaBarra() {
    var s = '<g class="arc-barra">';
    var x0 = 10, larghezza = 124 - 10, passo = larghezza / BLOCCHI;
    for (var i = 0; i < BLOCCHI; i++) {
      s += '<rect class="arc-blocco" data-blocco="' + i + '" x="' +
           (x0 + i * passo).toFixed(2) + '" y="78" width="' + (passo - 2.4).toFixed(2) +
           '" height="9" rx="1"/>';
    }
    return s + '</g>';
  }

  function disegna() {
    return '' +
      '<svg class="arc-timer" viewBox="0 0 134 104" aria-hidden="true" focusable="false">' +
        // il mobiletto: plastica scura con il bordo duro del tema
        '<rect class="arc-scocca" x="1" y="1" width="132" height="102" rx="7"/>' +
        // lo schermo incassato
        '<rect class="arc-schermo" x="6" y="6" width="122" height="66" rx="3"/>' +
        disegnaCella(0) + disegnaCella(1) + disegnaCella(2) +
        disegnaBarra() +
        '<text class="arc-etichetta" x="67" y="99" text-anchor="middle">TIME</text>' +
      '</svg>';
  }

  function avvia() {
    var arco = document.getElementById('timer-progress');
    var box = document.getElementById('timer-wrap');
    var display = document.getElementById('timer-display');
    if (!arco || !box || !display || box.querySelector('.arc-timer')) return;

    box.insertAdjacentHTML('afterbegin', disegna());
    var segmenti = box.querySelectorAll('.arc-seg');
    var blocchi = box.querySelectorAll('.arc-blocco');

    function aggiorna() {
      var n = parseInt((display.textContent || '').replace(/[^0-9]/g, ''), 10);
      var valido = !isNaN(n) && n >= 0;
      // Zero davanti fino a due cifre: "07", non "7". La terza cella si accende
      // solo oltre i 99 secondi e per il resto resta fantasma (vedi la nota in
      // testa: la larghezza del pannello non deve mai cambiare).
      var testo = valido ? String(Math.min(n, 999)) : '';
      if (valido && testo.length < 2) testo = '0' + testo;
      var cifre = testo.split('');
      while (cifre.length < CELLE) cifre.unshift(null);   // le celle in piu' restano spente

      var colore = valido ? coloreDi(n) : '#3DF07A';
      box.style.setProperty('--arc-colore', colore);

      for (var i = 0; i < segmenti.length; i++) {
        var el = segmenti[i];
        var cella = cifre[parseInt(el.getAttribute('data-cella'), 10)];
        var acceso = cella != null && CIFRE[cella] &&
                     CIFRE[cella].indexOf(el.getAttribute('data-seg')) > -1;
        el.classList.toggle('acceso', !!acceso);
      }

      // La barra: stessa sorgente della sabbia della clessidra.
      // stroke-dashoffset 0 = tempo pieno, CIRCONFERENZA = scaduto.
      var off = parseFloat(arco.style.strokeDashoffset ||
                           arco.getAttribute('stroke-dashoffset') || 0);
      var frazione = Math.max(0, Math.min(1, 1 - (off / CIRCONFERENZA)));
      // Si arrotonda per ECCESSO: finche' resta un briciolo di tempo deve
      // restare acceso almeno un blocco, altrimenti la barra sembra a zero
      // mentre il numero dice ancora 1.
      var accesi = frazione > 0 ? Math.max(1, Math.ceil(frazione * BLOCCHI)) : 0;
      for (var b = 0; b < blocchi.length; b++) {
        blocchi[b].classList.toggle('acceso', b < accesi);
      }
    }

    // Due osservatori perche' i due dati arrivano in due momenti: updateTimer()
    // scrive PRIMA l'anello e POI la cifra, quindi osservando solo l'anello si
    // leggerebbe il numero del secondo precedente.
    new MutationObserver(aggiorna).observe(arco, {
      attributes: true, attributeFilter: ['style', 'stroke-dashoffset']
    });
    new MutationObserver(aggiorna).observe(display, {
      childList: true, characterData: true, subtree: true
    });
    aggiorna();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avvia);
  else avvia();
})();
