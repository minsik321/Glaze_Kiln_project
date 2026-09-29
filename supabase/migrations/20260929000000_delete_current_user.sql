create or replace function public.delete_current_user()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  delete from auth.users where id = auth.uid();

  if not found then
    raise exception 'Authenticated user was not found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.delete_current_user() from public;
revoke all on function public.delete_current_user() from anon;
grant execute on function public.delete_current_user() to authenticated;

comment on function public.delete_current_user() is
  'Deletes only the auth user represented by the caller JWT; dependent app rows cascade.';

notify pgrst, 'reload schema';
