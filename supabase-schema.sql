-- ============================================================
-- Supabase Schema para Chatbot Persistente (Conversations)
-- ============================================================

-- Criação da tabela de conversas
create table if not exists public.conversations (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  title text default 'Nova Conversa',
  messages jsonb not null default '[]'::jsonb,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Índices para busca rápida
create index if not exists idx_conversations_user_id on public.conversations(user_id);
create index if not exists idx_conversations_updated_at on public.conversations(updated_at desc);

-- Habilitar RLS (Row Level Security)
alter table public.conversations enable row level security;

-- Políticas de acesso permissivas para chave anon/service_role ou usuários autenticados
create policy "Permitir leitura para todos ou anon"
  on public.conversations for select
  using (true);

create policy "Permitir inserção e atualização para todos ou anon"
  on public.conversations for insert
  with check (true);

create policy "Permitir update para todos ou anon"
  on public.conversations for update
  using (true);

create policy "Permitir deleção para todos ou anon"
  on public.conversations for delete
  using (true);
