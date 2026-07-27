-- ============================================================
-- Réparation des règles d'accès (RLS) sur trips / activities / trip_members
--
-- Symptôme corrigé : à l'enregistrement, la base répond
--   « new row violates row-level security policy for table "trips" »
-- ce que PostgreSQL renvoie quand la RLS est active et qu'AUCUNE policy
-- d'INSERT n'autorise la ligne — donc quand le jeu de policies attendu
-- (migration 0002) n'est pas en place dans la base.
--
-- Ce script est idempotent : il peut être rejoué sans risque, il ne
-- touche à aucune donnée, il ne fait que (re)poser colonnes, droits,
-- fonctions d'accès et policies.
-- ============================================================

-- 1. Colonne propriétaire : rattrape une 0002 qui n'aurait pas abouti
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'trips' and column_name = 'user_id')
     and not exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'trips' and column_name = 'owner_id')
  then
    execute 'alter table public.trips rename column user_id to owner_id';
  end if;
end $$;

-- 2. RLS active sur les trois tables
alter table public.trips        enable row level security;
alter table public.activities   enable row level security;
alter table public.trip_members enable row level security;

-- 3. Droits de table : la RLS filtre les lignes, encore faut-il que le rôle
--    "authenticated" ait le droit d'accéder à la table. "anon" n'a rien.
grant usage on schema public to authenticated;
grant select, insert, update, delete
  on public.trips, public.activities, public.trip_members
  to authenticated;

-- 4. Fonctions d'accès (SECURITY DEFINER : évitent la récursion trips <-> trip_members)
create or replace function public.can_read_trip(tid text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from trips t where t.id = tid and t.owner_id = auth.uid())
      or exists (select 1 from trip_members m where m.trip_id = tid
                   and lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

create or replace function public.can_edit_trip(tid text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from trips t where t.id = tid and t.owner_id = auth.uid())
      or exists (select 1 from trip_members m where m.trip_id = tid and m.role = 'editor'
                   and lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

revoke execute on function public.can_read_trip(text) from public, anon;
revoke execute on function public.can_edit_trip(text) from public, anon;
grant  execute on function public.can_read_trip(text) to authenticated;
grant  execute on function public.can_edit_trip(text) to authenticated;

-- 5. Garde-fou : un non-propriétaire ne peut pas s'approprier un séjour
create or replace function public.trips_guard_owner()
returns trigger language plpgsql set search_path = public as $$
begin
  if NEW.owner_id is distinct from OLD.owner_id and OLD.owner_id <> auth.uid() then
    raise exception 'owner_id is immutable for non-owners';
  end if;
  return NEW;
end;
$$;
drop trigger if exists trips_guard_owner_trg on public.trips;
create trigger trips_guard_owner_trg before update on public.trips
  for each row execute function public.trips_guard_owner();

-- 6. Policies : on repart d'un état propre (anciens noms compris)
drop policy if exists trips_select_own on public.trips;
drop policy if exists trips_insert_own on public.trips;
drop policy if exists trips_update_own on public.trips;
drop policy if exists trips_delete_own on public.trips;
drop policy if exists trips_select on public.trips;
drop policy if exists trips_insert on public.trips;
drop policy if exists trips_update on public.trips;
drop policy if exists trips_delete on public.trips;

create policy trips_select on public.trips for select using (public.can_read_trip(id));
create policy trips_insert on public.trips for insert with check (owner_id = auth.uid());
create policy trips_update on public.trips for update using (public.can_edit_trip(id)) with check (public.can_edit_trip(id));
create policy trips_delete on public.trips for delete using (owner_id = auth.uid());

drop policy if exists activities_select_own on public.activities;
drop policy if exists activities_insert_own on public.activities;
drop policy if exists activities_update_own on public.activities;
drop policy if exists activities_delete_own on public.activities;
drop policy if exists activities_select on public.activities;
drop policy if exists activities_insert on public.activities;
drop policy if exists activities_update on public.activities;
drop policy if exists activities_delete on public.activities;

create policy activities_select on public.activities for select using (public.can_read_trip(trip_id));
create policy activities_insert on public.activities for insert with check (public.can_edit_trip(trip_id));
create policy activities_update on public.activities for update using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));
create policy activities_delete on public.activities for delete using (public.can_edit_trip(trip_id));

drop policy if exists members_select on public.trip_members;
drop policy if exists members_insert on public.trip_members;
drop policy if exists members_update on public.trip_members;
drop policy if exists members_delete on public.trip_members;

create policy members_select on public.trip_members for select using (public.can_read_trip(trip_id));
create policy members_insert on public.trip_members for insert with check (public.can_edit_trip(trip_id));
create policy members_update on public.trip_members for update using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));
create policy members_delete on public.trip_members for delete using (
  public.can_edit_trip(trip_id) or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
);

-- 7. Vérification : doit lister 4 policies pour trips, 4 pour activities, 4 pour trip_members
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public' and tablename in ('trips', 'activities', 'trip_members')
order by tablename, cmd, policyname;
