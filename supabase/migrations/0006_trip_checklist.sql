-- ============================================================
-- Checklist avant le départ
--
-- Une liste à cocher par séjour : préparatifs avant de partir (papiers,
-- valises, etc.). Un seul champ JSON suffit, il n'y a ni tri ni recherche à
-- faire dessus côté base — l'application lit et réécrit le tableau entier à
-- chaque modification, comme elle le fait déjà pour `place` sur une activité.
--
-- Forme des éléments : [{ id, text, done }, ...]. L'ordre du tableau est
-- l'ordre d'affichage.
--
-- Ce script est idempotent et ne touche à aucune donnée existante.
-- ============================================================

alter table public.trips add column if not exists checklist jsonb not null default '[]'::jsonb;

comment on column public.trips.checklist is
  'Checklist avant le départ : tableau JSON [{ id, text, done }, ...], ordre = ordre d''affichage.';
