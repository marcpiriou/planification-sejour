-- ============================================================
-- Hébergement : heure de départ indépendante par matin
--
-- Un hébergement de plusieurs nuits portait une seule heure de départ
-- (colonne start_time), appliquée à chaque matin du séjour sauf le premier.
-- La modifier depuis un jour donné changeait donc aussi le départ des autres
-- matins du même séjour, ce qui n'est pas voulu : le départ d'un matin donné
-- doit rester indépendant de celui des autres.
--
-- night_times porte les heures modifiées individuellement, indexées par la
-- date ISO du matin concerné : { "2026-08-09": "10:30", ... }. Un matin
-- absent de cette carte retombe sur start_time (comportement identique à
-- avant, préservé pour les hébergements déjà enregistrés).
--
-- Ce script est idempotent et ne touche à aucune donnée existante.
-- ============================================================

alter table public.activities add column if not exists night_times jsonb not null default '{}'::jsonb;

comment on column public.activities.night_times is
  'Heures de départ le matin propres à un hébergement, par date ISO du matin : { "AAAA-MM-JJ": "HH:MM" }. Absent d''une entrée -> repli sur start_time.';
