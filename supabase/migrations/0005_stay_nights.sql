-- ============================================================
-- Activités « Dormir » : une réservation, plusieurs nuits
--
-- Une activité de catégorie 'dormir' représente un hébergement réservé sur
-- plusieurs nuits. Elle est enregistrée UNE seule fois, à sa date d'arrivée,
-- et le nombre de nuits suffit à en déduire tout le reste : l'application
-- l'affiche en fin de chaque journée où l'on y dort, et en début de chaque
-- journée suivante — on part toujours du lieu où l'on a dormi.
--
-- 'nights' reste nul pour toutes les autres catégories.
--
-- Ce script est idempotent et ne touche à aucune donnée existante.
-- ============================================================

alter table public.activities add column if not exists nights integer;

comment on column public.activities.nights is
  'Nombre de nuits pour une activité de catégorie ''dormir'' ; nul sinon. La date de départ vaut date + nights.';
