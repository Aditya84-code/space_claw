-- ═══════════════════════════════════════════════════════════════════
-- Space Claw — Supabase Schema + Helper Functions
-- Run this ONCE in the Supabase SQL Editor:
--   https://supabase.com/dashboard/project/<your-project>/sql
-- ═══════════════════════════════════════════════════════════════════

-- 1. Enable the pgvector extension
create extension if not exists vector;

-- 2. Memories table
create table if not exists memories (
    id          bigserial primary key,
    title       text        not null,
    body        text        not null,
    embedding   vector(1536),               -- OpenAI text-embedding-3-small
    created_at  timestamptz default now(),
    updated_at  timestamptz default now()
);

-- Unique index for deduplication by title (case-insensitive)
create unique index if not exists memories_title_idx
    on memories (lower(title));

-- IVFFlat index for fast approximate cosine similarity search
-- (Rebuild with higher `lists` value when you exceed ~10k rows)
create index if not exists memories_embedding_idx
    on memories using ivfflat (embedding vector_cosine_ops)
    with (lists = 100);

-- ──────────────────────────────────────────────────────────────────
-- 3. upsert_memory(title, body, embedding)
--    Insert or update a memory, keyed by lower(title).
-- ──────────────────────────────────────────────────────────────────
create or replace function upsert_memory(
    p_title     text,
    p_body      text,
    p_embedding vector(1536)
)
returns void
language plpgsql
as $$
begin
    insert into memories (title, body, embedding, updated_at)
    values (p_title, p_body, p_embedding, now())
    on conflict (lower(title))
    do update set
        body       = excluded.body,
        embedding  = excluded.embedding,
        updated_at = now();
end;
$$;

-- ──────────────────────────────────────────────────────────────────
-- 4. search_memories(query_embedding, match_count)
--    Return the top-K most similar memories via cosine distance.
-- ──────────────────────────────────────────────────────────────────
create or replace function search_memories(
    query_embedding vector(1536),
    match_count     int default 5
)
returns table (
    title       text,
    body        text,
    similarity  float
)
language sql stable
as $$
    select
        title,
        body,
        1 - (embedding <=> query_embedding) as similarity
    from   memories
    where  embedding is not null
    order  by embedding <=> query_embedding
    limit  match_count;
$$;
