-- Sostituisce il campo `eta` (integer) con `data_nascita` (date) in `profiles`, su richiesta
-- esplicita dell'utente dopo il deploy della migration precedente
-- (2026-08-08_registrazione_closed_beta.sql). Sicuro: `eta` è stata introdotta nella stessa sessione
-- pochi minuti fa e nessuna registrazione reale l'ha ancora popolata.
--
-- Eseguire manualmente nell'SQL editor di Supabase prima di deployare il codice aggiornato.

alter table public.profiles
  add column if not exists data_nascita date;

alter table public.profiles
  drop column if exists eta;
