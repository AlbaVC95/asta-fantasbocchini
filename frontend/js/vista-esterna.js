/* ═══════════════════════════════════════════════════════════════════
   LA VISTA A PARTE — Rose, Storico e Svincolati in una scheda del
   browser tutta per loro

   Richiesta dell'utente: le Rose stanno strette dentro la loro tab.
   Volerle a tutto schermo, su un secondo monitor o semplicemente in una
   scheda accanto, e' un modo di guardarle, non una funzione nuova
   dell'asta — e infatti qui non c'e' nessuna logica d'asta.

   Questo modulo e' ADDITIVO come clessidra.js, comportamenti-asta.js e
   puja-sticky.js: si costruisce il suo DOM da solo, non tocca nessun
   elemento esistente e non registra nessun handler sugli elementi
   dell'app. Se togli il suo <script> da index.html, l'app torna esatta-
   mente com'era.

   Tre scelte che tengono il modulo onesto:

   1. NON apre una seconda connessione. La scheda e' `about:blank`,
      scritta da qui: nessun socket, nessun login, nessuna chiamata REST
      in piu'. Sarebbero state 22 connessioni in piu' una sera d'asta.
      Puo' farlo perche' renderRose/renderStorico/renderGiocatoriLiberi
      girano ad OGNI aggiornamento di stato (app.js, dentro il blocco che
      ridisegna tutto), non solo quando la loro tab e' aperta: il nodo
      sorgente e' sempre aggiornato anche se stai guardando un'altra tab.

   2. NON duplica il markup. Rispecchia l'`innerHTML` del nodo vero
      (#rose-panel, #storico-list, #liberi-list) e si riallinea da solo
      con un MutationObserver. Una lista che cambia forma domani cambia
      forma anche qui, senza che nessuno se ne debba ricordare.

   3. NON esegue niente per conto suo. I click nella scheda a parte
      vengono ritrovati nel documento madre per POSIZIONE nell'albero —
      lo specchio e' una copia esatta, quindi lo stesso percorso porta
      allo stesso elemento — e li' si fa `.click()` sull'elemento VERO.
      E' lo stesso principio della striscia di puja, che per rilanciare
      fa `.click()` sul vero #btn-rilancio invece di emettere l'evento:
      un percorso solo, e tutti i controlli dell'app restano in mezzo.

   Perche' lo stile sta qui dentro e non in tema-serata.css, dove sta
   quello della striscia di puja: la scheda a parte e' un DOCUMENTO
   diverso, con un suo foglio di stile che questo file deve comunque
   scrivere. Tenere in due posti le due meta' della stessa finestra e'
   il modo sicuro di farle divergere. I colori sono tutti token
   (--bg-elevated, --border-light, --sc-*): la scheda segue i quattro
   temi senza una regola per tema, come gia' fa il selettore 🎨.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var VEGLIA = 1000;  // ms: solo per accorgersi che una scheda e' stata chiusa o ricaricata

  // Le tre viste che ha senso staccare: lunghe, di sola lettura, e gia'
  // ridisegnate per intero ad ogni aggiornamento di stato.
  // `ancora` e' dove appoggiare il bottone dentro la tab: dove esiste gia'
  // una riga di controlli si usa quella, altrimenti se ne crea una.
  var VISTE = [
    { id: 'rose',    tab: 'tab-rose',    fonte: 'rose-panel',   titolo: 'Rose',
      ancora: '.rose-compatta-row' },
    { id: 'storico', tab: 'tab-storico', fonte: 'storico-list', titolo: 'Storico',
      ancora: null },
    { id: 'liberi',  tab: 'tab-liberi',  fonte: 'liberi-list',  titolo: 'Svincolati',
      ancora: '#liberi-strategia-bar' }
  ];

  var aperte = [];        // { w, vista }
  var osservate = {};     // id vista -> true, per non attaccare due volte il MutationObserver
  var battito = null;
  var montato = false;

  /* ── lo stile del bottone, nel documento madre ────────────────────── */
  var CSS_BOTTONE = [
    '.ve-riga{display:flex;justify-content:flex-end;margin:0 0 6px}',
    '.ve-apri{',
    '  display:inline-flex;align-items:center;gap:5px;flex:0 0 auto;',
    '  background:var(--bg-elevated);color:var(--text-secondary);',
    '  border:1px solid var(--border-light);border-radius:8px;',
    '  font-family:var(--font-main);font-size:.66rem;font-weight:600;',
    '  padding:3px 8px;cursor:pointer;line-height:1.2;white-space:nowrap;',
    '  transition:color .18s,border-color .18s;',
    '}',
    '.ve-apri:hover{color:var(--text-primary);border-color:var(--primary-bright)}',
    '.ve-apri .ve-icona{font-size:.82rem;line-height:1}',
    // dentro la riga della "Visione compatta" il bottone va all'altro capo
    '.rose-compatta-row .ve-apri{margin-left:auto}'
  ].join('\n');

  /* ── lo stile della scheda a parte ────────────────────────────────── */
  //
  // Due cose vanno per forza forzate: style.css dichiara
  // `html,body{height:100vh;overflow:hidden}` (giusto nell'app, dove a
  // scorrere sono le schermate), e qui invece deve scorrere la pagina; e
  // i contenitori delle liste sono pensati per stare dentro un
  // `.tab-content` che qui non esiste, quindi vanno slegati dal flex.
  var CSS_SCHEDA = [
    'html,body{height:auto !important;min-height:100% !important;overflow:visible !important}',
    'body{margin:0;padding:0}',
    '.ve-bar{',
    '  position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:12px;',
    '  padding:8px 14px;border-bottom:1px solid var(--border);',
    '  background:var(--bg-card);backdrop-filter:blur(14px);',
    '}',
    '.ve-titolo{font-family:var(--font-display);font-weight:800;font-size:.9rem;color:var(--text-primary)}',
    '.ve-stato{margin-left:auto;font-size:.68rem;color:var(--text-muted);white-space:nowrap}',
    '.ve-stato.ve-morto{color:var(--danger,#ff4d2a)}',
    '.ve-corpo{padding:12px}',
    // Rose: qui c'e' tutta la larghezza dello schermo, quindi le colonne
    // vanno a capo invece di scorrere in orizzontale. E' l'unico punto in
    // cui la vista a parte si comporta diversamente dall'originale, ed e'
    // il motivo per cui l'utente la voleva.
    '.ve-corpo .rose-container{',
    '  flex:0 0 auto !important;min-height:0 !important;height:auto !important;',
    '  flex-wrap:wrap !important;overflow:visible !important;align-items:flex-start;',
    '}',
    '.ve-corpo .storico-list,.ve-corpo .liberi-list{max-height:none !important;overflow:visible !important}'
  ].join('\n');

  /* ══════ bottone nel documento madre ══════ */

  function iniettaStile() {
    if (document.getElementById('ve-stile')) return;
    var s = document.createElement('style');
    s.id = 've-stile';
    s.textContent = CSS_BOTTONE;
    document.head.appendChild(s);
  }

  function creaBottone(vista) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 've-apri';
    b.title = 'Apri ' + vista.titolo + ' in una scheda a parte';
    var i = document.createElement('span');
    i.className = 've-icona';
    i.textContent = '⧉';           // ⧉
    var t = document.createElement('span');
    t.textContent = 'Apri a parte';
    b.appendChild(i);
    b.appendChild(t);
    b.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      apri(vista);
    });
    return b;
  }

  function montaBottoni() {
    var messi = 0;
    for (var i = 0; i < VISTE.length; i++) {
      var v = VISTE[i];
      var tab = document.getElementById(v.tab);
      if (!tab || tab.querySelector('.ve-apri')) { if (tab) messi++; continue; }
      if (!document.getElementById(v.fonte)) continue;
      var ancora = v.ancora ? tab.querySelector(v.ancora) : null;
      if (ancora) {
        ancora.appendChild(creaBottone(v));
      } else {
        var riga = document.createElement('div');
        riga.className = 've-riga';
        riga.appendChild(creaBottone(v));
        tab.insertBefore(riga, tab.firstChild);
      }
      messi++;
    }
    return messi === VISTE.length;
  }

  /* ══════ la scheda a parte ══════ */

  function apri(vista) {
    var w;
    try { w = window.open('', 'ftb-vista-' + vista.id); } catch (e) { w = null; }
    if (!w) {
      // Nessun toast: `toast()` vive in app.js e questo modulo non lo
      // presuppone. Un alert e' brutto ma dice la cosa giusta, ed e' un
      // caso che capita una volta sola (poi si sblocca il sito).
      alert('Il browser ha bloccato l\'apertura della scheda. Consenti le finestre pop-up per questo sito e riprova.');
      return;
    }
    registra(w, vista);
    assicura(w, vista);
    try { w.focus(); } catch (e) {}
  }

  function registra(w, vista) {
    for (var i = 0; i < aperte.length; i++) {
      if (aperte[i].w === w) return;
    }
    aperte.push({ w: w, vista: vista });
    osserva(vista);
    if (!battito) battito = setInterval(ronda, VEGLIA);
  }

  // Costruisce (o RIcostruisce) la pagina della scheda. La ricostruzione
  // non e' un caso limite teorico: basta che l'utente prema F5 sulla
  // scheda a parte e il documento torna un about:blank vuoto. Invece di
  // lasciarla bianca finche' non cambia qualcosa nell'asta, ad ogni giro
  // si controlla se il corpo c'e' ancora e, se non c'e', si rifa'.
  function assicura(w, vista) {
    var d;
    try { d = w.document; } catch (e) { return false; }
    if (!d || !d.body) return false;
    if (!d.getElementById('ve-corpo')) costruisci(d, vista);
    aggiorna(w, vista);
    return true;
  }

  function costruisci(d, vista) {
    d.head.innerHTML = '';
    d.body.innerHTML = '';
    // Il titolo si scrive DOPO aver svuotato la testa, non prima: `d.title`
    // crea un <title> dentro <head>, e svuotare la testa se lo porterebbe
    // via. Scritto nell'ordine sbagliato la scheda restava "about:blank".
    d.title = vista.titolo + ' · FantaSbocchini';

    var meta = d.createElement('meta');
    meta.setAttribute('charset', 'utf-8');
    d.head.appendChild(meta);
    var vp = d.createElement('meta');
    vp.setAttribute('name', 'viewport');
    vp.setAttribute('content', 'width=device-width,initial-scale=1');
    d.head.appendChild(vp);

    // I fogli veri dell'app piu' i <link> di Google Fonts: due dei quattro
    // temi cambiano i caratteri, e senza questi la scheda uscirebbe in
    // Archivo mentre l'app e' in gesso o a pixel.
    var link = document.querySelectorAll('link[rel="stylesheet"],link[rel="preconnect"]');
    for (var i = 0; i < link.length; i++) {
      var c = d.createElement('link');
      c.rel = link[i].rel;
      c.href = link[i].href;
      if (link[i].crossOrigin) c.crossOrigin = link[i].crossOrigin;
      d.head.appendChild(c);
    }

    var st = d.createElement('style');
    st.textContent = CSS_SCHEDA;
    d.head.appendChild(st);

    var bar = d.createElement('header');
    bar.className = 've-bar';
    var tit = d.createElement('span');
    tit.className = 've-titolo';
    tit.textContent = vista.titolo;
    var stato = d.createElement('span');
    stato.className = 've-stato';
    stato.id = 've-stato';
    bar.appendChild(tit);
    bar.appendChild(stato);

    var corpo = d.createElement('div');
    corpo.className = 've-corpo';
    corpo.id = 've-corpo';

    d.body.appendChild(bar);
    d.body.appendChild(corpo);

    vestiti(d);
    delega(d, vista);
  }

  // Tema e classe di layout: le regole dei quattro temi sono scritte su
  // `html[data-tema=...]` e molte su `body.layout-*`, quindi senza questi
  // due attributi la scheda uscirebbe con i colori del tema di default.
  function vestiti(d) {
    var tema = document.documentElement.getAttribute('data-tema');
    if (tema) d.documentElement.setAttribute('data-tema', tema);
    d.body.className = document.body.className;
  }

  /* ══════ i click tornano al documento madre ══════ */

  // Percorso di un elemento dentro una radice, come lista di indici fra i
  // soli figli ELEMENTO. Funziona perche' lo specchio e' una copia esatta
  // dell'innerHTML: lo stesso percorso, nell'altro documento, arriva
  // all'elemento gemello.
  function percorso(radice, nodo) {
    var p = [];
    while (nodo && nodo !== radice) {
      var padre = nodo.parentNode;
      if (!padre || !padre.children) return null;
      var idx = Array.prototype.indexOf.call(padre.children, nodo);
      if (idx < 0) return null;
      p.push(idx);
      nodo = padre;
    }
    if (nodo !== radice) return null;
    return p.reverse();
  }

  function risolvi(radice, p) {
    var n = radice;
    for (var i = 0; i < p.length; i++) {
      if (!n.children || !n.children[p[i]]) return null;
      n = n.children[p[i]];
    }
    return n;
  }

  function delega(d, vista) {
    d.addEventListener('click', function (ev) {
      var corpo = d.getElementById('ve-corpo');
      var specchio = corpo && corpo.firstElementChild;
      if (!specchio) return;
      var bersaglio = ev.target;
      if (!bersaglio || bersaglio.nodeType !== 1 || !specchio.contains(bersaglio)) return;

      // Il click si ferma QUI, sempre, anche se poi non si trova il gemello.
      // Lo specchio e' una copia dell'HTML dell'app, quindi si porta dietro
      // anche gli `onclick` inline che l'app scrive nel markup
      // (`_toggleRoseSec(...)` sulle intestazioni delle Rose,
      // `chiamaLibero('p2')` sulle righe degli Svincolati): funzioni che in
      // questa scheda non esistono. Lasciandoli correre, OGNI click nello
      // specchio finiva con un ReferenceError non gestito — misurato in
      // console. Il listener e' in fase di CATTURA sul documento, quindi
      // fermando la propagazione l'evento non arriva mai all'elemento e il
      // suo handler inline non parte. Stessa tecnica con cui
      // comportamenti-asta.js sopprime il click dell'app sotto la leva.
      //
      // E' anche la regola del modulo scritta per intero: lo specchio non
      // esegue MAI niente per conto suo, agisce solo sull'elemento vero.
      ev.preventDefault();
      ev.stopPropagation();

      var fonte = document.getElementById(vista.fonte);
      var p = percorso(specchio, bersaglio);
      var gemello = (p && fonte) ? risolvi(fonte, p) : null;
      if (!gemello) return;

      gemello.click();

      // Se quel click ha aperto un modale nella scheda madre (in Svincolati
      // l'admin puo' chiamare un giocatore), la scheda madre va portata
      // davanti: altrimenti resteresti qui a fissare una lista che non
      // reagisce, con la decisione in attesa in un'altra scheda.
      setTimeout(function () {
        var m = document.getElementById('modal-overlay');
        if (m && m.className.indexOf('hidden') === -1) {
          try { window.focus(); } catch (e) {}
        }
      }, 0);
    }, true);
  }

  /* ══════ specchio ══════ */

  function aggiorna(w, vista) {
    var d;
    try { d = w.document; } catch (e) { return; }
    var corpo = d && d.getElementById('ve-corpo');
    var fonte = document.getElementById(vista.fonte);
    if (!corpo || !fonte) return;

    var specchio = corpo.firstElementChild;
    if (!specchio || specchio.tagName !== fonte.tagName) {
      corpo.innerHTML = '';
      specchio = d.createElement(fonte.tagName);
      corpo.appendChild(specchio);
    }
    // La classe si copia ad ogni giro perche' porta anche stati che
    // cambiano a caldo — `rose-compatta` sta proprio su #rose-panel.
    if (specchio.className !== fonte.className) specchio.className = fonte.className;
    if (specchio.innerHTML !== fonte.innerHTML) specchio.innerHTML = fonte.innerHTML;

    vestiti(d);
    var stato = d.getElementById('ve-stato');
    if (stato) {
      stato.className = 've-stato';
      stato.textContent = 'aggiornato alle ' + new Date().toLocaleTimeString();
    }
  }

  function aggiornaTutte(idVista) {
    for (var i = 0; i < aperte.length; i++) {
      var m = aperte[i];
      if (idVista && m.vista.id !== idVista) continue;
      if (chiusa(m.w)) continue;
      assicura(m.w, m.vista);
    }
  }

  function chiusa(w) {
    try { return w.closed; } catch (e) { return true; }
  }

  // Un osservatore per vista, montato alla prima apertura e mai smontato:
  // costa un callback per aggiornamento di stato, e solo se una scheda di
  // quella vista e' stata aperta almeno una volta.
  function osserva(vista) {
    if (osservate[vista.id]) return;
    var fonte = document.getElementById(vista.fonte);
    if (!fonte || typeof MutationObserver !== 'function') return;
    osservate[vista.id] = true;
    var mo = new MutationObserver(function () { aggiornaTutte(vista.id); });
    mo.observe(fonte, { childList: true, subtree: true, characterData: true, attributes: true });
  }

  // Il tema si cambia a caldo dal menu 🎨, senza ricaricare: senza questo
  // le schede gia' aperte resterebbero nel tema di quando sono nate.
  function osservaTema() {
    if (typeof MutationObserver !== 'function') return;
    new MutationObserver(function () {
      for (var i = 0; i < aperte.length; i++) {
        if (chiusa(aperte[i].w)) continue;
        try { vestiti(aperte[i].w.document); } catch (e) {}
      }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-tema'] });
  }

  // Giro lento: serve solo a due cose che nessun evento segnala — una
  // scheda chiusa (da togliere dall'elenco) e una scheda RICARICATA (da
  // ricostruire, altrimenti resta bianca).
  function ronda() {
    var vive = [];
    for (var i = 0; i < aperte.length; i++) {
      var m = aperte[i];
      if (chiusa(m.w)) continue;
      assicura(m.w, m.vista);
      vive.push(m);
    }
    aperte = vive;
    if (!aperte.length && battito) { clearInterval(battito); battito = null; }
  }

  // Se la scheda madre se ne va, lo specchio resterebbe li' a mostrare
  // dati vecchi senza dirlo. Meglio che lo dica.
  function congela() {
    for (var i = 0; i < aperte.length; i++) {
      if (chiusa(aperte[i].w)) continue;
      try {
        var s = aperte[i].w.document.getElementById('ve-stato');
        if (s) {
          s.className = 've-stato ve-morto';
          s.textContent = 'scheda principale chiusa — non si aggiorna piu\'';
        }
      } catch (e) {}
    }
  }

  /* ══════ avvio ══════ */

  function avvia() {
    if (montato) return;
    if (!document.getElementById('tab-rose')) return;
    iniettaStile();
    if (!montaBottoni()) return;
    montato = true;
    osservaTema();
    window.addEventListener('beforeunload', congela);
    window.addEventListener('pagehide', congela);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', avvia);
  } else {
    avvia();
  }
  window.addEventListener('load', avvia);
})();
