-- 채팅 전달. chat_threads/chat_messages는 소유자(owner_id)별 사본이라, 보낸 사람은
-- 자기 사본만 쓸 수 있고 받는 사람 쪽에는 아무것도 생기지 않았다.
-- 이 함수가 보낸 사람 사본과 받는 사람 사본을 한 트랜잭션으로 만든다.
-- RLS 때문에 받는 사람 행을 클라이언트가 직접 쓰게 열 수는 없으므로 security definer.
create or replace function public.send_chat_message(
  p_id uuid, p_peer text, p_body text, p_sent_at timestamptz default now()
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  peer_uuid uuid;
  my_name text;
begin
  if me is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 10000 then
    raise exception 'invalid message body' using errcode = '22023';
  end if;

  -- 보낸 사람 사본(대화방은 클라이언트가 먼저 만들어 둔다).
  insert into public.chat_messages (id, owner_id, peer_id, body, sent_at, sender)
  values (p_id, me, p_peer, p_body, p_sent_at, 'me');

  -- 받는 사람이 실제 가입자일 때만 상대 사본을 만든다(더미 작가 id는 대상 아님).
  if p_peer ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    peer_uuid := p_peer::uuid;
    if peer_uuid <> me and exists (select 1 from public.profiles where id = peer_uuid) then
      -- 보낸 사람 이름은 클라이언트 값이 아니라 profiles에서 읽는다(사칭 방지).
      select coalesce(nullif(display_name, ''), '가마쟁이') into my_name from public.profiles where id = me;
      my_name := coalesce(my_name, '가마쟁이');
      insert into public.chat_threads (owner_id, peer_id, username, display_name, avatar_tone, updated_at)
      values (peer_uuid, me::text, my_name, my_name,
              (select coalesce(sum(ascii(c)), 0) % 4 + 1 from regexp_split_to_table(me::text, '') c)::int,
              p_sent_at)
      on conflict (owner_id, peer_id) do update set username = excluded.username, display_name = excluded.display_name;
      insert into public.chat_messages (id, owner_id, peer_id, body, sent_at, sender)
      values (gen_random_uuid(), peer_uuid, me::text, p_body, p_sent_at, 'other');
    end if;
  end if;
end;
$$;
revoke all on function public.send_chat_message(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.send_chat_message(uuid, text, text, timestamptz) to authenticated;

notify pgrst, 'reload schema';
