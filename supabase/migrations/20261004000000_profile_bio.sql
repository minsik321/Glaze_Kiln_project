alter table public.profiles
  add column if not exists bio text not null default ''
    check (char_length(bio) <= 150);

notify pgrst, 'reload schema';
