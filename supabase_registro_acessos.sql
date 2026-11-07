-- =====================================================================
-- Registro de acessos (contra compartilhamento de senha)
-- Rode no SQL Editor do Supabase. Pode rodar mais de uma vez.
--
-- A cada login com senha (e a cada "Usar neste aparelho"), a função
-- registrar-acesso grava: data, aparelho, navegador e cidade aproximada
-- (pelo IP). Os registros ficam 90 dias e só o administrador vê, na
-- página acessos.html. Quem grava é só a função (com a chave de serviço):
-- o aluno não consegue gravar, alterar nem apagar registros.
-- =====================================================================

create table if not exists public.acessos_login (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  criado_em timestamptz not null default now(),
  tipo text not null default 'login',
  dispositivo text,
  navegador text,
  ip text,
  cidade text,
  regiao text,
  pais text
);
create index if not exists acessos_login_user_data on public.acessos_login (user_id, criado_em desc);

alter table public.acessos_login enable row level security;
revoke all on public.acessos_login from anon, authenticated;
grant select on public.acessos_login to authenticated;

drop policy if exists "admin le acessos" on public.acessos_login;
create policy "admin le acessos" on public.acessos_login
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.admin = true));

-- Resumo por aluno dos últimos 30 dias (só administrador).
create or replace function public.admin_resumo_acessos()
returns table (
  user_id uuid,
  nome text,
  email text,
  logins bigint,
  aparelhos bigint,
  cidades bigint,
  trocas bigint,
  ultimo_acesso timestamptz,
  ultima_cidade text
)
language plpgsql
stable
security definer
set search_path = public
as '
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.admin = true) then
    raise exception ''Somente administrador.'';
  end if;
  return query
    select a.user_id,
           pr.nome::text,
           u.email::text,
           count(*),
           count(distinct a.dispositivo),
           count(distinct coalesce(a.cidade, '''') || ''/'' || coalesce(a.regiao, '''')) filter (where a.cidade is not null),
           count(*) filter (where a.tipo = ''trocou_aparelho''),
           max(a.criado_em),
           (select a2.cidade from public.acessos_login a2 where a2.user_id = a.user_id order by a2.criado_em desc limit 1)
    from public.acessos_login a
    join auth.users u on u.id = a.user_id
    left join public.profiles pr on pr.id = a.user_id
    where a.criado_em > now() - interval ''30 days''
    group by a.user_id, pr.nome, u.email
    order by count(distinct a.dispositivo) desc, max(a.criado_em) desc;
end;
';
revoke execute on function public.admin_resumo_acessos() from public, anon;
grant execute on function public.admin_resumo_acessos() to authenticated;

-- Conferência: deve mostrar tabela_criada = 1.
select count(*) as tabela_criada from information_schema.tables
where table_schema = 'public' and table_name = 'acessos_login';
