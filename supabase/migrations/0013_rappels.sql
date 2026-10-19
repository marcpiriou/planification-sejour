-- ============================================================
-- Rappels d'activité : une notification sur le téléphone, N minutes avant
-- chaque étape d'un séjour.
--
-- Un navigateur ne sait pas programmer une notification à l'avance : aucune
-- minuterie locale ne survit à la fermeture de l'application. Le rappel part
-- donc du SERVEUR, par Web Push, à l'heure dite. Quatre tables :
--
--   • push_subscriptions — les appareils d'un utilisateur (un abonnement par
--     navigateur), tels que les décrit l'API Push ;
--   • trip_reminders     — le réglage de CHAQUE utilisateur pour un séjour :
--     un membre active ses rappels sans les imposer aux autres ;
--   • trip_schedule      — l'heure réelle de chaque étape à venir, PUBLIÉE PAR
--     LE CLIENT. Les heures « auto » se déduisent des temps de trajet Google
--     mis en cache dans le navigateur ; le serveur ne saurait les recalculer
--     sans repayer Google ;
--   • reminders_sent     — ce qui est déjà parti, pour ne jamais rien envoyer
--     deux fois.
--
-- La paire de clés VAPID, qui signe chaque envoi, est créée par l'Edge
-- Function `rappels` au premier besoin et rangée dans le coffre (vault) : la
-- clé privée ne quitte jamais le serveur.
--
-- Script idempotent : il se rejoue sans erreur ni perte.
-- ============================================================

-- --- Appareils ---------------------------------------------------------------
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- --- Réglage par utilisateur et par séjour -----------------------------------
-- Un lecteur peut régler ses rappels : ils ne modifient pas le séjour, d'où
-- can_read_trip et non can_edit_trip.
create table if not exists public.trip_reminders (
  trip_id    text not null references public.trips (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  enabled    boolean not null default true,
  delai_min  integer not null default 15 check (delai_min between 5 and 120),
  updated_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);
create index if not exists trip_reminders_user_idx on public.trip_reminders (user_id);
alter table public.trip_reminders enable row level security;

drop policy if exists trip_reminders_select on public.trip_reminders;
drop policy if exists trip_reminders_insert on public.trip_reminders;
drop policy if exists trip_reminders_update on public.trip_reminders;
drop policy if exists trip_reminders_delete on public.trip_reminders;
create policy trip_reminders_select on public.trip_reminders for select
  using (user_id = (select auth.uid()));
create policy trip_reminders_insert on public.trip_reminders for insert
  with check (user_id = (select auth.uid()) and public.can_read_trip(trip_id));
create policy trip_reminders_update on public.trip_reminders for update
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.can_read_trip(trip_id));
create policy trip_reminders_delete on public.trip_reminders for delete
  using (user_id = (select auth.uid()));

-- --- Horaires publiés --------------------------------------------------------
-- item_key : l'id de l'activité, ou « idHébergement#date » pour le départ du
-- matin d'un hébergement. jour et heure sont ceux de l'appareil qui a publié,
-- tels qu'on les lit dans la timeline : le texte de la notification les reprend
-- sans avoir à deviner un fuseau.
create table if not exists public.trip_schedule (
  trip_id   text not null references public.trips (id) on delete cascade,
  item_key  text not null,
  starts_at timestamptz not null,
  jour      date not null,
  heure     text not null,
  titre     text not null,
  lieu      text,
  primary key (trip_id, item_key)
);
create index if not exists trip_schedule_starts_idx on public.trip_schedule (starts_at);
alter table public.trip_schedule enable row level security;

drop policy if exists trip_schedule_select on public.trip_schedule;
drop policy if exists trip_schedule_insert on public.trip_schedule;
drop policy if exists trip_schedule_update on public.trip_schedule;
drop policy if exists trip_schedule_delete on public.trip_schedule;
create policy trip_schedule_select on public.trip_schedule for select
  using (public.can_read_trip(trip_id));
create policy trip_schedule_insert on public.trip_schedule for insert
  with check (public.can_edit_trip(trip_id));
create policy trip_schedule_update on public.trip_schedule for update
  using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));
create policy trip_schedule_delete on public.trip_schedule for delete
  using (public.can_edit_trip(trip_id));

-- --- Envois effectués --------------------------------------------------------
-- starts_at fait partie de la clé : une étape déplacée à une autre heure est
-- un NOUVEAU rendez-vous, qui mérite son propre rappel.
-- Aucune policy : seul le service (Edge Function) y lit et écrit.
create table if not exists public.reminders_sent (
  user_id   uuid not null,
  trip_id   text not null,
  item_key  text not null,
  starts_at timestamptz not null,
  sent_at   timestamptz not null default now(),
  primary key (user_id, trip_id, item_key, starts_at)
);
alter table public.reminders_sent enable row level security;

