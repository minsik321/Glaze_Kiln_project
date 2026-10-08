-- 채팅 알림. 상대가 메시지를 보내면 받는 사람에게 알림을 만든다.
-- send_chat_message가 받는 사람 사본(sender = 'other')을 넣을 때 트리거가 돈다.
-- 읽지 않은 메시지 알림이 이미 있으면 새로 쌓지 않고 그 알림을 최신 메시지로 갱신한다
-- (대화 한 번에 알림이 수십 개 쌓이지 않게).
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('follow', 'comment', 'message'));

create function public.notify_chat_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor uuid;
begin
  if new.sender <> 'other' then return new; end if;
  if new.peer_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return new;
  end if;
  actor := new.peer_id::uuid;
  if actor = new.owner_id then return new; end if;
  update public.notifications
     set body = left(new.body, 200), created_at = now()
   where user_id = new.owner_id and actor_id = actor and kind = 'message' and read_at is null;
  if not found then
    insert into public.notifications (user_id, actor_id, kind, body)
      values (new.owner_id, actor, 'message', left(new.body, 200));
  end if;
  return new;
end $$;
create trigger chat_messages_notify after insert on public.chat_messages
  for each row execute function public.notify_chat_message();

notify pgrst, 'reload schema';
