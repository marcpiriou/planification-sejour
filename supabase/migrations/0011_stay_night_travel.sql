-- ============================================================
-- Hébergement : trajet du matin, propre à chaque matin
--
-- Le trajet vers l'étape suivante est décrit par l'étape de départ, qui porte
-- son mode (`travel_mode`), sa durée manuelle (`travel_minutes`) et son
-- commentaire (`travel_notes`). Un hébergement de plusieurs nuits n'est pourtant
-- enregistré QU'UNE FOIS : ces trois champs s'appliquaient donc à tous ses
-- matins à la fois, alors que la destination change d'un jour à l'autre.
--
-- Le défaut était net : régler « 7 min » sur le trajet d'un matin l'imposait aux
-- suivants — 7 min pour 5,8 km, puis pour 23 km, puis pour 66 km.
--
-- night_travel porte donc ces réglages par date ISO du matin concerné :
--   { "2026-08-20": { "travelMode": "car", "travelMinutes": 7, "travelNotes": "" } }
-- Un matin absent de cette carte retombe sur les champs de l'hébergement
-- lui-même — ce qui préserve les réglages faits avant cette migration : ils
-- restent le défaut de tous les matins jusqu'à ce qu'on en règle un.
--
-- Même forme que night_times (0007) et night_arrivals (0008), qui rendent déjà
-- l'heure de départ du matin et celle d'arrivée du soir propres à chaque jour.
--
-- Ce script est idempotent et ne touche à aucune donnée existante.
-- ============================================================

alter table public.activities add column if not exists night_travel jsonb not null default '{}'::jsonb;

comment on column public.activities.night_travel is
  'Trajet du matin propre à chaque matin d''un hébergement, par date ISO : { "AAAA-MM-JJ": { travelMode, travelMinutes, travelNotes } }. Absent d''une entrée -> repli sur travel_mode / travel_minutes / travel_notes de l''hébergement.';