-- --- Rappels dus -------------------------------------------------------------
-- Dû : l'heure du rappel (début − délai) est passée, l'étape n'a pas commencé,
-- et le retard n'excède pas dix minutes. Cette borne évite, après une panne,
-- une rafale de rappels pour des étapes déjà entamées ou depuis longtemps
-- annoncées.
--
-- L'accès au séjour est revérifié ici, par l'adresse du compte : un membre
-- retiré du séjour garde sa ligne trip_reminders, mais plus aucun rappel.
create or replace view public.rappels_dus with (security_invoker = true) as
  select r.user_id, s.trip_id, t.name as trip_nom, s.item_key, s.starts_at,
         s.jour, s.heure, s.titre, s.lieu, r.delai_min
    from public.trip_reminders r
    join public.trip_schedule s on s.trip_id = r.trip_id
    join public.trips t on t.id = r.trip_id
   where r.enabled
     and now() >= s.starts_at - make_interval(mins => r.delai_min)
     and now() <  least(s.starts_at, s.starts_at - make_interval(mins => r.delai_min) + interval '10 minutes')
     and (t.owner_id = r.user_id
          or exists (select 1 from public.trip_members m
                       join auth.users u on lower(u.email) = lower(m.email)
                      where m.trip_id = t.id and u.id = r.user_id))
     and not exists (select 1 from public.reminders_sent e
                      where e.user_id = r.user_id and e.trip_id = s.trip_id
                        and e.item_key = s.item_key and e.starts_at = s.starts_at);
-- La vue lit auth.users : elle n'est pas faite pour l'API publique.
revoke all on public.rappels_dus from public, anon, authenticated;

-- Y a-t-il quelque chose à envoyer ? Posée chaque minute par pg_cron, elle
-- évite d'invoquer l'Edge Function pour rien — c'est-à-dire presque toujours.
create or replace function public.rappels_en_attente()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.rappels_dus);
$$;

-- Réserve les rappels dus et les renvoie. L'insertion dans reminders_sent
-- précède l'envoi : deux invocations qui se chevauchent ne réservent jamais la
-- même ligne (ON CONFLICT), donc n'envoient jamais deux fois. Un envoi qui
-- échouerait ensuite est perdu plutôt que doublé — c'est le bon côté de
-- l'erreur pour une notification.
create or replace function public.rappels_a_envoyer()
returns table (user_id uuid, trip_id text, trip_nom text, item_key text, starts_at timestamptz,
               jour date, heure text, titre text, lieu text, delai_min integer)
language plpgsql security definer volatile set search_path = public as $$
#variable_conflict use_column
begin
  -- Ménage au passage : au-delà de deux jours, un envoi ne peut plus se répéter.
  delete from public.reminders_sent e where e.starts_at < now() - interval '2 days';
  return query
    with dus as (select * from public.rappels_dus),
    pris as (
      insert into public.reminders_sent as e (user_id, trip_id, item_key, starts_at)
        select d.user_id, d.trip_id, d.item_key, d.starts_at from dus d
      on conflict do nothing
      returning e.user_id, e.trip_id, e.item_key, e.starts_at
    )
    select d.user_id, d.trip_id, d.trip_nom, d.item_key, d.starts_at,
           d.jour, d.heure, d.titre, d.lieu, d.delai_min
      from dus d
      join pris p on p.user_id = d.user_id and p.trip_id = d.trip_id
                 and p.item_key = d.item_key and p.starts_at = d.starts_at;
end;
$$;

-- --- Clés VAPID ---------------------------------------------------------------
-- Lues et posées par les Edge Functions seules, avec la clé de service.
create or replace function public.rappels_cles()
returns table (publique text, privee text)
language sql security definer stable set search_path = public, vault as $$
  select (select decrypted_secret from vault.decrypted_secrets where name = 'vapid_publique'),
         (select decrypted_secret from vault.decrypted_secrets where name = 'vapid_privee');
$$;

-- Ne pose la paire que si aucune n'existe : deux premiers appels simultanés
-- ne doivent pas en créer deux, sinon les abonnements pris avec l'une seraient
-- refusés par l'autre. Le verrou sérialise ; le second retrouve la première.
create or replace function public.rappels_pose_cles(p_publique text, p_privee text)
returns void language plpgsql security definer volatile set search_path = public, vault as $$
begin
  perform pg_advisory_xact_lock(hashtext('rappels_vapid'));
  if not exists (select 1 from vault.secrets where name = 'vapid_privee') then
    perform vault.create_secret(p_publique, 'vapid_publique', 'Clé publique VAPID des rappels');
    perform vault.create_secret(p_privee, 'vapid_privee', 'Clé privée VAPID des rappels');
  end if;
end;
$$;

revoke execute on function public.rappels_en_attente() from public, anon, authenticated;
revoke execute on function public.rappels_a_envoyer() from public, anon, authenticated;
revoke execute on function public.rappels_cles() from public, anon, authenticated;
revoke execute on function public.rappels_pose_cles(text, text) from public, anon, authenticated;
grant  execute on function public.rappels_a_envoyer() to service_role;
grant  execute on function public.rappels_cles() to service_role;
grant  execute on function public.rappels_pose_cles(text, text) to service_role;

-- --- Planification -------------------------------------------------------------
-- Chaque minute, l'Edge Function send-reminders est appelée — mais seulement
-- s'il y a quelque chose à envoyer. Elle n'exige pas de jeton : elle n'envoie
-- que les rappels déjà dus, une seule fois chacun, si bien qu'un appel venu
-- d'ailleurs ne fait rien d'autre que ce que ferait la minute suivante.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'rappels-activites',
  '* * * * *',
  $$
    select net.http_post(
      url := 'https://awmtajjbwgrechzmhorr.supabase.co/functions/v1/send-reminders',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 20000
    )
    where public.rappels_en_attente();
  $$
);
