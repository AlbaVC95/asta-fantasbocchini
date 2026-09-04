# Session Summary

## Stato attuale

Risolto il problema del taglio dei crediti residui (budget) nel pannello "Mio Team" (vista Admin) quando l'Anteprima è aperta e il nome squadra è lungo.

## Cosa è cambiato

- **`frontend/css/style.css`**: 
  - Aggiunto il troncamento automatico con puntini di sospensione (`text-overflow: ellipsis`, `overflow: hidden`, `white-space: nowrap`) per l'elemento `.mio-nome`.
  - Assicurato che il budget mantenga la sua larghezza intatta (`flex-shrink: 0` su `.crediti-badge`). In questo modo, quando il pannello laterale Anteprima comprime la pagina, è il nome della squadra (lungo) a tagliarsi con "..." invece di spingere fuori il numero dei crediti che è l'informazione fondamentale.
- **`frontend/index.html`**: Cache-busting aggiornato a `20260904142100`.

## Pendenze

Nessuna.

## Prossimo passo

Fine.
