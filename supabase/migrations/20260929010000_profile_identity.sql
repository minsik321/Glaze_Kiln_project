alter table public.profiles
  add column if not exists avatar_url text
    check (avatar_url is null or char_length(avatar_url) <= 350000);

create unique index if not exists profiles_display_name_unique
  on public.profiles (lower(btrim(display_name)))
  where btrim(display_name) <> '';

notify pgrst, 'reload schema';
