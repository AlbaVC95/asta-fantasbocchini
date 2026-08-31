/* ═══════════════════════════════════════════════════════════════════
   LA STRISCIA DI PUJA — la scena in miniatura, quando la scena vera
   e' scorsa via

   Problema misurato (finestra 1100x800, vista Partecipante, senza
   nemmeno aprire Anteprima): scorrendo la colonna per guardare Rose o
   Storico, il tasto RILANCIA finisce a -137px e la carta sparisce.
   Resti a guardare le squadre senza poter rilanciare e senza sapere
   quanto tempo manca. Su mobile a 390px e' identico (-88px).

   Contiene le stesse cose della carta grande, nell'ordine in cui
   servono per decidere: chi e' (foto, ruoli, squadra), cosa dice la tua
   Strategia su di lui, a quanto sta e CHI ha fatto l'ultima offerta,
   quanto tempo resta, e il tasto per rilanciare.

   Questo modulo e' ADDITIVO come clessidra.js e comportamenti-asta.js:
   si costruisce il suo DOM da solo, non tocca nessun elemento esistente
   e finche' il tasto vero e' raggiungibile resta `display:none`.
   Verificato: 8 combinazioni vista x tema, 11 elementi ciascuna, zero
   differenze rispetto all'app senza il modulo. Se lo togli
   dall'index.html, l'app torna esattamente com'era.

   Due scelte che tengono il modulo onesto:

   1. NON manda rilanci. Il suo tasto fa `.click()` sul VERO
      `#btn-rilancio`, quindi passa dal listener dell'app
      (`inviaRilancioRapido`) e da tutti i suoi controlli. Un solo
      percorso: verificato che i due producano lo STESSO payload sul
      socket (`{astaId, offerta:188}`). Un `.click()` programmatico non
      fa scattare la soppressione della "leva" di
      comportamenti-asta.js, che si arma solo su una pressione vera.
   2. NON calcola niente. Legge i valori gia' scritti nel DOM dalla
      carta di puja, come fa la clessidra col cronometro.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var RITMO = 250;   // ms fra un allineamento e l'altro, solo mentre la striscia si vede
  var VEGLIA = 500;  // ms fra un controllo e l'altro, sempre: vedi nota su `sentinella`

  // Quanto tasto deve restare visibile perche' la striscia NON serva.
  //
  // Ci sono voluti due tentativi sbagliati per arrivarci, tutti e due segnalati
  // dall'utente o misurati:
  //
  //  1. Percentuale (60%): in Admin a 1100x800 il tasto e' alto 134px e a riposo
  //     ne restano visibili 74, cioe' il 55% — la striscia restava accesa in
  //     permanenza, peggio del problema che risolve.
  //  2. Pixel fissi (44, la misura minima di un bersaglio toccabile): in Admin a
  //     1470x900 lo STESSO tasto e' alto 35px e si vede tutto, ma 35 < 44 e la
  //     striscia compariva su un bottone perfettamente cliccabile.
  //
  // L'errore era confondere due cose diverse: quanto e' grande il bottone e
  // quanta parte se ne vede. L'altezza del tasto cambia moltissimo col layout
  // (35px o 134px a seconda di vista e larghezza), quindi la soglia non puo'
  // essere ne' una percentuale sola ne' un numero fisso: e'
  //     min(44px, altezza del tasto)
  // cioe' "ti servono 44px di bottone, oppure tutto il bottone se e' piu' basso
  // di 44". Cosi' un tasto interamente visibile non fa mai comparire la striscia,
  // qualunque altezza abbia, e un tasto tagliato la fa comparire sempre.
  var MIN_TOCCABILE = 44;
  var TOLLERANZA = 2;   // px: evita che un pixel di taglio faccia sfarfallare la striscia

  var barra = null, battito = null, sentinella = null, montata = false;

  function el(tag, cls, testo) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (testo != null) e.textContent = testo;
    return e;
  }

  function costruisci() {
    barra = el('div', 'puja-sticky');
    barra.id = 'puja-sticky';
    barra.setAttribute('aria-hidden', 'true');

    // ── chi e': foto, nome, ruoli, squadra, strategia
    var chi = el('div', 'ps-chi');
    var foto = document.createElement('img');
    foto.className = 'ps-foto';
    foto.alt = '';
    chi.appendChild(foto);
    var testi = el('div', 'ps-testi');
    var rigaNome = el('div', 'ps-riga-nome');
    rigaNome.appendChild(el('span', 'ps-ruoli'));
    rigaNome.appendChild(el('span', 'ps-nome'));
    testi.appendChild(rigaNome);
    var rigaMeta = el('div', 'ps-riga-meta');
    rigaMeta.appendChild(el('span', 'ps-squadra'));
    rigaMeta.appendChild(el('span', 'ps-strategia'));
    testi.appendChild(rigaMeta);
    chi.appendChild(testi);

    // ── a quanto sta, e chi ce l'ha
    var soldi = el('div', 'ps-soldi');
    soldi.appendChild(el('span', 'ps-offerta'));
    soldi.appendChild(el('span', 'ps-offerente'));

    // ── quanto manca, e il tasto
    var destra = el('div', 'ps-destra');
    destra.appendChild(el('span', 'ps-timer'));
    var btn = el('button', 'ps-rilancia');
    btn.type = 'button';
    btn.id = 'ps-rilancia';
    // Non emette niente: gira il click al bottone vero. Vedi la nota in testa.
    btn.addEventListener('click', function () {
      var vero = document.getElementById('btn-rilancio');
      if (vero && !vero.disabled) vero.click();
    });
    destra.appendChild(btn);

    barra.appendChild(chi);
    barra.appendChild(soldi);
    barra.appendChild(destra);
    document.body.appendChild(barra);
  }

  // C'e' una puja in corso? Si guarda il DOM, non lo stato dell'app.
  // Non per gusto di disaccoppiare: `S` in app.js e' un `const` di primo livello,
  // quindi vive nel lexical environment globale ma NON e' una proprieta' di
  // `window` — un controllo su `window.S` risulta sempre falso e la striscia non
  // comparirebbe mai. (Preso cosi', misurando.)
  function pujaInCorso() {
    var carta = document.getElementById('chiamata-card');
    var box = document.getElementById('rilancio-box');
    if (!carta || !box) return false;
    if (!carta.classList.contains('attiva')) return false;
    return getComputedStyle(box).display !== 'none';
  }

  function scriviSe(sel, valore) {
    var e = barra.querySelector(sel);
    if (!e) return;
    var v = valore == null ? '' : String(valore).trim();
    if (e.textContent !== v) e.textContent = v;
    e.classList.toggle('vuoto', !v);
  }

  function allinea() {
    if (!barra) return;
    var carta = document.getElementById('chiamata-card');
    if (!carta) return;

    // — la foto: la stessa che la carta ha gia' risolto, cosi' la striscia non
    //   rifa' la catena di ricerca ne' scarica un'immagine in piu'
    var img = carta.querySelector('.cc-avatar-img');
    var foto = barra.querySelector('.ps-foto');
    var src = img ? img.getAttribute('src') : '';
    if (src && foto.getAttribute('src') !== src) foto.setAttribute('src', src);
    foto.classList.toggle('vuoto', !src);

    scriviSe('.ps-nome', (carta.querySelector('.cc-nome') || {}).textContent);
    scriviSe('.ps-squadra', (carta.querySelector('.cc-club') || {}).textContent);

    // — i ruoli: si ricopiano i badge veri, cosi' tengono la loro codifica colore
    //   (che nei quattro temi e' diversa) senza doverla ridichiarare qui
    var ruoli = barra.querySelector('.ps-ruoli');
    var badges = carta.querySelectorAll('.badge-ruolo');
    var firma = Array.prototype.map.call(badges, function (b) {
      return b.className + ':' + b.textContent;
    }).join(',');
    if (ruoli.dataset.firma !== firma) {
      ruoli.dataset.firma = firma;
      ruoli.textContent = '';
      Array.prototype.forEach.call(badges, function (b) { ruoli.appendChild(b.cloneNode(true)); });
    }

    // — la Strategia: solo la riga della fascia, che e' quella che orienta la
    //   decisione. Si prende il testo del <p> e il suo colore, e MAI il <button>
    //   del commento: copiarlo porterebbe un bersaglio senza il suo gestore,
    //   cioe' un bottone che non fa niente.
    var strat = barra.querySelector('.ps-strategia');
    var fonte = carta.querySelector('p.cc-strategia-info');
    var testoStrat = fonte ? (fonte.textContent || '').trim() : '';
    if (strat.dataset.testo !== testoStrat) {
      strat.dataset.testo = testoStrat;
      strat.textContent = testoStrat;
      var col = fonte ? (fonte.style.borderColor || '') : '';
      strat.style.setProperty('--ps-fascia', col || 'transparent');
      strat.classList.toggle('vuoto', !testoStrat);
      strat.classList.toggle('con-fascia', !!col);
    }

    scriviSe('.ps-offerta', (carta.querySelector('.cc-offerta') || {}).textContent);
    var chi = (carta.querySelector('.cc-offerente') || {}).textContent || '';
    scriviSe('.ps-offerente', chi.replace(/^Offerta di:\s*/i, ''));

    var timer = document.querySelector('#screen-asta .timer-number');
    scriviSe('.ps-timer', timer ? timer.textContent : '');

    var vero = document.getElementById('btn-rilancio');
    var btn = barra.querySelector('.ps-rilancia');
    btn.disabled = !(vero && !vero.disabled);
    var etichetta = vero ? (vero.textContent || '').trim() : '';
    if (btn.textContent !== (etichetta || 'Rilancia')) btn.textContent = etichetta || 'Rilancia';
  }

  function mostra(si) {
    if (!barra) return;
    if (si === barra.classList.contains('visibile')) return;
    barra.classList.toggle('visibile', si);
    barra.setAttribute('aria-hidden', si ? 'false' : 'true');
    document.body.classList.toggle('ha-puja-sticky', si);
    if (si) {
      allinea();
      if (!battito) battito = setInterval(function () { allinea(); ricalcola(); }, RITMO);
    } else if (battito) {
      clearInterval(battito); battito = null;
    }
  }

  // Si guarda il TASTO, non il riquadro che lo contiene e nemmeno la carta: il
  // criterio giusto non e' "si vede il giocatore" ma "posso ancora premere".
  // Misurato: col riquadro, a scroll finito restavano visibili 34px dei suoi 226
  // — quindi "interseca", la striscia non compariva, e intanto il tasto era gia'
  // fuori schermo. Il contenitore mente sul suo contenuto.
  //
  // Perche' NON un IntersectionObserver, che sarebbe la scelta ovvia: quando la
  // pagina non e' visibile l'observer riporta intersezione ZERO per qualunque
  // elemento, quindi lo stato dipenderebbe da se la scheda e' in primo piano.
  // Col rettangolo il calcolo e' lo stesso sempre, e soprattutto e' verificabile.
  function altezzaVisibile(e) {
    var r = e.getBoundingClientRect();
    if (r.height <= 0) return 0;
    return Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
  }

  function ricalcola() {
    var btn = document.getElementById('btn-rilancio');
    if (!btn) { mostra(false); return; }
    var alto = btn.getBoundingClientRect().height;
    var soglia = Math.min(MIN_TOCCABILE, alto);
    mostra(altezzaVisibile(btn) + TOLLERANZA < soglia && pujaInCorso());
  }

  // Throttle a tempo e NON con requestAnimationFrame: rAF non viene servito
  // quando la pagina non e' visibile, quindi con un rAF la striscia resterebbe
  // congelata sull'ultimo stato — ed e' anche il motivo per cui non si riusciva
  // a verificarla. 16ms = un fotogramma, e il lavoro per volta e' una sola
  // lettura di rettangolo.
  var ultimo = 0, rinvio = null;
  function ricalcolaAppena() {
    var ora = Date.now();
    if (ora - ultimo >= 16) { ultimo = ora; ricalcola(); return; }
    if (rinvio) return;
    rinvio = setTimeout(function () { rinvio = null; ultimo = Date.now(); ricalcola(); }, 16);
  }

  function aggancia() {
    if (!document.getElementById('btn-rilancio')) return false;
    // capture: lo scroll non risale dagli elementi, ma in fase di cattura passa
    // comunque da document. Cosi' una sola riga copre sia la colonna che scorre
    // su desktop sia la pagina che scorre su mobile.
    document.addEventListener('scroll', ricalcolaAppena, true);
    window.addEventListener('resize', ricalcolaAppena);
    window.addEventListener('orientationchange', ricalcolaAppena);
    // Battito lento SEMPRE acceso, anche a striscia nascosta: se sei gia' in
    // fondo alla pagina e viene chiamato un giocatore nuovo non c'e' nessuno
    // scroll che faccia scattare il controllo, e senza questo resteresti senza
    // tasto fino al primo movimento. (Misurato: riaggiungendo `attiva` alla
    // carta la striscia non tornava.) Costa una lettura di rettangolo ogni
    // mezzo secondo.
    if (!sentinella) sentinella = setInterval(ricalcola, VEGLIA);
    ricalcola();
    return true;
  }

  function avvia() {
    if (montata) return;
    if (!document.getElementById('btn-rilancio')) return;
    costruisci();
    if (!aggancia()) { barra.remove(); barra = null; return; }
    montata = true;
    document.addEventListener('visibilitychange', ricalcolaAppena);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', avvia);
  } else {
    avvia();
  }
  window.addEventListener('load', avvia);
})();
