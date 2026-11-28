-- =============================================================================
-- HARDENING DE SEGURANCA SAAS NO SUPABASE (MULTI-TENANT)
-- Execute este script no SQL Editor do Supabase DEPOIS de adicionar a variavel
-- SUPABASE_SERVICE_ROLE_KEY no servidor Render.
-- Ele remove acesso publico (anon) as tabelas de sessoes do WhatsApp e clientes.
-- =============================================================================

drop policy if exists "bot_kv_store_select" on public.bot_kv_store;
drop policy if exists "bot_kv_store_insert" on public.bot_kv_store;
drop policy if exists "bot_kv_store_update" on public.bot_kv_store;
drop policy if exists "bot_kv_store_delete" on public.bot_kv_store;

drop policy if exists "bot_comandos_select" on public.bot_comandos_fila;
drop policy if exists "bot_comandos_insert" on public.bot_comandos_fila;
drop policy if exists "bot_comandos_update" on public.bot_comandos_fila;
drop policy if exists "bot_comandos_delete" on public.bot_comandos_fila;

drop policy if exists "whatsapp_auth_select" on public.whatsapp_auth_state;
drop policy if exists "whatsapp_auth_insert" on public.whatsapp_auth_state;
drop policy if exists "whatsapp_auth_update" on public.whatsapp_auth_state;
drop policy if exists "whatsapp_auth_delete" on public.whatsapp_auth_state;

revoke all on table public.bot_kv_store from anon, authenticated;
revoke all on table public.bot_comandos_fila from anon, authenticated;
revoke all on table public.whatsapp_auth_state from anon, authenticated;
