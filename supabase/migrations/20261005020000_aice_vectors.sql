-- AICE semantic search lives beside its source runs in Supabase.
create schema if not exists extensions;
create extension if not exists vector with schema extensions;

create table public.aice_vector_documents (
  doc_id text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  run_id uuid references public.aice_runs(id) on delete cascade,
  source_type text not null check (source_type in ('material_chemistry', 'correlation_note', 'colorant_reference', 'personal_recipe')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding extensions.vector(384) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aice_vector_document_scope check (
    (source_type = 'personal_recipe' and user_id is not null and run_id is not null and doc_id = 'run-' || run_id::text)
    or (source_type <> 'personal_recipe' and user_id is null and run_id is null)
  )
);

create index aice_vector_documents_owner on public.aice_vector_documents(user_id, source_type);
create index aice_vector_documents_embedding on public.aice_vector_documents
  using hnsw (embedding extensions.vector_cosine_ops);

alter table public.aice_vector_documents enable row level security;
revoke all on public.aice_vector_documents from anon;
grant select, insert, update, delete on public.aice_vector_documents to authenticated;

create policy aice_vector_read on public.aice_vector_documents for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));
create policy aice_vector_insert on public.aice_vector_documents for insert to authenticated
  with check (
    source_type = 'personal_recipe' and user_id = (select auth.uid())
    and exists (select 1 from public.aice_runs r where r.id = run_id and r.user_id = (select auth.uid()))
  );
create policy aice_vector_update on public.aice_vector_documents for update to authenticated
  using (source_type = 'personal_recipe' and user_id = (select auth.uid()))
  with check (
    source_type = 'personal_recipe' and user_id = (select auth.uid())
    and exists (select 1 from public.aice_runs r where r.id = run_id and r.user_id = (select auth.uid()))
  );
create policy aice_vector_delete on public.aice_vector_documents for delete to authenticated
  using (source_type = 'personal_recipe' and user_id = (select auth.uid()));

create or replace function public.match_aice_vector_documents(
  query_embedding extensions.vector(384),
  match_count integer default 4,
  match_source_types text[] default null,
  match_user_id uuid default null
)
returns table (doc_id text, content text, source_type text, metadata jsonb, similarity double precision)
language sql stable security invoker
set search_path = public, extensions
as $$
  select d.doc_id, d.content, d.source_type, d.metadata,
    1 - (d.embedding <=> query_embedding) as similarity
  from public.aice_vector_documents d
  where (match_source_types is null or d.source_type = any(match_source_types))
    and (match_user_id is null or d.user_id = match_user_id)
  order by d.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 20);
$$;

revoke all on function public.match_aice_vector_documents(extensions.vector, integer, text[], uuid) from public, anon;
grant execute on function public.match_aice_vector_documents(extensions.vector, integer, text[], uuid) to authenticated;
