-- Per-account chat history. Peer IDs currently identify demo profiles, not auth users.
create table public.chat_threads (
  owner_id uuid not null references auth.users(id) on delete cascade,
  peer_id text not null check (char_length(peer_id) between 1 and 100),
  username text not null check (char_length(username) <= 100),
  display_name text not null check (char_length(display_name) <= 100),
  avatar_tone integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (owner_id, peer_id)
);

create table public.chat_messages (
  id uuid primary key,
  owner_id uuid not null,
  peer_id text not null,
  body text not null check (char_length(trim(body)) between 1 and 10000),
  sender text not null check (sender in ('me', 'other')),
  sent_at timestamptz not null default now(),
  foreign key (owner_id, peer_id) references public.chat_threads(owner_id, peer_id) on delete cascade
);

create index chat_threads_owner_recent on public.chat_threads(owner_id, updated_at desc);
create index chat_messages_thread_time on public.chat_messages(owner_id, peer_id, sent_at, id);

create function public.touch_chat_thread() returns trigger
language plpgsql set search_path = '' as $$
begin
  update public.chat_threads
  set updated_at = greatest(updated_at, new.sent_at)
  where owner_id = new.owner_id and peer_id = new.peer_id;
  return new;
end;
$$;
create trigger chat_message_touches_thread after insert on public.chat_messages
for each row execute function public.touch_chat_thread();

alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
revoke all on public.chat_threads, public.chat_messages from anon;
grant select, insert, update, delete on public.chat_threads, public.chat_messages to authenticated;
create policy chat_threads_own on public.chat_threads for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);
create policy chat_messages_own on public.chat_messages for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);
