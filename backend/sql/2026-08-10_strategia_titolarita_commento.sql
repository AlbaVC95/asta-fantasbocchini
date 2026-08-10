-- Aggiunge a `strategia_giocatori` due campi personali per giocatore, editabili
-- dall'utente nell'editor Strategia e mostrati in sola lettura in Asta alla chiamata:
-- `titolarita` (valutazione 1-5, stelle) e `commento` (nota libera, stile commento Excel).
-- Stesso pattern di `preferito`/`prezzo`/`percentuale` già presenti sulla stessa tabella:
-- dati personali della Strategia dell'utente, non condivisi tra partecipanti.
--
-- Eseguire manualmente nell'SQL editor di Supabase prima di deployare il codice aggiornato.

alter table public.strategia_giocatori
  add column if not exists titolarita smallint,
  add column if not exists commento text;

alter table public.strategia_giocatori
  drop constraint if exists strategia_giocatori_titolarita_range;

alter table public.strategia_giocatori
  add constraint strategia_giocatori_titolarita_range
  check (titolarita is null or (titolarita between 1 and 5));
