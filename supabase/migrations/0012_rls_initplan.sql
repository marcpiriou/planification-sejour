-- ============================================================
-- RLS : évaluer l'identité UNE FOIS par requête, et non par ligne
--
-- `auth.uid()` et `auth.jwt()` lisent `current_setting('request.jwt.claims')`
-- et en analysent le JSON. Écrits tels quels dans une policy ou dans le corps
-- d'une fonction inlinée, ils sont réévalués À CHAQUE LIGNE examinée. Une
-- sauvegarde qui renvoyait les cent soixante-dix activités d'un séjour payait
-- donc cent soixante-dix analyses de jeton, plus cent soixante-dix recherches
-- dans trips et trip_members.
--
-- Mesuré avant correction (pg_stat_statements, deux mois) : 428 206 blocs
-- touchés pour 495 upserts d'activités, soit 865 blocs par sauvegarde sur une
-- table qui en occupe quatorze. Le linter de Supabase le signale sous le nom
-- `auth_rls_initplan`.
--
-- Le remède documenté : envelopper l'appel dans un sous-select. Postgres le
-- reconnaît alors comme un InitPlan — une valeur constante pour toute la
-- requête — et l'évalue une seule fois. La sémantique est identique : au sein
-- d'une requête, l'identité de l'appelant ne change pas.
--
-- Rien n'est assoupli ici : les mêmes conditions portent sur les mêmes rôles.
-- Seul le MOMENT de l'évaluation change. Script idempotent, aucune donnée
-- touchée.
-- ============================================================

-- --- Les trois fonctions d'accès -----------------------------------------
-- SECURITY DEFINER et search_path conservés à l'identique (voir 0009) : la
-- policy interroge trips, dont la RLS interroge trip_members, et passer outre
-- la RLS ici évite cette récursion.
create or replace function public.can_edit_trip(tid text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from trips t where t.id = tid and t.owner_id = (select auth.uid()))
      or exists (select 1 from trip_members m where m.trip_id = tid and m.role = 'editor'
                   and lower(m.email) = lower(coalesce((select auth.jwt()) ->> 'email', '')));
$$;

create or replace function public.can_read_trip(tid text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from trips t where t.id = tid and t.owner_id = (select auth.uid()))
      or exists (select 1 from trip_members m where m.trip_id = tid
                   and lower(m.email) = lower(coalesce((select auth.jwt()) ->> 'email', '')));
$$;

create or replace function public.is_trip_owner(tid text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from trips t where t.id = tid and t.owner_id = (select auth.uid()));
$$;

revoke execute on function public.can_edit_trip(text) from public, anon;
revoke execute on function public.can_read_trip(text) from public, anon;
revoke execute on function public.is_trip_owner(text) from public, anon;
grant  execute on function public.can_edit_trip(text) to authenticated;
grant  execute on function public.can_read_trip(text) to authenticated;
grant  execute on function public.is_trip_owner(text) to authenticated;

-- --- Les policies qui appellent auth.* directement -----------------------
drop policy if exists trips_select on public.trips;
drop policy if exists trips_insert on public.trips;
drop policy if exists trips_delete on public.trips;

create policy trips_select on public.trips for select
  using ((owner_id = (select auth.uid())) or public.can_read_trip(id));

create policy trips_insert on public.trips for insert
  with check (owner_id = (select auth.uid()));

create policy trips_delete on public.trips for delete
  using (owner_id = (select auth.uid()));

-- Le propriétaire retire qui il veut ; chacun peut se retirer soi-même.
drop policy if exists members_delete on public.trip_members;

create policy members_delete on public.trip_members for delete
  using (
    public.is_trip_owner(trip_id)
    or lower(email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  );

-- --- Aucun index à ajouter ------------------------------------------------
-- Une première version de ce script créait un index sur `lower(email)` pour
-- trip_members, en croyant `trip_members_email_idx` posé sur `email` brut. Il
-- l'est déjà sur `lower(email)` : le nouvel index était un doublon exact, et le
-- linter l'a signalé comme tel. S'il est « inutilisé », c'est que la table tient
-- sur une seule page et que Postgres la parcourt plus vite qu'il ne lirait
-- l'index — pas qu'il vise la mauvaise expression. Rien à corriger, donc.
