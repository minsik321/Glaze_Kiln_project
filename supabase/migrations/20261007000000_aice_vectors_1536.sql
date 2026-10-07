-- Embeddings now come from aimlapi.com (text-embedding-3-small, 1536 dims)
-- instead of local fastembed (384 dims). Vectors from different models are not
-- comparable, so every stored vector is dropped and must be re-indexed:
--   * reference corpus: python -m backend.scripts.ingest_corpus --output-sql <file>, then run that SQL
--   * personal recipes: re-embedded from saved runs (or lazily when runs are saved again)
drop index if exists public.aice_vector_documents_embedding;
delete from public.aice_vector_documents;

alter table public.aice_vector_documents
  alter column embedding type extensions.vector(1536);

create index aice_vector_documents_embedding on public.aice_vector_documents
  using hnsw (embedding extensions.vector_cosine_ops);

drop function if exists public.match_aice_vector_documents(extensions.vector, integer, text[], uuid);

create or replace function public.match_aice_vector_documents(
  query_embedding extensions.vector(1536),
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
