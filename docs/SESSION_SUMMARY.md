# SESSION_SUMMARY.md

Stato corrente del progetto. Questo file è memoria di lavoro, non storico.

## Ultimo intervento — 3D campo, foto Asta, Svincolati mobile

- **Campo Anteprima 3D**: blocco CSS definitivo in coda a `style.css` che ripristina la geometria del mockup (`perspective` sullo stage, campo `rotateX(48deg)`, carte `rotateX(-48deg) translateZ`). Rimossi gli effetti che appiattivano il 3D (`filter:drop-shadow` sugli slot, `rotateY` alternati per slot pari/dispari). Aggiunti ombra di contatto, glow sul prato, spessore bordo (`::before`/`::after`) e varianti mobile con perspective/translateZ ridotti.
- **Foto giocatore in Asta**: avatar più alti (rapporto portrait), `object-fit:contain` con `height:100%` e leggero scale via `max-width/max-height:112%` — giocatore intero visibile, box più pieno, nessun crop.
- **Svincolati mobile**: con Strategia attiva il nome non collassa più — layout a wrap con `.l-nome` prioritario e badge strategia su riga dedicata sotto.

## File toccati

- `frontend/css/style.css` — unico file modificato.

## Verifica eseguita

- `node --check frontend/js/app.js`: superato.
- Server locale avviabile con `PORT=3001 npm start`.

## Prossimo passo

- Verifica visiva in browser reale: Anteprima campo 3D, card Puja durante asta, lista Svincolati su smartphone con strategia applicata.
