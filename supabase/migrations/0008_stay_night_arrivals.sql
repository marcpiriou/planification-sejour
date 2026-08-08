-- ============================================================
-- Hébergement : heure d'arrivée le soir, réglable et indépendante par soir
--
-- Symétrique à night_times (0007) côté départ : l'arrivée du soir se calculait
-- jusqu'ici toujours par trajet depuis l'étape précédente (AUTO), sans
-- possibilité de la fixer à la main.
--
-- arrive_time porte le réglage par défaut d'un hébergement (nul pour les
-- hébergements enregistrés avant cette carte, qui gardent donc le calcul par
-- trajet tant qu'on n'y touche pas) ; night_arrivals porte les heures
-- modifiées individuellement, indexées par la date ISO du soir concerné :
-- { "2026-08-09": "19:30", ... }. Un soir absent de cette carte retombe sur
-- arrive_time, puis sur le calcul par trajet si arrive_time est nul aussi.
--
-- Ce script est idempotent et ne touche à aucune donnée existante.
-- ============================================================

alter table public.activities add column if not exists arrive_time text;
alter table public.activities add column if not exists night_arrivals jsonb not null default '{}'::jsonb;

comment on column public.activities.arrive_time is
  'Heure d''arrivée le soir par défaut d''un hébergement ; nul -> calculée par trajet (comportement antérieur à cette carte, préservé pour les hébergements déjà enregistrés).';
comment on column public.activities.night_arrivals is
  'Heures d''arrivée le soir propres à un hébergement, par date ISO du soir : { "AAAA-MM-JJ": "HH:MM" }. Absent d''une entrée -> repli sur arrive_time.';
