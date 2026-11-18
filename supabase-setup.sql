-- ============================================================
-- Teigbuch – Einrichtung der Supabase-Datenbank
-- In Supabase: SQL Editor → New query → alles einfügen → Run
-- Das Skript kann gefahrlos mehrfach ausgeführt werden.
-- ============================================================

-- 1) Tabelle für Rezepte und Tagebuch-Einträge
create table if not exists public.items (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id         text        not null,
  kind       text        not null check (kind in ('recipe', 'log')),
  data       jsonb,
  deleted    boolean     not null default false,
  updated_at bigint      not null,               -- Zeitpunkt der Änderung auf dem Gerät (ms)
  server_at  timestamptz not null default now(), -- Zeitpunkt, an dem der Server die Änderung erhalten hat
  primary key (user_id, id)
);
create index if not exists items_user_server_at on public.items (user_id, server_at);

-- 2) Zugriffsschutz: Jeder sieht und ändert NUR seine eigenen Daten
alter table public.items enable row level security;
drop policy if exists "items_select_own" on public.items;
drop policy if exists "items_insert_own" on public.items;
drop policy if exists "items_update_own" on public.items;
drop policy if exists "items_delete_own" on public.items;
create policy "items_select_own" on public.items for select to authenticated using (auth.uid() = user_id);
create policy "items_insert_own" on public.items for insert to authenticated with check (auth.uid() = user_id);
create policy "items_update_own" on public.items for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "items_delete_own" on public.items for delete to authenticated using (auth.uid() = user_id);

-- 3) Server-Zeitstempel setzen und ältere Stände nie über neuere schreiben
create or replace function public.items_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null; -- ältere Version verwerfen, die neuere bleibt
  end if;
  new.server_at := now();
  return new;
end $$;
drop trigger if exists items_touch on public.items;
create trigger items_touch before insert or update on public.items
  for each row execute function public.items_touch();

-- 4) Privater Speicher für Fotos (jeder Nutzer nur in seinem eigenen Ordner)
insert into storage.buckets (id, name, public) values ('photos', 'photos', false)
  on conflict (id) do nothing;
drop policy if exists "photos_select_own" on storage.objects;
drop policy if exists "photos_insert_own" on storage.objects;
drop policy if exists "photos_update_own" on storage.objects;
drop policy if exists "photos_delete_own" on storage.objects;
create policy "photos_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Fertig! Unten sollte „Success. No rows returned“ stehen.
