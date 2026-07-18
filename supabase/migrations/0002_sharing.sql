-- ============================================================
-- Partage de séjours entre utilisateurs
-- - trips.user_id devient trips.owner_id (le propriétaire)
-- - table trip_members : partage par email, rôle editor|viewer
-- - accès via fonctions SECURITY DEFINER (évite la récursion RLS)
-- ============================================================

-- 1. Renommer la colonne propriétaire pour plus de clarté
alter table public.trips rename column user_id to owner_id;

-- 2. Les activités n'ont plus besoin de propriétaire propre :
--    l'accès découle du séjour (trip_id) via la RLS.
alter table public.activities drop column if exists user_id;

-- 3. Table des membres (partage par email)
create table if not exists public.trip_members (
  id uuid primary key default gen_random_uuid(),
  trip_id text not null references public.trips(id) on delete cascade,
  email text not null,
  role text not null default 'editor' check (role in ('editor', 'viewer')),
  invited_by uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists trip_members_trip_email_uidx
  on public.trip_members (trip_id, lower(email));
create index if not exists trip_members_trip_id_idx on public.trip_members(trip_id);
create index if not exists trip_members_email_idx on public.trip_members(lower(email));

alter table public.trip_members enable row level security;

-- 4. Fonctions d'accès (SECURITY DEFINER : contournent la RLS en interne
--    pour éviter toute récursion entre trips et trip_members)
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

-- 5. Empêcher un non-propriétaire de changer le propriétaire d'un séjour
create or replace function public.trips_guard_owner()
returns trigger language plpgsql as $$
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

-- 6. Policies : trips
drop policy if exists trips_select_own on public.trips;
drop policy if exists trips_insert_own on public.trips;
drop policy if exists trips_update_own on public.trips;
drop policy if exists trips_delete_own on public.trips;

create policy trips_select on public.trips for select using (public.can_read_trip(id));
create policy trips_insert on public.trips for insert with check (owner_id = auth.uid());
create policy trips_update on public.trips for update using (public.can_edit_trip(id)) with check (public.can_edit_trip(id));
create policy trips_delete on public.trips for delete using (owner_id = auth.uid());

-- 7. Policies : activities (accès dérivé du séjour)
drop policy if exists activities_select_own on public.activities;
drop policy if exists activities_insert_own on public.activities;
drop policy if exists activities_update_own on public.activities;
drop policy if exists activities_delete_own on public.activities;

create policy activities_select on public.activities for select using (public.can_read_trip(trip_id));
create policy activities_insert on public.activities for insert with check (public.can_edit_trip(trip_id));
create policy activities_update on public.activities for update using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));
create policy activities_delete on public.activities for delete using (public.can_edit_trip(trip_id));

-- 8. Policies : trip_members
--    - lecture : quiconque peut lire le séjour voit la liste des membres
--    - invitation / changement de rôle : propriétaire ou éditeur
--    - suppression : propriétaire/éditeur, ou un membre se retire lui-même
create policy members_select on public.trip_members for select using (public.can_read_trip(trip_id));
create policy members_insert on public.trip_members for insert with check (public.can_edit_trip(trip_id));
create policy members_update on public.trip_members for update using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));
create policy members_delete on public.trip_members for delete using (
  public.can_edit_trip(trip_id) or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
);
