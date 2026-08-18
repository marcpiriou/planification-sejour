-- ============================================================
-- Commentaire d'un trajet
--
-- Le trajet vers l'étape suivante est décrit par l'étape de départ : elle porte
-- déjà son mode (`travel_mode`) et sa durée manuelle (`travel_minutes`). Le
-- commentaire les rejoint donc au même endroit — le numéro de la ligne de bus,
-- le quai, l'étage du parking, ce qu'aucun champ ne prévoit.
--
-- Texte libre, retours à la ligne compris. La timeline n'en montre que les trois
-- premières lignes, mais la troncature est un choix d'affichage : la base garde
-- le commentaire entier.
--
-- Ce script est idempotent et ne touche à aucune donnée existante.
-- ============================================================

alter table public.activities add column if not exists travel_notes text not null default '';

comment on column public.activities.travel_notes is
  'Commentaire libre sur le trajet vers l''étape suivante, affiché sous ce trajet sur la timeline.';
