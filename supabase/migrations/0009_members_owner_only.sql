-- ============================================================
-- Gestion des accès réservée au propriétaire du séjour
--
-- Les policies d'écriture sur trip_members étaient conditionnées à
-- can_edit_trip(), c'est-à-dire satisfaites par un simple ÉDITEUR. Un
-- collaborateur pouvait donc, en appelant l'API REST directement :
--   • inviter qui il voulait, y compris en éditeur (rouvrir le séjour à des
--     tiers, sans l'accord du propriétaire) ;
--   • changer le rôle des autres membres ;
--   • retirer l'accès des autres collaborateurs.
--
-- L'interface ne le proposait qu'à demi, mais elle n'est pas la barrière : la
-- RLS l'est. Écrire dans trip_members relève désormais de la seule propriété.
--
-- Ce qui NE change pas :
--   • members_select reste ouverte à qui peut lire le séjour — l'écran de
--     partage doit pouvoir afficher la liste des accès à tous les membres ;
--   • un membre peut toujours se retirer LUI-MÊME (bouton « Quitter ce séjour
--     partagé »), d'où la clause sur son propre email dans members_delete ;
--   • les droits sur trips et activities sont inchangés : un éditeur continue
--     de modifier librement le contenu du séjour.
--
-- Ce script est idempotent et ne touche à aucune donnée existante.
-- ============================================================

-- SECURITY DEFINER comme can_read_trip/can_edit_trip, et pour la même raison :
-- la policy interroge trips, dont la RLS interroge trip_members. Passer outre
-- la RLS ici évite cette récursion. set search_path : une fonction en
-- SECURITY DEFINER ne doit pas dépendre du chemin de recherche de l'appelant.
create or replace function public.is_trip_owner(tid text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from trips t where t.id = tid and t.owner_id = auth.uid());
$$;

revoke execute on function public.is_trip_owner(text) from public, anon;
grant  execute on function public.is_trip_owner(text) to authenticated;

drop policy if exists members_insert on public.trip_members;
drop policy if exists members_update on public.trip_members;
drop policy if exists members_delete on public.trip_members;

create policy members_insert on public.trip_members for insert
  with check (public.is_trip_owner(trip_id));

create policy members_update on public.trip_members for update
  using (public.is_trip_owner(trip_id))
  with check (public.is_trip_owner(trip_id));

-- Le propriétaire retire qui il veut ; chacun peut se retirer soi-même.
create policy members_delete on public.trip_members for delete
  using (
    public.is_trip_owner(trip_id)
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
