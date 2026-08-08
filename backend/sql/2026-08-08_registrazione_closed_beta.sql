-- Aggiunge a `profiles` i campi necessari al nuovo flusso di registrazione (Nome, Cognome, Età,
-- accettazione Condizioni di partecipazione alla Closed Beta) senza toccare gli utenti esistenti:
-- tutti i campi sono nullable tranne terms_accepted, che defaulta a false.
--
-- Eseguire manualmente UNA VOLTA nell'SQL editor di Supabase prima di deployare il codice che usa
-- questi campi (POST /api/auth/completa-registrazione in backend/server.js).

alter table public.profiles
  add column if not exists nome text,
  add column if not exists cognome text,
  add column if not exists eta integer,
  add column if not exists terms_accepted boolean not null default false,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text;
