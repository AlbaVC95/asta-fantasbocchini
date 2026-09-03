// ═══════════════════════════════════════════════════════════════════
// IL CRONOMETRO DEL CABINATO — solo tema "sala-giochi"
//
// Un display a sette segmenti dietro il vetro, con la barra del tempo
// sotto, al posto della clessidra: in una sala giochi un orologio a
// sabbia non c'entra niente, e le due letture (esatta e a colpo d'occhio)
// si dicono in lingua arcade.
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
// Le cose che sembrano dettagli e non lo sono:
//
// 1. I SEGMENTI SPENTI SI VEDONO. E' quello che distingue un display
//    vero da un numero colorato: su un pannello a LED l'otto completo e'
//    sempre li', appena percettibile, e le cifre sono i segmenti accesi
//    sopra quel fantasma. E' anche il motivo per cui le tre celle
//    restano SEMPRE tre: sotto i 100 secondi la prima non si accende, ma
//    il suo fantasma resta e il pannello non cambia larghezza. Un
//    display che si allarga e si stringe non e' un display.
//
// 2. IL COLORE DELLE CIFRE SEGUE LE SOGLIE CHE GIA' ESISTONO: rosso da 3
//    secondi, ambra da 10, verde sopra. Sono le stesse di `updateTimer()`
//    in app.js (che accende `.urgent`) e di `fase()` in
//    comportamenti-asta.js (che accende `body.puja-urgente`). Se qui se
//    ne inventassero altre, meta' della scena diventerebbe rossa in un
//    momento e meta' in un altro — errore gia' documentato in
//    DECISIONS.md. Il ticchettio sonoro parte da 5 e NON si tocca: e' un
//    avviso diverso, con una soglia sua.
//
// 3. LA BARRA E' UN INDICATORE CON LE ZONE STAMPATE, non una striscia
//    monocolore. Le tacche hanno un colore FISSO — le ultime a spegnersi
//    sono rosse, poi ambra, poi verde — quindi dice a che punto sei anche
//    guardandola di sfuggita e anche se non hai visto il numero cambiare.
//    E' come la spia della benzina: la zona rossa e' rossa sempre, non
//    solo quando ci arrivi.
//
// 4. IL PUNTINO CHE BATTE. Un LED che si accende e si spegne ad ogni
//    tick del server: e' l'unica parte animata che dice qualcosa di vero
//    (il cronometro sta ricevendo dati), invece di muoversi per bellezza.
// ═══════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  var CIRCONFERENZA = 339.292;   // r=54, come l'SVG dell'anello in index.html

  // ── una cifra a sette segmenti, disegnata su misura
  //      aaa
  //     f   b
  //      ggg
  //     e   c
  //      ddd
  // La misura non e' fissa: dipende da quante celle servono (vedi MODI). Con
  // due celle le cifre sono quasi il doppio, ed e' il caso che conta — l'asta
  // gira con timer da 5 a 8 secondi.
  function segmentiPer(W, H, T) {
    var m = T / 2, o = T + 1, meta = H / 2;
    function oriz(y, x0, x1) {
      return [[x0 + m, y - m], [x1 - m, y - m], [x1, y], [x1 - m, y + m], [x0 + m, y + m], [x0, y]];
    }
    function vert(x, y0, y1) {
      return [[x - m, y0 + m], [x, y0], [x + m, y0 + m], [x + m, y1 - m], [x, y1], [x - m, y1 - m]];
    }
    return {
      a: oriz(m, o, W - o),
      b: vert(W - m, o, meta - m - 1),
      c: vert(W - m, meta + m + 1, H - o),
      d: oriz(H - m, o, W - o),
      e: vert(m, meta + m + 1, H - o),
      f: vert(m, o, meta - m - 1),
      g: oriz(meta, o, W - o)
    };
  }

  // Lo schermo utile e' x 14..136, y 11..87. Due modi:
  //  - DUE celle, il caso normale: cifre grandi, tutta la larghezza per loro;
  //  - TRE celle, solo se il timer parte da 100 o piu' (il massimo configurabile
  //    e' 120). La scelta si fa sul TOTALE, non sul valore corrente, cosi'
  //    dentro una stessa chiamata la larghezza non cambia mai a meta' conteggio.
  var MODI = {
    2: { W: 44, H: 66, T: 8, stacco: 12 },
    3: { W: 34, H: 56, T: 6, stacco: 8 }
  };

  // Quali segmenti accende ogni cifra.
  var CIFRE = {
    '0': 'abcdef', '1': 'bc',     '2': 'abged', '3': 'abgcd', '4': 'fgbc',
    '5': 'afgcd',  '6': 'afgedc', '7': 'abc',   '8': 'abcdefg', '9': 'abcdfg'
  };
  var ORDINE = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

  var VERDE = '#3DF07A', AMBRA = '#FFC61E', ROSSO = '#FF2D2D';

  // Il ROSSO resta a 3 secondi fissi: e' la soglia dell'app (updateTimer accende
  // `.urgent`, comportamenti-asta.js accende `body.puja-urgente`) e non si tocca,
  // altrimenti meta' della scena diventa rossa in un momento e meta' in un altro.
  //
  // L'AMBRA invece era a 10 secondi fissi, ed era sbagliata: quest'asta gira con
  // timer da 5 a 8 secondi (i valori di partenza sono 7 e 5), quindi il conteggio
  // NASCEVA gia' ambra e il verde non si vedeva mai. Ora e' proporzionale al
  // totale, con un minimo di 4 perche' sotto non ci sarebbe spazio fra ambra e
  // rosso: con 7 secondi fa 7-6-5 verde, 4 ambra, 3-2-1 rosso; con 60 fa ambra
  // dagli ultimi 24.
  // Una funzione sola per la soglia, usata DA TUTTI E DUE: le cifre e le tacche
  // della barra. Se ognuno se la calcolasse per conto suo, prima o poi
  // divergerebbero e la barra direbbe una cosa e il numero un'altra.
  function sogliaAmbraDi(totale) {
    return Math.max(4, Math.round((totale || 10) * 0.4));
  }
  function coloreDi(secondi, totale) {
    if (secondi <= 3) return ROSSO;
    if (secondi <= sogliaAmbraDi(totale)) return AMBRA;
    return VERDE;
  }

  function punti(p) {
    return p.map(function (c) { return c[0] + ',' + c[1]; }).join(' ');
  }

  // ── la barra: UNA TACCA PER SECONDO.
  // Con un timer da 7 escono 7 tacche e ne cala una ad ogni secondo, quindi la
  // barra si legge senza doverla interpretare — e' il conto alla rovescia
  // disegnato. Sopra le 12 tacche non si va: diventerebbero fili, e a quel punto
  // ognuna vale piu' di un secondo e la barra torna proporzionale.
  var TACCHE_MAX = 12;
  function taccheDi(totale) {
    return Math.max(1, Math.min(TACCHE_MAX, totale || 10));
  }
  // Le tacche si accendono da sinistra, quindi le prime sono le ULTIME a
  // spegnersi: li' va il rosso. Con una tacca per secondo la tacca i-esima E'
  // il secondo i+1, quindi il suo colore si chiede alla stessa funzione delle
  // cifre: quando il numero diventa rosso, le tacche rimaste sono esattamente
  // quelle rosse. Sopra le 12 la tacca copre piu' secondi e si usa il suo
  // secondo piu' alto, che e' quello che si sta consumando.
  function zonaDi(i, tacche, totale) {
    var secondo = Math.round((i + 1) * (totale / tacche));
    return coloreDi(secondo, totale);
  }

  // Le celle si centrano nello schermo, qualunque sia il modo.
  function disegnaCelle(celle) {
    var m = MODI[celle];
    var seg = segmentiPer(m.W, m.H, m.T);
    var larghezza = celle * m.W + (celle - 1) * m.stacco;
    var x0 = 14 + (122 - larghezza) / 2;
    var y0 = 11 + (76 - m.H) / 2;
    var s = '<g class="arc-cifre">';
    for (var i = 0; i < celle; i++) {
      s += '<g transform="translate(' + (x0 + i * (m.W + m.stacco)).toFixed(1) + ',' + y0.toFixed(1) + ')">';
      for (var k = 0; k < ORDINE.length; k++) {
        var nome = ORDINE[k], p = punti(seg[nome]);
        // Tre poligoni sovrapposti per segmento:
        //  - il fantasma, sempre acceso a bassissima opacita' (il display spento);
        //  - l'alone, lo stesso poligono sfocato: la luce del LED che sborda sul
        //    vetro, ed e' cio' che fa sembrare il pannello acceso invece che
        //    disegnato;
        //  - il segmento vero.
        s += '<polygon class="arc-ghost" points="' + p + '"/>';
        s += '<polygon class="arc-alone" data-cella="' + i + '" data-seg="' + nome + '" points="' + p + '"/>';
        s += '<polygon class="arc-seg"   data-cella="' + i + '" data-seg="' + nome + '" points="' + p + '"/>';
      }
      s += '</g>';
    }
    return s + '</g>';
  }

  function disegnaBarra(tacche, totale) {
    var s = '<g class="arc-barra">';
    var x0 = 16, larghezza = 134 - 16, passo = larghezza / tacche;
    // Lo stacco fra le tacche si stringe quando sono poche, cosi' con 5 o 7 non
    // diventano lastroni distanziati: resta una barra, non una fila di mattoni.
    var stacco = tacche > 8 ? 2 : (tacche > 5 ? 2.6 : 3.2);
    for (var i = 0; i < tacche; i++) {
      var x = (x0 + i * passo).toFixed(2), w = (passo - stacco).toFixed(2);
      var col = zonaDi(i, tacche, totale);
      s += '<rect class="arc-zona" x="' + x + '" y="98" width="' + w +
           '" height="11" rx="1" fill="' + col + '"/>';
      s += '<rect class="arc-blocco" data-blocco="' + i + '" x="' + x + '" y="98" width="' + w +
           '" height="11" rx="1" fill="' + col + '"/>';
    }
    return s + '</g>';
  }

  // Quattro viti agli angoli: e' il dettaglio che fa leggere la cornice come
  // un pezzo di mobile avvitato, non come un rettangolo arrotondato.
  function disegnaViti() {
    var s = '', p = [[9, 9], [141, 9], [9, 121], [141, 121]];
    for (var i = 0; i < p.length; i++) {
      s += '<circle class="arc-vite" cx="' + p[i][0] + '" cy="' + p[i][1] + '" r="3.2"/>';
      s += '<rect class="arc-taglio" x="' + (p[i][0] - 2.1) + '" y="' + (p[i][1] - .55) +
           '" width="4.2" height="1.1" rx=".5" transform="rotate(35 ' + p[i][0] + ' ' + p[i][1] + ')"/>';
    }
    return s;
  }

  function disegna() {
    return '' +
    '<svg class="arc-timer" viewBox="0 0 150 130" aria-hidden="true" focusable="false">' +
      '<defs>' +
        // Righe da 1 su 3 e non da 2 su 4: la prima versione tagliava le cifre
        // in strisce e si leggevano peggio. La scanline deve dire "c'e' un
        // vetro", non competere con il numero.
        '<pattern id="arc-scan" width="3" height="3" patternUnits="userSpaceOnUse">' +
          '<rect width="3" height="1" fill="#000" opacity=".22"/>' +
        '</pattern>' +
        // la vignettatura: il vetro si scurisce ai bordi
        '<radialGradient id="arc-vign" cx="50%" cy="45%" r="72%">' +
          '<stop offset="58%" stop-color="#000" stop-opacity="0"/>' +
          '<stop offset="100%" stop-color="#000" stop-opacity=".38"/>' +
        '</radialGradient>' +
        // il riflesso obliquo sul vetro
        '<linearGradient id="arc-rifl" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0%"  stop-color="#fff" stop-opacity=".14"/>' +
          '<stop offset="38%" stop-color="#fff" stop-opacity=".03"/>' +
          '<stop offset="39%" stop-color="#fff" stop-opacity="0"/>' +
        '</linearGradient>' +
        // l\'alone dei LED sul vetro
        '<filter id="arc-bagliore" x="-60%" y="-60%" width="220%" height="220%">' +
          '<feGaussianBlur stdDeviation="2.6"/>' +
        '</filter>' +
      '</defs>' +

      // il mobile: scocca, bordo di plastica, rilievo in alto
      '<rect class="arc-scocca" x="1" y="1" width="148" height="128" rx="9"/>' +
      '<rect class="arc-rilievo" x="3.5" y="3.5" width="143" height="123" rx="7.5"/>' +
      '<rect class="arc-rima" x="6" y="6" width="138" height="118" rx="6"/>' +
      disegnaViti() +

      // lo schermo incassato
      '<rect class="arc-schermo" x="14" y="11" width="122" height="76" rx="3"/>' +
      '<g class="arc-cifre"></g>' +
      // il puntino che batte ad ogni tick, sul bordo destro del vetro
      '<circle class="arc-battito" cx="130" cy="18" r="2.6"/>' +
      // il vetro sopra le cifre: scanline, vignetta, riflesso
      '<g class="arc-vetro">' +
        '<rect x="14" y="11" width="122" height="76" rx="3" fill="url(#arc-scan)"/>' +
        '<rect x="14" y="11" width="122" height="76" rx="3" fill="url(#arc-vign)"/>' +
        '<rect x="14" y="11" width="122" height="76" rx="3" fill="url(#arc-rifl)"/>' +
      '</g>' +

      '<g class="arc-barra"></g>' +
      '<text class="arc-etichetta" x="75" y="122" text-anchor="middle">TIME</text>' +
    '</svg>';
  }

  function avvia() {
    var arco = document.getElementById('timer-progress');
    var box = document.getElementById('timer-wrap');
    var display = document.getElementById('timer-display');
    if (!arco || !box || !display || box.querySelector('.arc-timer')) return;

    box.insertAdjacentHTML('afterbegin', disegna());
    var blocchi = [];
    var battito = box.querySelector('.arc-battito');
    var taccheOra = 0, totaleBarra = 0;
    var ultimoNumero = null, totale = 10;
    var celleOra = 0, segmenti = [];

    // Le celle si (ri)montano solo quando cambia il loro NUMERO, cioe' quando
    // parte una chiamata con un totale di ordine diverso. Dentro un conteggio
    // non si tocca niente.
    function montaCelle(celle) {
      if (celle === celleOra) return;
      celleOra = celle;
      var g = box.querySelector('.arc-cifre');
      g.outerHTML = disegnaCelle(celle);
      segmenti = box.querySelectorAll('.arc-seg, .arc-alone');
    }

    // La barra si rifa' quando cambia il TOTALE, non ad ogni secondo: cambiano
    // sia quante tacche servono sia di che colore e', e sono due cose che
    // dipendono solo dalla durata della chiamata.
    function montaBarra(tacche, totale) {
      if (tacche === taccheOra && totale === totaleBarra) return;
      taccheOra = tacche; totaleBarra = totale;
      var g = box.querySelector('.arc-barra');
      g.outerHTML = disegnaBarra(tacche, totale);
      blocchi = box.querySelectorAll('.arc-blocco');
    }

    function aggiorna() {
      var n = parseInt((display.textContent || '').replace(/[^0-9]/g, ''), 10);
      var valido = !isNaN(n) && n >= 0;

      // La barra: stessa sorgente della sabbia della clessidra.
      // stroke-dashoffset 0 = tempo pieno, CIRCONFERENZA = scaduto.
      var off = parseFloat(arco.style.strokeDashoffset ||
                           arco.getAttribute('stroke-dashoffset') || 0);
      var frazione = Math.max(0, Math.min(1, 1 - (off / CIRCONFERENZA)));

      // Il TOTALE non ce l'ha nessuno qui: `S` in app.js e' un const di primo
      // livello, quindi non e' una proprieta' di window (lo stesso motivo per
      // cui puja-sticky.js guarda il DOM invece di window.S). Ma si ricava dai
      // due dati che gia' leggiamo: frazione = secondi/totale, quindi
      // totale = secondi/frazione. Serve solo per scegliere quante celle e
      // dove mettere l'ambra, quindi un arrotondamento basta e avanza.
      if (valido && frazione > 0.02) {
        var t = Math.round(n / frazione);
        if (t >= 1 && t <= 999) totale = t;
      }

      montaCelle(totale >= 100 ? 3 : 2);
      montaBarra(taccheDi(totale), totale);

      // Zero davanti: "07", non "7".
      var testo = valido ? String(Math.min(n, 999)) : '';
      if (valido && testo.length < celleOra) {
        while (testo.length < Math.min(2, celleOra)) testo = '0' + testo;
      }
      var cifre = testo.split('');
      while (cifre.length < celleOra) cifre.unshift(null);

      box.style.setProperty('--arc-colore', valido ? coloreDi(n, totale) : VERDE);

      for (var i = 0; i < segmenti.length; i++) {
        var el = segmenti[i];
        var cella = cifre[parseInt(el.getAttribute('data-cella'), 10)];
        var acceso = cella != null && CIFRE[cella] &&
                     CIFRE[cella].indexOf(el.getAttribute('data-seg')) > -1;
        el.classList.toggle('acceso', !!acceso);
      }

      // Quante tacche restano accese. Nel caso normale (una tacca per secondo)
      // e' il numero stesso: nessun arrotondamento, nessuna sorpresa — la barra
      // e' il conto alla rovescia disegnato. Solo sopra le 12 tacche si torna
      // alla proporzione, arrotondata per ECCESSO perche' finche' resta un
      // briciolo di tempo deve restare accesa almeno una tacca, altrimenti la
      // barra sembra a zero mentre il numero dice ancora 1.
      var accesi;
      if (taccheOra === totale && valido) {
        accesi = Math.max(0, Math.min(taccheOra, n));
      } else {
        accesi = frazione > 0 ? Math.max(1, Math.ceil(frazione * taccheOra)) : 0;
      }
      for (var b = 0; b < blocchi.length; b++) {
        blocchi[b].classList.toggle('acceso', b < accesi);
      }

      // Il puntino batte ad ogni tick VERO, cioe' quando il numero cambia:
      // non e' un'animazione a tempo, e' il segno che i dati stanno arrivando.
      if (valido && n !== ultimoNumero) {
        ultimoNumero = n;
        battito.classList.toggle('acceso');
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
