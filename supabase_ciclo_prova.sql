-- =====================================================================
-- Data da prova editável + ciclo de estudos
-- =====================================================================
-- Rode UMA VEZ no SQL Editor do seu projeto Supabase e clique em "Run".
-- Pode rodar de novo sem medo: tudo usa "if not exists" / "or replace".
--
-- O QUE ESTE SCRIPT FAZ
--   1. Cria a tabela `configuracoes`, onde fica a data da prova. Todos os
--      alunos logados podem LER; só quem tem profiles.admin = true pode
--      MUDAR (pela página inicial, no lápis ao lado da contagem regressiva).
--   2. Atualiza o ranking geral (get_ranking_geral) para contar só os
--      simulados feitos depois do início do ciclo atual. Quando a data da
--      prova muda, o ranking recomeça do zero para todos.
--
-- Nada é apagado: os simulados antigos continuam no banco, só deixam de
-- contar no ciclo novo.
-- =====================================================================

create table if not exists public.configuracoes (
  chave text primary key,
  valor jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);

alter table public.configuracoes enable row level security;

drop policy if exists "Logados leem configurações" on public.configuracoes;
create policy "Logados leem configurações"
  on public.configuracoes for select
  to authenticated
  using (true);

drop policy if exists "Admin cria configurações" on public.configuracoes;
create policy "Admin cria configurações"
  on public.configuracoes for insert
  to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.admin = true));

drop policy if exists "Admin atualiza configurações" on public.configuracoes;
create policy "Admin atualiza configurações"
  on public.configuracoes for update
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.admin = true))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.admin = true));

-- Ranking geral: igual ao anterior, mas só com simulados do ciclo atual.
create or replace function public.get_ranking_geral()
returns table (
  user_id uuid,
  nome text,
  total_simulados bigint,
  total_questoes bigint,
  total_acertos bigint,
  percentual_medio numeric,
  posicao bigint
)
language sql
security definer
set search_path = public
stable
as $$
  with ciclo as (
    select coalesce(
      (select (c.valor->>'ciclo_inicio')::timestamptz from public.configuracoes c where c.chave = 'prova'),
      '-infinity'::timestamptz
    ) as inicio
  ),
  agregado as (
    select
      r.user_id,
      count(*)                                   as total_simulados,
      sum(coalesce(r.acertos, 0) + coalesce(r.erros, 0)) as total_questoes,
      sum(coalesce(r.acertos, 0))                as total_acertos,
      round(avg(r.percentual)::numeric, 1)       as percentual_medio
    from public.resultados r, ciclo
    where r.criado_em >= ciclo.inicio
    group by r.user_id
  )
  select
    a.user_id,
    coalesce(p.nome, 'Aluno')                    as nome,
    a.total_simulados,
    a.total_questoes,
    a.total_acertos,
    a.percentual_medio,
    row_number() over (
      order by a.total_acertos desc, a.percentual_medio desc, a.total_simulados desc
    ) as posicao
  from agregado a
  join public.profiles p on p.id = a.user_id
  where p.aprovado = true
  order by posicao asc;
$$;

grant execute on function public.get_ranking_geral() to authenticated;
