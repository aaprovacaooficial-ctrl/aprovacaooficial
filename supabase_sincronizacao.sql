-- =====================================================================
-- Sincronização entre aparelhos + Reiniciar Cobertura
-- =====================================================================
-- Rode UMA VEZ no SQL Editor do seu projeto Supabase e clique em "Run".
-- Pode rodar de novo sem medo: tudo usa "if not exists" / drop + create.
--
-- O QUE ESTE SCRIPT FAZ
--   1. Cria a tabela `dados_usuario`, que guarda (por aluno) as listas que
--      antes ficavam só no navegador de cada aparelho:
--        - flashcards criados a partir de questões ("Virar Flashcard")
--        - questões favoritas do banco de questões (estrela)
--        - favoritos dentro das páginas de flashcards
--        - itens marcados como "lido" nas apostilas
--        - a data em que você reiniciou a Cobertura do Banco
--      É isso que faz o que você salva no celular aparecer no computador.
--   2. Acrescenta a coluna `respondida_em` em `respostas_detalhadas`, usada
--      pelo botão "Reiniciar cobertura": depois de reiniciar, a Cobertura
--      só conta questões respondidas a partir daquele momento. Nada é
--      apagado — questões, respostas, histórico e ofensiva continuam lá.
--
-- Sem este script, o site continua funcionando como antes (tudo salvo só
-- no aparelho), mas não sincroniza e não deixa reiniciar a Cobertura.
--
-- COMO USAR
-- 1. Abra seu projeto em https://supabase.com/dashboard
-- 2. Vá em "SQL Editor" (menu lateral) → "New query"
-- 3. Cole TODO o conteúdo deste arquivo e clique em "Run"
-- =====================================================================

create table if not exists public.dados_usuario (
  user_id uuid not null references auth.users(id) on delete cascade,
  chave text not null,
  valor jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now(),
  primary key (user_id, chave)
);

alter table public.dados_usuario enable row level security;

drop policy if exists "Usuário vê seus próprios dados" on public.dados_usuario;
create policy "Usuário vê seus próprios dados"
  on public.dados_usuario for select
  using (
    auth.uid() = user_id
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.aprovado = true)
  );

drop policy if exists "Usuário cria seus próprios dados" on public.dados_usuario;
create policy "Usuário cria seus próprios dados"
  on public.dados_usuario for insert
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.aprovado = true)
  );

drop policy if exists "Usuário atualiza seus próprios dados" on public.dados_usuario;
create policy "Usuário atualiza seus próprios dados"
  on public.dados_usuario for update
  using (
    auth.uid() = user_id
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.aprovado = true)
  );

drop policy if exists "Usuário apaga seus próprios dados" on public.dados_usuario;
create policy "Usuário apaga seus próprios dados"
  on public.dados_usuario for delete
  using (
    auth.uid() = user_id
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.aprovado = true)
  );

-- Momento da última vez que a questão foi respondida (criado_em continua
-- sendo a PRIMEIRA vez, usado pela Ofensiva de Estudos).
alter table public.respostas_detalhadas
  add column if not exists respondida_em timestamptz not null default now();
