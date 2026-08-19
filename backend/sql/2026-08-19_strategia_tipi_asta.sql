-- Permette a una Strategia di essere associata a PIÙ tipi di asta (Iniziale, Riparazione 1,
-- Riparazione 2) invece di uno solo — `strategie.tipo_asta` era una colonna scalare (un solo
-- valore per riga), quindi una strategia creata per 'iniziale' non poteva mai risultare
-- compatibile con un'asta di riparazione (uguaglianza secca in caricaStrategieCompatibili()).
--
-- Tabella ponte additiva: `strategie.tipo_asta` NON viene toccata né rimossa (resta come dato
-- storico/di fallback), il codice nuovo legge solo da questa tabella. Il backfill qui sotto
-- crea una riga per ogni strategia esistente con il suo tipo_asta attuale, cosi' le strategie
-- gia' create continuano a funzionare esattamente come prima senza bisogno di reimportarle.
--
-- Eseguire manualmente nell'SQL editor di Supabase prima di deployare il codice aggiornato.

create table if not exists public.strategia_tipi_asta (
  strategia_id uuid not null references public.strategie(id) on delete cascade,
  tipo_asta text not null,
  primary key (strategia_id, tipo_asta)
);

insert into public.strategia_tipi_asta (strategia_id, tipo_asta)
select id, tipo_asta from public.strategie
where tipo_asta is not null
on conflict (strategia_id, tipo_asta) do nothing;

-- Stessa policy RLS gia' usata da `fasce`/`strategia_giocatori` (che come questa tabella non
-- hanno una colonna user_id propria): proprietario verificato passando per strategie.user_id.
alter table public.strategia_tipi_asta enable row level security;

drop policy if exists "strategia_tipi_asta: solo propietario" on public.strategia_tipi_asta;
create policy "strategia_tipi_asta: solo propietario" on public.strategia_tipi_asta
  for all
  using (strategia_id in (select id from public.strategie where user_id = auth.uid()));
