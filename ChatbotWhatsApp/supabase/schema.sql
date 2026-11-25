-- =============================================================================
-- WHATSAPP AI CRM & AUTOMATION PLATFORM — SUPABASE SCHEMA (100% ONLINE & PC)
-- Execute este script no SQL Editor do seu projeto Supabase:
-- https://supabase.com/dashboard
-- =============================================================================

-- 1. Tabela principal de armazenamento sincronizado do Bot (Agendamentos, Grupos,
--    Contatos, Listas, Histórico, Triagem IA, Aprendizado Contínuo e Status ao Vivo)
create table if not exists public.bot_kv_store (
    chave text primary key,
    dados jsonb not null default '{}'::jsonb,
    atualizado_em timestamptz not null default now()
);

create index if not exists idx_bot_kv_store_atualizado_em
    on public.bot_kv_store (atualizado_em desc);

-- 2. Fila de Comandos Remotos (Permite que o Painel no GitHub Pages envie ações
--    em tempo real para o Bot rodando no PC ou em Servidor 24h na Nuvem)
create table if not exists public.bot_comandos_fila (
    id bigint generated always as identity primary key,
    acao text not null,
    payload jsonb not null default '{}'::jsonb,
    status text not null default 'pendente', -- 'pendente' | 'processando' | 'concluido' | 'erro'
    resultado jsonb default null,
    criado_em timestamptz not null default now(),
    processado_em timestamptz default null
);

create index if not exists idx_bot_comandos_fila_status_criado
    on public.bot_comandos_fila (status, criado_em asc)
    where status = 'pendente';

-- 3. Estado da Sessão do WhatsApp na Nuvem (Substitui a pasta auth_info quando
--    o bot estiver rodando 24h em nuvem gratuita como Render / Koyeb / Railway)
create table if not exists public.whatsapp_auth_state (
    chave text primary key,
    valor jsonb not null,
    atualizado_em timestamptz not null default now()
);

-- 4. Permissões da Data API (PostgREST) e Row Level Security (RLS)
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.bot_kv_store to anon, authenticated;
grant select, insert, update, delete on table public.bot_comandos_fila to anon, authenticated;
grant usage, select on sequence public.bot_comandos_fila_id_seq to anon, authenticated;
grant select, insert, update, delete on table public.whatsapp_auth_state to anon, authenticated;

alter table public.bot_kv_store enable row level security;
alter table public.bot_comandos_fila enable row level security;
alter table public.whatsapp_auth_state enable row level security;

-- Políticas de acesso para funcionamento híbrido (PC Local + Painel Online GitHub Pages)
drop policy if exists "bot_kv_store_select" on public.bot_kv_store;
create policy "bot_kv_store_select" on public.bot_kv_store
    for select to anon, authenticated using (true);

drop policy if exists "bot_kv_store_insert" on public.bot_kv_store;
create policy "bot_kv_store_insert" on public.bot_kv_store
    for insert to anon, authenticated with check (true);

drop policy if exists "bot_kv_store_update" on public.bot_kv_store;
create policy "bot_kv_store_update" on public.bot_kv_store
    for update to anon, authenticated using (true) with check (true);

drop policy if exists "bot_kv_store_delete" on public.bot_kv_store;
create policy "bot_kv_store_delete" on public.bot_kv_store
    for delete to anon, authenticated using (true);

drop policy if exists "bot_comandos_select" on public.bot_comandos_fila;
create policy "bot_comandos_select" on public.bot_comandos_fila
    for select to anon, authenticated using (true);

drop policy if exists "bot_comandos_insert" on public.bot_comandos_fila;
create policy "bot_comandos_insert" on public.bot_comandos_fila
    for insert to anon, authenticated with check (true);

drop policy if exists "bot_comandos_update" on public.bot_comandos_fila;
create policy "bot_comandos_update" on public.bot_comandos_fila
    for update to anon, authenticated using (true) with check (true);

drop policy if exists "bot_comandos_delete" on public.bot_comandos_fila;
create policy "bot_comandos_delete" on public.bot_comandos_fila
    for delete to anon, authenticated using (true);

drop policy if exists "whatsapp_auth_select" on public.whatsapp_auth_state;
create policy "whatsapp_auth_select" on public.whatsapp_auth_state
    for select to anon, authenticated using (true);

drop policy if exists "whatsapp_auth_insert" on public.whatsapp_auth_state;
create policy "whatsapp_auth_insert" on public.whatsapp_auth_state
    for insert to anon, authenticated with check (true);

drop policy if exists "whatsapp_auth_update" on public.whatsapp_auth_state;
create policy "whatsapp_auth_update" on public.whatsapp_auth_state
    for update to anon, authenticated using (true) with check (true);

drop policy if exists "whatsapp_auth_delete" on public.whatsapp_auth_state;
create policy "whatsapp_auth_delete" on public.whatsapp_auth_state
    for delete to anon, authenticated using (true);

-- 5. Bucket de Storage para Mídias (Fotos e Vídeos dos Agendamentos na Nuvem)
insert into storage.buckets (id, name, public)
values ('midia', 'midia', true)
on conflict (id) do update set public = true;

drop policy if exists "midia_public_select" on storage.objects;
create policy "midia_public_select" on storage.objects
    for select to anon, authenticated
    using (bucket_id = 'midia');

drop policy if exists "midia_public_insert" on storage.objects;
create policy "midia_public_insert" on storage.objects
    for insert to anon, authenticated
    with check (bucket_id = 'midia');

drop policy if exists "midia_public_update" on storage.objects;
create policy "midia_public_update" on storage.objects
    for update to anon, authenticated
    using (bucket_id = 'midia')
    with check (bucket_id = 'midia');

drop policy if exists "midia_public_delete" on storage.objects;
create policy "midia_public_delete" on storage.objects
    for delete to anon, authenticated
    using (bucket_id = 'midia');
