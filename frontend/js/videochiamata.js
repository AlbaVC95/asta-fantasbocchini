/* ═══════════════════════════════════════════════════════════════════
   LA VIDEOCHIAMATA DENTRO L'ASTA

   Richiesta dell'utente: come su FantaLab, vedersi e sentirsi senza
   uscire dall'asta. Non si costruisce niente di video qui dentro — a
   12-22 persone l'unica architettura possibile e' un servizio di terzi
   con un server di media, e questo modulo si limita a incastonarlo.

   Additivo come clessidra.js, comportamenti-asta.js, puja-sticky.js e
   vista-esterna.js: si costruisce il suo DOM da solo e finche' nessuno
   entra in chiamata non esiste per il layout. Tolto il suo <script> da
   index.html, l'app torna esattamente com'era.

   Sei scelte che vale la pena ricordare:

   1. NON si entra da soli. Ci si entra da un bottone, e il microfono si
      accende solo dopo. Nessuno vuole ritrovarsi in diretta per il solo
      fatto di aver aperto la pagina.
   2. La stanza si ricava dall'`astaId`, come la chiave per-asta
      dell'Anteprima: tutti quelli della stessa asta cadono nella stessa
      stanza senza passarsi nessun link e senza che nessuno debba
      "crearla". Il nome che si legge sotto la faccia e' quello della
      SQUADRA, non "Ospite".
   3. La franja RISERVA il suo posto invece di galleggiarci sopra. Se
      galleggiasse coprirebbe la barra orizzontale delle Rose, che a
      fondo pagina sta a 5px dal bordo inferiore — cioe' proprio la cosa
      sistemata quando la pagina ha cominciato a scorrere. Il modulo
      scrive `--h-chiamata` su <html> e ci pensa il CSS (vedi il blocco
      in fondo a tema-serata.css).
   4. Su TELEFONO la franja in basso non si puo' fare: li' `.rilancio-box`
      e' `position:fixed;bottom:0`, cioe' il tasto RILANCIA vive
      esattamente in quel posto, ed e' l'ultimo elemento dell'app che si
      possa coprire. Su mobile la chiamata e' quindi o una pastiglia
      galleggiante appoggiata SOPRA il tasto (misurandolo, non
      indovinandone l'altezza) o uno schermo intero: su un telefono
      guardare l'asta e una griglia di facce insieme non funziona
      comunque.
   5. Negli ultimi secondi le facce si attenuano come tutto il resto.
      `comportamenti-asta.js` gia' stringe la scena su prezzo/tempo/
      azione e sfoca i crediti dei rivali (decisione presa e documentata:
      "negli ultimi secondi i crediti dei rivali si sfocano"). Una
      striscia di video a tutto colore mentre il resto si spegne
      combatterebbe contro quella regola. **L'audio non si tocca**: e'
      esattamente il momento in cui si urla.
   6. Il fornitore sta in UNA funzione (`creaConferenza`). Oggi e' Jitsi
      perche' non chiede account ne' chiave e si prova stasera; se un
      giorno servisse un servizio con garanzie, la stessa API ha una
      versione ospitata a pagamento e si cambia un dominio. Con un altro
      fornitore ancora, si riscrive quella funzione e basta.

   Lo script del fornitore si scarica solo quando qualcuno entra in
   chiamata, non ad ogni caricamento di pagina: gia' successo con la
   `fetch('/api/theme')` che ogni visitatore faceva per un editor che non
   apriva nessuno.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── il fornitore, tutto qui dentro ────────────────────────────────
  //
  // Era `meet.jit.si`, e non si poteva tenere: incastonare l'istanza
  // pubblica gratuita e' un uso "da demo" e la chiamata **si taglia dopo
  // 5 minuti**, con tanto di avviso sopra il video. Verificato dal vero.
  // Ora si usa JaaS (la versione ospitata dagli stessi che fanno Jitsi),
  // che e' la stessa identica API: cambia il dominio, l'URL dello script
  // e il fatto che serve un token firmato dal backend.
  //
  // Niente e' scritto qui a mano: dominio e AppID arrivano da
  // /api/chiamata/config. Se il server non ha le variabili d'ambiente,
  // risponde `attiva:false` e il bottone non viene nemmeno montato —
  // cosi' un deploy senza credenziali non lascia in giro un bottone che
  // non funziona.
  var CONFIG = null;

  var CHIAVE_MISURA = 'ftb_chiamata_misura';
  var CHIAVE_CAMERA = 'ftb_chiamata_camera';

  // Le quattro misure. La pastiglia non e' "spenta": sei ancora in
  // chiamata, senti e ti sentono, semplicemente non occupi schermo.
  var MISURE = [
    { id: 'pastiglia', etichetta: 'ridotta' },
    { id: 'fina',      etichetta: 'piccola' },
    { id: 'alta',      etichetta: 'media'   },
    { id: 'griglia',   etichetta: 'grande'  }
  ];

  var guscio = null, palco = null, api = null, bottoneEntra = null;
  var misura = 1, montato = false, mobile = false, inChiamata = false;
  var etichettaConteggio = null;

  function leggi(chiave, difetto) {
    try { var v = localStorage.getItem(chiave); return v === null ? difetto : v; }
    catch (e) { return difetto; }
  }
  function scrivi(chiave, valore) {
    try { localStorage.setItem(chiave, String(valore)); } catch (e) {}
  }

  /* ══════ stile ══════ */

  var CSS = [
    /* il bottone in testata, sui token del tema come il selettore 🎨 */
    '.vc-apri{display:inline-flex;align-items:center;gap:5px;background:var(--bg-elevated);',
    '  color:var(--text-secondary);border:1px solid var(--border-light);border-radius:8px;',
    '  font-family:var(--font-main);font-size:.68rem;font-weight:600;padding:3px 8px;',
    '  cursor:pointer;line-height:1.2;white-space:nowrap;transition:color .18s,border-color .18s}',
    '.vc-apri:hover{color:var(--text-primary);border-color:var(--primary-bright)}',
    '.vc-apri.dentro{color:var(--primary-bright);border-color:var(--primary-bright)}',

    /* ── la franja, su schermo grande ── */
    '.vc-guscio{position:fixed;left:0;right:0;bottom:0;z-index:760;display:flex;flex-direction:column;',
    '  background:var(--bg-card);border-top:1px solid var(--border);',
    '  transition:height .22s cubic-bezier(.22,.9,.3,1)}',
    '.vc-barra{display:flex;align-items:center;gap:8px;padding:3px 10px;flex:0 0 auto;',
    '  border-bottom:1px solid var(--border);min-height:28px}',
    '.vc-titolo{font-family:var(--font-display);font-weight:800;font-size:.7rem;',
    '  color:var(--text-primary);white-space:nowrap}',
    '.vc-conteggio{font-size:.66rem;color:var(--text-muted);white-space:nowrap}',
    '.vc-comandi{margin-left:auto;display:flex;gap:4px}',
    '.vc-btn{background:var(--bg-elevated);border:1px solid var(--border-light);',
    '  color:var(--text-secondary);border-radius:7px;width:24px;height:22px;cursor:pointer;',
    '  font-size:.72rem;line-height:1;display:flex;align-items:center;justify-content:center}',
    '.vc-btn:hover{color:var(--text-primary);border-color:var(--primary-bright)}',
    '.vc-btn[disabled]{opacity:.35;cursor:default}',
    '.vc-btn.vc-esci:hover{color:var(--danger,#ff4d2a);border-color:var(--danger,#ff4d2a)}',
    '.vc-palco{flex:1 1 auto;min-height:0;overflow:hidden}',
    '.vc-palco iframe{width:100%;height:100%;border:0;display:block}',
    /* in pastiglia il palco non si vede ma NON si smonta: uscire e rientrare
       dalla conferenza ad ogni piegatura sarebbe una disconnessione vera */
    '.vc-guscio.m-pastiglia .vc-palco{display:none}',

    /* ── gli ultimi secondi: le facce si attenuano come il resto della scena,
          l\'audio resta intatto (vedi comportamenti-asta.js) ── */
    'body.puja-urgente .vc-palco{opacity:.26;filter:blur(1px);transition:opacity .4s ease,filter .4s ease}',

    /* ── telefono: mai in fondo, li\' vive il tasto RILANCIA ── */
    '@media (max-width:768px){',
    '  .vc-guscio{left:auto;right:8px;width:auto;border:1px solid var(--border);border-radius:12px;',
    '    box-shadow:0 10px 30px rgba(0,0,0,.45)}',
    '  .vc-guscio.m-pastiglia{height:auto}',
    '  .vc-guscio.vc-intero{left:0;right:0;top:0;bottom:0;width:auto;border-radius:0;height:auto}',
    '}'
  ].join('\n');

  function iniettaStile() {
    if (document.getElementById('vc-stile')) return;
    var s = document.createElement('style');
    s.id = 'vc-stile';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ══════ misure ══════ */

  // Su schermo grande la franja riserva il posto (vedi tema-serata.css); la
  // griglia si prende la zona delle tab, che e' proprio il momento "fra un
  // giocatore e l'altro" in cui si vuole guardare la gente.
  function altezzaDi(i) {
    if (MISURE[i].id === 'pastiglia') return 30;
    if (MISURE[i].id === 'fina')      return 104;
    if (MISURE[i].id === 'alta')      return 228;
    return Math.round(Math.min(window.innerHeight * 0.58, 520));
  }

  function applicaMisura(i, salva) {
    misura = Math.max(0, Math.min(MISURE.length - 1, i));
    if (salva !== false) scrivi(CHIAVE_MISURA, misura);
    if (!guscio) return;

    for (var k = 0; k < MISURE.length; k++) guscio.classList.remove('m-' + MISURE[k].id);
    guscio.classList.add('m-' + MISURE[misura].id);

    var h = altezzaDi(misura);

    if (mobile) {
      // Niente riserva di spazio su telefono: la pagina e' gia' stretta e il
      // fondo e' del tasto RILANCIA. La pastiglia si appoggia SOPRA di lui,
      // misurandolo invece di indovinarne l'altezza (cambia con il layout).
      document.documentElement.style.setProperty('--h-chiamata', '0px');
      var rb = document.getElementById('rilancio-box');
      var sotto = (rb && !rb.classList.contains('hidden'))
        ? Math.round(rb.getBoundingClientRect().height) + 8 : 8;
      guscio.style.bottom = sotto + 'px';
      var intero = MISURE[misura].id === 'griglia' || MISURE[misura].id === 'alta';
      guscio.classList.toggle('vc-intero', intero);
      guscio.style.height = intero ? '' : (h + 'px');
    } else {
      guscio.classList.remove('vc-intero');
      guscio.style.bottom = '0px';
      guscio.style.height = h + 'px';
      document.documentElement.style.setProperty('--h-chiamata', h + 'px');
    }

    var giu = guscio.querySelector('.vc-giu'), su = guscio.querySelector('.vc-su');
    if (giu) giu.disabled = (misura === 0);
    if (su)  su.disabled  = (misura === MISURE.length - 1);
  }

  /* ══════ DOM ══════ */

  function bottone(cls, testo, titolo, onclick) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'vc-btn ' + cls; b.textContent = testo; b.title = titolo;
    b.addEventListener('click', function (ev) { ev.preventDefault(); onclick(); });
    return b;
  }

  function costruisci() {
    guscio = document.createElement('div');
    guscio.className = 'vc-guscio';
    guscio.id = 'vc-guscio';

    var barra = document.createElement('div');
    barra.className = 'vc-barra';
    var tit = document.createElement('span');
    tit.className = 'vc-titolo';
    tit.textContent = '🎥 Chiamata';
    etichettaConteggio = document.createElement('span');
    etichettaConteggio.className = 'vc-conteggio';
    etichettaConteggio.textContent = 'connessione…';

    var comandi = document.createElement('div');
    comandi.className = 'vc-comandi';
    comandi.appendChild(bottone('vc-giu', '−', 'Piu\' piccola', function () { applicaMisura(misura - 1); }));
    comandi.appendChild(bottone('vc-su',  '+', 'Piu\' grande',  function () { applicaMisura(misura + 1); }));
    comandi.appendChild(bottone('vc-esci', '✕', 'Esci dalla chiamata', esci));

    barra.appendChild(tit);
    barra.appendChild(etichettaConteggio);
    barra.appendChild(comandi);

    palco = document.createElement('div');
    palco.className = 'vc-palco';

    guscio.appendChild(barra);
    guscio.appendChild(palco);
    document.body.appendChild(guscio);
  }

  /* ══════ il fornitore ══════ */

  function caricaScript() {
    return new Promise(function (risolvi, rifiuta) {
      if (window.JitsiMeetExternalAPI) return risolvi();
      var s = document.createElement('script');
      // In JaaS lo script sta sotto il proprio AppID, non alla radice.
      s.src = 'https://' + CONFIG.dominio + '/' + CONFIG.appId + '/external_api.js';
      s.onload = function () {
        if (window.JitsiMeetExternalAPI) risolvi();
        else rifiuta(new Error('script caricato ma API assente'));
      };
      s.onerror = function () { rifiuta(new Error('script non raggiungibile')); };
      document.head.appendChild(s);
    });
  }

  // Solo lettere e cifre, come il backend: il nome finisce dentro al claim
  // `room` del token firmato, e i due devono coincidere esattamente.
  function nomeStanza() {
    var id = '';
    try { id = S.astaId || ''; } catch (e) {}
    return ('fantasbocchini' + (id || 'senzaasta')).replace(/[^A-Za-z0-9]/g, '').slice(0, 80);
  }

  function mioNome() {
    try { return S.miaSquadra || 'Ospite'; } catch (e) { return 'Ospite'; }
  }

  // Il token lo firma il backend con la chiave privata di JaaS, che non
  // deve mai passare per il browser. Richiede il login: chi e' in un'asta
  // ce l'ha gia', e cosi' la quota di dispositivi del piano non e'
  // bruciabile da chiunque trovi l'indirizzo.
  function chiediToken() {
    var intestazioni = {};
    try {
      return _headerAuthExports().then(function (h) {
        intestazioni = h || {};
        return fetch('/api/chiamata/token?stanza=' + encodeURIComponent(nomeStanza()) +
                     '&nome=' + encodeURIComponent(mioNome()), { headers: intestazioni });
      }).then(function (r) {
        if (!r.ok) throw new Error(r.status === 401 ? 'serve il login' : 'token rifiutato (' + r.status + ')');
        return r.json();
      }).then(function (d) { return d.jwt; });
    } catch (e) {
      return Promise.reject(new Error('non si riesce a leggere la sessione'));
    }
  }

  // L'UNICO punto che sa quale servizio c'e' dietro. Cambiare fornitore
  // vuol dire riscrivere questa funzione, niente altro.
  function creaConferenza(nodo, jwt) {
    var cameraAccesa = leggi(CHIAVE_CAMERA, '0') === '1';
    return new window.JitsiMeetExternalAPI(CONFIG.dominio, {
      // In JaaS la stanza va sempre preceduta dall'AppID: e' quello che
      // tiene separate le stanze di un cliente da quelle di un altro.
      roomName: CONFIG.appId + '/' + nomeStanza(),
      jwt: jwt,
      parentNode: nodo,
      userInfo: { displayName: mioNome() },
      configOverwrite: {
        // Il microfono si': si entra per parlare. La camera segue la scelta
        // dell'ultima volta su QUESTO dispositivo, cosi' il clic si fa una
        // volta sola — stesso criterio del tema e dello zoom del campo.
        startWithAudioMuted: false,
        startWithVideoMuted: !cameraAccesa,
        prejoinPageEnabled: false,
        disableDeepLinking: true
      },
      interfaceConfigOverwrite: {
        TOOLBAR_BUTTONS: ['microphone', 'camera', 'tileview', 'settings', 'hangup'],
        SHOW_JITSI_WATERMARK: false,
        DISABLE_JOIN_LEAVE_NOTIFICATIONS: true
      }
    });
  }

  function aggiornaConteggio() {
    if (!etichettaConteggio) return;
    var n = 0;
    try { n = api ? api.getNumberOfParticipants() : 0; } catch (e) { n = 0; }
    etichettaConteggio.textContent = n === 1 ? 'sei solo, per ora' : n + ' in chiamata';
  }

  /* ══════ entrare e uscire ══════ */

  function entra() {
    if (inChiamata) { applicaMisura(Math.max(misura, 1)); return; }
    var haAsta = false;
    try { haAsta = !!S.astaId; } catch (e) {}
    if (!haAsta) { alert('La chiamata si apre da dentro un\'asta.'); return; }

    inChiamata = true;
    if (bottoneEntra) { bottoneEntra.classList.add('dentro'); bottoneEntra.disabled = true; }
    if (!guscio) costruisci();
    applicaMisura(parseInt(leggi(CHIAVE_MISURA, '1'), 10) || 1, false);
    if (etichettaConteggio) etichettaConteggio.textContent = 'connessione…';

    caricaScript().then(chiediToken).then(function (jwt) {
      palco.innerHTML = '';
      api = creaConferenza(palco, jwt);
      api.addEventListener('videoConferenceJoined', aggiornaConteggio);
      api.addEventListener('participantJoined', aggiornaConteggio);
      api.addEventListener('participantLeft', aggiornaConteggio);
      // la scelta della camera si ricorda: al secondo ingresso non si riclicca
      api.addEventListener('videoMuteStatusChanged', function (e) {
        scrivi(CHIAVE_CAMERA, e && e.muted ? '0' : '1');
      });
      api.addEventListener('readyToClose', esci);
      if (bottoneEntra) bottoneEntra.disabled = false;
    }).catch(function (err) {
      inChiamata = false;
      if (bottoneEntra) { bottoneEntra.classList.remove('dentro'); bottoneEntra.disabled = false; }
      smonta();
      // niente toast: `toast()` vive in app.js e questo modulo non lo presuppone.
      // Il consiglio cambia con la causa: mandare chi ha solo la sessione
      // scaduta a controllare il firewall e' un giro a vuoto garantito.
      var consiglio = /login|sessione/i.test(err.message)
        ? 'Esci e rientra con il tuo account, poi riprova.'
        : 'Se sei dietro a una rete che blocca i servizi di videoconferenza, provala da un\'altra connessione.';
      alert('Non si riesce a entrare nella videochiamata (' + err.message + ').\n' + consiglio);
    });
  }

  function esci() {
    try { if (api) api.dispose(); } catch (e) {}
    api = null;
    inChiamata = false;
    if (bottoneEntra) { bottoneEntra.classList.remove('dentro'); bottoneEntra.disabled = false; }
    smonta();
  }

  function smonta() {
    document.documentElement.style.setProperty('--h-chiamata', '0px');
    if (guscio) { guscio.remove(); guscio = null; palco = null; etichettaConteggio = null; }
  }

  /* ══════ avvio ══════ */

  function sincronizzaMobile() {
    var eraMobile = mobile;
    mobile = window.matchMedia('(max-width:768px)').matches;
    if (guscio && eraMobile !== mobile) applicaMisura(misura, false);
    else if (guscio && mobile) applicaMisura(misura, false); // il tasto RILANCIA cambia altezza
  }

  // Il bottone si monta SOLO se il server dice che la chiamata e'
  // configurata. Senza le variabili d'ambiente di JaaS non compare
  // niente: meglio nessun bottone che un bottone che non funziona —
  // esattamente quello che era finito in produzione con l'istanza
  // pubblica che tagliava a 5 minuti.
  function avvia() {
    if (montato) return;
    if (!document.querySelector('.asta-header-right')) return;
    montato = true;
    fetch('/api/chiamata/config')
      .then(function (r) { return r.ok ? r.json() : { attiva: false }; })
      .then(function (c) {
        if (!c || !c.attiva || !c.appId || !c.dominio) return;
        CONFIG = c;
        monta();
      })
      .catch(function () { /* senza config, nessun bottone: silenzio */ });
  }

  function monta() {
    var ancora = document.querySelector('.asta-header-right');
    if (!ancora || document.querySelector('.vc-apri')) return;
    iniettaStile();

    bottoneEntra = document.createElement('button');
    bottoneEntra.type = 'button';
    bottoneEntra.className = 'vc-apri';
    bottoneEntra.title = 'Entra nella videochiamata dell\'asta';
    bottoneEntra.textContent = '🎥 Chiamata';
    bottoneEntra.addEventListener('click', function (ev) { ev.preventDefault(); entra(); });
    ancora.insertBefore(bottoneEntra, ancora.firstChild);

    sincronizzaMobile();
    window.matchMedia('(max-width:768px)').addEventListener('change', sincronizzaMobile);
    window.addEventListener('resize', function () { if (guscio) applicaMisura(misura, false); });
    window.addEventListener('pagehide', function () { try { if (api) api.dispose(); } catch (e) {} });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', avvia);
  } else {
    avvia();
  }
  window.addEventListener('load', avvia);
})();
