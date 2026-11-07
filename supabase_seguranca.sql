-- =====================================================================
-- Correções de segurança (revisão de 2026-10-20)
-- Rode tudo de uma vez no SQL Editor do Supabase. Pode rodar mais de
-- uma vez sem problema. Não apaga nenhum dado.
-- =====================================================================

-- 1) Um aluno logado conseguia se dar "aprovado" e "admin" sozinho,
--    editando o próprio perfil pela API. Agora só o administrador
--    (pelas funções admin_set_aprovado / painel) ou o SQL Editor mudam
--    esses dois campos. Contas novas sempre nascem não aprovadas.
create or replace function public.proteger_campos_perfil()
returns trigger
language plpgsql
as '
begin
  if current_user in (''anon'', ''authenticated'') then
    if tg_op = ''INSERT'' then
      new.aprovado := false;
      new.admin := false;
    else
      new.aprovado := old.aprovado;
      new.admin := old.admin;
    end if;
  end if;
  return new;
end;
';

drop trigger if exists proteger_campos_perfil on public.profiles;
create trigger proteger_campos_perfil
  before insert or update on public.profiles
  for each row execute function public.proteger_campos_perfil();

-- 2) A visão "acessos_admin" mostrava o e-mail de TODOS os alunos para
--    qualquer pessoa na internet (nem precisava estar logado). O site
--    não usa essa visão (o painel usa admin_list_students), então ela
--    fica fechada para o público. Pelo SQL Editor você ainda consulta.
revoke all on public.acessos_admin from anon, authenticated;

-- 3) Funções de administrador e ranking: quem não está logado não
--    precisa chamar nenhuma delas. (Para logados elas já conferem se a
--    pessoa é admin/aprovada por dentro.)
revoke execute on function public.admin_list_students() from anon, public;
revoke execute on function public.admin_set_aprovado(uuid, boolean) from anon, public;
revoke execute on function public.admin_set_acesso(uuid, text, boolean) from anon, public;
revoke execute on function public.get_ranking_geral() from anon, public;
grant execute on function public.admin_list_students() to authenticated;
grant execute on function public.admin_set_aprovado(uuid, boolean) to authenticated;
grant execute on function public.admin_set_acesso(uuid, text, boolean) to authenticated;
grant execute on function public.get_ranking_geral() to authenticated;

-- 4) Duas regras antigas de "respostas_detalhadas" deixavam aluno ainda
--    não aprovado gravar/ler respostas. As regras novas (que exigem
--    aprovado) continuam valendo.
drop policy if exists "usuario insere suas proprias respostas" on public.respostas_detalhadas;
drop policy if exists "usuario le suas proprias respostas" on public.respostas_detalhadas;

-- Conferência: deve mostrar acessos_admin_publico = false e o gatilho.
select
  has_table_privilege('anon', 'public.acessos_admin', 'SELECT') as acessos_admin_publico,
  (select count(*) from pg_trigger where tgname = 'proteger_campos_perfil') as gatilho_perfil;
